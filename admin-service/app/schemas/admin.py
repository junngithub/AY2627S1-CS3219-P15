from pydantic import BaseModel


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


class ActionResult(BaseModel):
    user_id: str
    action: str
    propagated: bool  # confirms User Service ack'd the change (F1.2.1/F1.3.1: 60s bound)
