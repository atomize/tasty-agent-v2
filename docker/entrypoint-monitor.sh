#!/usr/bin/env bash
set -euo pipefail

export SERVE_DASHBOARD="${SERVE_DASHBOARD:-true}"

echo "[monitor] Starting tastytrade options monitor"
echo "[monitor] SERVE_DASHBOARD=${SERVE_DASHBOARD}"
echo "[monitor] PORT=${PORT:-3001} (WS_PORT=${WS_PORT:-<unset>})"
echo "[monitor] TASTYTRADE_ENV=${TASTYTRADE_ENV:-sandbox}"

exec node /app/packages/monitor/dist/main.js "$@"
