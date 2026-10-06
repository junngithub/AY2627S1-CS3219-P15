import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.models.conflict_case import ConflictStatus, FaultParty


class ConflictSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID  # was `str`; pydantic v2 won't coerce a UUID object to str
    order_id: str
    status: ConflictStatus
    resolution_deadline: datetime
    ai_fault_party: FaultParty | None
    ai_confidence: float | None


class ConflictDetail(ConflictSummary):
    comment: str
    evidence_photo_urls: list[str]
    ai_reasoning: str | None
    reporter_user_id: str

    # Stage timeline
    created_at: datetime
    ai_completed_at: datetime | None
    review_started_at: datetime | None
    review_started_by_admin_id: str | None
    resolved_at: datetime | None
    resolved_fault_party: FaultParty | None
    resolved_by_admin_id: str | None
    resolved_automatically: bool


class CreateConflictRequest(BaseModel):
    """Intake body for Order Service escalate (F3.1)."""
    orderId: str
    reporterUserId: str
    comment: str
    photos: list[str] = []


class ClaimConflictResponse(BaseModel):
    case_id: str
    order_id: str
    status: ConflictStatus
    review_started_at: datetime
    review_started_by_admin_id: str


class ResolveConflictRequest(BaseModel):
    """Contract body: { faultParty, decision }."""
    faultParty: FaultParty
    decision: Literal["accept", "reject"]  # accepted / rejected the AI's call


class ResolveConflictResponse(BaseModel):
    case_id: str
    order_id: str
    resolved_fault_party: FaultParty
    resolved_automatically: bool