# Everything pods need from AWS, granted to the node role (ADR-0013). Every
# pod on a node shares these permissions: the NUS organization's service
# control policy explicitly denies the per-pod alternatives (EKS Pod Identity's
# eks-auth:AssumeRoleForPodIdentity, IRSA's sts:AssumeRoleWithWebIdentity) and
# sts:AssumeRole, so a narrower role per workload can't be assumed. Each
# statement stays scoped to its resources. The SDKs find these credentials
# through the instance metadata service (hop limit 2, eks.tf).
#
# If NUS lifts those denies, move each statement back to its own Pod Identity
# role: see ADR-0013, "Reverting to per-pod roles".
data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "node_workloads" {
  # AWS Load Balancer Controller: keep Envoy's pods registered in the gateway
  # target groups Terraform made (TargetGroupBinding, gateway-lb.tf). It never
  # creates load balancers.
  statement {
    sid = "LoadBalancerControllerDescribe"
    actions = [
      "ec2:DescribeAvailabilityZones",
      "ec2:DescribeInstances",
      "ec2:DescribeNetworkInterfaces",
      "ec2:DescribeSecurityGroups",
      "ec2:DescribeSubnets",
      "ec2:DescribeVpcs",
      "elasticloadbalancing:DescribeListeners",
      "elasticloadbalancing:DescribeLoadBalancers",
      "elasticloadbalancing:DescribeTags",
      "elasticloadbalancing:DescribeTargetGroups",
      "elasticloadbalancing:DescribeTargetHealth",
    ]
    resources = ["*"] # Describe* has no resource-level permissions
  }
  statement {
    sid       = "LoadBalancerControllerTargets"
    actions   = ["elasticloadbalancing:RegisterTargets", "elasticloadbalancing:DeregisterTargets"]
    resources = [for tg in aws_lb_target_group.gateway : tg.arn]
  }

  # External Secrets: each env's secrets (secrets.tf) and the RDS admin login.
  statement {
    sid     = "ExternalSecretsRead"
    actions = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = concat(
      [for env in var.envs : "arn:aws:secretsmanager:${var.region}:${data.aws_caller_identity.current.account_id}:secret:foc/${env}/*"],
      [aws_db_instance.foc.master_user_secret[0].secret_arn],
    )
  }

  # user-service: OTP and password-reset emails (EMAIL_PROVIDER=ses).
  # Any identity, not just the sender's: in the SES sandbox the recipient must
  # be a verified identity too, and SES checks this permission against it
  # (AccessDeniedException otherwise). The From address stays locked to ours.
  statement {
    sid       = "UserSendEmail"
    actions   = ["ses:SendEmail"]
    resources = ["arn:aws:ses:${var.region}:${data.aws_caller_identity.current.account_id}:identity/*"]
    condition {
      test     = "StringEquals"
      variable = "ses:FromAddress"
      values   = [var.ses_from_email]
    }
  }

  # order-service: collection, delivery and dispute photos (order.photos.mode=s3).
  statement {
    sid       = "OrderPhotos"
    actions   = ["s3:PutObject", "s3:DeleteObject"]
    resources = [for b in aws_s3_bucket.photos : "${b.arn}/*"]
  }
}

resource "aws_iam_role_policy" "node_workloads" {
  name   = "foc-workloads"
  role   = aws_iam_role.node.id
  policy = data.aws_iam_policy_document.node_workloads.json
}
