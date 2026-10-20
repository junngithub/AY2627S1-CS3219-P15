# One Postgres instance for the local env, run by Floci as a real postgres:16
# container behind a proxy on ports 7001-7099 (ADR-0010). Each service gets
# its own database and login, created in the cluster by deploy/charts/foc-database.
#
# Differences from the cloud's rds.tf, because Floci doesn't support them:
# - the admin password is generated here; in the cloud RDS manages it in
#   Secrets Manager (manage_master_user_password);
# - no subnet group or security group; Floci ignores them.
resource "random_password" "db_admin" {
  length  = 32
  special = false # goes into connection URLs
}

resource "random_password" "db_service" {
  for_each = toset(var.databases)

  length  = 32
  special = false
}

resource "aws_db_instance" "foc" {
  identifier        = "foc-local"
  engine            = "postgres"
  engine_version    = "16"
  instance_class    = "db.t4g.micro"
  allocated_storage = 20

  username = "foc_admin"
  password = random_password.db_admin.result

  apply_immediately   = true
  skip_final_snapshot = true # local data is disposable
}
