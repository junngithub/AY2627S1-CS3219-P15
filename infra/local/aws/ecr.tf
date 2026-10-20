resource "aws_ecr_repository" "service" {
  for_each = toset(var.services)

  name                 = "foc/${each.value}"
  image_tag_mutability = "MUTABLE" # re-push :dev freely on a laptop
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = false
  }
}

# Images that support local testing but are not FoC services.
resource "aws_ecr_repository" "tool" {
  for_each = toset(var.tools)

  name                 = "foc/${each.value}"
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = false
  }
}
