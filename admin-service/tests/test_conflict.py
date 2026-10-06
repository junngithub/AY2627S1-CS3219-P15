"""Live checks against the Compose stack: conflict HTTP routes, their error
responses, and the Kafka event that a successful call publishes.

Skipped when Admin Service is not reachable. Requires Kafka in this compose
project (events are read with the broker's console consumer, because the
broker advertises kafka:9092). Intake uses X-Service-Token dev-service-token,
matching SERVICE_API_KEY in docker-compose.yml.

Claim and resolve do not wait on the vision model. After intake, the case is
seeded in Postgres. The evaluation job only writes while a case is still
`created`, so a seeded `ai_evaluated` or `ai_failed` row stays put.
"""

import json
import subprocess
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[1]
ADMIN_HEADERS = {"Authorization": "Bearer admin-sahana"}
OTHER_ADMIN_HEADERS = {"Authorization": "Bearer admin-other"}
USER_HEADERS = {"Authorization": "Bearer user-1"}
SERVICE_HEADERS = {"X-Service-Token": "dev-service-token"}

_MISSING = str(uuid.uuid4())
CONFLICT_ROUTES = [
    ("GET", "/api/v1/admin/conflicts"),
    ("GET", f"/api/v1/admin/conflicts/{_MISSING}"),
    ("POST", f"/api/v1/admin/conflicts/{_MISSING}/review"),
    ("POST", f"/api/v1/admin/conflicts/{_MISSING}/resolve"),
]
RESOLVE_BODY = {"faultParty": "courier", "decision": "accept"}


def _compose_exec(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["docker", "compose", "exec", "-T", "kafka", *args],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=40,
        check=False,
    )


def kafka_events(topic: str) -> list[dict]:
    """Read every message currently on a topic. Missing topics count as empty.

    Uses a partition read rather than a consumer group. A group consumer spends
    its first seconds joining, and a short timeout returns nothing even when
    the topic has messages.
    """
    offsets = _compose_exec("kafka-get-offsets", "--bootstrap-server", "kafka:9092", "--topic", topic)
    if offsets.returncode != 0:
        blob = f"{offsets.stderr}\n{offsets.stdout}".lower()
        if "unknown topic" in blob or "does not exist" in blob:
            return []
        pytest.fail(offsets.stderr or offsets.stdout or f"could not read offsets for {topic}")

    events = []
    for line in offsets.stdout.splitlines():
        try:
            _name, partition, end = line.strip().rsplit(":", 2)
        except ValueError:
            continue
        if not end.isdigit() or int(end) == 0:
            continue
        consumed = _compose_exec(
            "kafka-console-consumer",
            "--bootstrap-server", "kafka:9092",
            "--topic", topic,
            "--partition", partition,
            "--offset", "earliest",
            "--max-messages", end,
        )
        if consumed.returncode != 0 and not consumed.stdout.strip():
            pytest.fail(consumed.stderr or consumed.stdout or f"could not read {topic}")
        for raw in consumed.stdout.splitlines():
            raw = raw.strip()
            if raw.startswith("{"):
                events.append(json.loads(raw))
    return events


def events_for(topic: str, **payload) -> list[dict]:
    return [
        event for event in kafka_events(topic)
        if all(event.get("payload", {}).get(key) == value for key, value in payload.items())
    ]


def assert_envelope(event: dict, event_type: str, **payload) -> None:
    assert event["eventType"] == event_type
    assert event["version"] == 1
    assert event["eventId"]
    assert event["timestamp"]
    for key, value in payload.items():
        assert event["payload"][key] == value


