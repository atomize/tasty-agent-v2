import type { PaperAccount, PaperPosition } from '@tastytrade-monitor/shared'

const DEFAULT_STARTING_BALANCE = 50_000

export function createAccount(userId: number, startingBalance?: number): PaperAccount {
  const balance = startingBalance ?? DEFAULT_STARTING_BALANCE
  return {
    userId,
    startingBalance: balance,
    cash: balance,
    equity: balance,
    unrealizedPnl: 0,
    realizedPnl: 0,
    totalTrades: 0,
    winRate: 0,
    enabled: true,
    useAITrader: false,
  }
}

export function updateEquity(account: PaperAccount, positions: PaperPosition[]): PaperAccount {
  const positionValue = positions.reduce((sum, p) => {
    const multiplier = p.instrument === 'stock' ? 1 : 100
    return sum + p.currentPrice * p.quantity * multiplier
  }, 0)

  const unrealizedPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0)

  account.equity = account.cash + positionValue
  account.unrealizedPnl = unrealizedPnl

  return account
}

export function deductCash(account: PaperAccount, price: number, instrument: string, quantity: number): void {
  const multiplier = instrument === 'stock' ? 1 : 100
  account.cash -= price * quantity * multiplier
}

export function addCash(account: PaperAccount, price: number, instrument: string, quantity: number): void {
  const multiplier = instrument === 'stock' ? 1 : 100
  account.cash += price * quantity * multiplier
}

export function recordTrade(account: PaperAccount, realizedPnl: number): void {
  account.totalTrades += 1
  account.realizedPnl += realizedPnl
}

export function resetAccount(account: PaperAccount): PaperAccount {
  return createAccount(account.userId, account.startingBalance)
}
