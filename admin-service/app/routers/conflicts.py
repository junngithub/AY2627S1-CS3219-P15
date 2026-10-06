import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.security import AdminDep, CurrentAdmin
from app.core.service_auth import ServiceDep
from app.database import get_db
from app.models.conflict_case import ConflictCase, ConflictStatus
from app.schemas.conflict import (
    ClaimConflictResponse,
    ConflictDetail,
    ConflictSummary,
    CreateConflictRequest,
    ResolveConflictRequest,
    ResolveConflictResponse,
)
from app.services import audit, conflict_resolution, kafka_producer, scheduler

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/admin/conflicts", tags=["admin-conflicts"])

# Contract documents ?status=pending|resolved; keep those working.
_STATUS_ALIASES = {
    "pending": ConflictStatus.ai_evaluated,       # deadline-bound queue (AI-flagged)
    "non_deadline": ConflictStatus.ai_failed,     # non-deadline queue
}


def _parse_status(value: str | None) -> ConflictStatus | None:
    if value is None:
        return None
    if value in _STATUS_ALIASES:
        return _STATUS_ALIASES[value]
    try:
        return ConflictStatus(value)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Unknown status '{value}'")


@router.post("", response_model=ConflictDetail, status_code=201)
async def create_conflict(
    body: CreateConflictRequest,
    _: None = ServiceDep,  # Order Service, not an admin
    db: AsyncSession = Depends(get_db),
):
    """
    F3.1 — save fast, return 201. AI runs afterwards as a background job, so a slow
    VLM can never time out Order Service's escalate call (NFR4.1.1).
    Idempotent per order: a retry returns the existing case.
    """
    existing = await db.scalar(select(ConflictCase).where(ConflictCase.order_id == body.orderId))
    if existing:
        return existing

    case = ConflictCase(
        order_id=body.orderId,
        reporter_user_id=body.reporterUserId,
        comment=body.comment,
        evidence_photo_urls=body.photos,
        status=ConflictStatus.created,
        resolution_deadline=datetime.now(timezone.utc) + timedelta(hours=settings.resolution_deadline_hours),
    )
    db.add(case)
    try:
        await db.commit()
    except IntegrityError:  # concurrent duplicate create
        await db.rollback()
        return await db.scalar(select(ConflictCase).where(ConflictCase.order_id == body.orderId))

    cid = str(case.id)
    scheduler.schedule_conflict_timers(cid, case.resolution_deadline)  # F3.3.1 / F3.7.1
    scheduler.schedule_ai_evaluation(cid)

    try:  # F3.1.1 — DB is committed; log rather than 500 if Kafka is down
        await kafka_producer.publish_conflict_case_created(order_id=case.order_id, case_id=cid)
    except Exception:
        logger.exception("Failed to publish ConflictCaseCreated for case %s", cid)
    return case


@router.get("", response_model=list[ConflictSummary])
async def list_conflicts(
    status: str | None = None, admin: CurrentAdmin = AdminDep, db: AsyncSession = Depends(get_db)
):
    query = select(ConflictCase)
    parsed = _parse_status(status)
    if parsed:
        query = query.where(ConflictCase.status == parsed)
    result = await db.execute(query.order_by(ConflictCase.resolution_deadline))
    return result.scalars().all()


@router.get("/{case_id}", response_model=ConflictDetail)
async def get_conflict(case_id: uuid.UUID, admin: CurrentAdmin = AdminDep, db: AsyncSession = Depends(get_db)):
    case = await db.get(ConflictCase, case_id)
    if not case:
        raise HTTPException(status_code=404)
    return case


@router.post("/{case_id}/review", response_model=ClaimConflictResponse)
async def claim_conflict(case_id: uuid.UUID, admin: CurrentAdmin = AdminDep, db: AsyncSession = Depends(get_db)):
    """Admin starts looking at the case: ai_evaluated | ai_failed -> under_review, then emit the event."""
    now = datetime.now(timezone.utc)
    row = (
        await db.execute(
            update(ConflictCase)
            .where(
                ConflictCase.id == case_id,
                ConflictCase.status.in_([ConflictStatus.ai_evaluated, ConflictStatus.ai_failed]),
            )
            .values(
                status=ConflictStatus.under_review,
                review_started_at=now,
                review_started_by_admin_id=admin.user_id,
            )
            .returning(ConflictCase.order_id)
        )
    ).first()

    if row is None:  # conditional update lost: figure out why
        await db.rollback()
        case = await db.get(ConflictCase, case_id)
        if not case:
            raise HTTPException(status_code=404)
        if case.status == ConflictStatus.under_review and case.review_started_by_admin_id == admin.user_id:
            return ClaimConflictResponse(  # same admin re-claiming: idempotent
                case_id=str(case_id), order_id=case.order_id, status=case.status,
                review_started_at=case.review_started_at,
                review_started_by_admin_id=case.review_started_by_admin_id,
            )
        raise HTTPException(status_code=409, detail=f"Case is '{case.status.value}' and cannot be claimed")

    order_id = row[0]
    await audit.record(db, admin_id=admin.user_id, action="review_conflict", target_id=str(case_id))
    await db.commit()

    try:  # Order Service sets the order to Under Review (Admin F1.7 / Order F2.15)
        await kafka_producer.publish_order_under_review(order_id=order_id, case_id=str(case_id))
    except Exception:
        logger.exception("Failed to publish OrderUnderReview for case %s", case_id)

    return ClaimConflictResponse(
        case_id=str(case_id), order_id=order_id, status=ConflictStatus.under_review,
        review_started_at=now, review_started_by_admin_id=admin.user_id,
    )


@router.post("/{case_id}/resolve", response_model=ResolveConflictResponse)
async def resolve_conflict(
    case_id: uuid.UUID,
    body: ResolveConflictRequest,
    admin: CurrentAdmin = AdminDep,
    db: AsyncSession = Depends(get_db),
):
    result = await conflict_resolution.resolve(
        db, case_id, automatic=False,
        admin_id=admin.user_id, fault_party=body.faultParty, decision=body.decision,
    )
    if result is None:
        case = await db.get(ConflictCase, case_id)
        if not case:
            raise HTTPException(status_code=404)
        raise HTTPException(status_code=409, detail=f"Case is '{case.status.value}'; must be 'under_review' to resolve")

    order_id, party = result
    return ResolveConflictResponse(
        case_id=str(case_id), order_id=order_id, resolved_fault_party=party, resolved_automatically=False
    )