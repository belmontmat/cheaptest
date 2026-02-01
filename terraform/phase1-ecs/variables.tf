variable "aws_region" {
  description = "AWS region to deploy resources"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "project_name" {
  description = "Project name for resource naming"
  type        = string
  default     = "cheaptest"
}

variable "worker_cpu" {
  description = "CPU units for worker task (1024 = 1 vCPU)"
  type        = number
  default     = 1024
}

variable "worker_memory" {
  description = "Memory for worker task in MB"
  type        = number
  default     = 2048
}

variable "worker_image" {
  description = "Docker image for worker (will use ECR repo if not specified)"
  type        = string
  default     = ""
}

variable "s3_retention_days" {
  description = "Number of days to retain test results in S3"
  type        = number
  default     = 30
}

variable "enable_nat_gateway" {
  description = "Enable NAT gateway for private subnets (costs ~$32/month)"
  type        = bool
  default     = false # We'll use public subnets for cost savings
}