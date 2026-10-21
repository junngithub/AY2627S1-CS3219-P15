provider "aws" {
  region = var.region

  default_tags {
    tags = {
      env        = "nonprod"
      managed-by = "terraform"
      project    = "foc"
    }
  }
}
