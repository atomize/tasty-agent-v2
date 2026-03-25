import { randomUUID } from 'node:crypto'
import type { AnalysisReport } from '@tastytrade-monitor/shared'
import { getAllSnapshots } from './state.js'
import { fetchOptionChain } from './chainFetcher.js'
import { getAccountContext } from './account.js'
import { getUserWatchlistsWithItems, getUserTickers } from './watchlistService.js'
import { checkRunBudget, trackUsage } from './budgetTracker.js'
import { getScheduleConfig, insertReport, getLatestReport, type AgentConfigRow } from './db.js'
import { decrypt } from './crypto.js'
import { config } from './config.js'
import { log } from './logger.js'

export type RunType = 'morning' | 'midday_1' | 'midday_2' | 'preclose' | 'nextday' | 'manual'

const RUN_TYPE_LABELS: Record<RunType, string> = {
  morning: 'Morning Scan (post-open)',
  midday_1: 'Midday Review #1',
  midday_2: 'Midday Review #2',
  preclose: 'Pre-Close Analysis',
  nextday: 'Next-Day Preparation',
  manual: 'Manual (ad-hoc)',
}

export async function runScheduledAnalysis(
  userId: number,
  agentCfg: AgentConfigRow,
  runType: RunType,
): Promise<AnalysisReport | null> {
  const { allowed, perRunBudget, remaining } = checkRunBudget(userId)
  if (!allowed) {
    log.warn(`Scheduled analysis skipped for user ${userId}: daily budget exhausted ($${remaining.toFixed(2)} remaining)`)
    return null
  }

  if (agentCfg.provider !== 'claude-sdk' || !agentCfg.encrypted_api_key) {
    log.warn(`Scheduled analysis skipped for user ${userId}: no claude-sdk config`)
    return null
  }

  const schedCfg = getScheduleConfig(userId)
  const maxTickers = schedCfg?.max_tickers_per_run ?? 10
  const includeChains = schedCfg?.include_chains ?? 1

  const tickers = selectTopCandidates(userId, maxTickers)
  if (tickers.length === 0) {
    log.info(`Scheduled analysis: no candidates for user ${userId}`)
    return null
  }

  log.info(`Scheduled analysis [${runType}] for user ${userId}: ${tickers.length} tickers, budget $${perRunBudget.toFixed(2)}`)

  let chains: Record<string, unknown> = {}
  if (includeChains) {
    chains = await fetchChainsForTickers(tickers)
  }

  const prompt = buildScheduledPrompt(userId, tickers, chains, runType)
  const runId = randomUUID()

  try {
    const apiKey = decrypt(agentCfg.encrypted_api_key)
    const { invokeClaudeSDK } = await import('@tastytrade-monitor/claude-agent')
    const analysis = await invokeClaudeSDK(prompt, {
      apiKey,
      model: agentCfg.model,
      maxBudgetUsd: perRunBudget,
    })

    const costEstimate = estimateCost(prompt, analysis, agentCfg.model)

    trackUsage(userId, 'scheduled', costEstimate.costUsd, costEstimate.tokensIn, costEstimate.tokensOut, runId)

    const reportRow = insertReport({
      id: runId,
      user_id: userId,
      run_time: new Date().toISOString(),
      run_type: runType,
      tickers: JSON.stringify(tickers),
      report: analysis,
      cost_usd: costEstimate.costUsd,
      model: agentCfg.model,
    })

    const report: AnalysisReport = {
      id: reportRow.id,
      runTime: reportRow.run_time,
      runType: reportRow.run_type,
      tickers: JSON.parse(reportRow.tickers),
      report: reportRow.report,
      costUsd: reportRow.cost_usd,
      model: reportRow.model,
      createdAt: reportRow.created_at,
    }

    log.info(`Scheduled analysis complete [${runType}]: ${tickers.length} tickers, $${costEstimate.costUsd.toFixed(4)}`)
    return report
  } catch (err) {
    log.error(`Scheduled analysis failed for user ${userId}: ${(err as Error).message}`)
    return null
  }
}

function selectTopCandidates(userId: number, maxTickers: number): string[] {
  const userTickers = getUserTickers(userId)
  if (userTickers.length === 0) return []

  const snapshots = getAllSnapshots()
  const tickerSet = new Set(userTickers)

  const scored = snapshots
    .filter(s => tickerSet.has(s.ticker) && s.price > 0)
    .map(s => {
      let score = 0
      if (s.ivRank !== undefined) {
        if (s.ivRank > 70) score += 3
        else if (s.ivRank < 20) score += 2
      }
      if (Math.abs(s.priceChangePct1D) > 2) score += 2
      if (s.volume > 0) score += 1
      if (s.iv !== undefined && s.ivPctChange5Min !== undefined && Math.abs(s.ivPctChange5Min) > 5) score += 2
      return { ticker: s.ticker, score }
    })
    .sort((a, b) => b.score - a.score)

  return scored.slice(0, maxTickers).map(s => s.ticker)
}

async function fetchChainsForTickers(tickers: string[]): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {}
  for (const ticker of tickers) {
    try {
      await new Promise(r => setTimeout(r, config.rateLimit.minMsBetweenRestCalls))
      const chain = await fetchOptionChain(ticker, 3)
      if (chain.length > 0) result[ticker] = chain
    } catch (err) {
      log.warn(`Chain fetch failed for ${ticker}: ${(err as Error).message}`)
    }
  }
  return result
}

