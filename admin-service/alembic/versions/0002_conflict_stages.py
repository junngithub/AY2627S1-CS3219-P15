"""conflict stages: new status enum, review/AI timestamps, unique order_id

Follows init (b84b9a872e82).
Fails at the unique index if duplicate order_ids already exist: dedupe first.
"""
import sqlalchemy as sa
from alembic import op

revision = "0002_conflict_stages"
down_revision = "b84b9a872e82"
branch_labels = None
depends_on = None

NEW = ("created", "ai_evaluated", "ai_failed", "under_review", "resolved")
OLD = ("pending", "non_deadline", "resolved")


def upgrade() -> None:
    # Native PG enum: swap the type via varchar so we can remap values.
    op.execute("ALTER TABLE conflict_cases ALTER COLUMN status TYPE VARCHAR USING status::text")
    op.execute("UPDATE conflict_cases SET status='ai_evaluated' WHERE status='pending'")
    op.execute("UPDATE conflict_cases SET status='ai_failed' WHERE status='non_deadline'")
    op.execute("DROP TYPE conflictstatus")
    sa.Enum(*NEW, name="conflictstatus").create(op.get_bind())
    op.execute("ALTER TABLE conflict_cases ALTER COLUMN status TYPE conflictstatus USING status::conflictstatus")

    op.add_column("conflict_cases", sa.Column("ai_completed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("conflict_cases", sa.Column("review_started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("conflict_cases", sa.Column("review_started_by_admin_id", sa.String(), nullable=True))

    op.drop_index("ix_conflict_cases_order_id", table_name="conflict_cases")
    op.create_index("ix_conflict_cases_order_id", "conflict_cases", ["order_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_conflict_cases_order_id", table_name="conflict_cases")
    op.create_index("ix_conflict_cases_order_id", "conflict_cases", ["order_id"], unique=False)
    op.drop_column("conflict_cases", "review_started_by_admin_id")
    op.drop_column("conflict_cases", "review_started_at")
    op.drop_column("conflict_cases", "ai_completed_at")

    op.execute("ALTER TABLE conflict_cases ALTER COLUMN status TYPE VARCHAR USING status::text")
    op.execute("UPDATE conflict_cases SET status='pending' WHERE status IN ('created','ai_evaluated','under_review')")
    op.execute("UPDATE conflict_cases SET status='non_deadline' WHERE status='ai_failed'")
    op.execute("DROP TYPE conflictstatus")
    sa.Enum(*OLD, name="conflictstatus").create(op.get_bind())
    op.execute("ALTER TABLE conflict_cases ALTER COLUMN status TYPE conflictstatus USING status::conflictstatus")