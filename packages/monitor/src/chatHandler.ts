import { randomUUID } from 'node:crypto'
import type { ChatMessage, WatchlistProposal } from '@tastytrade-monitor/shared'
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

export interface WatchlistChatResult {
  message: ChatMessage
  proposal: WatchlistProposal | null
}

export async function handleWatchlistChat(
  userId: number,
  message: string,
  activeWatchlist?: string,
): Promise<WatchlistChatResult> {
  log.info(`WatchlistChat: user ${userId} sent message (${message.length} chars)`)

  const { allowed, remaining } = checkBudget(userId)
  if (!allowed) {
    return {
      message: {
        id: randomUUID(),
        role: 'assistant',
        content: `Daily budget exhausted ($${remaining.toFixed(2)} remaining). Chat is paused until midnight CT.`,
        timestamp: new Date().toISOString(),
        costUsd: 0,
      },
      proposal: null,
    }
  }

  const agentCfg = getAgentConfig(userId)
  if (!agentCfg?.encrypted_api_key) {
    return {
      message: {
        id: randomUUID(),
        role: 'assistant',
        content: 'No Claude API key configured. Go to Settings to set up your API key.',
        timestamp: new Date().toISOString(),
        costUsd: 0,
      },
      proposal: null,
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
    const systemPrompt = buildWatchlistSystemPrompt(userId, activeWatchlist)

    const { chatDirect } = await import('@tastytrade-monitor/claude-agent/invoke-direct')
    const result = await chatDirect(history, {
      apiKey,
      model: agentCfg.model,
      systemPrompt,
      maxTokens: 4096,
    })

    const costEstimate = estimateCost(result.inputTokens, result.outputTokens, agentCfg.model)
    trackUsage(userId, 'chat', costEstimate, result.inputTokens, result.outputTokens)

    history.push({ role: 'assistant', content: result.text })
    if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY)
    conversations.set(userId, history)

    if (isEncryptionEnabled()) {
      try { appendChatMessage(userId, 'assistant', result.text) } catch { /* best-effort */ }
    }

    const proposal = extractProposal(result.text)
    const displayText = stripProposalBlock(result.text)

    log.info(`WatchlistChat: user ${userId} response (${result.outputTokens} tokens, $${costEstimate.toFixed(4)}, proposal: ${proposal ? 'yes' : 'no'})`)

    return {
      message: {
        id: randomUUID(),
        role: 'assistant',
        content: displayText,
        timestamp: new Date().toISOString(),
        costUsd: costEstimate,
      },
      proposal,
    }
  } catch (err) {
    const errMsg = (err as Error).message
    log.error(`WatchlistChat failed for user ${userId}: ${errMsg}`)
    return {
      message: {
        id: randomUUID(),
        role: 'assistant',
        content: `Error: ${errMsg}`,
        timestamp: new Date().toISOString(),
        costUsd: 0,
      },
      proposal: null,
    }
  }
}

function extractProposal(text: string): WatchlistProposal | null {
  const match = text.match(/```watchlist_proposal\s*\n([\s\S]*?)\n```/)
  if (!match) return null
  try {
    const raw = JSON.parse(match[1])
    const items = (raw.items ?? []).map((item: Record<string, unknown>, idx: number) => ({
      ticker: String(item.ticker ?? '').toUpperCase(),
      description: item.description ? String(item.description) : undefined,
      layer: item.layer != null ? String(item.layer) : null,
      strategies: Array.isArray(item.strategies) ? item.strategies.map(String) : [],
      thesis: String(item.thesis ?? ''),
      instrumentType: String(item.instrumentType ?? 'equity') as 'equity' | 'crypto',
      sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : idx,
    }))
    return {
      name: String(raw.name ?? 'Untitled'),
      sector: raw.sector ? String(raw.sector) : undefined,
      layers: Array.isArray(raw.layers) ? raw.layers.map(String) : [],
      items,
      reasoning: raw.reasoning ? String(raw.reasoning) : undefined,
    }
  } catch (err) {
    log.warn(`Failed to parse watchlist proposal: ${(err as Error).message}`)
    return null
  }
}

function stripProposalBlock(text: string): string {
  return text.replace(/```watchlist_proposal\s*\n[\s\S]*?\n```/g, '').trim()
}

