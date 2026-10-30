# Terraform's only action inside the cluster (ADR-0002): install Argo CD and
# the root app. From then on Argo CD creates everything from deploy/argocd.
module "argocd" {
  source = "../../modules/argocd"

  chart_version = "10.10.5" # Argo CD v3.5.5

  values = {
    # One small node: no HA, no Dex (log in as admin with the generated password).
    dex = { enabled = false }
    configs = {
      params = {
        # The UI is reached with kubectl port-forward, never exposed.
        "server.insecure" = true
      }
    }
  }

  root_app = {
    repo_url = var.repo_url
    revision = var.revision
    path     = "deploy/argocd"
    include  = "{projects/*.yaml,nonprod.yaml}"
  }
}
