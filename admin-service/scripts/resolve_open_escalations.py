# AI Assistance Disclosure
# Tool: Cursor (Auto), date: 2026-11-09
# Scope: Implementation assistance for Admin Service ops scripts under author-fixed requirements and architecture.
# Author review: Sahana Avantika generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.

"""
One-off ops: clear open conflict cases left by load testing.

For each non-resolved case:
  1. Mark it resolved with fault_party=no-fault (and resolved_at).
  2. Append an audit_logs row.
  3. Delete leftover APScheduler jobs (reminder / deadline / AI).
  4. Publish admin.case.resolved so Order (and then Credit / Badges) catch up.

Not a schema migration — run by hand when the queue is flooded.

From admin-service/ (with .env pointing at the target DB + Kafka):

  python scripts/resolve_open_escalations.py          # dry-run
  python scripts/resolve_open_escalations.py --apply
  python scripts/resolve_open_escalations.py --apply --limit 100
  python scripts/resolve_open_escalations.py --republish --apply
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import bindparam, select, text, update

# Allow `python scripts/resolve_open_escalations.py` from admin-service/.
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from app.database import SessionLocal, engine  # noqa: E402
from app.models.conflict_case import ConflictCase, ConflictStatus, FaultParty  # noqa: E402
from app.services import audit, kafka_producer  # noqa: E402
from app.services.scheduler import conflict_job_ids  # noqa: E402

logger = logging.getLogger("resolve_open_escalations")

OPEN_STATUSES = (
    ConflictStatus.created,
    ConflictStatus.ai_evaluated,
    ConflictStatus.ai_failed,
    ConflictStatus.under_review,
)

OPS_ADMIN_ID = "ops-resolve-open-escalations"


async def _delete_scheduler_jobs(db, case_id: str) -> int:
    """Remove durable job rows without starting a second APScheduler process."""
    ids = list(conflict_job_ids(case_id))
    stmt = text("DELETE FROM apscheduler_jobs WHERE id IN :ids").bindparams(
        bindparam("ids", expanding=True)
    )
    try:
        result = await db.execute(stmt, {"ids": ids})
    except Exception:
        # Fresh DB / migrate-only env may not have created the jobstore yet.
        logger.warning("Could not delete APScheduler jobs for case %s", case_id, exc_info=True)
        return 0
    return result.rowcount or 0


async def _load_open_cases(limit: int | None) -> list[ConflictCase]:
    async with SessionLocal() as db:
        stmt = (
            select(ConflictCase)
            .where(ConflictCase.status.in_(OPEN_STATUSES))
            .order_by(ConflictCase.created_at.asc())
        )
        if limit is not None:
            stmt = stmt.limit(limit)
        return list((await db.execute(stmt)).scalars().all())


async def _load_ops_resolved_cases(limit: int | None) -> list[ConflictCase]:
    """Cases this script already resolved — for Kafka republish after a broker blip."""
    async with SessionLocal() as db:
        stmt = (
            select(ConflictCase)
            .where(
                ConflictCase.status == ConflictStatus.resolved,
                ConflictCase.resolved_by_admin_id == OPS_ADMIN_ID,
                ConflictCase.resolved_fault_party == FaultParty.no_fault,
            )
            .order_by(ConflictCase.resolved_at.asc())
        )
        if limit is not None:
            stmt = stmt.limit(limit)
        return list((await db.execute(stmt)).scalars().all())


async def _publish(case: ConflictCase) -> None:
    await kafka_producer.publish_conflict_resolved(
        order_id=case.order_id,
        case_id=str(case.id),
        fault_party=FaultParty.no_fault.value,
    )


async def _resolve_one(case: ConflictCase) -> None:
    now = datetime.now(timezone.utc)
    async with SessionLocal() as db:
        result = await db.execute(
            update(ConflictCase)
            .where(
                ConflictCase.id == case.id,
                ConflictCase.status.in_(OPEN_STATUSES),
            )
            .values(
                status=ConflictStatus.resolved,
                resolved_fault_party=FaultParty.no_fault,
                resolved_by_admin_id=OPS_ADMIN_ID,
                resolved_automatically=False,
                resolved_at=now,
            )
            .returning(ConflictCase.order_id)
        )
        row = result.first()
        if row is None:
            logger.info("Skip %s: already resolved or gone", case.id)
            return

        order_id = row[0]
        await audit.record(
            db,
            admin_id=OPS_ADMIN_ID,
            action="resolve_conflict",
            target_id=str(case.id),
            detail="ops bulk cleanup, fault_party=no-fault",
        )
        removed = await _delete_scheduler_jobs(db, str(case.id))
        await db.commit()

    case.order_id = order_id
    try:
        await _publish(case)
    except Exception:
        # Same contract as conflict_resolution.resolve: DB is committed; log and continue.
        # Use --republish --apply later to retry Kafka for this case.
        logger.exception(
            "DB resolved case %s / order %s but Kafka publish failed; re-run with --republish --apply",
            case.id,
            order_id,
        )
        raise

    logger.info(
        "Resolved case %s (order %s) as no-fault; removed %d scheduler job(s)",
        case.id,
        order_id,
        removed,
    )


async def _for_each(cases: list[ConflictCase], work) -> int:
    failures = 0
    for case in cases:
        try:
            await work(case)
        except Exception:
            failures += 1
            logger.exception("Failed on case %s", case.id)
    return failures


async def run(*, apply: bool, limit: int | None, republish: bool) -> int:
    if republish:
        cases = await _load_ops_resolved_cases(limit)
        label = "ops-resolved case(s) to republish"
        dry_hint = "Dry-run only. Re-run with --republish --apply to publish again."
        work = _publish
    else:
        cases = await _load_open_cases(limit)
        label = "open case(s)"
        dry_hint = "Dry-run only. Re-run with --apply to resolve and publish."
        work = _resolve_one

    if not cases:
        print(f"No {label}.")
        return 0

    print(f"Found {len(cases)} {label}" + (f" (limit {limit})" if limit else "") + ":")
    for case in cases:
        print(f"  {case.id}  order={case.order_id}  status={case.status.value}")

    if not apply:
        print(dry_hint)
        return 0

    await kafka_producer.start_producer()
    try:
        failures = await _for_each(cases, work)
    finally:
        await kafka_producer.stop_producer()
        await engine.dispose()

    ok = len(cases) - failures
    action = "republished" if republish else "resolved"
    print(f"Done: {ok} {action}, {failures} failed.")
    return 1 if failures else 0


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Resolve open Admin conflict cases as no-fault and fan out via Kafka."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write resolutions / publish Kafka events. Without this flag the script only lists cases.",
    )
    parser.add_argument(
        "--republish",
        action="store_true",
        help="Re-publish admin.case.resolved for cases this script already resolved "
        "(use after a Kafka failure).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        metavar="N",
        help="Process at most N cases (oldest first).",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    raise SystemExit(
        asyncio.run(run(apply=args.apply, limit=args.limit, republish=args.republish))
    )


if __name__ == "__main__":
    main()
