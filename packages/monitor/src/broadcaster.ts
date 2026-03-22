import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, WebSocket } from 'ws'
import type { OptionsAlert, AgentAnalysis, AgentStatus, WsMessage } from '@tastytrade-monitor/shared'
import { getAllSnapshots } from './state.js'
import { getAccountContext } from './account.js'
import { onAlert } from './alertBus.js'
import { fetchOptionChain } from './chainFetcher.js'
import { getEntryByTicker } from './watchlist.config.js'
import { config } from './config.js'
import { log } from './logger.js'

let wss: WebSocketServer | null = null
const startTime = Date.now()

const MAX_ALERTS = 200
const MAX_ANALYSES = 50
const recentAlerts: OptionsAlert[] = []
const recentAnalyses: AgentAnalysis[] = []
let agentStatus: AgentStatus | null = null

type OrchestratorHandler = (alert: OptionsAlert) => Promise<void> | void
let orchestratorHandler: OrchestratorHandler | null = null

export function onAlertForOrchestrator(handler: OrchestratorHandler): void {
  orchestratorHandler = handler
}

export function broadcastToAll(msg: WsMessage): void {
  broadcast(msg)
}

function pushAlert(alert: OptionsAlert): void {
  recentAlerts.unshift(alert)
  if (recentAlerts.length > MAX_ALERTS) recentAlerts.length = MAX_ALERTS
}

function pushAnalysis(analysis: AgentAnalysis): void {
  recentAnalyses.unshift(analysis)
  if (recentAnalyses.length > MAX_ANALYSES) recentAnalyses.length = MAX_ANALYSES
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function resolveDashboardDir(): string | null {
  const __dirname = fileURLToPath(new URL('.', import.meta.url))
  const candidates = [
    resolve(__dirname, '../../dashboard/dist'),
    resolve(__dirname, '../../../dashboard/dist'),
    '/app/packages/dashboard/dist',
  ]
  for (const dir of candidates) {
    if (existsSync(join(dir, 'index.html'))) return dir
  }
  return null
}

function serveStatic(req: IncomingMessage, res: ServerResponse, dashDir: string): void {
  const url = req.url ?? '/'
  const safePath = url.split('?')[0].replace(/\.\./g, '')
  let filePath = join(dashDir, safePath === '/' ? 'index.html' : safePath)

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    filePath = join(dashDir, 'index.html')
  }

  const ext = extname(filePath)
  const contentType = MIME_TYPES[ext] || 'application/octet-stream'

  try {
    const content = readFileSync(filePath)
    res.writeHead(200, { 'Content-Type': contentType })
    res.end(content)
  } catch {
    res.writeHead(500)
    res.end('Internal Server Error')
  }
}

export function startBroadcaster(): void {
  const dashDir = config.server.serveDashboard ? resolveDashboardDir() : null

  if (config.server.serveDashboard && !dashDir) {
    log.warn('SERVE_DASHBOARD=true but no dashboard build found — WS-only mode')
  }

  const server = createServer((req, res) => {
    if (dashDir) {
      serveStatic(req, res, dashDir)
    } else {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('tastytrade monitor WS server')
    }
  })

  wss = new WebSocketServer({ server })

  wss.on('connection', (ws) => {
    log.info(`Dashboard client connected (total: ${wss!.clients.size})`)

    send(ws, { type: 'snapshot', data: getAllSnapshots() })
    send(ws, { type: 'account', data: getAccountContext() })
    send(ws, { type: 'status', data: buildStatus() })

    if (recentAlerts.length > 0) {
      send(ws, { type: 'alert_history', data: recentAlerts })
    }
    if (recentAnalyses.length > 0) {
      send(ws, { type: 'analysis_history', data: recentAnalyses })
    }
    if (agentStatus) {
      send(ws, { type: 'agent_status', data: agentStatus })
    }

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw))
        if (msg.type === 'requestChain' && typeof msg.ticker === 'string') {
          handleChainRequest(ws, msg.ticker)
        } else if (msg.type === 'agent_analysis' && msg.data) {
          log.info(`Agent analysis received for ${msg.data.ticker ?? 'unknown'} (model: ${msg.data.model ?? 'unknown'})`)
          pushAnalysis(msg.data as AgentAnalysis)
          broadcastRaw(String(raw))
        } else if (msg.type === 'alert' && msg.data) {
          log.info(`Injected test alert for ${msg.data.trigger?.ticker ?? 'unknown'}`)
          pushAlert(msg.data as OptionsAlert)
          broadcastRaw(String(raw))
        } else if (msg.type === 'agent_status' && msg.data) {
          agentStatus = msg.data as AgentStatus
          broadcastRaw(String(raw))
        }
      } catch {
        // ignore malformed client messages
      }
    })

    ws.on('close', () => {
      log.info(`Dashboard client disconnected (total: ${wss!.clients.size})`)
    })
  })

  server.listen(config.server.wsPort, () => {
    const mode = dashDir ? 'HTTP + WS' : 'WS-only'
    log.info(`Broadcaster listening on :${config.server.wsPort} (${mode})`)
  })

  onAlert((alert: OptionsAlert) => {
    pushAlert(alert)
    broadcast({ type: 'alert', data: alert })
    if (orchestratorHandler) {
      Promise.resolve(orchestratorHandler(alert)).catch(err => {
        log.error('Orchestrator dispatch error:', err)
      })
    }
  })

  setInterval(() => {
    broadcast({
      type: 'snapshot',
      data: getAllSnapshots(),
    })
  }, 2000)

  setInterval(() => {
    broadcast({
      type: 'account',
      data: getAccountContext(),
    })
    broadcast({
      type: 'status',
      data: buildStatus(),
    })
  }, 30_000)
}

function buildStatus() {
  return {
    connected: true,
    symbolCount: getAllSnapshots().length,
    uptime: Date.now() - startTime,
    env: config.tastytrade.env,
    isDelayed: config.tastytrade.env === 'sandbox',
  }
}

function broadcast(msg: WsMessage): void {
  if (!wss) return
  const payload = JSON.stringify(msg)
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload)
    }
  }
}

function broadcastRaw(payload: string): void {
  if (!wss) return
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload)
    }
  }
}

function send(ws: WebSocket, msg: WsMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

async function handleChainRequest(ws: WebSocket, ticker: string): Promise<void> {
  const entry = getEntryByTicker(ticker)
  const instrumentType = entry?.instrumentType ?? 'equity'

  if (instrumentType === 'crypto') {
    send(ws, {
      type: 'optionChain',
      data: { ticker, expirations: [], instrumentType: 'crypto' },
    })
    return
  }

  try {
    const expirations = await fetchOptionChain(ticker, 3)
    send(ws, {
      type: 'optionChain',
      data: { ticker, expirations, instrumentType: 'equity' },
    })
  } catch (err) {
    log.warn(`Chain request failed for ${ticker}:`, err)
    send(ws, {
      type: 'optionChain',
      data: { ticker, expirations: [], instrumentType: 'equity' },
    })
  }
}
