variable "chart_version" {
  description = "argo-cd Helm chart version (argoproj/argo-helm). Pinned; bump deliberately."
  type        = string
}

variable "namespace" {
  description = "Namespace Argo CD is installed into."
  type        = string
  default     = "argocd"
}

variable "values" {
  description = "Helm values for the argo-cd chart, as an HCL object."
  type        = any
  default     = {}
}

variable "timeout_seconds" {
  description = "How long to wait for Argo CD to become ready."
  type        = number
  default     = 600
}

variable "root_app" {
  description = <<-EOT
    Optional root Application ("app of apps"). include is a glob relative to
    path, e.g. "{projects/*.yaml,nonprod.yaml}". null = install Argo CD only.
  EOT
  type = object({
    repo_url      = string
    revision      = string
    path          = string
    include       = string
    chart_version = optional(string, "2.0.6") # argocd-apps chart
  })
  default = null
}
