terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote state in S3 with native lockfile (Terraform >= 1.10, no DynamoDB needed).
  # Partial config — bucket/key/region are supplied at `terraform init` time
  # (the GitHub Action passes them via -backend-config from repo variables).
  backend "s3" {
    key          = "arena/terraform.tfstate"
    use_lockfile = true
    encrypt      = true
  }
}
