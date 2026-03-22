import { WebSocket } from 'ws'
import type { OptionsAlert } from '@tastytrade-monitor/shared'
import { config } from './config.js'
import { invokeClaudeSDK } from './invoke.js'

const alertQueue: OptionsAlert[] = []
const cooldowns = new Map<string, number>()
let isProcessing = false
let currentTicker: string | null = null
let lastError: string | null = null
let lastAlertTime: string | null = null
let ws: WebSocket | null = null
let heartbeatInterval: ReturnType<typeof setInterval> | null = null

function log(msg: string) {
  console.error(`[claude-agent] ${msg}`)
}

function sendWs(payload: Record<string, unknown>) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify(payload))
}

function sendStatus(state: 'idle' | 'processing' | 'error', ticker: string | null, error: string | null) {
  currentTicker = ticker ?? currentTicker
  lastError = error
  sendWs({
    type: 'agent_status',
    data: {
      connected: true,
      state,
      model: config.model,
      currentTicker: ticker,
      lastError: error,
      lastAlertTime,
      queueDepth: alertQueue.length,
    },
  })
}

function sendAnalysis(alert: OptionsAlert, analysis: string) {
  sendWs({
    type: 'agent_analysis',
    data: {
      alertId: alert.id,
      timestamp: new Date().toISOString(),
      model: config.model,
      analysis,
      ticker: alert.trigger?.ticker ?? 'unknown',
      triggerType: alert.trigger?.type ?? 'unknown',
    },
  })
  log(`Analysis posted for ${alert.trigger?.ticker}`)
}

function strategyHint(alert: OptionsAlert): string {
  const strategies = alert.strategies ?? []
  const layer = alert.supplyChainLayer ?? ''
  if (strategies.includes('crypto')) return 'Crypto spot — no options available. Directional bias only.'
  if (strategies.includes('supply_chain') || layer.startsWith('Layer'))
    return `AI supply chain: ${layer}. Check IV rank for premium selling vs buying.`
  if (strategies.includes('midterm_macro') || layer.startsWith('Macro'))
    return `Macro play: ${layer}. 30-90 day horizon, check hedging needs.`
  return ''
}

function buildPrompt(alert: OptionsAlert): string {
  const isDelayed = (alert.agentContext ?? '').includes('15-min delayed')
  const hint = strategyHint(alert)

  let prompt = ''
  if (isDelayed) prompt += '[SANDBOX — 15-min delayed data]\n'
  if (hint) prompt += `[Strategy: ${hint}]\n\n`
  prompt += alert.agentContext || JSON.stringify(alert.trigger, null, 2)
  prompt += '\n\nAnalyze this alert. Return a JSON object with: signal, trade, size, thesis, stop, invalidation. Under 150 words total.'

  return prompt
}

async function processAlert(alert: OptionsAlert) {
  isProcessing = true
  const ticker = alert.trigger?.ticker ?? '?'
  lastAlertTime = new Date().toISOString()
  log(`Processing alert: ${ticker} ${alert.trigger?.type}`)
  sendStatus('processing', ticker, null)

  try {
    const prompt = buildPrompt(alert)
    log(`Invoking Claude SDK (prompt: ${prompt.length} chars, model: ${config.model})`)
    const analysis = await invokeClaudeSDK(prompt, {
      apiKey: config.claudeApiKey,
      model: config.model,
      maxBudgetUsd: config.maxBudgetUsd,
      maxTurns: config.maxTurns,
    })

    if (analysis) {
      sendAnalysis(alert, analysis)
    } else {
      log(`Empty response from Claude SDK for ${ticker}`)
    }
    sendStatus('idle', null, null)
  } catch (err) {
    const errMsg = (err as Error).message?.slice(0, 200) ?? 'unknown error'
    log(`Claude SDK invocation failed for ${ticker}: ${errMsg}`)
    sendStatus('error', ticker, errMsg)
  }

  isProcessing = false

  if (alertQueue.length > 0) {
    const next = alertQueue.shift()!
    setTimeout(() => processAlert(next), 1000)
  }
}

function handleAlert(data: OptionsAlert) {
  if (!data?.id || !data?.trigger) return

  const cooldownKey = `${data.trigger.ticker}:${data.trigger.type}`
  const last = cooldowns.get(cooldownKey)
  if (last && Date.now() - last < config.cooldownMs) {
    log(`Cooldown active for ${cooldownKey}, skipping`)
    return
  }
  cooldowns.set(cooldownKey, Date.now())

  if (isProcessing) {
    if (alertQueue.length >= config.maxQueue) alertQueue.shift()
    alertQueue.push(data)
    log(`Queued alert for ${data.trigger.ticker} (queue: ${alertQueue.length})`)
    return
  }

  processAlert(data)
}

function connect() {
  log(`Connecting to ${config.monitorWsUrl}`)

  try {
    ws = new WebSocket(config.monitorWsUrl)
  } catch (err) {
    log(`Connection failed: ${(err as Error).message}`)
    setTimeout(connect, config.reconnectMs)
    return
  }

  ws.on('open', () => {
    log('Connected to monitor WS')
    sendStatus('idle', null, null)

    if (heartbeatInterval) clearInterval(heartbeatInterval)
    heartbeatInterval = setInterval(() => {
      const state = isProcessing ? 'processing' : (lastError ? 'error' : 'idle')
      sendStatus(state, currentTicker, lastError)
    }, config.heartbeatMs)
  })

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw))
      if (msg.type === 'alert' && msg.data) {
        handleAlert(msg.data as OptionsAlert)
      }
    } catch { /* ignore malformed messages */ }
  })

  ws.on('close', () => {
    log('Disconnected from monitor WS, reconnecting...')
    if (heartbeatInterval) clearInterval(heartbeatInterval)
    heartbeatInterval = null
    ws = null
    setTimeout(connect, config.reconnectMs)
  })

  ws.on('error', (err) => {
    log(`WS error: ${err.message}`)
    ws?.close()
  })
}

if (!config.claudeApiKey) {
  log('ERROR: CLAUDE_API_KEY or ANTHROPIC_API_KEY is required')
  process.exit(1)
}

log('Starting Claude Agent SDK runner')
log(`Monitor WS: ${config.monitorWsUrl}`)
log(`Model: ${config.model}`)
log(`Max budget per alert: $${config.maxBudgetUsd}`)

connect()

process.on('SIGTERM', () => {
  log('SIGTERM received, shutting down')
  ws?.close()
  process.exit(0)
})
