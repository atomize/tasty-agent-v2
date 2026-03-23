import { WebSocket } from 'ws'
import type { OptionsAlert, AgentAnalysis } from '@tastytrade-monitor/shared'
import { getAllActiveConfigs } from './db.js'
import type { AgentConfigRow } from './db.js'
import { decrypt } from './crypto.js'
import { onAlertForOrchestrator, broadcastToAll } from './broadcaster.js'
import { log } from './logger.js'

const COOLDOWN_MS = 300_000
const WEBHOOK_TIMEOUT_MS = 60_000
const cooldowns = new Map<string, number>()
const wsPool = new Map<number, WebSocket>()

export function initOrchestrator(): void {
  onAlertForOrchestrator(dispatchAlert)
  log.info('Agent orchestrator initialized (multi-tenant dispatch)')
}

async function dispatchAlert(alert: OptionsAlert): Promise<void> {
  const configs = getAllActiveConfigs()
  if (configs.length === 0) {
    log.info(`Alert ${alert.trigger.ticker}/${alert.trigger.type} — no active agent configs, skipping dispatch`)
    return
  }
  log.info(`Dispatching alert ${alert.trigger.ticker}/${alert.trigger.type} to ${configs.length} agent(s)`)

  for (const cfg of configs) {
    const cooldownKey = `${cfg.user_id}:${alert.trigger.ticker}:${alert.trigger.type}`
    const last = cooldowns.get(cooldownKey)
    if (last && Date.now() - last < COOLDOWN_MS) continue
    cooldowns.set(cooldownKey, Date.now())

    dispatchToUser(cfg, alert).catch(err => {
      log.warn(`Orchestrator dispatch failed for user ${cfg.user_id}: ${(err as Error).message}`)
    })
  }
}

async function dispatchToUser(cfg: AgentConfigRow & { email: string }, alert: OptionsAlert): Promise<void> {
  switch (cfg.provider) {
    case 'claude-sdk':
      await dispatchClaudeSDK(cfg, alert)
      break
    case 'webhook':
      await dispatchWebhook(cfg, alert)
      break
    case 'websocket':
      await dispatchWebSocket(cfg, alert)
      break
  }
}

// ─── Claude SDK mode ─────────────────────────────────────────────

async function dispatchClaudeSDK(cfg: AgentConfigRow & { email: string }, alert: OptionsAlert): Promise<void> {
  if (!cfg.encrypted_api_key) {
    log.warn(`No API key for user ${cfg.email}, skipping claude-sdk dispatch`)
    return
  }

  broadcastAgentStatus(cfg, 'processing', alert.trigger.ticker)

  try {
    const apiKey = decrypt(cfg.encrypted_api_key)
    const { invokeClaudeSDK } = await import('@tastytrade-monitor/claude-agent')
    const prompt = buildPrompt(alert)
    const analysis = await invokeClaudeSDK(prompt, {
      apiKey,
      model: cfg.model,
      maxBudgetUsd: cfg.max_budget_usd,
    })

    if (analysis) {
      postAnalysis(alert, analysis, cfg)
    }
    broadcastAgentStatus(cfg, 'idle', null)
  } catch (err) {
    const msg = (err as Error).message?.slice(0, 200) ?? 'unknown error'
    log.warn(`Claude SDK failed for user ${cfg.email}: ${msg}`)
    broadcastAgentStatus(cfg, 'error', alert.trigger.ticker, msg)
  }
}

// ─── Webhook mode ────────────────────────────────────────────────

async function dispatchWebhook(cfg: AgentConfigRow & { email: string }, alert: OptionsAlert): Promise<void> {
  if (!cfg.external_url) {
    log.warn(`No external URL for user ${cfg.email}, skipping webhook dispatch`)
    return
  }

  broadcastAgentStatus(cfg, 'processing', alert.trigger.ticker)

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)

    const response = await fetch(cfg.external_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alert }),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) {
      throw new Error(`Webhook responded with ${response.status}`)
    }

    const body = await response.json() as { analysis?: string; model?: string }
    if (body.analysis) {
      postAnalysis(alert, body.analysis, cfg, body.model)
    }
    broadcastAgentStatus(cfg, 'idle', null)
  } catch (err) {
    const msg = (err as Error).message?.slice(0, 200) ?? 'webhook error'
    log.warn(`Webhook failed for user ${cfg.email}: ${msg}`)
    broadcastAgentStatus(cfg, 'error', alert.trigger.ticker, msg)
  }
}

