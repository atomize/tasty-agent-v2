import { z } from 'zod'

export const TriggerTypeSchema = z.enum([
  'IV_SPIKE',
  'PRICE_MOVE',
  'CRYPTO_PRICE_MOVE',
  'IV_RANK_HIGH',
  'IV_RANK_LOW',
  'SCHEDULED_OPEN',
  'SCHEDULED_CLOSE',
  'MANUAL',
])
export type TriggerType = z.infer<typeof TriggerTypeSchema>

export const SeveritySchema = z.enum(['high', 'medium', 'low'])
export type Severity = z.infer<typeof SeveritySchema>

export const TriggerSchema = z.object({
  type: TriggerTypeSchema,
  ticker: z.string(),
  description: z.string(),
  threshold: z.number(),
  observed: z.number(),
})
export type Trigger = z.infer<typeof TriggerSchema>

export const TickerSnapshotSchema = z.object({
  ticker: z.string(),
  price: z.number(),
  bid: z.number(),
  ask: z.number(),
  priceChange1D: z.number(),
  priceChangePct1D: z.number(),
  iv: z.number().optional(),
  ivRank: z.number().optional(),
  ivPercentile: z.number().optional(),
  ivPctChange5Min: z.number().optional(),
  volume: z.number(),
  openInterest: z.number().optional(),

  prevDayClose: z.number().optional(),
  dayOpen: z.number().optional(),
  dayHigh: z.number().optional(),
  dayLow: z.number().optional(),

  high52Week: z.number().optional(),
  low52Week: z.number().optional(),
  beta: z.number().optional(),
  description: z.string().optional(),
  tradingStatus: z.string().optional(),

  layer: z.string().nullable(),
  strategies: z.array(z.string()),
  isDelayed: z.boolean(),
  lastUpdated: z.string(),
})
export type TickerSnapshot = z.infer<typeof TickerSnapshotSchema>

export const OptionStrikeSchema = z.object({
  strike: z.number(),
  callBid: z.number(),
  callAsk: z.number(),
  callVolume: z.number(),
  callOI: z.number(),
  callDelta: z.number().optional(),
  callIV: z.number().optional(),
  callStreamerSymbol: z.string().optional(),
  putBid: z.number(),
  putAsk: z.number(),
  putVolume: z.number(),
  putOI: z.number(),
  putDelta: z.number().optional(),
  putIV: z.number().optional(),
  putStreamerSymbol: z.string().optional(),
})
export type OptionStrike = z.infer<typeof OptionStrikeSchema>

export const OptionExpirationSchema = z.object({
  expiration: z.string(),
  daysToExpiry: z.number(),
  strikes: z.array(OptionStrikeSchema),
})
export type OptionExpiration = z.infer<typeof OptionExpirationSchema>

export const AccountPositionSchema = z.object({
  ticker: z.string(),
  type: z.enum(['call', 'put', 'stock']),
  strike: z.number().optional(),
  expiration: z.string().optional(),
  quantity: z.number(),
  costBasis: z.number(),
  currentValue: z.number(),
  pnl: z.number(),
  pnlPct: z.number(),
})
export type AccountPosition = z.infer<typeof AccountPositionSchema>

export const AccountContextSchema = z.object({
  netLiq: z.number(),
  buyingPower: z.number(),
  openPositions: z.array(AccountPositionSchema),
})
export type AccountContext = z.infer<typeof AccountContextSchema>

export const OptionsAlertSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string(),
  version: z.literal('1.0'),

  trigger: TriggerSchema,
  severity: SeveritySchema,

  strategies: z.array(z.string()),
  supplyChainLayer: z.string().nullable(),

  skillHint: z.enum([
    'ai-hidden-supply-chain-options',
    'midterm-options-analysis',
  ]).nullable(),

  marketSnapshot: z.array(TickerSnapshotSchema),
  optionChain: z.array(OptionExpirationSchema),
  account: AccountContextSchema,

  agentContext: z.string(),
})
export type OptionsAlert = z.infer<typeof OptionsAlertSchema>

