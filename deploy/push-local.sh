#!/usr/bin/env bash
# Build FoC images and push them to the LOCAL ECR (Floci), then restart what
# runs them in the local cluster. Cloud images are pushed by CI instead.
#
#   deploy/push-local.sh                         every image the local cluster runs
#   deploy/push-local.sh credit user …           just these
#   deploy/push-local.sh <service> [tag]         one, with a different tag
#   deploy/push-local.sh connectivity-stub [tag]
#   deploy/push-local.sh --no-restart [service…] push only
#
# <service> is a file name in deploy/values/services/ (credit → credit-service/).
# The image name comes from that file. The tag defaults to the one in
# deploy/values/envs/local/services/<service>.yaml (or "dev"). The stub's tag
# defaults to tools/connectivity-stub/package.json's version.
#
# With no service named, the list comes from deploy/values/envs/local/services/:
# each service running its own image, plus the stub if any service runs it.
#
# Needs: docker, aws CLI, kubectl. Floci running and infra/local/aws applied.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VALUES="$ROOT/deploy/values"
export KUBECONFIG="${KUBECONFIG:-$ROOT/infra/local/kubeconfig}"
NS=foc
STUB=connectivity-stub

# Floci's fake AWS; only for this script, not your shell.
export AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_PAGER=""
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-ap-southeast-1}" # = infra/local/aws var.region
REGISTRY="000000000000.dkr.ecr.${AWS_DEFAULT_REGION}.localhost:4566"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
yaml_image_field() { # file field → value of image.<field>, or nothing
  [[ -f "$1" ]] && awk -v k="$2" '/^image:/ {f = 1; next} f && /^[^ ]/ {exit} f && $1 == k":" {gsub(/"/, "", $2); print $2; exit}' "$1"
}
known() { [[ "$1" == "$STUB" || -f "$VALUES/services/$1.yaml" ]]; }

# Every image the local cluster runs, from the local values files.
local_images() {
  local f svc stub=false
  for f in "$VALUES"/envs/local/services/*.yaml; do
    svc="$(basename "$f" .yaml)"
    if [[ "$(yaml_image_field "$f" name)" == "foc/$STUB" ]]; then stub=true; else echo "$svc"; fi
  done
  if $stub; then echo "$STUB"; fi
}

restart=true
if [[ "${1:-}" == "--no-restart" ]]; then restart=false; shift; fi

tag_arg=""
if [[ $# -eq 2 ]] && known "$1" && ! known "$2"; then # <service> <tag>
  tag_arg="$2"
  set -- "$1"
fi
if [[ $# -eq 0 ]]; then
  # shellcheck disable=SC2046 # one word per line
  set -- $(local_images)
fi
for svc in "$@"; do
  known "$svc" || die "unknown service '$svc' (no deploy/values/services/$svc.yaml)
usage: $0 [--no-restart] [service…] | <service> <tag>
services: $(cd "$VALUES/services" && ls -- *.yaml | sed 's/\.yaml$//' | tr '\n' ' ')$STUB"
done

log "Logging in to local ECR"
aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null ||
  die "can't log in to $REGISTRY. Is Floci running?"

pushed=()   # refs to restart
stubbed=()  # services pushed that still run the stub locally
for svc in "$@"; do
  local_override=""
  if [[ "$svc" == "$STUB" ]]; then
    context="$ROOT/tools/$STUB"
    image="foc/$STUB"
    tag="${tag_arg:-$(awk -F'"' '/"version"/ {print $4; exit}' "$context/package.json")}"
  else
    context="$ROOT/$svc-service"
    image="$(yaml_image_field "$VALUES/services/$svc.yaml" name)"
    local_override="$(yaml_image_field "$VALUES/envs/local/services/$svc.yaml" name)"
    if [[ -z "$local_override" ]]; then
      tag="${tag_arg:-$(yaml_image_field "$VALUES/envs/local/services/$svc.yaml" tag)}"
    else
      tag="$tag_arg"
    fi
    tag="${tag:-dev}"
  fi

  [[ -d "$context" ]] || die "no folder ${context#"$ROOT"/} yet"
  [[ -s "$context/Dockerfile" ]] || die "${context#"$ROOT"/}/Dockerfile is missing or empty"
  ref="$REGISTRY/$image:$tag"

  aws ecr describe-repositories --repository-names "$image" >/dev/null 2>&1 ||
    die "local ECR has no repository $image. New image? Add it to var.services / var.tools in infra/local/aws and terraform apply."

  log "Building $ref"
  docker build -t "$ref" "$context"
  log "Pushing $ref"
  docker push "$ref" | tail -1

  # Services with a `migrate` Dockerfile stage also get a "<tag>-migrate" image,
  # which the pre-deploy migration Job runs (ADR-0011).
  if grep -qiE '^FROM .* AS migrate$' "$context/Dockerfile"; then
    log "Building and pushing $ref-migrate"
    docker build --target migrate -t "$ref-migrate" "$context"
    docker push "$ref-migrate" | tail -1
  fi

  if [[ "$local_override" == "foc/$STUB" ]]; then stubbed+=("$svc:$tag"); else pushed+=("$ref"); fi
done

for s in ${stubbed[@]+"${stubbed[@]}"}; do
  log "Note: locally, ${s%%:*} still runs the connectivity stub"
  echo "To run this image instead, edit deploy/values/envs/local/services/${s%%:*}.yaml:"
  echo "remove image.name and set image.tag: \"${s#*:}\", then run deploy/local.sh."
done

$restart || exit 0
[[ ${#pushed[@]} -gt 0 ]] || exit 0
# Restart every Deployment in $NS running one of these exact images (same
# tag), so pods pull the new bytes (local services use pullPolicy: Always).
running=$(kubectl -n "$NS" get deploy -o jsonpath='{range .items[*]}{.metadata.name} {.spec.template.spec.containers[0].image}{"\n"}{end}' 2>/dev/null) || true
deploys=()
for ref in "${pushed[@]}"; do
  found=$(awk -v r="$ref" '$2 == r {print $1}' <<<"$running")
  if [[ -z "$found" ]]; then
    log "Pushed. Nothing in namespace $NS runs ${ref#"$REGISTRY"/} yet"
    echo "Set image.tag: \"${ref##*:}\" in deploy/values/envs/local/services/<svc>.yaml and run deploy/local.sh."
    continue
  fi
  for d in $found; do deploys+=("$d"); done
done
[[ ${#deploys[@]} -gt 0 ]] || exit 0

for d in "${deploys[@]}"; do
  log "Restarting deploy/$d"
  kubectl -n "$NS" rollout restart "deploy/$d" >/dev/null
done
for d in "${deploys[@]}"; do # restarted together, so they roll out in parallel
  kubectl -n "$NS" rollout status "deploy/$d" --timeout=3m
done
