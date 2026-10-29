"""Report and appeal queues. The database is in memory; User Service is stubbed."""

import uuid
from datetime import datetime, timezone

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.sql.dml import Update

from app.database import get_db
from app.models.audit_log import AuditLog
from app.models.moderation import AppealStatus, ReportStatus, SuspensionAppeal, UserReport
from app.routers import moderation, users

ADMIN = {
    "x-user-id": "admin-sahana",
    "x-is-admin": "true",
    "x-permitted-action": "true",
}


def _norm(value):
    return value.value if hasattr(value, "value") and not isinstance(value, uuid.UUID) else value


def _pairs(clause):
    if clause is None:
        return []
    nested = getattr(clause, "clauses", None)
    if nested is not None and not hasattr(clause, "left"):
        pairs = []
        for part in nested:
            pairs.extend(_pairs(part))
        return pairs
    return [(clause.left.key, clause.right.value)]


def _match(row, clause) -> bool:
    return all(_norm(getattr(row, key)) == _norm(value) for key, value in _pairs(clause))


class _Result:
    def __init__(self, rows):
        self._rows = rows
        self.rowcount = len(rows)

    def scalars(self):
        return self

    def all(self):
        return list(self._rows)

    def first(self):
        return self._rows[0] if self._rows else None


class MemSession:
    def __init__(self):
        self.reports: list[UserReport] = []
        self.appeals: list[SuspensionAppeal] = []
        self.audits: list[AuditLog] = []
        self._new: list = []
        self.hide_open = False

    def add(self, obj) -> None:
        self._new.append(obj)

    def _bucket(self, obj) -> list:
        if isinstance(obj, UserReport):
            return self.reports
        if isinstance(obj, SuspensionAppeal):
            return self.appeals
        if isinstance(obj, AuditLog):
            return self.audits
        raise AssertionError(type(obj))

    def _persist(self) -> None:
        for obj in self._new:
            if getattr(obj, "id", None) is None:
                obj.id = uuid.uuid4()
            bucket = self._bucket(obj)
            if obj not in bucket:
                bucket.append(obj)
        self._new.clear()

    async def flush(self) -> None:
        self._persist()

    async def commit(self) -> None:
        if self.hide_open:
            raise IntegrityError("duplicate", {}, Exception("duplicate"))
        self._persist()

    async def rollback(self) -> None:
        self._new.clear()
        self.hide_open = False

    def _rows(self, name: str) -> list:
        return {
            "user_reports": self.reports,
            "suspension_appeals": self.appeals,
            "audit_logs": self.audits,
        }[name]

    def _from_name(self, stmt) -> str:
        if isinstance(stmt, Update):
            return stmt.table.name
        return stmt.get_final_froms()[0].name

    async def scalar(self, stmt):
        if self.hide_open:
            return None
        rows = [row for row in self._rows(self._from_name(stmt)) if _match(row, stmt.whereclause)]
        return rows[0] if rows else None

    async def execute(self, stmt):
        rows = [row for row in self._rows(self._from_name(stmt)) if _match(row, stmt.whereclause)]
        if isinstance(stmt, Update):
            for row in rows:
                for column, bind in stmt._values.items():
                    setattr(row, column.key, bind.value)
            return _Result([(row.id,) for row in rows])
        return _Result(rows)

    async def get(self, model, ident):
        for row in self._rows(model.__tablename__):
            if row.id == ident:
                return row
        return None


@pytest.fixture
def api():
    session = MemSession()
    app = FastAPI()
    app.include_router(users.router)
    app.include_router(moderation.reports)
    app.include_router(moderation.appeals)

    async def _db():
        yield session

    app.dependency_overrides[get_db] = _db
    with TestClient(app) as client:
        yield client, session


def test_a_user_cannot_report_themselves(api):
    client, _session = api
    resp = client.post(
        "/api/v1/admin/reports",
        json={"reporterUserId": " u-1 ", "reportedUserId": "u-1", "comment": "me"},
    )
    assert resp.status_code == 422
    assert "themselves" in resp.text


def test_open_report_is_reused_and_dismiss_does_not_block_another(api):
    client, session = api
    body = {"reporterUserId": "u-1", "reportedUserId": "u-2", "comment": "first"}
    opened = client.post("/api/v1/admin/reports", json=body)
    assert opened.status_code == 201
    report_id = opened.json()["id"]

    again = client.post("/api/v1/admin/reports", json={**body, "comment": "second"})
    assert again.status_code == 201
    assert again.json()["id"] == report_id
    assert again.json()["comment"] == "first"

    hidden = client.get("/api/v1/admin/reports")
    assert hidden.status_code == 404

    listed = client.get("/api/v1/admin/reports", headers=ADMIN)
    assert listed.status_code == 200
    assert [row["id"] for row in listed.json()] == [report_id]

    dismissed = client.post(f"/api/v1/admin/reports/{report_id}/dismiss", headers=ADMIN)
    assert dismissed.status_code == 200
    assert dismissed.json()["status"] == "dismissed"
    assert dismissed.json()["closed_by_admin_id"] == ADMIN["x-user-id"]
    assert [row.action for row in session.audits] == ["dismiss_report"]

    blocked = client.post(f"/api/v1/admin/reports/{report_id}/dismiss", headers=ADMIN)
    assert blocked.status_code == 409

    missing = client.post(f"/api/v1/admin/reports/{uuid.uuid4()}/dismiss", headers=ADMIN)
    assert missing.status_code == 404

    reopened = client.post("/api/v1/admin/reports", json=body)
    assert reopened.status_code == 201
    assert reopened.json()["id"] != report_id
    assert reopened.json()["status"] == "open"


