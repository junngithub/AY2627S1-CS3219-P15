"""Load dispute photos from Order's S3 bucket.

Conflict intake stores object keys (`{orderId}/collection.jpg`), not bytes.
Kafka is the wrong place for the images, and Gemini cannot read a private
bucket. This job calls GetObject on the same bucket Order writes
(`foc-<env>-order-photos-<account>` in Kubernetes, MinIO locally).

An empty `ORDER_PHOTOS_BUCKET` or any missing object fails the whole set, so
a partial group of photos is never sent to the model.
"""

import asyncio
import logging

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from app.config import settings

logger = logging.getLogger(__name__)

ROLES = ("collection", "delivery", "dispute")

_MIME_BY_EXT = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}


class EvidencePhoto:
    def __init__(self, role: str, mime_type: str, data: bytes):
        self.role = role
        self.mime_type = mime_type
        self.data = data


def role_of(ref: str) -> str | None:
    """`{orderId}/collection.jpg` → `collection`. Unknown names are rejected."""
    name = ref.strip().rstrip("/").rsplit("/", 1)[-1]
    stem = name.rsplit(".", 1)[0].lower()
    if stem in ROLES:
        return stem
    return None


def _mime_type(content_type: str | None, ref: str) -> str:
    header = (content_type or "").split(";", 1)[0].strip().lower()
    if header in _MIME_BY_EXT.values():
        return header
    suffix = "." + ref.rsplit(".", 1)[-1].lower() if "." in ref else ""
    return _MIME_BY_EXT.get(suffix, "")


def _client():
    """Node role in Kubernetes. Static keys only when an endpoint (MinIO) is set."""
    kwargs: dict = {"region_name": settings.order_photos_region}
    if settings.order_photos_endpoint:
        kwargs["endpoint_url"] = settings.order_photos_endpoint
    if settings.order_photos_access_key:
        kwargs["aws_access_key_id"] = settings.order_photos_access_key
        kwargs["aws_secret_access_key"] = settings.order_photos_secret_key
    if settings.order_photos_path_style:
        kwargs["config"] = Config(s3={"addressing_style": "path"})
    return boto3.client("s3", **kwargs)


def _load(chosen: list[tuple[str, str]]) -> list[EvidencePhoto] | None:
    if not settings.order_photos_bucket:
        logger.error("ORDER_PHOTOS_BUCKET is not set")
        return None
    client = _client()
    photos: list[EvidencePhoto] = []
    for role, key in chosen:
        try:
            obj = client.get_object(Bucket=settings.order_photos_bucket, Key=key)
            data = obj["Body"].read()
        except (BotoCoreError, ClientError):
            logger.exception("S3 photo fetch failed for %s", key)
            return None
        if not data:
            logger.error("S3 photo %s is empty", key)
            return None
        mime = _mime_type(obj.get("ContentType"), key)
        if not mime:
            logger.error("S3 photo %s has no image content type", key)
            return None
        photos.append(EvidencePhoto(role, mime, data))
    return photos


async def fetch_evidence(order_id: str, refs: list[str]) -> list[EvidencePhoto] | None:
    """
    Photos in the order Order listed them. `order_id` is unused: the object
    key Order sent is the S3 key. None if any listed photo cannot be loaded.
    An empty ref list returns an empty list.
    """
    del order_id
    chosen: list[tuple[str, str]] = []
    seen: set[str] = set()
    for ref in refs:
        if not ref or not ref.strip():
            continue
        key = ref.strip()
        role = role_of(key)
        if role is None:
            logger.error("Evidence photo ref has no known role: %s", key)
            return None
        if role in seen:
            continue
        seen.add(role)
        chosen.append((role, key))
    if not chosen:
        return []
    return await asyncio.to_thread(_load, chosen)
