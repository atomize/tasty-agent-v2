import { useState } from 'react'
import type { OptionsAlert } from '@tastytrade-monitor/shared'

interface Props {
  alerts: OptionsAlert[]
  env: 'sandbox' | 'production'
  sendRaw: (msg: unknown) => void
}

const TEST_TICKERS = [
  { ticker: 'AMKR', layer: 'Layer 1 — Chip Packaging', strategy: 'supply_chain', trigger: 'IV_SPIKE' },
  { ticker: 'VRT',  layer: 'Layer 5 — Thermal & Power', strategy: 'supply_chain', trigger: 'PRICE_MOVE' },
  { ticker: 'NVDA', layer: 'Macro — AI Semis', strategy: 'midterm_macro', trigger: 'IV_RANK_HIGH' },
  { ticker: 'BTC/USD', layer: null, strategy: 'crypto', trigger: 'CRYPTO_PRICE_MOVE' },
] as const

function buildTestAlert(opt: typeof TEST_TICKERS[number]) {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const isCrypto = opt.strategy === 'crypto'

  return {
    id,
    timestamp: now,
    version: '1.0' as const,
    trigger: {
      type: opt.trigger,
      ticker: opt.ticker,
      description: isCrypto
        ? `${opt.ticker} price moved 6.2% in 10 minutes (threshold: 5%)`
        : `${opt.ticker} implied volatility spiked 22% in 5 minutes (threshold: 15%)`,
      threshold: isCrypto ? 5 : 15,
      observed: isCrypto ? 6.2 : 22,
    },
    severity: 'high',
    strategies: [opt.strategy],
    supplyChainLayer: opt.layer,
    skillHint: opt.strategy === 'supply_chain' ? 'ai-hidden-supply-chain-options' : undefined,
    marketSnapshot: [{
      ticker: opt.ticker,
      price: isCrypto ? 67420.50 : 28.45,
      bid: isCrypto ? 67415.00 : 28.40,
      ask: isCrypto ? 67426.00 : 28.50,
      priceChange1D: isCrypto ? 3850.20 : 1.23,
      priceChangePct1D: isCrypto ? 6.05 : 4.52,
      iv: isCrypto ? undefined : 0.68,
      ivRank: isCrypto ? undefined : 72,
      ivPercentile: isCrypto ? undefined : 80,
      ivPctChange5Min: isCrypto ? undefined : 22.0,
      volume: isCrypto ? 12500000000 : 3240000,
      layer: opt.layer,
      strategies: [opt.strategy],
      isDelayed: true,
      lastUpdated: now,
    }],
    optionChain: isCrypto ? [] : [{
      expiration: '2026-04-17',
      daysToExpiry: 34,
      strikes: [
        { strike: 27, callBid: 2.10, callAsk: 2.25, callVolume: 450, callOI: 1200, callDelta: 0.65, callIV: 0.62, putBid: 0.55, putAsk: 0.70, putVolume: 320, putOI: 890, putDelta: -0.35, putIV: 0.68 },
        { strike: 28, callBid: 1.45, callAsk: 1.60, callVolume: 680, callOI: 1800, callDelta: 0.52, callIV: 0.65, putBid: 0.90, putAsk: 1.05, putVolume: 510, putOI: 1400, putDelta: -0.48, putIV: 0.70 },
        { strike: 30, callBid: 0.65, callAsk: 0.80, callVolume: 920, callOI: 2400, callDelta: 0.32, callIV: 0.72, putBid: 2.05, putAsk: 2.20, putVolume: 180, putOI: 600, putDelta: -0.68, putIV: 0.75 },
      ],
    }],
    account: { netLiq: 25000, buyingPower: 18500, openPositions: [] },
    agentContext: isCrypto
      ? `## OPTIONS ALERT — ${opt.trigger} on ${opt.ticker}
**Time:** ${now} Chicago
**Data:** 15-min delayed (sandbox)
**Trigger:** ${opt.ticker} price moved 6.2% in 10 minutes (threshold: 5%)
**Severity:** HIGH

### Strategy
Crypto Spot | No options available on tastytrade for crypto

### Market Data
| Ticker | Price | Chg% | Volume |
|--------|-------|------|--------|
| ${opt.ticker} | $67,420.50 | +6.05% | $12.5B |

### Account
- Net Liq: $25,000
- Buying Power: $18,500
- Open Positions: None`
      : `## OPTIONS ALERT — ${opt.trigger} on ${opt.ticker}
**Time:** ${now} Chicago
**Data:** 15-min delayed (sandbox)
**Trigger:** ${opt.ticker} implied volatility spiked 22% in 5 minutes (threshold: 15%)
**Severity:** HIGH

### Supply Chain Layer
${opt.layer} | Strategy: AI Hidden Supply Chain

### Watchlist Snapshot
| Ticker | Layer | Price | Chg% | IV% | IV Rank | 5m IV Δ |
|--------|-------|-------|------|-----|---------|---------|
| ${opt.ticker} | ${opt.layer?.split(' — ')[1] ?? 'Macro'} | $28.45 | +4.52% | 68% | 72 | +22.0% |

### Option Chain — ${opt.ticker} (nearest 1 expiration)
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
}

export function AgentExportPanel({ alerts, env, sendRaw }: Props) {
  const [copied, setCopied] = useState<string | null>(null)
  const [fired, setFired] = useState<string | null>(null)

  const lastAlert = alerts[0]

  async function copyText(text: string, label: string) {
    await navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 2000)
  }

  function fireTestAlert(opt: typeof TEST_TICKERS[number]) {
    const alert = buildTestAlert(opt)
    sendRaw({ type: 'alert', data: alert })
    setFired(opt.ticker)
    setTimeout(() => setFired(null), 3000)
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* Test Alerts (sandbox only) */}
      {env === 'sandbox' && (
        <section>
          <h2 className="text-sm font-semibold text-gray-300 mb-3 uppercase tracking-wider">
            Fire Test Alert
          </h2>
          <div className="bg-[#111] border border-amber-800/40 rounded-lg p-4 space-y-3">
            <p className="text-xs text-amber-400/70">
              Sandbox only — injects a synthetic alert into the pipeline. If an agent is connected, it will analyze and respond.
            </p>
            <div className="flex flex-wrap gap-2">
              {TEST_TICKERS.map(opt => (
                <button
                  key={opt.ticker}
                  onClick={() => fireTestAlert(opt)}
                  className={`px-3 py-1.5 text-xs rounded font-medium transition-colors ${
                    fired === opt.ticker
                      ? 'bg-green-600 text-white'
                      : 'bg-amber-700/60 text-amber-200 hover:bg-amber-600/80'
                  }`}
                >
                  {fired === opt.ticker ? `Sent ${opt.ticker}!` : `${opt.ticker} ${opt.trigger}`}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-600">
              Alert appears on the Alerts tab. AI analysis appears on the AI Analysis tab when the agent responds.
            </p>
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold text-gray-300 mb-3 uppercase tracking-wider">
          Pipe to AI Agent
        </h2>
        <div className="bg-[#111] border border-gray-800 rounded-lg p-4 space-y-3">
          <p className="text-xs text-gray-500">
            Run the monitor in pipe mode and feed output to any CLI agent:
          </p>
          <CodeBlock>
            {`# Pipe to Claude CLI\nnpm run monitor:pipe | claude --system "You are an options desk trader..."\n\n# Pipe to any agent\nnpm run monitor:pipe | your-agent-cli`}
          </CodeBlock>
        </div>
      </section>

      {lastAlert && (
        <section>
          <h2 className="text-sm font-semibold text-gray-300 mb-3 uppercase tracking-wider">
            Last Alert — Agent Context
          </h2>
          <div className="bg-[#111] border border-gray-800 rounded-lg p-4">
            <div className="flex justify-between items-center mb-3">
              <span className="text-xs text-gray-500">
                {lastAlert.trigger.ticker} — {lastAlert.trigger.type} — {new Date(lastAlert.timestamp).toLocaleString()}
              </span>
              <button
                onClick={() => copyText(lastAlert.agentContext, 'context')}
                className="px-2 py-1 text-[10px] bg-amber-600 text-black rounded font-medium hover:bg-amber-500"
              >
                {copied === 'context' ? 'Copied!' : 'Copy Agent Context'}
              </button>
            </div>
            <pre className="text-[11px] text-gray-400 whitespace-pre-wrap font-mono leading-relaxed max-h-80 overflow-y-auto">
              {lastAlert.agentContext}
            </pre>
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold text-gray-300 mb-3 uppercase tracking-wider">
          Export All Alerts
        </h2>
        <div className="flex gap-2">
          <button
            onClick={() => {
              const jsonl = alerts.map(a => JSON.stringify(a)).join('\n')
              copyText(jsonl, 'jsonl')
            }}
            disabled={alerts.length === 0}
            className="px-3 py-1.5 text-xs bg-gray-800 text-gray-300 rounded hover:bg-gray-700 disabled:opacity-40"
          >
            {copied === 'jsonl' ? 'Copied!' : `Copy as JSONL (${alerts.length} alerts)`}
          </button>
          <button
            onClick={() => {
              const blob = new Blob(
                [alerts.map(a => JSON.stringify(a)).join('\n')],
                { type: 'application/jsonl' }
              )
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `alerts_${new Date().toISOString().split('T')[0]}.jsonl`
              a.click()
              URL.revokeObjectURL(url)
            }}
            disabled={alerts.length === 0}
            className="px-3 py-1.5 text-xs bg-gray-800 text-gray-300 rounded hover:bg-gray-700 disabled:opacity-40"
          >
            Download JSONL
          </button>
        </div>
      </section>
    </div>
  )
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-black/50 rounded p-3 text-[11px] text-green-400 font-mono overflow-x-auto">
      {children}
    </pre>
  )
}
