# Note: Build with --platform linux/amd64 for ECS Fargate
FROM node:20

WORKDIR /app

# Install system dependencies for Cypress and browsers
RUN apt-get update && apt-get install -y \
    libgtk-3-0 \
    libgbm-dev \
    libnotify-dev \
    libnss3 \
    libxss1 \
    libasound2 \
    libxtst6 \
    xauth \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

# Copy package files first
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Install Playwright with system dependencies
RUN npx playwright install --with-deps chromium

# Install Cypress binary
RUN npx cypress install

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run build

# Create workspace directory
RUN mkdir -p /workspace

# Set environment variables
ENV NODE_ENV=production

# Run the worker
CMD ["node", "dist/index.js"]