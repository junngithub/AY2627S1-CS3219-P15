"""audit_logs rejects update, delete, and truncate

NFR2.2. The app role is not the table owner, and the running connection is
often the Postgres superuser, so REVOKE alone does not stop a mutation.
The triggers do.
"""
from alembic import op

revision = "0003_audit_logs_append_only"
down_revision = "0002_conflict_stages"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The role needs CREATEROLE. In Kubernetes the migration runs as the
    # service's own login, which may not create roles (deploy/charts/foc-database,
    # ADR-0010), so there the role is skipped; the triggers below still make
    # the table append-only for every role.
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_service_app')
               AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user
                           AND (rolcreaterole OR rolsuper)) THEN
                CREATE ROLE admin_service_app NOLOGIN;
            END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_service_app') THEN
                REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM admin_service_app;
            END IF;
        END
        $$;
        """
    )
    op.execute("REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM PUBLIC")
    op.execute(
        """
        CREATE OR REPLACE FUNCTION forbid_audit_log_mutation()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            RAISE EXCEPTION 'audit_logs is append-only';
        END;
        $$;
        """
    )
    op.execute(
        """
        CREATE TRIGGER audit_logs_no_update
        BEFORE UPDATE ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION forbid_audit_log_mutation();
        """
    )
    op.execute(
        """
        CREATE TRIGGER audit_logs_no_delete
        BEFORE DELETE ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION forbid_audit_log_mutation();
        """
    )
    op.execute(
        """
        CREATE TRIGGER audit_logs_no_truncate
        BEFORE TRUNCATE ON audit_logs
        FOR EACH STATEMENT EXECUTE FUNCTION forbid_audit_log_mutation();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS audit_logs_no_truncate ON audit_logs")
    op.execute("DROP TRIGGER IF EXISTS audit_logs_no_delete ON audit_logs")
    op.execute("DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs")
    op.execute("DROP FUNCTION IF EXISTS forbid_audit_log_mutation()")
