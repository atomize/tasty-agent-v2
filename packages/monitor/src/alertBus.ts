import { randomUUID } from 'node:crypto'
import type { OptionsAlert, Severity, TriggerType } from '@tastytrade-monitor/shared'
import { getAllSnapshots, getSnapshot } from './state.js'
import { getEntryByTicker } from './watchlist.config.js'
import { getAccountContext } from './account.js'
import { fetchOptionChain } from './chainFetcher.js'
import { config } from './config.js'
import { log } from './logger.js'

export type AlertHandler = (alert: OptionsAlert) => Promise<void> | void

const handlers: AlertHandler[] = []

export function onAlert(handler: AlertHandler): void {
  handlers.push(handler)
}

export interface TriggerInput {
  type: TriggerType
  ticker: string
  description: string
  threshold: number
  observed: number
  severity: Severity
}

export async function emitAlert(input: TriggerInput): Promise<void> {
  const entry = getEntryByTicker(input.ticker)
  const snap = getSnapshot(input.ticker)
  const allSnaps = getAllSnapshots()
  const account = getAccountContext()

  const strategies = entry?.strategies ?? []
  const supplyChainLayer = entry?.layer ?? null

  let skillHint: OptionsAlert['skillHint'] = null
  if (strategies.includes('supply_chain')) {
    skillHint = 'ai-hidden-supply-chain-options'
  } else if (strategies.includes('midterm_macro')) {
    skillHint = 'midterm-options-analysis'
  }

  const isCrypto = entry?.instrumentType === 'crypto'

  let optionChain: OptionsAlert['optionChain'] = []
  if (input.ticker !== '*' && !isCrypto) {
    try {
      optionChain = await fetchOptionChain(input.ticker, 3)
    } catch (err) {
      log.warn(`Could not fetch option chain for ${input.ticker}:`, err)
    }
  }

  const isSandbox = config.tastytrade.env === 'sandbox'

  const alert: OptionsAlert = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    version: '1.0',
    trigger: {
      type: input.type,
      ticker: input.ticker,
      description: input.description,
      threshold: input.threshold,
      observed: input.observed,
    },
    severity: input.severity,
    strategies,
    supplyChainLayer,
    skillHint,
    marketSnapshot: allSnaps,
    optionChain,
    account,
    agentContext: buildAgentContext(input, snap, allSnaps, account, optionChain, isSandbox),
  }

  for (const handler of handlers) {
    try {
      await handler(alert)
    } catch (err) {
      log.error('Alert handler error:', err)
    }
  }
}

function buildAgentContext(
  input: TriggerInput,
  snap: ReturnType<typeof getSnapshot>,
  allSnaps: ReturnType<typeof getAllSnapshots>,
  account: ReturnType<typeof getAccountContext>,
  optionChain: OptionsAlert['optionChain'],
  isSandbox: boolean,
): string {
  const lines: string[] = [
    `## OPTIONS ALERT — ${input.type} on ${input.ticker}`,
    `**Time:** ${new Date().toISOString()} Chicago`,
    `**Data:** ${isSandbox ? '15-min delayed (sandbox)' : 'Real-time (production)'}`,
    `**Trigger:** ${input.description}`,
    `**Severity:** ${input.severity}`,
    '',
    '### Watchlist Snapshot',
    '| Ticker | Layer | Price | Chg% | IV% | IV Rank | 5m IV Δ |',
    '|--------|-------|-------|------|-----|---------|---------|',
  ]

  for (const s of allSnaps) {
    if (s.price > 0) {
      lines.push(
        `| ${s.ticker} | ${s.layer ?? '-'} | $${s.price.toFixed(2)} | ` +
        `${s.priceChangePct1D >= 0 ? '+' : ''}${s.priceChangePct1D.toFixed(1)}% | ` +
        `${s.iv != null ? s.iv.toFixed(1) + '%' : 'N/A'} | ` +
        `${s.ivRank ?? 'N/A'} | ` +
        `${s.ivPctChange5Min != null ? s.ivPctChange5Min.toFixed(1) + '%' : 'N/A'} |`
      )
    }
  }

  const entry = getEntryByTicker(input.ticker)
  const isCrypto = entry?.instrumentType === 'crypto'

  if (isCrypto && snap && input.ticker !== '*') {
    lines.push('')
    lines.push(`### Crypto Spot — ${input.ticker}`)
    lines.push('This is a spot crypto instrument — no options chain is available on tastytrade.')
    lines.push('Focus: price action, volume, and momentum for directional or hedging decisions.')
    lines.push(`- 24h Market: crypto trades around the clock including weekends`)
    if (snap.dayHigh != null && snap.dayLow != null) {
      lines.push(`- Day Range: $${snap.dayLow.toFixed(2)} — $${snap.dayHigh.toFixed(2)}`)
    }
  } else if (optionChain.length > 0 && input.ticker !== '*') {
    lines.push('')
    lines.push(`### Option Chain — ${input.ticker} (nearest ${optionChain.length} expirations)`)
    for (const exp of optionChain) {
      lines.push(`\n**${exp.expiration}** (${exp.daysToExpiry} DTE)`)
      lines.push('| Strike | Call Bid | Call Ask | Call IV | Put Bid | Put Ask | Put IV |')
      lines.push('|--------|---------|---------|---------|---------|---------|--------|')
      for (const s of exp.strikes.slice(0, 10)) {
        lines.push(
          `| $${s.strike} | $${s.callBid.toFixed(2)} | $${s.callAsk.toFixed(2)} | ` +
          `${s.callIV != null ? (s.callIV * 100).toFixed(0) + '%' : '-'} | ` +
          `$${s.putBid.toFixed(2)} | $${s.putAsk.toFixed(2)} | ` +
          `${s.putIV != null ? (s.putIV * 100).toFixed(0) + '%' : '-'} |`
        )
      }
    }
  }

  lines.push('')
  lines.push('### Account')
  lines.push(`- Net Liq: $${account.netLiq.toLocaleString()}`)
  lines.push(`- Buying Power: $${account.buyingPower.toLocaleString()}`)
  lines.push(`- Open Positions: ${account.openPositions.length}`)

  if (account.openPositions.length > 0) {
    for (const pos of account.openPositions) {
      const label = pos.type === 'stock'
        ? `${pos.ticker} stock x${pos.quantity}`
        : `${pos.ticker} $${pos.strike} ${pos.type} ${pos.expiration ?? ''} x${pos.quantity}`
      lines.push(`  - ${label} | P&L: $${pos.pnl.toFixed(2)} (${pos.pnlPct.toFixed(1)}%)`)
    }
  }

  if (snap) {
    lines.push('')
    lines.push(`### Triggered Ticker: ${snap.ticker}`)
    lines.push(`- Price: $${snap.price.toFixed(2)}`)
    lines.push(`- Bid/Ask: $${snap.bid.toFixed(2)} / $${snap.ask.toFixed(2)}`)
    lines.push(`- Day Change: ${snap.priceChangePct1D >= 0 ? '+' : ''}${snap.priceChangePct1D.toFixed(2)}%`)
    if (snap.high52Week) lines.push(`- 52W Range: $${snap.low52Week?.toFixed(2)} — $${snap.high52Week.toFixed(2)}`)
    if (snap.ivRank != null) lines.push(`- IV Rank: ${snap.ivRank}`)
    if (snap.beta != null) lines.push(`- Beta: ${snap.beta.toFixed(2)}`)
  }

  return lines.join('\n')
}
