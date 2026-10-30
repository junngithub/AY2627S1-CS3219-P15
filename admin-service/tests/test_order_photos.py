"""Photo fetch and Gemini part layout. No running S3 or Gemini."""

import base64

import pytest
from botocore.exceptions import ClientError

from app.services import ai_client, order_photos
from app.services.order_photos import EvidencePhoto


def test_role_comes_from_the_object_key():
    assert order_photos.role_of("3f1c/collection.jpg") == "collection"
    assert order_photos.role_of("3f1c/delivery.png") == "delivery"
    assert order_photos.role_of("3f1c/dispute.webp") == "dispute"
    assert order_photos.role_of("not-a-photo.txt") is None


def test_every_photo_is_labeled_and_inlined():
    photos = [
        EvidencePhoto("collection", "image/jpeg", b"before"),
        EvidencePhoto("delivery", "image/png", b"after"),
        EvidencePhoto("dispute", "image/webp", b"extra"),
    ]
    parts = ai_client.content_parts(photos, "wrong item")
    labels = [part["text"] for part in parts if "inline_data" not in part]
    images = [part["inline_data"] for part in parts if "inline_data" in part]

    assert labels[0].startswith("collection:")
    assert labels[1].startswith("delivery:")
    assert labels[2].startswith("dispute:")
    assert "wrong item" in labels[3]
    assert [image["mime_type"] for image in images] == ["image/jpeg", "image/png", "image/webp"]
    assert images[0]["data"] == base64.b64encode(b"before").decode()
    assert images[1]["data"] == base64.b64encode(b"after").decode()


class _Body:
    def __init__(self, data: bytes):
        self.data = data

    def read(self) -> bytes:
        return self.data


class _Bucket:
    def __init__(self, objects):
        self.objects = objects
        self.keys = []

    def get_object(self, Bucket, Key):
        self.keys.append((Bucket, Key))
        if Key not in self.objects:
            raise ClientError({"Error": {"Code": "NoSuchKey", "Message": "missing"}}, "GetObject")
        data, content_type = self.objects[Key]
        return {"Body": _Body(data), "ContentType": content_type}


def _use(monkeypatch, bucket: _Bucket):
    monkeypatch.setattr(order_photos.settings, "order_photos_bucket", "foc-dev-order-photos")
    monkeypatch.setattr(order_photos, "_client", lambda: bucket)


@pytest.mark.asyncio
async def test_fetch_reads_each_object_key(monkeypatch):
    bucket = _Bucket(
        {
            "order-1/collection.jpg": (b"a", "image/jpeg"),
            "order-1/delivery.png": (b"b", "image/png"),
        }
    )
    _use(monkeypatch, bucket)
    loaded = await order_photos.fetch_evidence(
        "order-1",
        ["order-1/collection.jpg", "order-1/delivery.png", "order-1/collection.jpg"],
    )
    assert bucket.keys == [
        ("foc-dev-order-photos", "order-1/collection.jpg"),
        ("foc-dev-order-photos", "order-1/delivery.png"),
    ]
    assert [(photo.role, photo.mime_type, photo.data) for photo in loaded] == [
        ("collection", "image/jpeg", b"a"),
        ("delivery", "image/png", b"b"),
    ]


@pytest.mark.asyncio
async def test_one_missing_photo_fails_the_set(monkeypatch):
    bucket = _Bucket({"order-1/collection.jpg": (b"a", "image/jpeg")})
    _use(monkeypatch, bucket)
    loaded = await order_photos.fetch_evidence(
        "order-1",
        ["order-1/collection.jpg", "order-1/delivery.png"],
    )
    assert loaded is None


@pytest.mark.asyncio
async def test_missing_bucket_fails_the_set(monkeypatch):
    monkeypatch.setattr(order_photos.settings, "order_photos_bucket", "")
    loaded = await order_photos.fetch_evidence("order-1", ["order-1/collection.jpg"])
    assert loaded is None
