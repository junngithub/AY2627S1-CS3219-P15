# Every AWS call goes to Floci (../compose.yaml). Each service Terraform uses
# must be listed under `endpoints`, or the provider would call real AWS.
provider "aws" {
  region     = var.region
  access_key = "test"
  secret_key = "test"

  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true
  s3_use_path_style           = true

  endpoints {
    ec2 = var.floci_endpoint
    ecr = var.floci_endpoint
    eks = var.floci_endpoint
    iam = var.floci_endpoint
    sts = var.floci_endpoint
  }

  default_tags {
    tags = {
      env        = "local"
      managed-by = "terraform"
      project    = "foc"
    }
  }
}
