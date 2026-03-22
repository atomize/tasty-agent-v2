# Claude Agent SDK Integration — Branch Change Document

## Overview

This branch introduces the **Claude Agent SDK** as a first-class AI backend for the tastytrade options monitor, alongside a **multi-tenant authentication system**, **dashboard agent configuration UI**, and **option chain fixes**. It replaces the previous pi-agent-only architecture with a pluggable agent system that supports multiple providers (Claude SDK, webhooks, WebSocket agents) and can serve multiple users with per-user agent configuration.

**Scope**: ~1,600 lines changed across 32 files. 1 new package (`packages/claude-agent`), 6 new monitor modules, 2 new dashboard components, updated Docker and Render infrastructure.

---

## Table of Contents

1. [New Package: claude-agent](#1-new-package-claude-agent)
2. [Multi-Tenant System](#2-multi-tenant-system)
3. [Dashboard Changes](#3-dashboard-changes)
4. [Monitor Changes](#4-monitor-changes)
5. [Option Chain Fix](#5-option-chain-fix)
6. [Infrastructure Changes](#6-infrastructure-changes)
7. [Shared Schema Changes](#7-shared-schema-changes)
8. [Environment Variables](#8-environment-variables)
9. [How to Run Locally](#9-how-to-run-locally)
10. [How to Test the Claude SDK Agent](#10-how-to-test-the-claude-sdk-agent)
11. [How to Deploy](#11-how-to-deploy)
12. [Architecture Diagram](#12-architecture-diagram)
13. [Known Limitations](#13-known-limitations)
14. [File-by-File Changelog](#14-file-by-file-changelog)

---

## 1. New Package: claude-agent

**Path**: `packages/claude-agent/`

A standalone WebSocket client that connects to the monitor's WS server, receives market alerts, invokes the Claude Agent SDK to produce structured trade recommendations, and sends the analysis back.

### Source Files

| File | Purpose |
|------|---------|
| `src/invoke.ts` | Core SDK integration. Calls `@anthropic-ai/claude-agent-sdk`'s `query()` function with structured JSON output, a system prompt from `CLAUDE.md`, and read-only tools (Read, Grep, Glob). Streams the async generator, extracts structured output or falls back to raw text. |
| `src/runner.ts` | WebSocket client that connects to the monitor on port 3001. Receives `alert` messages, builds prompts with strategy hints, invokes the SDK, and sends back `agent_analysis` / `agent_status` messages. Includes cooldowns (5 min per ticker:type), a bounded queue (max 5), heartbeat pings (30s), and auto-reconnect (5s). |
| `src/schema.ts` | Zod schema for `TradeRecommendation` (signal, trade, size, thesis, stop, invalidation) converted to JSON Schema for the SDK's structured output mode via `zod-to-json-schema`. |
| `src/config.ts` | Environment-based configuration. Reads `CLAUDE_API_KEY` (falls back to `ANTHROPIC_API_KEY`), model, budget cap, max turns, monitor WS URL. |

### Agent Skills (`.claude/skills/`)

Three domain knowledge files loaded as the agent's system context:

| Skill | File | Content |
|-------|------|---------|
| Options Trader | `options-trader/SKILL.md` | Core analytical framework: IV context, Greeks awareness, position sizing (1-5% BP), trigger-specific guidance for IV_SPIKE / PRICE_MOVE / IV_RANK_HIGH / IV_RANK_LOW / SCHEDULED / CRYPTO. |
| AI Supply Chain | `ai-supply-chain/SKILL.md` | 7-layer AI infrastructure thesis with 22 tickers mapped to layers (Packaging → Optical → Signal → Rack → Thermal → Materials → Nuclear). Includes inter-layer dependency analysis guidance. |
| Midterm Macro | `midterm-macro/SKILL.md` | 30-90 day sector plays across Energy (XLE/XOM/CVX), Defense (RTX/LMT/NOC), AI Semis (NVDA/AVGO), and Hedges (QQQ/SPY). Cross-sector hedging logic matrix. |

### System Prompt (`CLAUDE.md`)

Instructs the agent to behave as "a concise options desk trader at a Chicago clearinghouse." Enforces:
- JSON output format with 6 fields (signal, trade, size, thesis, stop, invalidation)
- Under 150 words total
- Exact ticker/strike/expiry/allocation in every recommendation
- "Spot only — no options" for crypto (BTC/USD, ETH/USD)
- Delayed-data caveats for sandbox mode

### Dependencies

- `@anthropic-ai/claude-agent-sdk` ^0.1.0
- `zod` + `zod-to-json-schema` for structured output
- `ws` for WebSocket client
- `dotenv` for config

---

## 2. Multi-Tenant System

Gated by the `ENCRYPTION_KEY` environment variable. When not set, the monitor runs in single-tenant mode (no auth, env-var config). When set, the full multi-tenant stack activates.

### New Monitor Modules

| File | Purpose |
|------|---------|
| `src/crypto.ts` | AES-256-GCM encryption/decryption for API keys stored in SQLite. Uses `ENCRYPTION_KEY` (32-byte hex) for encrypt/decrypt. Includes `maskApiKey()` for UI display. |
| `src/db.ts` | SQLite database (via `better-sqlite3`) with WAL mode. Two tables: `users` (email, bcrypt password hash) and `agent_configs` (provider, encrypted API key, model, budget, external URL). Auto-migrates on first access. Stored at `data/monitor.db`. |
| `src/auth.ts` | JWT-based authentication. Registration with bcrypt hashing (10 rounds), login with password verification, token generation/verification (24h expiry). Uses `JWT_SECRET` env var. |
| `src/agent-orchestrator.ts` | Multi-tenant alert dispatch. When an alert fires, iterates all active agent configs from the DB and dispatches to each user's configured backend. Supports three modes: `claude-sdk` (dynamically imports `invokeClaudeSDK`), `webhook` (HTTP POST with 60s timeout), `websocket` (persistent WS pool with response correlation). Per-user cooldowns (5 min per ticker:type). |

### How It Works

1. User registers/logs in via the dashboard's `AuthGate` component
2. JWT token is stored in `localStorage` and sent on WebSocket reconnect
3. User configures their agent backend in the Settings tab (provider, API key, model, budget)
4. API keys are encrypted with AES-256-GCM before storage in SQLite
5. When an alert fires, the orchestrator decrypts the key and invokes the user's chosen provider
6. Analysis results are broadcast to all connected dashboard clients

---

## 3. Dashboard Changes

### New Components

| Component | File | Purpose |
|-----------|------|---------|
| `AuthGate` | `src/components/AuthGate.tsx` | Login/register form shown when multi-tenant mode is active and the user isn't authenticated. Email + password fields, toggle between login/register modes. |
| `AgentSettings` | `src/components/AgentSettings.tsx` | Settings tab for per-user agent configuration. Provider selector (Disabled / Claude API / Webhook / WebSocket), API key input with masking, model dropdown (Sonnet/Opus/Haiku), budget slider ($0.10-$5.00), external URL field for webhook/WS providers. |

### Modified Components

| Component | Changes |
|-----------|---------|
| `App.tsx` | Added `AgentStatusIndicator` in header (green/amber/red dot with state label). Added `AuthGate` wrapper for multi-tenant mode. Added Settings tab (conditional on multi-tenant). Added logout button in header. Passes `env` prop to `OptionChainPanel`. |
| `AgentExportPanel.tsx` | Minor: updated import path for `sendRaw`. |
| `OptionChainPanel.tsx` | Added `env` prop. Shows amber sandbox warning panel explaining that option chains are unavailable in sandbox mode, with guidance to switch to production. |

### Hook Changes

| Hook | Changes |
|------|---------|
| `useMonitorSocket.ts` | Extended significantly. New state: `multiTenant`, `agentConfig`, `authUser`, `authError`. New WS message handlers: `auth_result`, `agent_config`, `agent_status`, `alert_history`, `analysis_history`. New actions: `login()`, `register()`, `logout()`, `saveAgentConfig()`, `requestAgentConfig()`. JWT token persistence in `localStorage` with auto-send on reconnect. |

### Vite Config

- Added `strictPort: true` and `open: true` to prevent silent port fallback and auto-open the browser.

---

## 4. Monitor Changes

### `src/main.ts`

Added initialization of the multi-tenant stack:
- `initEncryption()` — returns `true` if `ENCRYPTION_KEY` is set
- `getDb()` — opens SQLite and runs migrations
- `initOrchestrator()` — registers the multi-tenant alert dispatcher
- New imports: `initEncryption` from `crypto.ts`, `getDb` from `db.ts`, `initOrchestrator` from `agent-orchestrator.ts`

### `src/broadcaster.ts`

Added two new exports consumed by `agent-orchestrator.ts`:
- `onAlertForOrchestrator(handler)` — registers a callback that fires when any alert is emitted
- `broadcastToAll(msg)` — public wrapper around the internal `broadcast()` function for the orchestrator to send analysis/status messages to all connected clients

### Auth Module Migration

`src/auth.ts` was repurposed from tastytrade auth to user auth (bcrypt + JWT). The tastytrade client initialization moved to the new `src/tastytrade-auth.ts`.

### `src/tastytrade-auth.ts` (new)

OAuth2 client initialization using `@tastytrade/api` v7. Creates a `TastytradeClient` with sandbox/production config, client secret, refresh token, and OAuth scopes. Exposes `initClient()` and `getClient()`.

### Module Import Updates

The following files were updated to import from `./tastytrade-auth.js` instead of `./auth.js`:
- `src/account.ts`
- `src/accountStreamer.ts`
- `src/chainFetcher.ts`
- `src/marketMetrics.ts`

### `src/monitor/package.json`

Added dependencies:
- `@tastytrade-monitor/claude-agent: workspace:*` (for orchestrator's dynamic import)
- `bcryptjs` + `@types/bcryptjs` (password hashing)
- `better-sqlite3` + `@types/better-sqlite3` (SQLite)
- `jsonwebtoken` + `@types/jsonwebtoken` (JWT)

---

## 5. Option Chain Fix

### Problem

The option chain tab in the dashboard was completely non-functional due to three stacked issues:

1. **Sandbox API returns 502**: The tastytrade sandbox (`api.cert.tastyworks.com`) does not support the `/option-chains/{symbol}/nested` endpoint. This is a documented limitation.
2. **Response parsing was wrong**: The code treated the API response as a flat array of expirations, but the nested endpoint returns an array of chain items, each containing an `expirations` array.
3. **Expected fields that don't exist**: The code tried to read `call-bid`, `call-ask`, `call-volume`, `call-delta`, `call-implied-volatility` etc. from the REST response. These fields don't exist in the nested chain — they come exclusively from the DXLink streamer.

### Fix (`src/chainFetcher.ts` — full rewrite)

1. **Sandbox guard**: Detects sandbox mode and returns immediately with a log message instead of making a doomed API call.
2. **Correct response parsing**: Properly navigates the nested chain structure (`items → first item → expirations → strikes`). Handles multiple response shapes via `normalizeChainItems()`.
3. **DXLink enrichment**: After getting the chain structure from REST, subscribes the option streamer symbols (e.g., `.NVDA260417C120`) to the existing `quoteStreamer` with `Quote`, `Greeks`, and `Summary` event types. Waits up to 3.5 seconds collecting live bid/ask, delta, IV, OI data, then unsubscribes and returns the merged result.
4. **Graceful degradation**: If DXLink enrichment fails, returns the chain structure with strike prices but zeros for market data fields.

---

## 6. Infrastructure Changes

### Docker (`docker/Dockerfile`)

The multi-stage build now includes the claude-agent package:

**Build stage**:
- Added `COPY packages/claude-agent/package.json packages/claude-agent/` to the dependency layer
- Added `COPY packages/claude-agent/ packages/claude-agent/` for source
- Added `pnpm --filter @tastytrade-monitor/claude-agent build` to the build chain

**Runtime stage**:
- Copies `packages/claude-agent/dist`, `package.json`, `node_modules`, and `.claude/` skills directory
- The `.claude/` directory is copied separately (not part of `dist`) so the agent can load its system prompt and skills at runtime

### Agent Entrypoint (`docker/entrypoint-agent.sh`) — new

Routes based on `AGENT_PROVIDER` environment variable:
- `claude-sdk` → `node /app/packages/claude-agent/dist/runner.js`
- `pi` (default) → delegates to existing `entrypoint-pi.sh`

### Docker Compose (`docker-compose.yml`)

The `agent` service now reads `AGENT_PROVIDER` from the host environment (defaulting to `pi`):
```yaml
environment:
  MONITOR_WS_URL: "ws://monitor:3001"
  AGENT_PROVIDER: "${AGENT_PROVIDER:-pi}"
```

### Render Blueprint (`render.yaml`)

- Added `CLAUDE_API_KEY`, `CLAUDE_MODEL`, `CLAUDE_MAX_BUDGET_USD` to the `llm-provider` env var group
- Agent provider is configurable via the `AGENT_PROVIDER` env var

### `.gitignore`

Added `data/` to ignore the SQLite database directory created by multi-tenant mode.

---

## 7. Shared Schema Changes

### `packages/shared/src/alert.schema.ts`

Added schemas and types for the multi-tenant system:

| Schema | Fields | Purpose |
|--------|--------|---------|
| `AgentProviderSchema` | `'claude-sdk' \| 'webhook' \| 'websocket' \| 'none'` | Provider selection |
| `AgentConfigSchema` | provider, apiKey?, model, maxBudgetUsd, externalUrl? | Save config payload |
| `AgentConfigResponseSchema` | provider, maskedApiKey, model, maxBudgetUsd, externalUrl | Read config response |
| `WsServerAuthResultSchema` | type: 'auth_result', success, token?, user?, error? | Auth response |
| `WsServerAgentConfigSchema` | type: 'agent_config', data: AgentConfigResponse | Config response |

Added to the `WsMessageSchema` discriminated union:
- `auth_result`
- `agent_config`

Added to `WsClientMessageSchema`:
- `auth` (login/register)
- `auth_token` (reconnect with stored JWT)
- `save_agent_config`
- `request_agent_config`

### `packages/shared/src/index.ts`

All new schemas and types are exported.

---

## 8. Environment Variables

### New Variables

| Variable | Default | Required | Purpose |
|----------|---------|----------|---------|
| `AGENT_PROVIDER` | `pi` | No | Which agent runs in Docker: `pi` or `claude-sdk` |
| `CLAUDE_API_KEY` | — | When `AGENT_PROVIDER=claude-sdk` | Anthropic API key for Claude SDK (falls back to `ANTHROPIC_API_KEY`) |
| `CLAUDE_MODEL` | `claude-sonnet-4-20250514` | No | Model for Claude SDK agent |
| `CLAUDE_MAX_BUDGET_USD` | `0.50` | No | Maximum spend per alert invocation |
| `ENCRYPTION_KEY` | — | No | 32-byte hex key to enable multi-tenant mode. Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `JWT_SECRET` | `dev-secret-change-in-production` | In production | Secret for signing user session JWTs |

### Existing Variables (unchanged)

| Variable | Purpose |
|----------|---------|
| `TASTYTRADE_CLIENT_ID` | OAuth2 client ID |
| `TASTYTRADE_CLIENT_SECRET` | OAuth2 client secret |
| `TASTYTRADE_REFRESH_TOKEN` | OAuth2 refresh token |
| `TASTYTRADE_ENV` | `sandbox` or `production` |
| `ANTHROPIC_API_KEY` | Fallback API key for Claude |
| `PI_PROVIDER` / `PI_MODEL` | Pi-agent LLM config |
| `PORT` / `WS_PORT` | Server ports |
| `SERVE_DASHBOARD` | Serve built dashboard from monitor |
| `MONITOR_WS_URL` | Override WS URL for agent |

---

## 9. How to Run Locally

### Prerequisites

- Node.js 22+
- pnpm (any recent version)
- A `.env` file at the repo root (copy from `.env.example`)

### Quick Start (Claude SDK agent)

```bash
# Install dependencies
pnpm install

# Set your API key in .env
# Either CLAUDE_API_KEY or ANTHROPIC_API_KEY must be set

# Start monitor + dashboard + claude agent
pnpm dev:claude
```

This starts three concurrent processes:
- **Monitor** on `ws://localhost:3001` — connects to tastytrade, streams 40 symbols
- **Dashboard** on `http://localhost:5173` — Vite dev server with HMR
- **Claude Agent** — WebSocket client connecting to the monitor

### Alternative: Pi-agent

```bash
# Start with the pi-agent instead
pnpm dev:full
```

### Individual Services

```bash
pnpm monitor          # Monitor only (dashboard mode, WS on :3001)
pnpm dashboard        # Dashboard only (Vite on :5173)
pnpm agent:claude     # Claude agent only (connects to monitor WS)
pnpm agent:start      # Pi-agent only
```

### Multi-Tenant Mode (optional)

```bash
# Generate an encryption key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Add to .env
ENCRYPTION_KEY=<your-64-char-hex-key>
JWT_SECRET=<your-secret>

# Start normally — the dashboard will now require login
pnpm dev:claude
```

---

## 10. How to Test the Claude SDK Agent

### Using the Dashboard

1. Open `http://localhost:5173`
2. Go to the **Agent Export** tab
3. Click one of the **Fire Test Alert** buttons (e.g., "NVDA IV_RANK_HIGH")
4. Watch the header — the agent status indicator should show "Analyzing NVDA..." (amber pulse)
5. Switch to the **AI Analysis** tab to see the structured trade recommendation

### Using the CLI

```bash
# Send a test alert via WebSocket (Node 22+ has built-in WebSocket)
node -e "
const ws = new WebSocket('ws://localhost:3001');
ws.addEventListener('open', () => {
  ws.send(JSON.stringify({
    type: 'alert',
    data: {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      version: '1.0',
      trigger: { type: 'IV_SPIKE', ticker: 'NVDA', description: 'Test', threshold: 10, observed: 15 },
      severity: 'high',
      strategies: ['supply_chain'],
      supplyChainLayer: 'Layer 1',
      skillHint: null,
      marketSnapshot: [],
      optionChain: [],
      account: { netLiq: 100000, buyingPower: 50000, openPositions: [] },
      agentContext: 'Test alert for NVDA IV spike.',
    }
  }));
  ws.addEventListener('message', e => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'agent_analysis') {
      console.log(msg.data.analysis);
      process.exit(0);
    }
  });
});
"
```

### Expected Response Format

The Claude SDK agent returns analysis in this structure:

```
**Signal**: NVDA IV spiked 12% with IV rank at 72 — premium selling opportunity in Layer 1 GPU leader
**Trade**: Sell Call NVDA 125 30DTE @ market premium
**Size**: 3% of buying power
**Thesis**: IV rank 72 signals overpriced options for premium collection
**Stop**: Close at 50% profit or 21 DTE, whichever first
**Invalidation**: IV rank drops below 30 or NVDA breaks above 125 with volume
```

### Verifying Agent Status

The agent sends periodic heartbeats. Check the dashboard header for the status indicator:
- **Green dot** + "Agent idle" — connected and waiting
- **Amber pulse** + "Analyzing {TICKER}..." — processing an alert
- **Red dot** + "Agent error" — last invocation failed
- **Gray dot** + "Agent offline" — not connected

---

## 11. How to Deploy

### Docker Compose

```bash
# Build and run with Claude SDK agent
AGENT_PROVIDER=claude-sdk docker compose up --build

# Or with pi-agent (default)
docker compose up --build
```

The compose file defines two services:
- `monitor` — serves dashboard + WS on port 3001 with health check
- `agent` — connects to monitor via internal DNS (`ws://monitor:3001`)

### Render

The `render.yaml` Blueprint defines:
- **Web service** (`tastytrade-monitor`) — Docker, serves dashboard
- **Worker service** (`tastytrade-agent`) — Docker, runs agent

Set the following in your Render environment variable groups:
- `tastytrade-secrets`: `TASTYTRADE_CLIENT_ID`, `TASTYTRADE_CLIENT_SECRET`, `TASTYTRADE_REFRESH_TOKEN`, `TASTYTRADE_ENV`
- `llm-provider`: `ANTHROPIC_API_KEY` or `CLAUDE_API_KEY`, `CLAUDE_MODEL`, `PI_PROVIDER`, `PI_MODEL`

To use the Claude SDK agent on Render, set `AGENT_PROVIDER=claude-sdk` on the worker service.

---

## 12. Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    tastytrade API                        │
│         (sandbox: api.cert.tastyworks.com)               │
│         (production: api.tastyworks.com)                 │
└─────────────┬───────────────────┬───────────────────────┘
              │ REST (accounts,   │ DXLink WebSocket
              │ chains, metrics)  │ (quotes, trades,
              │                   │  greeks, summaries)
              ▼                   ▼
┌─────────────────────────────────────────────────────────┐
│                  Monitor (port 3001)                     │
│                                                          │
│  ┌──────────┐ ┌──────────┐ ┌────────────┐ ┌──────────┐ │
│  │ Account  │ │ Streamer │ │Chain Fetcher│ │  Market  │ │
│  │ Poller   │ │ (DXLink) │ │ (REST+DXL) │ │ Metrics  │ │
│  └────┬─────┘ └────┬─────┘ └──────┬─────┘ └────┬─────┘ │
│       │            │               │             │       │
│       ▼            ▼               │             │       │
│  ┌──────────────────────────┐      │             │       │
│  │    State Store (in-mem)  │◄─────┘─────────────┘       │
│  └────────────┬─────────────┘                            │
│               │                                          │
│               ▼                                          │
│  ┌──────────────────────────┐   ┌──────────────────────┐ │
│  │     Alert Bus            │──▶│   Broadcaster (WS)   │ │
│  │  (triggers → alerts)     │   │  ┌─────────────────┐ │ │
│  └──────────────────────────┘   │  │ Alert Dispatch  │ │ │
│                                 │  └────────┬────────┘ │ │
│                                 └───────────┼──────────┘ │
│                                             │            │
│  ┌─ Multi-tenant (ENCRYPTION_KEY) ──────────┤            │
│  │  ┌──────┐ ┌──────┐ ┌─────────────────┐  │            │
│  │  │SQLite│ │Crypto│ │  Orchestrator   │◄─┘            │
│  │  │  DB  │ │(AES) │ │ (per-user agent │               │
│  │  └──────┘ └──────┘ │  dispatch)      │               │
│  │                     └─────────────────┘               │
│  └───────────────────────────────────────────────────────┘
└────────────────────────┬────────────────────────────────┘
                         │ WebSocket (port 3001)
            ┌────────────┼─────────────┐
            │            │             │
            ▼            ▼             ▼
    ┌──────────┐  ┌────────────┐  ┌──────────────────┐
    │Dashboard │  │Claude Agent│  │  External Agent   │
    │ (Vite)   │  │  (SDK)     │  │(webhook / WS)    │
    │ :5173    │  │            │  │                   │
    └──────────┘  └────────────┘  └──────────────────┘
                         │
                         ▼
                  ┌──────────────┐
                  │  Anthropic   │
                  │  API         │
                  │  (Claude)    │
                  └──────────────┘
```

---

## 13. Known Limitations

| Issue | Details | Workaround |
|-------|---------|------------|
| **Sandbox option chains** | The tastytrade sandbox (`api.cert.tastyworks.com`) returns 502 for `/option-chains/{symbol}/nested`. This is a documented limitation. | Switch to `TASTYTRADE_ENV=production` with real credentials. The dashboard shows an explanatory message. |
| **Market data on weekends** | DXLink streamer returns no Quote events when markets are closed. Option chain enrichment will return zeros. | Test during market hours, or use the test alert buttons which include synthetic chain data. |
| **Sandbox market metrics** | The `/market-metrics` endpoint is not available in sandbox. IV rank and IV percentile will be null. | Use production, or test with synthetic alerts. |
| **Multi-tenant not in single-tenant runner** | The standalone claude-agent runner (`pnpm agent:claude`) doesn't use the multi-tenant orchestrator — it's a direct WS client. Multi-tenant dispatch only happens via the orchestrator in the monitor process. | For multi-user scenarios, set `ENCRYPTION_KEY` and configure agents via the dashboard Settings tab instead of using the standalone runner. |

---

## 14. File-by-File Changelog

### New Files

| File | Lines | Description |
|------|-------|-------------|
| `packages/claude-agent/package.json` | 31 | Package manifest with `@anthropic-ai/claude-agent-sdk`, zod, ws, dotenv |
| `packages/claude-agent/tsconfig.json` | 8 | TypeScript config extending base |
| `packages/claude-agent/src/invoke.ts` | 105 | Core SDK invocation: `query()` with structured output, message extraction |
| `packages/claude-agent/src/runner.ts` | 199 | WS client: connect, handle alerts, queue, cooldowns, heartbeat, status reporting |
| `packages/claude-agent/src/schema.ts` | 28 | `TradeRecommendation` Zod schema + JSON Schema conversion + formatter |
| `packages/claude-agent/src/config.ts` | 25 | Env config: API key, model, budget, WS URL, cooldown/queue settings |
| `packages/claude-agent/.claude/CLAUDE.md` | 37 | System prompt: options desk trader persona, response format, rules |
| `packages/claude-agent/.claude/skills/options-trader/SKILL.md` | 37 | Options analytical framework skill |
| `packages/claude-agent/.claude/skills/ai-supply-chain/SKILL.md` | 72 | 7-layer AI supply chain thesis with 22 tickers |
| `packages/claude-agent/.claude/skills/midterm-macro/SKILL.md` | 53 | Midterm macro playbook across 5 sectors |
| `packages/monitor/src/tastytrade-auth.ts` | 50 | OAuth2 client init extracted from old auth.ts |
| `packages/monitor/src/crypto.ts` | 49 | AES-256-GCM encrypt/decrypt for API key storage |
| `packages/monitor/src/db.ts` | 112 | SQLite schema (users + agent_configs), CRUD operations |
| `packages/monitor/src/agent-orchestrator.ts` | 245 | Multi-tenant alert dispatch (Claude SDK / webhook / WebSocket) |
| `packages/dashboard/src/components/AuthGate.tsx` | 126 | Login/register form for multi-tenant mode |
| `packages/dashboard/src/components/AgentSettings.tsx` | 167 | Per-user agent config UI (provider, key, model, budget) |
| `docker/entrypoint-agent.sh` | 17 | Agent provider router (claude-sdk vs pi) |

### Modified Files

| File | Change Summary |
|------|---------------|
| `.env.example` | Added AGENT_PROVIDER, CLAUDE_API_KEY, CLAUDE_MODEL, CLAUDE_MAX_BUDGET_USD, ENCRYPTION_KEY, JWT_SECRET sections |
| `.gitignore` | Added `data/` for SQLite DB directory |
| `package.json` | Added `agent:claude`, `dev:claude` scripts; added claude-agent to build chain |
| `docker-compose.yml` | Agent service reads `AGENT_PROVIDER` from host env |
| `docker/Dockerfile` | Build + runtime stages include claude-agent package and .claude/ skills |
| `render.yaml` | Added CLAUDE_API_KEY, CLAUDE_MODEL, CLAUDE_MAX_BUDGET_USD to env var groups |
| `packages/shared/src/alert.schema.ts` | Added AgentProvider, AgentConfig, AgentConfigResponse, WsServerAuthResult, WsServerAgentConfig schemas; extended WsMessage and WsClientMessage unions |
| `packages/shared/src/index.ts` | Exports all new schemas and types |
| `packages/monitor/package.json` | Added claude-agent, bcryptjs, better-sqlite3, jsonwebtoken deps |
| `packages/monitor/src/main.ts` | Added initEncryption, getDb, initOrchestrator calls |
| `packages/monitor/src/broadcaster.ts` | Added `onAlertForOrchestrator()` and `broadcastToAll()` exports; orchestrator callback in alert handler |
| `packages/monitor/src/auth.ts` | Repurposed from tastytrade auth to user auth (bcrypt + JWT) |
| `packages/monitor/src/chainFetcher.ts` | Full rewrite: sandbox guard, correct nested response parsing, DXLink enrichment |
| `packages/monitor/src/account.ts` | Import changed from `./auth.js` to `./tastytrade-auth.js` |
| `packages/monitor/src/accountStreamer.ts` | Import changed from `./auth.js` to `./tastytrade-auth.js` |
| `packages/monitor/src/marketMetrics.ts` | Import changed from `./auth.js` to `./tastytrade-auth.js` |
| `packages/dashboard/src/App.tsx` | AgentStatusIndicator, AuthGate, AgentSettings, env prop pass-through |
| `packages/dashboard/src/components/AgentExportPanel.tsx` | Updated `sendRaw` import |
| `packages/dashboard/src/components/OptionChainPanel.tsx` | Added env prop, sandbox warning panel |
| `packages/dashboard/src/hooks/useMonitorSocket.ts` | Auth flow, agent config CRUD, new WS message handlers |
| `packages/dashboard/vite.config.ts` | strictPort + auto-open |
| `pnpm-lock.yaml` | +531 lines for new dependencies |
