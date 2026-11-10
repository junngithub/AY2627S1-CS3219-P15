# AI Assistance Disclosure
# Tool: Cursor (Auto), date: 2026-11-09
# Scope: Implementation assistance for Admin Service durable jobs under author-fixed requirements and architecture.
# Author review: Sahana Avantika generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.

"""Advisory assessment of a suspension appeal. Never closes the appeal."""

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select, update

from app.database import SessionLocal
from app.models.moderation import AppealRecommendation, AppealStatus, SuspensionAppeal, UserReport
from app.services import ai_client

logger = logging.getLogger(__name__)


async def run_appeal_evaluation(appeal_id: str) -> None:
    """First pass, queued when the appeal is saved. A later pass uses the rerun."""
    await _evaluate(appeal_id, rerun=False)


async def rerun_appeal_evaluation(appeal_id: str) -> None:
    """Replace the verdict on an open appeal. A failed call keeps the previous one."""
    await _evaluate(appeal_id, rerun=True)


async def _evaluate(appeal_id: str, rerun: bool) -> None:
    aid = uuid.UUID(appeal_id)
    async with SessionLocal() as db:
        appeal = await db.get(SuspensionAppeal, aid)
        if not appeal or appeal.status != AppealStatus.open:
            return
        if not rerun and appeal.ai_completed_at is not None:
            return
        user_id = appeal.user_id
        message = appeal.message
        rows = (
            await db.execute(
                select(UserReport)
                .where(UserReport.reported_user_id == user_id)
                .order_by(UserReport.created_at)
            )
        ).scalars().all()
        reports = [(row.status.value, row.comment) for row in rows]

    assessment = await ai_client.get_appeal_recommendation(reports, message)
    now = datetime.now(timezone.utc)
    if assessment is None:
        if rerun:
            logger.warning("Appeal %s AI reassessment failed; previous verdict kept", appeal_id)
            return
        values = {"ai_completed_at": now}
        extra = SuspensionAppeal.ai_completed_at.is_(None)
    else:
        values = {
            "ai_recommendation": AppealRecommendation(assessment.recommendation),
            "ai_confidence": assessment.confidence,
            "ai_reasoning": assessment.reasoning,
            "ai_completed_at": now,
        }
        extra = None

    async with SessionLocal() as db:
        stmt = update(SuspensionAppeal).where(
            SuspensionAppeal.id == aid,
            SuspensionAppeal.status == AppealStatus.open,
        )
        if extra is not None:
            stmt = stmt.where(extra)
        await db.execute(stmt.values(**values))
        await db.commit()
