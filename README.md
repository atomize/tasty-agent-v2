# tastytrade Options Monitor

Real-time options market monitoring engine with a React dashboard, built on the official tastytrade JS SDK.

Tracks 40 symbols across three strategies:
- **AI Hidden Supply Chain** — 7 layers, 22 symbols covering chip packaging, optical interconnects, signal integrity, rack deployment, thermal/power, copper/rare earth, and nuclear/uranium
- **Midterm Macro Options** — 5 sectors: energy, defense, AI/semis, biotech, and macro hedges
- **Crypto** — BTC/USD and ETH/USD for 24/7 alert pipeline testing (spot only, no options)

When trigger conditions fire (IV spikes, price moves, crypto price moves, IV rank thresholds, or scheduled times), the engine emits structured `OptionsAlert` JSON payloads through an event bus. Consumers include the web dashboard, JSONL log files, and any CLI AI agent you pipe output to.

## Prerequisites

- Node.js 20+
- pnpm (`npm install -g pnpm`)
- A tastytrade account (sandbox works for development)

## Quick Start

```bash
cp .env.example .env
# Fill in TASTYTRADE_REFRESH_TOKEN (see below)

pnpm install
pnpm dev          # Starts monitor + React dashboard
```

Dashboard opens at http://localhost:3000. WebSocket data stream on ws://localhost:3001.

## Getting a Refresh Token

Session-token authentication (username/password login) was permanently discontinued on December 1st, 2025. OAuth2 refresh token is the only valid auth method.

### For Sandbox

1. Register at https://developer.tastytrade.com/sandbox/ if you haven't already
2. Go to https://developer.tastytrade.com → your OAuth application
3. Navigate to Manage → **Create Grant**
4. Copy the refresh token JWT (starts with `eyJ...`)
5. Paste it into `.env` as `TASTYTRADE_REFRESH_TOKEN`

### For Production

1. Go to https://my.tastytrade.com/app.html#/manage/api-access/oauth-applications
2. Create an OAuth application with scopes: `read`, `trade`, `openid`
3. Set callback URL to `http://localhost:8080/callback`
4. Navigate to your app → Manage → **Create Grant**
5. Copy the refresh token JWT
6. Paste into `.env` as `TASTYTRADE_REFRESH_TOKEN`

The refresh token is permanent — it never expires. The SDK uses it silently to generate fresh 15-minute access tokens. No browser flow, no redirect, no localhost server.

## Sandbox Limitations

**15-minute delayed quotes**: All market data in sandbox is 15 minutes behind live. The dashboard labels all data as delayed, and the `agentContext` in each alert specifies whether data is delayed or real-time. Your trigger thresholds will fire on delayed data — this is expected and acceptable for testing logic.

**Daily reset at midnight**: The sandbox environment resets every 24 hours. All trades, positions, and balances are wiped. OAuth credentials and the refresh token survive the reset. The positions panel will show empty each morning unless test orders are re-placed.

**Completely isolated from production**: Sandbox credentials cannot touch production, and vice versa. They are entirely separate environments.

## Output Modes

```bash
# Default — terminal logs + WebSocket broadcaster + React dashboard
pnpm monitor

# Pipe mode — structured output on stdout for piping to any AI agent
pnpm monitor:pipe

# File mode — writes each alert as JSON to packages/monitor/alerts/ + WebSocket broadcast
pnpm monitor:file
```

## Piping to an AI Agent

The monitor in pipe mode emits `ALERT:{base64-json}` lines on stdout and logs to stderr:

```bash
# Pipe to Claude CLI
pnpm monitor:pipe | claude -p "You are an expert options trader at a Chicago clearinghouse. Analyze this alert and recommend a specific trade with ticker, strike, expiry, and allocation."

# Pipe to Claude with a system prompt
pnpm monitor:pipe | claude --system "You are an options desk trader specializing in AI supply chain picks-and-shovels plays."

# Pass a saved alert file to any agent
cat packages/monitor/alerts/alert_latest.json | claude -p "Analyze this options alert"

# Pipe to Cursor agent or any MCP-compatible CLI
pnpm monitor:pipe | cursor-agent
pnpm monitor:pipe | your-agent-cli
```

