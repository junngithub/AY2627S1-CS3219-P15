# Each env's web app at https://<id>.cloudfront.net (infra/docs/frontend-s3-cloudfront.md;
# no custom domain, so CloudFront's own name and certificate):
# one CloudFront distribution, one origin for the page and the API, so the
# browser never makes a cross-origin request and one build serves every env.
#   default → private S3 bucket (Origin Access Control), SPA fallback function
#   /api/*  → the env's internal gateway NLB (VPC origin), never cached
resource "aws_s3_bucket" "frontend" {
  for_each = toset(var.envs)

  bucket        = "foc-${each.value}-frontend-${data.aws_caller_identity.current.account_id}"
  force_destroy = true # only build output; CI re-uploads it
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  for_each = aws_s3_bucket.frontend

  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "frontend" {
  for_each = toset(var.envs)

  name                              = "foc-${each.value}-frontend"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Only this env's distribution may read the bucket.
data "aws_iam_policy_document" "frontend_bucket" {
  for_each = toset(var.envs)

  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.frontend[each.value].arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.frontend[each.value].arn]
    }
  }
}

resource "aws_s3_bucket_policy" "frontend" {
  for_each = toset(var.envs)

  bucket = aws_s3_bucket.frontend[each.value].id
  policy = data.aws_iam_policy_document.frontend_bucket[each.value].json
}

# Client-side routes (/orders/123) have no file in the bucket: serve
# index.html for any path without a dot. Only on the S3 behaviour: a
# distribution-wide 404 → index.html would turn the API's real 404s into
# HTML 200s, and the app relies on those 404s.
resource "aws_cloudfront_function" "spa_fallback" {
  name    = "foc-spa-fallback"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-JS
    function handler(event) {
      var request = event.request;
      if (request.uri.indexOf('.') === -1) {
        request.uri = '/index.html';
      }
      return request;
    }
  JS
}

resource "aws_cloudfront_vpc_origin" "gateway" {
  for_each = toset(var.envs)

  vpc_origin_endpoint_config {
    name                   = "foc-${each.value}-gateway"
    arn                    = aws_lb.gateway[each.value].arn
    http_port              = 80
    https_port             = 443
    origin_protocol_policy = "http-only" # the NLB has no certificate; the hop stays inside AWS

    origin_ssl_protocols {
      items    = ["TLSv1.2"]
      quantity = 1
    }
  }
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

# Forwards the Authorization header, query strings and cookies, but not Host
# (the NLB/Envoy don't serve the public hostname).
data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

data "aws_cloudfront_response_headers_policy" "security" {
  name = "Managed-SecurityHeadersPolicy"
}

resource "aws_cloudfront_distribution" "frontend" {
  for_each = toset(var.envs)

  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = "PriceClass_200" # includes Asia; _100 is US/EU only
  comment             = "FoC ${each.value}"

  origin {
    origin_id                = "s3"
    domain_name              = aws_s3_bucket.frontend[each.value].bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend[each.value].id
  }

  origin {
    origin_id   = "gateway"
    domain_name = aws_lb.gateway[each.value].dns_name
    vpc_origin_config {
      vpc_origin_id = aws_cloudfront_vpc_origin.gateway[each.value].id
    }
  }

  default_cache_behavior {
    target_origin_id           = "s3"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_fallback.arn
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/api/*"
    target_origin_id           = "gateway"
    viewer_protocol_policy     = "https-only"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # *.cloudfront.net's certificate. To add a custom domain later: an ACM
  # certificate in us-east-1, `aliases`, and a DNS record at your provider.
  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# GitHub Actions (role foc-ci from infra/global/github-oidc) uploads each build
# and invalidates index.html.
data "terraform_remote_state" "github_oidc" {
  backend = "s3"
  config = {
    bucket = var.state_bucket
    key    = "global/github-oidc/terraform.tfstate"
    region = var.region
  }
}

data "aws_iam_policy_document" "ci_frontend" {
  statement {
    actions   = ["s3:ListBucket"]
    resources = [for b in aws_s3_bucket.frontend : b.arn]
  }
  statement {
    actions   = ["s3:PutObject", "s3:DeleteObject"]
    resources = [for b in aws_s3_bucket.frontend : "${b.arn}/*"]
  }
  statement {
    actions   = ["cloudfront:CreateInvalidation"]
    resources = [for d in aws_cloudfront_distribution.frontend : d.arn]
  }
}

resource "aws_iam_role_policy" "ci_frontend" {
  name   = "nonprod-frontend-deploy"
  role   = data.terraform_remote_state.github_oidc.outputs.ci_role_name
  policy = data.aws_iam_policy_document.ci_frontend.json
}
