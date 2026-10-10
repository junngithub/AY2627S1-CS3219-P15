#!/bin/sh
# kubectl/helm credential plugin for the LOCAL cluster only.
#
# `aws eks get-token` signs a token valid for 60 s but tells clients to reuse
# it for 14 min. Real EKS accepts it for ~15 min; Floci enforces the 60 s. So
# any kubectl/helm operation lasting over a minute fails with "Unauthorized".
# This wrapper passes the token through with a 45 s expirationTimestamp, so
# clients fetch a fresh one before Floci would reject it.
#
# Usage (set by infra/local/aws/kubeconfig.tf):
#   eks-token.sh <cluster-name> <region>
set -eu

token_json=$(aws eks get-token --cluster-name "$1" --region "$2" --output json)

expires_at=$(($(date +%s) + 45))
# GNU date (Linux, Git Bash) uses -d @epoch; BSD date (macOS) uses -r epoch.
expiry=$(date -u -d "@$expires_at" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null ||
  date -u -r "$expires_at" +%Y-%m-%dT%H:%M:%SZ)

printf '%s\n' "$token_json" |
  sed "s/\"expirationTimestamp\": *\"[^\"]*\"/\"expirationTimestamp\": \"$expiry\"/"
