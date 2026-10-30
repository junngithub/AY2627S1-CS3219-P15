import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import AdminDep, CurrentAdmin
from app.database import get_db
from app.models.moderation import AppealStatus, ReportStatus, SuspensionAppeal, UserReport
from app.schemas.moderation import AppealDetail, CreateAppealRequest, CreateReportRequest, ReportDetail
from app.services.moderation import CloseOutcome, create_appeal, create_report, dismiss_report, reject_appeal

reports = APIRouter(prefix="/api/v1/admin/reports", tags=["admin-reports"])
appeals = APIRouter(prefix="/api/v1/admin/appeals", tags=["admin-appeals"])


def _parse(enum_cls, value: str | None):
    if value is None:
        return None
    try:
        return enum_cls(value)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Unknown status '{value}'")


def _closed(outcome: CloseOutcome, current, noun: str):
    if outcome is CloseOutcome.missing:
        raise HTTPException(status_code=404)
    raise HTTPException(
        status_code=409,
        detail=f"{noun} is '{current.status.value}' and cannot be closed",
    )


@reports.post("", response_model=ReportDetail, status_code=201)
async def open_report(body: CreateReportRequest, db: AsyncSession = Depends(get_db)):
    """
    No auth. User Service calls this the way Order calls conflict intake.
    Idempotent while the pair has an open report: a retry returns that row.
    """
    return await create_report(db, body.reporterUserId, body.reportedUserId, body.comment)


@reports.get("", response_model=list[ReportDetail])
async def list_reports(
    status: str | None = None, admin: CurrentAdmin = AdminDep, db: AsyncSession = Depends(get_db)
):
    query = select(UserReport).order_by(UserReport.created_at)
    parsed = _parse(ReportStatus, status)
    if parsed:
        query = query.where(UserReport.status == parsed)
    return (await db.execute(query)).scalars().all()


@reports.get("/{report_id}", response_model=ReportDetail)
async def get_report(report_id: uuid.UUID, admin: CurrentAdmin = AdminDep, db: AsyncSession = Depends(get_db)):
    row = await db.get(UserReport, report_id)
    if not row:
        raise HTTPException(status_code=404)
    return row


@reports.post("/{report_id}/dismiss", response_model=ReportDetail)
async def dismiss(report_id: uuid.UUID, admin: CurrentAdmin = AdminDep, db: AsyncSession = Depends(get_db)):
    """Close without suspending. Suspending the reported user closes open reports instead."""
    outcome, row = await dismiss_report(db, report_id, admin.user_id)
    if outcome is not CloseOutcome.closed:
        _closed(outcome, row, "Report")
    return row


@appeals.post("", response_model=AppealDetail, status_code=201)
async def open_appeal(body: CreateAppealRequest, db: AsyncSession = Depends(get_db)):
    """
    No auth. User Service calls this after it has checked the password and
    confirmed the account is suspended. It does not reinstate the user.
    Idempotent while that user has an open appeal.
    """
    return await create_appeal(db, body.userId, body.message)


@appeals.get("", response_model=list[AppealDetail])
async def list_appeals(
    status: str | None = None, admin: CurrentAdmin = AdminDep, db: AsyncSession = Depends(get_db)
):
    query = select(SuspensionAppeal).order_by(SuspensionAppeal.created_at)
    parsed = _parse(AppealStatus, status)
    if parsed:
        query = query.where(SuspensionAppeal.status == parsed)
    return (await db.execute(query)).scalars().all()


@appeals.get("/{appeal_id}", response_model=AppealDetail)
async def get_appeal(appeal_id: uuid.UUID, admin: CurrentAdmin = AdminDep, db: AsyncSession = Depends(get_db)):
    row = await db.get(SuspensionAppeal, appeal_id)
    if not row:
        raise HTTPException(status_code=404)
    return row


@appeals.post("/{appeal_id}/reject", response_model=AppealDetail)
async def reject(appeal_id: uuid.UUID, admin: CurrentAdmin = AdminDep, db: AsyncSession = Depends(get_db)):
    """Leave the suspension in place. Reinstating the user closes the open appeal instead."""
    outcome, row = await reject_appeal(db, appeal_id, admin.user_id)
    if outcome is not CloseOutcome.closed:
        _closed(outcome, row, "Appeal")
    return row
