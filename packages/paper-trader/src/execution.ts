import type { TradeSignal, PaperOrder, PaperPosition, TraderDecision } from '@tastytrade-monitor/shared'
import { randomUUID } from 'node:crypto'

export interface SnapshotProvider {
  getSnapshot(ticker: string): { price: number; bid: number; ask: number } | undefined
}

export function fillOrder(
  signal: TradeSignal,
  decision: TraderDecision,
  userId: number,
  snapshots: SnapshotProvider,
): { order: PaperOrder; position: PaperPosition | null } {
  const snap = snapshots.getSnapshot(signal.ticker)
  const midPrice = snap ? (snap.bid + snap.ask) / 2 : signal.price

  const fillPrice = signal.instrument === 'stock'
    ? midPrice
    : signal.price > 0 ? signal.price : midPrice

  const orderId = randomUUID()
  const now = new Date().toISOString()

  const order: PaperOrder = {
    id: orderId,
    userId,
    signal,
    status: 'filled',
    decision,
    filledPrice: fillPrice,
    filledAt: now,
    createdAt: now,
  }

  const side = signal.action === 'buy' ? 'long' as const : 'short' as const
  const quantity = 1

  const estimatedDelta = signal.instrument === 'call'
    ? (signal.action === 'buy' ? 0.50 : -0.50)
    : signal.instrument === 'put'
      ? (signal.action === 'buy' ? -0.50 : 0.50)
      : (signal.action === 'buy' ? 1.0 : -1.0)

  const position: PaperPosition = {
    id: randomUUID(),
    userId,
    orderId,
    ticker: signal.ticker,
    side,
    instrument: signal.instrument,
    strike: signal.strike,
    expiration: signal.expiration,
    quantity,
    avgCost: fillPrice,
    currentPrice: fillPrice,
    unrealizedPnl: 0,
    unrealizedPnlPct: 0,
    delta: estimatedDelta,
    openedAt: now,
  }

  return { order, position }
}

export function rejectOrder(
  signal: TradeSignal,
  decision: TraderDecision,
  userId: number,
): PaperOrder {
  const now = new Date().toISOString()
  return {
    id: randomUUID(),
    userId,
    signal,
    status: 'rejected',
    decision,
    filledPrice: null,
    filledAt: null,
    createdAt: now,
  }
}
