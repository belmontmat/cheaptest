# Cheaptest

Cost-effective parallel end-to-end test runner. Distributes Playwright, Cypress, and Selenium tests across AWS ECS Fargate workers for fast, pay-per-use execution.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [CLI (`cli/`)](#cli-cli)
- [Worker (`worker/`)](#worker-worker)
- [Terraform (`terraform/`)](#terraform-terraform)
- [Examples (`examples/`)](#examples-examples)
- [Configuration](#configuration)
- [CLI Commands](#cli-commands)
- [Supported Test Frameworks](#supported-test-frameworks)
- [Cost Estimates](#cost-estimates)
- [Development](#development)
- [License](#license)

## Overview

Cheaptest shards your e2e test suite across parallel ECS Fargate containers. Each worker runs a subset of tests and uploads results to S3. The CLI orchestrates the entire process: discovering tests, creating balanced shards, launching containers, and aggregating results.

**Key features:**

- Parallel test execution across ECS Fargate workers
- Supports Playwright, Cypress, and Selenium
- Intelligent test sharding with duration-based balancing
- Built-in cost tracking and analysis
- JUnit XML report export for CI/CD integration
- YAML-based configuration
- Pay only for compute time used

## Architecture

```
cheaptest run
    |
    v
CLI (orchestrator)
    |
    ├── Discover tests (glob patterns)
    ├── Create balanced shards
    ├── Upload test code to S3
    ├── Launch ECS Fargate tasks (one per shard)
    |       |
    |       v
    |   Worker Container (per shard)
    |       ├── Download test code from S3
    |       ├── Run assigned tests
    |       └── Upload results to S3
    |
    ├── Poll for results
    └── Aggregate and display summary
```

**S3 layout per run:**
```
s3://<bucket>/
  runs/<run-id>/
    test-code.tar.gz        # Compressed test source
    shards.json              # Shard assignments
    tasks.json               # ECS task ARNs (for status/cancel)
    results/
      shard-0.json           # Results from worker 0
      shard-1.json           # Results from worker 1
      ...
  cost-history/
    <run-id>.json            # Cost data per run
```

## Prerequisites

- Node.js >= 18.0.0 (CLI), >= 20.0.0 (worker)
- AWS CLI configured with credentials
- Terraform >= 1.0
- Docker (for building the worker image)

## Quick Start

```bash
# 1. Deploy infrastructure
cd terraform/phase1-ecs
terraform init && terraform apply

# 2. Build and push the worker image
cd ../../worker
docker build --platform linux/amd64 -t cheaptest-worker:latest .
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com
docker tag cheaptest-worker:latest <ecr-repo-url>:latest
docker push <ecr-repo-url>:latest

# 3. Install and configure the CLI
cd ../cli
npm install && npm run build

# 4. Initialize config (populates .cheaptest.yml)
npx cheaptest init

# 5. Run tests
npx cheaptest run --parallel 10
```

---

## Project Structure

```
cheaptest/
├── cli/                     # CLI application (orchestrator)
├── worker/                  # Docker container for test execution
├── terraform/               # AWS infrastructure as code
├── examples/                # Sample test projects
├── docs/                    # Documentation
├── LICENSE                  # MIT License
├── .gitignore               # Git ignore rules
└── .gitattributes           # Git file handling
```

---

## CLI (`cli/`)

The CLI is a TypeScript application built with Commander.js. It discovers tests, shards them across workers, launches ECS tasks, and aggregates results.

### Directory Layout

```
cli/
├── src/
│   ├── index.ts                  # Entry point and command definitions
│   ├── types/
│   │   └── index.ts              # TypeScript type definitions
│   ├── commands/
│   │   ├── run.ts                # `cheaptest run` - main test orchestration
│   │   ├── init.ts               # `cheaptest init` - config initialization
│   │   ├── cost.ts               # `cheaptest cost` - cost analysis
│   │   ├── status.ts             # `cheaptest status` - run status with live ECS tracking
│   │   ├── cancel.ts             # `cheaptest cancel` - stop running ECS tasks
│   │   └── compare.ts            # `cheaptest compare-backends` (WIP)
│   ├── core/
│   │   ├── test-parser.ts        # Test file discovery and parsing
│   │   ├── sharding.ts           # Test sharding and load balancing
│   │   ├── cost-tracker.ts       # Cost tracking and history
│   │   ├── parser.test.ts        # Tests for test-parser
│   │   └── sharding.test.ts      # Tests for sharding
│   ├── backends/
│   │   ├── ecs.ts                # AWS ECS Fargate backend
│   │   └── kubernetes.ts         # Kubernetes backend (stub)
│   ├── output/
│   │   ├── junit.ts              # JUnit XML report generator
│   │   └── junit.test.ts         # Tests for JUnit generator
│   ├── aws/
│   │   ├── s3-client.ts          # S3 operations (upload, download, tar)
│   │   └── client.test.ts        # Tests for S3 client
│   └── utils/
│       ├── logger.ts             # Colored logging with spinners
│       ├── config.ts             # YAML config loading and defaults
│       └── retry.ts              # Retry with exponential backoff and jitter
├── dist/                         # Compiled JavaScript output
├── .cheaptest.yml                # Project configuration file
├── package.json                  # Dependencies and scripts
├── tsconfig.json                 # TypeScript compiler config (ES2022, strict)
└── jest.config.js                # Jest test runner config (ts-jest)
```

### `src/index.ts`

CLI entry point. Registers all commands with Commander.js and parses arguments. The package exposes a `cheaptest` binary.

### `src/types/index.ts`

Shared TypeScript interfaces used across the CLI:

| Type | Purpose |
|------|---------|
| `CheaptestConfig` | Shape of `.cheaptest.yml` configuration |
| `TestFile` | Discovered test file with path, framework, size, estimated duration |
| `TestShard` | Group of test files assigned to a single worker |
| `RunOptions` | Options passed to the `run` command |
| `TestResult` | Results returned by a single worker |
| `TestCase` | Individual test case outcome (passed/failed/skipped) |
| `RunSummary` | Aggregated run results with cost data |
| `BackendInterface` | Contract for backend implementations (ECS, Kubernetes) |
| `RunStatus` | Status of an in-progress or completed run |

### `src/commands/`

| File | Command | Description |
|------|---------|-------------|
| `run.ts` | `cheaptest run` | Orchestrates the full test execution lifecycle |
| `init.ts` | `cheaptest init` | Generates a `.cheaptest.yml` config file |
| `cost.ts` | `cheaptest cost` | Analyzes historical cost data from S3 |
| `status.ts` | `cheaptest status` | Shows run progress, shard states, and partial results |
| `cancel.ts` | `cheaptest cancel` | Stops active ECS tasks for a run |
| `compare.ts` | `cheaptest compare-backends` | Compares ECS vs Kubernetes (work in progress) |

### `src/core/test-parser.ts`

Discovers test files by recursively scanning directories with glob patterns. Applies framework-specific defaults:

- **Playwright:** `**/*.spec.ts`, `**/*.spec.js`, `**/*.test.ts`, `**/test/**/*.ts`
- **Cypress:** `**/*.cy.ts`, `**/*.cy.js`, `**/e2e/**/*.cy.ts`
- **Selenium:** `**/*.test.ts`, `**/*.test.js`, `**/*.spec.ts`

Estimates test duration based on file size and heuristics (e.g., presence of `waitForTimeout`, screenshot/video usage).

### `src/core/sharding.ts`

Distributes test files across workers using one of three strategies:

| Strategy | Description |
|----------|-------------|
| `round-robin` | Assigns files to workers in sequence |
| `balanced` | Balances by total file size per shard |
| `duration` | Balances by estimated test duration (default) |

Calculates a balance score (0-1) to indicate how evenly work is distributed.

### `src/core/cost-tracker.ts`

Tracks execution costs per run. Stores cost history in S3 at `cost-history/<runId>.json`. Supports aggregation over time periods (last run, last 7 days, last 30 days).

### `src/backends/ecs.ts`

Implements the ECS Fargate backend. Handles:

- Creating ECS `RunTask` calls with container overrides (environment variables for shard ID, run ID, S3 bucket, framework)
- Persisting task ARNs to S3 (`tasks.json`) for status tracking and cancellation
- Waiting for tasks to reach RUNNING state
- Polling for task completion
- Stopping tasks via `StopTaskCommand` for cancellation
- Downloading and aggregating results from S3

### `src/backends/kubernetes.ts`

Stub implementation for a future Kubernetes backend.

### `src/aws/s3-client.ts`

Wrapper around `@aws-sdk/client-s3` providing:

- `uploadTarball()` - Compress a directory and upload to S3
- `downloadAndExtract()` - Download and extract a tarball
- `uploadJSON()` / `downloadJSON()` - Serialize/deserialize JSON objects
- `listObjects()` - List S3 keys by prefix
- Bucket creation with encryption and lifecycle policies

### `src/utils/logger.ts`

Colored console output using Chalk and Ora spinners. Provides `info`, `success`, `error`, `warn`, and `debug` log levels with consistent formatting.

### `src/output/junit.ts`

Generates JUnit XML reports from test results. Maps the cheaptest data model to standard JUnit XML:

| JUnit Element | cheaptest Source |
|---------------|------------------|
| `<testsuites>` | Entire `RunSummary` (aggregate counts) |
| `<testsuite>` | One per shard (`TestResult`) |
| `<testcase>` | One per `TestCase` |
| `<failure>` | Failed tests (error message + stack trace) |
| `<skipped />` | Skipped tests |

The `classname` attribute is derived from the file path (`e2e/auth/login.spec.ts` becomes `e2e.auth.login.spec`), which groups tests by directory in CI dashboards.

Exports `generateJunitXml(summary)` for producing the XML string and `writeJunitXml(summary, path)` for writing to disk with automatic parent directory creation.

### `src/utils/config.ts`

Loads `.cheaptest.yml`, merges with defaults, and validates required fields. Exposes `loadConfig()` and `saveConfig()` functions.

### `src/utils/retry.ts`

Generic retry utility with exponential backoff and jitter. Used by the ECS backend for S3 result aggregation and other operations that may encounter transient failures. Exports `withRetry<T>()` and `getErrorMessage()` for safe error message extraction from `unknown` catch types.

### Dependencies

| Package | Purpose |
|---------|---------|
| `commander` | CLI argument parsing |
| `@aws-sdk/client-ecs` | ECS task management |
| `@aws-sdk/client-s3` | S3 storage operations |
| `@aws-sdk/client-cloudwatch-logs` | Log streaming |
| `@aws-sdk/lib-storage` | Multipart uploads |
| `@kubernetes/client-node` | Kubernetes API client |
| `chalk` | Terminal colors |
| `ora` | Terminal spinners |
| `yaml` | YAML parsing |
| `tar` | Tarball creation/extraction |
| `glob` | File pattern matching |
| `uuid` | Run ID generation |
| `table` | Table formatting for output |

### Scripts

```bash
npm run build          # Compile TypeScript to dist/
npm run dev            # Run with ts-node (no compile step)
npm run watch          # Watch mode compilation
npm run lint           # Run ESLint
npm test               # Run Jest tests
npm run test:watch     # Jest watch mode
npm run test:coverage  # Generate coverage report
```

---

## Worker (`worker/`)

The worker is a Docker container that receives a shard assignment, runs the assigned tests using the specified framework, and uploads results back to S3.

### Directory Layout

```
worker/
├── src/
│   ├── index.ts                  # Entry point - orchestrates execution
│   ├── runner.ts                 # Abstract test runner, delegates to frameworks
│   ├── s3-client.ts              # S3 operations (download/upload)
│   └── frameworks/
│       ├── playwright.ts         # Playwright test runner
│       ├── cypress.ts            # Cypress test runner
│       └── selenium.ts           # Selenium/Jest test runner
├── dist/                         # Compiled JavaScript
├── Dockerfile                    # Container image definition
├── docker-compose.yaml           # Local development compose file
├── .dockerignore                 # Files excluded from Docker build
├── .env.example                  # Example environment variables
├── package.json                  # Dependencies and scripts
└── tsconfig.json                 # TypeScript compiler config
```

### `src/index.ts`

Worker entry point. Execution flow:

1. Read configuration from environment variables
2. Validate required config (`RUN_ID`, `S3_BUCKET`)
3. Download test code tarball from S3 (`runs/<runId>/test-code.tar.gz`)
4. Download shard configuration (`runs/<runId>/shards.json`)
5. Run tests via the appropriate framework runner
6. Upload results to S3 (`runs/<runId>/results/shard-<shardId>.json`)
7. Exit with code 0 (all passed) or 1 (failures or errors)

Handles `SIGTERM` and `SIGINT` for graceful shutdown.

### `src/runner.ts`

Abstract test runner that delegates to framework-specific implementations. Receives shard config and workspace path, returns a `TestResult` object.

### `src/frameworks/playwright.ts`

Runs Playwright tests by spawning `npx playwright test` with a dynamically generated config. Uses the JSON reporter for structured output. Symlinks `node_modules` from the container into the workspace directory.

### `src/frameworks/cypress.ts`

Runs Cypress specs sequentially (Cypress does not support parallel execution within a single process). Creates a temporary `cypress.config.ts` and `tsconfig.json` in the workspace. Symlinks `node_modules` for TypeScript support.

### `src/frameworks/selenium.ts`

Runs Selenium tests using Jest as the test runner. Parses JUnit XML output for structured results. Includes `chromedriver` for browser automation.

### `src/s3-client.ts`

S3 client for the worker environment. Provides download/extract and upload operations for test code and results.

### Dockerfile

```
Base:         node:20
Platform:     linux/amd64 (for ECS Fargate)
System deps:  GTK3, GBM, NSS, ALSA, Xvfb (for headless browsers)
Browsers:     Chromium (via Playwright), Cypress binary
Build:        TypeScript compiled to dist/
Entrypoint:   node dist/index.js
```

### Environment Variables

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `RUN_ID` | Yes | Unique run identifier | - |
| `S3_BUCKET` | Yes | S3 bucket for code and results | - |
| `AWS_REGION` | No | AWS region | `us-east-1` |
| `SHARD_ID` | No | Worker shard number (0-based) | `0` |
| `TEST_FRAMEWORK` | No | Framework to use | `playwright` |
| `TEST_TIMEOUT` | No | Timeout in milliseconds | `300000` |
| `AWS_SESSION_TOKEN` | No | For temporary AWS credentials | - |

### Scripts

```bash
npm run build    # Compile TypeScript
npm run start    # Run compiled worker
npm run dev      # Run with ts-node
```

---

## Terraform (`terraform/`)

Infrastructure as code for deploying Cheaptest on AWS.

### Directory Layout

```
terraform/
├── README.md                     # Deployment instructions
└── phase1-ecs/                   # ECS Fargate infrastructure
    ├── main.tf                   # Provider configuration (AWS)
    ├── variables.tf              # Input variables with defaults
    ├── ecs.tf                    # ECS cluster, task definition, CloudWatch logs
    ├── ecr.tf                    # ECR repository with lifecycle policy
    ├── s3.tf                     # S3 bucket with encryption and lifecycle
    ├── iam.tf                    # IAM roles and policies for ECS tasks
    ├── vpc.tf                    # VPC, subnets, internet gateway, security groups
    ├── .env.terraform            # Environment variable overrides
    └── outputs.sh                # Helper script to extract Terraform outputs
```

### `phase1-ecs/main.tf`

AWS provider configuration. Sets the AWS region from the `aws_region` variable.

### `phase1-ecs/variables.tf`

| Variable | Default | Description |
|----------|---------|-------------|
| `aws_region` | `us-east-1` | AWS region for all resources |
| `environment` | `dev` | Environment name (used in resource naming) |
| `project_name` | `cheaptest` | Prefix for all resource names |
| `worker_cpu` | `1024` | ECS task CPU units (1024 = 1 vCPU) |
| `worker_memory` | `2048` | ECS task memory in MB |
| `s3_retention_days` | `30` | Days before test artifacts are auto-deleted |
| `enable_nat_gateway` | `false` | Whether to create a NAT gateway (adds cost) |

### `phase1-ecs/ecs.tf`

- **ECS Cluster** with Container Insights enabled
- **ECS Task Definition** (Fargate compatible) with configurable CPU/memory, CloudWatch log driver, and environment variable placeholders for worker configuration
- **CloudWatch Log Group** at `/ecs/cheaptest-<env>-worker`

### `phase1-ecs/ecr.tf`

- **ECR Repository** (`cheaptest-worker`) with image scanning on push
- **Lifecycle Policy** retaining the last 10 images

### `phase1-ecs/s3.tf`

- **S3 Bucket** with auto-generated name including the AWS account ID
- **Server-side encryption** (AES256)
- **Lifecycle policy** to auto-delete objects after the configured retention period
- **Public access blocked** on all settings

### `phase1-ecs/iam.tf`

- **Task Execution Role** - Allows ECS to pull images from ECR and write logs to CloudWatch
- **Task Role** - Grants the running container access to the S3 bucket (read/write)

### `phase1-ecs/vpc.tf`

- **VPC** (CIDR: `10.0.0.0/16`)
- **Internet Gateway** for outbound access
- **2 public subnets** across availability zones (`10.0.0.0/24`, `10.0.1.0/24`)
- **Route table** with internet gateway routes
- **Security group** allowing all outbound traffic

### Terraform Outputs

After `terraform apply`, these values are available:

| Output | Description |
|--------|-------------|
| `ecs_cluster_name` | Name of the ECS cluster |
| `ecs_task_definition` | ARN of the task definition |
| `ecr_repository_url` | URL for pushing Docker images |
| `s3_bucket_name` | S3 bucket for test artifacts |
| `vpc_id` | VPC identifier |
| `subnets` | List of subnet IDs |
| `security_group_id` | Security group for ECS tasks |

### Deployment

```bash
cd terraform/phase1-ecs

# Initialize providers
terraform init

# Preview changes
terraform plan

# Deploy
terraform apply

# View outputs
terraform output

# Tear down
aws s3 rm s3://$(terraform output -raw s3_bucket_name) --recursive
terraform destroy
```

---

## Examples (`examples/`)

Sample test projects demonstrating each supported framework.

### Directory Layout

```
examples/
├── playwright/                   # Playwright test examples
│   ├── google-search.spec.ts     # Google search test
│   ├── navigation.spec.ts        # Page navigation test
│   ├── playwright.config.ts      # Playwright configuration
│   └── package.json              # Dependencies (@playwright/test)
├── cypress/                      # Cypress test examples
│   ├── e2e/
│   │   ├── google-search.cy.ts   # Google search spec
│   │   ├── navigation.cy.ts      # Navigation spec
│   │   └── cypress.config.ts     # Cypress configuration
│   ├── package.json              # Dependencies (cypress)
│   └── tsconfig.json             # TypeScript config
└── selenium/                     # Selenium test examples
    ├── google-search.test.ts     # Google search test
    ├── navigation.test.ts        # Navigation test
    ├── jest.config.ts            # Jest configuration
    └── package.json              # Dependencies (selenium-webdriver, chromedriver)
```

All example tests target google.com and demonstrate basic browser automation patterns (search, navigation, element interaction). Each project includes its own `package.json` and framework-specific configuration.

### File Naming Conventions

| Framework | Pattern | Example |
|-----------|---------|---------|
| Playwright | `*.spec.ts` | `google-search.spec.ts` |
| Cypress | `*.cy.ts` | `google-search.cy.ts` |
| Selenium | `*.test.ts` | `google-search.test.ts` |

---

## Configuration

Cheaptest is configured via a `.cheaptest.yml` file in your project root. Run `cheaptest init` to generate one.

### Full Configuration Reference

```yaml
version: 1

aws:
  region: us-east-1                   # AWS region
  cluster: cheaptest-dev              # ECS cluster name
  taskDefinition: cheaptest-dev-worker # ECS task definition name
  subnets:                            # VPC subnet IDs
    - subnet-xxxxx
    - subnet-xxxxx
  securityGroups:                     # Security group IDs
    - sg-xxxxx

tests:
  directory: ./e2e                    # Path to test files
  pattern: "**/*.spec.ts"            # Glob pattern for test discovery
  framework: playwright               # playwright | cypress | selenium

execution:
  cpu: 1024                           # CPU units per worker (1024 = 1 vCPU)
  memory: 2048                        # Memory in MB per worker
  timeout: 5                          # Timeout per worker in minutes

storage:
  bucket: cheaptest-dev-storage       # S3 bucket name
  retentionDays: 30                   # Auto-delete artifacts after N days

output:
  format: pretty                      # pretty | json | junit
  verbose: false                      # Show detailed output
  showCostComparison: true            # Display cost breakdown after run

# Optional: Kubernetes backend config
kubernetes:
  context: my-cluster
  namespace: cheaptest
```

---

## CLI Commands

### `cheaptest run`

Run e2e tests in parallel across ECS workers.

```
Options:
  -t, --tests <path>        Path to test directory (default: ./e2e)
  -p, --parallel <number>   Number of parallel workers (default: 10)
  -b, --backend <type>      Backend: ecs | kubernetes (default: ecs)
  -f, --framework <type>    Framework: playwright | cypress | selenium
  -c, --config <path>       Path to config file (default: .cheaptest.yml)
  -v, --verbose             Verbose output
  --dry-run                 Show execution plan without running
  --timeout <minutes>       Test timeout in minutes (default: 30)
  --retries <number>        Number of retries for failed tests (default: 0)
  --junit <path>            Write JUnit XML report to file
```

The `--junit` flag writes a standard JUnit XML report alongside the normal terminal output. This is compatible with GitHub Actions, GitLab CI, Jenkins, CircleCI, and other CI systems that display JUnit test results natively.

```bash
# Generate JUnit report for CI
cheaptest run --parallel 10 --junit results/junit.xml
```

### `cheaptest init`

Generate a `.cheaptest.yml` configuration file.

```
Options:
  -f, --force               Overwrite existing config
  -b, --backend <type>      Default backend: ecs | kubernetes (default: ecs)
```

### `cheaptest cost`

Analyze test execution costs from historical run data.

```
Options:
  --last-run                Show cost of the last run
  --last-7-days             Show costs from the last 7 days
  --last-30-days            Show costs from the last 30 days
  --breakdown               Show detailed cost breakdown
```

### `cheaptest status <runId>`

Show the status of a test run. Combines S3 result data (source of truth) with live ECS task state to display per-shard progress, a color-coded progress bar, aggregated test results from completed shards, and failed test details.

```
Options:
  -w, --watch               Watch status in real-time (polls every 5s, auto-exits on completion)
```

**Output includes:**
- Run metadata (ID, framework, start time, elapsed time)
- Progress bar with color-coded segments (green=passed, red=failed, blue=running, gray=pending)
- Per-shard status with ECS task state and test counts
- Aggregated test results from completed shards
- Failed test details with file names and error messages

Falls back to S3-only mode for runs without task ARN tracking (legacy runs or if ECS tasks have expired).

### `cheaptest cancel <runId>`

Cancel a running test run by stopping all active ECS tasks. Requires the `tasks.json` manifest in S3 (automatically created by `cheaptest run`).

```
Options:
  --force                   Skip confirmation and stop tasks immediately
```

Without `--force`, the command shows which tasks will be stopped and asks you to re-run with `--force` to confirm. Partial results from already-completed shards remain available in S3.

### `cheaptest compare-backends`

Compare ECS vs Kubernetes performance and costs (work in progress).

```
Options:
  -t, --tests <path>        Path to test directory (default: ./e2e)
  -p, --parallel <number>   Number of parallel workers (default: 10)
```

---

## Supported Test Frameworks

| Framework | Version | Runner | Browser |
|-----------|---------|--------|---------|
| Playwright | 1.48.2 | Native CLI (`playwright test`) | Chromium |
| Cypress | 13.17.0 | Native CLI (`cypress run`) | Bundled Electron/Chrome |
| Selenium | 4.27.0 | Jest | Chrome (via chromedriver 131) |

---

## Cost Estimates

Cheaptest uses AWS Fargate spot-like pricing. You only pay for the compute time your tests actually use.

**Monthly baseline (idle):** ~$1.50

| Component | Cost |
|-----------|------|
| S3 storage | ~$0.50 |
| CloudWatch logs | ~$1.00 |
| ECS cluster | Free |
| VPC | Free |

**Per test run (10 workers, 5 minutes):** ~$0.02

| Component | Rate |
|-----------|------|
| Fargate vCPU | $0.04048/hour |
| Fargate memory | $0.004445/GB-hour |

**Example:** 10 tasks x 1 vCPU x 2 GB x 5 min = ~$0.02

---

## Development

### CLI Development

```bash
cd cli
npm install
npm run dev -- run --dry-run    # Run CLI in dev mode
npm test                        # Run unit tests
npm run test:coverage           # Generate coverage report
```

### Worker Development

```bash
cd worker
npm install

# Run locally with environment variables
cp .env.example .env
# Edit .env with your values
npm run dev

# Build Docker image
docker build --platform linux/amd64 -t cheaptest-worker:latest .

# Test locally with docker-compose
docker compose up
```

### Running Tests

```bash
# CLI unit tests
cd cli && npm test

# Specific test file
cd cli && npx jest src/core/sharding.test.ts
```

---

## License

MIT License. Copyright (c) 2026 Mathew Belmont. See [LICENSE](LICENSE) for details.
