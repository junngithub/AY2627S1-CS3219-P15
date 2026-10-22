variable "region" {
  type    = string
  default = "ap-southeast-1"
}

variable "state_bucket" {
  description = "Bucket from infra/state, to read ../aws's outputs."
  type        = string
}

variable "repo_url" {
  description = "Git repo Argo CD syncs deploy/ from. Private repos also need a repository credential in Argo CD."
  type        = string
  default     = "https://github.com/junngithub/AY2627S1-CS3219-P15.git"
}

variable "revision" {
  description = "Branch Argo CD follows; must match targetRevision in deploy/argocd/nonprod.yaml."
  type        = string
  default     = "main"
}
