#!/usr/bin/env bash
set -euo pipefail

PI_PROVIDER="${PI_PROVIDER:-anthropic}"
PI_MODEL="${PI_MODEL:-claude-sonnet-4-20250514}"
MONITOR_WS_URL="${MONITOR_WS_URL:-ws://localhost:3001}"

echo "[pi-agent] Provider: ${PI_PROVIDER}"
echo "[pi-agent] Model: ${PI_MODEL}"
echo "[pi-agent] Monitor WS: ${MONITOR_WS_URL}"

# ── Generate ~/.pi/agent/settings.json ───────────────────────────
mkdir -p ~/.pi/agent

PACKAGES='[]'
EXTRA_INSTALL=""

case "${PI_PROVIDER}" in
  cursor-agent)
    PACKAGES='["npm:pi-cursor-agent"]'
    EXTRA_INSTALL="npm:pi-cursor-agent"
    ;;
  cliproxy)
    PACKAGES='["npm:pi-cliproxy"]'
    EXTRA_INSTALL="npm:pi-cliproxy"
    ;;
esac

cat > ~/.pi/agent/settings.json <<SETTINGS
{
  "packages": ${PACKAGES},
  "defaultProvider": "${PI_PROVIDER}",
  "defaultModel": "${PI_MODEL}"
}
SETTINGS

echo "[pi-agent] Wrote settings.json (provider=${PI_PROVIDER})"

# ── Generate ~/.pi/agent/auth.json for OAuth providers ───────────
if [ "${PI_PROVIDER}" = "cursor-agent" ]; then
  if [ -z "${PI_CURSOR_ACCESS_TOKEN:-}" ] || [ -z "${PI_CURSOR_REFRESH_TOKEN:-}" ]; then
    echo "[pi-agent] ERROR: cursor-agent requires PI_CURSOR_ACCESS_TOKEN and PI_CURSOR_REFRESH_TOKEN"
    exit 1
  fi
  cat > ~/.pi/agent/auth.json <<AUTH
{
  "cursor-agent": {
    "type": "oauth",
    "access": "${PI_CURSOR_ACCESS_TOKEN}",
    "refresh": "${PI_CURSOR_REFRESH_TOKEN}",
    "expires": 9999999999000
  }
}
AUTH
  echo "[pi-agent] Wrote auth.json for cursor-agent"
fi

# ── Install proxy extensions if needed ───────────────────────────
if [ -n "${EXTRA_INSTALL}" ]; then
  echo "[pi-agent] Installing extension: ${EXTRA_INSTALL}"
  pi install "${EXTRA_INSTALL}" || echo "[pi-agent] WARN: extension install failed, continuing"
fi

# ── Install the tastytrade pi-agent package ──────────────────────
echo "[pi-agent] Installing tastytrade alert-receiver extension"
pi install /app/packages/pi-agent

# ── Export env vars ──────────────────────────────────────────────
export MONITOR_WS_URL
export PI_MODEL

# ── Start the persistent runner ──────────────────────────────────
# The runner stays alive, listens for alerts on WS, and invokes
# `pi --print --no-session` on-demand for each alert.
echo "[pi-agent] Starting persistent alert runner"
exec node /app/packages/pi-agent/runner.mjs
