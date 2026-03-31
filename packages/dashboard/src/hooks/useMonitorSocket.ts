import { useState, useEffect, useRef, useCallback } from 'react'
import type {
  TickerSnapshot, OptionsAlert, AccountContext, OptionChainResponse,
  AgentAnalysis, AgentStatus, AgentConfigResponse,
  Watchlist, ChatMessage, ScheduleConfigResponse, BudgetStatus, AnalysisReport,
  WatchlistItem, ScheduleConfig, WatchlistProposal,
  PaperAccount, PaperPosition, PaperOrder,
} from '@tastytrade-monitor/shared'

export interface AuthUser {
  id: number
  email: string
}

export interface MonitorState {
  connected: boolean
  snapshots: TickerSnapshot[]
  alerts: OptionsAlert[]
  analyses: AgentAnalysis[]
  account: AccountContext
  uptime: number
  env: 'sandbox' | 'production'
  isDelayed: boolean
  multiTenant: boolean
  oauthProviders: string[]
  optionChain: OptionChainResponse | null
  agentStatus: AgentStatus | null
  agentConfig: AgentConfigResponse | null
  authUser: AuthUser | null
  authError: string | null
  watchlists: Watchlist[]
  chatMessages: ChatMessage[]
  scheduleConfig: ScheduleConfigResponse | null
  budgetStatus: BudgetStatus | null
  reports: AnalysisReport[]
  requestChain: (ticker: string) => void
  sendRaw: (msg: unknown) => void
  login: (email: string, password: string) => void
  register: (email: string, password: string) => void
  logout: () => void
  saveAgentConfig: (config: { provider: string; apiKey?: string; model?: string; maxBudgetUsd?: number; externalUrl?: string }) => void
  requestAgentConfig: () => void
  sendTestAlert: (ticker: string) => void
  requestWatchlist: () => void
  saveWatchlist: (name: string, items: WatchlistItem[]) => void
  deleteWatchlistItem: (watchlistName: string, ticker: string) => void
  createWatchlist: (name: string) => void
  deleteWatchlist: (name: string) => void
  renameWatchlist: (oldName: string, newName: string) => void
  syncTastytradeWatchlists: () => void
  searchSymbols: (query: string) => void
  sendChatMessage: (message: string, context?: 'general' | 'watchlist_builder', activeWatchlist?: string) => void
  clearChat: () => void
  watchlistProposal: WatchlistProposal | null
  clearProposal: () => void
  saveScheduleConfig: (config: Partial<ScheduleConfig>) => void
  requestScheduleConfig: () => void
  requestBudgetStatus: () => void
  requestReports: (date?: string) => void
  runAnalysisNow: () => void
  searchResults: { ticker: string; description: string; instrumentType: string }[]
  paperAccount: PaperAccount | null
  paperPositions: PaperPosition[]
  paperOrders: PaperOrder[]
  requestPaperState: () => void
  paperConfigure: (config: { enabled: boolean; startingBalance?: number; useAITrader?: boolean }) => void
  paperClosePosition: (positionId: string) => void
  paperReset: () => void
}

function getWsUrl(): string {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return `${proto}//${window.location.hostname}:3001`
  }
  return `${proto}//${window.location.host}`
}

const WS_URL = getWsUrl()
const MAX_ALERTS = 200
const MAX_ANALYSES = 50
const TOKEN_KEY = 'monitor_jwt'

