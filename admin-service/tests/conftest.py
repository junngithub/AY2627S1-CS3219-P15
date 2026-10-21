import os

import httpx
import pytest

BASE_URL = os.environ.get("ADMIN_API_BASE_URL", "http://localhost:8084")
ADMIN_HEADERS = {
    "x-user-id": "admin-sahana",
    "x-is-admin": "true",
    "x-permitted-action": "true",
}
USER_HEADERS = {
    "x-user-id": "user-1",
    "x-is-admin": "false",
    "x-permitted-action": "true",
}


@pytest.fixture(scope="session")
def api():
    with httpx.Client(base_url=BASE_URL, timeout=20.0) as client:
        try:
            resp = client.get("/health")
        except httpx.RequestError as exc:
            pytest.skip(f"Admin Service is not reachable at {BASE_URL}: {exc}")
        if resp.status_code != 200:
            pytest.skip(f"Admin Service /health returned {resp.status_code}")
        yield client
