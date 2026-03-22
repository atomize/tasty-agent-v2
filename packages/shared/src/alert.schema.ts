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
])
export type WsClientMessage = z.infer<typeof WsClientMessageSchema>
