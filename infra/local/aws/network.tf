# Floci records these but k3s ignores them; they exist because EKS requires
# subnets and so the local cluster is declared the same way as the cloud one.
resource "aws_vpc" "this" {
  cidr_block = "10.0.0.0/16"
  tags       = { Name = "foc-local" }
}

resource "aws_subnet" "private" {
  for_each = { a = "10.0.1.0/24", b = "10.0.2.0/24" }

  vpc_id            = aws_vpc.this.id
  cidr_block        = each.value
  availability_zone = "${var.region}${each.key}"
  tags              = { Name = "foc-local-private-${each.key}" }
}
