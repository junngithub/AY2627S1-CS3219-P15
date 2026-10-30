"""user reports and suspension appeals

One open report per (reporter, reported) pair, and one open appeal per user.
A closed row does not block a later one: the unique indexes are partial.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0004_user_reports_and_appeals"
down_revision = "0003_audit_logs_append_only"
branch_labels = None
depends_on = None


def upgrade() -> None:
    report_status = postgresql.ENUM("open", "dismissed", "actioned", name="reportstatus", create_type=False)
    appeal_status = postgresql.ENUM("open", "rejected", "reinstated", name="appealstatus", create_type=False)
    report_status.create(op.get_bind(), checkfirst=True)
    appeal_status.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "user_reports",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("reporter_user_id", sa.String(), nullable=False),
        sa.Column("reported_user_id", sa.String(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("status", report_status, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_by_admin_id", sa.String(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_user_reports_reported_user_id", "user_reports", ["reported_user_id"])
    op.create_index(
        "uq_user_reports_open_pair",
        "user_reports",
        ["reporter_user_id", "reported_user_id"],
        unique=True,
        postgresql_where=sa.text("status = 'open'"),
    )

    op.create_table(
        "suspension_appeals",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("status", appeal_status, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_by_admin_id", sa.String(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_suspension_appeals_user_id", "suspension_appeals", ["user_id"])
    op.create_index(
        "uq_suspension_appeals_open_user",
        "suspension_appeals",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("status = 'open'"),
    )


def downgrade() -> None:
    op.drop_index("uq_suspension_appeals_open_user", table_name="suspension_appeals")
    op.drop_index("ix_suspension_appeals_user_id", table_name="suspension_appeals")
    op.drop_table("suspension_appeals")
    op.drop_index("uq_user_reports_open_pair", table_name="user_reports")
    op.drop_index("ix_user_reports_reported_user_id", table_name="user_reports")
    op.drop_table("user_reports")
    sa.Enum(name="appealstatus").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="reportstatus").drop(op.get_bind(), checkfirst=True)