def psql(sql: str) -> str:
    result = subprocess.run(
        [
            "docker", "compose", "exec", "-T", "db",
            "psql", "-U", "admin", "-d", "admin_service",
            "-v", "ON_ERROR_STOP=1", "-tA", "-c", sql,
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if result.returncode != 0:
        pytest.fail(result.stderr or result.stdout or sql)
    # RETURNING still prints a command tag ("UPDATE 1") after the row.
    lines = [line for line in result.stdout.splitlines() if line.strip() and not line.startswith("UPDATE ")]
    return "\n".join(lines)


def create_case(api, photos=None, order_id=None) -> dict:
    body = {
        "orderId": order_id or f"ord-{uuid.uuid4()}",
        "reporterUserId": "u-1",
        "comment": "Item arrived damaged",
    }
    if photos is not None:
        body["photos"] = photos
    resp = api.post("/api/v1/admin/conflicts", json=body, headers=SERVICE_HEADERS)
    assert resp.status_code == 201, resp.text
    return resp.json()


def seed_case(case_id: str, status: str, fault: str | None = None, confidence: float | None = None) -> None:
    if status == "created":
        _wait_until_job_finished(case_id)
    case_uuid = uuid.UUID(case_id)
    assignments = [f"status = '{status}'::conflictstatus"]
    if status in ("ai_evaluated", "ai_failed", "under_review"):
        party_sql = "NULL" if fault is None else f"'{fault}'::faultparty"
        confidence_sql = "NULL" if confidence is None else str(float(confidence))
        assignments.append(f"ai_fault_party = {party_sql}")
        assignments.append(f"ai_confidence = {confidence_sql}")
    updated = psql(
        f"UPDATE conflict_cases SET {', '.join(assignments)} WHERE id = '{case_uuid}' RETURNING status"
    )
    assert updated == status, updated


def _wait_until_job_finished(case_id: str) -> None:
    """The one-off job can still overwrite `created`. Wait until it has left that status."""
    deadline = time.time() + 30
    case_uuid = uuid.UUID(case_id)
    while time.time() < deadline:
        status = psql(f"SELECT status FROM conflict_cases WHERE id = '{case_uuid}'")
        if status and status != "created":
            return
        time.sleep(0.4)
    pytest.fail(f"case {case_id} stayed created, so a later seed could be overwritten")


def audit_rows(case_id: str, action: str) -> list[str]:
    raw = psql(
        "SELECT admin_id || chr(9) || coalesce(detail, '') FROM audit_logs "
        f"WHERE target_id = '{uuid.UUID(case_id)}' AND action = '{action}' ORDER BY created_at"
    )
    return [line for line in raw.splitlines() if line]


def timer_ids(case_id: str) -> list[str]:
    raw = psql(
        "SELECT id FROM apscheduler_jobs "
        f"WHERE id IN ('deadline-{case_id}', 'reminder-{case_id}') ORDER BY id"
    )
    return [line for line in raw.splitlines() if line]


@pytest.mark.parametrize("method,path", CONFLICT_ROUTES)
@pytest.mark.parametrize("headers", [None, USER_HEADERS, SERVICE_HEADERS])
def test_conflict_routes_are_hidden_without_admin(api, method, path, headers):
    resp = api.request(method, path, headers=headers, json=RESOLVE_BODY)
    assert resp.status_code == 404


@pytest.mark.parametrize("headers", [None, {"X-Service-Token": "nope"}, ADMIN_HEADERS])
def test_intake_rejects_non_service_callers(api, headers):
    order_id = f"ord-{uuid.uuid4()}"
    body = {
        "orderId": order_id,
        "reporterUserId": "u-1",
        "comment": "Item arrived damaged",
        "photos": ["https://example.com/before.jpg"],
    }
    resp = api.post("/api/v1/admin/conflicts", json=body, headers=headers)
    assert resp.status_code == 404
    assert events_for("admin.conflict-case-created", orderId=order_id) == []


@pytest.mark.parametrize("missing", ["orderId", "reporterUserId", "comment"])
def test_intake_rejects_incomplete_body(api, missing):
    body = {
        "orderId": f"ord-{uuid.uuid4()}",
        "reporterUserId": "u-1",
        "comment": "Item arrived damaged",
    }
    order_id = body["orderId"]
    del body[missing]
    resp = api.post("/api/v1/admin/conflicts", json=body, headers=SERVICE_HEADERS)
    assert resp.status_code == 422
    assert events_for("admin.conflict-case-created", orderId=order_id) == []


def test_create_without_photos(api):
    created = create_case(api)
    assert created["status"] == "created"
    assert created["evidence_photo_urls"] == []


def test_conflict_lifecycle_publishes_events(api):
    order_id = f"ord-{uuid.uuid4()}"
    body = {
        "orderId": order_id,
        "reporterUserId": "u-1",
        "comment": "Item arrived damaged",
        "photos": ["https://example.com/before.jpg", "https://example.com/after.jpg"],
    }
    created = api.post("/api/v1/admin/conflicts", json=body, headers=SERVICE_HEADERS)
    assert created.status_code == 201, created.text
    case = created.json()
    case_id = case["id"]
    assert case["order_id"] == order_id
    assert case["status"] == "created"
    assert case["comment"] == body["comment"]
    assert case["reporter_user_id"] == "u-1"

    again = api.post("/api/v1/admin/conflicts", json=body, headers=SERVICE_HEADERS)
    assert again.status_code == 201
    assert again.json()["id"] == case_id
    created_events = events_for("admin.conflict-case-created", orderId=order_id)
    assert len(created_events) == 1
    assert_envelope(created_events[0], "ConflictCaseCreated", orderId=order_id, caseId=case_id)

    missing_id = str(uuid.uuid4())
    assert api.get(f"/api/v1/admin/conflicts/{missing_id}", headers=ADMIN_HEADERS).status_code == 404
    assert api.post(f"/api/v1/admin/conflicts/{missing_id}/review", headers=ADMIN_HEADERS).status_code == 404
    assert api.post(
        f"/api/v1/admin/conflicts/{missing_id}/resolve",
        headers=ADMIN_HEADERS,
        json=RESOLVE_BODY,
    ).status_code == 404
    assert api.get("/api/v1/admin/conflicts/not-a-uuid", headers=ADMIN_HEADERS).status_code == 422
    assert api.get("/api/v1/admin/conflicts", params={"status": "nope"}, headers=ADMIN_HEADERS).status_code == 422

    seed_case(case_id, "ai_evaluated", fault="requester", confidence=0.4)
    too_early = api.post(f"/api/v1/admin/conflicts/{case_id}/resolve", headers=ADMIN_HEADERS, json=RESOLVE_BODY)
    assert too_early.status_code == 409

    claimed = api.post(f"/api/v1/admin/conflicts/{case_id}/review", headers=ADMIN_HEADERS)
    assert claimed.status_code == 200, claimed.text
    assert claimed.json()["status"] == "under_review"
    assert claimed.json()["order_id"] == order_id
    assert claimed.json()["review_started_by_admin_id"] == "admin-sahana"
    assert claimed.json()["review_started_at"]

    reclaim = api.post(f"/api/v1/admin/conflicts/{case_id}/review", headers=ADMIN_HEADERS)
    assert reclaim.status_code == 200
    assert reclaim.json()["review_started_by_admin_id"] == "admin-sahana"
    stolen = api.post(f"/api/v1/admin/conflicts/{case_id}/review", headers=OTHER_ADMIN_HEADERS)
    assert stolen.status_code == 409
    assert audit_rows(case_id, "review_conflict") == ["admin-sahana\t"]

    review_events = events_for("admin.order-under-review", orderId=order_id)
    assert len(review_events) == 1
    assert_envelope(review_events[0], "OrderUnderReview", orderId=order_id, caseId=case_id)

    assert timer_ids(case_id) == [f"deadline-{case_id}", f"reminder-{case_id}"]
    resolved = api.post(f"/api/v1/admin/conflicts/{case_id}/resolve", headers=ADMIN_HEADERS, json=RESOLVE_BODY)
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["resolved_fault_party"] == "courier"
    assert resolved.json()["resolved_automatically"] is False

    detail = api.get(f"/api/v1/admin/conflicts/{case_id}", headers=ADMIN_HEADERS)
    assert detail.status_code == 200
    body_detail = detail.json()
    assert body_detail["status"] == "resolved"
    assert body_detail["resolved_by_admin_id"] == "admin-sahana"
    assert body_detail["resolved_fault_party"] == "courier"
    assert body_detail["resolved_at"]
    assert body_detail["evidence_photo_urls"] == body["photos"]
    assert audit_rows(case_id, "resolve_conflict") == ["admin-sahana\tdecision=accept, fault_party=courier"]
    assert timer_ids(case_id) == []

    listed = api.get("/api/v1/admin/conflicts", params={"status": "resolved"}, headers=ADMIN_HEADERS)
    assert listed.status_code == 200
    assert any(row["id"] == case_id for row in listed.json())

    again_resolve = api.post(
        f"/api/v1/admin/conflicts/{case_id}/resolve",
        headers=ADMIN_HEADERS,
        json={"faultParty": "requester", "decision": "reject"},
    )
    assert again_resolve.status_code == 409
    resolved_events = events_for("admin.conflict-resolved", orderId=order_id)
    assert len(resolved_events) == 1
    assert_envelope(
        resolved_events[0],
        "ConflictResolved",
        orderId=order_id,
        caseId=case_id,
        faultParty="courier",
        resolvedAutomatically=False,
    )


def test_concurrent_create_publishes_one_event(api):
    order_id = f"ord-{uuid.uuid4()}"
    body = {
        "orderId": order_id,
        "reporterUserId": "u-1",
        "comment": "Item arrived damaged",
    }

    def post():
        with httpx.Client(base_url=str(api.base_url), timeout=20.0) as client:
            return client.post("/api/v1/admin/conflicts", json=body, headers=SERVICE_HEADERS)

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = [future.result() for future in (pool.submit(post), pool.submit(post))]
    assert [resp.status_code for resp in responses] == [201, 201]
    assert len({resp.json()["id"] for resp in responses}) == 1
    assert psql(f"SELECT count(*) FROM conflict_cases WHERE order_id = '{order_id}'") == "1"
    assert len(events_for("admin.conflict-case-created", orderId=order_id)) == 1


def test_list_filters_and_deadline_order(api):
    earlier = create_case(api)
    time.sleep(0.05)
    later = create_case(api)
    assert datetime.fromisoformat(earlier["resolution_deadline"]) < datetime.fromisoformat(later["resolution_deadline"])

    listed = api.get("/api/v1/admin/conflicts", headers=ADMIN_HEADERS)
    assert listed.status_code == 200, listed.text
    rows = listed.json()
    deadlines = [datetime.fromisoformat(row["resolution_deadline"]) for row in rows]
    assert deadlines == sorted(deadlines)
    positions = {row["id"]: index for index, row in enumerate(rows)}
    assert positions[earlier["id"]] < positions[later["id"]]

    evaluated = create_case(api)["id"]
    failed = create_case(api)["id"]
    still_created = create_case(api)["id"]
    seed_case(evaluated, "ai_evaluated", fault="courier", confidence=0.8)
    seed_case(failed, "ai_failed")
    seed_case(still_created, "created")

    def ids_for(status: str, expected: str) -> set[str]:
        resp = api.get("/api/v1/admin/conflicts", params={"status": status}, headers=ADMIN_HEADERS)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert all(row["status"] == expected for row in body)
        return {row["id"] for row in body}

    assert evaluated in ids_for("ai_evaluated", "ai_evaluated")
    assert evaluated in ids_for("pending", "ai_evaluated")
    assert failed not in ids_for("pending", "ai_evaluated")
    assert failed in ids_for("ai_failed", "ai_failed")
    assert failed in ids_for("non_deadline", "ai_failed")
    assert still_created in ids_for("created", "created")


def test_detail_returns_the_report(api):
    photos = ["https://example.com/before.jpg"]
    created = create_case(api, photos=photos)
    detail = api.get(f"/api/v1/admin/conflicts/{created['id']}", headers=ADMIN_HEADERS)
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body["comment"] == "Item arrived damaged"
    assert body["evidence_photo_urls"] == photos
    assert body["reporter_user_id"] == "u-1"
    assert body["order_id"] == created["order_id"]
    assert body["created_at"]
    assert body["resolution_deadline"]
    assert body["resolved_at"] is None
    assert body["resolved_automatically"] is False


@pytest.mark.parametrize("status", ["created", "resolved"])
def test_cannot_claim_from_the_wrong_status(api, status):
    case_id = create_case(api)["id"]
    seed_case(case_id, status)
    resp = api.post(f"/api/v1/admin/conflicts/{case_id}/review", headers=ADMIN_HEADERS)
    assert resp.status_code == 409
    assert status in resp.json()["detail"]
    assert events_for("admin.order-under-review", caseId=case_id) == []


def test_claim_from_ai_failed_publishes_order_under_review(api):
    created = create_case(api)
    case_id = created["id"]
    seed_case(case_id, "ai_failed")
    claimed = api.post(f"/api/v1/admin/conflicts/{case_id}/review", headers=ADMIN_HEADERS)
    assert claimed.status_code == 200, claimed.text
    assert claimed.json()["status"] == "under_review"
    assert claimed.json()["review_started_by_admin_id"] == "admin-sahana"
    listed = api.get("/api/v1/admin/conflicts", params={"status": "under_review"}, headers=ADMIN_HEADERS)
    assert listed.status_code == 200
    assert any(row["id"] == case_id for row in listed.json())
    matched = events_for("admin.order-under-review", caseId=case_id)
    assert len(matched) == 1
    assert_envelope(matched[0], "OrderUnderReview", orderId=created["order_id"], caseId=case_id)


def test_simultaneous_claim_publishes_one_event(api):
    created = create_case(api)
    case_id = created["id"]
    seed_case(case_id, "ai_evaluated", fault="courier", confidence=0.6)
    path = f"/api/v1/admin/conflicts/{case_id}/review"

    def post(headers):
        with httpx.Client(base_url=str(api.base_url), timeout=20.0) as client:
            return client.post(path, headers=headers)

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = [future.result() for future in (pool.submit(post, ADMIN_HEADERS), pool.submit(post, OTHER_ADMIN_HEADERS))]
    assert sorted(resp.status_code for resp in responses) == [200, 409]
    assert audit_rows(case_id, "review_conflict") in (["admin-sahana\t"], ["admin-other\t"])
    matched = events_for("admin.order-under-review", caseId=case_id)
    assert len(matched) == 1
    assert_envelope(matched[0], "OrderUnderReview", orderId=created["order_id"], caseId=case_id)


@pytest.mark.parametrize(
    "payload",
    [
        {"decision": "accept"},
        {"faultParty": "courier"},
        {"faultParty": "courier", "decision": "maybe"},
        {"faultParty": "someone", "decision": "accept"},
        {"faultParty": "no_fault", "decision": "accept"},
    ],
)
def test_resolve_rejects_invalid_body(api, payload):
    case_id = create_case(api)["id"]
    seed_case(case_id, "under_review", fault="courier", confidence=0.5)
    resp = api.post(f"/api/v1/admin/conflicts/{case_id}/resolve", headers=ADMIN_HEADERS, json=payload)
    assert resp.status_code == 422
    assert events_for("admin.conflict-resolved", caseId=case_id) == []


@pytest.mark.parametrize("status", ["created", "ai_evaluated", "ai_failed", "resolved"])
def test_cannot_resolve_until_under_review(api, status):
    case_id = create_case(api)["id"]
    if status == "ai_evaluated":
        seed_case(case_id, status, fault="courier", confidence=0.5)
    elif status == "ai_failed":
        seed_case(case_id, status)
    else:
        seed_case(case_id, status)
    resp = api.post(f"/api/v1/admin/conflicts/{case_id}/resolve", headers=ADMIN_HEADERS, json=RESOLVE_BODY)
    assert resp.status_code == 409
    assert status in resp.json()["detail"]
    assert events_for("admin.conflict-resolved", caseId=case_id) == []


@pytest.mark.parametrize(
    "fault,decision",
    [
        ("requester", "reject"),
        ("no-fault", "accept"),
    ],
)
def test_resolve_publishes_the_fault_party_from_the_body(api, fault, decision):
    created = create_case(api)
    case_id = created["id"]
    seed_case(case_id, "ai_evaluated", fault="courier", confidence=0.2)
    claimed = api.post(f"/api/v1/admin/conflicts/{case_id}/review", headers=ADMIN_HEADERS)
    assert claimed.status_code == 200, claimed.text

    resolved = api.post(
        f"/api/v1/admin/conflicts/{case_id}/resolve",
        headers=ADMIN_HEADERS,
        json={"faultParty": fault, "decision": decision},
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["resolved_fault_party"] == fault
    assert resolved.json()["resolved_automatically"] is False
    detail = api.get(f"/api/v1/admin/conflicts/{case_id}", headers=ADMIN_HEADERS)
    assert detail.status_code == 200
    assert detail.json()["resolved_fault_party"] == fault
    assert detail.json()["resolved_by_admin_id"] == "admin-sahana"
    assert audit_rows(case_id, "resolve_conflict") == [f"admin-sahana\tdecision={decision}, fault_party={fault}"]

    again = api.post(
        f"/api/v1/admin/conflicts/{case_id}/resolve",
        headers=ADMIN_HEADERS,
        json={"faultParty": "courier", "decision": "accept"},
    )
    assert again.status_code == 409
    matched = events_for("admin.conflict-resolved", caseId=case_id)
    assert len(matched) == 1
    assert_envelope(
        matched[0],
        "ConflictResolved",
        orderId=created["order_id"],
        caseId=case_id,
        faultParty=fault,
        resolvedAutomatically=False,
    )
