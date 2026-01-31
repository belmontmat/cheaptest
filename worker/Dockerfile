FROM node:20

WORKDIR /app

# Copy package files first
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Install Playwright with system dependencies
RUN npx playwright install --with-deps chromium

# Install Cypress
RUN npx cypress install || echo "Cypress install failed, continuing..."

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