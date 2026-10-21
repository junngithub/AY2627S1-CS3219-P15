import asyncio
import json
import logging

from aiokafka import AIOKafkaConsumer
from aiokafka.errors import KafkaConnectionError

from app.config import settings

logger = logging.getLogger(__name__)

_consumer: AIOKafkaConsumer | None = None
_task: asyncio.Task | None = None

_MAX_STARTUP_RETRIES = 10
_RETRY_DELAY_SECONDS = 3


def _topics() -> list[str]:
    return [
        settings.kafka_topic_conflict_case_created,
        settings.kafka_topic_admin_events,
        settings.kafka_topic_user_promoted,
        settings.kafka_topic_user_demoted,
        settings.kafka_topic_user_suspended,
        settings.kafka_topic_user_reinstated,
    ]


def _ensure_logging() -> None:
    # Uvicorn leaves the root logger at WARNING, so this listener would be silent.
    if logger.handlers:
        return
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(levelname)s %(name)s %(message)s"))
    logger.setLevel(logging.INFO)
    logger.addHandler(handler)


async def _listen() -> None:
    assert _consumer is not None
    try:
        async for msg in _consumer:
            event = msg.value if isinstance(msg.value, dict) else {}
            logger.info(
                "Consumed %s on %s key=%s",
                event.get("eventType"),
                msg.topic,
                msg.key.decode() if isinstance(msg.key, bytes) else msg.key,
            )
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("Kafka listener stopped")


async def start_consumer() -> None:
    """Listen on the topics this service publishes. Other services still get their own copy."""
    global _consumer, _task
    _ensure_logging()
    _consumer = AIOKafkaConsumer(
        *_topics(),
        bootstrap_servers=settings.kafka_bootstrap_servers,
        group_id="admin-service-listener",
        value_deserializer=lambda raw: json.loads(raw.decode("utf-8")),
        auto_offset_reset="latest",
    )
    for attempt in range(1, _MAX_STARTUP_RETRIES + 1):
        try:
            await _consumer.start()
            _task = asyncio.create_task(_listen())
            logger.info("Kafka listener subscribed to %s", ", ".join(_topics()))
            return
        except KafkaConnectionError:
            logger.warning(
                "Kafka listener not ready (attempt %d/%d), retrying in %ds...",
                attempt, _MAX_STARTUP_RETRIES, _RETRY_DELAY_SECONDS,
            )
            await asyncio.sleep(_RETRY_DELAY_SECONDS)
    raise RuntimeError(f"Kafka listener could not connect after {_MAX_STARTUP_RETRIES} attempts")


async def stop_consumer() -> None:
    global _consumer, _task
    if _consumer is not None:
        await _consumer.stop()
    if _task is not None:
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
    _consumer = None
    _task = None
