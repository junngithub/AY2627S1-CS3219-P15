#!/usr/bin/env bash
# Bring dev back after deploy/eks-down.sh: recreate the EKS cluster, install
# Argo CD, wait for it to deploy everything from `main`, then restart the pods
# so they all join the Linkerd mesh. Same IDs as before, so nothing to commit.
#
#   export AWS_PROFILE=cs3219-dev
#   deploy/eks-up.sh
#
# Takes ~25 minutes: EKS ~12, nodes ~3, Argo CD syncing everything ~10.
#
# Needs: terraform, aws CLI, kubectl, jq.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_AWS="$ROOT/infra/nonprod/aws"
TF_BOOT="$ROOT/infra/nonprod/bootstrap"
CLUSTER=foc-nonprod
REGION=ap-southeast-1
NS=foc-dev

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

account="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)" ||
  die "not logged in to AWS (export AWS_PROFILE=cs3219-dev; aws sso login)"
STATE_BUCKET="foc-tfstate-$account"
SES_FROM="$(awk '$1 == "SES_FROM_EMAIL:" {print $2; exit}' "$ROOT/deploy/values/envs/dev/services/user.yaml")"
[[ -n "$SES_FROM" ]] || die "no SES_FROM_EMAIL in deploy/values/envs/dev/services/user.yaml"

# RDS may have been stopped to save more; the services need it.
rds="$(aws rds describe-db-instances --region "$REGION" --db-instance-identifier "$CLUSTER" \
  --query 'DBInstances[0].DBInstanceStatus' --output text 2>/dev/null || true)"
if [[ "$rds" == stopped ]]; then
  log "Starting RDS (it was stopped)"
  aws rds start-db-instance --region "$REGION" --db-instance-identifier "$CLUSTER" >/dev/null
fi

log "Creating the cluster (infra/nonprod/aws)"
[[ -d "$TF_AWS/.terraform" ]] || terraform -chdir="$TF_AWS" init -input=false -backend-config="bucket=$STATE_BUCKET" >/dev/null
terraform -chdir="$TF_AWS" apply -auto-approve -input=false \
  -var "state_bucket=$STATE_BUCKET" -var "ses_from_email=$SES_FROM" -var eks_enabled=true

log "Pointing kubectl at it"
unset KUBECONFIG # never write the EKS context into infra/local/kubeconfig
aws eks update-kubeconfig --name "$CLUSTER" --region "$REGION" >/dev/null
kubectl get nodes

log "Installing Argo CD (infra/nonprod/bootstrap)"
[[ -d "$TF_BOOT/.terraform" ]] || terraform -chdir="$TF_BOOT" init -input=false -backend-config="bucket=$STATE_BUCKET" >/dev/null
terraform -chdir="$TF_BOOT" apply -auto-approve -input=false -var "state_bucket=$STATE_BUCKET"

log "Waiting for Argo CD to deploy everything (up to 25 minutes)"
apps_ok() { # every Application Synced + Healthy (strimzi's CRD diff is known noise)
  kubectl -n argocd get applications -o json 2>/dev/null | jq -e '
    (.items | length) > 10 and
    all(.items[]; .status.health.status == "Healthy"
      and (.status.sync.status == "Synced" or .metadata.name == "strimzi"))' >/dev/null
}
for _ in $(seq 1 75); do
  if apps_ok; then break; fi
  kubectl -n argocd get applications -o json 2>/dev/null |
    jq -r '[.items[] | select(.status.health.status != "Healthy") | "\(.metadata.name)=\(.status.health.status // "?")"] | "  waiting: " + (if length == 0 then "apps not created yet" else join(" ") end)' || true
  sleep 20
done
apps_ok || echo "warning: not everything is Healthy yet; check the Argo CD UI (see infra/docs/dev-deployment-guide.md)"

# Pods that started before Linkerd's injector was ready run without a proxy
# (it fails open); a restart meshes them, as remesh() does in deploy/local.sh.
log "Restarting pods so every one is meshed"
kubectl -n "$NS" rollout restart deploy >/dev/null
kubectl -n envoy-gateway-system rollout restart deploy >/dev/null
for d in $(kubectl -n "$NS" get deploy -o name); do
  kubectl -n "$NS" rollout status "$d" --timeout=5m | tail -1
done

kubectl -n "$NS" get pods
url="$(terraform -chdir="$TF_AWS" output -json envs | jq -r .dev.frontend_url)"
log "Dev is up: $url"
