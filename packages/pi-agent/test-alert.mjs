#!/usr/bin/env node
import WebSocket from 'ws'
import { randomUUID } from 'node:crypto'

const WS_URL = process.argv[2] || 'ws://localhost:3001'

const alert = {
  id: randomUUID(),
  timestamp: new Date().toISOString(),
  version: '1.0',
  trigger: {
    type: 'IV_SPIKE',
    ticker: 'AMKR',
    description: 'AMKR implied volatility spiked 22% in 5 minutes (threshold: 15%)',
    threshold: 15,
    observed: 22,
  },
  severity: 'high',
  strategies: ['supply_chain'],
  supplyChainLayer: 'Layer 1 — Chip Packaging',
  skillHint: 'ai-hidden-supply-chain-options',
  marketSnapshot: [
    {
      ticker: 'AMKR', price: 28.45, bid: 28.40, ask: 28.50,
      priceChange1D: 1.23, priceChangePct1D: 4.52,
      iv: 0.68, ivRank: 72, ivPercentile: 80, ivPctChange5Min: 22.0,
      volume: 3240000, layer: 'Layer 1 — Chip Packaging',
      strategies: ['supply_chain'], isDelayed: true,
      lastUpdated: new Date().toISOString(),
    },
    {
      ticker: 'NVDA', price: 142.30, bid: 142.25, ask: 142.35,
      priceChange1D: -0.85, priceChangePct1D: -0.59,
      iv: 0.45, ivRank: 35, ivPercentile: 42, ivPctChange5Min: -1.2,
      volume: 48200000, layer: 'Macro — AI Semis',
      strategies: ['midterm_macro', 'supply_chain'], isDelayed: true,
      lastUpdated: new Date().toISOString(),
    },
  ],
  optionChain: [
    {
      expiration: '2026-04-17',
      daysToExpiry: 34,
      strikes: [
        {
          strike: 27, callBid: 2.10, callAsk: 2.25, callVolume: 450, callOI: 1200,
          callDelta: 0.65, callIV: 0.62,
          putBid: 0.55, putAsk: 0.70, putVolume: 320, putOI: 890,
          putDelta: -0.35, putIV: 0.68,
        },
        {
          strike: 28, callBid: 1.45, callAsk: 1.60, callVolume: 680, callOI: 1800,
          callDelta: 0.52, callIV: 0.65,
          putBid: 0.90, putAsk: 1.05, putVolume: 510, putOI: 1400,
          putDelta: -0.48, putIV: 0.70,
        },
        {
          strike: 30, callBid: 0.65, callAsk: 0.80, callVolume: 920, callOI: 2400,
          callDelta: 0.32, callIV: 0.72,
          putBid: 2.05, putAsk: 2.20, putVolume: 180, putOI: 600,
          putDelta: -0.68, putIV: 0.75,
        },
      ],
    },
  ],
  account: {
    netLiq: 25000,
    buyingPower: 18500,
    openPositions: [],
  },
  agentContext: `## OPTIONS ALERT — IV_SPIKE on AMKR
**Time:** ${new Date().toISOString()} Chicago
**Data:** 15-min delayed (sandbox)
**Trigger:** AMKR implied volatility spiked 22% in 5 minutes (threshold: 15%)
**Severity:** HIGH

### Supply Chain Layer
Layer 1 — Chip Packaging | Strategy: AI Hidden Supply Chain

### Watchlist Snapshot
| Ticker | Layer | Price | Chg% | IV% | IV Rank | 5m IV Δ |
|--------|-------|-------|------|-----|---------|---------|
| AMKR | L1 Packaging | $28.45 | +4.52% | 68% | 72 | +22.0% |
| NVDA | AI Semis | $142.30 | -0.59% | 45% | 35 | -1.2% |

### Option Chain — AMKR (nearest 1 expiration)

**Expiry: 2026-04-17 (34 DTE)**
| Strike | C Bid | C Ask | C Vol | C OI | C Δ | C IV | P Bid | P Ask | P Vol | P OI | P Δ | P IV |
|--------|-------|-------|-------|------|-----|------|-------|-------|-------|------|-----|------|
| 27 | 2.10 | 2.25 | 450 | 1200 | .65 | 62% | 0.55 | 0.70 | 320 | 890 | -.35 | 68% |
| 28 | 1.45 | 1.60 | 680 | 1800 | .52 | 65% | 0.90 | 1.05 | 510 | 1400 | -.48 | 70% |
| 30 | 0.65 | 0.80 | 920 | 2400 | .32 | 72% | 2.05 | 2.20 | 180 | 600 | -.68 | 75% |

### Account
- Net Liq: $25,000
- Buying Power: $18,500
- Open Positions: None`,
}

console.log('Connecting to', WS_URL)
const ws = new WebSocket(WS_URL)

ws.on('open', () => {
  console.log('Connected. Injecting test alert for AMKR IV_SPIKE...')
  ws.send(JSON.stringify({ type: 'alert', data: alert }))
  console.log('Alert sent. Alert ID:', alert.id)
  console.log('Listening for agent_analysis response...\n')
})

ws.on('message', (raw) => {
  try {
    const msg = JSON.parse(String(raw))
    if (msg.type === 'agent_analysis') {
      console.log('=== AGENT ANALYSIS RECEIVED ===')
      console.log('Ticker:', msg.data.ticker)
      console.log('Model:', msg.data.model)
      console.log('Timestamp:', msg.data.timestamp)
      console.log('---')
      console.log(msg.data.analysis)
      console.log('===')
      process.exit(0)
    }
  } catch { /* ignore */ }
})

ws.on('error', (err) => {
  console.error('WS Error:', err.message)
  process.exit(1)
})

setTimeout(() => {
  console.log('\nTimeout after 120s — no agent_analysis received.')
  console.log('(This is expected if pi agent is not running or still processing)')
  process.exit(0)
}, 120_000)
