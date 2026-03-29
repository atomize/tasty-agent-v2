import { randomUUID } from 'node:crypto'
import type { ChatMessage } from '@tastytrade-monitor/shared'
import { getAllSnapshots } from './state.js'
import { getAccountContext } from './account.js'
import { getUserWatchlistsWithItems } from './watchlistService.js'
import { checkBudget, trackUsage } from './budgetTracker.js'
import { getAgentConfig, appendChatMessage, getChatHistory as getChatHistoryDb, clearChatHistoryDb } from './db.js'
import { decrypt, isEncryptionEnabled } from './crypto.js'
import { log } from './logger.js'

const MAX_HISTORY = 20

interface ConversationEntry {
  role: 'user' | 'assistant'
  content: string
}

const conversations = new Map<number, ConversationEntry[]>()
const recentAlerts = new Map<number, string[]>()
const recentAnalyses = new Map<number, string[]>()

export function pushAlertContext(userId: number, alertSummary: string): void {
  const list = recentAlerts.get(userId) ?? []
  list.unshift(alertSummary)
  if (list.length > 10) list.length = 10
  recentAlerts.set(userId, list)
}

export function pushAnalysisContext(userId: number, analysisSummary: string): void {
  const list = recentAnalyses.get(userId) ?? []
  list.unshift(analysisSummary)
  if (list.length > 5) list.length = 5
  recentAnalyses.set(userId, list)
}

export async function handleChatMessage(userId: number, message: string): Promise<ChatMessage> {
  log.info(`Chat: user ${userId} sent message (${message.length} chars)`)

  const { allowed, remaining } = checkBudget(userId)
  if (!allowed) {
    log.info(`Chat: user ${userId} budget exhausted ($${remaining.toFixed(2)} remaining)`)
    return {
      id: randomUUID(),
      role: 'assistant',
      content: `Daily budget exhausted ($${remaining.toFixed(2)} remaining). Chat is paused until midnight CT.`,
      timestamp: new Date().toISOString(),
      costUsd: 0,
    }
  }

  const agentCfg = getAgentConfig(userId)
  if (!agentCfg?.encrypted_api_key) {
    log.info(`Chat: user ${userId} has no API key configured`)
    return {
      id: randomUUID(),
      role: 'assistant',
      content: 'No Claude API key configured. Go to Settings → Agent Configuration to set up your API key.',
      timestamp: new Date().toISOString(),
      costUsd: 0,
    }
  }

  let history = conversations.get(userId)
  if (!history && isEncryptionEnabled()) {
    const rows = getChatHistoryDb(userId)
    history = rows.map(r => ({ role: r.role, content: r.content }))
  }
  if (!history) history = []
  history.push({ role: 'user', content: message })
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY)
  conversations.set(userId, history)

  if (isEncryptionEnabled()) {
    try { appendChatMessage(userId, 'user', message) } catch { /* best-effort */ }
  }

  try {
    const apiKey = decrypt(agentCfg.encrypted_api_key)
    const systemPrompt = buildChatSystemPrompt(userId)

    const { chatDirect } = await import('@tastytrade-monitor/claude-agent/invoke-direct')
    const result = await chatDirect(history, {
      apiKey,
      model: agentCfg.model,
      systemPrompt,
    })

    const costEstimate = estimateCost(result.inputTokens, result.outputTokens, agentCfg.model)
    trackUsage(userId, 'chat', costEstimate, result.inputTokens, result.outputTokens)

    history.push({ role: 'assistant', content: result.text })
    if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY)
    conversations.set(userId, history)

    if (isEncryptionEnabled()) {
      try { appendChatMessage(userId, 'assistant', result.text) } catch { /* best-effort */ }
    }

    log.info(`Chat: user ${userId} response (${result.outputTokens} tokens, $${costEstimate.toFixed(4)})`)

    return {
      id: randomUUID(),
      role: 'assistant',
      content: result.text,
      timestamp: new Date().toISOString(),
      costUsd: costEstimate,
    }
  } catch (err) {
    const errMsg = (err as Error).message
    log.error(`Chat failed for user ${userId}: ${errMsg}`)
    const errorMsg = `Error: ${errMsg}`
    if (isEncryptionEnabled()) {
      try { appendChatMessage(userId, 'assistant', errorMsg) } catch { /* best-effort */ }
    }
    return {
      id: randomUUID(),
      role: 'assistant',
      content: errorMsg,
      timestamp: new Date().toISOString(),
      costUsd: 0,
    }
  }
}

