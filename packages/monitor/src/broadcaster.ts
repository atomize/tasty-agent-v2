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
import { isEncryptionEnabled, encrypt, maskApiKey } from './crypto.js'
import { login, register, verifyToken } from './auth.js'
import { getAgentConfig, upsertAgentConfig, findUserById } from './db.js'
import type { JwtPayload } from './auth.js'
import { handleOAuthRoute, getEnabledOAuthProviders } from './oauth.js'

let wss: WebSocketServer | null = null
const startTime = Date.now()

const MAX_ALERTS = 200
const MAX_ANALYSES = 50
const recentAlerts: OptionsAlert[] = []
const recentAnalyses: AgentAnalysis[] = []
let agentStatus: AgentStatus | null = null

type OrchestratorHandler = (alert: OptionsAlert) => Promise<void> | void
let orchestratorHandler: OrchestratorHandler | null = null

interface ClientAuth {
  userId: number
  email: string
}
const clientAuth = new WeakMap<WebSocket, ClientAuth>()

function isMultiTenant(): boolean {
  return isEncryptionEnabled()
}

function isAuthenticated(ws: WebSocket): boolean {
  return !isMultiTenant() || clientAuth.has(ws)
}

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

  const server = createServer(async (req, res) => {
    if (await handleOAuthRoute(req, res)) return
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

    send(ws, { type: 'status', data: buildStatus() })

    if (!isMultiTenant()) {
      sendFullState(ws)
    }

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw))

        if (msg.type === 'auth' || msg.type === 'auth_token') {
          handleAuth(ws, msg)
          return
        }

        if (!isAuthenticated(ws)) return

        if (msg.type === 'requestChain' && typeof msg.ticker === 'string') {
          handleChainRequest(ws, msg.ticker)
        } else if (msg.type === 'save_agent_config' && msg.config) {
          handleSaveAgentConfig(ws, msg.config)
        } else if (msg.type === 'request_agent_config') {
          handleRequestAgentConfig(ws)
        } else if (msg.type === 'agent_analysis' && msg.data) {
          log.info(`Agent analysis received for ${msg.data.ticker ?? 'unknown'} (model: ${msg.data.model ?? 'unknown'})`)
          pushAnalysis(msg.data as AgentAnalysis)
          broadcastRaw(String(raw))
        } else if (msg.type === 'alert' && msg.data) {
          const alert = msg.data as OptionsAlert
          log.info(`Injected test alert for ${alert.trigger?.ticker ?? 'unknown'}`)
          pushAlert(alert)
          broadcast({ type: 'alert', data: alert })
          if (orchestratorHandler) {
            Promise.resolve(orchestratorHandler(alert)).catch(err => {
              log.error('Orchestrator dispatch error:', err)
            })
          }
        } else if (msg.type === 'agent_status' && msg.data) {
          agentStatus = msg.data as AgentStatus
          broadcastRaw(String(raw))
        }
      } catch (err) {
        log.warn(`WS message error: ${(err as Error).message}`)
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
    multiTenant: isMultiTenant(),
    oauthProviders: getEnabledOAuthProviders(),
  }
}

function broadcast(msg: WsMessage): void {
  if (!wss) return
  const payload = JSON.stringify(msg)
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && isAuthenticated(client)) {
      client.send(payload)
    }
  }
}

function broadcastRaw(payload: string): void {
  if (!wss) return
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && isAuthenticated(client)) {
      client.send(payload)
    }
  }
}

