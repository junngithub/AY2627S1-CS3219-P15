# AI Assistance Disclosure
# Tool: Cursor (Auto), date: 2026-11-09
# Scope: Implementation assistance for Admin Service application services under author-fixed requirements and architecture.
# Author review: Sahana Avantika generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.

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


_APPEAL_CHOICES = {"uphold", "reinstate", "unsure"}

_APPEAL_PROMPT = (
    "You are advising an admin on a suspension appeal. You do not change the account.\n"
    "Each report below was filed about this user. The user's appeal follows them.\n"
    "Recommend 'uphold' when the reports still justify leaving the suspension in place, "
    "'reinstate' when the appeal answers those reports well enough to lift it, "
    "or 'unsure' when the material is missing, contradictory, or too thin to lean either way.\n"
    "Reply with ONLY a JSON object, no prose, no code fences:\n"
    '{"recommendation": "uphold|reinstate|unsure", "confidence": <0.0-1.0>, "reasoning": "<short>"}\n'
)

_APPEAL_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "recommendation": {"type": "STRING", "enum": ["uphold", "reinstate", "unsure"]},
        "confidence": {"type": "NUMBER"},
        "reasoning": {"type": "STRING"},
    },
    "required": ["recommendation", "confidence", "reasoning"],
}


class AppealAssessment:
    def __init__(self, recommendation: str, confidence: float, reasoning: str):
        self.recommendation = recommendation
        self.confidence = confidence
        self.reasoning = reasoning


def appeal_parts(reports: list[tuple[str, str]], message: str) -> list[dict]:
    """One text part: every report comment, then the appeal."""
    lines = [_APPEAL_PROMPT, "Reports:"]
    if not reports:
        lines.append("(none)")
    else:
        for status, comment in reports:
            lines.append(f"- ({status}) {comment}")
    lines.append("Appeal:")
    lines.append(message)
    return [{"text": "\n".join(lines)}]


def parse_appeal_assessment(text: str) -> AppealAssessment | None:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`").removeprefix("json").strip()
    data = json.loads(text)
    recommendation = data["recommendation"]
    confidence = float(data["confidence"])
    if recommendation not in _APPEAL_CHOICES or not 0.0 <= confidence <= 1.0:
        return None
    return AppealAssessment(recommendation, confidence, str(data.get("reasoning", "")))


async def _generate(parts: list[dict], schema: dict, label: str) -> str | None:
    """Model text, or None on any HTTP or timeout failure. Does not parse it."""
    if not settings.ai_provider_api_key:
        logger.error("AI_PROVIDER_API_KEY is not set")
        return None

    model = settings.ai_model
    endpoint = (
        f"{settings.ai_provider_base_url.rstrip('/')}/v1beta/models/{model}:generateContent"
    )
    payload = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": schema,
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
                    logger.warning("Gemini %s timed out (attempt %s)", label, attempt + 1)
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
                logger.error("Gemini %s failed: %s %s", label, resp.status_code, resp.text[:500])
                return None
            return _extract_text(resp.json())
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        logger.exception("AI %s failed", label)
        return None


async def get_fault_recommendation(
    photos: list[EvidencePhoto], comment: str
) -> AIRecommendation | None:
    """Returns None on ANY failure (HTTP, timeout, unparseable, invalid enum/confidence)."""
    text = await _generate(content_parts(photos, comment), _RESPONSE_SCHEMA, "fault recommendation")
    if text is None:
        return None
    try:
        rec = _parse(text)
    except (ValueError, KeyError, TypeError):
        logger.exception("AI fault recommendation failed")
        return None
    if rec is None:
        logger.error("Gemini returned an unusable fault recommendation: %s", text[:500])
    return rec


async def get_appeal_recommendation(
    reports: list[tuple[str, str]], message: str
) -> AppealAssessment | None:
    """
    Advisory only. `reports` is (status, comment) for every report about the
    appellant, which may be empty. None on any failure.
    """
    text = await _generate(appeal_parts(reports, message), _APPEAL_SCHEMA, "appeal recommendation")
    if text is None:
        return None
    try:
        assessment = parse_appeal_assessment(text)
    except (ValueError, KeyError, TypeError):
        logger.exception("AI appeal recommendation failed")
        return None
    if assessment is None:
        logger.error("Gemini returned an unusable appeal recommendation: %s", text[:500])
    return assessment


_REPORT_CHOICES = {"dismiss", "suspend", "unsure"}

_REPORT_PROMPT = (
    "You are advising an admin on a user report. You do not change the account.\n"
    "Each comment below was filed about the same person. There is no reply from that person yet.\n"
    "Recommend 'dismiss' when the comments are thin, personal, or not a reason to suspend, "
    "'suspend' when they describe conduct that warrants suspending the account, "
    "or 'unsure' when the material is missing, contradictory, or too thin to lean either way.\n"
    "Reply with ONLY a JSON object, no prose, no code fences:\n"
    '{"recommendation": "dismiss|suspend|unsure", "confidence": <0.0-1.0>, "reasoning": "<short>"}\n'
)

_REPORT_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "recommendation": {"type": "STRING", "enum": ["dismiss", "suspend", "unsure"]},
        "confidence": {"type": "NUMBER"},
        "reasoning": {"type": "STRING"},
    },
    "required": ["recommendation", "confidence", "reasoning"],
}


class ReportAssessment:
    def __init__(self, recommendation: str, confidence: float, reasoning: str):
        self.recommendation = recommendation
        self.confidence = confidence
        self.reasoning = reasoning


def report_parts(reports: list[tuple[str, str]]) -> list[dict]:
    """One text part: every report comment about this person."""
    lines = [_REPORT_PROMPT, "Reports:"]
    if not reports:
        lines.append("(none)")
    else:
        for status, comment in reports:
            lines.append(f"- ({status}) {comment}")
    return [{"text": "\n".join(lines)}]


def parse_report_assessment(text: str) -> ReportAssessment | None:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`").removeprefix("json").strip()
    data = json.loads(text)
    recommendation = data["recommendation"]
    confidence = float(data["confidence"])
    if recommendation not in _REPORT_CHOICES or not 0.0 <= confidence <= 1.0:
        return None
    return ReportAssessment(recommendation, confidence, str(data.get("reasoning", "")))


async def get_report_recommendation(reports: list[tuple[str, str]]) -> ReportAssessment | None:
    """Advisory only. `reports` is (status, comment) about one person. None on any failure."""
    text = await _generate(report_parts(reports), _REPORT_SCHEMA, "report recommendation")
    if text is None:
        return None
    try:
        assessment = parse_report_assessment(text)
    except (ValueError, KeyError, TypeError):
        logger.exception("AI report recommendation failed")
        return None
    if assessment is None:
        logger.error("Gemini returned an unusable report recommendation: %s", text[:500])
    return assessment