def test_duplicate_open_report_returns_the_row_that_won_the_race(api):
    client, session = api
    winner = UserReport(
        id=uuid.uuid4(),
        reporter_user_id="u-1",
        reported_user_id="u-2",
        comment="already stored",
        status=ReportStatus.open,
        created_at=datetime.now(timezone.utc),
    )
    session.reports.append(winner)
    session.hide_open = True

    resp = client.post(
        "/api/v1/admin/reports",
        json={"reporterUserId": "u-1", "reportedUserId": "u-2", "comment": "late"},
    )
    assert resp.status_code == 201
    assert resp.json()["id"] == str(winner.id)
    assert resp.json()["comment"] == "already stored"
    assert session.reports == [winner]


def test_suspend_actions_only_open_reports_against_that_user(api, monkeypatch):
    client, session = api
    mode = {"ok": False}

    async def user_call(*_args, **_kwargs):
        code = 200 if mode["ok"] else 409
        return httpx.Response(code, json={"changed": code == 200})

    async def quiet(**_kwargs):
        return None

    monkeypatch.setattr(users, "_user_call", user_call)
    monkeypatch.setattr(users.kafka_producer, "publish_user_suspended", quiet)

    def seed(reported, status):
        row = UserReport(
            id=uuid.uuid4(),
            reporter_user_id="u-1",
            reported_user_id=reported,
            comment="x",
            status=status,
            created_at=datetime.now(timezone.utc),
        )
        session.reports.append(row)
        return row

    open_target = seed("u-2", ReportStatus.open)
    other = seed("u-9", ReportStatus.open)
    already = seed("u-2", ReportStatus.dismissed)

    denied = client.post("/api/v1/admin/users/u-2/suspend", headers=ADMIN)
    assert denied.status_code == 409
    assert open_target.status is ReportStatus.open
    assert session.audits == []

    mode["ok"] = True
    suspended = client.post("/api/v1/admin/users/u-2/suspend", headers=ADMIN)
    assert suspended.status_code == 200
    assert open_target.status is ReportStatus.actioned
    assert open_target.closed_by_admin_id == ADMIN["x-user-id"]
    assert other.status is ReportStatus.open
    assert already.status is ReportStatus.dismissed
    assert [row.action for row in session.audits] == ["suspend"]


def test_appeal_reject_leaves_it_closed_and_reinstate_closes_the_open_one(api, monkeypatch):
    client, session = api
    opened = client.post("/api/v1/admin/appeals", json={"userId": "u-2", "message": "first"})
    assert opened.status_code == 201
    appeal_id = opened.json()["id"]

    again = client.post("/api/v1/admin/appeals", json={"userId": "u-2", "message": "second"})
    assert again.json()["id"] == appeal_id
    assert again.json()["message"] == "first"

    unknown = client.get("/api/v1/admin/appeals?status=nope", headers=ADMIN)
    assert unknown.status_code == 422

    rejected = client.post(f"/api/v1/admin/appeals/{appeal_id}/reject", headers=ADMIN)
    assert rejected.status_code == 200
    assert rejected.json()["status"] == "rejected"
    assert [row.action for row in session.audits] == ["reject_appeal"]

    fresh = client.post("/api/v1/admin/appeals", json={"userId": "u-2", "message": "again"})
    assert fresh.status_code == 201
    assert fresh.json()["id"] != appeal_id

    async def accepted(*_args, **_kwargs):
        return httpx.Response(200, json={"changed": True})

    async def quiet(**_kwargs):
        return None

    monkeypatch.setattr(users, "_user_call", accepted)
    monkeypatch.setattr(users.kafka_producer, "publish_user_reinstated", quiet)

    reinstated = client.post("/api/v1/admin/users/u-2/reinstate", headers=ADMIN)
    assert reinstated.status_code == 200
    open_row = next(row for row in session.appeals if str(row.id) == fresh.json()["id"])
    kept = next(row for row in session.appeals if str(row.id) == appeal_id)
    assert open_row.status is AppealStatus.reinstated
    assert kept.status is AppealStatus.rejected
