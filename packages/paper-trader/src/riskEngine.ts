import type { TradeSignal, PaperPosition, PaperAccount } from '@tastytrade-monitor/shared'

export interface RiskCheckResult {
  pass: boolean
  reason?: string
}

const MAX_POSITIONS = 10
const MAX_CONCENTRATION_PCT = 20
const MAX_DAILY_TRADES = 8
const MAX_SIZE_PCT = 5
const MIN_EQUITY_PCT = 20

export function checkRisk(
  signal: TradeSignal,
  account: PaperAccount,
  positions: PaperPosition[],
  todayTradeCount: number,
): RiskCheckResult {
  if (!account.enabled) {
    return { pass: false, reason: 'Paper trading is disabled' }
  }

  const equity = account.equity
  const minEquity = account.startingBalance * (MIN_EQUITY_PCT / 100)
  if (equity < minEquity) {
    return { pass: false, reason: `Equity $${equity.toFixed(0)} below ${MIN_EQUITY_PCT}% of starting balance — trading halted` }
  }

  if (positions.length >= MAX_POSITIONS) {
    return { pass: false, reason: `At position limit (${MAX_POSITIONS})` }
  }

  if (todayTradeCount >= MAX_DAILY_TRADES) {
    return { pass: false, reason: `Daily trade limit reached (${MAX_DAILY_TRADES})` }
  }

  if (signal.sizePercent > MAX_SIZE_PCT) {
    return { pass: false, reason: `Size ${signal.sizePercent}% exceeds max ${MAX_SIZE_PCT}%` }
  }

  const tickerExposure = positions
    .filter(p => p.ticker === signal.ticker)
    .reduce((sum, p) => sum + Math.abs(p.avgCost * p.quantity * (p.instrument === 'stock' ? 1 : 100)), 0)
  const tickerPct = equity > 0 ? (tickerExposure / equity) * 100 : 0
  if (tickerPct >= MAX_CONCENTRATION_PCT) {
    return { pass: false, reason: `${signal.ticker} concentration at ${tickerPct.toFixed(0)}% (max ${MAX_CONCENTRATION_PCT}%)` }
  }

  const duplicate = positions.find(p =>
    p.ticker === signal.ticker &&
    p.instrument === signal.instrument &&
    p.side === (signal.action === 'buy' ? 'long' : 'short') &&
    p.strike === signal.strike,
  )
  if (duplicate) {
    return { pass: false, reason: `Duplicate position: already ${duplicate.side} ${signal.ticker} ${signal.instrument}` }
  }

  const tradeValue = signal.price * (signal.instrument === 'stock' ? 1 : 100)
  if (tradeValue > account.cash) {
    return { pass: false, reason: `Insufficient cash: need $${tradeValue.toFixed(0)}, have $${account.cash.toFixed(0)}` }
  }

  return { pass: true }
}