export const AgentAnalysisSchema = z.object({
  alertId: z.string(),
  timestamp: z.string(),
  model: z.string(),
  analysis: z.string(),
  ticker: z.string(),
  triggerType: TriggerTypeSchema,
})
export type AgentAnalysis = z.infer<typeof AgentAnalysisSchema>

export const AgentStatusSchema = z.object({
  connected: z.boolean(),
  state: z.enum(['idle', 'processing', 'error']),
  model: z.string(),
  currentTicker: z.string().nullable(),
  lastError: z.string().nullable(),
  lastAlertTime: z.string().nullable(),
  queueDepth: z.number(),
})
export type AgentStatus = z.infer<typeof AgentStatusSchema>

export const OptionChainResponseSchema = z.object({
  ticker: z.string(),
  expirations: z.array(OptionExpirationSchema),
  instrumentType: z.enum(['equity', 'crypto']),
})
export type OptionChainResponse = z.infer<typeof OptionChainResponseSchema>

// ─── Multi-tenant schemas ────────────────────────────────────────

export const AgentProviderSchema = z.enum(['claude-sdk', 'webhook', 'websocket', 'none'])
export type AgentProvider = z.infer<typeof AgentProviderSchema>

export const AgentConfigSchema = z.object({
  provider: AgentProviderSchema,
  apiKey: z.string().optional(),
  model: z.string().default('claude-sonnet-4-20250514'),
  maxBudgetUsd: z.number().default(0.50),
  externalUrl: z.string().optional(),
})
export type AgentConfig = z.infer<typeof AgentConfigSchema>

export const AgentConfigResponseSchema = z.object({
  provider: AgentProviderSchema,
  maskedApiKey: z.string().nullable(),
  model: z.string(),
  maxBudgetUsd: z.number(),
  externalUrl: z.string().nullable(),
})
export type AgentConfigResponse = z.infer<typeof AgentConfigResponseSchema>

export const WsServerAuthResultSchema = z.object({
  type: z.literal('auth_result'),
  data: z.object({
    success: z.boolean(),
    token: z.string().optional(),
    user: z.object({
      id: z.number(),
      email: z.string(),
    }).optional(),
    error: z.string().optional(),
  }),
})
export type WsServerAuthResult = z.infer<typeof WsServerAuthResultSchema>

export const WsServerAgentConfigSchema = z.object({
  type: z.literal('agent_config'),
  data: AgentConfigResponseSchema,
})
export type WsServerAgentConfig = z.infer<typeof WsServerAgentConfigSchema>

// ─── Watchlist schemas ───────────────────────────────────────────

export const WatchlistItemSchema = z.object({
  ticker: z.string(),
  layer: z.string().nullable(),
  strategies: z.array(z.string()),
  thesis: z.string(),
  instrumentType: z.enum(['equity', 'crypto']),
  sortOrder: z.number(),
})
export type WatchlistItem = z.infer<typeof WatchlistItemSchema>

export const WatchlistSchema = z.object({
  id: z.number(),
  name: z.string(),
  items: z.array(WatchlistItemSchema),
})
export type Watchlist = z.infer<typeof WatchlistSchema>

// ─── Chat schemas ────────────────────────────────────────────────

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  timestamp: z.string(),
  costUsd: z.number().optional(),
})
export type ChatMessage = z.infer<typeof ChatMessageSchema>

// ─── Schedule + Budget schemas ───────────────────────────────────

export const ScheduleConfigSchema = z.object({
  runsPerDay: z.number().min(1).max(8).default(4),
  runTimesCt: z.array(z.string()).default(['09:45', '11:30', '13:30', '15:00']),
  dailyBudgetUsd: z.number().min(0.5).max(20).default(2.0),
  perRunBudgetUsd: z.number().min(0.1).max(5).default(0.5),
  includeChains: z.boolean().default(true),
  maxTickersPerRun: z.number().min(1).max(50).default(10),
  enabled: z.boolean().default(true),
})
export type ScheduleConfig = z.infer<typeof ScheduleConfigSchema>

export const ScheduleConfigResponseSchema = ScheduleConfigSchema.extend({
  updatedAt: z.string().optional(),
})
export type ScheduleConfigResponse = z.infer<typeof ScheduleConfigResponseSchema>