The monitor has **zero dependency on any AI SDK**. The separation is absolute — the monitor emits structured data, agents consume it externally. This means you can use it with Claude, GPT, Gemini, Cursor, or any agent that reads stdin, now or in the future.

## Production Safety (Read-Only)

The monitor is **completely read-only**. It never imports or calls `ordersService.createOrder()` or any write endpoint. The entire codebase only uses:

- `accountsAndCustomersService.getCustomerAccounts()` — list accounts
- `balancesAndPositionsService.getAccountBalanceValues()` — read balances
- `balancesAndPositionsService.getPositionsList()` — read positions
- `instrumentsService.getNestedOptionChain()` — read option chains
- `marketMetricsService.getMarketMetrics()` — read IV rank/percentile
- `quoteStreamer` — subscribe to market data (read-only WebSocket)

By default, OAuth scopes are set to `read` and `openid` only — the access token **cannot** place orders even if a code bug were introduced. The `trade` scope is opt-in via `TASTYTRADE_ENABLE_TRADE_SCOPE=true` in `.env`, and is only used so the account streamer can observe order fill events (never submit them).

You can safely connect this to your production account without risk of unintended trades.

## Switching to Production

1. Register a new OAuth app at https://developer.tastytrade.com for production
2. Generate a new refresh token via **Create Grant** for the production app
3. Update `.env`:

```
TASTYTRADE_CLIENT_ID=<your-production-client-id>
TASTYTRADE_CLIENT_SECRET=<your-production-secret>
TASTYTRADE_REFRESH_TOKEN=<your-production-refresh-token>
TASTYTRADE_ENV=production
```

That's it — the SDK reads `ProdConfig` vs `SandboxConfig` from the env variable. Never hardcode base URLs.

## Adding Tickers

Edit `packages/monitor/src/watchlist.config.ts`:

```typescript
// Equity
{ ticker: 'TSLA', layer: 'Macro — EV', strategies: ['midterm_macro'], thesis: 'EV demand cycle', instrumentType: 'equity' },

// Crypto (spot only — no options chain, 24/7 trading)
{ ticker: 'SOL/USD', layer: 'Crypto', strategies: ['crypto'], thesis: 'Solana ecosystem activity', instrumentType: 'crypto' },
```

Each entry needs:
- `ticker` — the symbol (e.g., `TSLA` for equities, `BTC/USD` for crypto)
- `layer` — classification label (shown in dashboard and agentContext)
- `strategies` — array of `'supply_chain'`, `'midterm_macro'`, and/or `'crypto'`
- `thesis` — one-line investment thesis for context
- `instrumentType` — `'equity'` or `'crypto'` (controls trigger behavior, option chain fetching, and streamer symbol resolution)

Crypto instruments trade 24/7 (including weekends), use higher price-move thresholds, and skip IV-based triggers and option chain fetching.

## Project Structure

```
packages/
  shared/       — Zod schemas and TypeScript types (single source of truth)
  monitor/      — Engine: auth, streamer, triggers, alert bus, output modes
  dashboard/    — React SPA: watchlist, alerts, positions, agent export
```

## Architecture

```
tastytrade REST + DXLink WS     SDK Account Streamer
        │                               │
        ▼                               ▼
   Market State ◄──── real-time position/fill updates
   (equities + crypto)
        │
   Trigger Engine
   • IV spike detection (equities)
   • Price move detection (equities)
   • Crypto price move (24/7)
   • IV rank thresholds (equities)
   • Scheduled (9:45am + 3pm CT)
        │
   OptionsAlert (JSON)
   + option chain from REST (equities only)
   + agentContext (self-contained markdown)
        │
     AlertBus
   ┌────┼────────┐
   │    │        │
 Web  JSONL   CLI Pipe
 UI   Logger  (→ Agent)
```

## Key Constraints

- **Never auto-submits orders** — the system is read-only. OAuth scopes default to `read openid` only; the `trade` scope is opt-in and only used for observing account events, never for order submission.
- **Rate limited** — 150ms minimum between REST calls, 5-minute cooldown per ticker per trigger type.
- **Agent-agnostic** — zero dependency on Anthropic, OpenAI, or any AI SDK in the monitor package.
- **Crypto is spot-only** — tastytrade does not offer crypto options. BTC/USD and ETH/USD are included for 24/7 alert testing; no option chains, IV rank, or Greeks are available for crypto instruments.
