import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve, extname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, WebSocket } from 'ws'
import type { OptionsAlert, AgentAnalysis, AgentStatus, WsMessage, AnalysisReport } from '@tastytrade-monitor/shared'
import { getAllSnapshots } from './state.js'
import { getAccountContext } from './account.js'
import { onAlert } from './alertBus.js'
import { fetchOptionChain } from './chainFetcher.js'
import { getEntryByTicker } from './watchlist.config.js'
import { config } from './config.js'
import { log } from './logger.js'
import { isEncryptionEnabled, encrypt, maskApiKey } from './crypto.js'
import { login, register, verifyToken } from './auth.js'
import {
  getAgentConfig, upsertAgentConfig, findUserById, upsertScheduleConfig, getScheduleConfig, getReportsForDate,
  appendAlertLogForAllUsers, getRecentAlerts, appendAnalysisLogForAllUsers, getRecentAnalyses,
  getChatHistory,
} from './db.js'
import type { JwtPayload } from './auth.js'
import { handleOAuthRoute, getEnabledOAuthProviders } from './oauth.js'
import { getUserWatchlistsWithItems, saveWatchlist, removeWatchlistItem, syncFromTastytrade, searchSymbols, createWatchlist, deleteWatchlist, renameWatchlist } from './watchlistService.js'
import { getBudgetStatus } from './budgetTracker.js'
import { handleChatMessage, clearChatHistory } from './chatHandler.js'
import { runScheduledAnalysis } from './scheduledAnalysis.js'

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

