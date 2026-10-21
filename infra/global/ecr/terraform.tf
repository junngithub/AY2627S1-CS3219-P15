terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Bucket from infra/state: terraform init -backend-config="bucket=foc-tfstate-<account>"
  backend "s3" {
    key          = "global/ecr/terraform.tfstate"
    region       = "ap-southeast-1"
    use_lockfile = true
  }
}
