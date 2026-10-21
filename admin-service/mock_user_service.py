"""
Minimal stand-in for User Service, just enough to unblock local testing of
Admin Service's `require_admin` dependency and the promote/suspend/reinstate
relay calls. NOT for production use — delete once the real User Service is
reachable, and point USER_SERVICE_BASE_URL at that instead.

Run standalone: uvicorn mock_user_service:app --port 8001
"""

from fastapi import FastAPI, Header, HTTPException

app = FastAPI(title="Mock User Service")

# Any bearer token starting with "admin-" is treated as an admin user;
# anything else is treated as a regular (non-admin) user.
ADMIN_TOKEN_PREFIX = "admin-"


@app.get("/api/v1/user/me/authorize")
async def authorize(authorization: str = Header(default="")):
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401)

    if token.startswith(ADMIN_TOKEN_PREFIX):
        return {"userId": token, "email": f"{token}@example.com", "role": "admin"}
    return {"userId": token, "email": f"{token}@example.com", "role": "user"}


@app.get("/api/v1/user/search")
async def search(q: str = "", page: int = 1):
    return {
        "items": [{"id": "u1", "name": "Test User", "email": "test@u.nus.edu", "role": "user", "status": "Verified"}],
        "page": page,
        "total": 1,
    }


def _missing(user_id: str) -> None:
    # Lets Admin Service tests exercise the "User Service rejected this" path.
    if user_id.startswith("missing-"):
        raise HTTPException(status_code=404, detail="user not found")


@app.post("/api/v1/user/{user_id}/role")
async def set_role(user_id: str, body: dict):
    _missing(user_id)
    return {"userId": user_id, "role": body.get("role")}


@app.post("/api/v1/user/{user_id}/status")
async def set_status(user_id: str, body: dict):
    _missing(user_id)
    return {"userId": user_id, "status": body.get("status")}
