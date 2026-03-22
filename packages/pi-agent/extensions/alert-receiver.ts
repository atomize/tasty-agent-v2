import type { ExtensionAPI, ExtensionContext, AgentEndEvent } from '@mariozechner/pi-coding-agent'
import type { Theme } from '@mariozechner/pi-coding-agent'
import { Type } from '@sinclair/typebox'
import { z } from 'zod'
import WebSocket from 'ws'

// Inline minimal OptionsAlert schema — validates the fields the extension
// actually reads while allowing the full payload through via passthrough().
const TriggerSchema = z.object({
  type: z.string(),
  ticker: z.string(),
  description: z.string(),
  threshold: z.number(),
  observed: z.number(),
}).passthrough()

const OptionsAlertSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  version: z.literal('1.0'),
  trigger: TriggerSchema,
  severity: z.string(),
  strategies: z.array(z.string()),
  supplyChainLayer: z.string().nullable(),
  agentContext: z.string(),
}).passthrough()

type OptionsAlert = z.infer<typeof OptionsAlertSchema>

const WS_URL = process.env.MONITOR_WS_URL || 'ws://localhost:3001'
const MAX_QUEUE = 5
const COOLDOWN_MS = 300_000

interface QueuedAlert {
  alert: OptionsAlert
  receivedAt: number
}

interface PendingAnalysis {
  alertId: string
  ticker: string
  triggerType: string
}

let ws: WebSocket | null = null
let piRef: ExtensionAPI | null = null
let widgetTui: { requestRender: () => void } | null = null

const alertHistory: QueuedAlert[] = []
const alertQueue: QueuedAlert[] = []
const cooldowns = new Map<string, number>()
const processedSet = new Set<string>()

let isProcessing = false
let wsConnected = false
let lastAlertSummary = ''
let pending: PendingAnalysis | null = null

export default function alertReceiver(pi: ExtensionAPI) {
  piRef = pi

  pi.on('session_start', async (_event: unknown, ctx: ExtensionContext) => {
    connectWebSocket()
    setupStdinPipe()

    if (ctx.hasUI) {
      ctx.ui.setWidget('alert-monitor', (tui: { requestRender: () => void }, theme: Theme) => {
        widgetTui = tui
        return {
          render: () => renderStatusWidget(theme),
          invalidate: () => {},
          dispose: () => { widgetTui = null },
        }
      })
    }
  })

  pi.on('agent_end', async (event: AgentEndEvent) => {
    if (!pending) return

    const analysis = extractLastAssistantText(event.messages)
    const model = extractModel(event.messages)

    if (analysis) {
      postAnalysisToWs(analysis, model)
    }

    pending = null
    isProcessing = false
    widgetTui?.requestRender()

    if (alertQueue.length > 0) {
      const next = alertQueue.shift()!
      setTimeout(() => processAlert(next), 1000)
    }
  })

  pi.on('session_shutdown', async () => {
    if (ws) {
      ws.close()
      ws = null
    }
  })

  pi.registerTool({
    name: 'alerts_history',
    label: 'Alert History',
    description: 'Show the last 10 alerts received from the tastytrade monitor',
    parameters: Type.Object({}),
    async execute(_toolCallId: string, _params: unknown, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: ExtensionContext) {
      if (alertHistory.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No alerts received yet.' }], details: undefined }
      }

      const rows = alertHistory.slice(0, 10).map((q, i) => {
        const a = q.alert
        const processed = processedSet.has(a.id) ? 'Y' : 'N'
        const time = new Date(a.timestamp).toLocaleTimeString()
        return `${i + 1}. ${a.trigger.ticker.padEnd(10)} ${a.trigger.type.padEnd(20)} ${time}  processed: ${processed}`
      })

      return {
        content: [{ type: 'text' as const, text: '## Recent Alerts\n\n```\n' + rows.join('\n') + '\n```' }],
        details: undefined,
      }
    },
  })

  pi.registerTool({
    name: 'latest_alert',
    label: 'Latest Alert',
    description: 'Re-inject the most recently received alert for analysis',
    parameters: Type.Object({}),
    async execute(_toolCallId: string, _params: unknown, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: ExtensionContext) {
      if (alertHistory.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No alerts available.' }], details: undefined }
      }

      const latest = alertHistory[0]
      processAlert(latest)

      return {
        content: [{
          type: 'text' as const,
          text: `Re-injecting alert: ${latest.alert.trigger.ticker} ${latest.alert.trigger.type}`,
        }],
        details: undefined,
      }
    },
  })
}

function connectWebSocket() {
  try {
    ws = new WebSocket(WS_URL)

    ws.on('open', () => {
      wsConnected = true
      widgetTui?.requestRender()
    })

    ws.on('message', (raw: WebSocket.Data) => {
      try {
        const msg = JSON.parse(String(raw))
        if (msg.type === 'alert' && msg.data) {
          handleIncomingAlert(msg.data)
        }
      } catch {
        // ignore malformed
      }
    })

    ws.on('close', () => {
      wsConnected = false
      widgetTui?.requestRender()
      setTimeout(connectWebSocket, 5000)
    })

    ws.on('error', () => {
      ws?.close()
    })
  } catch {
    wsConnected = false
    setTimeout(connectWebSocket, 5000)
  }
}

