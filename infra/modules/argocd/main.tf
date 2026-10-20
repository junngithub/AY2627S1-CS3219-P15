resource "helm_release" "argocd" {
  name             = "argocd"
  repository       = "https://argoproj.github.io/argo-helm"
  chart            = "argo-cd"
  version          = var.chart_version
  namespace        = var.namespace
  create_namespace = true

  values = [yamlencode(var.values)]

  wait    = true
  timeout = var.timeout_seconds
}

# Root "app of apps": points Argo CD at this cluster's folder in deploy/argocd.
# Everything else in the cluster is created from Git by Argo CD from here on.
resource "helm_release" "root" {
  count = var.root_app == null ? 0 : 1

  name       = "argocd-root"
  repository = "https://argoproj.github.io/argo-helm"
  chart      = "argocd-apps"
  version    = var.root_app.chart_version
  namespace  = var.namespace

  values = [yamlencode({
    applications = {
      root = {
        namespace = var.namespace
        project   = "default"
        source = {
          repoURL        = var.root_app.repo_url
          targetRevision = var.root_app.revision
          path           = var.root_app.path
          directory = {
            recurse = true
            include = var.root_app.include
          }
        }
        destination = {
          server    = "https://kubernetes.default.svc"
          namespace = var.namespace
        }
        syncPolicy = {
          automated = { prune = true, selfHeal = true }
        }
      }
    }
  })]

  depends_on = [helm_release.argocd]
}
