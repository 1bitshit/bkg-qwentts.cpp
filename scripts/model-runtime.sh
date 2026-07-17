#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME="$ROOT/.runtime/models"
LOGS="$ROOT/logs/models"
mkdir -p "$RUNTIME" "$LOGS"
CODEC="${BKG_QWENTTS_CODEC:-$ROOT/models/qwen-tokenizer-12hz-BF16.gguf}"
LIVE_Q8="${TTS_LIVE_Q8_MODEL:-$ROOT/models/qwen-talker-0.6b-base-BF16.gguf}"
LIVE_Q4="${TTS_LIVE_Q4_MODEL:-$ROOT/models/qwen-talker-0.6b-base-Q4_K_M.gguf}"
STUDIO="${TTS_STUDIO_MODEL:-$ROOT/models/qwen-talker-1.7b-voicedesign-BF16.gguf}"
LIVE_PORT="${TTS_LIVE_PORT:-8012}"
STUDIO_PORT="${TTS_STUDIO_PORT:-8013}"
BACKEND="${BKG_QWENTTS_BACKEND:-CUDA0}"
pid_alive(){ [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }
stop_one(){ local f="$1"; if pid_alive "$f"; then kill "$(cat "$f")" 2>/dev/null || true; fi; rm -f "$f"; }
wait_health(){ local p="$1"; for _ in $(seq 1 90); do curl -fsS "http://127.0.0.1:$p/health" >/dev/null 2>&1 && return 0; sleep 1; done; return 1; }
start_model(){ local name="$1" model="$2" port="$3" backend="$4"; local pf="$RUNTIME/$name.pid"; pid_alive "$pf" && return 0; [ -s "$model" ] || { echo "Modell fehlt: $model" >&2; return 1; }; nohup env GGML_BACKEND="$backend" "$ROOT/build/tts-server" --model "$model" --codec "$CODEC" --host 127.0.0.1 --port "$port" --lang German >"$LOGS/$name.log" 2>&1 </dev/null & echo $! > "$pf"; wait_health "$port" || { tail -80 "$LOGS/$name.log" >&2; return 1; }; }
case "${1:-status}" in
 live) stop_one "$RUNTIME/studio.pid"; start_model live "$LIVE_Q8" "$LIVE_PORT" "$BACKEND" ;;
 live-q4) stop_one "$RUNTIME/studio.pid"; start_model live "$LIVE_Q4" "$LIVE_PORT" CPU ;;
 studio) stop_one "$RUNTIME/live.pid"; start_model studio "$STUDIO" "$STUDIO_PORT" "$BACKEND" ;;
 unload) stop_one "$RUNTIME/live.pid"; stop_one "$RUNTIME/studio.pid" ;;
 status) for n in live studio; do if pid_alive "$RUNTIME/$n.pid"; then echo "$n running PID $(cat "$RUNTIME/$n.pid")"; else echo "$n stopped"; fi; done ;;
 *) echo "usage: $0 live|live-q4|studio|unload|status" >&2; exit 2 ;;
esac
