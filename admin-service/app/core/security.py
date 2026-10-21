import httpx
from fastapi import Depends, HTTPException, Request

from app.config import settings


class CurrentAdmin:
    def __init__(self, user_id: str, email: str):
        self.user_id = user_id
        self.email = email


async def require_admin(request: Request) -> CurrentAdmin:
    """
    F2.1 — validated on every request, not cached from login.
    F2.2/F2.2.1 — non-admins get 404, never 403, so the endpoint's existence
    isn't revealed to a non-admin caller.
    """
    token = request.headers.get("Authorization")
    if not token:
        raise HTTPException(status_code=404)  # deliberate: same as "not admin"

    async with httpx.AsyncClient(base_url=settings.user_service_base_url, timeout=5.0) as client:
        try:
            resp = await client.get("/api/v1/user/me/authorize", headers={"Authorization": token})
        except httpx.RequestError:
            # Fail closed — an unreachable User Service must not grant admin access.
            raise HTTPException(status_code=404)

    if resp.status_code != 200:
        raise HTTPException(status_code=404)

    payload = resp.json()
    if payload.get("role") != "admin":
        raise HTTPException(status_code=404)  # F2.2.1

    return CurrentAdmin(user_id=payload["userId"], email=payload["email"])


AdminDep = Depends(require_admin)
