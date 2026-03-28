import type { PaperAccount, PaperOrder, PaperPosition } from '@tastytrade-monitor/shared'

type Database = {
  exec(sql: string): void
  prepare(sql: string): {
    run(...args: unknown[]): { changes: number }
    get(...args: unknown[]): unknown
    all(...args: unknown[]): unknown[]
  }
}

let db: Database | null = null

export function initPaperDb(database: Database): void {
  db = database
  migrate()
}

function getDb(): Database {
  if (!db) throw new Error('Paper trading DB not initialized')
  return db
}

function migrate(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS paper_accounts (
      user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      starting_balance REAL    NOT NULL DEFAULT 50000,
      cash             REAL    NOT NULL DEFAULT 50000,
      realized_pnl     REAL    NOT NULL DEFAULT 0,
      total_trades     INTEGER NOT NULL DEFAULT 0,
      wins             INTEGER NOT NULL DEFAULT 0,
      enabled          INTEGER NOT NULL DEFAULT 1,
      use_ai_trader    INTEGER NOT NULL DEFAULT 0,
      created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS paper_orders (
      id           TEXT PRIMARY KEY,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      signal_json  TEXT    NOT NULL,
      decision_json TEXT   NOT NULL,
      status       TEXT    NOT NULL CHECK(status IN ('pending','filled','rejected','cancelled')),
      filled_price REAL,
      filled_at    TEXT,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS paper_positions (
      id          TEXT PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      order_id    TEXT    NOT NULL,
      ticker      TEXT    NOT NULL,
      side        TEXT    NOT NULL CHECK(side IN ('long','short')),
      instrument  TEXT    NOT NULL CHECK(instrument IN ('call','put','stock')),
      strike      REAL,
      expiration  TEXT,
      quantity    INTEGER NOT NULL DEFAULT 1,
      avg_cost    REAL    NOT NULL,
      delta       REAL    NOT NULL DEFAULT 0.5,
      opened_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      closed_at   TEXT,
      close_price REAL,
      realized_pnl REAL
    );

    CREATE INDEX IF NOT EXISTS idx_paper_positions_user_open
      ON paper_positions(user_id) WHERE closed_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_paper_orders_user
      ON paper_orders(user_id, created_at DESC);
  `)
}

// ─── Account operations ─────────────────────────────────────────

export function getOrCreateAccount(userId: number, startingBalance = 50000): PaperAccount {
  const d = getDb()
  const row = d.prepare('SELECT * FROM paper_accounts WHERE user_id = ?').get(userId) as Record<string, unknown> | undefined

  if (row) {
    const openPositions = getOpenPositions(userId)
    const unrealizedPnl = openPositions.reduce((sum, p) => sum + p.unrealizedPnl, 0)
    const cash = row.cash as number
    const posValue = openPositions.reduce((sum, p) => {
      const mult = p.instrument === 'stock' ? 1 : 100
      return sum + p.currentPrice * p.quantity * mult
    }, 0)

    return {
      userId,
      startingBalance: row.starting_balance as number,
      cash,
      equity: cash + posValue,
      unrealizedPnl,
      realizedPnl: row.realized_pnl as number,
      totalTrades: row.total_trades as number,
      winRate: (row.total_trades as number) > 0 ? ((row.wins as number) / (row.total_trades as number)) * 100 : 0,
      enabled: (row.enabled as number) === 1,
      useAITrader: (row.use_ai_trader as number) === 1,
    }
  }

  d.prepare('INSERT INTO paper_accounts (user_id, starting_balance, cash) VALUES (?, ?, ?)').run(userId, startingBalance, startingBalance)
  return {
    userId,
    startingBalance,
    cash: startingBalance,
    equity: startingBalance,
    unrealizedPnl: 0,
    realizedPnl: 0,
    totalTrades: 0,
    winRate: 0,
    enabled: true,
    useAITrader: false,
  }
}

export function updateAccountCash(userId: number, cash: number): void {
  getDb().prepare('UPDATE paper_accounts SET cash = ? WHERE user_id = ?').run(cash, userId)
}

export function recordTradeInDb(userId: number, realizedPnl: number, isWin: boolean): void {
  const d = getDb()
  d.prepare(`
    UPDATE paper_accounts
    SET total_trades = total_trades + 1,
        realized_pnl = realized_pnl + ?,
        wins = wins + ?
    WHERE user_id = ?
  `).run(realizedPnl, isWin ? 1 : 0, userId)
}

export function updateAccountConfig(userId: number, enabled: boolean, startingBalance?: number, useAITrader?: boolean): void {
  const d = getDb()
  if (startingBalance !== undefined) {
    d.prepare('UPDATE paper_accounts SET enabled = ?, starting_balance = ?, use_ai_trader = ? WHERE user_id = ?')
      .run(enabled ? 1 : 0, startingBalance, (useAITrader ?? false) ? 1 : 0, userId)
  } else {
    d.prepare('UPDATE paper_accounts SET enabled = ?, use_ai_trader = ? WHERE user_id = ?')
      .run(enabled ? 1 : 0, (useAITrader ?? false) ? 1 : 0, userId)
  }
}

export function resetAccountInDb(userId: number): void {
  const d = getDb()
  const row = d.prepare('SELECT starting_balance FROM paper_accounts WHERE user_id = ?').get(userId) as { starting_balance: number } | undefined
  const bal = row?.starting_balance ?? 50000
  d.prepare('UPDATE paper_accounts SET cash = ?, realized_pnl = 0, total_trades = 0, wins = 0 WHERE user_id = ?').run(bal, userId)
  d.prepare('DELETE FROM paper_positions WHERE user_id = ?').run(userId)
  d.prepare('DELETE FROM paper_orders WHERE user_id = ?').run(userId)
}

// ─── Order operations ───────────────────────────────────────────

export function insertOrder(order: PaperOrder): void {
  getDb().prepare(`
    INSERT INTO paper_orders (id, user_id, signal_json, decision_json, status, filled_price, filled_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    order.id, order.userId,
    JSON.stringify(order.signal), JSON.stringify(order.decision),
    order.status, order.filledPrice, order.filledAt, order.createdAt,
  )
}

export function getRecentOrders(userId: number, limit = 20): PaperOrder[] {
  const rows = getDb().prepare(
    'SELECT * FROM paper_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
  ).all(userId, limit) as Record<string, unknown>[]

  return rows.map(rowToOrder)
}

export function getTodayTradeCount(userId: number): number {
  const row = getDb().prepare(
    "SELECT COUNT(*) as cnt FROM paper_orders WHERE user_id = ? AND status = 'filled' AND date(created_at) = date('now')",
  ).get(userId) as { cnt: number }
  return row.cnt
}

function rowToOrder(row: Record<string, unknown>): PaperOrder {
  return {
    id: row.id as string,
    userId: row.user_id as number,
    signal: JSON.parse(row.signal_json as string),
    decision: JSON.parse(row.decision_json as string),
    status: row.status as PaperOrder['status'],
    filledPrice: row.filled_price as number | null,
    filledAt: row.filled_at as string | null,
    createdAt: row.created_at as string,
  }
}

// ─── Position operations ────────────────────────────────────────

export function insertPosition(pos: PaperPosition): void {
  getDb().prepare(`
    INSERT INTO paper_positions (id, user_id, order_id, ticker, side, instrument, strike, expiration, quantity, avg_cost, delta, opened_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    pos.id, pos.userId, pos.orderId, pos.ticker, pos.side, pos.instrument,
    pos.strike, pos.expiration, pos.quantity, pos.avgCost, pos.delta, pos.openedAt,
  )
}

export function getOpenPositions(userId: number): PaperPosition[] {
  const rows = getDb().prepare(
    'SELECT * FROM paper_positions WHERE user_id = ? AND closed_at IS NULL',
  ).all(userId) as Record<string, unknown>[]

  return rows.map(rowToPosition)
}

export function closePosition(positionId: string, closePrice: number, realizedPnl: number): void {
  getDb().prepare(
    'UPDATE paper_positions SET closed_at = datetime(\'now\'), close_price = ?, realized_pnl = ? WHERE id = ?',
  ).run(closePrice, realizedPnl, positionId)
}

function rowToPosition(row: Record<string, unknown>): PaperPosition {
  return {
    id: row.id as string,
    userId: row.user_id as number,
    orderId: row.order_id as string,
    ticker: row.ticker as string,
    side: row.side as PaperPosition['side'],
    instrument: row.instrument as PaperPosition['instrument'],
    strike: row.strike as number | null,
    expiration: row.expiration as string | null,
    quantity: row.quantity as number,
    avgCost: row.avg_cost as number,
    currentPrice: row.avg_cost as number,
    unrealizedPnl: 0,
    unrealizedPnlPct: 0,
    delta: row.delta as number,
    openedAt: row.opened_at as string,
  }
}

export function getAllPaperUserIds(): number[] {
  const rows = getDb().prepare('SELECT user_id FROM paper_accounts WHERE enabled = 1').all() as { user_id: number }[]
  return rows.map(r => r.user_id)
}
