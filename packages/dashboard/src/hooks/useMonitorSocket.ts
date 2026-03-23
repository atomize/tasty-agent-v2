import { useState, useEffect, useRef, useCallback } from 'react'
import type { TickerSnapshot, OptionsAlert, AccountContext, OptionChainResponse, AgentAnalysis, AgentStatus, AgentConfigResponse } from '@tastytrade-monitor/shared'

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
  requestChain: (ticker: string) => void
  sendRaw: (msg: unknown) => void
  login: (email: string, password: string) => void
  register: (email: string, password: string) => void
  logout: () => void
  saveAgentConfig: (config: { provider: string; apiKey?: string; model?: string; maxBudgetUsd?: number; externalUrl?: string }) => void
  requestAgentConfig: () => void
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
    requestChain, sendRaw, login: loginFn, register: registerFn, logout,
    saveAgentConfig, requestAgentConfig,
  }
}
