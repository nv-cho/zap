#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -x .venv/bin/python ] || [ ! -d frontend/node_modules ]; then
  echo "Install dependencies using README.md first."
  exit 1
fi
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 &
backend_pid=$!
(cd frontend && exec node node_modules/next/dist/bin/next dev --hostname 127.0.0.1) &
frontend_pid=$!
cleanup() { kill "$backend_pid" "$frontend_pid" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
wait
