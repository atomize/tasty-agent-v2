import type { TradeSignal, TraderDecision, PaperPosition, PaperAccount, TickerSnapshot } from '@tastytrade-monitor/shared'

export interface TraderAgentDeps {
  chatDirect: (
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    options: { apiKey: string; model: string; systemPrompt: string },
  ) => Promise<{ text: string; inputTokens: number; outputTokens: number }>
  apiKey: string
  model: string
}

export async function evaluateWithAI(
  signal: TradeSignal,
  account: PaperAccount,
  positions: PaperPosition[],
  snapshot: TickerSnapshot | undefined,
  deps: TraderAgentDeps,
): Promise<TraderDecision> {
  const systemPrompt = buildTraderPrompt(account, positions)
  const userMsg = buildSignalContext(signal, snapshot)

  try {
    const result = await deps.chatDirect(
      [{ role: 'user', content: userMsg }],
      { apiKey: deps.apiKey, model: deps.model, systemPrompt },
    )

    return parseDecision(result.text)
  } catch {
    return {
      action: 'execute',
      reason: 'AI trader unavailable — defaulting to execute',
      confidence: 50,
      usedAI: false,
    }
  }
}

export function makeRulesDecision(reason?: string): TraderDecision {
  return {
    action: 'execute',
    reason: reason ?? 'Rules-based: all checks passed',
    confidence: 70,
    usedAI: false,
  }
}

function buildTraderPrompt(account: PaperAccount, positions: PaperPosition[]): string {
  const positionLines = positions.map(p => {
    const pnlPct = p.unrealizedPnlPct.toFixed(1)
    return `  ${p.side} ${p.instrument} ${p.ticker}${p.strike ? ' ' + p.strike : ''} qty:${p.quantity} cost:$${p.avgCost.toFixed(2)} P&L:${pnlPct}%`
  }).join('\n')

  return [
    'You are a risk-management trader agent for a paper trading system.',
    'Given a trade signal and portfolio context, decide whether to execute, skip, or modify.',
    'Respond ONLY with valid JSON: { "action": "execute"|"skip"|"modify", "reason": "...", "confidence": 0-100, "adjustedSizePercent": number|null }',
    '',
    `## Portfolio`,
    `Cash: $${account.cash.toFixed(0)} | Equity: $${account.equity.toFixed(0)} | Realized P&L: $${account.realizedPnl.toFixed(0)}`,
    `Open positions (${positions.length}):`,
    positionLines || '  (none)',
  ].join('\n')
}

function buildSignalContext(signal: TradeSignal, snapshot: TickerSnapshot | undefined): string {
  const lines = [
    `## Trade Signal`,
    `${signal.action.toUpperCase()} ${signal.instrument.toUpperCase()} ${signal.ticker}${signal.strike ? ' ' + signal.strike : ''}${signal.expiration ? ' exp ' + signal.expiration : ''} @ $${signal.price}`,
    `Size: ${signal.sizePercent}% of buying power`,
    `Thesis: ${signal.thesis}`,
    `Stop: ${signal.stopCondition}`,
    `Invalidation: ${signal.invalidation}`,
  ]

  if (snapshot) {
    const ivr = snapshot.ivRank !== undefined ? ` IVR:${snapshot.ivRank.toFixed(0)}` : ''
    lines.push('', `## Current Market`)
    lines.push(`${snapshot.ticker} $${snapshot.price.toFixed(2)} (${snapshot.priceChangePct1D >= 0 ? '+' : ''}${snapshot.priceChangePct1D.toFixed(1)}%)${ivr}`)
  }

  lines.push('', 'Decide: execute, skip, or modify? Return JSON only.')
  return lines.join('\n')
}

function parseDecision(text: string): TraderDecision {
  try {
    const cleaned = text.replace(/```json\s*|\s*```/g, '').trim()
    const parsed = JSON.parse(cleaned)
    const action = ['execute', 'skip', 'modify'].includes(parsed.action) ? parsed.action : 'execute'
    return {
      action,
      reason: String(parsed.reason ?? 'AI decision'),
      adjustedSizePercent: typeof parsed.adjustedSizePercent === 'number' ? parsed.adjustedSizePercent : undefined,
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(100, parsed.confidence)) : 60,
      usedAI: true,
    }
  } catch {
    return {
      action: 'execute',
      reason: 'Could not parse AI response — defaulting to execute',
      confidence: 40,
      usedAI: true,
    }
  }
}
