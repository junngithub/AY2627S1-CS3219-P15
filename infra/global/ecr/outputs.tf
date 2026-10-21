output "registry" {
  description = "image.registry in deploy/values/envs/<env>/common.yaml."
  value       = split("/", values(aws_ecr_repository.this)[0].repository_url)[0]
}

output "repository_arns" {
  value = { for name, repo in aws_ecr_repository.this : name => repo.arn }
}