export function clearChatHistory(userId: number): void {
  conversations.delete(userId)
  if (isEncryptionEnabled()) {
    try { clearChatHistoryDb(userId) } catch { /* best-effort */ }
  }
  log.info(`Chat: cleared history for user ${userId}`)
}

export function getChatHistoryForUser(userId: number): ChatMessage[] {
  if (isEncryptionEnabled()) {
    const rows = getChatHistoryDb(userId)
    if (rows.length > 0 && !conversations.has(userId)) {
      conversations.set(userId, rows.map(r => ({ role: r.role, content: r.content })))
    }
    return rows.map(r => ({
      id: `db-${r.id}`,
      role: r.role,
      content: r.content,
      timestamp: r.created_at,
    }))
  }
  const history = conversations.get(userId) ?? []
  return history.map((h, i) => ({
    id: `hist-${i}`,
    role: h.role,
    content: h.content,
    timestamp: new Date().toISOString(),
  }))
}

function buildChatSystemPrompt(userId: number): string {
  const watchlists = getUserWatchlistsWithItems(userId)
  const allSnapshots = getAllSnapshots()
  const account = getAccountContext()
  const alerts = recentAlerts.get(userId) ?? []
  const analyses = recentAnalyses.get(userId) ?? []

  const sections: string[] = []

  sections.push('You are an AI trading assistant with full context of the user\'s watchlists, market data, and account.')
  sections.push('Focus on PLAIN CALLS and PUTS — no multi-leg strategies. Be concise and actionable.')

  const totalItems = watchlists.reduce((sum, wl) => sum + wl.items.length, 0)
  sections.push(`\n## Context: ${totalItems} watchlist symbols, ${alerts.length} recent alerts, ${analyses.length} recent analyses`)

  for (const wl of watchlists) {
    sections.push(`\n### Watchlist: ${wl.name}`)
    for (const item of wl.items) {
      const snap = allSnapshots.find(s => s.ticker === item.ticker)
      if (snap && snap.price > 0) {
        const ivr = snap.ivRank !== undefined ? ` IVR:${snap.ivRank.toFixed(0)}` : ''
        sections.push(`- ${item.ticker} $${snap.price.toFixed(2)} (${snap.priceChangePct1D >= 0 ? '+' : ''}${snap.priceChangePct1D.toFixed(1)}%)${ivr} [${item.layer ?? '-'}]`)
      } else {
        sections.push(`- ${item.ticker} [${item.layer ?? '-'}] — ${item.thesis.slice(0, 80)}`)
      }
    }
  }

  sections.push(`\n## Account: Net Liq $${account.netLiq.toLocaleString()} | BP $${account.buyingPower.toLocaleString()} | ${account.openPositions.length} positions`)

  if (alerts.length > 0) {
    sections.push('\n## Recent Alerts')
    for (const a of alerts.slice(0, 5)) sections.push(`- ${a}`)
  }

  if (analyses.length > 0) {
    sections.push('\n## Recent Analyses')
    for (const a of analyses.slice(0, 3)) sections.push(`- ${a.slice(0, 300)}`)
  }

  return sections.join('\n')
}

function estimateCost(inputTokens: number, outputTokens: number, model: string): number {
  let inputRate = 3.0 / 1_000_000
  let outputRate = 15.0 / 1_000_000
  if (model.includes('haiku')) {
    inputRate = 0.25 / 1_000_000
    outputRate = 1.25 / 1_000_000
  } else if (model.includes('opus')) {
    inputRate = 15.0 / 1_000_000
    outputRate = 75.0 / 1_000_000
  }

  return inputTokens * inputRate + outputTokens * outputRate
}