function send(ws: WebSocket, msg: WsMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

function sendFullState(ws: WebSocket): void {
  send(ws, { type: 'snapshot', data: getAllSnapshots() })
  send(ws, { type: 'account', data: getAccountContext() })
  if (recentAlerts.length > 0) send(ws, { type: 'alert_history', data: recentAlerts })
  if (recentAnalyses.length > 0) send(ws, { type: 'analysis_history', data: recentAnalyses })
  if (agentStatus) send(ws, { type: 'agent_status', data: agentStatus })
}

async function handleAuth(ws: WebSocket, msg: Record<string, unknown>): Promise<void> {
  if (!isMultiTenant()) return

  try {
    if (msg.type === 'auth_token' && typeof msg.token === 'string') {
      const payload = verifyToken(msg.token) as JwtPayload | null
      if (payload) {
        let userId = payload.userId
        const existing = findUserById(userId)
        if (!existing) {
          log.info(`Token auth: user ${payload.email} (id=${userId}) not in DB, re-creating`)
          const { findOrCreateOAuthUser } = await import('./db.js')
          const user = findOrCreateOAuthUser('token-migration', String(userId), payload.email)
          userId = user.id
        }
        clientAuth.set(ws, { userId, email: payload.email })
        send(ws, { type: 'auth_result', data: { success: true, user: { id: userId, email: payload.email } } } as WsMessage)
        sendFullState(ws)
        log.info(`Token auth: ${payload.email} (userId=${userId})`)
      } else {
        send(ws, { type: 'auth_result', data: { success: false, error: 'Invalid or expired token' } } as WsMessage)
      }
      return
    }

    if (msg.type === 'auth' && typeof msg.email === 'string' && typeof msg.password === 'string') {
      const action = msg.action as string
      const result = action === 'register'
        ? await register(msg.email, msg.password)
        : await login(msg.email, msg.password)

      clientAuth.set(ws, { userId: result.user.id, email: result.user.email })
      send(ws, { type: 'auth_result', data: { success: true, token: result.token, user: result.user } } as WsMessage)
      sendFullState(ws)
      log.info(`${action === 'register' ? 'Registered' : 'Logged in'}: ${result.user.email}`)
      return
    }
  } catch (err) {
    const message = (err as Error).message ?? 'Authentication failed'
    send(ws, { type: 'auth_result', data: { success: false, error: message } } as WsMessage)
  }
}

function handleSaveAgentConfig(ws: WebSocket, cfg: Record<string, unknown>): void {
  const auth = clientAuth.get(ws)
  if (!auth) return

  try {
    const provider = String(cfg.provider ?? 'none')
    const model = String(cfg.model ?? 'claude-sonnet-4-20250514')
    const maxBudget = Number(cfg.maxBudgetUsd ?? 0.5)
    const externalUrl = cfg.externalUrl ? String(cfg.externalUrl) : null

    let encryptedKey: string | null | undefined
    if (cfg.apiKey && typeof cfg.apiKey === 'string' && cfg.apiKey.length > 0) {
      encryptedKey = encrypt(cfg.apiKey)
    } else {
      encryptedKey = undefined
    }

    const row = upsertAgentConfig(auth.userId, provider, encryptedKey, model, maxBudget, externalUrl)
    const keyStatus = encryptedKey !== undefined ? 'new API key set' : 'key unchanged'
    log.info(`Agent config saved for ${auth.email} (provider: ${provider}, ${keyStatus}, row user_id=${row.user_id})`)

    handleRequestAgentConfig(ws)
  } catch (err) {
    log.error(`Failed to save agent config for ${auth.email}: ${(err as Error).message}`)
    send(ws, { type: 'agent_config_error', data: { error: 'Failed to save configuration' } } as unknown as WsMessage)
  }
}

function handleRequestAgentConfig(ws: WebSocket): void {
  const auth = clientAuth.get(ws)
  if (!auth) return

  const row = getAgentConfig(auth.userId)
  if (row) {
    send(ws, {
      type: 'agent_config',
      data: {
        provider: row.provider,
        maskedApiKey: row.encrypted_api_key ? maskApiKey('****configured****') : null,
        model: row.model,
        maxBudgetUsd: row.max_budget_usd,
        externalUrl: row.external_url,
      },
    } as WsMessage)
  } else {
    send(ws, { type: 'agent_config', data: { provider: 'none', maskedApiKey: null, model: 'claude-sonnet-4-20250514', maxBudgetUsd: 0.5, externalUrl: null } } as WsMessage)
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
