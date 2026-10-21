terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # The one root with state on disk: it creates the bucket every other cloud
  # root keeps its state in. Losing this file is harmless; the bucket stays
  # and can be imported (terraform import aws_s3_bucket.state <name>).
}