function setupStdinPipe() {
  if (!process.stdin.isTTY) {
    let buffer = ''
    process.stdin.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.startsWith('ALERT:')) {
          try {
            const json = JSON.parse(
              Buffer.from(line.slice(6), 'base64').toString('utf-8')
            )
            handleIncomingAlert(json)
          } catch {
            // ignore decode errors
          }
        }
      }
    })
  }
}

function handleIncomingAlert(raw: unknown) {
  const result = OptionsAlertSchema.safeParse(raw)
  if (!result.success) return

  const alert = result.data
  const queued: QueuedAlert = { alert, receivedAt: Date.now() }

  alertHistory.unshift(queued)
  if (alertHistory.length > 50) alertHistory.length = 50

  const cooldownKey = `${alert.trigger.ticker}:${alert.trigger.type}`
  const lastCooldown = cooldowns.get(cooldownKey)
  if (lastCooldown && Date.now() - lastCooldown < COOLDOWN_MS) {
    return
  }
  cooldowns.set(cooldownKey, Date.now())

  if (isProcessing) {
    if (alertQueue.length >= MAX_QUEUE) {
      alertQueue.shift()
    }
    alertQueue.push(queued)
    widgetTui?.requestRender()
    return
  }

  processAlert(queued)
}

function processAlert(queued: QueuedAlert) {
  if (!piRef) return
  isProcessing = true
  const { alert } = queued

  lastAlertSummary = `${alert.trigger.ticker} ${alert.trigger.type} @ ${new Date(alert.timestamp).toLocaleTimeString()}`
  widgetTui?.requestRender()

  pending = {
    alertId: alert.id,
    ticker: alert.trigger.ticker,
    triggerType: alert.trigger.type,
  }

  const skills = selectSkills(alert)
  const skillCommands = skills.map(s => `/skill:${s}`).join('\n')

  const isDelayed = alert.agentContext.includes('15-min delayed')
  const delayNote = isDelayed
    ? 'NOTE: This alert is based on 15-minute delayed sandbox data.\n\n'
    : ''

  const isCrypto = alert.strategies.includes('crypto')
  const cryptoNote = isCrypto
    ? 'NOTE: This is a crypto spot instrument — no options chain is available on tastytrade.\n\n'
    : ''

  const message =
    `${skillCommands}\n\n` +
    `${delayNote}${cryptoNote}` +
    `New alert received. Analyze and recommend:\n\n` +
    alert.agentContext

  piRef.sendMessage(
    {
      customType: 'options-alert',
      content: message,
      display: true,
    },
    {
      triggerTurn: true,
      deliverAs: 'followUp',
    },
  )

  processedSet.add(alert.id)
}

function selectSkills(alert: OptionsAlert): string[] {
  const skills: string[] = ['options-trader']

  if (alert.strategies.includes('supply_chain') || alert.supplyChainLayer?.startsWith('Layer')) {
    skills.push('ai-supply-chain')
  }

  if (alert.strategies.includes('midterm_macro') || alert.supplyChainLayer?.startsWith('Macro')) {
    skills.push('midterm-macro')
  }

  return skills
}

function extractLastAssistantText(messages: AgentEndEvent['messages']): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg && 'role' in msg && msg.role === 'assistant' && Array.isArray(msg.content)) {
      const textParts = msg.content
        .filter((c: { type: string }) => c.type === 'text')
        .map((c: { type: string; text?: string }) => c.text ?? '')
      if (textParts.length > 0) {
        return textParts.join('\n')
      }
    }
  }
  return null
}

function extractModel(messages: AgentEndEvent['messages']): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg && 'role' in msg && msg.role === 'assistant' && 'model' in msg && typeof msg.model === 'string') {
      return msg.model
    }
  }
  return 'unknown'
}

function postAnalysisToWs(analysis: string, model: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  if (!pending) return

  const payload = JSON.stringify({
    type: 'agent_analysis',
    data: {
      alertId: pending.alertId,
      timestamp: new Date().toISOString(),
      model,
      analysis,
      ticker: pending.ticker,
      triggerType: pending.triggerType,
    },
  })

  ws.send(payload)
}

function renderStatusWidget(theme: Theme): string[] {
  const lines: string[] = []

  const connDot = wsConnected
    ? theme.fg('success', '\u25CF')
    : theme.fg('error', '\u25CF')
  const connLabel = wsConnected ? 'Monitor WS connected' : 'Monitor WS disconnected'

  let status = `${connDot} ${theme.fg('text', connLabel)}`

  if (isProcessing && pending) {
    status += `  ${theme.fg('muted', '|')}  ${theme.fg('warning', `analyzing ${pending.ticker}...`)}`
  } else if (lastAlertSummary) {
    status += `  ${theme.fg('muted', '|')}  ${theme.fg('dim', lastAlertSummary)}`
  }

  if (alertQueue.length > 0) {
    status += `  ${theme.fg('muted', '|')}  ${theme.fg('dim', `queue: ${alertQueue.length}`)}`
  }

  lines.push(status)
  return lines
}
