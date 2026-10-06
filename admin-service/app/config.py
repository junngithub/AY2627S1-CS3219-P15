from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Postgres
    database_url: str = "postgresql+asyncpg://admin:admin@db:5432/admin_service"

    # Kafka
    kafka_bootstrap_servers: str = "kafka:9092"
    kafka_topic_conflict_case_created: str = "admin.conflict-case-created"
    kafka_topic_order_under_review: str = "admin.order-under-review"
    kafka_topic_conflict_resolved: str = "admin.conflict-resolved"
    kafka_topic_user_promoted: str = "admin.user.promoted"
    kafka_topic_user_demoted: str = "admin.user.demoted"
    kafka_topic_user_suspended: str = "admin.user.suspended"
    kafka_topic_user_reinstated: str = "admin.user.reinstated"

    # Downstream services
    user_service_base_url: str = "http://user-service:8000"
    order_service_base_url: str = "http://order-service:8000"

    # Shared secret Order Service sends as X-Service-Token on the intake call
    service_api_key: str = ""

    # AI / VLM
    ai_provider_base_url: str = "https://api.anthropic.com"
    ai_provider_api_key: str = ""
    ai_call_timeout_seconds: float = 15.0

    # Conflict resolution timers (F3.3.1 / F3.7.1)
    resolution_deadline_hours: int = 24 * 7
    reminder_before_deadline_hours: int = 24
    # Should the deadline still auto-resolve a case an admin claimed but didn't finish?
    auto_resolve_while_under_review: bool = True
    # Don't auto-follow the AI below this confidence (0.0 = always follow, per F3.5)
    auto_resolve_min_confidence: float = 0.0

    class Config:
        env_file = ".env"


settings = Settings()