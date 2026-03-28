import type { PaperAccount, PaperOrder, PaperPosition, TradeSignal, TickerSnapshot } from '@tastytrade-monitor/shared'
import type { TradeRecommendation } from './signalParser.js'
import { parseRecommendation, parseAnalysisText } from './signalParser.js'
import { checkRisk } from './riskEngine.js'
import { makeRulesDecision, evaluateWithAI } from './traderAgent.js'
import type { TraderAgentDeps } from './traderAgent.js'
import { fillOrder, rejectOrder } from './execution.js'
import type { SnapshotProvider } from './execution.js'
import { markToMarket, recordEntryUnderlying, checkExpirations, checkStops } from './positions.js'
import { deductCash, addCash, recordTrade } from './account.js'
import {
  initPaperDb, getOrCreateAccount, updateAccountCash, recordTradeInDb,
  insertOrder, insertPosition, getOpenPositions, getRecentOrders,
  getTodayTradeCount, closePosition, getAllPaperUserIds,
  updateAccountConfig, resetAccountInDb,
} from './db.js'

export { initPaperDb } from './db.js'
export { getOrCreateAccount, getOpenPositions, getRecentOrders, updateAccountConfig, resetAccountInDb } from './db.js'
export type { SnapshotProvider } from './execution.js'

export interface AnalysisHandoff {
  userId: number
  alertId: string
  ticker: string
  analysisText: string
  recommendation: TradeRecommendation | null
}

export interface PaperTraderCallbacks {
  onOrderFilled: (order: PaperOrder, position: PaperPosition, account: PaperAccount) => void
  onOrderRejected: (order: PaperOrder, account: PaperAccount) => void
  onPositionClosed: (position: PaperPosition, realizedPnl: number, account: PaperAccount) => void
  onAccountUpdated: (account: PaperAccount, positions: PaperPosition[]) => void
  log: {
    info: (msg: string) => void
    warn: (msg: string) => void
    error: (msg: string) => void
  }
}

let callbacks: PaperTraderCallbacks | null = null
let snapshots: SnapshotProvider | null = null
let traderDepsFactory: ((userId: number) => Promise<TraderAgentDeps | null>) | null = null

export function initPaperTraderEngine(
  database: unknown,
  snapshotProvider: SnapshotProvider,
  cb: PaperTraderCallbacks,
  getDeps: (userId: number) => Promise<TraderAgentDeps | null>,
): void {
  initPaperDb(database as Parameters<typeof initPaperDb>[0])
  snapshots = snapshotProvider
  callbacks = cb
  traderDepsFactory = getDeps
  cb.log.info('Paper trading engine initialized')
}

