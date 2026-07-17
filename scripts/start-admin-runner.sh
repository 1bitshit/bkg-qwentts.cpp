#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/.runtime" "$ROOT/logs"
PID="$ROOT/.runtime/admin-runner.pid"
if [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; then
  echo "admin runner already running"
  exit 0
fi
nohup "$ROOT/scripts/admin-runner.sh" >"$ROOT/logs/admin-runner.log" 2>&1 </dev/null &
echo $! > "$PID"
echo "admin runner started: $!"
