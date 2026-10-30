provider "aws" {
  region = var.region

  default_tags {
    tags = {
      env        = "global"
      managed-by = "terraform"
      project    = "foc"
    }
  }
}
