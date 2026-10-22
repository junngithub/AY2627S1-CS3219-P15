#!/usr/bin/env bash
# Build FoC images for the dev env on AWS, push them to ECR as
# foc/<service>:<git sha>, and commit the new tags to
# deploy/values/envs/dev/services/; Argo CD deploys them once that commit is
# on main. This is .github/workflows/deploy-dev.yml run from a laptop: the NUS
# AWS account denies GitHub OIDC (infra/docs/cloud-dev.md, "NUS AWS account
# limits").
#
#   deploy/push-dev.sh                  every image dev runs
#   deploy/push-dev.sh credit order     just these
#   deploy/push-dev.sh --no-commit …    push and edit the values files, don't commit
#
# A service's tag is the last commit that changed its folder, so an unchanged
# service keeps its tag and isn't rebuilt (tags are immutable in ECR; an image
# that already exists is skipped). The folder must have no uncommitted
# changes: the image must match the commit it's named after.
#
# Needs: docker (arm64 builds: native on Apple Silicon), aws CLI logged in to
# the NUS account (e.g. AWS_PROFILE=cs3219-dev, `aws sso login`), git.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VALUES="$ROOT/deploy/values"
DEV="$VALUES/envs/dev"
STUB=connectivity-stub
PLATFORM=linux/arm64 # the EKS nodes are Graviton (infra/nonprod/aws/eks.tf)

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
yaml_image_field() { # file field → value of image.<field>, or nothing
  [[ -f "$1" ]] && awk -v k="$2" '/^image:/ {f = 1; next} f && /^[^ ]/ {exit} f && $1 == k":" {gsub(/"/, "", $2); print $2; exit}' "$1"
}

# Every image dev runs: each service with a dev values file runs its own
# image, unless it overrides image.name with the stub (same rule as
# deploy/push-local.sh).
dev_images() {
  local f svc stub=false
  for f in "$DEV"/services/*.yaml; do
    svc="$(basename "$f" .yaml)"
    if [[ "$(yaml_image_field "$f" name)" == "foc/$STUB" ]]; then stub=true; else echo "$svc"; fi
  done
  if $stub; then echo "$STUB"; fi
}

commit=true
if [[ "${1:-}" == "--no-commit" ]]; then commit=false; shift; fi
if [[ $# -eq 0 ]]; then
  # shellcheck disable=SC2046 # one word per line
  set -- $(dev_images)
fi

registry="$(yaml_image_field "$DEV/common.yaml" registry)"
[[ "$registry" == *.dkr.ecr.*.amazonaws.com ]] ||
  die "image.registry in ${DEV#"$ROOT"/}/common.yaml is '$registry'; run deploy/cloud-values.sh nonprod first"
region="$(cut -d. -f4 <<<"$registry")"
svc_commit() { git -C "$ROOT" log -1 --format=%H -- "$1-service"; } # last commit touching it

for svc in "$@"; do
  if [[ "$svc" == "$STUB" ]]; then continue; fi
  [[ -f "$DEV/services/$svc.yaml" ]] || die "no ${DEV#"$ROOT"/}/services/$svc.yaml (dev doesn't run $svc)"
  [[ -z "$(yaml_image_field "$DEV/services/$svc.yaml" name)" ]] ||
    die "$svc runs the connectivity stub in dev; push $STUB instead"
  [[ -d "$ROOT/$svc-service" ]] || die "no folder $svc-service/"
  git -C "$ROOT" diff --quiet HEAD -- "$svc-service" &&
    [[ -z "$(git -C "$ROOT" ls-files --others --exclude-standard -- "$svc-service")" ]] ||
    die "$svc-service/ has uncommitted changes; commit them first (images are named after commits)"
done

log "Logging in to $registry"
aws ecr get-login-password --region "$region" | docker login --username AWS --password-stdin "$registry" >/dev/null ||
  die "can't log in to ECR. Logged in to the NUS account? (aws sso login, AWS_PROFILE)"

exists() { # repository tag
  aws ecr describe-images --region "$region" --repository-name "$1" --image-ids imageTag="$2" >/dev/null 2>&1
}
build_push() { # ref context [target]
  docker build --platform "$PLATFORM" ${3:+--target "$3"} -t "$1" "$2"
  docker push "$1" | tail -1
}

bumped=() # "svc@short-sha"
for svc in "$@"; do
  if [[ "$svc" == "$STUB" ]]; then
    context="$ROOT/tools/$STUB" image="foc/$STUB"
    svc_tag="$(awk -F'"' '/"version"/ {print $4; exit}' "$context/package.json")" # referenced by version
  else
    context="$ROOT/$svc-service" image="$(yaml_image_field "$VALUES/services/$svc.yaml" name)" svc_tag="$(svc_commit "$svc")"
  fi
  ref="$registry/$image:$svc_tag"

  if exists "$image" "$svc_tag"; then
    log "$image:${svc_tag:0:12} is already in ECR, skipping the build"
  else
    log "Building and pushing $image:${svc_tag:0:12}"
    build_push "$ref" "$context"
    # The pre-deploy migration Job's image (ADR-0011).
    if grep -qiE '^FROM .* AS migrate$' "$context/Dockerfile"; then
      log "Building and pushing $image:${svc_tag:0:12}-migrate"
      build_push "$ref-migrate" "$context" migrate
    fi
  fi

  if [[ "$svc" != "$STUB" ]]; then
    f="$DEV/services/$svc.yaml"
    sed -i.bak -E "s|^  tag: .*|  tag: \"$svc_tag\" # git SHA, set by deploy/push-dev.sh|" "$f" && rm "$f.bak"
    bumped+=("$svc@${svc_tag:0:7}")
  fi
done

[[ ${#bumped[@]} -gt 0 ]] || exit 0
files=() changed=() # only services whose tag actually changed
for b in "${bumped[@]}"; do
  f="$DEV/services/${b%@*}.yaml"
  git -C "$ROOT" diff --quiet -- "$f" || { files+=("$f"); changed+=("$b"); }
done
if [[ ${#files[@]} -eq 0 ]]; then
  log "Dev already runs these images (${bumped[*]}); nothing to commit"
  exit 0
fi
bumped=("${changed[@]}")
if ! $commit; then
  log "Tags set (${bumped[*]}), not committed"
  exit 0
fi
git -C "$ROOT" commit -q -m "chore(dev): deploy ${bumped[*]}" -- "${files[@]}"
log "Committed: $(git -C "$ROOT" log --oneline -1)"
echo "Argo CD deploys it once this commit is on main: push, then merge to main."
