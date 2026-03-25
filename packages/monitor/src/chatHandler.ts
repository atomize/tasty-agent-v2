import { randomUUID } from 'node:crypto'
import type { ChatMessage } from '@tastytrade-monitor/shared'
import { getAllSnapshots } from './state.js'
import { getAccountContext } from './account.js'
import { getUserWatchlistsWithItems } from './watchlistService.js'
import { checkBudget, trackUsage } from './budgetTracker.js'
import { getAgentConfig } from './db.js'
import { decrypt } from './crypto.js'
import { log } from './logger.js'

const MAX_HISTORY = 20
const PER_MESSAGE_BUDGET = 0.10

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

export async function handleChatMessage(userId: number, message: string): Promise<ChatMessage | null> {
  const { allowed, remaining } = checkBudget(userId)
  if (!allowed) {
    return {
      id: randomUUID(),
      role: 'assistant',
      content: `Daily budget exhausted ($${remaining.toFixed(2)} remaining). Chat is paused until midnight CT.`,
      timestamp: new Date().toISOString(),
      costUsd: 0,
    }
  }

  const agentCfg = getAgentConfig(userId)
  if (!agentCfg || agentCfg.provider !== 'claude-sdk' || !agentCfg.encrypted_api_key) {
    return {
      id: randomUUID(),
      role: 'assistant',
      content: 'No Claude API key configured. Go to Settings to set up your agent.',
      timestamp: new Date().toISOString(),
      costUsd: 0,
    }
  }

  const history = conversations.get(userId) ?? []
  history.push({ role: 'user', content: message })
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY)
  conversations.set(userId, history)

  const systemPrompt = buildChatSystemPrompt(userId)
  const conversationText = history
    .map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`)
    .join('\n\n')

  const fullPrompt = `${systemPrompt}\n\n---\n\nConversation:\n${conversationText}\n\nAssistant:`

  try {
    const apiKey = decrypt(agentCfg.encrypted_api_key)
    const { invokeClaudeSDK } = await import('@tastytrade-monitor/claude-agent')
    const response = await invokeClaudeSDK(fullPrompt, {
      apiKey,
      model: agentCfg.model,
      maxBudgetUsd: PER_MESSAGE_BUDGET,
    })

    const costEstimate = estimateCost(fullPrompt, response, agentCfg.model)
    trackUsage(userId, 'chat', costEstimate, Math.ceil(fullPrompt.length / 4), Math.ceil(response.length / 4))

    history.push({ role: 'assistant', content: response })
    if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY)
    conversations.set(userId, history)

    return {
      id: randomUUID(),
      role: 'assistant',
      content: response,
      timestamp: new Date().toISOString(),
      costUsd: costEstimate,
    }
  } catch (err) {
    log.error(`Chat failed for user ${userId}: ${(err as Error).message}`)
    return {
      id: randomUUID(),
      role: 'assistant',
      content: `Error: ${(err as Error).message}`,
      timestamp: new Date().toISOString(),
      costUsd: 0,
    }
  }
}

export function clearChatHistory(userId: number): void {
  conversations.delete(userId)
}

export function getChatHistory(userId: number): ChatMessage[] {
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

function estimateCost(prompt: string, response: string, model: string): number {
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

  return tokensIn * inputRate + tokensOut * outputRate
}
