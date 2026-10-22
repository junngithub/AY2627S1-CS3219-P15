#!/usr/bin/env bash
# Build the frontend and publish it to dev's S3 bucket behind CloudFront
# (infra/nonprod/aws/frontend.tf). The laptop version of
# .github/workflows/frontend-dev.yml, which can't log in to the NUS account
# (infra/docs/cloud-dev.md, "NUS AWS account limits").
#
#   export AWS_PROFILE=cs3219-dev     # `aws sso login` if the session expired
#   deploy/push-frontend-dev.sh
#
# The build has no per-env settings: the app calls /api/v1/... on its own
# origin, which CloudFront sends to the gateway.
#
# Needs: node 22 + npm, aws CLI.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.github/cloud/dev.env"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

# FRONTEND_BUCKET, CLOUDFRONT_ID, AWS_REGION (filled by deploy/cloud-values.sh).
set -a
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a
[[ "$FRONTEND_BUCKET" != TF:* && "$CLOUDFRONT_ID" != TF:* ]] ||
  die "${ENV_FILE#"$ROOT"/} still has TF: placeholders; run deploy/cloud-values.sh nonprod first"

aws sts get-caller-identity >/dev/null 2>&1 ||
  die "not logged in to AWS (export AWS_PROFILE=cs3219-dev; aws sso login)"

if [[ -n "$(git -C "$ROOT" status --porcelain -- frontend)" ]]; then
  echo "warning: frontend/ has uncommitted changes; they will be published too"
fi

log "Building frontend ($(git -C "$ROOT" rev-parse --short HEAD))"
(cd "$ROOT/frontend" && npm ci && npm run build)
DIST="$ROOT/frontend/dist"

log "Uploading to s3://$FRONTEND_BUCKET"
# Hashed bundles never change: cache for a year. Old ones stay, so a page
# loaded just before this deploy can still fetch its bundles.
aws s3 sync "$DIST/assets" "s3://$FRONTEND_BUCKET/assets" --cache-control "public,max-age=31536000,immutable"
aws s3 sync "$DIST" "s3://$FRONTEND_BUCKET" --exclude "assets/*" --exclude index.html --cache-control "public,max-age=300"
# Last, so it only ever points at bundles that are already uploaded.
aws s3 cp "$DIST/index.html" "s3://$FRONTEND_BUCKET/index.html" --cache-control no-cache

log "Invalidating CloudFront $CLOUDFRONT_ID"
aws cloudfront create-invalidation --distribution-id "$CLOUDFRONT_ID" --paths "/*" \
  --query 'Invalidation.Id' --output text

url="$(aws cloudfront get-distribution --id "$CLOUDFRONT_ID" --query 'Distribution.DomainName' --output text)"
log "Published: https://$url (the invalidation takes a minute or two)"
