# AI Assistance Disclosure
# Tool: Cursor (Auto), date: 2026-11-09
# Scope: Implementation assistance for Admin Service durable jobs under author-fixed requirements and architecture.
# Author review: Sahana Avantika generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.

"""Advisory assessment of a user report. Never closes the report."""

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select, update

from app.database import SessionLocal
from app.models.moderation import ReportRecommendation, ReportStatus, UserReport
from app.services import ai_client

logger = logging.getLogger(__name__)


async def run_report_evaluation(report_id: str) -> None:
    """First pass, queued when the report is saved. A later pass uses the rerun."""
    await _evaluate(report_id, rerun=False)


async def rerun_report_evaluation(report_id: str) -> None:
    """Replace the verdict on an open report. A failed call keeps the previous one."""
    await _evaluate(report_id, rerun=True)


async def _evaluate(report_id: str, rerun: bool) -> None:
    rid = uuid.UUID(report_id)
    async with SessionLocal() as db:
        report = await db.get(UserReport, rid)
        if not report or report.status != ReportStatus.open:
            return
        if not rerun and report.ai_completed_at is not None:
            return
        reported_user_id = report.reported_user_id
        rows = (
            await db.execute(
                select(UserReport)
                .where(UserReport.reported_user_id == reported_user_id)
                .order_by(UserReport.created_at)
            )
        ).scalars().all()
        reports = [(row.status.value, row.comment) for row in rows]

    assessment = await ai_client.get_report_recommendation(reports)
    now = datetime.now(timezone.utc)
    if assessment is None:
        if rerun:
            logger.warning("Report %s AI reassessment failed; previous verdict kept", report_id)
            return
        values = {"ai_completed_at": now}
        extra = UserReport.ai_completed_at.is_(None)
    else:
        values = {
            "ai_recommendation": ReportRecommendation(assessment.recommendation),
            "ai_confidence": assessment.confidence,
            "ai_reasoning": assessment.reasoning,
            "ai_completed_at": now,
        }
        extra = None

    async with SessionLocal() as db:
        stmt = update(UserReport).where(
            UserReport.id == rid,
            UserReport.status == ReportStatus.open,
        )
        if extra is not None:
            stmt = stmt.where(extra)
        await db.execute(stmt.values(**values))
        await db.commit()