function buildWatchlistSystemPrompt(userId: number, activeWatchlist?: string): string {
  const watchlists = getUserWatchlistsWithItems(userId)
  const allSnapshots = getAllSnapshots()

  const sections: string[] = []

  sections.push(`You are an expert equity research analyst and watchlist builder for an options trading platform.

Your job is to help the user build, refine, and populate sector-focused watchlists. Each watchlist represents a thematic investment thesis organized into layers (sub-categories within the sector).

## How a Great Watchlist Is Structured

Here is the pattern — every watchlist should follow this structure:
- **Name**: The sector or thesis (e.g. "AI Supply Chain", "Quantum Computing", "EV Battery Supply Chain")
- **Layers**: Sub-categories that decompose the sector into its component parts (3-8 layers)
- **Items**: Each ticker has:
  - \`ticker\`: Valid US equity symbol (MUST be real, publicly traded)
  - \`description\`: Company name
  - \`layer\`: Which sub-category this company belongs to
  - \`strategies\`: Array of ["supply_chain", "midterm_macro", "crypto"]
  - \`thesis\`: 1-2 sentences on WHY this company matters to the thesis, what its moat/catalyst is
  - \`instrumentType\`: "equity" or "crypto"

## Example: AI Supply Chain (7-Layer Model)
This is the gold standard. Layers decompose from silicon to power:
- Layer 1 — Chip Packaging (AMKR, CAMT, ACMR)
- Layer 2 — Optical Interconnects (FN, CIEN, LITE)
- Layer 3 — Signal Integrity (ALAB, CRDO, MRVL)
- Layer 4 — Rack & DC Construction (CLS, EME, CSCO)
- Layer 5 — Thermal & Power (VRT, MOHN, NVT)
- Layer 6 — Raw Materials (FCX, COPX, MP)
- Layer 7 — Nuclear/Uranium (CEG, CCJ, UEC, TLN)

Each ticker has a specific thesis: "AMKR — 2.5D advanced packaging, TSMC alternative, Arizona + Vietnam expansion"

## Instructions

When the user asks you to build or research a watchlist:

1. **Research the sector** — identify the key sub-categories/layers that decompose the supply chain or industry
2. **Find real tickers** — ONLY use real, publicly traded US equity symbols. Verify they trade on NYSE/NASDAQ.
3. **Assign layers** — place each ticker in its appropriate sub-category
4. **Write thesis** — 1-2 sentences per ticker explaining the investment thesis, moat, and current catalyst
5. **Output a proposal** — include a \`\`\`watchlist_proposal code block with structured JSON

When the user asks to add tickers to an existing watchlist, modify an existing list, or asks about companies in a sector, always include the proposal block if actionable.

## Proposal Format

When you have actionable changes, include this EXACT format in your response:

\`\`\`watchlist_proposal
{
  "name": "Sector Name",
  "sector": "Template Category",
  "layers": ["Sub-Category 1", "Sub-Category 2"],
  "items": [
    {
      "ticker": "SYMBOL",
      "description": "Company Name",
      "layer": "Sub-Category 1",
      "strategies": ["supply_chain"],
      "thesis": "Why this company matters...",
      "instrumentType": "equity"
    }
  ],
  "reasoning": "Brief explanation of the thesis"
}
\`\`\`

ALWAYS include the proposal block when the user is asking you to build, add to, or modify a watchlist. The proposal block is machine-parsed and presented to the user as a reviewable card.

If the user is just asking questions (not requesting changes), respond normally without a proposal block.`)

  if (watchlists.length > 0) {
    sections.push('\n## User\'s Current Watchlists')
    for (const wl of watchlists) {
      const highlight = wl.name === activeWatchlist ? ' (ACTIVE — user is viewing this one)' : ''
      sections.push(`\n### ${wl.name}${highlight} — ${wl.items.length} items`)
      for (const item of wl.items) {
        const snap = allSnapshots.find(s => s.ticker === item.ticker)
        const price = snap && snap.price > 0 ? ` $${snap.price.toFixed(2)}` : ''
        sections.push(`- ${item.ticker}${price} [${item.layer ?? '-'}] — ${item.thesis || 'no thesis'}`)
      }
    }
  }

  return sections.join('\n')
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
