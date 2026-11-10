# AI Assistance Disclosure
# Tool: Cursor (Auto), date: 2026-11-09
# Scope: Implementation assistance for Admin Service request/response schemas under author-fixed requirements and architecture.
# Author review: Sahana Avantika generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator, model_validator

from app.models.moderation import AppealRecommendation, AppealStatus, ReportRecommendation, ReportStatus
from app.schemas.camel import CamelModel


def _stripped(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("must not be blank")
    return value


class CreateReportRequest(BaseModel):
    """Intake body for User Service. A logged-in user reporting someone else."""

    reporterUserId: str = Field(min_length=1, max_length=200)
    reportedUserId: str = Field(min_length=1, max_length=200)
    comment: str = Field(min_length=1, max_length=4000)

    @field_validator("reporterUserId", "reportedUserId", "comment")
    @classmethod
    def strip_fields(cls, value: str) -> str:
        return _stripped(value)

    @model_validator(mode="after")
    def not_self(self):
        if self.reporterUserId == self.reportedUserId:
            raise ValueError("A user cannot report themselves")
        return self


class CreateAppealRequest(BaseModel):
    """Intake body for User Service. The suspended user is not given a session."""

    userId: str = Field(min_length=1, max_length=200)
    message: str = Field(min_length=1, max_length=4000)

    @field_validator("userId", "message")
    @classmethod
    def strip_fields(cls, value: str) -> str:
        return _stripped(value)


class ReportDetail(CamelModel):
    id: uuid.UUID
    reporter_user_id: str
    reported_user_id: str
    comment: str
    status: ReportStatus
    ai_recommendation: ReportRecommendation | None = None
    ai_confidence: float | None = None
    ai_reasoning: str | None = None
    ai_completed_at: datetime | None = None
    created_at: datetime
    closed_at: datetime | None
    closed_by_admin_id: str | None


class RejectAppealRequest(BaseModel):
    """Shown to the suspended user. Required when an appeal is rejected."""

    reason: str = Field(min_length=1, max_length=4000)

    @field_validator("reason")
    @classmethod
    def strip_reason(cls, value: str) -> str:
        return _stripped(value)


class AppealDetail(CamelModel):
    id: uuid.UUID
    user_id: str
    message: str
    status: AppealStatus
    rejection_reason: str | None = None
    ai_recommendation: AppealRecommendation | None = None
    ai_confidence: float | None = None
    ai_reasoning: str | None = None
    ai_completed_at: datetime | None = None
    created_at: datetime
    closed_at: datetime | None
    closed_by_admin_id: str | None
    # Reports about this user, any status. Empty on intake, where User Service
    # ignores fields it does not store. The admin queue fills this in.
    reports: list[ReportDetail] = Field(default_factory=list)
