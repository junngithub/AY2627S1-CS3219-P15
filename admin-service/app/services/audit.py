from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import AuditLog


async def record(db: AsyncSession, *, admin_id: str, action: str, target_id: str, detail: str | None = None) -> None:
    """
    Every privileged action funnels through here (NFR2.1). Never call
    db.execute(update(...)) or delete against AuditLog anywhere else —
    that invariant only holds if this is the single write path.
    """
    db.add(AuditLog(admin_id=admin_id, action=action, target_id=target_id, detail=detail))
    await db.flush()
