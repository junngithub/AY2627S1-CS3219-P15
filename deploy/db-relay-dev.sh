#!/usr/bin/env bash
# Open a local tunnel to dev's RDS Postgres and print the connection details.
# RDS is in private subnets (infra/nonprod/aws/rds.tf), so this runs a socat pod
# in the cluster and `kubectl port-forward`s it to 127.0.0.1:<RELAY_PORT>. The
# tunnel stays up until Ctrl-C, then the pod is deleted. Local Floci: db-relay.sh.
#
#   export AWS_PROFILE=cs3219-dev; unset KUBECONFIG
#   deploy/db-relay-dev.sh                 # admin login, every service database
#   deploy/db-relay-dev.sh admin dev_order # admin login, straight into dev_order
#   deploy/db-relay-dev.sh credit          # credit's own login (its database only)
#
# Logins:
#   admin   RDS master (foc_admin, Secret foc-db-admin). Member of every
#           dev_<service> role, so it can read and write all their tables.
#           One connection = one database: dev_user, dev_credit, dev_order,
#           dev_supplier, dev_admin (switch with \c in psql).
#   <svc>   that service's login (Secret <svc>-db): only its own database.
#
#   RELAY_PORT   local port (default 15433; db-relay.sh uses 15432 for local)
#
# TLS: RDS requires it, and the tunnel passes it through, so clients must use
# sslmode=require. verify-full fails because the hostname is 127.0.0.1.
#
# Needs: kubectl pointed at the dev cluster, jq.
set -euo pipefail

NS="${NS:-foc-dev}"
RELAY_PORT="${RELAY_PORT:-15433}"
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

who="${1:-admin}"
ctx="$(kubectl config current-context 2>/dev/null)" || die "kubectl has no current context"
[[ "$ctx" == *eks* ]] || die "kubectl points at '$ctx', not EKS. Unset KUBECONFIG (and export AWS_PROFILE=cs3219-dev)."

# Secret → its keys, decoded. Both kinds hold PGHOST/PGPORT/PGUSER/PGPASSWORD.
if [[ "$who" == admin ]]; then secret=foc-db-admin; else secret="$who-db"; fi
data="$(kubectl -n "$NS" get secret "$secret" -o json 2>/dev/null)" ||
  die "no Secret $secret in $NS. Logins: admin, $(kubectl -n "$NS" get secrets -o name | sed -n 's#secret/\(.*\)-db$#\1#p' | tr '\n' ' ')"
get() { jq -r --arg k "$1" '.data[$k] // empty | @base64d' <<<"$data"; }
host="$(get PGHOST)" port="$(get PGPORT)" user="$(get PGUSER)" password="$(get PGPASSWORD)"
[[ -n "$host" && -n "$password" ]] || die "Secret $secret is missing PGHOST/PGPASSWORD"
if [[ "$who" == admin ]]; then db="${2:-postgres}"; else db="${2:-$(get PGDATABASE)}"; fi

pod="db-relay-$(whoami | tr -c 'a-z0-9\n' '-')"
cleanup() { kubectl -n "$NS" delete pod "$pod" --ignore-not-found --wait=false >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> Starting relay pod $pod → $host:$port"
kubectl -n "$NS" delete pod "$pod" --ignore-not-found >/dev/null 2>&1
kubectl -n "$NS" run "$pod" --restart=Never --image=alpine/socat \
  --overrides="$(jq -n --arg pod "$pod" --arg target "tcp-connect:$host:$port" '{spec: {containers: [{
    name: $pod, image: "alpine/socat", args: ["tcp-listen:5432,fork,reuseaddr", $target],
    resources: {requests: {cpu: "10m", memory: "16Mi"}, limits: {cpu: "200m", memory: "64Mi"}},
    securityContext: {allowPrivilegeEscalation: false}}]}}')" >/dev/null
kubectl -n "$NS" wait "pod/$pod" --for=condition=Ready --timeout=90s >/dev/null ||
  die "relay pod didn't start (kubectl -n $NS describe pod $pod)"

cat <<EOF

────────────────────────────────────────────────────────────
 Dev RDS via 127.0.0.1:$RELAY_PORT   (login: $who)
────────────────────────────────────────────────────────────
  Host      : 127.0.0.1
  Port      : $RELAY_PORT
  Database  : $db
  User      : $user
  Password  : $password
  SSL mode  : require
────────────────────────────────────────────────────────────
 psql:
   PGPASSWORD='$password' psql "host=127.0.0.1 port=$RELAY_PORT dbname=$db user=$user sslmode=require"
 GUI (DBeaver, TablePlus, ...): the values above, SSL "require", no CA check.

 Databases: dev_user dev_credit dev_order dev_supplier dev_admin  (\\c <name> to switch)
 This is the shared dev database: be careful with writes.

 Tunnel open. Ctrl-C to close it (the relay pod is deleted).
EOF

kubectl -n "$NS" port-forward "pod/$pod" "$RELAY_PORT:5432" >/dev/null
