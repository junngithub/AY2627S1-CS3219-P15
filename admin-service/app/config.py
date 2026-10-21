from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Postgres
    database_url: str = "postgresql+asyncpg://admin:admin@db:5432/admin_service"

    # Kafka
    # Order's local broker. Host tools use the published port; Compose overrides
    # this with kafka:29092 on Order's network.
    kafka_bootstrap_servers: str = "localhost:9092"
    kafka_topic_conflict_case_created: str = "admin.conflict-case-created"
    kafka_topic_admin_events: str = "foc.admin.events"
    kafka_topic_user_promoted: str = "admin.user.promoted"
    kafka_topic_user_demoted: str = "admin.user.demoted"
    kafka_topic_user_suspended: str = "admin.user.suspended"
    kafka_topic_user_reinstated: str = "admin.user.reinstated"

    # Downstream services
    user_service_base_url: str = "http://user-service:8000"
    order_service_base_url: str = "http://order-service:8000"

    # AI / VLM — Gemini Flash. Only AI_PROVIDER_API_KEY is required.
    # 2.5 Flash is closed to new API keys; 3.8 Flash is the current free-tier model.
    ai_provider_base_url: str = "https://generativelanguage.googleapis.com"
    ai_provider_api_key: str = ""
    ai_model: str = "gemini-3.8-flash"
    ai_call_timeout_seconds: float = 60.0

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