// ─── WebSocket mode ──────────────────────────────────────────────

async function dispatchWebSocket(cfg: AgentConfigRow & { email: string }, alert: OptionsAlert): Promise<void> {
  if (!cfg.external_url) {
    log.warn(`No external URL for user ${cfg.email}, skipping WS dispatch`)
    return
  }

  broadcastAgentStatus(cfg, 'processing', alert.trigger.ticker)

  try {
    const ws = await getOrCreateWsConnection(cfg)

    const response = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket agent timed out after 60s'))
      }, WEBHOOK_TIMEOUT_MS)

      const handler = (raw: Buffer | string) => {
        try {
          const msg = JSON.parse(String(raw))
          if (msg.type === 'agent_analysis' && msg.data?.alertId === alert.id) {
            clearTimeout(timeout)
            ws.off('message', handler)
            resolve(msg.data.analysis as string)
          }
        } catch { /* ignore */ }
      }

      ws.on('message', handler)
      ws.send(JSON.stringify({ type: 'alert', data: alert }))
    })

    if (response) {
      postAnalysis(alert, response, cfg)
    }
    broadcastAgentStatus(cfg, 'idle', null)
  } catch (err) {
    const msg = (err as Error).message?.slice(0, 200) ?? 'ws agent error'
    log.warn(`WebSocket agent failed for user ${cfg.email}: ${msg}`)
    broadcastAgentStatus(cfg, 'error', alert.trigger.ticker, msg)
  }
}

function getOrCreateWsConnection(cfg: AgentConfigRow & { email: string }): Promise<WebSocket> {
  const existing = wsPool.get(cfg.user_id)
  if (existing && existing.readyState === WebSocket.OPEN) {
    return Promise.resolve(existing)
  }

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(cfg.external_url!)
    const timeout = setTimeout(() => {
      ws.close()
      reject(new Error('WebSocket connection timed out'))
    }, 10_000)

    ws.on('open', () => {
      clearTimeout(timeout)
      wsPool.set(cfg.user_id, ws)
      resolve(ws)
    })

    ws.on('close', () => {
      wsPool.delete(cfg.user_id)
    })

    ws.on('error', (err) => {
      clearTimeout(timeout)
      wsPool.delete(cfg.user_id)
      reject(err)
    })
  })
}

// ─── Helpers ─────────────────────────────────────────────────────

function buildPrompt(alert: OptionsAlert): string {
  const isDelayed = (alert.agentContext ?? '').includes('15-min delayed')
  const strategies = alert.strategies ?? []
  const layer = alert.supplyChainLayer ?? ''

  let hint = ''
  if (strategies.includes('crypto')) hint = 'Crypto spot — no options available. Directional bias only.'
  else if (strategies.includes('supply_chain') || layer.startsWith('Layer'))
    hint = `AI supply chain: ${layer}. Check IV rank for premium selling vs buying.`
  else if (strategies.includes('midterm_macro') || layer.startsWith('Macro'))
    hint = `Macro play: ${layer}. 30-90 day horizon, check hedging needs.`

  let prompt = ''
  if (isDelayed) prompt += '[SANDBOX — 15-min delayed data]\n'
  if (hint) prompt += `[Strategy: ${hint}]\n\n`
  prompt += alert.agentContext || JSON.stringify(alert.trigger, null, 2)
  prompt += '\n\nAnalyze this alert. Return a JSON object with: signal, trade, size, thesis, stop, invalidation. Under 150 words total.'

  return prompt
}

function postAnalysis(alert: OptionsAlert, analysis: string, cfg: AgentConfigRow & { email: string }, model?: string): void {
  const agentAnalysis: AgentAnalysis = {
    alertId: alert.id,
    timestamp: new Date().toISOString(),
    model: model ?? cfg.model,
    analysis,
    ticker: alert.trigger.ticker,
    triggerType: alert.trigger.type,
  }

  broadcastToAll({ type: 'agent_analysis', data: agentAnalysis })
  log.info(`Analysis posted for ${alert.trigger.ticker} (user: ${cfg.email})`)
}

function broadcastAgentStatus(cfg: AgentConfigRow & { email: string }, state: 'idle' | 'processing' | 'error', ticker: string | null, error?: string): void {
  broadcastToAll({
    type: 'agent_status',
    data: {
      connected: true,
      state,
      model: cfg.model,
      currentTicker: ticker,
      lastError: error ?? null,
      lastAlertTime: new Date().toISOString(),
      queueDepth: 0,
    },
  })
}
