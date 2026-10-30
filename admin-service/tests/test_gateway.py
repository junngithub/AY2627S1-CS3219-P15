from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.core.security import require_admin

app = FastAPI()


@app.get("/protected")
async def protected(admin=Depends(require_admin)):
    return {"userId": admin.user_id}


client = TestClient(app)

ADMIN = {
    "x-user-id": "7f3c2a1e-0b4d-4c8a-9e21-5d6f7a8b9c0d",
    "x-is-admin": "true",
    "x-permitted-action": "true",
}


def test_missing_identity_is_hidden():
    assert client.get("/protected").status_code == 404


def test_non_admin_is_hidden():
    resp = client.get("/protected", headers={
        "x-user-id": ADMIN["x-user-id"],
        "x-is-admin": "false",
        "x-permitted-action": "true",
    })
    assert resp.status_code == 404


def test_unverified_admin_is_hidden():
    resp = client.get("/protected", headers={
        "x-user-id": ADMIN["x-user-id"],
        "x-is-admin": "true",
        "x-permitted-action": "false",
    })
    assert resp.status_code == 404


def test_blank_user_id_is_hidden():
    resp = client.get("/protected", headers={
        "x-user-id": "   ",
        "x-is-admin": "true",
        "x-permitted-action": "true",
    })
    assert resp.status_code == 404


def test_verified_admin_is_accepted_with_gateway_header_casing():
    resp = client.get("/protected", headers={
        "X-User-Id": f" {ADMIN['x-user-id']} ",
        "X-Is-Admin": " TRUE ",
        "X-Permitted-Action": " TRUE ",
    })
    assert resp.status_code == 200
    assert resp.json() == {"userId": ADMIN["x-user-id"]}
