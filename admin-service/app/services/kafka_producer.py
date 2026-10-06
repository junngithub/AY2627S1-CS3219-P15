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
        bootstrap_servers=settings.kafka_bootstrap_servers,
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
    await _producer.send_and_wait(settings.kafka_topic_conflict_case_created, value=event, key=order_id.encode())
 
 
async def publish_order_under_review(order_id: str, case_id: str) -> None:
    # Admin F1.7 / Order F2.15 — an admin has claimed the case; Order sets the order to Under Review.
    event = _envelope("OrderUnderReview", 1, {"orderId": order_id, "caseId": case_id})
    await _producer.send_and_wait(settings.kafka_topic_order_under_review, value=event, key=order_id.encode())
 
 
async def publish_conflict_resolved(
    order_id: str, case_id: str, fault_party: str, resolved_automatically: bool
) -> None:
    # F3.6/F3.5.1 — sent to Order Service only; Order Service fans out to Credit/Rating (NFR3.1).
    event = _envelope(
        "ConflictResolved",
        1,
        {
            "orderId": order_id,
            "caseId": case_id,
            "faultParty": fault_party,
            "resolvedAutomatically": resolved_automatically,
        },
    )
    await _producer.send_and_wait(settings.kafka_topic_conflict_resolved, value=event, key=order_id.encode())


async def publish_user_promoted(user_id: str, admin_id: str) -> None:
    event = _envelope("UserPromoted", 1, {"userId": user_id, "promotedBy": admin_id})
    await _producer.send_and_wait(settings.kafka_topic_user_promoted, value=event, key=user_id.encode())


async def publish_user_demoted(user_id: str, admin_id: str) -> None:
    # Lets other services drop any cached admin privileges for this user.
    event = _envelope("UserDemoted", 1, {"userId": user_id, "demotedBy": admin_id})
    await _producer.send_and_wait(settings.kafka_topic_user_demoted, value=event, key=user_id.encode())


async def publish_user_suspended(user_id: str, admin_id: str) -> None:
    # F1.2.1 — lets other services (Order, Credit, etc.) block this user's actions.
    event = _envelope("UserSuspended", 1, {"userId": user_id, "suspendedBy": admin_id})
    await _producer.send_and_wait(settings.kafka_topic_user_suspended, value=event, key=user_id.encode())


async def publish_user_reinstated(user_id: str, admin_id: str) -> None:
    # F1.3.1 — lets other services restore this user's access.
    event = _envelope("UserReinstated", 1, {"userId": user_id, "reinstatedBy": admin_id})
    await _producer.send_and_wait(settings.kafka_topic_user_reinstated, value=event, key=user_id.encode())
