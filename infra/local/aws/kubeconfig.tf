# Floci only accepts EKS tokens signed by an access key that exists in its
# IAM; the provider's test/test key is rejected.

resource "aws_iam_user" "admin" {
  name = "${var.cluster_name}-admin"
}

resource "aws_iam_access_key" "admin" {
  user = aws_iam_user.admin.name
}

resource "local_sensitive_file" "kubeconfig" {
  filename        = "${path.module}/../kubeconfig"
  file_permission = "0600"
  content = yamlencode({
    apiVersion      = "v1"
    kind            = "Config"
    current-context = var.cluster_name
    clusters = [{
      name = var.cluster_name
      cluster = {
        server                     = aws_eks_cluster.this.endpoint
        certificate-authority-data = aws_eks_cluster.this.certificate_authority[0].data
      }
    }]
    contexts = [{
      name    = var.cluster_name
      context = { cluster = var.cluster_name, user = aws_iam_user.admin.name }
    }]
    users = [{
      name = aws_iam_user.admin.name
      user = {
        exec = {
          apiVersion      = "client.authentication.k8s.io/v1beta1"
          # Wraps `aws eks get-token` with a 45 s client-side expiry, because
          # Floci rejects tokens older than 60 s (real EKS allows ~15 min).
          command         = abspath("${path.module}/../eks-token.sh")
          args            = [var.cluster_name, var.region]
          interactiveMode = "Never"
          env = [
            { name = "AWS_ACCESS_KEY_ID", value = aws_iam_access_key.admin.id },
            { name = "AWS_SECRET_ACCESS_KEY", value = aws_iam_access_key.admin.secret },
            { name = "AWS_ENDPOINT_URL", value = var.floci_endpoint },
          ]
        }
      }
    }]
  })
}
