# AI Assistance Disclosure
# Tool: Cursor (Auto), date: 2026-11-09
# Scope: Implementation assistance for Admin Service request/response schemas under author-fixed requirements and architecture.
# Author review: Sahana Avantika generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.

from pydantic import BaseModel

from app.schemas.camel import CamelModel


class UserSummary(BaseModel):
    id: str
    name: str
    email: str
    role: str
    status: str  # Created | Verified | Suspended


class UserListResponse(BaseModel):
    items: list[UserSummary]
    page: int
    total: int


class ActionResult(CamelModel):
    user_id: str
    action: str
    propagated: bool  # confirms User Service ack'd the change (F1.2.1/F1.3.1: 60s bound)
