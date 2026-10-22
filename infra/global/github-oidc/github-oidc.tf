# GitHub Actions gets short-lived AWS credentials through OIDC: no access keys
# stored in GitHub. The workflow asks for role foc-ci with
# aws-actions/configure-aws-credentials; AWS checks the token's repo and branch.
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_policy_document" "ci_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:ref:refs/heads/${var.deploy_branch}"]
    }
  }
}

# Each env adds what it needs to this role (nonprod/aws: the frontend bucket
# and the CloudFront invalidation), so this root never depends on an env.
resource "aws_iam_role" "ci" {
  name               = "foc-ci"
  assume_role_policy = data.aws_iam_policy_document.ci_assume.json
}

data "terraform_remote_state" "ecr" {
  backend = "s3"
  config = {
    bucket = var.state_bucket
    key    = "global/ecr/terraform.tfstate"
    region = var.region
  }
}

data "aws_iam_policy_document" "ecr_push" {
  statement {
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"] # this action has no resource-level permissions
  }
  statement {
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImages",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = values(data.terraform_remote_state.ecr.outputs.repository_arns)
  }
}

resource "aws_iam_role_policy" "ecr_push" {
  name   = "ecr-push"
  role   = aws_iam_role.ci.id
  policy = data.aws_iam_policy_document.ecr_push.json
}
