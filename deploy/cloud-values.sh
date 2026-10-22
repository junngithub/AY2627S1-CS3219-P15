#!/usr/bin/env bash
# Fill the TF:<output> placeholders in the cloud values files (and the CI env
# file) from `terraform output`, after the Terraform roots are applied. Run it
# once per new AWS account/cluster, review the diff, commit.
#
#   deploy/cloud-values.sh nonprod
#
# <output> is a path into the merged outputs of infra/global/ecr,
# infra/global/github-oidc and infra/<cluster>/aws, e.g. rds.host or
# envs.dev.photos_bucket. None of them are secrets.
#
# Needs: terraform (with access to the state bucket), jq.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cluster="${1:?usage: $0 <cluster>   e.g. nonprod}"

outputs="$(
  for dir in global/ecr global/github-oidc "$cluster/aws"; do
    terraform -chdir="$ROOT/infra/$dir" output -json | jq 'map_values(.value)'
  done | jq -s 'add'
)"

case "$cluster" in
  nonprod) envs=(dev stg) ;;
  prod) envs=(prod) ;;
  *) echo "unknown cluster $cluster" >&2; exit 1 ;;
esac
files=("$ROOT/deploy/values/clusters/$cluster"/*.yaml)
for env in "${envs[@]}"; do
  files+=($(find "$ROOT/deploy/values/envs/$env" -name '*.yaml' 2>/dev/null) "$ROOT/.github/cloud/$env.env")
done

missing=0
for f in "${files[@]}"; do
  [[ -f "$f" ]] || continue
  for token in $(grep -oE 'TF:[A-Za-z0-9_.]+' "$f" | sort -u); do
    path="${token#TF:}"
    value="$(jq -r --arg p "$path" 'getpath($p | split(".")) // empty' <<<"$outputs")"
    if [[ -z "$value" ]]; then
      echo "no output $path (in ${f#"$ROOT"/})" >&2
      missing=1
      continue
    fi
    # Values via env vars: ARNs and emails contain / : @, which perl would read.
    T="$token" V="$value" perl -pi -e 's{\Q$ENV{T}\E(?![A-Za-z0-9_.])}{$ENV{V}}g' "$f"
    echo "${f#"$ROOT"/}: $path = $value"
  done
done
exit "$missing"
