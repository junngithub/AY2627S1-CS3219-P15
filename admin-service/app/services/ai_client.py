import asyncio
import base64
import json
import logging

import httpx

from app.config import settings
from app.models.conflict_case import FaultParty
from app.services.order_photos import EvidencePhoto

logger = logging.getLogger(__name__)

_VALID_PARTIES = {p.value for p in FaultParty}

_PROMPT = (
    "You are assessing a delivery dispute. Each image is labeled just before it: "
    "'collection' is the item when the courier picked it up, 'delivery' is the item "
    "when the courier dropped it off, and 'dispute' is an extra photo from the requester. "
    "Decide who is at fault: 'requester' (claim is false/unfounded or damage pre-existed), "
    "'courier' (different item, new damage, or no proof of delivery), or 'no-fault' "
    "(inconclusive or neither party's doing).\n"
    "Reply with ONLY a JSON object, no prose, no code fences:\n"
    '{"fault_party": "requester|courier|no-fault", "confidence": <0.0-1.0>, "reasoning": "<short>"}\n'
    "Requester's report: "
)

_ROLE_LABEL = {
    "collection": "collection: photo of the item when the courier collected it.",
    "delivery": "delivery: photo of the item when the courier delivered it.",
    "dispute": "dispute: extra photo the requester attached with this report.",
}

_RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "fault_party": {"type": "STRING", "enum": ["requester", "courier", "no-fault"]},
        "confidence": {"type": "NUMBER"},
        "reasoning": {"type": "STRING"},
    },
    "required": ["fault_party", "confidence", "reasoning"],
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


def content_parts(photos: list[EvidencePhoto], comment: str) -> list[dict]:
    """One text label, then the image bytes, for every photo, then the report."""
    parts: list[dict] = []
    for photo in photos:
        parts.append({"text": _ROLE_LABEL.get(photo.role, photo.role)})
        parts.append(
            {
                "inline_data": {
                    "mime_type": photo.mime_type,
                    "data": base64.b64encode(photo.data).decode(),
                }
            }
        )
    parts.append({"text": _PROMPT + comment})
    return parts


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
    photos: list[EvidencePhoto], comment: str
) -> AIRecommendation | None:
    """Returns None on ANY failure (HTTP, timeout, unparseable, invalid enum/confidence)."""
    if not settings.ai_provider_api_key:
        logger.error("AI_PROVIDER_API_KEY is not set")
        return None

    model = settings.ai_model
    endpoint = (
        f"{settings.ai_provider_base_url.rstrip('/')}/v1beta/models/{model}:generateContent"
    )
    parts = content_parts(photos, comment)

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
