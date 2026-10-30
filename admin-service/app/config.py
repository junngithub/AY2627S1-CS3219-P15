from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings


def _with_driver(url: str, driver: str, ssl_param: str) -> str:
    """
    Same database URL with an explicit SQLAlchemy driver. Accepts the plain
    postgresql:// URL the Kubernetes chart provides (deploy/charts/foc-database)
    as well as the postgresql+asyncpg:// one used with docker compose. The TLS
    setting is renamed for the driver: libpq and psycopg2 read `sslmode`,
    asyncpg reads `ssl` (same values: disable, prefer, require, ...).
    """
    parts = urlsplit(url)
    scheme = parts.scheme.split("+", 1)[0]
    if scheme == "postgres":
        scheme = "postgresql"
    query = []
    for key, value in parse_qsl(parts.query, keep_blank_values=True):
        if key in ("sslmode", "ssl"):
            key = ssl_param
        query.append((key, value))
    return urlunsplit((f"{scheme}+{driver}", parts.netloc, parts.path, urlencode(query), parts.fragment))


class Settings(BaseSettings):
    # Postgres. Either form works: postgresql://... (Kubernetes) or
    # postgresql+asyncpg://... (docker compose); see async_database_url.
    database_url: str = "postgresql+asyncpg://admin:admin@db:5432/admin_service"

    # Kafka
    # Order's local broker. Host tools use the published port; Compose overrides
    # this with kafka:29092 on Order's network. In Kubernetes the chart sets
    # KAFKA_BROKERS plus the SCRAM login and the cluster CA (ADR-0004).
    kafka_bootstrap_servers: str = Field(
        "localhost:9092", validation_alias=AliasChoices("KAFKA_BOOTSTRAP_SERVERS", "KAFKA_BROKERS")
    )
    kafka_username: str = ""  # set → SASL_SSL with SCRAM; empty → plaintext (compose)
    kafka_password: str = ""
    kafka_sasl_mechanism: str = "SCRAM-SHA-512"
    kafka_ca_cert: str = ""  # path to the broker's CA certificate
    # Logs this service's own events back (a debugging aid). Off in Kubernetes,
    # where the ACLs only let admin read foc.admin.commands.
    kafka_consumer_enabled: bool = True
    # An empty topic name skips that publish: the admin.* topics are not in the
    # cluster's event catalog (deploy/charts/foc-kafka) and nothing consumes them.
    kafka_topic_conflict_case_created: str = "admin.conflict-case-created"
    kafka_topic_admin_events: str = "foc.admin.events"
    kafka_topic_user_promoted: str = "admin.user.promoted"
    kafka_topic_user_demoted: str = "admin.user.demoted"
    kafka_topic_user_suspended: str = "admin.user.suspended"
    kafka_topic_user_reinstated: str = "admin.user.reinstated"

    # Downstream services
    user_service_base_url: str = "http://user-service:8000"
    order_service_base_url: str = "http://order-service:8083"
    # Order's photo bucket. Keys arrive on conflict intake. Empty access key
    # uses the node role (Kubernetes). Endpoint + keys are for local MinIO.
    order_photos_bucket: str = ""
    order_photos_region: str = "ap-southeast-1"
    order_photos_endpoint: str = ""
    order_photos_access_key: str = ""
    order_photos_secret_key: str = ""
    order_photos_path_style: bool = False

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

    @property
    def async_database_url(self) -> str:
        """For the app and Alembic (asyncpg)."""
        return _with_driver(self.database_url, "asyncpg", "ssl")

    @property
    def sync_database_url(self) -> str:
        """For APScheduler's job store (psycopg2)."""
        return _with_driver(self.database_url, "psycopg2", "sslmode")

    def kafka_client_options(self) -> dict:
        """Connection options shared by the producer and the consumer."""
        options: dict = {"bootstrap_servers": self.kafka_bootstrap_servers}
        if self.kafka_username:
            from aiokafka.helpers import create_ssl_context

            options.update(
                security_protocol="SASL_SSL",
                sasl_mechanism=self.kafka_sasl_mechanism,
                sasl_plain_username=self.kafka_username,
                sasl_plain_password=self.kafka_password,
                ssl_context=create_ssl_context(cafile=self.kafka_ca_cert or None),
            )
        return options

    class Config:
        env_file = ".env"


settings = Settings()
