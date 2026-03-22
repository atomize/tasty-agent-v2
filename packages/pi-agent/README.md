# tastytrade Pi Agent

Pi extension that connects to the tastytrade options monitor, receives market alerts in real time, and produces AI-powered trade analyses. Analyses are posted back to the dashboard via WebSocket.

This package plugs into any existing [pi](https://github.com/badlogic/pi-mono) installation. It does not bundle or install pi — it expects pi to already be configured with a provider and API key on the host system.

## Prerequisites

- **pi** installed globally: `npm install -g @mariozechner/pi-coding-agent`
- **At least one LLM provider** configured in pi (Anthropic, OpenAI, Google, Cursor, etc.)
- **The tastytrade monitor** running with WebSocket on ws://localhost:3001

## Setup

Install this package into your pi configuration:

```bash
# From the monorepo root
pi install ./packages/pi-agent

# Verify it's registered
pi list
```

This registers the extension, skills, and prompts with pi. Your existing provider, model, and API key settings are untouched.

## Running

```bash
# Terminal 1: Start the monitor + dashboard
pnpm dev

# Terminal 2: Run pi from the package directory (picks up AGENTS.md + SYSTEM.md)
cd packages/pi-agent
pi
```

The extension auto-connects to ws://localhost:3001 on session start. When an alert fires, the extension validates it, selects the right skills, and injects it into the pi session for analysis. The LLM response is captured and posted back to the dashboard's AI Analysis tab.

You can also run pi from any directory — the extension and skills are loaded from the installed package. Only AGENTS.md and SYSTEM.md require running from this directory (pi loads them from CWD).

## Container / CI Setup

```bash
# 1. Install pi
npm install -g @mariozechner/pi-coding-agent

# 2. Configure provider + API key
export ANTHROPIC_API_KEY="sk-..."
# or export OPENAI_API_KEY, GEMINI_API_KEY, etc.

# 3. Install this package
pi install /path/to/packages/pi-agent

# 4. Run pi (from the package dir for full context)
cd /path/to/packages/pi-agent
pi --print --no-session
```

Pi reads provider config from `~/.pi/agent/settings.json` and API keys from environment variables. No code changes are needed to switch providers or models.

## Skills

Three domain skills are loaded on demand based on the alert's strategy:

| Skill | Loaded For | Content |
|-------|-----------|---------|
| `/skill:options-trader` | All alerts | Analytical framework, recommendation format, risk sizing |
| `/skill:ai-supply-chain` | Supply chain symbols (Layer 1-7) | 7-layer thesis, per-company moats and catalysts |
| `/skill:midterm-macro` | Macro symbols (energy, defense, semis, biotech, hedges) | Sector playbooks, cross-sector hedging logic |

Crypto alerts only load `options-trader` since there are no options to analyze.

## Tools

The extension registers two tools the model can call:

- **`alerts_history`** — Show the last 10 alerts received (ticker, trigger type, time, processed Y/N)
- **`latest_alert`** — Re-inject the most recent alert for analysis

## Model Switching

Pi supports 15+ LLM providers. Switch models without code changes:

```bash
# Interactive model picker in TUI
/model

# Cycle through models
Ctrl+L

# Launch with a specific model
pi --model claude-sonnet-4-20250514
pi --model openai/gpt-4o
pi --model google/gemini-2.0-flash

# Configure favorites in ~/.pi/agent/settings.json
{ "favoriteModels": ["claude-sonnet-4-20250514", "openai/gpt-4o"] }
```

The active model name is included in every `agent_analysis` message posted to the dashboard.

## Architecture

```
Monitor (ws://localhost:3001)
    |
    | OptionsAlert JSON
    v
Pi Extension (alert-receiver.ts)       <-- installed via `pi install`
    |
    |-- Zod validation (inline schema)
    |-- Skill selection (supply chain / macro / crypto)
    |-- 5-min per-ticker cooldown
    |-- Queue (max 5, sequential)
    |
    v
Pi Agent Session                        <-- user's existing pi config
    |
    |-- AGENTS.md (loaded from CWD)
    |-- SYSTEM.md (loaded from CWD)
    |-- Skills (loaded from installed package)
    |
    v
User's LLM Provider (Claude, GPT, Gemini, ...)
    |
    | Analysis text
    v
Extension captures agent_end
    |
    | agent_analysis message
    v
Monitor WebSocket --> Dashboard AI Analysis tab
```

## Separation of Concerns

- **packages/monitor** — Zero AI dependencies. Emits structured data only.
- **packages/pi-agent** — Self-contained pi package. No monorepo build step needed.
- **packages/dashboard** — Displays data. Reads `agent_analysis` from the WS stream.
- **WebSocket :3001** — The sole coupling point between all three processes.
- **Pi** — The user's existing installation. This package does not bundle or configure it.