export const TokenUsageSummarySchema = z.object({
  date: z.string(),
  total: z.number(),
  scheduled: z.number(),
  chat: z.number(),
  alert: z.number(),
})
export type TokenUsageSummary = z.infer<typeof TokenUsageSummarySchema>

export const BudgetStatusSchema = z.object({
  dailyBudgetUsd: z.number(),
  dailySpentUsd: z.number(),
  remainingUsd: z.number(),
  usagePct: z.number(),
  paused: z.boolean(),
  history: z.array(TokenUsageSummarySchema),
})
export type BudgetStatus = z.infer<typeof BudgetStatusSchema>

// ─── Analysis Report schemas ─────────────────────────────────────

export const AnalysisReportSchema = z.object({
  id: z.string(),
  runTime: z.string(),
  runType: z.enum(['morning', 'midday_1', 'midday_2', 'preclose', 'nextday', 'manual']),
  tickers: z.array(z.string()),
  report: z.string(),
  costUsd: z.number(),
  model: z.string(),
  createdAt: z.string(),
})
export type AnalysisReport = z.infer<typeof AnalysisReportSchema>

// ─── Paper Trading schemas ────────────────────────────────────────

export const TradeSignalSchema = z.object({
  alertId: z.string(),
  ticker: z.string(),
  action: z.enum(['buy', 'sell']),
  instrument: z.enum(['call', 'put', 'stock']),
  strike: z.number().nullable(),
  expiration: z.string().nullable(),
  price: z.number(),
  sizePercent: z.number(),
  thesis: z.string(),
  stopCondition: z.string(),
  invalidation: z.string(),
})
export type TradeSignal = z.infer<typeof TradeSignalSchema>

export const TraderDecisionSchema = z.object({
  action: z.enum(['execute', 'skip', 'modify']),
  reason: z.string(),
  adjustedSizePercent: z.number().optional(),
  confidence: z.number(),
  usedAI: z.boolean(),
})
export type TraderDecision = z.infer<typeof TraderDecisionSchema>

export const PaperOrderSchema = z.object({
  id: z.string(),
  userId: z.number(),
  signal: TradeSignalSchema,
  status: z.enum(['pending', 'filled', 'rejected', 'cancelled']),
  decision: TraderDecisionSchema,
  filledPrice: z.number().nullable(),
  filledAt: z.string().nullable(),
  createdAt: z.string(),
})
export type PaperOrder = z.infer<typeof PaperOrderSchema>

export const PaperPositionSchema = z.object({
  id: z.string(),
  userId: z.number(),
  orderId: z.string(),
  ticker: z.string(),
  side: z.enum(['long', 'short']),
  instrument: z.enum(['call', 'put', 'stock']),
  strike: z.number().nullable(),
  expiration: z.string().nullable(),
  quantity: z.number(),
  avgCost: z.number(),
  currentPrice: z.number(),
  unrealizedPnl: z.number(),
  unrealizedPnlPct: z.number(),
  delta: z.number(),
  openedAt: z.string(),
})
export type PaperPosition = z.infer<typeof PaperPositionSchema>

export const PaperAccountSchema = z.object({
  userId: z.number(),
  startingBalance: z.number(),
  cash: z.number(),
  equity: z.number(),
  unrealizedPnl: z.number(),
  realizedPnl: z.number(),
  totalTrades: z.number(),
  winRate: z.number(),
  enabled: z.boolean(),
  useAITrader: z.boolean(),
})
export type PaperAccount = z.infer<typeof PaperAccountSchema>

// ─── WS message unions ──────────────────────────────────────────

