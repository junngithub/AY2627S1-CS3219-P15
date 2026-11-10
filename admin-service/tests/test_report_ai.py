# AI Assistance Disclosure
# Tool: Cursor (Auto), date: 2026-11-09
# Scope: Implementation assistance for Admin Service tests under author-fixed requirements and architecture.
# Author review: Sahana Avantika generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.

"""Report assessment. No running service and no Gemini."""

import uuid
from datetime import datetime, timezone

import pytest

from app.jobs import report_jobs
from app.models.moderation import ReportRecommendation, ReportStatus, UserReport
from app.services.ai_client import ReportAssessment, parse_report_assessment


def _report(**overrides) -> UserReport:
    values = dict(
        id=uuid.uuid4(),
        reporter_user_id="u-1",
        reported_user_id="u-2",
        comment="never delivered",
        status=ReportStatus.open,
        created_at=datetime.now(timezone.utc),
    )
    values.update(overrides)
    return UserReport(**values)


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return list(self._rows)


class _Session:
    def __init__(self, report, reports, writes):
        self.report = report
        self.reports = reports
        self.writes = writes

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def get(self, model, report_id):
        if self.report is not None and report_id == self.report.id:
            return self.report
        return None

    async def execute(self, stmt):
        self.writes.append(stmt)
        return _Result(self.reports)

    async def commit(self):
        self.writes.append("commit")


def _updates(writes):
    return [stmt for stmt in writes if hasattr(stmt, "_values")]


@pytest.mark.asyncio
async def test_a_new_report_stores_the_verdict_and_stays_open(monkeypatch):
    report = _report()
    older = _report(comment="left with the item", status=ReportStatus.actioned)
    writes: list = []
    seen: list = []
    monkeypatch.setattr(report_jobs, "SessionLocal", lambda: _Session(report, [older, report], writes))

    async def recommend(reports):
        seen.append(reports)
        return ReportAssessment("suspend", 0.8, "the item was not handed over")

    monkeypatch.setattr(report_jobs.ai_client, "get_report_recommendation", recommend)
    await report_jobs.run_report_evaluation(str(report.id))

    assert seen == [[("actioned", "left with the item"), ("open", "never delivered")]]
    assigned = {column.key: bind.value for column, bind in _updates(writes)[0]._values.items()}
    assert assigned["ai_recommendation"] == ReportRecommendation.suspend
    assert assigned["ai_confidence"] == 0.8
    assert "status" not in assigned
    assert writes[-1] == "commit"


@pytest.mark.asyncio
async def test_a_failed_first_pass_marks_completion_without_a_verdict(monkeypatch):
    report = _report()
    writes: list = []
    monkeypatch.setattr(report_jobs, "SessionLocal", lambda: _Session(report, [report], writes))

    async def recommend(reports):
        return None

    monkeypatch.setattr(report_jobs.ai_client, "get_report_recommendation", recommend)
    await report_jobs.run_report_evaluation(str(report.id))
    assigned = {column.key: bind.value for column, bind in _updates(writes)[0]._values.items()}
    assert list(assigned) == ["ai_completed_at"]


@pytest.mark.asyncio
async def test_a_failed_rerun_keeps_the_previous_verdict(monkeypatch):
    report = _report(
        ai_recommendation=ReportRecommendation.unsure,
        ai_confidence=0.4,
        ai_reasoning="old",
        ai_completed_at=datetime.now(timezone.utc),
    )
    writes: list = []
    monkeypatch.setattr(report_jobs, "SessionLocal", lambda: _Session(report, [report], writes))

    async def recommend(reports):
        return None

    monkeypatch.setattr(report_jobs.ai_client, "get_report_recommendation", recommend)
    await report_jobs.rerun_report_evaluation(str(report.id))
    assert _updates(writes) == []
    assert report.ai_recommendation == ReportRecommendation.unsure


@pytest.mark.asyncio
async def test_a_closed_report_is_not_assessed(monkeypatch):
    report = _report(status=ReportStatus.dismissed)
    writes: list = []
    monkeypatch.setattr(report_jobs, "SessionLocal", lambda: _Session(report, [], writes))

    async def recommend(reports):
        raise AssertionError("closed")

    monkeypatch.setattr(report_jobs.ai_client, "get_report_recommendation", recommend)
    await report_jobs.run_report_evaluation(str(report.id))
    assert writes == []


def test_report_assessment_rejects_an_appeal_verdict():
    assert parse_report_assessment('{"recommendation": "uphold", "confidence": 0.5, "reasoning": "x"}') is None
    got = parse_report_assessment('{"recommendation": "dismiss", "confidence": 0.2, "reasoning": "too thin"}')
    assert got is not None
    assert got.recommendation == "dismiss"
