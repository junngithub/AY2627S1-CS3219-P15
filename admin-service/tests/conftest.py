import os

import httpx
import pytest

BASE_URL = os.environ.get("ADMIN_API_BASE_URL", "http://localhost:8084")
ADMIN_HEADERS = {"Authorization": "Bearer admin-sahana"}
USER_HEADERS = {"Authorization": "Bearer user-1"}


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