export function useMonitorSocket(): MonitorState {
  const [connected, setConnected] = useState(false)
  const [snapshots, setSnapshots] = useState<TickerSnapshot[]>([])
  const [alerts, setAlerts] = useState<OptionsAlert[]>([])
  const [analyses, setAnalyses] = useState<AgentAnalysis[]>([])
  const [account, setAccount] = useState<AccountContext>({
    netLiq: 0,
    buyingPower: 0,
    openPositions: [],
  })
  const [uptime, setUptime] = useState(0)
  const [env, setEnv] = useState<'sandbox' | 'production'>('sandbox')
  const [isDelayed, setIsDelayed] = useState(true)
  const [multiTenant, setMultiTenant] = useState(false)
  const [oauthProviders, setOauthProviders] = useState<string[]>([])
  const [optionChain, setOptionChain] = useState<OptionChainResponse | null>(null)
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null)
  const [agentConfig, setAgentConfig] = useState<AgentConfigResponse | null>(null)
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  const [watchlists, setWatchlists] = useState<Watchlist[]>([])
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [scheduleConfig, setScheduleConfig] = useState<ScheduleConfigResponse | null>(null)
  const [budgetStatus, setBudgetStatus] = useState<BudgetStatus | null>(null)
  const [reports, setReports] = useState<AnalysisReport[]>([])
  const [searchResults, setSearchResults] = useState<{ ticker: string; description: string; instrumentType: string }[]>([])
  const [paperAccount, setPaperAccount] = useState<PaperAccount | null>(null)
  const [paperPositions, setPaperPositions] = useState<PaperPosition[]>([])
  const [paperOrders, setPaperOrders] = useState<PaperOrder[]>([])
  const [watchlistProposal, setWatchlistProposal] = useState<WatchlistProposal | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const requestChain = useCallback((ticker: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'requestChain', ticker }))
    }
  }, [])

  const sendRaw = useCallback((msg: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  const loginFn = useCallback((email: string, password: string) => {
    setAuthError(null)
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'auth', action: 'login', email, password }))
    }
  }, [])

  const registerFn = useCallback((email: string, password: string) => {
    setAuthError(null)
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'auth', action: 'register', email, password }))
    }
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    setAuthUser(null)
    setAgentConfig(null)
    setAuthError(null)
  }, [])

  const saveAgentConfig = useCallback((config: { provider: string; apiKey?: string; model?: string; maxBudgetUsd?: number; externalUrl?: string }) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'save_agent_config', config }))
    }
  }, [])

  const requestAgentConfig = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'request_agent_config' }))
    }
  }, [])

  const sendTestAlert = useCallback((ticker: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'alert',
        data: {
          id: `test-${Date.now()}`,
          timestamp: new Date().toISOString(),
          version: '1.0',
          trigger: { type: 'IV_SPIKE', ticker, description: `IV spiked 12% in 5 min (test alert)`, threshold: 10, observed: 12 },
          severity: 'high',
          strategies: ['supply_chain'],
          supplyChainLayer: 'Layer 1 – GPU / Accelerator',
          marketSnapshot: [{ ticker, price: 120, iv: 45, ivRank: 72, isDelayed: false, lastUpdated: new Date().toISOString() }],
          optionChain: [{ expiration: '2026-04-17', daysToExpiry: 25, strikes: [{ strike: 120, callBid: 4.5, callAsk: 4.65, callDelta: 0.50, callIV: 0.44, putBid: 4.4, putAsk: 4.55, putDelta: -0.50, putIV: 0.45 }] }],
          account: { netLiq: 50000, buyingPower: 25000, openPositions: [] },
          agentContext: `## OPTIONS ALERT — IV_SPIKE on ${ticker}\n**Test alert** fired manually from dashboard.\nPrice ~$120, IV Rank 72, IV 45%.\nATM Apr 120C: $4.50/$4.65, delta 0.50\nATM Apr 120P: $4.40/$4.55, delta -0.50`,
        },
      }))
    }
  }, [])

  const requestWatchlist = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'request_watchlist' }))
    }
  }, [])

  const saveWatchlist = useCallback((name: string, items: WatchlistItem[]) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'save_watchlist', data: { name, items } }))
    }
  }, [])

  const deleteWatchlistItem = useCallback((watchlistName: string, ticker: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'delete_watchlist_item', data: { watchlistName, ticker } }))
    }
  }, [])

  const createWatchlistFn = useCallback((name: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'create_watchlist', data: { name } }))
    }
  }, [])

  const deleteWatchlistFn = useCallback((name: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'delete_watchlist', data: { name } }))
    }
  }, [])

  const renameWatchlistFn = useCallback((oldName: string, newName: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'rename_watchlist', data: { oldName, newName } }))
    }
  }, [])

  const syncTastytradeWatchlists = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'sync_tastytrade_watchlists' }))
    }
  }, [])

  const searchSymbolsFn = useCallback((query: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'search_symbols', query }))
    }
  }, [])

  const sendChatMessage = useCallback((message: string, context?: 'general' | 'watchlist_builder', activeWatchlist?: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'chat_send', data: { message, context, activeWatchlist } }))
    }
  }, [])

  const clearChat = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'chat_clear' }))
      setChatMessages([])
      setWatchlistProposal(null)
    }
  }, [])

  const clearProposal = useCallback(() => {
    setWatchlistProposal(null)
  }, [])

  const saveScheduleConfig = useCallback((cfg: Partial<ScheduleConfig>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'save_schedule_config', data: cfg }))
    }
  }, [])

  const requestScheduleConfig = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'request_schedule_config' }))
    }
  }, [])

  const requestBudgetStatus = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'request_budget_status' }))
    }
  }, [])

  const requestReports = useCallback((date?: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'request_reports', data: date ? { date } : undefined }))
    }
  }, [])

  const runAnalysisNow = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'run_analysis_now' }))
    }
  }, [])

  const requestPaperState = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'request_paper_state' }))
    }
  }, [])

  const paperConfigure = useCallback((config: { enabled: boolean; startingBalance?: number; useAITrader?: boolean }) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'paper_configure', data: config }))
    }
  }, [])

  const paperClosePosition = useCallback((positionId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'paper_close_position', data: { positionId } }))
    }
  }, [])

  const paperReset = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'paper_reset' }))
    }
  }, [])

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      const token = localStorage.getItem(TOKEN_KEY)
      if (token) {
        ws.send(JSON.stringify({ type: 'auth_token', token }))
      }
    }

    ws.onclose = () => {
      setConnected(false)
      reconnectTimer.current = setTimeout(connect, 3000)
    }

    ws.onerror = () => {
      ws.close()
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string)
        switch (msg.type) {
          case 'snapshot':
            setSnapshots(msg.data)
            break
          case 'alert':
            setAlerts(prev => [msg.data, ...prev].slice(0, MAX_ALERTS))
            break
          case 'account':
            setAccount(msg.data)
            break
          case 'status':
            setUptime(msg.data.uptime)
            if (msg.data.env) setEnv(msg.data.env)
            if (msg.data.isDelayed != null) setIsDelayed(msg.data.isDelayed)
            if (msg.data.multiTenant != null) setMultiTenant(msg.data.multiTenant)
            if (msg.data.oauthProviders) setOauthProviders(msg.data.oauthProviders)
            break
          case 'optionChain':
            setOptionChain(msg.data)
            break
          case 'agent_analysis':
            setAnalyses(prev => [msg.data, ...prev].slice(0, MAX_ANALYSES))
            break
          case 'alert_history':
            setAlerts(msg.data)
            break
          case 'analysis_history':
            setAnalyses(msg.data)
            break
          case 'agent_status':
            setAgentStatus(msg.data)
            break
          case 'auth_result':
            if (msg.data.success) {
              if (msg.data.token) localStorage.setItem(TOKEN_KEY, msg.data.token)
              setAuthUser(msg.data.user)
              setAuthError(null)
              setTimeout(requestAgentConfig, 100)
            } else {
              setAuthError(msg.data.error || 'Authentication failed')
            }
            break
          case 'agent_config':
            setAgentConfig(msg.data)
            break
          case 'agent_config_error':
            console.error('[agent_config_error]', msg.data?.error)
            break
          case 'watchlist_data':
            setWatchlists(msg.data)
            break
          case 'search_results':
            setSearchResults(msg.data)
            break
          case 'chat_message':
            setChatMessages(prev => [...prev, msg.data])
            break
          case 'chat_history':
            setChatMessages(msg.data)
            break
          case 'schedule_config':
            setScheduleConfig(msg.data)
            break
          case 'budget_status':
            setBudgetStatus(msg.data)
            break
          case 'reports_data':
            setReports(msg.data)
            break
          case 'new_report':
            setReports(prev => [msg.data, ...prev])
            break
          case 'paper_account':
            setPaperAccount(msg.data)
            break
          case 'paper_positions':
            setPaperPositions(msg.data)
            break
          case 'paper_orders':
            setPaperOrders(msg.data)
            break
          case 'paper_trade_executed':
            setPaperOrders(prev => [msg.data, ...prev].slice(0, 50))
            break
          case 'watchlist_proposal':
            setWatchlistProposal(msg.data)
            break
        }
      } catch {
        // ignore malformed messages
      }
    }
  }, [requestAgentConfig])

  useEffect(() => {
    connect()

    function handleOAuthMessage(event: MessageEvent) {
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
        if (data.type === 'oauth_callback' && data.token) {
          localStorage.setItem(TOKEN_KEY, data.token)
          setAuthUser(data.user)
          setAuthError(null)
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'auth_token', token: data.token }))
          }
        }
      } catch { /* ignore */ }
    }
    window.addEventListener('message', handleOAuthMessage)

    return () => {
      clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
      window.removeEventListener('message', handleOAuthMessage)
    }
  }, [connect])

  return {
    connected, snapshots, alerts, analyses, account, uptime, env, isDelayed, multiTenant, oauthProviders,
    optionChain, agentStatus, agentConfig, authUser, authError,
    watchlists, chatMessages, scheduleConfig, budgetStatus, reports, searchResults,
    requestChain, sendRaw, login: loginFn, register: registerFn, logout,
    saveAgentConfig, requestAgentConfig, sendTestAlert,
    requestWatchlist, saveWatchlist, deleteWatchlistItem,
    createWatchlist: createWatchlistFn, deleteWatchlist: deleteWatchlistFn, renameWatchlist: renameWatchlistFn,
    syncTastytradeWatchlists,
    searchSymbols: searchSymbolsFn, sendChatMessage, clearChat, watchlistProposal, clearProposal,
    saveScheduleConfig, requestScheduleConfig, requestBudgetStatus,
    requestReports, runAnalysisNow,
    paperAccount, paperPositions, paperOrders,
    requestPaperState, paperConfigure, paperClosePosition, paperReset,
  }
}
