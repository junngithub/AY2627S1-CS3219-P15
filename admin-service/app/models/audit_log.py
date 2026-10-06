import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AuditLog(Base):
    """
    Append-only. No UPDATE/DELETE should ever be issued against this table from
    application code — enforce that at the DB role level too (NFR2.2):
        REVOKE UPDATE, DELETE ON audit_logs FROM admin_service_app;
    """

    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    admin_id: Mapped[str] = mapped_column(String, index=True, nullable=False)
    action: Mapped[str] = mapped_column(String, nullable=False)  # promote | suspend | reinstate | resolve_conflict
    target_id: Mapped[str] = mapped_column(String, index=True, nullable=False)  # user_id or case_id
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
