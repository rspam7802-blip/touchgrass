terraform {
  required_version = ">= 1.9.0, < 2.0.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "5.82.2"
    }
    random = {
      source  = "hashicorp/random"
      version = "3.6.3"
    }
  }
  # State in S3 with DynamoDB locking; the bucket and table are created once by hand (LAUNCH_CHECKLIST.md).
  backend "s3" {}
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project     = "touchgrass"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# CloudFront certificates and WAF for CloudFront must live in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = {
      Project     = "touchgrass"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
