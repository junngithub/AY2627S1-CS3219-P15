# AI Assistance Disclosure
# Tool: Cursor (Auto), date: 2026-11-09
# Scope: Implementation assistance for Admin Service REST layer under author-fixed requirements and architecture.
# Author review: Sahana Avantika generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import AdminDep, CurrentAdmin
from app.database import get_db
from app.models.moderation import AppealStatus, ReportStatus, SuspensionAppeal, UserReport
from app.schemas.moderation import (
    AppealDetail,
    CreateAppealRequest,
    CreateReportRequest,
    RejectAppealRequest,
    ReportDetail,
)
from app.services import audit, scheduler
from app.services.moderation import CloseOutcome, create_appeal, create_report, dismiss_report, reject_appeal

reports = APIRouter(prefix="/api/v1/admin/reports", tags=["admin-reports"])
appeals = APIRouter(prefix="/api/v1/admin/appeals", tags=["admin-appeals"])
# User Service's report and appeal intake. Under /internal so the gateway never
# forwards it and the mesh lets only User call it (ADR-0012).
internal_reports = APIRouter(prefix="/api/v1/admin/internal/reports", tags=["admin-intake"])
internal_appeals = APIRouter(prefix="/api/v1/admin/internal/appeals", tags=["admin-intake"])


def _parse(enum_cls, value: str | None):
    if value is None:
        return None
    try:
        return enum_cls(value)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Unknown status '{value}'")


async def _appeal_with_reports(db: AsyncSession, row: SuspensionAppeal) -> AppealDetail:
    return _appeal(row, await _reports_about(db, row.user_id))


async def _reports_about(db: AsyncSession, user_id: str) -> list[UserReport]:
    rows = (
        await db.execute(select(UserReport).where(UserReport.reported_user_id == user_id))
    ).scalars().all()
    return sorted(rows, key=lambda row: row.created_at)


def _appeal(row: SuspensionAppeal, reports: list[UserReport]) -> AppealDetail:
    detail = AppealDetail.model_validate(row)
    return detail.model_copy(update={"reports": [ReportDetail.model_validate(report) for report in reports]})


def _closed(outcome: CloseOutcome, current, noun: str):
    if outcome is CloseOutcome.missing:
        raise HTTPException(status_code=404)
    raise HTTPException(
        status_code=409,
        detail=f"{noun} is '{current.status.value}' and cannot be closed",
    )


@internal_reports.post("", response_model=ReportDetail, status_code=201)
async def open_report(body: CreateReportRequest, db: AsyncSession = Depends(get_db)):
    """
    No admin session: only User Service may call this (mesh policy), the way
    Order calls conflict intake.
    Idempotent while the pair has an open report: a retry returns that row.
    """
    row, created = await create_report(db, body.reporterUserId, body.reportedUserId, body.comment)
    if created:
        scheduler.schedule_report_evaluation(str(row.id))
    return row


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


@reports.post("/{report_id}/reassess", status_code=202)
async def reassess_report(
    report_id: uuid.UUID, admin: CurrentAdmin = AdminDep, db: AsyncSession = Depends(get_db)
):
    """Run Gemini again. The report stays open, and Dismiss / Suspend stay manual."""
    row = await db.get(UserReport, report_id)
    if not row:
        raise HTTPException(status_code=404)
    if row.status != ReportStatus.open:
        raise HTTPException(status_code=409, detail="Only an open report can be assessed again")
    await audit.record(db, admin_id=admin.user_id, action="reassess_report", target_id=str(report_id))
    await db.commit()
    scheduler.schedule_report_reassessment(str(report_id))
    return {"reportId": str(report_id)}


@reports.post("/{report_id}/dismiss", response_model=ReportDetail)
async def dismiss(report_id: uuid.UUID, admin: CurrentAdmin = AdminDep, db: AsyncSession = Depends(get_db)):
    """Close without suspending. Suspending the reported user closes open reports instead."""
    outcome, row = await dismiss_report(db, report_id, admin.user_id)
    if outcome is not CloseOutcome.closed:
        _closed(outcome, row, "Report")
    return row


@internal_appeals.post("", response_model=AppealDetail, status_code=201)
async def open_appeal(body: CreateAppealRequest, db: AsyncSession = Depends(get_db)):
    """
    No admin session: only User Service may call this (mesh policy), after it
    has checked the password and
    confirmed the account is suspended. It does not reinstate the user.
    Idempotent while that user has an open appeal.
    """
    row, created = await create_appeal(db, body.userId, body.message)
    if created:
        scheduler.schedule_appeal_evaluation(str(row.id))
    return row


@appeals.get("", response_model=list[AppealDetail])
async def list_appeals(
    status: str | None = None, admin: CurrentAdmin = AdminDep, db: AsyncSession = Depends(get_db)
):
    query = select(SuspensionAppeal).order_by(SuspensionAppeal.created_at)
    parsed = _parse(AppealStatus, status)
    if parsed:
        query = query.where(SuspensionAppeal.status == parsed)
    rows = (await db.execute(query)).scalars().all()
    return [await _appeal_with_reports(db, row) for row in rows]


@appeals.get("/latest", response_model=AppealDetail | None)
async def latest_appeal(userId: str, db: AsyncSession = Depends(get_db)):
    """
    No auth. User Service calls this during a suspended login so it can tell
    the account owner the appeal is still open, or why it was rejected.
    The public gateway must not expose this path.
    """
    user_id = userId.strip()
    if not user_id or len(user_id) > 200:
        raise HTTPException(status_code=422, detail="userId is required")
    return await db.scalar(
        select(SuspensionAppeal)
        .where(SuspensionAppeal.user_id == user_id)
        .order_by(SuspensionAppeal.created_at.desc())
        .limit(1)
    )


@appeals.get("/{appeal_id}", response_model=AppealDetail)
async def get_appeal(appeal_id: uuid.UUID, admin: CurrentAdmin = AdminDep, db: AsyncSession = Depends(get_db)):
    row = await db.get(SuspensionAppeal, appeal_id)
    if not row:
        raise HTTPException(status_code=404)
    return await _appeal_with_reports(db, row)


@appeals.post("/{appeal_id}/reassess", status_code=202)
async def reassess_appeal(
    appeal_id: uuid.UUID, admin: CurrentAdmin = AdminDep, db: AsyncSession = Depends(get_db)
):
    """Run Gemini again. The appeal stays open, and Reject / Reinstate stay manual."""
    row = await db.get(SuspensionAppeal, appeal_id)
    if not row:
        raise HTTPException(status_code=404)
    if row.status != AppealStatus.open:
        raise HTTPException(status_code=409, detail="Only an open appeal can be assessed again")
    await audit.record(db, admin_id=admin.user_id, action="reassess_appeal", target_id=str(appeal_id))
    await db.commit()
    scheduler.schedule_appeal_reassessment(str(appeal_id))
    return {"appealId": str(appeal_id)}


@appeals.post("/{appeal_id}/reject", response_model=AppealDetail)
async def reject(
    appeal_id: uuid.UUID,
    body: RejectAppealRequest,
    request: Request,
    admin: CurrentAdmin = AdminDep,
    db: AsyncSession = Depends(get_db),
):
    """Leave the suspension in place and keep the reason the user will be shown."""
    outcome, row = await reject_appeal(db, appeal_id, admin.user_id, body.reason)
    if outcome is not CloseOutcome.closed:
        _closed(outcome, row, "Appeal")
    if row is None:
        raise HTTPException(status_code=404)
    from app.routers import users as user_routes
    await user_routes.notify_appeal_rejected(request, row.user_id, body.reason)
    return row
