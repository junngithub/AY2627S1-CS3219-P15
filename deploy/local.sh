#!/usr/bin/env bash
# Deploy deploy/ into the LOCAL cluster (Floci k3s) straight from your working
# copy with Helm. Cloud environments use Argo CD instead (ADR-0009); both use
# the same charts and values.
#
#   deploy/local.sh            install / upgrade everything
#   deploy/local.sh status     show releases, Kafka and pods
#   deploy/local.sh check      connectivity tests (helm test): Kafka logins and
#                              ACLs, HTTP to every service by name, and requests
#                              through the gateway (routing, auth, header spoofing)
#   deploy/local.sh gateway    port-forward the gateway to http://localhost:8080
#   deploy/local.sh down       uninstall everything and delete the namespaces
#                              (deletes Kafka data)
#
# Needs: helm, kubectl, and the kubeconfig written by infra/local/aws.
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export KUBECONFIG="${KUBECONFIG:-$DEPLOY_DIR/../infra/local/kubeconfig}"

ENV=local
NS=foc
STRIMZI_NS=strimzi
GATEWAY_NS=envoy-gateway-system
VALUES="$DEPLOY_DIR/values"
CHARTS="$DEPLOY_DIR/charts"
PLATFORM_RELEASES=(namespace kafka gateway) # releases in $NS that are not services
GATEWAY_PORT="${GATEWAY_PORT:-8080}"

log() { printf '\n==> %s\n' "$*"; }

# CRDs from a vendored chart (.tgz), including its subcharts' crds/ folders.
# Applied server-side: Helm never upgrades CRDs, and some are too large for
# client-side apply.
apply_vendored_crds() {
  local tgz=$1 file
  tar -tzf "$tgz" | grep -E '^([^/]+|[^/]+/charts/[^/]+)/crds/.*\.yaml$' |
    while read -r file; do
      echo "---"
      tar -xzOf "$tgz" "$file"
    done | kubectl apply --server-side --force-conflicts -f - >/dev/null
}

require_cluster() {
  if ! kubectl get --raw /readyz >/dev/null 2>&1; then
    echo "Cannot reach the local cluster (KUBECONFIG=$KUBECONFIG)." >&2
    echo "Start Floci and apply infra/local/aws first (infra/docs/local-floci.md)." >&2
    exit 1
  fi
}

# After Floci restarts, it recreates the k3s container: k3s gets a new node
# name, the old node stays NotReady forever, and local-path volumes (Kafka's
# disk) stay pinned to the old node name, so their pods can never schedule.
# Remove dead nodes and reset volumes pinned to nodes that no longer exist.
# Locally this only loses Kafka's messages; topics and users are recreated.
heal_after_floci_restart() {
  local node pv ns claim pinned pod
  for node in $(kubectl get nodes --no-headers | awk '$2 ~ /NotReady/ {print $1}'); do
    log "Removing dead node $node (k3s container was recreated)"
    kubectl delete node "$node" --ignore-not-found
  done
  local nodes
  nodes=" $(kubectl get nodes -o jsonpath='{.items[*].metadata.name}') "
  kubectl get pv -o jsonpath='{range .items[*]}{.metadata.name} {.spec.claimRef.namespace} {.spec.claimRef.name} {.spec.nodeAffinity.required.nodeSelectorTerms[0].matchExpressions[0].values[0]}{"\n"}{end}' |
    while read -r pv ns claim pinned; do
      [[ -z "$pinned" || "$nodes" == *" $pinned "* ]] && continue
      # Reset the claim only if it is still bound to this stale volume. A claim
      # with the same name may already have been recreated on the new node.
      if [[ "$(kubectl -n "$ns" get pvc "$claim" -o jsonpath='{.spec.volumeName}' 2>/dev/null)" == "$pv" ]]; then
        log "Resetting volume $ns/$claim (pinned to missing node $pinned)"
        for pod in $(kubectl -n "$ns" get pods -o jsonpath='{range .items[*]}{.metadata.name}{" "}{range .spec.volumes[*]}{.persistentVolumeClaim.claimName}{" "}{end}{"\n"}{end}' |
          awk -v c="$claim" '{for (i = 2; i <= NF; i++) if ($i == c) print $1}'); do
          kubectl -n "$ns" delete pod "$pod" --force --grace-period=0 >/dev/null 2>&1 || true
        done
        kubectl -n "$ns" delete pvc "$claim" --ignore-not-found --wait=false >/dev/null
      fi
      # The stale volume's cleanup hook can never run on a node that's gone.
      log "Removing stale volume $pv (pinned to missing node $pinned)"
      kubectl patch pv "$pv" --type=merge -p '{"metadata":{"finalizers":null}}' >/dev/null 2>&1 || true
      kubectl delete pv "$pv" --ignore-not-found --wait=false >/dev/null
    done
}

