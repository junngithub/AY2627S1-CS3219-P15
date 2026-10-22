# App secrets in Secrets Manager, one per Kubernetes Secret, named
# foc/<env>/<Secret name> with the Secret's keys as JSON. External Secrets
# copies each into namespace foc-<env> (deploy/charts/foc-database and
# foc-service's externalSecrets), so the cloud gets the same Secrets that
# local Helm generates (ADR-0010). Values never pass through git.
locals {
  env_databases = { for pair in setproduct(var.envs, var.databases) : "${pair[0]}/${pair[1]}" => { env = pair[0], service = pair[1] } }
}

resource "random_password" "db_service" {
  for_each = local.env_databases

  length  = 32
  special = false # goes into connection URLs
}

resource "aws_secretsmanager_secret" "db_service" {
  for_each = local.env_databases

  name                    = "foc/${each.value.env}/${each.value.service}-db"
  recovery_window_in_days = 0 # non-prod: allow destroy + re-create under the same name
}

# Same keys as the Secret charts/foc-database writes locally. sslmode=require:
# RDS insists on TLS; node-postgres also verifies the certificate (RDS CA via
# foc-service's databaseCa), Prisma and JDBC only encrypt.
resource "aws_secretsmanager_secret_version" "db_service" {
  for_each = local.env_databases

  secret_id = aws_secretsmanager_secret.db_service[each.key].id
  secret_string = jsonencode({
    DATABASE_URL = format("postgresql://%s:%s@%s:%d/%s?sslmode=require",
    "${each.value.env}_${each.value.service}", random_password.db_service[each.key].result, aws_db_instance.foc.address, aws_db_instance.foc.port, "${each.value.env}_${each.value.service}")
    PGHOST     = aws_db_instance.foc.address
    PGPORT     = tostring(aws_db_instance.foc.port)
    PGDATABASE = "${each.value.env}_${each.value.service}"
    PGUSER     = "${each.value.env}_${each.value.service}"
    PGPASSWORD = random_password.db_service[each.key].result
  })
}

# Secrets that aren't database logins: Secret name → keys.
locals {
  app_secrets = {
    user-otp          = ["OTP_SECRET"]              # user-service, signs OTPs
    order-user-lookup = ["ORDER_USER_LOOKUP_TOKEN"] # order → user Telegram lookup
  }
  env_app_secrets = { for pair in setproduct(var.envs, keys(local.app_secrets)) : "${pair[0]}/${pair[1]}" => { env = pair[0], name = pair[1] } }
  env_app_keys = merge([for k, s in local.env_app_secrets : {
    for key in local.app_secrets[s.name] : "${k}/${key}" => key
  }]...)
}

resource "random_password" "app" {
  for_each = local.env_app_keys

  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "app" {
  for_each = local.env_app_secrets

  name                    = "foc/${each.value.env}/${each.value.name}"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "app" {
  for_each = local.env_app_secrets

  secret_id     = aws_secretsmanager_secret.app[each.key].id
  secret_string = jsonencode({ for key in local.app_secrets[each.value.name] : key => random_password.app["${each.key}/${key}"].result })
}

# Keys from outside AWS: Terraform only creates a placeholder; paste the real
# value in the Secrets Manager console (or `aws secretsmanager put-secret-value`).
# ignore_changes keeps a later apply from overwriting it.
locals {
  external_secrets = {
    admin-ai = { AI_PROVIDER_API_KEY = "" } # Gemini; empty = cases end as ai_failed
  }
  env_external_secrets = { for pair in setproduct(var.envs, keys(local.external_secrets)) : "${pair[0]}/${pair[1]}" => { env = pair[0], name = pair[1] } }
}

resource "aws_secretsmanager_secret" "external" {
  for_each = local.env_external_secrets

  name                    = "foc/${each.value.env}/${each.value.name}"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "external" {
  for_each = local.env_external_secrets

  secret_id     = aws_secretsmanager_secret.external[each.key].id
  secret_string = jsonencode(local.external_secrets[each.value.name])

  lifecycle {
    ignore_changes = [secret_string]
  }
}
