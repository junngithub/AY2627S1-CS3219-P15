import asyncio
import json
import logging
from urllib.parse import urlparse

import httpx

from app.config import settings
from app.models.conflict_case import FaultParty

logger = logging.getLogger(__name__)

_VALID_PARTIES = {p.value for p in FaultParty}

_PROMPT = (
    "You are assessing a delivery dispute. The image(s) show the item before collection and after "
    "delivery. Decide who is at fault: 'requester' (claim is false/unfounded or damage pre-existed), "
    "'courier' (different item, new damage, or no proof of delivery), or 'no-fault' "
    "(inconclusive or neither party's doing).\n"
    "Reply with ONLY a JSON object, no prose, no code fences:\n"
    '{"fault_party": "requester|courier|no-fault", "confidence": <0.0-1.0>, "reasoning": "<short>"}\n'
    "Requester's report: "
)

_RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "fault_party": {"type": "STRING", "enum": ["requester", "courier", "no-fault"]},
        "confidence": {"type": "NUMBER"},
        "reasoning": {"type": "STRING"},
    },
    "required": ["fault_party", "confidence", "reasoning"],
}

# External URL fetch supports these image types. Unknown extensions default to jpeg.
_MIME_BY_EXT = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
}


class AIRecommendation:
    def __init__(self, fault_party: str, confidence: float, reasoning: str):
        self.fault_party = fault_party
        self.confidence = confidence
        self.reasoning = reasoning


def _parse(text: str) -> AIRecommendation | None:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`").removeprefix("json").strip()
    data = json.loads(text)
    party = data["fault_party"]
    confidence = float(data["confidence"])
    if party not in _VALID_PARTIES or not 0.0 <= confidence <= 1.0:
        return None  # invalid output == AI failure, never a default verdict
    return AIRecommendation(party, confidence, str(data.get("reasoning", "")))


def _mime_type(url: str) -> str:
    path = urlparse(url).path.lower()
    for ext, mime in _MIME_BY_EXT.items():
        if path.endswith(ext):
            return mime
    return "image/jpeg"


def _image_part(url: str) -> dict | None:
    """Public https URL for Gemini to fetch. This service does not download the photo."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        logger.error("Evidence photo URL is not http(s): %s", url)
        return None
    return {"file_data": {"mime_type": _mime_type(url), "file_uri": url}}


def _extract_text(payload: dict) -> str:
    candidates = payload.get("candidates") or []
    if not candidates:
        return ""
    parts = (candidates[0].get("content") or {}).get("parts") or []
    return "".join(
        part.get("text", "")
        for part in parts
        if not part.get("thought") and part.get("text")
    )


async def get_fault_recommendation(
    before_photo_url: str, after_photo_url: str, comment: str
) -> AIRecommendation | None:
    """Returns None on ANY failure (HTTP, timeout, unparseable, invalid enum/confidence)."""
    if not settings.ai_provider_api_key:
        logger.error("AI_PROVIDER_API_KEY is not set")
        return None

    urls = [u for u in dict.fromkeys([before_photo_url, after_photo_url]) if u]
    model = settings.ai_model
    endpoint = (
        f"{settings.ai_provider_base_url.rstrip('/')}/v1beta/models/{model}:generateContent"
    )

    parts: list[dict] = []
    for url in urls:
        image = _image_part(url)
        if image is None:
            return None
        parts.append(image)
    parts.append({"text": _PROMPT + comment})

    payload = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": _RESPONSE_SCHEMA,
            "maxOutputTokens": 1024,
            "temperature": 0,
            "thinkingConfig": {"thinkingLevel": "low"},
        },
    }

    try:
        async with httpx.AsyncClient(timeout=settings.ai_call_timeout_seconds) as client:
            resp = None
            for attempt in range(3):
                try:
                    resp = await client.post(
                        endpoint,
                        headers={"x-goog-api-key": settings.ai_provider_api_key},
                        json=payload,
                    )
                except httpx.TimeoutException:
                    logger.warning("Gemini fault recommendation timed out (attempt %s)", attempt + 1)
                    resp = None
                if resp is not None and resp.status_code not in (429, 503):
                    break
                if attempt < 2:
                    wait = 3 * (attempt + 1)
                    code = resp.status_code if resp is not None else "timeout"
                    logger.warning("Gemini busy (%s), retrying in %ss", code, wait)
                    await asyncio.sleep(wait)
            if resp is None:
                return None
            if resp.status_code >= 400:
                logger.error(
                    "Gemini fault recommendation failed: %s %s",
                    resp.status_code,
                    resp.text[:500],
                )
                return None
            text = _extract_text(resp.json())
            rec = _parse(text)
            if rec is None:
                logger.error("Gemini returned an unusable fault recommendation: %s", text[:500])
            return rec
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        logger.exception("AI fault recommendation failed")
        return None
