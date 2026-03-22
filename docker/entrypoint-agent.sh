#!/usr/bin/env bash
set -euo pipefail

AGENT_PROVIDER="${AGENT_PROVIDER:-pi}"

echo "[agent] Provider: ${AGENT_PROVIDER}"

case "${AGENT_PROVIDER}" in
  claude-sdk)
    echo "[agent] Starting Claude Agent SDK runner"
    exec node /app/packages/claude-agent/dist/runner.js
    ;;
  pi|*)
    echo "[agent] Delegating to pi entrypoint"
    exec /app/docker/entrypoint-pi.sh
    ;;
esac
