cheaptest/
├── cli/                    # TypeScript CLI
│   ├── src/
│   │   ├── commands/       # CLI commands
│   │   ├── backends/       # ECS & K8s implementations
│   │   ├── core/          # Test parsing, sharding
│   │   ├── aws/           # AWS SDK clients
│   │   ├── utils/         # Config, logging
│   │   └── types/         # TypeScript types
│   └── package.json
│
├── worker/                 # Docker image for test execution
│   ├── Dockerfile
│   ├── worker.js
│   └── package.json
│
├── terraform/
│   ├── phase1/            # ECS infrastructure
│   │   ├── main.tf
│   │   ├── ecs.tf
│   │   ├── s3.tf
│   │   └── iam.tf
│   └── phase2/            # EKS infrastructure
│       ├── main.tf
│       ├── eks.tf
│       ├── karpenter.tf
│       └── nodepool.tf
│
├── examples/
│   ├── playwright/        # Sample Playwright tests
│   ├── cypress/           # Sample Cypress tests
│   └── jenkins/           # Jenkins integration examples
│
├── docs/
│   ├── architecture.md
│   ├── cost-comparison.md
│   ├── backends.md
│   └── migrating-from-jenkins.md
│
└── benchmarks/
└── cost-analysis.md   # Real performance data
