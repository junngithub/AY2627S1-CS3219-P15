#!/usr/bin/env bash
# Deploy deploy/ into the LOCAL cluster (Floci k3s) straight from your working
# copy with Helm. Cloud environments use Argo CD instead (ADR-0009); both use
# the same charts and values.
#
#   deploy/local.sh            install / upgrade everything
#   deploy/local.sh status     show releases, Kafka and pods
#   deploy/local.sh check      connectivity tests (helm test): database logins,
#                              Kafka logins and ACLs, HTTP to every service by
#                              name (and its database, if any), the Linkerd mesh
#                              (injection, policy routes accepted, unlisted
#                              callers denied), and requests through the gateway
#                              (routing, auth, header spoofing)
#   deploy/local.sh gateway    port-forward the gateway to http://localhost:8080
#   deploy/local.sh down       uninstall everything and delete the namespaces
#                              (deletes Kafka data)
#
# Needs: helm, kubectl, terraform, and infra/local/aws applied (kubeconfig,
# Postgres on Floci).
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export KUBECONFIG="${KUBECONFIG:-$DEPLOY_DIR/../infra/local/kubeconfig}"

ENV=local
NS=foc
STRIMZI_NS=strimzi
GATEWAY_NS=envoy-gateway-system
CERT_NS=cert-manager
LINKERD_NS=linkerd
VALUES="$DEPLOY_DIR/values"
CHARTS="$DEPLOY_DIR/charts"
PLATFORM_RELEASES=(namespace database kafka gateway) # releases in $NS that are not services
TF_LOCAL="$DEPLOY_DIR/../infra/local/aws"
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
  local node pv ns claim pinned pod stale
  # Floci runs one k3s node, so every node but the newest is from an earlier
  # k3s container. Don't wait for NotReady: that takes ~40s after a restart,
  # and pods (CoreDNS too) stay stuck on the dead node until it's deleted.
  stale=$(kubectl get nodes --sort-by=.metadata.creationTimestamp -o name | sed '$d')
  for node in $stale; do
    log "Removing dead ${node} (k3s container was recreated)"
    kubectl delete "$node" --ignore-not-found
  done
  if [[ -n "$stale" ]]; then
    log "Waiting for cluster DNS on the new node"
    kubectl -n kube-system rollout status deploy/coredns --timeout=3m
  fi
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
        # Wait until it's gone: a pod recreated meanwhile would bind to the
        # dying claim, look ready, then be replaced minutes later.
        kubectl -n "$ns" wait --for=delete "pvc/$claim" --timeout=3m >/dev/null 2>&1 || true
        # Strimzi creates broker claims only when a reconcile starts. A
        # reconcile already running keeps rolling a broker that stays Pending
        # ("persistentvolumeclaim not found"); a fresh one recreates the claim.
        if [[ "$ns" == "$NS" && "$claim" == data-*kafka* ]] &&
          kubectl -n "$STRIMZI_NS" get deploy/strimzi-cluster-operator >/dev/null 2>&1; then
          log "Restarting the Strimzi operator so it recreates $claim"
          kubectl -n "$STRIMZI_NS" rollout restart deploy/strimzi-cluster-operator >/dev/null
        fi
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

  log "Databases on Floci's Postgres: one database, login and <svc>-db Secret per service"
  # Terraform's JSON output is valid YAML, so it's passed as a values file.
  # Kept in a private temp file, never on the command line.
  local dbvalues
  dbvalues="$(mktemp)"
  if ! terraform -chdir="$TF_LOCAL" output -json database >"$dbvalues" 2>/dev/null; then
    rm -f "$dbvalues"
    echo "No database in infra/local/aws state. Run: terraform -chdir=infra/local/aws apply" >&2
    exit 1
  fi
  helm upgrade --install database "$CHARTS/foc-database" -n "$NS" \
    -f "$VALUES/envs/$ENV/database.yaml" -f "$dbvalues" --wait --timeout 5m ||
    { rm -f "$dbvalues"; exit 1; }
  rm -f "$dbvalues"

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

  mesh_platform

  log "Kafka, topics, users"
  helm upgrade --install kafka "$CHARTS/foc-kafka" -n "$NS" \
    -f "$VALUES/envs/$ENV/kafka.yaml"
  kubectl -n "$NS" wait kafka/kafka --for=condition=Ready --timeout=10m
  # Kafka's status can lag behind a broker that's being recreated; wait for the pods too.
  kubectl -n "$NS" wait pod -l strimzi.io/cluster=kafka,strimzi.io/kind=Kafka --for=condition=Ready --timeout=10m
  # The topic and user operators crash-loop while the broker is down, and
  # recreate topics and logins once they're back up.
  kubectl -n "$NS" rollout status deploy/kafka-entity-operator --timeout=10m
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

  remesh

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

