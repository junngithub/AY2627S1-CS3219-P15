# AI Assistance Disclosure
# Tool: Cursor (Auto), date: 2026-11-09
# Scope: Implementation assistance for Admin Service tests under author-fixed requirements and architecture.
# Author review: Sahana Avantika generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.

"""Photo download and AI rerun. No running service, S3, or Gemini."""

import uuid
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.database import get_db
from app.jobs import conflict_jobs
from app.models.conflict_case import ConflictCase, ConflictStatus, FaultParty
from app.routers import conflicts
from app.services.ai_client import AIRecommendation
from app.services.order_photos import EvidencePhoto

ADMIN = {
    "x-user-id": "admin-sahana",
    "x-is-admin": "true",
    "x-permitted-action": "true",
}
OTHER = {
    "x-user-id": "admin-other",
    "x-is-admin": "true",
    "x-permitted-action": "true",
}


class FakeDb:
    def __init__(self, case):
        self.case = case
        self.added = []
        self.committed = False

    async def get(self, model, case_id):
        if self.case is not None and case_id == self.case.id:
            return self.case
        return None

    def add(self, row):
        self.added.append(row)

    async def flush(self):
        return None

    async def commit(self):
        self.committed = True

    async def rollback(self):
        return None


def _case(**overrides) -> ConflictCase:
    values = dict(
        id=uuid.uuid4(),
        order_id="ord-1",
        reporter_user_id="u-1",
        comment="Item arrived damaged",
        evidence_photo_urls=["ord-1/collection.jpg"],
        status=ConflictStatus.under_review,
        review_started_by_admin_id="admin-sahana",
        ai_fault_party=FaultParty.courier,
        ai_confidence=0.4,
        ai_reasoning="old",
        resolution_deadline=datetime.now(timezone.utc),
    )
    values.update(overrides)
    return ConflictCase(**values)


def _client(db: FakeDb) -> TestClient:
    app = FastAPI()
    app.include_router(conflicts.router)

    async def override():
        yield db

    app.dependency_overrides[get_db] = override
    return TestClient(app)


def test_admin_receives_the_photo_bytes(monkeypatch):
    async def fetch_one(key):
        assert key == "ord-1/collection.jpg"
        return EvidencePhoto("collection", "image/jpeg", b"jpeg-bytes")

    monkeypatch.setattr(conflicts.order_photos, "fetch_one", fetch_one)
    case = _case()
    resp = _client(FakeDb(case)).get(
        f"/api/v1/admin/conflicts/{case.id}/photos/collection",
        headers=ADMIN,
    )
    assert resp.status_code == 200
    assert resp.content == b"jpeg-bytes"
    assert resp.headers["content-type"].startswith("image/jpeg")


def test_a_role_that_is_not_on_the_case_is_not_fetched(monkeypatch):
    async def fetch_one(key):
        raise AssertionError(key)

    monkeypatch.setattr(conflicts.order_photos, "fetch_one", fetch_one)
    case = _case()
    resp = _client(FakeDb(case)).get(
        f"/api/v1/admin/conflicts/{case.id}/photos/delivery",
        headers=ADMIN,
    )
    assert resp.status_code == 404


def test_a_resolved_case_does_not_serve_photos(monkeypatch):
    async def fetch_one(key):
        raise AssertionError(key)

    monkeypatch.setattr(conflicts.order_photos, "fetch_one", fetch_one)
    case = _case(status=ConflictStatus.resolved)
    resp = _client(FakeDb(case)).get(
        f"/api/v1/admin/conflicts/{case.id}/photos/collection",
        headers=ADMIN,
    )
    assert resp.status_code == 404


def test_photo_route_is_hidden_from_a_non_admin():
    case = _case()
    resp = _client(FakeDb(case)).get(f"/api/v1/admin/conflicts/{case.id}/photos/collection")
    assert resp.status_code == 404


def test_only_the_reviewing_admin_can_reassess(monkeypatch):
    scheduled = []
    monkeypatch.setattr(conflicts.scheduler, "schedule_ai_reassessment", lambda case_id: scheduled.append(case_id))
    case = _case()
    db = FakeDb(case)
    resp = _client(db).post(f"/api/v1/admin/conflicts/{case.id}/reassess", headers=OTHER)
    assert resp.status_code == 409
    assert scheduled == []
    assert db.added == []


def test_reassess_queues_a_job_and_records_an_audit_row(monkeypatch):
    scheduled = []
    monkeypatch.setattr(conflicts.scheduler, "schedule_ai_reassessment", lambda case_id: scheduled.append(case_id))
    case = _case()
    db = FakeDb(case)
    resp = _client(db).post(f"/api/v1/admin/conflicts/{case.id}/reassess", headers=ADMIN)
    assert resp.status_code == 202
    assert scheduled == [str(case.id)]
    assert db.committed is True
    assert [(row.action, row.admin_id, row.target_id) for row in db.added] == [
        ("reassess_conflict", "admin-sahana", str(case.id))
    ]


class _Session:
    def __init__(self, case, writes):
        self.case = case
        self.writes = writes

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def get(self, model, case_id):
        return self.case

    async def execute(self, stmt):
        self.writes.append(stmt)
        return None

    async def commit(self):
        self.writes.append("commit")


@pytest.mark.asyncio
async def test_a_failed_rerun_keeps_the_previous_verdict(monkeypatch):
    case = _case()
    writes = []
    monkeypatch.setattr(conflict_jobs, "SessionLocal", lambda: _Session(case, writes))

    async def fetch_evidence(order_id, refs):
        return [EvidencePhoto("collection", "image/jpeg", b"a")]

    async def recommend(photos, comment):
        return None

    monkeypatch.setattr(conflict_jobs.order_photos, "fetch_evidence", fetch_evidence)
    monkeypatch.setattr(conflict_jobs.ai_client, "get_fault_recommendation", recommend)

    await conflict_jobs.rerun_ai_evaluation(str(case.id))
    assert writes == []
    assert case.ai_fault_party == FaultParty.courier


@pytest.mark.asyncio
async def test_a_successful_rerun_replaces_the_verdict_without_leaving_review(monkeypatch):
    case = _case()
    writes = []
    monkeypatch.setattr(conflict_jobs, "SessionLocal", lambda: _Session(case, writes))

    async def fetch_evidence(order_id, refs):
        return [EvidencePhoto("collection", "image/jpeg", b"a")]

    async def recommend(photos, comment):
        return AIRecommendation("requester", 0.91, "damage is new")

    monkeypatch.setattr(conflict_jobs.order_photos, "fetch_evidence", fetch_evidence)
    monkeypatch.setattr(conflict_jobs.ai_client, "get_fault_recommendation", recommend)

    await conflict_jobs.rerun_ai_evaluation(str(case.id))
    assert writes[-1] == "commit"
    assigned = {column.key: bind.value for column, bind in writes[0]._values.items()}
    assert assigned["ai_fault_party"] == FaultParty.requester
    assert assigned["ai_confidence"] == 0.91
    assert assigned["ai_reasoning"] == "damage is new"
    assert "status" not in assigned
