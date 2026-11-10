# AI Assistance Disclosure
# Tool: Cursor (Auto), date: 2026-11-09
# Scope: Implementation assistance for Admin Service tests under author-fixed requirements and architecture.
# Author review: Sahana Avantika generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.

"""Appeal assessment. No running service and no Gemini."""

import uuid
from datetime import datetime, timezone

import pytest

from app.jobs import appeal_jobs
from app.models.moderation import AppealRecommendation, AppealStatus, ReportStatus, SuspensionAppeal, UserReport
from app.services.ai_client import AppealAssessment, parse_appeal_assessment


def _appeal(**overrides) -> SuspensionAppeal:
    values = dict(
        id=uuid.uuid4(),
        user_id="u-2",
        message="I can explain",
        status=AppealStatus.open,
        created_at=datetime.now(timezone.utc),
    )
    values.update(overrides)
    return SuspensionAppeal(**values)


def _report(comment: str) -> UserReport:
    return UserReport(
        id=uuid.uuid4(),
        reporter_user_id="u-1",
        reported_user_id="u-2",
        comment=comment,
        status=ReportStatus.actioned,
        created_at=datetime.now(timezone.utc),
    )


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return list(self._rows)


class _Session:
    def __init__(self, appeal, reports, writes):
        self.appeal = appeal
        self.reports = reports
        self.writes = writes

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def get(self, model, appeal_id):
        if self.appeal is not None and appeal_id == self.appeal.id:
            return self.appeal
        return None

    async def execute(self, stmt):
        self.writes.append(stmt)
        return _Result(self.reports)

    async def commit(self):
        self.writes.append("commit")


def _updates(writes):
    return [stmt for stmt in writes if hasattr(stmt, "_values")]


@pytest.mark.asyncio
async def test_a_new_appeal_stores_the_verdict_and_stays_open(monkeypatch):
    appeal = _appeal()
    report = _report("Left the order at the wrong block")
    writes: list = []
    seen: list = []
    monkeypatch.setattr(appeal_jobs, "SessionLocal", lambda: _Session(appeal, [report], writes))

    async def recommend(reports, message):
        seen.append((reports, message))
        return AppealAssessment("uphold", 0.8, "the report still stands")

    monkeypatch.setattr(appeal_jobs.ai_client, "get_appeal_recommendation", recommend)
    await appeal_jobs.run_appeal_evaluation(str(appeal.id))

    assert seen == [([("actioned", "Left the order at the wrong block")], "I can explain")]
    assigned = {column.key: bind.value for column, bind in _updates(writes)[0]._values.items()}
    assert assigned["ai_recommendation"] == AppealRecommendation.uphold
    assert assigned["ai_confidence"] == 0.8
    assert assigned["ai_reasoning"] == "the report still stands"
    assert "status" not in assigned
    assert writes[-1] == "commit"


@pytest.mark.asyncio
async def test_a_failed_first_pass_marks_completion_without_a_verdict(monkeypatch):
    appeal = _appeal()
    writes: list = []
    monkeypatch.setattr(appeal_jobs, "SessionLocal", lambda: _Session(appeal, [], writes))

    async def recommend(reports, message):
        assert reports == []
        return None

    monkeypatch.setattr(appeal_jobs.ai_client, "get_appeal_recommendation", recommend)
    await appeal_jobs.run_appeal_evaluation(str(appeal.id))
    assigned = {column.key: bind.value for column, bind in _updates(writes)[0]._values.items()}
    assert list(assigned) == ["ai_completed_at"]


@pytest.mark.asyncio
async def test_a_failed_rerun_keeps_the_previous_verdict(monkeypatch):
    appeal = _appeal(
        ai_recommendation=AppealRecommendation.unsure,
        ai_confidence=0.4,
        ai_reasoning="old",
        ai_completed_at=datetime.now(timezone.utc),
    )
    writes: list = []
    monkeypatch.setattr(appeal_jobs, "SessionLocal", lambda: _Session(appeal, [], writes))

    async def recommend(reports, message):
        return None

    monkeypatch.setattr(appeal_jobs.ai_client, "get_appeal_recommendation", recommend)
    await appeal_jobs.rerun_appeal_evaluation(str(appeal.id))
    assert _updates(writes) == []
    assert appeal.ai_recommendation == AppealRecommendation.unsure


@pytest.mark.asyncio
async def test_a_closed_appeal_is_not_assessed(monkeypatch):
    appeal = _appeal(status=AppealStatus.rejected)
    writes: list = []
    monkeypatch.setattr(appeal_jobs, "SessionLocal", lambda: _Session(appeal, [], writes))

    async def recommend(reports, message):
        raise AssertionError("closed")

    monkeypatch.setattr(appeal_jobs.ai_client, "get_appeal_recommendation", recommend)
    await appeal_jobs.run_appeal_evaluation(str(appeal.id))
    assert writes == []


def test_appeal_assessment_rejects_a_conflict_verdict():
    assert parse_appeal_assessment('{"recommendation": "courier", "confidence": 0.5, "reasoning": "x"}') is None
    got = parse_appeal_assessment('{"recommendation": "reinstate", "confidence": 0.66, "reasoning": "answered"}')
    assert got is not None
    assert got.recommendation == "reinstate"
    assert got.confidence == 0.66
