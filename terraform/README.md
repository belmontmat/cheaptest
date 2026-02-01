# Cheaptest Infrastructure

This directory contains Terraform configurations for deploying Cheaptest infrastructure.

## Phase 1: ECS (Fargate)

Basic implementation using AWS ECS Fargate for running test workers.

### Prerequisites

1. AWS CLI configured with credentials
2. Terraform >= 1.0 installed
3. Docker for building worker image

### Deployment Steps

#### 1. Deploy Infrastructure
```bash
cd terraform/phase1-ecs

# Initialize Terraform
terraform init

# Review planned changes
terraform plan

# Deploy
terraform apply
```

#### 2. Build and Push Worker Image
```bash
# Get ECR login
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

# Build worker image
cd ../../worker
docker build -t cheaptest-worker:latest .

# Tag for ECR
docker tag cheaptest-worker:latest <ecr-repo-url>:latest

# Push to ECR
docker push <ecr-repo-url>:latest
```

The ECR repository URL is in the Terraform outputs: `terraform output ecr_repository_url`

#### 3. Update Cheaptest Config

After deployment, update your `.cheaptest.yml` with the Terraform outputs:
```bash
terraform output -json cheaptest_config
```

### Cost Estimates

**Monthly costs** (assuming minimal usage):
- VPC: Free
- ECS Cluster: Free
- S3 Storage: ~$0.50 (for test artifacts)
- CloudWatch Logs: ~$1.00
- **Pay-per-use**: Fargate tasks only cost when running tests

**Per test run** (example: 10 parallel workers, 5 minutes):
- 10 tasks × 1 vCPU × 2GB RAM × 5 min ≈ **$0.02**

### Cleanup
```bash
# Destroy all resources
terraform destroy

# Note: You may need to empty the S3 bucket first
aws s3 rm s3://$(terraform output -raw s3_bucket_name) --recursive
```

## Outputs

After deployment, get configuration values:
```bash
# All outputs
terraform output

# Specific output
terraform output ecs_cluster_name
terraform output s3_bucket_name
terraform output ecr_repository_url
```