#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN="$ROOT/lmstudio-plugin"
command -v npm >/dev/null || { echo 'npm fehlt' >&2; exit 1; }
command -v lms >/dev/null || { echo 'lms CLI fehlt' >&2; exit 1; }
cd "$PLUGIN"
npm install --no-audit --no-fund
npm run typecheck
exec lms dev
