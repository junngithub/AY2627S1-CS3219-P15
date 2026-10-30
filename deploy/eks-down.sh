#!/usr/bin/env bash
# Pause dev: remove the EKS cluster and its nodes (most of dev's cost), keep
# everything else. RDS and its data, Secrets Manager, the NLB, CloudFront (same
# URL), the S3 buckets and ECR stay, so deploy/eks-up.sh brings dev back with
# the same IDs and nothing to change in git.
#
#   export AWS_PROFILE=cs3219-dev
#   deploy/eks-down.sh
#
# Lost: everything that only lived in the cluster. Kafka's messages and
# consumer offsets (its disk is deleted), Argo CD's state, Linkerd's
# certificates. Users, orders, credits and suppliers are in RDS and survive.
#
# Still billed while paused (~$40/month): RDS, NLB, NAT instance, Secrets
# Manager. Stop RDS too with: aws rds stop-db-instance --db-instance-identifier foc-nonprod
# (AWS restarts it after 7 days).
#
# Needs: terraform, aws CLI, kubectl, jq.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_AWS="$ROOT/infra/nonprod/aws"
TF_BOOT="$ROOT/infra/nonprod/bootstrap"
CLUSTER=foc-nonprod
REGION=ap-southeast-1

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

account="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)" ||
  die "not logged in to AWS (export AWS_PROFILE=cs3219-dev; aws sso login)"
STATE_BUCKET="foc-tfstate-$account"
# The SES sender is the one value terraform needs that isn't derived: take it
# from the dev values, so this script and a manual apply always agree.
SES_FROM="$(awk '$1 == "SES_FROM_EMAIL:" {print $2; exit}' "$ROOT/deploy/values/envs/dev/services/user.yaml")"
[[ -n "$SES_FROM" ]] || die "no SES_FROM_EMAIL in deploy/values/envs/dev/services/user.yaml"
VARS=(-var "state_bucket=$STATE_BUCKET" -var "ses_from_email=$SES_FROM")

aws eks describe-cluster --name "$CLUSTER" --region "$REGION" >/dev/null 2>&1 ||
  die "cluster $CLUSTER doesn't exist (already down?)"

cat <<EOF
This removes EKS cluster $CLUSTER (account $account) and its nodes.
Kept: RDS + data, secrets, NLB, CloudFront, S3, ECR. Lost: Kafka messages, Argo CD state.
EOF
read -r -p 'Type "down" to continue: ' answer
[[ "$answer" == down ]] || die "cancelled"

# 1. Argo CD first, while the cluster can still be reached: its Terraform state
#    would otherwise point at a cluster that no longer exists.
log "Removing Argo CD (infra/nonprod/bootstrap)"
[[ -d "$TF_BOOT/.terraform" ]] || terraform -chdir="$TF_BOOT" init -input=false -backend-config="bucket=$STATE_BUCKET" >/dev/null
if [[ -n "$(terraform -chdir="$TF_BOOT" state list 2>/dev/null)" ]]; then
  terraform -chdir="$TF_BOOT" destroy -auto-approve -input=false -var "state_bucket=$STATE_BUCKET"
else
  echo "nothing to remove"
fi

# 2. The cluster itself (10-15 minutes).
log "Removing the cluster (infra/nonprod/aws, eks_enabled=false)"
terraform -chdir="$TF_AWS" apply -auto-approve -input=false "${VARS[@]}" -var eks_enabled=false

# 3. Kafka's disk: made by the EBS CSI driver, not Terraform, so nothing else
#    deletes it. Once the nodes are gone it is "available" (detached).
log "Deleting leftover dev disks (Kafka's PVC)"
vols="$(aws ec2 describe-volumes --region "$REGION" \
  --filters "Name=tag:kubernetes.io/created-for/pvc/namespace,Values=foc-dev" "Name=status,Values=available" \
  --query 'Volumes[].VolumeId' --output text)"
for v in $vols; do
  echo "deleting $v"
  aws ec2 delete-volume --region "$REGION" --volume-id "$v"
done
[[ -n "$vols" ]] || echo "none"

# 4. kubectl would otherwise keep pointing at a cluster that is gone.
kubectl config delete-context "arn:aws:eks:$REGION:$account:cluster/$CLUSTER" >/dev/null 2>&1 || true

log "Dev is paused. Bring it back with: deploy/eks-up.sh"
