# Two AZs (EKS and RDS both require it). Nodes, pods, RDS and the gateway's
# NLB sit in the private subnets; only the NAT instance is public. The private
# subnets are large because the VPC CNI gives every pod a VPC address.
data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, 2)
}

resource "aws_vpc" "this" {
  cidr_block           = "10.10.0.0/16"
  enable_dns_hostnames = true # required by EKS and by RDS endpoints
  tags                 = { Name = var.cluster_name }
}

resource "aws_subnet" "public" {
  for_each = { for i, az in local.azs : az => i }

  vpc_id                  = aws_vpc.this.id
  availability_zone       = each.key
  cidr_block              = cidrsubnet(aws_vpc.this.cidr_block, 8, each.value) # 10.10.0.0/24, 10.10.1.0/24
  map_public_ip_on_launch = true
  tags                    = { Name = "${var.cluster_name}-public-${each.key}" }
}

resource "aws_subnet" "private" {
  for_each = { for i, az in local.azs : az => i }

  vpc_id            = aws_vpc.this.id
  availability_zone = each.key
  cidr_block        = cidrsubnet(aws_vpc.this.cidr_block, 4, each.value + 1) # 10.10.16.0/20, 10.10.32.0/20
  tags              = { Name = "${var.cluster_name}-private-${each.key}" }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = var.cluster_name }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
  tags = { Name = "${var.cluster_name}-public" }
}

resource "aws_route_table_association" "public" {
  for_each = aws_subnet.public

  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

# fck-nat: a t4g.nano NAT instance instead of a NAT gateway (~$3 vs ~$43 a
# month, cost profile M). One instance, no failover: if it stops, pods lose
# the internet (not each other, RDS or S3) until it's back. Fine for non-prod.
data "aws_ami" "fck_nat" {
  most_recent = true
  owners      = ["568608671756"] # fck-nat's publisher
  filter {
    name   = "name"
    values = ["fck-nat-al2023-*-arm64-ebs"]
  }
}

resource "aws_security_group" "nat" {
  name   = "${var.cluster_name}-nat"
  vpc_id = aws_vpc.this.id

  ingress {
    description = "Traffic from the VPC to forward"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = [aws_vpc.this.cidr_block]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_instance" "nat" {
  ami                    = data.aws_ami.fck_nat.id
  instance_type          = "t4g.nano"
  subnet_id              = aws_subnet.public[local.azs[0]].id
  vpc_security_group_ids = [aws_security_group.nat.id]
  source_dest_check      = false # it forwards packets that aren't addressed to it
  tags                   = { Name = "${var.cluster_name}-nat" }
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block           = "0.0.0.0/0"
    network_interface_id = aws_instance.nat.primary_network_interface_id
  }
  tags = { Name = "${var.cluster_name}-private" }
}

resource "aws_route_table_association" "private" {
  for_each = aws_subnet.private

  subnet_id      = each.value.id
  route_table_id = aws_route_table.private.id
}

# Free, and keeps ECR image layers (stored in S3) and order photos off the NAT.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private.id]
}
