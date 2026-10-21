from fastapi import Depends, HTTPException, Request


class CurrentAdmin:
    def __init__(self, user_id: str):
        self.user_id = user_id


def _header(request: Request, name: str) -> str | None:
    value = request.headers.get(name)
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def _is_true(value: str | None) -> bool:
    return value is not None and value.lower() == "true"


async def require_admin(request: Request) -> CurrentAdmin:
    """
    Identity comes from the API gateway after it calls User authorize:
    x-user-id, x-is-admin, x-permitted-action.

    F2.2/F2.2.1 — a caller who is missing, not an admin, or not permitted
    (inactive, or email/Telegram not verified) gets 404, never 403, so the
    endpoint's existence is not revealed.
    """
    user_id = _header(request, "x-user-id")
    is_admin = _is_true(_header(request, "x-is-admin"))
    permitted = _is_true(_header(request, "x-permitted-action"))
    if not user_id or not is_admin or not permitted:
        raise HTTPException(status_code=404)

    return CurrentAdmin(user_id=user_id)


AdminDep = Depends(require_admin)