export const WsMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('alert'),
    data: OptionsAlertSchema,
  }),
  z.object({
    type: z.literal('snapshot'),
    data: z.array(TickerSnapshotSchema),
  }),
  z.object({
    type: z.literal('account'),
    data: AccountContextSchema,
  }),
  z.object({
    type: z.literal('status'),
    data: z.object({
      connected: z.boolean(),
      symbolCount: z.number(),
      uptime: z.number(),
      env: z.enum(['sandbox', 'production']),
      isDelayed: z.boolean(),
    }),
  }),
  z.object({
    type: z.literal('optionChain'),
    data: OptionChainResponseSchema,
  }),
  z.object({
    type: z.literal('agent_analysis'),
    data: AgentAnalysisSchema,
  }),
  z.object({
    type: z.literal('alert_history'),
    data: z.array(OptionsAlertSchema),
  }),
  z.object({
    type: z.literal('analysis_history'),
    data: z.array(AgentAnalysisSchema),
  }),
  z.object({
    type: z.literal('agent_status'),
    data: AgentStatusSchema,
  }),
  WsServerAuthResultSchema,
  WsServerAgentConfigSchema,
  z.object({ type: z.literal('watchlist_data'), data: z.array(WatchlistSchema) }),
  z.object({ type: z.literal('search_results'), data: z.array(z.object({ ticker: z.string(), description: z.string(), instrumentType: z.string() })) }),
  z.object({ type: z.literal('chat_message'), data: ChatMessageSchema }),
  z.object({ type: z.literal('chat_history'), data: z.array(ChatMessageSchema) }),
  z.object({ type: z.literal('schedule_config'), data: ScheduleConfigResponseSchema }),
  z.object({ type: z.literal('budget_status'), data: BudgetStatusSchema }),
  z.object({ type: z.literal('reports_data'), data: z.array(AnalysisReportSchema) }),
  z.object({ type: z.literal('new_report'), data: AnalysisReportSchema }),
  z.object({ type: z.literal('agent_config_error'), data: z.object({ error: z.string() }) }),
  z.object({ type: z.literal('paper_account'), data: PaperAccountSchema }),
  z.object({ type: z.literal('paper_positions'), data: z.array(PaperPositionSchema) }),
  z.object({ type: z.literal('paper_orders'), data: z.array(PaperOrderSchema) }),
  z.object({ type: z.literal('paper_trade_executed'), data: PaperOrderSchema }),
])
export type WsMessage = z.infer<typeof WsMessageSchema>

export const WsClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('requestChain'),
    ticker: z.string(),
  }),
  z.object({
    type: z.literal('auth'),
    action: z.enum(['login', 'register']),
    email: z.string(),
    password: z.string(),
  }),
  z.object({
    type: z.literal('auth_token'),
    token: z.string(),
  }),
  z.object({
    type: z.literal('save_agent_config'),
    config: AgentConfigSchema,
  }),
  z.object({
    type: z.literal('request_agent_config'),
  }),
  z.object({
    type: z.literal('save_watchlist'),
    data: z.object({ name: z.string(), items: z.array(WatchlistItemSchema) }),
  }),
  z.object({
    type: z.literal('request_watchlist'),
  }),
  z.object({
    type: z.literal('sync_tastytrade_watchlists'),
  }),
  z.object({
    type: z.literal('search_symbols'),
    query: z.string(),
  }),
  z.object({
    type: z.literal('delete_watchlist_item'),
    data: z.object({ watchlistName: z.string(), ticker: z.string() }),
  }),
  z.object({
    type: z.literal('chat_send'),
    data: z.object({ message: z.string() }),
  }),
  z.object({
    type: z.literal('chat_clear'),
  }),
  z.object({
    type: z.literal('save_schedule_config'),
    data: ScheduleConfigSchema,
  }),
  z.object({
    type: z.literal('request_schedule_config'),
  }),
  z.object({
    type: z.literal('request_budget_status'),
  }),
  z.object({
    type: z.literal('request_reports'),
    data: z.object({ date: z.string().optional() }).optional(),
  }),
  z.object({
    type: z.literal('run_analysis_now'),
  }),
  z.object({
    type: z.literal('paper_configure'),
    data: z.object({ enabled: z.boolean(), startingBalance: z.number().optional(), useAITrader: z.boolean().optional() }),
  }),
  z.object({
    type: z.literal('paper_close_position'),
    data: z.object({ positionId: z.string() }),
  }),
  z.object({
    type: z.literal('paper_reset'),
  }),
  z.object({
    type: z.literal('request_paper_state'),
  }),
])
export type WsClientMessage = z.infer<typeof WsClientMessageSchema>
