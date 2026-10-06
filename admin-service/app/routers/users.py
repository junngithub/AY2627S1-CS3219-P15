import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.security import AdminDep, CurrentAdmin
from app.database import get_db
from app.schemas.admin import ActionResult, UserListResponse
from app.services import audit
from app.services import kafka_producer

router = APIRouter(prefix="/api/v1/admin/users", tags=["admin-users"])


@router.get("", response_model=UserListResponse)
async def list_users(search: str = "", page: int = 1, admin: CurrentAdmin = AdminDep):
    # NFR1.1 — delegate the actual search to User Service; Admin Service doesn't own user data.
    async with httpx.AsyncClient(base_url=settings.user_service_base_url) as client:
        resp = await client.get("/api/v1/user/search", params={"q": search, "page": page})
    resp.raise_for_status()
    return resp.json()


@router.post("/{user_id}/promote", response_model=ActionResult)
async def promote_user(user_id: str, admin: CurrentAdmin = AdminDep, db: AsyncSession = Depends(get_db)):
    # F1.1.1 — target must exist/be validated via User Service; that check happens
    # inside User Service's own promote endpoint, we just relay the call.
    async with httpx.AsyncClient(base_url=settings.user_service_base_url) as client:
        resp = await client.post(f"/api/v1/user/{user_id}/role", json={"role": "admin"})
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail="User Service rejected promotion")

    await audit.record(db, admin_id=admin.user_id, action="promote", target_id=user_id)
    await db.commit()
    await kafka_producer.publish_user_promoted(user_id=user_id, admin_id=admin.user_id)

    return ActionResult(user_id=user_id, action="promote", propagated=True)


@router.post("/{user_id}/demote", response_model=ActionResult)
async def demote_user(user_id: str, admin: CurrentAdmin = AdminDep, db: AsyncSession = Depends(get_db)):
    # Guard: an admin can't demote themselves, so the platform can't end up with zero admins by accident.
    if user_id == admin.user_id:
        raise HTTPException(status_code=400, detail="Admins cannot demote themselves")

    # User Service owns roles; it validates the target exists and applies the change.
    async with httpx.AsyncClient(base_url=settings.user_service_base_url) as client:
        resp = await client.post(f"/api/v1/user/{user_id}/role", json={"role": "user"})
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail="User Service rejected demotion")

    await audit.record(db, admin_id=admin.user_id, action="demote", target_id=user_id)
    await db.commit()
    await kafka_producer.publish_user_demoted(user_id=user_id, admin_id=admin.user_id)
    return ActionResult(user_id=user_id, action="demote", propagated=True)


@router.post("/{user_id}/suspend", response_model=ActionResult)
async def suspend_user(user_id: str, admin: CurrentAdmin = AdminDep, db: AsyncSession = Depends(get_db)):
    # F1.2.1 — must take effect within 60s; the sync call below is what gives us that bound.
    async with httpx.AsyncClient(base_url=settings.user_service_base_url) as client:
        resp = await client.post(f"/api/v1/user/{user_id}/status", json={"status": "suspended"})
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail="User Service rejected suspension")

    await audit.record(db, admin_id=admin.user_id, action="suspend", target_id=user_id)
    await db.commit()
    await kafka_producer.publish_user_suspended(user_id=user_id, admin_id=admin.user_id)
    return ActionResult(user_id=user_id, action="suspend", propagated=True)


@router.post("/{user_id}/reinstate", response_model=ActionResult)
async def reinstate_user(user_id: str, admin: CurrentAdmin = AdminDep, db: AsyncSession = Depends(get_db)):
    async with httpx.AsyncClient(base_url=settings.user_service_base_url) as client:
        resp = await client.post(f"/api/v1/user/{user_id}/status", json={"status": "verified"})
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail="User Service rejected reinstatement")

    # F1.3.2 — reinstatement specifically called out as needing admin ID + timestamp.
    await audit.record(db, admin_id=admin.user_id, action="reinstate", target_id=user_id)
    await db.commit()
    await kafka_producer.publish_user_reinstated(user_id=user_id, admin_id=admin.user_id)
    return ActionResult(user_id=user_id, action="reinstate", propagated=True)