function buildScheduledPrompt(
  userId: number,
  tickers: string[],
  chains: Record<string, unknown>,
  runType: RunType,
): string {
  const watchlists = getUserWatchlistsWithItems(userId)
  const allSnapshots = getAllSnapshots()
  const account = getAccountContext()
  const prevReport = getLatestReport(userId)

  const tickerSet = new Set(tickers)
  const relevantSnapshots = allSnapshots.filter(s => tickerSet.has(s.ticker))

  const sections: string[] = []

  sections.push(`# Scheduled Analysis: ${RUN_TYPE_LABELS[runType]}`)
  sections.push(`**Time**: ${new Date().toISOString()}`)
  sections.push(`**Tickers**: ${tickers.join(', ')}`)

  sections.push('\n## Watchlist Context')
  for (const wl of watchlists) {
    sections.push(`### ${wl.name} (${wl.items.length} items)`)
    for (const item of wl.items) {
      const snap = allSnapshots.find(s => s.ticker === item.ticker)
      const price = snap ? `$${snap.price.toFixed(2)}` : 'n/a'
      const ivr = snap?.ivRank !== undefined ? `IVR ${snap.ivRank.toFixed(0)}` : ''
      sections.push(`- **${item.ticker}** [${item.layer ?? 'uncategorized'}] ${price} ${ivr} — ${item.thesis}`)
    }
  }

  sections.push('\n## Market Snapshots (selected tickers)')
  for (const snap of relevantSnapshots) {
    sections.push([
      `**${snap.ticker}**: $${snap.price.toFixed(2)}`,
      `chg ${snap.priceChangePct1D.toFixed(2)}%`,
      snap.iv !== undefined ? `IV ${(snap.iv * 100).toFixed(1)}%` : '',
      snap.ivRank !== undefined ? `IVR ${snap.ivRank.toFixed(0)}` : '',
      `vol ${snap.volume.toLocaleString()}`,
    ].filter(Boolean).join(' | '))
  }

  if (Object.keys(chains).length > 0) {
    sections.push('\n## Option Chains')
    for (const [ticker, chain] of Object.entries(chains)) {
      sections.push(`### ${ticker}`)
      sections.push('```json')
      sections.push(JSON.stringify(chain, null, 2).slice(0, 3000))
      sections.push('```')
    }
  }

  sections.push('\n## Account')
  sections.push(`Net Liq: $${account.netLiq.toLocaleString()} | Buying Power: $${account.buyingPower.toLocaleString()}`)
  if (account.openPositions.length > 0) {
    sections.push('Open positions:')
    for (const pos of account.openPositions) {
      sections.push(`- ${pos.ticker} ${pos.type}${pos.strike ? ` ${pos.strike}` : ''}${pos.expiration ? ` exp ${pos.expiration}` : ''}: qty ${pos.quantity}, P&L ${pos.pnl >= 0 ? '+' : ''}$${pos.pnl.toFixed(2)} (${pos.pnlPct.toFixed(1)}%)`)
    }
  }

  if (prevReport) {
    sections.push('\n## Previous Analysis (for continuity)')
    sections.push(`_${prevReport.run_type} at ${prevReport.run_time}_`)
    sections.push(prevReport.report.slice(0, 1500))
  }

  sections.push('\n## Instructions')
  sections.push(`You are an options trading analyst. This is a ${RUN_TYPE_LABELS[runType]}.`)
  sections.push('Focus on PLAIN CALLS and PUTS only — no spreads, no multi-leg strategies.')
  sections.push('For each actionable ticker, provide: signal (BUY_CALL/BUY_PUT/HOLD), expiration range (short/mid/long term), strike selection rationale, thesis, stop loss, and invalidation.')
  sections.push('Rank by conviction. Be specific about entry prices and position sizing relative to account size.')
  sections.push('Format as clean markdown with headers per ticker.')

  if (runType === 'nextday') {
    sections.push('\n## NEXT-DAY PREPARATION')
    sections.push('This is the end-of-day preparation run. In addition to regular analysis:')
    sections.push('1. **Day Summary**: Summarize today — which alerts fired, which tickers moved most, which analyses were produced')
    sections.push('2. **Overnight Risk**: Identify earnings reports, FOMC/macro events, geopolitical catalysts that could impact positions overnight')
    sections.push('3. **Tomorrow Watch List**: Rank the top 5 tickers to watch most closely at open, with specific price levels')
    sections.push('4. **Position Review**: Flag any open positions that need attention — expiring options, large unrealized P&L swings, positions near stop levels')
    sections.push('5. **Gap Risk**: Assess overnight gap risk for current positions')
  }

  return sections.join('\n')
}

function estimateCost(prompt: string, response: string, model: string): { costUsd: number; tokensIn: number; tokensOut: number } {
  const tokensIn = Math.ceil(prompt.length / 4)
  const tokensOut = Math.ceil(response.length / 4)

  let inputRate = 3.0 / 1_000_000
  let outputRate = 15.0 / 1_000_000
  if (model.includes('haiku')) {
    inputRate = 0.25 / 1_000_000
    outputRate = 1.25 / 1_000_000
  } else if (model.includes('opus')) {
    inputRate = 15.0 / 1_000_000
    outputRate = 75.0 / 1_000_000
  }

  return {
    costUsd: tokensIn * inputRate + tokensOut * outputRate,
    tokensIn,
    tokensOut,
  }
}
