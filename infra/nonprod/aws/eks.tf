# One EKS cluster for dev and stg (ADR-0001). Access is through EKS access
# entries (no aws-auth ConfigMap). Pods get AWS permissions from the node's
# role (node-permissions.tf): the NUS organization's service control policy
# denies EKS Pod Identity, IRSA and sts:AssumeRole (ADR-0013).
data "aws_iam_policy_document" "eks_assume" {
  statement {
    actions = ["sts:AssumeRole", "sts:TagSession"]
    principals {
      type        = "Service"
      identifiers = ["eks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "cluster" {
  name               = "${var.cluster_name}-cluster"
  assume_role_policy = data.aws_iam_policy_document.eks_assume.json
}

resource "aws_iam_role_policy_attachment" "cluster" {
  role       = aws_iam_role.cluster.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}

resource "aws_eks_cluster" "this" {
  count = var.eks_enabled ? 1 : 0

  name     = var.cluster_name
  version  = var.kubernetes_version
  role_arn = aws_iam_role.cluster.arn

  access_config {
    authentication_mode                         = "API"
    bootstrap_cluster_creator_admin_permissions = true # whoever applies this can use kubectl
  }

  # Extended support is billed at $0.60/h instead of $0.10/h: upgrade instead.
  upgrade_policy {
    support_type = "STANDARD"
  }

  vpc_config {
    subnet_ids = [for s in aws_subnet.private : s.id]
    # Public endpoint so laptops, Terraform (bootstrap/) and CI reach the API;
    # nodes use the private one.
    endpoint_public_access  = true
    endpoint_private_access = true
  }

  depends_on = [aws_iam_role_policy_attachment.cluster]
}

# Nodes pull images with this role (ADR-0005): no registry passwords.
data "aws_iam_policy_document" "node_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "node" {
  name               = "${var.cluster_name}-node"
  assume_role_policy = data.aws_iam_policy_document.node_assume.json
}

resource "aws_iam_role_policy_attachment" "node" {
  for_each = toset([
    "AmazonEKSWorkerNodePolicy",
    "AmazonEKS_CNI_Policy",
    "AmazonEC2ContainerRegistryReadOnly",
    "service-role/AmazonEBSCSIDriverPolicy", # EBS CSI controller (Kafka's volume)
  ])

  role       = aws_iam_role.node.name
  policy_arn = "arn:aws:iam::aws:policy/${each.value}"
}

# Pods read the node role's credentials from the instance metadata service.
# A container is one network hop further than the node, so the hop limit must
# be 2 (the managed node group's default is 1). IMDSv2 only.
resource "aws_launch_template" "node" {
  name_prefix = "${var.cluster_name}-node-"

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_size = 30
      volume_type = "gp3"
      encrypted   = true
    }
  }
}

# arm64 Spot nodes (cost profile M): images must be built for linux/arm64.
# Spot can be reclaimed with 2 minutes' notice; the node group replaces the
# node and pods restart, which non-prod tolerates.
resource "aws_eks_node_group" "default" {
  count = var.eks_enabled ? 1 : 0

  cluster_name    = aws_eks_cluster.this[0].name
  node_group_name = "default"
  node_role_arn   = aws_iam_role.node.arn
  subnet_ids      = [for s in aws_subnet.private : s.id]

  ami_type       = "AL2023_ARM_64_STANDARD"
  capacity_type  = "SPOT"
  instance_types = var.node_instance_types

  launch_template {
    id      = aws_launch_template.node.id
    version = aws_launch_template.node.latest_version
  }

  scaling_config {
    min_size     = var.node_count.min
    desired_size = var.node_count.desired
    max_size     = var.node_count.max
  }

  update_config {
    max_unavailable = 1
  }

  depends_on = [aws_iam_role_policy_attachment.node]
}

resource "aws_eks_addon" "this" {
  for_each = var.eks_enabled ? toset(["vpc-cni", "kube-proxy", "coredns"]) : toset([])

  cluster_name                = aws_eks_cluster.this[0].name
  addon_name                  = each.value
  resolve_conflicts_on_update = "OVERWRITE"

  # CoreDNS needs a node to become Active.
  depends_on = [aws_eks_node_group.default]
}

# Kafka's broker volume (ADR-0003). The gp3 StorageClass that uses it is
# deployed by Argo CD (deploy/charts/cluster-config). Its permissions come
# from the node role (AmazonEBSCSIDriverPolicy above).
resource "aws_eks_addon" "ebs_csi" {
  count = var.eks_enabled ? 1 : 0

  cluster_name                = aws_eks_cluster.this[0].name
  addon_name                  = "aws-ebs-csi-driver"
  resolve_conflicts_on_update = "OVERWRITE"

  depends_on = [aws_eks_addon.this, aws_iam_role_policy_attachment.node]
}

resource "aws_eks_access_entry" "admin" {
  for_each = var.eks_enabled ? toset(var.cluster_admin_arns) : toset([])

  cluster_name  = aws_eks_cluster.this[0].name
  principal_arn = each.value
}

resource "aws_eks_access_policy_association" "admin" {
  for_each = aws_eks_access_entry.admin

  cluster_name  = aws_eks_cluster.this[0].name
  principal_arn = each.value.principal_arn
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"
  access_scope {
    type = "cluster"
  }
}

# The cluster became optional (var.eks_enabled); keep the existing objects.
moved {
  from = aws_eks_cluster.this
  to   = aws_eks_cluster.this[0]
}

moved {
  from = aws_eks_node_group.default
  to   = aws_eks_node_group.default[0]
}

moved {
  from = aws_eks_addon.ebs_csi
  to   = aws_eks_addon.ebs_csi[0]
}
