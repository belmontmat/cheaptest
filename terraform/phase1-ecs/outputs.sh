#!/bin/bash

set -e  # Exit on error

echo "🔍 Extracting Terraform infrastructure values..."
echo ""

cd "$(dirname "$0")"  # Navigate to script directory

# Extract values from Terraform state
ECR_REPO=$(terraform state show aws_ecr_repository.worker | grep repository_url | awk '{print $3}' | tr -d '"')
S3_BUCKET=$(terraform state show aws_s3_bucket.storage | grep -w bucket | awk '{print $3}' | tr -d '"')
ECS_CLUSTER=$(terraform state show aws_ecs_cluster.main | grep -w name | awk '{print $3}' | tr -d '"')
TASK_DEF=$(terraform state show aws_ecs_task_definition.worker | grep -w family | awk '{print $3}' | tr -d '"')
SUBNET_1=$(terraform state show 'aws_subnet.public[0]' | grep -w id | awk '{print $3}' | tr -d '"')
SUBNET_2=$(terraform state show 'aws_subnet.public[1]' | grep -w id | awk '{print $3}' | tr -d '"')
SG=$(terraform state show aws_security_group.ecs_tasks | grep -w id | awk '{print $3}' | tr -d '"')
AWS_REGION="us-east-1"
# Display extracted values
echo "📋 Infrastructure Details:"
echo "  ECR Repository:    $ECR_REPO"
echo "  S3 Bucket:         $S3_BUCKET"
echo "  ECS Cluster:       $ECS_CLUSTER"
echo "  Task Definition:   $TASK_DEF"
echo "  Subnet 1:          $SUBNET_1"
echo "  Subnet 2:          $SUBNET_2"
echo "  Security Group:    $SG"
echo "  AWS Region:        $AWS_REGION"
echo ""

# Validate all values are present
if [ -z "$ECR_REPO" ] || [ -z "$S3_BUCKET" ] || [ -z "$ECS_CLUSTER" ] || \
   [ -z "$TASK_DEF" ] || [ -z "$SUBNET_1" ] || [ -z "$SUBNET_2" ] || [ -z "$SG" ]; then
  echo "❌ Error: Failed to extract some values from Terraform state"
  exit 1
fi

# Create .cheaptest.yml in project root
CONFIG_FILE="../cli/.cheaptest.yml"

echo "📝 Generating $CONFIG_FILE..."

cat > "$CONFIG_FILE" << EOF
version: 1

aws:
  region: $AWS_REGION
  cluster: $ECS_CLUSTER
  taskDefinition: $TASK_DEF
  subnets:
    - $SUBNET_1
    - $SUBNET_2
  securityGroups:
    - $SG

tests:
  directory: ./examples/playwright
  pattern: "**/*.spec.ts"
  framework: playwright

execution:
  cpu: 1024
  memory: 2048
  timeout: 300000

storage:
  bucket: $S3_BUCKET
  retentionDays: 30

output:
  format: pretty
  verbose: false
  showCostComparison: true
EOF

echo "✅ Configuration file created!"
echo ""
echo "📄 Contents of .cheaptest.yml:"
echo "----------------------------------------"
cat "$CONFIG_FILE"
echo "----------------------------------------"
echo ""

# Export ECR_REPO for next steps
echo "💾 Saving values for Docker push..."
cat > .env.terraform << EOF
export ECR_REPO=$ECR_REPO
export S3_BUCKET=$S3_BUCKET
export AWS_REGION=$AWS_REGION
EOF

echo "✅ Values saved to .env.terraform"
echo ""
echo "📦 Next steps:"
echo "  1. Build and push worker image:"
echo "     source terraform/phase1-ecs/.env.terraform"
echo "     cd worker"
echo "     aws ecr get-login-password --region \$AWS_REGION | docker login --username AWS --password-stdin \$ECR_REPO"
echo "     docker build -t cheaptest-worker:latest ."
echo "     docker tag cheaptest-worker:latest \$ECR_REPO:latest"
echo "     docker push \$ECR_REPO:latest"
echo ""
echo "  2. Run tests:"
echo "     cd cli"
echo "     npm run dev -- run --tests ../examples/playwright --parallel 2 --backend ecs --verbose"