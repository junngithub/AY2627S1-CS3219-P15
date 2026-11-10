# AI Assistance Disclosure
# Tool: Cursor (Auto), date: 2026-11-09
# Scope: Implementation assistance for Admin Service durable jobs under author-fixed requirements and architecture.
# Author review: Sahana Avantika generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import update

from app.database import SessionLocal
from app.models.conflict_case import ConflictCase, ConflictStatus, FaultParty
from app.services import ai_client, conflict_resolution, order_photos

logger = logging.getLogger(__name__)


async def rerun_ai_evaluation(case_id: str) -> None:
    """
    A claimed case, run again from the review dialog. Status stays under_review.
    A failed call leaves the previous verdict in place.
    """
    cid = uuid.UUID(case_id)
    async with SessionLocal() as db:
        case = await db.get(ConflictCase, cid)
        if not case or case.status != ConflictStatus.under_review:
            return
        order_id = case.order_id
        refs = list(case.evidence_photo_urls or [])
        comment = case.comment

    loaded = await order_photos.fetch_evidence(order_id, refs)
    rec = None if loaded is None else await ai_client.get_fault_recommendation(loaded, comment)
    if rec is None:
        logger.warning("Case %s AI reassessment failed; previous verdict kept", case_id)
        return

    now = datetime.now(timezone.utc)
    async with SessionLocal() as db:
        await db.execute(
            update(ConflictCase)
            .where(ConflictCase.id == cid, ConflictCase.status == ConflictStatus.under_review)
            .values(
                ai_fault_party=FaultParty(rec.fault_party),
                ai_confidence=rec.confidence,
                ai_reasoning=rec.reasoning,
                ai_completed_at=now,
            )
        )
        await db.commit()


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
        order_id = case.order_id
        refs = list(case.evidence_photo_urls or [])
        comment = case.comment

    # Order still has the objects: resolve is what deletes them.
    loaded = await order_photos.fetch_evidence(order_id, refs)
    rec = None if loaded is None else await ai_client.get_fault_recommendation(loaded, comment)

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