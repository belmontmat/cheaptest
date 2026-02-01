# ECS Cluster
resource "aws_ecs_cluster" "main" {
  name = "${var.project_name}-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-cluster"
  }
}

# CloudWatch Log Group for ECS tasks
resource "aws_cloudwatch_log_group" "ecs_tasks" {
  name              = "/ecs/${var.project_name}-${var.environment}-worker"
  retention_in_days = 7 # Keep logs for 7 days

  tags = {
    Name = "${var.project_name}-${var.environment}-worker-logs"
  }
}

# ECS Task Definition
resource "aws_ecs_task_definition" "worker" {
  family                   = "${var.project_name}-${var.environment}-worker"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.worker_cpu
  memory                   = var.worker_memory

  execution_role_arn = aws_iam_role.ecs_task_execution.arn
  task_role_arn      = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name  = "cheaptest-worker"
      image = var.worker_image != "" ? var.worker_image : "${aws_ecr_repository.worker.repository_url}:latest"

      essential = true

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ecs_tasks.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "worker"
        }
      }

      environment = [
        {
          name  = "NODE_ENV"
          value = "production"
        }
      ]

      # Runtime environment variables will be overridden by CLI
      # These are just defaults
      # RUN_ID, SHARD_ID, S3_BUCKET, TEST_FRAMEWORK, etc.
    }
  ])

  tags = {
    Name = "${var.project_name}-${var.environment}-worker-task"
  }
}