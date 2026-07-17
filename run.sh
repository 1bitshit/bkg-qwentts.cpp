#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
ACTION="${1:-start}"
RUNTIME="$ROOT/.runtime/run"
LOGS="$ROOT/logs"
mkdir -p "$RUNTIME" "$LOGS" "$ROOT/bin"

load_env() {
  [ -f "$ROOT/.env" ] || { echo "Fehlt: $ROOT/.env" >&2; exit 1; }
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^[[:space:]]*# || -z "$key" ]] && continue
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    value="${value%\"}"; value="${value#\"}"
    [ -n "${!key+x}" ] || export "$key=$value"
  done < "$ROOT/.env"
}
load_env

TTS_PORT="${BKG_QWENTTS_PORT:-8010}"
WEB_PORT="${PORT:-8000}"
LMS_PORT="${LM_STUDIO_INTERNAL_PORT:-1234}"
LMS_PUBLIC_PORT="${LM_STUDIO_PROXY_PORT:-1235}"
TALKER="${BKG_QWENTTS_MODEL:-$ROOT/models/qwen-talker-1.7b-customvoice-Q8_0.gguf}"
CODEC="${BKG_QWENTTS_CODEC:-$ROOT/models/qwen-tokenizer-12hz-Q8_0.gguf}"
TEXT_MODEL_URL="${LM_STUDIO_MODEL_URL:-https://huggingface.co/unsloth/Qwen3-14B-128K-GGUF/resolve/main/Qwen3-14B-128K-Q4_K_M.gguf}"
TEXT_MODEL_FILE="${LM_STUDIO_MODEL_FILE:-$ROOT/models/text/Qwen3-14B-128K-Q4_K_M.gguf}"
pid_alive() {
  local file="$1" pid
  [ -f "$file" ] || return 1
  pid="$(cat "$file" 2>/dev/null || true)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

stop_pid() {
  local file="$1" pid
  [ -f "$file" ] || return 0
  pid="$(cat "$file" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
    for _ in 1 2 3 4 5; do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$file"
}

wait_http() {
  local url="$1" name="$2"
  for _ in $(seq 1 60); do
    curl -fsS "$url" >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "$name antwortet nicht: $url" >&2
  return 1
}

require_models() {
  [ -s "$TALKER" ] || { echo "Talker-Modell fehlt: $TALKER" >&2; exit 1; }
  [ -s "$CODEC" ] || { echo "Codec-Modell fehlt: $CODEC" >&2; exit 1; }
}
ensure_build() {
  if [ ! -f "$ROOT/webui/dist/index.html" ] || find "$ROOT/webui/src" -type f -newer "$ROOT/webui/dist/index.html" | grep -q .; then
    echo "[run] Baue WebUI"
    (cd webui && npm install --no-audit --no-fund && npm run build)
    python3 tools/embed_web_assets.py
  fi
  if [ ! -x build/tts-server ] || [ "$ROOT/src/tts-web-assets.h" -nt "$ROOT/build/tts-server" ] || find "$ROOT/src" "$ROOT/tools" -type f -newer "$ROOT/build/tts-server" | grep -q .; then
    echo "[run] Baue tts-server"
    cmake --build build --target tts-server -j"$(nproc)"
  fi
}

start_tts() {
  local pidfile="$RUNTIME/tts-server.pid"
  pid_alive "$pidfile" && return
  nohup "$ROOT/build/tts-server" \
    --model "$TALKER" --codec "$CODEC" \
    --host 0.0.0.0 --port "$TTS_PORT" --lang auto \
    >"$LOGS/tts-server.log" 2>&1 </dev/null &
  echo $! > "$pidfile"
  sleep 1
  pid_alive "$pidfile" || { tail -80 "$LOGS/tts-server.log" >&2; return 1; }
  wait_http "http://127.0.0.1:$TTS_PORT/health" "TTS-Server"
}

start_proxy() {
  local name="$1" listen="$2" target="$3"
  local pidfile="$RUNTIME/$name.pid"
  pid_alive "$pidfile" && return
  nohup env PROXY_LISTEN_HOST=0.0.0.0 PROXY_LISTEN_PORT="$listen" \
    PROXY_TARGET_HOST=127.0.0.1 PROXY_TARGET_PORT="$target" \
    python3 "$ROOT/setup/port-proxy.py" >"$LOGS/$name.log" 2>&1 </dev/null &
  echo $! > "$pidfile"
}
find_lms() {
  command -v lms 2>/dev/null || true
  [ -x "$HOME/.lmstudio/bin/lms" ] && echo "$HOME/.lmstudio/bin/lms"
  return 0
}

ensure_lms() {
  local lms
  lms="$(find_lms | head -n1)"
  if [ -z "$lms" ]; then
    echo "[run] Installiere LM Studio llmster"
    local installer="$RUNTIME/lmstudio-install.sh"
    curl -fsSL https://lmstudio.ai/install.sh -o "$installer"
    chmod 700 "$installer"
    CI=1 NONINTERACTIVE=1 bash "$installer" </dev/null
    lms="$(find_lms | head -n1)"
  fi
  [ -n "$lms" ] || { echo "LM-Studio-CLI fehlt" >&2; return 1; }
  "$lms" daemon up
  "$lms" server start --port "$LMS_PORT" --bind 127.0.0.1 >/dev/null 2>&1 || true
  wait_http "http://127.0.0.1:$LMS_PORT/v1/models" "LM Studio"
  mkdir -p "$(dirname "$TEXT_MODEL_FILE")"
  if [ ! -s "$TEXT_MODEL_FILE" ]; then
    echo "[run] Lade Story-/Debattenmodell"
    if command -v wget >/dev/null 2>&1; then
      wget -c --progress=dot:giga -O "$TEXT_MODEL_FILE" "$TEXT_MODEL_URL"
    else
      curl -L --fail --retry 5 -C - -o "$TEXT_MODEL_FILE" "$TEXT_MODEL_URL"
    fi
  fi
  if ! "$lms" ls 2>/dev/null | grep -Fq "Qwen3-14B-128K-Q4_K_M"; then
    "$lms" import --symbolic-link --yes --user-repo unsloth/Qwen3-14B-128K-GGUF "$TEXT_MODEL_FILE"
  fi
  if ! "$lms" ps 2>/dev/null | grep -Fq "story-debate"; then
    "$lms" load "Qwen3-14B-128K-Q4_K_M" --identifier story-debate \
      --context-length "${STORY_AUTHOR_CONTEXT:-16384}" \
      --gpu "${STORY_AUTHOR_GPU_OFFLOAD:-max}" --yes
  fi
}

start_lms_bridge() {
  local pidfile="$RUNTIME/lms-bridge.pid"
  pid_alive "$pidfile" && return
  (cd "$ROOT/lms-bridge" && npm install --no-audit --no-fund)
  nohup env LMS_BRIDGE_HOST=127.0.0.1 LMS_BRIDGE_PORT=1236     LMS_SDK_BASE_URL="ws://127.0.0.1:$LMS_PORT"     LMS_DEFAULT_MODEL=qwen3-14b-128k     LMS_BIN="$(find_lms | head -n1)"     node "$ROOT/lms-bridge/src/server.mjs"     >"$LOGS/lms-bridge.log" 2>&1 </dev/null &
  echo $! > "$pidfile"
  sleep 1
  pid_alive "$pidfile" || { tail -80 "$LOGS/lms-bridge.log" >&2; return 1; }
  wait_http "http://127.0.0.1:1236/health" "LM-Studio-Bridge"
}

start_admin() {
  local pidfile="$ROOT/.runtime/admin-runner.pid"
  pid_alive "$pidfile" || "$ROOT/scripts/start-admin-runner.sh"
}

ensure_beam() {
  if [ ! -x "$ROOT/bin/beam" ]; then
    [ -x /notebooks/alpha/tts/bin/beam ] || { echo "Beam-Client fehlt" >&2; return 1; }
    cp /notebooks/alpha/tts/bin/beam "$ROOT/bin/beam"
    chmod 755 "$ROOT/bin/beam"
  fi
}

start_beam() {
  local name="$1" local_port="$2" remote_port="$3"
  local pidfile="$RUNTIME/beam-$name.pid"
  pid_alive "$pidfile" && return
  nohup env BEAM_USERNAME="$BEAM_USERNAME" BEAM_API_KEY="$BEAM_API_KEY" \
    BEAM_DOMAIN="${BEAM_DOMAIN:-beam.eysho.info}" \
    BEAM_CONTROL_PORT="${BEAM_CONTROL_PORT:-8080}" \
    "$ROOT/bin/beam" --debug --undead "$local_port:me" "up:$remote_port" \
    >"$LOGS/beam-$name.log" 2>&1 </dev/null &
  echo $! > "$pidfile"
  sleep 1
  pid_alive "$pidfile" || { tail -60 "$LOGS/beam-$name.log" >&2; return 1; }
  echo "$name: http://${BEAM_USERNAME}-${local_port}me-up${remote_port}.${BEAM_DOMAIN:-beam.eysho.info}"
}

start_plugin() {
  [ "${LMS_PLUGIN_ENABLED:-true}" = "true" ] || return 0
  local lms pidfile="$RUNTIME/lmstudio-plugin.pid"
  lms="$(find_lms | head -n1)"
  [ -n "$lms" ] || return 0
  pid_alive "$pidfile" && return
  (cd lmstudio-plugin && npm install --no-audit --no-fund && npm run typecheck)
  nohup bash -lc 'cd "$1" && exec "$2" dev --install --yes --no-notify' _ \
    "$ROOT/lmstudio-plugin" "$lms" >"$LOGS/lmstudio-plugin.log" 2>&1 </dev/null &
  echo $! > "$pidfile"
}
stop_all() {
  for file in "$RUNTIME"/*.pid; do [ -e "$file" ] && stop_pid "$file"; done
  stop_pid "$ROOT/.runtime/admin-runner.pid"
  if lms="$(find_lms | head -n1)"; [ -n "${lms:-}" ]; then
    "$lms" server stop >/dev/null 2>&1 || true
  fi
}

status_all() {
  printf 'TTS: '; curl -fsS "http://127.0.0.1:$TTS_PORT/health" 2>/dev/null || echo stopped
  printf '\nWeb: '; curl -fsS "http://127.0.0.1:$WEB_PORT/health" 2>/dev/null || echo stopped
  printf '\nLM Studio: '; curl -fsS "http://127.0.0.1:$LMS_PORT/v1/models" 2>/dev/null || echo stopped
  printf '\nLM Proxy: '; curl -fsS "http://127.0.0.1:$LMS_PUBLIC_PORT/v1/models" 2>/dev/null || echo stopped
  printf '\nLM Bridge: '; curl -fsS "http://127.0.0.1:1236/health" 2>/dev/null || echo stopped
  printf '\nProzesse:\n'
  for file in "$RUNTIME"/*.pid "$ROOT/.runtime/admin-runner.pid"; do
    [ -e "$file" ] || continue
    if pid_alive "$file"; then echo "running $(basename "$file") PID $(cat "$file")"; else echo "stale $(basename "$file")"; fi
  done
}

start_all() {
  require_models
  ensure_build
  pkill -f '/notebooks/alpha/tts/bin/beam' 2>/dev/null || true
  pkill -f 'setup/port-proxy.py' 2>/dev/null || true
  pkill -f 'build/tts-server' 2>/dev/null || true
  command -v fuser >/dev/null 2>&1 && fuser -k "$WEB_PORT/tcp" "$TTS_PORT/tcp" "$LMS_PUBLIC_PORT/tcp" 2>/dev/null || true
  sleep 1
  rm -f "$RUNTIME"/*.pid
  start_tts
  start_proxy web-proxy "$WEB_PORT" "$TTS_PORT"
  start_admin
  if ! ensure_lms; then echo "[run] WARNUNG: LM Studio konnte nicht gestartet werden" >&2; fi
  start_proxy lm-proxy "$LMS_PUBLIC_PORT" "$LMS_PORT"
  start_lms_bridge
  start_plugin
  ensure_beam
  start_beam qwen "$WEB_PORT" "${BEAM_TTS_REMOTE_PORT:-80}"
  start_beam bkg-qwentts "$TTS_PORT" "${BEAM_BKG_QWENTTS_REMOTE_PORT:-80}"
  start_beam lms "$LMS_PUBLIC_PORT" "${BEAM_LMS_REMOTE_PORT:-80}"
  if [ "${BEAM_SSH_ENABLED:-false}" = "true" ]; then
    start_beam ssh "${BEAM_SSH_LOCAL_PORT:-22}" "${BEAM_SSH_REMOTE_PORT:-22}"
  fi
  status_all
}

case "$ACTION" in
  start) start_all ;;
  stop) stop_all ;;
  restart) stop_all; start_all ;;
  status) status_all ;;
  *) echo "Usage: $0 {start|stop|restart|status}" >&2; exit 2 ;;
esac
