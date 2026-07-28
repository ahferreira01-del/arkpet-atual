#!/bin/bash
set -e

# Install any new/changed dependencies (non-interactive)
pnpm install --frozen-lockfile=false

# Rebuild the API server (covers schema, startup, and lib changes)
pnpm --filter @workspace/api-server run build

# Rebuild shared libs if present (idempotent, fast when nothing changed)
pnpm --filter @workspace/db run build 2>/dev/null || true
pnpm --filter @workspace/api-client-react run build 2>/dev/null || true
