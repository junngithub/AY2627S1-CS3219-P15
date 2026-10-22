# Each env's API entry point: an INTERNAL NLB in front of that env's Envoy
# gateway (ADR-0007), reachable only from CloudFront through a VPC origin
# (frontend.tf). There is no public API endpoint and no certificate on the
# NLB: CloudFront terminates TLS, then crosses AWS's network to the VPC.
#
# Terraform owns the NLB and target group so CloudFront can reference them in
# one apply. In the cluster, the AWS Load Balancer Controller registers the
# Envoy pods in the target group (a TargetGroupBinding in charts/foc-gateway).
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "gateway_lb" {
  name   = "${var.cluster_name}-gateway-lb"
  vpc_id = aws_vpc.this.id

  ingress {
    description     = "CloudFront (VPC origin) only"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    prefix_list_ids = [data.aws_ec2_managed_prefix_list.cloudfront.id]
  }
  egress {
    description = "To the Envoy pods"
    from_port   = var.gateway_target_port
    to_port     = var.gateway_target_port
    protocol    = "tcp"
    cidr_blocks = [for s in aws_subnet.private : s.cidr_block]
  }
}

# Pods use the cluster security group, so it must let the NLB in.
resource "aws_vpc_security_group_ingress_rule" "gateway_lb_to_pods" {
  security_group_id            = aws_eks_cluster.this.vpc_config[0].cluster_security_group_id
  description                  = "Gateway NLB to Envoy pods"
  from_port                    = var.gateway_target_port
  to_port                      = var.gateway_target_port
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.gateway_lb.id
}

resource "aws_lb" "gateway" {
  for_each = toset(var.envs)

  name               = "foc-${each.value}-gateway"
  load_balancer_type = "network"
  internal           = true
  subnets            = [for s in aws_subnet.private : s.id]
  security_groups    = [aws_security_group.gateway_lb.id] # CloudFront VPC origins require one
}

resource "aws_lb_target_group" "gateway" {
  for_each = toset(var.envs)

  name        = "foc-${each.value}-gateway"
  target_type = "ip" # pod IPs (VPC CNI), registered by the TargetGroupBinding
  protocol    = "TCP"
  port        = var.gateway_target_port
  vpc_id      = aws_vpc.this.id

  deregistration_delay = 15 # Envoy drains quickly; keeps rollouts short

  health_check {
    protocol = "TCP"
  }
}

resource "aws_lb_listener" "gateway" {
  for_each = toset(var.envs)

  load_balancer_arn = aws_lb.gateway[each.value].arn
  protocol          = "TCP"
  port              = 80

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.gateway[each.value].arn
  }
}
