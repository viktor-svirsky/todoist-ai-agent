#!/bin/bash
set -e

echo "=== Todoist AI Agent Validation ==="

# Build TypeScript
echo "Building TypeScript..."
npm run build

# Run tests
echo "Running tests..."
npm run test:coverage

# Type check
echo "Type checking..."
npm run typecheck

# Lint
echo "Linting..."
npm run lint

echo "✅ All validation checks passed!"
