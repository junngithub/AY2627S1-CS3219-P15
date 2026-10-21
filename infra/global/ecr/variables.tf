variable "region" {
  description = "Region of the registry; the clusters pull from here."
  type        = string
  default     = "ap-southeast-1"
}

variable "repositories" {
  description = "One ECR repository each, as foc/<name>. Same list as infra/local/aws (services + tools)."
  type        = list(string)
  default = [
    "user-service",
    "supplier-service",
    "credit-service",
    "order-service",
    "rating-service",
    "badges-service",
    "admin-service",
    "connectivity-stub", # runs services without code yet (tools/connectivity-stub)
  ]
}

variable "keep_images" {
  description = "Images kept per repository; older ones expire. Must cover every SHA still deployed in dev, stg and prod."
  type        = number
  default     = 50
}
