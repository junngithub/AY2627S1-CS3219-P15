variable "region" {
  type    = string
  default = "ap-southeast-1"
}

variable "github_repository" {
  description = "owner/name of the repo whose workflows may assume the CI role."
  type        = string
  default     = "junngithub/AY2627S1-CS3219-P15"
}

variable "deploy_branch" {
  description = "Only workflows running on this branch get the role (pushes to ECR are for merged code)."
  type        = string
  default     = "main"
}

variable "state_bucket" {
  description = "Bucket from infra/state, to read global/ecr's outputs."
  type        = string
}
