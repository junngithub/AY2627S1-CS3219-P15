import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone

from aiokafka import AIOKafkaProducer
from aiokafka.errors import KafkaConnectionError

from app.config import settings

logger = logging.getLogger(__name__)

_producer: AIOKafkaProducer | None = None

_MAX_STARTUP_RETRIES = 10
_RETRY_DELAY_SECONDS = 3


async def start_producer() -> None:
    """
    Retries on startup rather than crashing the whole app: in docker-compose,
    the Kafka *container* can report "started" well before the broker inside
    it is actually accepting connections, so a single failed attempt here
    would otherwise take the entire service down with it.
    """
    global _producer
    _producer = AIOKafkaProducer(
        **settings.kafka_client_options(),
        value_serializer=lambda v: json.dumps(v).encode("utf-8"),
    )

    for attempt in range(1, _MAX_STARTUP_RETRIES + 1):
        try:
            await _producer.start()
            return
        except KafkaConnectionError:
            logger.warning(
                "Kafka not ready yet (attempt %d/%d), retrying in %ds...",
                attempt, _MAX_STARTUP_RETRIES, _RETRY_DELAY_SECONDS,
            )
            await asyncio.sleep(_RETRY_DELAY_SECONDS)

    raise RuntimeError(f"Could not connect to Kafka after {_MAX_STARTUP_RETRIES} attempts")


async def stop_producer() -> None:
    if _producer:
        await _producer.stop()


async def _send(topic: str, event: dict, key: str) -> None:
    # An empty topic name means "not published in this environment" (see config.py).
    if not topic:
        logger.info("Not publishing %s: no topic configured", event.get("eventType"))
        return
    await _producer.send_and_wait(topic, value=event, key=key.encode())


def _order_event(event_type: str, order_id: str, case_id: str) -> dict:
    # Flat message on foc.admin.events. Order reads eventId, eventType, orderId, and caseId.
    return {
        "eventId": str(uuid.uuid4()),
        "eventType": event_type,
        "schemaVersion": 1,
        "occurredAt": datetime.now(timezone.utc).isoformat(),
        "orderId": order_id,
        "caseId": case_id,
    }


def _envelope(event_type: str, version: int, payload: dict) -> dict:
    # Shared envelope across all services per the async communication contract.
    return {
        "eventId": str(uuid.uuid4()),
        "eventType": event_type,
        "version": version,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "payload": payload,
    }


async def publish_conflict_case_created(order_id: str, case_id: str) -> None:
    # F3.1.1 — sent to Order Service on report submission: "a conflict case now exists for this order".
    event = _envelope("ConflictCaseCreated", 1, {"orderId": order_id, "caseId": case_id})
    await _send(settings.kafka_topic_conflict_case_created, event, order_id)
 
 
async def publish_order_under_review(order_id: str, case_id: str) -> None:
    # Admin claims the case. Order applies this only while the order is ESCALATED.
    event = _order_event("admin.review.started", order_id, case_id)
    await _send(settings.kafka_topic_admin_events, event, order_id)
 
 
async def publish_conflict_resolved(order_id: str, case_id: str) -> None:
    # Admin resolves the case. Order applies this only while the order is ESCALATED or UNDER_REVIEW.
    event = _order_event("admin.case.resolved", order_id, case_id)
    await _send(settings.kafka_topic_admin_events, event, order_id)


async def publish_user_promoted(user_id: str, admin_id: str) -> None:
    event = _envelope("UserPromoted", 1, {"userId": user_id, "promotedBy": admin_id})
    await _send(settings.kafka_topic_user_promoted, event, user_id)


async def publish_user_demoted(user_id: str, admin_id: str) -> None:
    # Lets other services drop any cached admin privileges for this user.
    event = _envelope("UserDemoted", 1, {"userId": user_id, "demotedBy": admin_id})
    await _send(settings.kafka_topic_user_demoted, event, user_id)


async def publish_user_suspended(user_id: str, admin_id: str) -> None:
    # F1.2.1 — lets other services (Order, Credit, etc.) block this user's actions.
    event = _envelope("UserSuspended", 1, {"userId": user_id, "suspendedBy": admin_id})
    await _send(settings.kafka_topic_user_suspended, event, user_id)


async def publish_user_reinstated(user_id: str, admin_id: str) -> None:
    # F1.3.1 — lets other services restore this user's access.
    event = _envelope("UserReinstated", 1, {"userId": user_id, "reinstatedBy": admin_id})
    await _send(settings.kafka_topic_user_reinstated, event, user_id)
