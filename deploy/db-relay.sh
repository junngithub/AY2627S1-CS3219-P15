#!/usr/bin/env bash
# Open a local TCP relay to Floci's RDS Postgres and print the connection
# details for <pg-user>. Floci's RDS listens on a Docker-internal address that a
# Mac host can't route to directly (ADR-0010), so this runs a socat container on
# Floci's Docker network and publishes it on 127.0.0.1:<RELAY_PORT>.
#
#   deploy/db-relay.sh <pg-user> [database]
#     <pg-user>   REQUIRED: foc_admin | local_credit | local_user | local_supplier
#                 (bare service names credit|user|supplier are accepted too)
#     [database]  optional: defaults to the user's own database (local_<svc>),
#                 or "postgres" for foc_admin
#
#   RELAY_PORT   host port to publish      (default 15432)
#   RELAY_NAME   relay container name      (default foc-pgproxy)
#
#   Stop the relay when done:  docker rm -f foc-pgproxy
#
# Needs: docker, terraform, and infra/local/aws applied (Floci running). Uses jq
# if present, otherwise python3.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_LOCAL="$ROOT/infra/local/aws"
RELAY_NAME="${RELAY_NAME:-foc-pgproxy}"
RELAY_PORT="${RELAY_PORT:-15432}"

log()  { printf '\n==> %s\n' "$*"; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }

# json_get <json> <dot.path>  -> value, or exit 3 if the path is absent.
json_get() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$1" | jq -er ".$2"
  else
    JG_JSON="$1" JG_PATH="$2" python3 -c '
import json, os, sys
cur = json.loads(os.environ["JG_JSON"])
try:
    for k in os.environ["JG_PATH"].split("."):
        cur = cur[k]
except (KeyError, TypeError):
    sys.exit(3)
print(cur)'
  fi
}

# Space-separated list of valid logins, for the error message.
valid_users() {
  local admin svcs out s
  admin="$(json_get "$DB_JSON" admin_username)"
  if command -v jq >/dev/null 2>&1; then
    svcs="$(printf '%s' "$DB_JSON" | jq -r '.services | keys[]')"
  else
    svcs="$(JG_JSON="$DB_JSON" python3 -c 'import json,os
[print(k) for k in json.loads(os.environ["JG_JSON"])["services"]]')"
  fi
  out="$admin"
  for s in $svcs; do out="$out local_$s"; done
  printf '%s' "$out"
}

command -v docker    >/dev/null 2>&1 || die "docker is required"
command -v terraform >/dev/null 2>&1 || die "terraform is required"
command -v jq >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1 || die "need jq or python3 to read terraform output"

PGUSER="${1:-}"
[[ -n "$PGUSER" ]] || die "usage: $0 <pg-user> [database]   (pg-user is required, e.g. local_credit, local_user, foc_admin)"

# Terraform's `database` output holds the host/port and the generated passwords
# (same source the deploy charts use for the <svc>-db Secrets).
DB_JSON="$(terraform -chdir="$TF_LOCAL" output -json database 2>/dev/null)" ||
  die "no 'database' output in $TF_LOCAL state. Run: terraform -chdir=infra/local/aws apply"
[[ -n "$DB_JSON" ]] || die "terraform output 'database' is empty"

ADMIN_USER="$(json_get "$DB_JSON" admin_username)"

# Resolve the password + default database for the requested login.
if [[ "$PGUSER" == "$ADMIN_USER" ]]; then
  PGPW="$(json_get "$DB_JSON" admin_password)"
  DEFAULT_DB="postgres"
else
  svc="${PGUSER#local_}" # accept both "local_credit" and "credit"
  if PGPW="$(json_get "$DB_JSON" "services.$svc.password" 2>/dev/null)"; then
    PGUSER="local_$svc"      # normalise to the real login name
    DEFAULT_DB="local_$svc"
  else
    die "unknown pg user '$PGUSER'. valid: $(valid_users)"
  fi
fi
DB="${2:-$DEFAULT_DB}"

# RDS endpoint (as pods see it) and the Docker network it lives on.
RDS_HOST="$(json_get "$DB_JSON" host)"
RDS_PORT="$(json_get "$DB_JSON" port)"
RDS_CONTAINER="$(docker ps --format '{{.Names}}' | grep -m1 floci-rds || true)"
[[ -n "$RDS_CONTAINER" ]] || die "Floci RDS container not found (is Floci running?)"
NET="$(docker inspect "$RDS_CONTAINER" \
  -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' | head -1)"
[[ -n "$NET" ]] || die "could not determine the RDS container's Docker network"

log "Starting relay '$RELAY_NAME' on 127.0.0.1:$RELAY_PORT  →  $RDS_HOST:$RDS_PORT  (network $NET)"
docker rm -f "$RELAY_NAME" >/dev/null 2>&1 || true
docker run -d --rm --name "$RELAY_NAME" --network "$NET" \
  -p "127.0.0.1:$RELAY_PORT:$RELAY_PORT" \
  alpine/socat "tcp-listen:$RELAY_PORT,fork,reuseaddr" "tcp-connect:$RDS_HOST:$RDS_PORT" >/dev/null

# Best-effort connectivity check (no credentials needed).
PGISREADY="$(command -v pg_isready || true)"
[[ -x "$PGISREADY" ]] || PGISREADY="/Applications/Postgres.app/Contents/Versions/latest/bin/pg_isready"
if [[ -x "$PGISREADY" ]]; then
  if "$PGISREADY" -h 127.0.0.1 -p "$RELAY_PORT" -t 15 >/dev/null 2>&1; then
    log "Relay is accepting connections."
  else
    log "Relay started, but the connectivity check was inconclusive (the server may still be warming up)."
  fi
fi

cat <<EOF

────────────────────────────────────────────────────────────
 Connection credentials (paste into a GUI client)
────────────────────────────────────────────────────────────
  Host      : 127.0.0.1
  Port      : $RELAY_PORT
  Database  : $DB
  User      : $PGUSER
  Password  : $PGPW
  SSL mode  : disable
────────────────────────────────────────────────────────────

 Connection URI:
   postgresql://$PGUSER:$PGPW@127.0.0.1:$RELAY_PORT/$DB?sslmode=disable

 psql:
   PGPASSWORD='$PGPW' psql "host=127.0.0.1 port=$RELAY_PORT dbname=$DB user=$PGUSER sslmode=disable"

 Stop the relay when done:
   docker rm -f $RELAY_NAME
EOF
