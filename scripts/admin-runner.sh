#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
QUEUE="$ROOT/.runtime/admin-queue"
DONE="$ROOT/.runtime/admin-done"
LOGS="$ROOT/logs/admin"
mkdir -p "$QUEUE" "$DONE" "$LOGS"

run_job() {
  local job="$1" action script log
  action="$(tr -d '\r\n' < "$job")"
  case "$action" in
    build-cpu) script="scripts/buildcpu.sh" ;;
    build-cuda) script="scripts/buildcuda.sh" ;;
    build-vulkan) script="scripts/buildvulkan.sh" ;;
    update) script="scripts/update.sh" ;;
    models) script="scripts/models.sh" ;;
    format) script="scripts/format.sh" ;;
    install-lmstudio-plugin) script="scripts/install-lmstudio-plugin.sh" ;;
    *) mv "$job" "$DONE/$(basename "$job").rejected"; return ;;
  esac
  log="$LOGS/$(basename "$job" .job).log"
  (cd "$ROOT" && bash "$script") >"$log" 2>&1 || true
  mv "$job" "$DONE/$(basename "$job").done"
}

while true; do
  found=false
  for job in "$QUEUE"/*.job; do
    [ -e "$job" ] || continue
    found=true
    run_job "$job"
  done
  $found || sleep 1
done
