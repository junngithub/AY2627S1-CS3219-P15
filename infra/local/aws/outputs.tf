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

# Everything deploy/local.sh passes to deploy/charts/foc-database. `address`
# is the Floci container's IP on the Docker network k3s shares; pods can't
# resolve Docker names (ADR-0010).
output "database" {
  sensitive = true
  value = {
    host           = aws_db_instance.foc.address
    port           = aws_db_instance.foc.port
    admin_username = aws_db_instance.foc.username
    admin_password = random_password.db_admin.result
    services       = { for name in var.databases : name => { password = random_password.db_service[name].result } }
  }
}
