#!/usr/bin/env bash
# One-command local launcher: sets up Python + Node deps, builds data/frontend if needed, serves on :8000.
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8000}"

# Python environment
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
  .venv/bin/pip install -q -r backend/requirements.txt
fi

# Data (skip download if processed parquet already exists)
if [ ! -f data/processed/isolates.parquet ]; then
  if ! ls data/raw/*.amr.metadata.tsv >/dev/null 2>&1; then
    echo "Downloading raw data (~1.7 GB, a few minutes)..."
    ./pipeline/download.sh
  fi
  .venv/bin/python pipeline/build_data.py
fi

# Frontend build (uses system node if present, else the bundled .tools/node)
if [ ! -f frontend/dist/index.html ] || [ "${REBUILD:-0}" = "1" ]; then
  if ! command -v npm >/dev/null 2>&1; then export PATH="$PWD/.tools/node/bin:$PATH"; fi
  command -v npm >/dev/null 2>&1 || { echo "Node.js 20+ is required to build the frontend (https://nodejs.org)"; exit 1; }
  (cd frontend && npm ci --no-audit --no-fund && npm run build)
fi

echo "Pathogen Atlas -> http://localhost:$PORT"
exec .venv/bin/uvicorn backend.main:app --host 0.0.0.0 --port "$PORT"
