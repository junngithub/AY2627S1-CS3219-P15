"""Unit tests for app.config: no running service needed (unlike the other tests)."""

from app.config import Settings


def make(**env) -> Settings:
    return Settings(_env_file=None, **env)


def test_chart_url_gets_asyncpg_driver():
    # deploy/charts/foc-database writes postgresql:// URLs.
    s = make(database_url="postgresql://u:p@db:5432/local_admin")
    assert s.async_database_url == "postgresql+asyncpg://u:p@db:5432/local_admin"
    assert s.sync_database_url == "postgresql+psycopg2://u:p@db:5432/local_admin"


def test_sslmode_is_renamed_for_asyncpg_only():
    # infra/nonprod/aws/secrets.tf appends ?sslmode=require (RDS requires TLS).
    s = make(database_url="postgresql://u:p@rds:5432/dev_admin?sslmode=require")
    assert s.async_database_url == "postgresql+asyncpg://u:p@rds:5432/dev_admin?ssl=require"
    assert s.sync_database_url == "postgresql+psycopg2://u:p@rds:5432/dev_admin?sslmode=require"


def test_compose_url_still_works():
    s = make(database_url="postgresql+asyncpg://admin:admin@db:5432/admin_service")
    assert s.async_database_url == "postgresql+asyncpg://admin:admin@db:5432/admin_service"
    assert s.sync_database_url == "postgresql+psycopg2://admin:admin@db:5432/admin_service"


def test_kafka_plaintext_without_login(monkeypatch):
    monkeypatch.setenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:29092")
    assert make().kafka_client_options() == {"bootstrap_servers": "kafka:29092"}


def test_kafka_reads_the_charts_variables(monkeypatch):
    # deploy/charts/foc-service sets these when kafka.user is set.
    monkeypatch.setenv("KAFKA_BROKERS", "kafka-kafka-bootstrap:9093")
    monkeypatch.setenv("KAFKA_USERNAME", "admin")
    monkeypatch.setenv("KAFKA_PASSWORD", "secret")
    options = make().kafka_client_options()
    assert options["bootstrap_servers"] == "kafka-kafka-bootstrap:9093"
    assert options["security_protocol"] == "SASL_SSL"
    assert options["sasl_mechanism"] == "SCRAM-SHA-512"
    assert options["sasl_plain_username"] == "admin"
    assert options["sasl_plain_password"] == "secret"
    assert options["ssl_context"] is not None


def test_empty_topic_disables_publish(monkeypatch):
    monkeypatch.setenv("KAFKA_TOPIC_USER_PROMOTED", "")
    assert make().kafka_topic_user_promoted == ""
