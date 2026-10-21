variable "region" {
  type    = string
  default = "ap-southeast-1"
}

variable "state_bucket" {
  description = "Bucket from infra/state, to read the global roots' outputs."
  type        = string
}

variable "cluster_name" {
  type    = string
  default = "foc-nonprod"
}

variable "kubernetes_version" {
  description = "EKS version. Keep it in standard support: extended support costs 6x per hour."
  type        = string
  default     = "1.34"
}

variable "envs" {
  description = "Envs in this cluster, each in namespace foc-<env> (ADR-0001). Add \"stg\" when it's needed."
  type        = list(string)
  default     = ["dev"]
}

variable "ses_from_email" {
  description = "Sender of user-service's emails (SES_FROM_EMAIL): a mailbox you can open, since SES sends it a verification link."
  type        = string
}

variable "cluster_admin_arns" {
  description = "IAM users/roles that get cluster-admin through EKS access entries (e.g. each teammate's SSO role)."
  type        = list(string)
  default     = []
}

variable "node_instance_types" {
  description = "Spot pools for the node group, all arm64 with 2 vCPU / 8 GiB (cost-estimate/dev-environment.md, scenario M)."
  type        = list(string)
  default     = ["t4g.large", "m6g.large", "m7g.large"]
}

variable "node_count" {
  description = "Nodes in the group. Dev needs 2: a t4g.large holds at most 29 pods (VPC CNI: one VPC address per pod), and dev runs about 40, Linkerd proxies included."
  type        = object({ min = number, desired = number, max = number })
  default     = { min = 2, desired = 2, max = 3 }
}

variable "databases" {
  description = "Services that get their own Postgres database and login (ADR-0010). Same as infra/local/aws."
  type        = list(string)
  default     = ["user", "supplier", "credit", "order", "admin"]
}

variable "gateway_target_port" {
  description = "Port the Envoy proxy pods listen on for the Gateway's :80 listener (Envoy Gateway adds 10000 to ports below 1024)."
  type        = number
  default     = 10080
}
