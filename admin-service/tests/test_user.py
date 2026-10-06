"""Live checks against the Compose stack: admin user routes, their error
responses, and the Kafka event that a successful call publishes.

Skipped when Admin Service is not reachable. Requires Kafka in this compose
project (events are read with the broker's console consumer, because the
broker advertises kafka:9092). User ids prefixed with missing- are rejected
by the mock User Service.
"""

import json
import subprocess
import uuid
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
ADMIN_HEADERS = {"Authorization": "Bearer admin-sahana"}
USER_HEADERS = {"Authorization": "Bearer user-1"}

USER_ROUTES = [
    ("GET", "/api/v1/admin/users"),
    ("POST", "/api/v1/admin/users/u1/promote"),
    ("POST", "/api/v1/admin/users/u1/demote"),
    ("POST", "/api/v1/admin/users/u1/suspend"),
    ("POST", "/api/v1/admin/users/u1/reinstate"),
]


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


@pytest.mark.parametrize("method,path", USER_ROUTES)
@pytest.mark.parametrize("headers", [None, USER_HEADERS])
def test_user_routes_are_hidden_without_admin(api, method, path, headers):
    resp = api.request(method, path, headers=headers)
    assert resp.status_code == 404


def test_search_users(api):
    resp = api.get("/api/v1/admin/users", params={"search": "test", "page": 1}, headers=ADMIN_HEADERS)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["page"] == 1
    assert body["total"] == 1
    assert body["items"][0]["id"] == "u1"


def test_user_lifecycle_publishes_events(api):
    user_id = f"u-{uuid.uuid4()}"
    actions = [
        ("promote", "admin.user.promoted", "UserPromoted", "promotedBy"),
        ("demote", "admin.user.demoted", "UserDemoted", "demotedBy"),
        ("suspend", "admin.user.suspended", "UserSuspended", "suspendedBy"),
        ("reinstate", "admin.user.reinstated", "UserReinstated", "reinstatedBy"),
    ]
    for action, topic, event_type, actor_field in actions:
        resp = api.post(f"/api/v1/admin/users/{user_id}/{action}", headers=ADMIN_HEADERS)
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"user_id": user_id, "action": action, "propagated": True}
        matched = events_for(topic, userId=user_id)
        assert len(matched) == 1
        assert_envelope(matched[0], event_type, userId=user_id, **{actor_field: "admin-sahana"})


def test_admin_cannot_demote_self(api):
    before = events_for("admin.user.demoted", userId="admin-sahana")
    resp = api.post("/api/v1/admin/users/admin-sahana/demote", headers=ADMIN_HEADERS)
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Admins cannot demote themselves"
    assert events_for("admin.user.demoted", userId="admin-sahana") == before


@pytest.mark.parametrize("action", ["promote", "demote", "suspend", "reinstate"])
def test_user_service_rejection_publishes_nothing(api, action):
    user_id = f"missing-{uuid.uuid4()}"
    topic = {
        "promote": "admin.user.promoted",
        "demote": "admin.user.demoted",
        "suspend": "admin.user.suspended",
        "reinstate": "admin.user.reinstated",
    }[action]
    resp = api.post(f"/api/v1/admin/users/{user_id}/{action}", headers=ADMIN_HEADERS)
    assert resp.status_code == 404
    assert "rejected" in resp.json()["detail"].lower()
    assert events_for(topic, userId=user_id) == []
