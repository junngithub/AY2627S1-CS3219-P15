import json
import logging

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


async def get_fault_recommendation(
    before_photo_url: str, after_photo_url: str, comment: str
) -> AIRecommendation | None:
    """Returns None on ANY failure (HTTP, timeout, unparseable, invalid enum/confidence)."""
    content: list[dict] = [
        {"type": "image", "source": {"type": "url", "url": u}}
        for u in dict.fromkeys([before_photo_url, after_photo_url])
        if u
    ]
    content.append({"type": "text", "text": _PROMPT + comment})

    try:
        async with httpx.AsyncClient(
            base_url=settings.ai_provider_base_url, timeout=settings.ai_call_timeout_seconds
        ) as client:
            resp = await client.post(
                "/v1/messages",
                headers={"x-api-key": settings.ai_provider_api_key, "anthropic-version": "2023-06-01"},
                json={
                    "model": "claude-sonnet-4-6",
                    "max_tokens": 500,
                    "messages": [{"role": "user", "content": content}],
                },
            )
            resp.raise_for_status()
            blocks = resp.json().get("content", [])
            text = "".join(b.get("text", "") for b in blocks if b.get("type") == "text")
            return _parse(text)
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        logger.exception("AI fault recommendation failed")
        return None