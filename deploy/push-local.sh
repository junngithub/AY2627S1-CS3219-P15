#!/usr/bin/env bash
# Build a FoC image and push it to the LOCAL ECR (Floci), then restart what
# runs it in the local cluster. Cloud images are pushed by CI instead.
#
#   deploy/push-local.sh <service> [tag]   e.g. credit, order, user …
#   deploy/push-local.sh connectivity-stub [tag]
#   deploy/push-local.sh --no-restart <service> [tag]
#
# <service> is a file name in deploy/values/services/ (credit → credit-service/).
# The image name comes from that file. The tag defaults to the one in
# deploy/values/envs/local/services/<service>.yaml (or "dev"). The stub's tag
# defaults to tools/connectivity-stub/package.json's version.
#
# Needs: docker, aws CLI, kubectl. Floci running and infra/local/aws applied.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VALUES="$ROOT/deploy/values"
export KUBECONFIG="${KUBECONFIG:-$ROOT/infra/local/kubeconfig}"
NS=foc

# Floci's fake AWS; only for this script, not your shell.
export AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_PAGER=""
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-ap-southeast-1}" # = infra/local/aws var.region
REGISTRY="000000000000.dkr.ecr.${AWS_DEFAULT_REGION}.localhost:4566"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
yaml_image_field() { # file field → value of image.<field>, or nothing
  [[ -f "$1" ]] && awk -v k="$2" '/^image:/ {f = 1; next} f && /^[^ ]/ {exit} f && $1 == k":" {gsub(/"/, "", $2); print $2; exit}' "$1"
}

restart=true
if [[ "${1:-}" == "--no-restart" ]]; then restart=false; shift; fi
svc="${1:-}"
[[ -n "$svc" ]] || die "usage: $0 [--no-restart] <service|connectivity-stub> [tag]
services: $(cd "$VALUES/services" && ls -- *.yaml | sed 's/\.yaml$//' | tr '\n' ' ')"

if [[ "$svc" == "connectivity-stub" ]]; then
  context="$ROOT/tools/connectivity-stub"
  image="foc/connectivity-stub"
  tag="${2:-$(awk -F'"' '/"version"/ {print $4; exit}' "$context/package.json")}"
else
  [[ -f "$VALUES/services/$svc.yaml" ]] || die "unknown service '$svc' (no deploy/values/services/$svc.yaml)"
  context="$ROOT/$svc-service"
  image="$(yaml_image_field "$VALUES/services/$svc.yaml" name)"
  local_override="$(yaml_image_field "$VALUES/envs/local/services/$svc.yaml" name)"
  if [[ -z "$local_override" ]]; then
    tag="${2:-$(yaml_image_field "$VALUES/envs/local/services/$svc.yaml" tag)}"
  else
    tag="${2:-}"
  fi
  tag="${tag:-dev}"
fi

[[ -d "$context" ]] || die "no folder ${context#"$ROOT"/} yet"
[[ -s "$context/Dockerfile" ]] || die "${context#"$ROOT"/}/Dockerfile is missing or empty"
ref="$REGISTRY/$image:$tag"

aws ecr describe-repositories --repository-names "$image" >/dev/null 2>&1 ||
  die "local ECR has no repository $image. Is Floci running? New image? Add it to var.services / var.tools in infra/local/aws and terraform apply."

log "Building $ref"
docker build -t "$ref" "$context"

log "Pushing to local ECR"
aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null
docker push "$ref" | tail -1

if [[ "${local_override:-}" == foc/connectivity-stub ]]; then
  log "Note: locally, $svc still runs the connectivity stub"
  echo "To run this image instead, edit deploy/values/envs/local/services/$svc.yaml:"
  echo "remove image.name and set image.tag: \"$tag\", then run deploy/local.sh."
  exit 0
fi

$restart || exit 0
# Restart every Deployment in $NS running this exact image (same tag), so pods
# pull the new bytes (local services use pullPolicy: Always).
deploys=$(kubectl -n "$NS" get deploy -o jsonpath='{range .items[*]}{.metadata.name} {.spec.template.spec.containers[0].image}{"\n"}{end}' 2>/dev/null |
  awk -v r="$ref" '$2 == r {print $1}')
if [[ -z "$deploys" ]]; then
  log "Pushed. Nothing in namespace $NS runs $image:$tag yet"
  echo "Set image.tag: \"$tag\" in deploy/values/envs/local/services/<svc>.yaml and run deploy/local.sh."
  exit 0
fi
for d in $deploys; do
  log "Restarting deploy/$d"
  kubectl -n "$NS" rollout restart "deploy/$d" >/dev/null
  kubectl -n "$NS" rollout status "deploy/$d" --timeout=3m
done
