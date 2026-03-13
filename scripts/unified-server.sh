#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$ROOT_DIR/tmp"
PID_FILE="$TMP_DIR/unified-server.pid"
LOG_FILE="$TMP_DIR/unified-server.log"
ENV_FILE="$ROOT_DIR/../.env"
NODE_CMD=(node --env-file="$ENV_FILE" "$ROOT_DIR/dist/unified/index.js")
STARTUP_TIMEOUT_SECONDS="${STARTUP_TIMEOUT_SECONDS:-12}"

mkdir -p "$TMP_DIR"

get_port() {
  if [[ -n "${WORZEL_PORT:-}" ]]; then
    printf '%s\n' "$WORZEL_PORT"
    return
  fi

  if [[ -f "$ENV_FILE" ]]; then
    local line
    line="$(grep -E '^[[:space:]]*WORZEL_PORT=' "$ENV_FILE" | tail -n 1 || true)"
    if [[ -n "$line" ]]; then
      line="${line#*=}"
      line="${line%\"}"
      line="${line#\"}"
      line="${line%\'}"
      line="${line#\'}"
      if [[ -n "$line" ]]; then
        printf '%s\n' "$line"
        return
      fi
    fi
  fi

  printf '3000\n'
}

is_running_pid() {
  local pid="$1"
  kill -0 "$pid" 2>/dev/null
}

health_url() {
  printf 'http://127.0.0.1:%s/api/health\n' "$(get_port)"
}

read_pid() {
  if [[ -f "$PID_FILE" ]]; then
    tr -d '[:space:]' < "$PID_FILE"
  fi
}

cleanup_stale_pid() {
  local pid
  pid="$(read_pid || true)"
  if [[ -n "$pid" ]] && ! is_running_pid "$pid"; then
    rm -f "$PID_FILE"
  fi
}

is_healthy() {
  curl -fsS --max-time 2 "$(health_url)" >/dev/null 2>&1
}

wait_for_healthy_start() {
  local pid="$1"
  local attempts
  attempts=$(( STARTUP_TIMEOUT_SECONDS * 4 ))

  for _ in $(seq 1 "$attempts"); do
    if ! is_running_pid "$pid"; then
      return 1
    fi
    if is_healthy; then
      return 0
    fi
    sleep 0.25
  done

  return 1
}

status_cmd() {
  cleanup_stale_pid
  local pid port
  pid="$(read_pid || true)"
  port="$(get_port)"

  if [[ -n "$pid" ]] && is_running_pid "$pid" && is_healthy; then
    printf 'unified server is running\n'
    printf 'pid: %s\n' "$pid"
    printf 'port: %s\n' "$port"
    printf 'health: %s\n' "$(health_url)"
    printf 'log: %s\n' "$LOG_FILE"
    return 0
  fi

  if [[ -n "$pid" ]] && is_running_pid "$pid"; then
    printf 'unified server process exists but is not healthy yet\n'
    printf 'pid: %s\n' "$pid"
    printf 'port: %s\n' "$port"
    printf 'health: %s\n' "$(health_url)"
    printf 'log: %s\n' "$LOG_FILE"
    return 1
  fi

  printf 'unified server is stopped\n'
  printf 'expected port: %s\n' "$port"
  printf 'health: %s\n' "$(health_url)"
  printf 'log: %s\n' "$LOG_FILE"
  return 1
}

start_cmd() {
  cleanup_stale_pid
  local pid
  pid="$(read_pid || true)"
  if [[ -n "$pid" ]] && is_running_pid "$pid"; then
    printf 'unified server already running (pid %s)\n' "$pid"
    return 0
  fi

  if [[ ! -f "$ROOT_DIR/dist/unified/index.js" ]]; then
    printf 'dist/unified/index.js not found; run npm run build first\n' >&2
    return 1
  fi

  : > "$LOG_FILE"
  nohup "${NODE_CMD[@]}" >>"$LOG_FILE" 2>&1 < /dev/null &
  pid=$!
  printf '%s\n' "$pid" > "$PID_FILE"

  if wait_for_healthy_start "$pid"; then
    printf 'started unified server\n'
    printf 'pid: %s\n' "$pid"
    printf 'port: %s\n' "$(get_port)"
    printf 'health: %s\n' "$(health_url)"
    printf 'log: %s\n' "$LOG_FILE"
    return 0
  fi

  rm -f "$PID_FILE"
  printf 'failed to start unified server; see %s\n' "$LOG_FILE" >&2
  tail -n 40 "$LOG_FILE" >&2 || true
  return 1
}

stop_cmd() {
  cleanup_stale_pid
  local pid
  pid="$(read_pid || true)"
  if [[ -z "$pid" ]]; then
    printf 'unified server is not running\n'
    return 0
  fi

  if ! is_running_pid "$pid"; then
    rm -f "$PID_FILE"
    printf 'removed stale pid file\n'
    return 0
  fi

  kill "$pid"
  for _ in $(seq 1 20); do
    if ! is_running_pid "$pid"; then
      rm -f "$PID_FILE"
      printf 'stopped unified server\n'
      return 0
    fi
    sleep 0.25
  done

  printf 'server did not exit after SIGTERM; sending SIGKILL\n'
  kill -9 "$pid"
  rm -f "$PID_FILE"
  printf 'stopped unified server\n'
}

restart_cmd() {
  stop_cmd
  start_cmd
}

logs_cmd() {
  touch "$LOG_FILE"
  tail -n "${TAIL_LINES:-80}" -f "$LOG_FILE"
}

run_fg_cmd() {
  exec "${NODE_CMD[@]}"
}

case "${1:-}" in
  start) start_cmd ;;
  stop) stop_cmd ;;
  restart) restart_cmd ;;
  status) status_cmd ;;
  logs) logs_cmd ;;
  run-fg) run_fg_cmd ;;
  *)
    printf 'usage: %s {start|stop|restart|status|logs|run-fg}\n' "$(basename "$0")" >&2
    exit 2
    ;;
esac
