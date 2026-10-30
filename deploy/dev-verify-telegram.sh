#!/usr/bin/env bash
# Mark a dev user's Telegram as verified, for while dev has no Telegram bot
# (infra/docs/cloud-dev.md, step 9). Runs a throwaway psql pod with user's own
# database login (Secret user-db) against RDS.
#
#   export AWS_PROFILE=cs3219-dev
#   deploy/dev-verify-telegram.sh e1398329@u.nus.edu
#
# Prints the user's id (for bootstrap-admin). The email must already have
# signed up. Dev only: never use this on prod.
#
# Needs: kubectl pointed at the dev cluster (KUBECONFIG unset), jq.
set -euo pipefail

NS="${NS:-foc-dev}"
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

email="${1:-}"
[[ -n "$email" && $# -eq 1 ]] || die "usage: $0 <email>"
[[ "$email" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || die "'$email' is not an email address"

ctx="$(kubectl config current-context 2>/dev/null)" || die "kubectl has no current context"
[[ "$ctx" == *eks* ]] || die "kubectl points at '$ctx', not EKS. Unset KUBECONFIG (and export AWS_PROFILE=cs3219-dev)."
kubectl -n "$NS" get secret user-db >/dev/null 2>&1 || die "no Secret user-db in $NS (wrong cluster, or not logged in to AWS?)"

pod="verify-telegram-$(date +%s)"
trap 'kubectl -n "$NS" delete pod "$pod" --ignore-not-found --wait=false >/dev/null 2>&1' EXIT

# The email goes in as a psql variable (:'email' quotes it), never into the
# SQL text. psql reads the SQL from a file (variables don't work with -c).
# Like the real Telegram step (user-service/src/telegram.ts), it also queues
# UserVerified in the outbox once email is verified too, so user publishes it
# and credit opens the wallet (verification-events.ts enqueueUserVerified).
sql='WITH updated AS (
  UPDATE "User" SET "telegramVerifiedAt" = COALESCE("telegramVerifiedAt", now())
  WHERE lower(email) = lower(:'"'email'"')
  RETURNING id, email, "emailVerifiedAt", "accessStatus"
), queued AS (
  INSERT INTO "UserVerifiedOutbox" (id, "userId", email)
  SELECT gen_random_uuid(), id, email FROM updated
  WHERE "emailVerifiedAt" IS NOT NULL AND "accessStatus"::text <> '"'SUSPENDED'"'
  ON CONFLICT ("userId") DO NOTHING
)
SELECT id FROM updated;'
# --overrides replaces the whole container (args after `--` would be lost), and
# it must be named like the pod. A detached pod, not `run -i`: psql can finish
# before kubectl attaches.
overrides="$(jq -n --arg pod "$pod" --arg email "$email" --arg sql "$sql" '{spec: {containers: [{
  name: $pod, image: "postgres:16-alpine",
  command: ["sh", "-c", "printf %s \"$SQL\" > /tmp/q.sql && psql -X -q -t -A -v ON_ERROR_STOP=1 -v email=\"$EMAIL\" -f /tmp/q.sql"],
  envFrom: [{secretRef: {name: "user-db"}}],
  env: [{name: "PGSSLMODE", value: "require"}, {name: "EMAIL", value: $email}, {name: "SQL", value: $sql}],
  securityContext: {runAsUser: 70, runAsNonRoot: true, allowPrivilegeEscalation: false}}]}}')"

kubectl -n "$NS" run "$pod" --restart=Never --image=postgres:16-alpine --overrides="$overrides" >/dev/null
kubectl -n "$NS" wait "pod/$pod" --for=jsonpath='{.status.phase}'=Succeeded --timeout=90s >/dev/null 2>&1 || {
  kubectl -n "$NS" logs "$pod" >&2 2>/dev/null || true
  die "psql failed (output above)"
}
id="$(kubectl -n "$NS" logs "$pod")"

id="$(tr -d '[:space:]' <<<"$id")"
[[ -n "$id" ]] || die "no user with email $email in $NS (sign up first)"
echo "Telegram marked verified for $email (user id $id)"
echo "If email is verified too, user publishes UserVerified within seconds and credit opens the wallet."
echo "Refresh the app. To make this user the first admin:"
echo "  kubectl -n $NS exec deploy/user -c user -- node dist/bootstrap-admin.js --user-id $id --confirm"