export async function handleAnalysis(handoff: AnalysisHandoff): Promise<void> {
  if (!callbacks || !snapshots) return

  const account = getOrCreateAccount(handoff.userId)
  if (!account.enabled) return

  let signal: TradeSignal | null = null

  if (handoff.recommendation) {
    signal = parseRecommendation(handoff.alertId, handoff.ticker, handoff.recommendation)
  }
  if (!signal) {
    signal = parseAnalysisText(handoff.alertId, handoff.ticker, handoff.analysisText)
  }

  if (!signal) {
    callbacks.log.info(`Paper: no parseable signal from ${handoff.ticker} analysis`)
    return
  }

  const positions = getOpenPositions(handoff.userId)
  const todayCount = getTodayTradeCount(handoff.userId)

  const riskResult = checkRisk(signal, account, positions, todayCount)
  if (!riskResult.pass) {
    const decision = { action: 'skip' as const, reason: riskResult.reason!, confidence: 100, usedAI: false }
    const order = rejectOrder(signal, decision, handoff.userId)
    insertOrder(order)
    callbacks.onOrderRejected(order, account)
    callbacks.log.info(`Paper: ${handoff.ticker} rejected — ${riskResult.reason}`)
    return
  }

  let decision = makeRulesDecision()

  if (account.useAITrader && traderDepsFactory) {
    const deps = await traderDepsFactory(handoff.userId)
    if (deps) {
      const snap = snapshots.getSnapshot(signal.ticker)
      decision = await evaluateWithAI(signal, account, positions, snap as TickerSnapshot | undefined, deps)
    }
  }

  if (decision.action === 'skip') {
    const order = rejectOrder(signal, decision, handoff.userId)
    insertOrder(order)
    callbacks.onOrderRejected(order, account)
    callbacks.log.info(`Paper: ${handoff.ticker} skipped by trader — ${decision.reason}`)
    return
  }

  if (decision.action === 'modify' && decision.adjustedSizePercent) {
    signal = { ...signal, sizePercent: decision.adjustedSizePercent }
  }

  const { order, position } = fillOrder(signal, decision, handoff.userId, snapshots)
  insertOrder(order)

  if (position) {
    insertPosition(position)
    deductCash(account, position.avgCost, position.instrument, position.quantity)
    updateAccountCash(handoff.userId, account.cash)

    const snap = snapshots.getSnapshot(signal.ticker)
    if (snap) recordEntryUnderlying(position.id, snap.price)

    const updatedPositions = getOpenPositions(handoff.userId)
    callbacks.onOrderFilled(order, position, account)
    callbacks.onAccountUpdated(account, updatedPositions)
    callbacks.log.info(`Paper: FILLED ${signal.action} ${signal.instrument} ${signal.ticker}${signal.strike ? ' ' + signal.strike : ''} @ $${position.avgCost.toFixed(2)}`)
  }
}

export function tickMarkToMarket(): void {
  if (!snapshots || !callbacks) return

  const userIds = getAllPaperUserIds()
  for (const userId of userIds) {
    const positions = getOpenPositions(userId)
    if (positions.length === 0) continue

    markToMarket(positions, snapshots)

    const { expired, active: afterExpiry } = checkExpirations(positions)
    const { stopped, active } = checkStops(afterExpiry, snapshots)

    const account = getOrCreateAccount(userId)

    for (const pos of [...expired, ...stopped]) {
      const multiplier = pos.instrument === 'stock' ? 1 : 100
      const pnl = pos.unrealizedPnl
      addCash(account, pos.currentPrice, pos.instrument, pos.quantity)
      closePosition(pos.id, pos.currentPrice, pnl)
      recordTradeInDb(userId, pnl, pnl > 0)
      recordTrade(account, pnl)
      updateAccountCash(userId, account.cash)
      callbacks.onPositionClosed(pos, pnl, account)
      callbacks.log.info(`Paper: closed ${pos.ticker} ${pos.instrument} — P&L $${pnl.toFixed(2)}`)
    }

    if (active.length > 0 || expired.length > 0 || stopped.length > 0) {
      const updatedPositions = getOpenPositions(userId)
      const updatedAccount = getOrCreateAccount(userId)
      callbacks.onAccountUpdated(updatedAccount, updatedPositions)
    }
  }
}

export function closePositionManual(userId: number, positionId: string): void {
  if (!snapshots || !callbacks) return

  const positions = getOpenPositions(userId)
  const pos = positions.find(p => p.id === positionId)
  if (!pos) return

  markToMarket([pos], snapshots)

  const pnl = pos.unrealizedPnl
  const account = getOrCreateAccount(userId)

  addCash(account, pos.currentPrice, pos.instrument, pos.quantity)
  closePosition(positionId, pos.currentPrice, pnl)
  recordTradeInDb(userId, pnl, pnl > 0)
  recordTrade(account, pnl)
  updateAccountCash(userId, account.cash)

  callbacks.onPositionClosed(pos, pnl, account)

  const updatedPositions = getOpenPositions(userId)
  const updatedAccount = getOrCreateAccount(userId)
  callbacks.onAccountUpdated(updatedAccount, updatedPositions)
  callbacks.log.info(`Paper: manual close ${pos.ticker} ${pos.instrument} — P&L $${pnl.toFixed(2)}`)
}
