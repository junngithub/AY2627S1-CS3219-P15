import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.moderation import AppealStatus, ReportStatus


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


class ReportDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    reporter_user_id: str
    reported_user_id: str
    comment: str
    status: ReportStatus
    created_at: datetime
    closed_at: datetime | None
    closed_by_admin_id: str | None


class AppealDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: str
    message: str
    status: AppealStatus
    created_at: datetime
    closed_at: datetime | None
    closed_by_admin_id: str | None
