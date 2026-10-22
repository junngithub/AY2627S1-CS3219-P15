terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 3.0"
    }
  }

  # Bucket from infra/state: terraform init -backend-config="bucket=foc-tfstate-<account>"
  backend "s3" {
    key          = "nonprod/bootstrap/terraform.tfstate"
    region       = "ap-southeast-1"
    use_lockfile = true
  }
}
