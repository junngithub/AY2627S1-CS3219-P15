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

output "vpc_id" {
  description = "vpcId in deploy/values/clusters/nonprod/aws-load-balancer-controller.yaml."
  value       = aws_vpc.this.id
}

output "rds" {
  description = "host for deploy/values/envs/<env>/database.yaml; master_secret_arn for its admin ExternalSecret."
  value = {
    host              = aws_db_instance.foc.address
    port              = aws_db_instance.foc.port
    master_secret_arn = aws_db_instance.foc.master_user_secret[0].secret_arn
  }
}

output "envs" {
  description = "Per env: what deploy/values/envs/<env>/ and .github/cloud/<env>.env need (deploy/cloud-values.sh)."
  value = {
    for env in var.envs : env => {
      frontend_url         = "https://${aws_cloudfront_distribution.frontend[env].domain_name}"
      gateway_target_group = aws_lb_target_group.gateway[env].arn
      photos_bucket        = aws_s3_bucket.photos[env].bucket
      frontend_bucket      = aws_s3_bucket.frontend[env].bucket
      cloudfront_id        = aws_cloudfront_distribution.frontend[env].id
      ses_from_email       = var.ses_from_email
    }
  }
}