# Pods created while Linkerd's injector was down (e.g. right after a Floci
# restart) start without a proxy: its webhook fails open. Helm sees no change
# to restart them for, so restart every Deployment with such a pod.
remesh() {
  local ns d
  for ns in "$NS" "$GATEWAY_NS"; do
    for d in $(kubectl -n "$ns" get pods \
      -o jsonpath='{range .items[?(@.metadata.annotations.linkerd\.io/inject=="enabled")]}{.metadata.ownerReferences[0].name} {.spec.initContainers[*].name} {.spec.containers[*].name}{"\n"}{end}' |
      awk '!/linkerd-proxy/ {sub(/-[^-]+$/, "", $1); print $1}' | sort -u); do
      log "Restarting $ns/deploy/$d (started without the Linkerd proxy)"
      kubectl -n "$ns" rollout restart "deploy/$d" >/dev/null
      kubectl -n "$ns" rollout status "deploy/$d" --timeout=3m
    done
  done
}

# Linkerd and the certificates behind it (ADR-0012), before any service pod is
# created: the proxy is injected when a pod starts.
mesh_platform() {
  log "cert-manager in $CERT_NS"
  helm upgrade --install cert-manager "$CHARTS/cert-manager" -n "$CERT_NS" --create-namespace \
    --wait --timeout 5m

  log "trust-manager in $CERT_NS"
  helm upgrade --install trust-manager "$CHARTS/trust-manager" -n "$CERT_NS" --wait --timeout 5m

  log "Linkerd namespace"
  # Helm doesn't create it with the labels Linkerd needs (its chart only does
  # for `linkerd install`): no webhooks or injection on the control plane, and
  # linkerd-init needs privileged pod security.
  kubectl apply -f - >/dev/null <<NAMESPACE
apiVersion: v1
kind: Namespace
metadata:
  name: $LINKERD_NS
  annotations:
    linkerd.io/inject: disabled
  labels:
    linkerd.io/is-control-plane: "true"
    config.linkerd.io/admission-webhooks: disabled
    linkerd.io/control-plane-ns: $LINKERD_NS
    pod-security.kubernetes.io/enforce: privileged
NAMESPACE

  log "Linkerd CRDs (not Gateway API: Envoy Gateway owns those)"
  helm upgrade --install linkerd-crds "$CHARTS/linkerd-crds" -n "$LINKERD_NS" --wait --timeout 5m

  log "Linkerd trust anchor and identity issuer (cert-manager), trust bundle (trust-manager)"
  helm upgrade --install linkerd-identity "$CHARTS/linkerd-identity" -n "$LINKERD_NS" --wait --timeout 5m
  kubectl -n "$CERT_NS" wait certificate/linkerd-trust-anchor --for=condition=Ready --timeout=3m
  kubectl -n "$LINKERD_NS" wait certificate/linkerd-identity-issuer --for=condition=Ready --timeout=3m
  local attempt
  for attempt in $(seq 60); do
    kubectl -n "$LINKERD_NS" get configmap linkerd-identity-trust-roots >/dev/null 2>&1 && break
    sleep 2
  done
  kubectl -n "$LINKERD_NS" get configmap linkerd-identity-trust-roots >/dev/null

  log "Linkerd control plane in $LINKERD_NS"
  helm upgrade --install linkerd "$CHARTS/linkerd" -n "$LINKERD_NS" --wait --timeout 10m
}

