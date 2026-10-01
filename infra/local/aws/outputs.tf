output "cluster_name" {
  value = aws_eks_cluster.this.name
}

output "cluster_endpoint" {
  value = aws_eks_cluster.this.endpoint
}

output "cluster_ca_data" {
  description = "Base64-encoded cluster CA certificate."
  value       = aws_eks_cluster.this.certificate_authority[0].data
}

output "region" {
  value = var.region
}

output "floci_endpoint" {
  value = var.floci_endpoint
}

output "admin_access_key_id" {
  value = aws_iam_access_key.admin.id
}

output "admin_secret_access_key" {
  value     = aws_iam_access_key.admin.secret
  sensitive = true
}

output "kubeconfig_path" {
  description = "export KUBECONFIG=<this> to use kubectl against the local cluster."
  value       = abspath(local_sensitive_file.kubeconfig.filename)
}

output "ecr_repository_urls" {
  value = merge(
    { for name, repo in aws_ecr_repository.service : name => repo.repository_url },
    { for name, repo in aws_ecr_repository.tool : name => repo.repository_url },
  )
}
