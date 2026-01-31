#!/bin/bash
set -e

echo "Cheaptest Worker Starting..."
echo "=============================="
echo "Run ID: ${RUN_ID}"
echo "Shard ID: ${SHARD_ID}"
echo "Framework: ${TEST_FRAMEWORK}"
echo "=============================="

# Start the worker
exec node /app/dist/index.js