up() {
  require_cluster
  heal_after_floci_restart

  log "Namespace $NS: quota, default limits, network policy"
  helm upgrade --install namespace "$CHARTS/foc-namespace" -n "$NS" --create-namespace \
    -f "$VALUES/envs/$ENV/namespace.yaml"
  kubectl label namespace "$NS" "foc.io/env=$ENV" --overwrite >/dev/null

  log "Strimzi CRDs"
  apply_vendored_crds "$(ls "$CHARTS"/strimzi/charts/strimzi-kafka-operator-*.tgz)"

  log "Strimzi operator in $STRIMZI_NS"
  helm upgrade --install strimzi "$CHARTS/strimzi" -n "$STRIMZI_NS" --create-namespace --skip-crds \
    -f "$VALUES/clusters/$ENV/strimzi.yaml" --wait --timeout 5m

  log "Envoy Gateway CRDs (Gateway API + Envoy Gateway)"
  apply_vendored_crds "$(ls "$CHARTS"/envoy-gateway/charts/gateway-helm-*.tgz)"

  log "Envoy Gateway controller + GatewayClass in $GATEWAY_NS"
  helm upgrade --install envoy-gateway "$CHARTS/envoy-gateway" -n "$GATEWAY_NS" --create-namespace --skip-crds \
    --wait --timeout 5m

  log "Kafka, topics, users"
  helm upgrade --install kafka "$CHARTS/foc-kafka" -n "$NS" \
    -f "$VALUES/envs/$ENV/kafka.yaml"
  kubectl -n "$NS" wait kafka/kafka --for=condition=Ready --timeout=10m
  # Kafka's status can lag behind a broker that's being recreated; wait for the pods too.
  kubectl -n "$NS" wait pod -l strimzi.io/cluster=kafka,strimzi.io/kind=Kafka --for=condition=Ready --timeout=10m
  kubectl -n "$NS" wait kafkatopic --all --for=condition=Ready --timeout=5m
  kubectl -n "$NS" wait kafkauser --all --for=condition=Ready --timeout=5m

  log "Services"
  local wanted=() file svc
  for file in "$VALUES/envs/$ENV/services"/*.yaml; do
    [[ -e "$file" ]] || continue
    svc="$(basename "$file" .yaml)"
    wanted+=("$svc")
    helm upgrade --install "$svc" "$CHARTS/foc-service" -n "$NS" \
      -f "$VALUES/services/$svc.yaml" \
      -f "$VALUES/envs/$ENV/common.yaml" \
      -f "$file" \
      --wait --timeout 5m
  done

  log "Gateway: routes, auth, identity-header stripping"
  helm upgrade --install gateway "$CHARTS/foc-gateway" -n "$NS"
  kubectl -n "$NS" wait gateway/foc --for=condition=Programmed --timeout=5m

  # Like Argo CD's prune: remove services whose values file was deleted.
  local release
  for release in $(helm list -n "$NS" -q); do
    if [[ " ${PLATFORM_RELEASES[*]} ${wanted[*]:-} " != *" $release "* ]]; then
      log "Removing $release (no values/envs/$ENV/services/$release.yaml)"
      helm uninstall "$release" -n "$NS"
    fi
  done

  status
}

status() {
  require_cluster
  log "Helm releases"
  helm list -n "$STRIMZI_NS"
  helm list -n "$GATEWAY_NS"
  helm list -n "$NS"
  log "Kafka"
  kubectl -n "$NS" get kafka,kafkatopic,kafkauser 2>/dev/null || true
  log "Gateway"
  kubectl -n "$NS" get gateway,httproute,securitypolicy 2>/dev/null || true
  log "Pods"
  kubectl -n "$NS" get pods
}

check() {
  require_cluster
  local failed=() release
  log "Kafka: logins and ACLs for every KafkaUser (takes ~2 min)"
  helm test kafka -n "$NS" --logs --timeout 10m || failed+=(kafka)
  for release in $(helm list -n "$NS" -q); do
    [[ " ${PLATFORM_RELEASES[*]} " == *" $release "* ]] && continue
    log "HTTP: http://$release (from another pod in $NS)"
    helm test "$release" -n "$NS" --logs --timeout 3m || failed+=("$release")
  done
  log "Gateway: routing, auth, header spoofing, public and blocked paths"
  helm test gateway -n "$NS" --logs --timeout 5m || failed+=(gateway)
  if [[ ${#failed[@]} -gt 0 ]]; then
    log "FAILED: ${failed[*]}"
    exit 1
  fi
  log "All connectivity checks passed"
}

gateway() {
  require_cluster
  log "Gateway on http://localhost:$GATEWAY_PORT (Ctrl-C to stop). Try:"
  cat <<EOF
  curl localhost:$GATEWAY_PORT/api/v1/supplier                                   # public
  curl localhost:$GATEWAY_PORT/api/v1/orders                                     # 401
  curl -H 'Authorization: Bearer stub:alice@u.nus.edu' localhost:$GATEWAY_PORT/api/v1/orders
EOF
  kubectl -n "$GATEWAY_NS" port-forward "svc/envoy-$NS" "$GATEWAY_PORT:80"
}

down() {
  require_cluster
  log "Uninstalling services, gateway, Kafka, Strimzi, Envoy Gateway; deleting their namespaces"
  local release
  for release in $(helm list -n "$NS" -q); do helm uninstall "$release" -n "$NS"; done
  helm uninstall strimzi -n "$STRIMZI_NS" 2>/dev/null || true
  helm uninstall envoy-gateway -n "$GATEWAY_NS" 2>/dev/null || true
  kubectl delete namespace "$NS" "$STRIMZI_NS" "$GATEWAY_NS" --ignore-not-found --wait=true
}

case "${1:-up}" in
  up) up ;;
  status) status ;;
  check) check ;;
  gateway) gateway ;;
  down) down ;;
  *)
    echo "usage: $0 [up|status|check|gateway|down]" >&2
    exit 2
    ;;
esac
