provider "aws" {
  region = var.aws_region

  # Skip EC2 metadata check
  skip_metadata_api_check     = true
  skip_region_validation      = true
  skip_credentials_validation = false

  default_tags {
    tags = {
      Project     = "Cheaptest"
      Environment = var.environment
      ManagedBy   = "Terraform"
      Phase       = "1-ECS"
    }
  }
}