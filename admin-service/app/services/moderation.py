"""User reports and suspension appeals.

User Service opens a row. An admin dismisses or rejects it here, or closes it
by the existing suspend / reinstate calls. Opening a report does not suspend
anyone, and opening an appeal does not reinstate anyone.
"""

import uuid
from datetime import datetime, timezone
from enum import Enum

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.moderation import AppealStatus, ReportStatus, SuspensionAppeal, UserReport
from app.services import audit


class CloseOutcome(str, Enum):
    missing = "missing"
    not_open = "not_open"
    closed = "closed"


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _open_report(db: AsyncSession, reporter: str, reported: str) -> UserReport | None:
    return await db.scalar(
        select(UserReport).where(
            UserReport.reporter_user_id == reporter,
            UserReport.reported_user_id == reported,
            UserReport.status == ReportStatus.open,
        )
    )


async def create_report(db: AsyncSession, reporter: str, reported: str, comment: str) -> UserReport:
    """The open report for this pair. A repeat returns that row and keeps its comment."""
    existing = await _open_report(db, reporter, reported)
    if existing:
        return existing

    row = UserReport(
        reporter_user_id=reporter,
        reported_user_id=reported,
        comment=comment,
        status=ReportStatus.open,
        created_at=_now(),
    )
    db.add(row)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        existing = await _open_report(db, reporter, reported)
        if existing:
            return existing
        raise
    return row


async def create_appeal(db: AsyncSession, user_id: str, message: str) -> SuspensionAppeal:
    """The open appeal for this user. A repeat returns that row and keeps its message."""
    existing = await db.scalar(
        select(SuspensionAppeal).where(
            SuspensionAppeal.user_id == user_id,
            SuspensionAppeal.status == AppealStatus.open,
        )
    )
    if existing:
        return existing

    row = SuspensionAppeal(
        user_id=user_id,
        message=message,
        status=AppealStatus.open,
        created_at=_now(),
    )
    db.add(row)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        existing = await db.scalar(
            select(SuspensionAppeal).where(
                SuspensionAppeal.user_id == user_id,
                SuspensionAppeal.status == AppealStatus.open,
            )
        )
        if existing:
            return existing
        raise
    return row


async def dismiss_report(db: AsyncSession, report_id: uuid.UUID, admin_id: str) -> tuple[CloseOutcome, UserReport | None]:
    now = _now()
    row = (
        await db.execute(
            update(UserReport)
            .where(UserReport.id == report_id, UserReport.status == ReportStatus.open)
            .values(status=ReportStatus.dismissed, closed_at=now, closed_by_admin_id=admin_id)
            .returning(UserReport.id)
        )
    ).first()
    if row is None:
        await db.rollback()
        current = await db.get(UserReport, report_id)
        if current is None:
            return CloseOutcome.missing, None
        return CloseOutcome.not_open, current

    await audit.record(db, admin_id=admin_id, action="dismiss_report", target_id=str(report_id))
    await db.commit()
    return CloseOutcome.closed, await db.get(UserReport, report_id)


async def reject_appeal(db: AsyncSession, appeal_id: uuid.UUID, admin_id: str) -> tuple[CloseOutcome, SuspensionAppeal | None]:
    now = _now()
    row = (
        await db.execute(
            update(SuspensionAppeal)
            .where(SuspensionAppeal.id == appeal_id, SuspensionAppeal.status == AppealStatus.open)
            .values(status=AppealStatus.rejected, closed_at=now, closed_by_admin_id=admin_id)
            .returning(SuspensionAppeal.id)
        )
    ).first()
    if row is None:
        await db.rollback()
        current = await db.get(SuspensionAppeal, appeal_id)
        if current is None:
            return CloseOutcome.missing, None
        return CloseOutcome.not_open, current

    await audit.record(db, admin_id=admin_id, action="reject_appeal", target_id=str(appeal_id))
    await db.commit()
    return CloseOutcome.closed, await db.get(SuspensionAppeal, appeal_id)


async def close_open_reports(db: AsyncSession, reported_user_id: str, admin_id: str) -> None:
    """Suspend succeeded. Every open report against this user is actioned. Does not commit."""
    await db.execute(
        update(UserReport)
        .where(UserReport.reported_user_id == reported_user_id, UserReport.status == ReportStatus.open)
        .values(status=ReportStatus.actioned, closed_at=_now(), closed_by_admin_id=admin_id)
    )


async def close_open_appeals(db: AsyncSession, user_id: str, admin_id: str) -> None:
    """Reinstate succeeded. The open appeal for this user is reinstated. Does not commit."""
    await db.execute(
        update(SuspensionAppeal)
        .where(SuspensionAppeal.user_id == user_id, SuspensionAppeal.status == AppealStatus.open)
        .values(status=AppealStatus.reinstated, closed_at=_now(), closed_by_admin_id=admin_id)
    )