status() {
  require_cluster
  log "Helm releases"
  helm list -n "$STRIMZI_NS"
  helm list -n "$GATEWAY_NS"
  helm list -n "$CERT_NS"
  helm list -n "$LINKERD_NS"
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
  log "Databases: each service's login works on its own database only"
  helm test database -n "$NS" --logs --timeout 3m || failed+=(database)
  log "Kafka: logins and ACLs for every KafkaUser (takes ~2 min)"
  helm test kafka -n "$NS" --logs --timeout 10m || failed+=(kafka)
  log "Mesh: every service pod has a Linkerd proxy and every mesh route is accepted"
  check_mesh || failed+=(mesh)
  for release in $(helm list -n "$NS" -q); do
    [[ " ${PLATFORM_RELEASES[*]} " == *" $release "* ]] && continue
    log "HTTP: http://$release (from another pod in $NS); mesh: unlisted callers get 403"
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

# Linkerd's controller logs a warning for Envoy Gateway's own routes, so a clean
# log proves nothing: check each mesh route's status instead (ADR-0012).
check_mesh() {
  local ok=0 pod route accepted
  for pod in $(kubectl -n "$NS" get pods -l app.kubernetes.io/part-of=foc,app.kubernetes.io/name \
    --field-selector=status.phase=Running -o name); do
    if kubectl -n "$NS" get "$pod" -o jsonpath='{.spec.initContainers[*].name} {.spec.containers[*].name}' |
      grep -qw linkerd-proxy; then
      echo "PASS $pod: meshed"
    else
      echo "FAIL $pod: no linkerd-proxy"
      ok=1
    fi
  done
  for route in $(kubectl -n "$NS" get httproutes.gateway.networking.k8s.io -o name | grep -- '-mesh-'); do
    accepted=$(kubectl -n "$NS" get "$route" \
      -o jsonpath='{range .status.parents[?(@.controllerName=="linkerd.io/policy-controller")]}{.conditions[?(@.type=="Accepted")].status}{end}')
    if [[ "$accepted" == True ]]; then
      echo "PASS $route: accepted by Linkerd"
    else
      echo "FAIL $route: not accepted by Linkerd (${accepted:-no status})"
      ok=1
    fi
  done
  return $ok
}

gateway() {
  require_cluster
  log "Gateway on http://localhost:$GATEWAY_PORT (Ctrl-C to stop). Try:"
  cat <<EOF
  curl localhost:$GATEWAY_PORT/api/v1/supplier                                   # public
  curl localhost:$GATEWAY_PORT/api/v1/orders                                     # 401
  curl localhost:$GATEWAY_PORT/api/v1/user/me -H 'Authorization: Bearer <token from POST /api/v1/user/login>'
EOF
  kubectl -n "$GATEWAY_NS" port-forward "svc/envoy-$NS" "$GATEWAY_PORT:80"
}

down() {
  require_cluster
  log "Uninstalling services, gateway, Kafka, Strimzi, Envoy Gateway, Linkerd, cert-manager; deleting their namespaces"
  local release
  for release in $(helm list -n "$NS" -q); do helm uninstall "$release" -n "$NS"; done
  helm uninstall strimzi -n "$STRIMZI_NS" 2>/dev/null || true
  helm uninstall envoy-gateway -n "$GATEWAY_NS" 2>/dev/null || true
  for release in linkerd linkerd-identity linkerd-crds; do
    helm uninstall "$release" -n "$LINKERD_NS" 2>/dev/null || true
  done
  for release in trust-manager cert-manager; do
    helm uninstall "$release" -n "$CERT_NS" 2>/dev/null || true
  done
  kubectl delete namespace "$NS" "$STRIMZI_NS" "$GATEWAY_NS" "$LINKERD_NS" "$CERT_NS" \
    --ignore-not-found --wait=true
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
