import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import update

from app.database import SessionLocal
from app.models.conflict_case import ConflictCase, ConflictStatus, FaultParty
from app.services import ai_client, conflict_resolution

logger = logging.getLogger(__name__)


async def run_ai_evaluation(case_id: str) -> None:
    """
    Runs right after case creation (scheduled one-off job). created -> ai_evaluated | ai_failed.
    The network call happens with no DB session/transaction held open.
    """
    cid = uuid.UUID(case_id)
    async with SessionLocal() as db:
        case = await db.get(ConflictCase, cid)
        if not case or case.status != ConflictStatus.created:
            return  # idempotent: already evaluated (or gone)
        photos = case.evidence_photo_urls or []
        comment = case.comment

    rec = await ai_client.get_fault_recommendation(
        before_photo_url=photos[0] if photos else "",
        after_photo_url=photos[-1] if photos else "",
        comment=comment,
    )

    now = datetime.now(timezone.utc)
    if rec:
        values = dict(
            status=ConflictStatus.ai_evaluated,
            ai_fault_party=FaultParty(rec.fault_party),
            ai_confidence=rec.confidence,
            ai_reasoning=rec.reasoning,
            ai_completed_at=now,
        )
    else:
        # F3.2.1 — failure never blocks the case; admins handle it manually.
        values = dict(status=ConflictStatus.ai_failed, ai_completed_at=now)

    async with SessionLocal() as db:
        await db.execute(
            update(ConflictCase)
            .where(ConflictCase.id == cid, ConflictCase.status == ConflictStatus.created)
            .values(**values)
        )
        await db.commit()


async def send_deadline_reminder(case_id: str) -> None:
    """F3.7.1 — fires at a configurable interval before expiry."""
    async with SessionLocal() as db:
        case = await db.get(ConflictCase, uuid.UUID(case_id))
        if not case or case.status == ConflictStatus.resolved:
            return
        case.reminder_sent_at = datetime.now(timezone.utc)
        await db.commit()
        # TODO: push a notification to the admin queue (email, in-app, etc.)


async def auto_resolve_case(case_id: str) -> None:
    """F3.5 — deadline passed: follow the AI. Same resolve path as manual (F3.5.1)."""
    cid = uuid.UUID(case_id)
    async with SessionLocal() as db:
        result = await conflict_resolution.resolve(db, cid, automatic=True)
    if result is None:
        # resolved already, or no usable AI verdict / below confidence floor
        logger.warning("Case %s not auto-resolved (already resolved or no usable AI verdict)", case_id)