export function broadcastToAll(msg: WsMessage | Record<string, unknown>): void {
  const typed = msg as Record<string, unknown>
  if (typed.type === 'agent_analysis' && typed.data) {
    const analysis = typed.data as AgentAnalysis
    pushAnalysis(analysis)
    if (isMultiTenant()) {
      try {
        const analysisId = (analysis as Record<string, unknown>).id as string ?? `analysis-${Date.now()}`
        appendAnalysisLogForAllUsers(analysisId, JSON.stringify(analysis))
      } catch (err) {
        log.warn(`Failed to persist analysis: ${(err as Error).message}`)
      }
    }
  }
  if (typed.type === 'agent_status' && typed.data) {
    agentStatus = typed.data as AgentStatus
  }
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

function resolvedFileUnderDashboardRoot(dashDir: string, urlPath: string): string {
  const root = resolve(dashDir)
  const relativePath = urlPath === '/' ? 'index.html' : urlPath.replace(/^[/\\]+/, '')
  const candidate = resolve(root, relativePath)
  const prefix = root.endsWith(sep) ? root : root + sep
  if (candidate !== root && !candidate.startsWith(prefix)) {
    return join(root, 'index.html')
  }
  return candidate
}

function serveStatic(req: IncomingMessage, res: ServerResponse, dashDir: string): void {
  const url = req.url ?? '/'
  const safePath = url.split('?')[0].replace(/\.\./g, '')
  let filePath = resolvedFileUnderDashboardRoot(dashDir, safePath === '' ? '/' : safePath)

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    filePath = join(resolve(dashDir), 'index.html')
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
        const msg = JSON.parse(String(raw)) as Record<string, unknown>
        const type = msg.type

        if (type === 'auth' || type === 'auth_token') {
          void handleAuth(ws, msg)
          return
        }

        if (!isAuthenticated(ws)) return

        routeAuthenticatedWsMessage(ws, msg, String(raw))
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
    if (isMultiTenant()) {
      try {
        const alertId = (alert as Record<string, unknown>).id as string ?? `alert-${Date.now()}`
        appendAlertLogForAllUsers(alertId, JSON.stringify(alert))
      } catch (err) {
        log.warn(`Failed to persist alert: ${(err as Error).message}`)
      }
    }
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

function broadcast(msg: WsMessage | Record<string, unknown>): void {
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

function send(ws: WebSocket, msg: WsMessage | Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

function sendFullState(ws: WebSocket): void {
  send(ws, { type: 'snapshot', data: getAllSnapshots() })
  send(ws, { type: 'account', data: getAccountContext() })
  if (agentStatus) send(ws, { type: 'agent_status', data: agentStatus })

  if (isMultiTenant()) {
    sendPerUserState(ws)
  } else {
    if (recentAlerts.length > 0) send(ws, { type: 'alert_history', data: recentAlerts })
    if (recentAnalyses.length > 0) send(ws, { type: 'analysis_history', data: recentAnalyses })
  }
}

function sendPerUserState(ws: WebSocket): void {
  const auth = clientAuth.get(ws)
  if (!auth) return

  try {
    const alertPayloads = getRecentAlerts(auth.userId)
    if (alertPayloads.length > 0) {
      const alerts = alertPayloads.map(p => JSON.parse(p))
      send(ws, { type: 'alert_history', data: alerts })
    }

    const analysisPayloads = getRecentAnalyses(auth.userId)
    if (analysisPayloads.length > 0) {
      const analyses = analysisPayloads.map(p => JSON.parse(p))
      send(ws, { type: 'analysis_history', data: analyses })
    }

    const chatRows = getChatHistory(auth.userId)
    if (chatRows.length > 0) {
      const messages = chatRows.map(r => ({
        id: `db-${r.id}`,
        role: r.role,
        content: r.content,
        timestamp: r.created_at,
      }))
      send(ws, { type: 'chat_history', data: messages })
    }

    handleRequestAgentConfig(ws)
    handleRequestWatchlist(ws)
    handleRequestScheduleConfig(ws)
    handleRequestBudgetStatus(ws)
    handleRequestReports(ws, undefined)
  } catch (err) {
    log.warn(`Failed to send per-user state for ${auth.email}: ${(err as Error).message}`)
  }
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

// ─── Watchlist handlers ─────────────────────────────────────────

function handleRequestWatchlist(ws: WebSocket): void {
  const auth = clientAuth.get(ws)
  if (!auth) return
  const data = getUserWatchlistsWithItems(auth.userId)
  send(ws, { type: 'watchlist_data', data } as WsMessage)
}

function handleSaveWatchlist(ws: WebSocket, data: Record<string, unknown>): void {
  const auth = clientAuth.get(ws)
  if (!auth) return
  try {
    const name = String(data.name ?? 'Default')
    const items = (data.items ?? []) as Array<Record<string, unknown>>
    saveWatchlist(auth.userId, name, items.map((item, idx) => ({
      ticker: String(item.ticker ?? ''),
      layer: item.layer != null ? String(item.layer) : null,
      strategies: Array.isArray(item.strategies) ? item.strategies.map(String) : [],
      thesis: String(item.thesis ?? ''),
      instrumentType: (String(item.instrumentType ?? 'equity')) as 'equity' | 'crypto',
      sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : idx,
    })))
    handleRequestWatchlist(ws)
    log.info(`Watchlist saved for ${auth.email}`)
  } catch (err) {
    log.error(`Failed to save watchlist: ${(err as Error).message}`)
  }
}

function handleDeleteWatchlistItem(ws: WebSocket, data: Record<string, unknown>): void {
  const auth = clientAuth.get(ws)
  if (!auth) return
  removeWatchlistItem(auth.userId, String(data.watchlistName ?? 'Default'), String(data.ticker ?? ''))
  handleRequestWatchlist(ws)
}

function handleCreateWatchlist(ws: WebSocket, data: Record<string, unknown>): void {
  const auth = clientAuth.get(ws)
  if (!auth) return
  const name = String(data.name ?? '')
  if (!name) return
  createWatchlist(auth.userId, name)
  handleRequestWatchlist(ws)
  log.info(`Watchlist "${name}" created for ${auth.email}`)
}

function handleDeleteWatchlist(ws: WebSocket, data: Record<string, unknown>): void {
  const auth = clientAuth.get(ws)
  if (!auth) return
  const name = String(data.name ?? '')
  if (!name) return
  deleteWatchlist(auth.userId, name)
  handleRequestWatchlist(ws)
  log.info(`Watchlist "${name}" deleted for ${auth.email}`)
}

function handleRenameWatchlist(ws: WebSocket, data: Record<string, unknown>): void {
  const auth = clientAuth.get(ws)
  if (!auth) return
  const oldName = String(data.oldName ?? '')
  const newName = String(data.newName ?? '')
  if (!oldName || !newName) return
  renameWatchlist(auth.userId, oldName, newName)
  handleRequestWatchlist(ws)
  log.info(`Watchlist renamed "${oldName}" → "${newName}" for ${auth.email}`)
}

async function handleSyncTastytradeWatchlists(ws: WebSocket): Promise<void> {
  const auth = clientAuth.get(ws)
  if (!auth) return
  const data = await syncFromTastytrade(auth.userId)
  send(ws, { type: 'watchlist_data', data } as WsMessage)
}

async function handleSearchSymbols(ws: WebSocket, query: string): Promise<void> {
  const results = await searchSymbols(query)
  send(ws, { type: 'search_results', data: results } as WsMessage)
}

// ─── Chat handlers ──────────────────────────────────────────────

async function handleChatSend(ws: WebSocket, message: string): Promise<void> {
  const auth = clientAuth.get(ws)
  if (!auth) return

  send(ws, {
    type: 'chat_message',
    data: { id: `user-${Date.now()}`, role: 'user', content: message, timestamp: new Date().toISOString() },
  } as WsMessage)

  const response = await handleChatMessage(auth.userId, message)
  if (response) {
    send(ws, { type: 'chat_message', data: response } as WsMessage)
  }
}

function handleChatClear(ws: WebSocket): void {
  const auth = clientAuth.get(ws)
  if (!auth) return
  clearChatHistory(auth.userId)
  send(ws, { type: 'chat_history', data: [] } as WsMessage)
}

// ─── Schedule / Budget / Report handlers ─────────────────────────

function handleSaveScheduleConfig(ws: WebSocket, data: Record<string, unknown>): void {
  const auth = clientAuth.get(ws)
  if (!auth) return
  try {
    upsertScheduleConfig(auth.userId, {
      runs_per_day: typeof data.runsPerDay === 'number' ? data.runsPerDay : undefined,
      run_times_ct: Array.isArray(data.runTimesCt) ? JSON.stringify(data.runTimesCt) : undefined,
      daily_budget_usd: typeof data.dailyBudgetUsd === 'number' ? data.dailyBudgetUsd : undefined,
      per_run_budget_usd: typeof data.perRunBudgetUsd === 'number' ? data.perRunBudgetUsd : undefined,
      include_chains: typeof data.includeChains === 'boolean' ? (data.includeChains ? 1 : 0) : undefined,
      max_tickers_per_run: typeof data.maxTickersPerRun === 'number' ? data.maxTickersPerRun : undefined,
      enabled: typeof data.enabled === 'boolean' ? (data.enabled ? 1 : 0) : undefined,
    })
    handleRequestScheduleConfig(ws)
    handleRequestBudgetStatus(ws)
    log.info(`Schedule config saved for ${auth.email}`)
  } catch (err) {
    log.error(`Failed to save schedule config: ${(err as Error).message}`)
  }
}

function handleRequestScheduleConfig(ws: WebSocket): void {
  const auth = clientAuth.get(ws)
  if (!auth) return
  const row = getScheduleConfig(auth.userId)
  const runTimes = row ? JSON.parse(row.run_times_ct) : ['09:45', '11:30', '13:30', '15:00']
  send(ws, {
    type: 'schedule_config',
    data: {
      runsPerDay: row?.runs_per_day ?? 4,
      runTimesCt: runTimes,
      dailyBudgetUsd: row?.daily_budget_usd ?? 2.0,
      perRunBudgetUsd: row?.per_run_budget_usd ?? 0.5,
      includeChains: (row?.include_chains ?? 1) === 1,
      maxTickersPerRun: row?.max_tickers_per_run ?? 10,
      enabled: (row?.enabled ?? 1) === 1,
      updatedAt: row?.updated_at,
    },
  } as WsMessage)
}

function handleRequestBudgetStatus(ws: WebSocket): void {
  const auth = clientAuth.get(ws)
  if (!auth) return
  send(ws, { type: 'budget_status', data: getBudgetStatus(auth.userId) } as WsMessage)
}

function handleRequestReports(ws: WebSocket, data?: Record<string, unknown>): void {
  const auth = clientAuth.get(ws)
  if (!auth) return
  const date = typeof data?.date === 'string' ? data.date : undefined
  const rows = getReportsForDate(auth.userId, date)
  const reports = rows.map(r => ({
    id: r.id,
    runTime: r.run_time,
    runType: r.run_type,
    tickers: JSON.parse(r.tickers),
    report: r.report,
    costUsd: r.cost_usd,
    model: r.model,
    createdAt: r.created_at,
  }))
  send(ws, { type: 'reports_data', data: reports } as WsMessage)
}

async function handleRunAnalysisNow(ws: WebSocket): Promise<void> {
  const auth = clientAuth.get(ws)
  if (!auth) return

  const agentCfg = getAgentConfig(auth.userId)
  if (!agentCfg || agentCfg.provider === 'none') {
    log.warn(`Manual analysis skipped for ${auth.email}: no agent configured`)
    return
  }

  const report = await runScheduledAnalysis(auth.userId, agentCfg, 'manual')
  if (report) {
    send(ws, { type: 'new_report', data: report } as WsMessage)
    handleRequestBudgetStatus(ws)
  }
}

export function broadcastNewReport(report: AnalysisReport): void {
  broadcast({ type: 'new_report', data: report } as WsMessage)
}

// ─── Paper trading handlers ─────────────────────────────────────

async function handleRequestPaperState(ws: WebSocket): Promise<void> {
  const auth = clientAuth.get(ws)
  if (!auth) return
  try {
    const { getOrCreateAccount, getOpenPositions, getRecentOrders } = await import('@tastytrade-monitor/paper-trader')
    const account = getOrCreateAccount(auth.userId)
    const positions = getOpenPositions(auth.userId)
    const orders = getRecentOrders(auth.userId)
    send(ws, { type: 'paper_account', data: account } as WsMessage)
    send(ws, { type: 'paper_positions', data: positions } as WsMessage)
    send(ws, { type: 'paper_orders', data: orders } as WsMessage)
  } catch (err) {
    log.warn(`Paper state request failed: ${(err as Error).message}`)
  }
}

async function handlePaperConfigure(ws: WebSocket, data: Record<string, unknown>): Promise<void> {
  const auth = clientAuth.get(ws)
  if (!auth) return
  try {
    const { getOrCreateAccount, updateAccountConfig } = await import('@tastytrade-monitor/paper-trader')
    getOrCreateAccount(auth.userId)
    updateAccountConfig(
      auth.userId,
      data.enabled !== false,
      typeof data.startingBalance === 'number' ? data.startingBalance : undefined,
      typeof data.useAITrader === 'boolean' ? data.useAITrader : undefined,
    )
    const account = getOrCreateAccount(auth.userId)
    send(ws, { type: 'paper_account', data: account } as WsMessage)
  } catch (err) {
    log.warn(`Paper configure failed: ${(err as Error).message}`)
  }
}

async function handlePaperClosePosition(ws: WebSocket, positionId: string): Promise<void> {
  const auth = clientAuth.get(ws)
  if (!auth) return
  try {
    const { closePositionManual } = await import('@tastytrade-monitor/paper-trader')
    closePositionManual(auth.userId, positionId)
  } catch (err) {
    log.warn(`Paper close position failed: ${(err as Error).message}`)
  }
}

async function handlePaperReset(ws: WebSocket): Promise<void> {
  const auth = clientAuth.get(ws)
  if (!auth) return
  try {
    const { resetAccountInDb, getOrCreateAccount } = await import('@tastytrade-monitor/paper-trader')
    resetAccountInDb(auth.userId)
    const account = getOrCreateAccount(auth.userId)
    send(ws, { type: 'paper_account', data: account } as WsMessage)
    send(ws, { type: 'paper_positions', data: [] } as WsMessage)
    send(ws, { type: 'paper_orders', data: [] } as WsMessage)
  } catch (err) {
    log.warn(`Paper reset failed: ${(err as Error).message}`)
  }
}

// ─── Chain request handler ──────────────────────────────────────

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

// ─── Authenticated client message router ─────────────────────────

type WsClientJson = Record<string, unknown>

type AuthenticatedWsRoute = (ws: WebSocket, msg: WsClientJson, raw: string) => void | Promise<void>

function routeAuthenticatedWsMessage(ws: WebSocket, msg: WsClientJson, raw: string): void {
  const type = msg.type
  if (typeof type !== 'string') return
  const handler = authenticatedWsRoutes[type]
  if (!handler) return
  void Promise.resolve(handler(ws, msg, raw)).catch(err => {
    log.warn(`WS handler error [${type}]: ${(err as Error).message}`)
  })
}

const authenticatedWsRoutes: Record<string, AuthenticatedWsRoute> = {
  requestChain(ws, msg) {
    if (typeof msg.ticker !== 'string') return
    void handleChainRequest(ws, msg.ticker)
  },

  save_agent_config(ws, msg) {
    const cfg = msg.config
    if (cfg && typeof cfg === 'object' && !Array.isArray(cfg)) {
      handleSaveAgentConfig(ws, cfg as Record<string, unknown>)
    }
  },

  request_agent_config(ws) {
    handleRequestAgentConfig(ws)
  },

  agent_analysis(ws, msg, raw) {
    const data = msg.data
    if (!data || typeof data !== 'object') return
    const d = data as Record<string, unknown>
    log.info(`Agent analysis received for ${d.ticker ?? 'unknown'} (model: ${d.model ?? 'unknown'})`)
    const analysis = data as unknown as AgentAnalysis
    pushAnalysis(analysis)
    if (isMultiTenant()) {
      try {
        const analysisId = d.id as string ?? `analysis-${Date.now()}`
        appendAnalysisLogForAllUsers(analysisId, JSON.stringify(analysis))
      } catch (err) {
        log.warn(`Failed to persist analysis: ${(err as Error).message}`)
      }
    }
    broadcastRaw(raw)
  },

  alert(ws, msg) {
    const data = msg.data
    if (!data || typeof data !== 'object') return
    const payload = data as unknown as OptionsAlert
    log.info(`Injected test alert for ${payload.trigger?.ticker ?? 'unknown'}`)
    pushAlert(payload)
    broadcast({ type: 'alert', data: payload })
    if (isMultiTenant()) {
      try {
        const alertId = (data as Record<string, unknown>).id as string ?? `alert-${Date.now()}`
        appendAlertLogForAllUsers(alertId, JSON.stringify(payload))
      } catch (err) {
        log.warn(`Failed to persist alert: ${(err as Error).message}`)
      }
    }
    if (orchestratorHandler) {
      Promise.resolve(orchestratorHandler(payload)).catch(err => {
        log.error('Orchestrator dispatch error:', err)
      })
    }
  },

  agent_status(ws, msg, raw) {
    const data = msg.data
    if (!data || typeof data !== 'object') return
    agentStatus = data as unknown as AgentStatus
    broadcastRaw(raw)
  },

  request_watchlist(ws) {
    handleRequestWatchlist(ws)
  },

  save_watchlist(ws, msg) {
    const data = msg.data
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      handleSaveWatchlist(ws, data as Record<string, unknown>)
    }
  },

  delete_watchlist_item(ws, msg) {
    const data = msg.data
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      handleDeleteWatchlistItem(ws, data as Record<string, unknown>)
    }
  },

  create_watchlist(ws, msg) {
    const data = msg.data
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      handleCreateWatchlist(ws, data as Record<string, unknown>)
    }
  },

  delete_watchlist(ws, msg) {
    const data = msg.data
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      handleDeleteWatchlist(ws, data as Record<string, unknown>)
    }
  },

  rename_watchlist(ws, msg) {
    const data = msg.data
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      handleRenameWatchlist(ws, data as Record<string, unknown>)
    }
  },

  sync_tastytrade_watchlists(ws) {
    void handleSyncTastytradeWatchlists(ws)
  },

  search_symbols(ws, msg) {
    if (typeof msg.query === 'string') void handleSearchSymbols(ws, msg.query)
  },

  async chat_send(ws, msg) {
    const data = msg.data
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const m = (data as Record<string, unknown>).message
      if (typeof m === 'string') await handleChatSend(ws, m)
    }
  },

  chat_clear(ws) {
    handleChatClear(ws)
  },

  save_schedule_config(ws, msg) {
    const data = msg.data
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      handleSaveScheduleConfig(ws, data as Record<string, unknown>)
    }
  },

  request_schedule_config(ws) {
    handleRequestScheduleConfig(ws)
  },

  request_budget_status(ws) {
    handleRequestBudgetStatus(ws)
  },

  request_reports(ws, msg) {
    const data = msg.data
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      handleRequestReports(ws, data as Record<string, unknown>)
    } else {
      handleRequestReports(ws, undefined)
    }
  },

  run_analysis_now(ws) {
    void handleRunAnalysisNow(ws)
  },

  request_paper_state(ws) {
    void handleRequestPaperState(ws)
  },

  paper_configure(ws, msg) {
    const data = msg.data
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      void handlePaperConfigure(ws, data as Record<string, unknown>)
    }
  },

  paper_close_position(ws, msg) {
    const data = msg.data
    if (data && typeof data === 'object') {
      const positionId = (data as Record<string, unknown>).positionId
      if (typeof positionId === 'string') void handlePaperClosePosition(ws, positionId)
    }
  },

  paper_reset(ws) {
    void handlePaperReset(ws)
  },
}
