#!/bin/bash

# Pre-push CI checks - Run locally before pushing to ensure CI will pass

set -e  # Exit on error

echo "🔍 Running pre-push checks..."
echo ""

echo "📦 Installing dependencies..."
pnpm install --frozen-lockfile
echo "✅ Dependencies installed"
echo ""

echo "🏗️  Building packages..."
pnpm build
echo "✅ Build complete"
echo ""

echo "🔤 Running linter..."
pnpm lint
echo "✅ Lint passed"
echo ""

echo "📝 Running type check..."
pnpm typecheck
echo "✅ Type check passed"
echo ""

echo "🧪 Running unit tests..."
pnpm test:unit
echo "✅ Unit tests passed"
echo ""

echo "🔗 Running integration tests..."
pnpm test:integration
echo "✅ Integration tests passed"
echo ""

echo "✨ All checks passed! Ready to push 🚀"
