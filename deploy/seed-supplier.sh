#!/usr/bin/env bash
# Seed Supplier's database with the campus suppliers in
# supplier-service/prisma/seed.ts (21 approved suppliers and their categories).
# Runs it as a one-off Job in the service's `migrate` image, which has ts-node.
#
#   deploy/seed-supplier.sh local          # Floci (infra/local/kubeconfig)
#   deploy/seed-supplier.sh dev            # AWS dev (export AWS_PROFILE=cs3219-dev)
#   deploy/seed-supplier.sh dev --yes      # skip the confirmation
#
# WARNING: the seed first DELETES every supplier, category and supplier action
# in that env's supplier database.
#
# Needs: kubectl. dev: KUBECONFIG unset, so kubectl uses the EKS context.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VALUES="$ROOT/deploy/values"
JOB=supplier-seed

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
yaml_field() { # file section field → value of <section>.<field>, or nothing
  [[ -f "$1" ]] && awk -v s="$2:" -v k="$3" '$1 == s {f = 1; next} f && /^[^ ]/ {exit} f && $1 == k":" {gsub(/"/, "", $2); print $2; exit}' "$1"
}

env="${1:-}"
yes=false
[[ "${2:-}" == "--yes" ]] && yes=true
case "$env" in
  local)
    export KUBECONFIG="$ROOT/infra/local/kubeconfig"
    NS=foc
    pull=Always # :dev is re-pushed by push-local.sh
    ;;
  dev)
    unset KUBECONFIG
    NS=foc-dev
    pull=IfNotPresent # git-SHA tags never change
    ctx="$(kubectl config current-context 2>/dev/null)" || die "kubectl has no current context"
    [[ "$ctx" == *eks* ]] || die "kubectl points at '$ctx', not EKS"
    ;;
  *) die "usage: $0 <local|dev> [--yes]" ;;
esac

registry="$(yaml_field "$VALUES/envs/$env/common.yaml" image registry)"
tag="$(yaml_field "$VALUES/envs/$env/services/supplier.yaml" image tag)"
[[ -n "$registry" && "$registry" != TF:* ]] || die "no image.registry in values/envs/$env/common.yaml"
[[ -n "$tag" ]] || die "no image.tag in values/envs/$env/services/supplier.yaml (deploy supplier first)"
image="$registry/foc/supplier-service:$tag-migrate"

kubectl -n "$NS" get secret supplier-db >/dev/null 2>&1 ||
  die "no Secret supplier-db in $NS (wrong cluster, or not logged in to AWS?)"

if ! $yes; then
  printf 'This DELETES all suppliers, categories and supplier actions in %s, then seeds 21 suppliers.\nType "%s" to continue: ' "$NS" "$env"
  read -r answer
  [[ "$answer" == "$env" ]] || die "cancelled"
fi

kubectl -n "$NS" delete job "$JOB" --ignore-not-found >/dev/null
kubectl -n "$NS" apply -f - >/dev/null <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: $JOB
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 600
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: seed
          image: $image
          imagePullPolicy: $pull
          command: ["node_modules/.bin/ts-node", "prisma/seed.ts"]
          env:
            - name: DATABASE_URL
              valueFrom: { secretKeyRef: { name: supplier-db, key: DATABASE_URL } }
          resources:
            requests: { cpu: 100m, memory: 256Mi }
            limits: { cpu: "1", memory: 512Mi }
          securityContext:
            allowPrivilegeEscalation: false
EOF

echo "Seeding with $image ..."
kubectl -n "$NS" wait --for=condition=complete "job/$JOB" --timeout=5m >/dev/null 2>&1 || true
out="$(kubectl -n "$NS" logs "job/$JOB" 2>&1 || true)"
echo "$out"
# seed.ts logs errors but still exits 0, so check its success line.
grep -q "^Seeded " <<<"$out" || die "seed failed (output above)"
