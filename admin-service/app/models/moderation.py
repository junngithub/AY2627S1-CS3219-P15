# AI Assistance Disclosure
# Tool: Cursor (Auto), date: 2026-11-09
# Scope: Implementation assistance for Admin Service persistence models under author-fixed requirements and architecture.
# Author review: Sahana Avantika generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum, Float, Index, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ReportStatus(str, enum.Enum):
    open = "open"
    dismissed = "dismissed"  # admin closed it without suspending
    actioned = "actioned"    # admin suspended the reported user


class ReportRecommendation(str, enum.Enum):
    """Advisory only. Dismiss and suspend stay a human decision."""

    dismiss = "dismiss"
    suspend = "suspend"
    unsure = "unsure"


class AppealStatus(str, enum.Enum):
    open = "open"
    rejected = "rejected"      # admin left the suspension in place
    reinstated = "reinstated"  # admin reinstated the user


class AppealRecommendation(str, enum.Enum):
    """Advisory only. Reject and reinstate stay a human decision."""

    uphold = "uphold"
    reinstate = "reinstate"
    unsure = "unsure"


def _enum(e):
    return Enum(e, values_callable=lambda objs: [x.value for x in objs])


class UserReport(Base):
    """One open report per reporter and reported user. A closed pair can be reported again."""

    __tablename__ = "user_reports"
    __table_args__ = (
        Index(
            "uq_user_reports_open_pair",
            "reporter_user_id",
            "reported_user_id",
            unique=True,
            postgresql_where=text("status = 'open'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    reporter_user_id: Mapped[str] = mapped_column(String, nullable=False)
    reported_user_id: Mapped[str] = mapped_column(String, index=True, nullable=False)
    comment: Mapped[str] = mapped_column(Text, nullable=False)
    # Filled by the background job. Null recommendation with a completed time means the model failed.
    ai_recommendation: Mapped[ReportRecommendation | None] = mapped_column(
        _enum(ReportRecommendation), nullable=True
    )
    ai_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    ai_reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[ReportStatus] = mapped_column(_enum(ReportStatus), default=ReportStatus.open, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_by_admin_id: Mapped[str | None] = mapped_column(String, nullable=True)


class SuspensionAppeal(Base):
    """One open appeal per suspended user. A later suspension can be appealed again."""

    __tablename__ = "suspension_appeals"
    __table_args__ = (
        Index(
            "uq_suspension_appeals_open_user",
            "user_id",
            unique=True,
            postgresql_where=text("status = 'open'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[str] = mapped_column(String, index=True, nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Filled by the background job. Null recommendation with a completed time means the model failed.
    ai_recommendation: Mapped[AppealRecommendation | None] = mapped_column(
        _enum(AppealRecommendation), nullable=True
    )
    ai_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    ai_reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[AppealStatus] = mapped_column(_enum(AppealStatus), default=AppealStatus.open, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_by_admin_id: Mapped[str | None] = mapped_column(String, nullable=True)
