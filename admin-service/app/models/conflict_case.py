import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum, Float, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ConflictStatus(str, enum.Enum):
    created = "created"            # saved; AI evaluation queued/running
    ai_evaluated = "ai_evaluated"  # AI recommendation attached
    ai_failed = "ai_failed"        # AI failed / timed out / invalid output (F3.2.1)
    under_review = "under_review"  # an admin has claimed it
    resolved = "resolved"


# Single source of truth for fault. AI output, admin decision, DB columns and
# Kafka payloads all use this enum. Value "no-fault" kept as-is (hyphen).
class FaultParty(str, enum.Enum):
    requester = "requester"
    courier = "courier"
    no_fault = "no-fault"


def _enum(e):
    return Enum(e, values_callable=lambda objs: [x.value for x in objs])


class ConflictCase(Base):
    __tablename__ = "conflict_cases"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # unique: Order Service retries must not create a 2nd case for the same order
    order_id: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)

    # F3.1 — user report
    reporter_user_id: Mapped[str] = mapped_column(String, nullable=False)
    comment: Mapped[str] = mapped_column(Text, nullable=False)
    evidence_photo_urls: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)

    # F3.2 — AI recommendation (attached right after creation)
    ai_fault_party: Mapped[FaultParty | None] = mapped_column(_enum(FaultParty), nullable=True)
    ai_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    ai_reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[ConflictStatus] = mapped_column(
        _enum(ConflictStatus), default=ConflictStatus.created, nullable=False
    )

    # Review (claim)
    review_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_started_by_admin_id: Mapped[str | None] = mapped_column(String, nullable=True)

    # F3.4.2 — structured outcome
    resolved_fault_party: Mapped[FaultParty | None] = mapped_column(_enum(FaultParty), nullable=True)
    resolved_by_admin_id: Mapped[str | None] = mapped_column(String, nullable=True)
    resolved_automatically: Mapped[bool] = mapped_column(default=False)  # F3.5

    # Timeline: created_at -> ai_completed_at -> review_started_at -> resolved_at
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    ai_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolution_deadline: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    reminder_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)