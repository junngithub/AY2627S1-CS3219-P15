variable "floci_endpoint" {
  description = "Floci URL that stands in for every AWS endpoint."
  type        = string
  default     = "http://localhost:4566"
}

variable "region" {
  description = "Region used against Floci."
  type        = string
  default     = "ap-southeast-1"
}

variable "cluster_name" {
  description = "Name of the local EKS (k3s) cluster."
  type        = string
  default     = "foc-local"
}

variable "services" {
  description = "One ECR repository is created per service."
  type        = list(string)
  default = [
    "user-service",
    "supplier-service",
    "credit-service",
    "order-service",
    "rating-service",
    "badges-service",
    "admin-service",
  ]
}

variable "tools" {
  description = "Local-only helper images (not services), one ECR repository each."
  type        = list(string)
  default     = ["connectivity-stub"] # tools/connectivity-stub
}
