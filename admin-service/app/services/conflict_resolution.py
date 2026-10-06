import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.conflict_case import ConflictCase, ConflictStatus, FaultParty
from app.services import audit, kafka_producer, scheduler

logger = logging.getLogger(__name__)


async def resolve(
    db: AsyncSession,
    case_id: uuid.UUID,
    *,
    automatic: bool,
    admin_id: str | None = None,
    fault_party: FaultParty | None = None,
    decision: str | None = None,
) -> tuple[str, FaultParty] | None:
    """
    The ONLY resolve path (F3.5.1). A single conditional UPDATE enforces the
    state machine and prevents double-resolution races; returns None if the
    case wasn't in a resolvable state (caller decides 404/409/skip).

      manual: under_review -> resolved
      auto:   ai_evaluated (and under_review, if configured) -> resolved,
              only if an AI verdict exists and meets the confidence floor.
    """
    now = datetime.now(timezone.utc)
    if automatic:
        allowed = [ConflictStatus.ai_evaluated]
        if settings.auto_resolve_while_under_review:
            allowed.append(ConflictStatus.under_review)
        stmt = (
            update(ConflictCase)
            .where(
                ConflictCase.id == case_id,
                ConflictCase.status.in_(allowed),
                ConflictCase.ai_fault_party.is_not(None),
                ConflictCase.ai_confidence >= settings.auto_resolve_min_confidence,
            )
            .values(
                status=ConflictStatus.resolved,
                resolved_fault_party=ConflictCase.ai_fault_party,
                resolved_by_admin_id=None,
                resolved_automatically=True,
                resolved_at=now,
            )
        )
    else:
        stmt = (
            update(ConflictCase)
            .where(ConflictCase.id == case_id, ConflictCase.status == ConflictStatus.under_review)
            .values(
                status=ConflictStatus.resolved,
                resolved_fault_party=fault_party,
                resolved_by_admin_id=admin_id,
                resolved_automatically=False,
                resolved_at=now,
            )
        )

    row = (await db.execute(stmt.returning(ConflictCase.order_id, ConflictCase.resolved_fault_party))).first()
    if row is None:
        await db.rollback()
        return None
    order_id, party = row

    # F3.4.2 — structured outcome logged, not free text.
    await audit.record(
        db,
        admin_id=admin_id or "system-auto-resolve",
        action="resolve_conflict",
        target_id=str(case_id),
        detail=(
            f"auto-resolved, fault_party={party.value}"
            if automatic
            else f"decision={decision}, fault_party={party.value}"
        ),
    )
    await db.commit()

    scheduler.cancel_conflict_timers(str(case_id))

    # F3.6 — Admin only messages Order Service; Order fans out to Credit/Rating (NFR3.1).
    # DB is already committed: log (don't 500) if Kafka is down. See outbox note.
    try:
        await kafka_producer.publish_conflict_resolved(
            order_id=order_id,
            case_id=str(case_id),
            fault_party=party.value,
            resolved_automatically=automatic,
        )
    except Exception:
        logger.exception("Failed to publish ConflictResolved for case %s", case_id)
    return order_id, party