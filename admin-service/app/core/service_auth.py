import hmac

from fastapi import Depends, Header, HTTPException

from app.config import settings


async def require_service(x_service_token: str = Header(default="")) -> None:
    """Service-to-service auth for Order Service -> Admin intake. Not an admin check."""
    if not settings.service_api_key or not hmac.compare_digest(x_service_token, settings.service_api_key):
        raise HTTPException(status_code=404)  # non-revealing, same as AdminDep


ServiceDep = Depends(require_service)