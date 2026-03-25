import Database from 'better-sqlite3'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { log } from './logger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db

  const dataDir = process.env.DATA_DIR || resolve(__dirname, '..', '..', '..', 'data')
  mkdirSync(dataDir, { recursive: true })
  const dbPath = resolve(dataDir, 'monitor.db')

  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  migrate(db)
  log.info(`SQLite database opened: ${dbPath}`)
  return db
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      email          TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      password_hash  TEXT,
      oauth_provider TEXT,
      oauth_id       TEXT,
      created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth
      ON users(oauth_provider, oauth_id)
      WHERE oauth_provider IS NOT NULL;

    CREATE TABLE IF NOT EXISTS agent_configs (
      user_id           INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      provider          TEXT NOT NULL DEFAULT 'none' CHECK(provider IN ('claude-sdk','webhook','websocket','none')),
      encrypted_api_key TEXT,
      model             TEXT NOT NULL DEFAULT 'claude-sonnet-4-20250514',
      max_budget_usd    REAL NOT NULL DEFAULT 0.50,
      external_url      TEXT,
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  migrateUsersTableOAuth(db)
  migrateV2Tables(db)
}

function migrateUsersTableOAuth(db: Database.Database): void {
  const cols = db.pragma('table_info(users)') as { name: string }[]
  const colNames = new Set(cols.map(c => c.name))
  if (!colNames.has('oauth_provider')) {
    db.exec('ALTER TABLE users ADD COLUMN oauth_provider TEXT')
    db.exec('ALTER TABLE users ADD COLUMN oauth_id TEXT')
    log.info('Migrated users table: added oauth_provider, oauth_id columns')
  }
}

function migrateV2Tables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS watchlists (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name       TEXT NOT NULL DEFAULT 'Default',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS watchlist_items (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      watchlist_id    INTEGER NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
      ticker          TEXT NOT NULL,
      layer           TEXT,
      strategies      TEXT NOT NULL DEFAULT '[]',
      thesis          TEXT NOT NULL DEFAULT '',
      instrument_type TEXT NOT NULL DEFAULT 'equity' CHECK(instrument_type IN ('equity','crypto')),
      sort_order      INTEGER NOT NULL DEFAULT 0,
      UNIQUE(watchlist_id, ticker)
    );

    CREATE TABLE IF NOT EXISTS schedule_configs (
      user_id              INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      runs_per_day         INTEGER NOT NULL DEFAULT 4,
      run_times_ct         TEXT NOT NULL DEFAULT '["09:45","11:30","13:30","15:00"]',
      daily_budget_usd     REAL NOT NULL DEFAULT 2.00,
      per_run_budget_usd   REAL NOT NULL DEFAULT 0.50,
      include_chains       INTEGER NOT NULL DEFAULT 1,
      max_tickers_per_run  INTEGER NOT NULL DEFAULT 10,
      enabled              INTEGER NOT NULL DEFAULT 1,
      updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS token_usage (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date       TEXT NOT NULL,
      source     TEXT NOT NULL CHECK(source IN ('scheduled','chat','alert','manual')),
      run_id     TEXT,
      cost_usd   REAL NOT NULL DEFAULT 0,
      tokens_in  INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_token_usage_user_date
      ON token_usage(user_id, date);

    CREATE TABLE IF NOT EXISTS analysis_reports (
      id           TEXT PRIMARY KEY,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      run_time     TEXT NOT NULL,
      run_type     TEXT NOT NULL CHECK(run_type IN ('morning','midday_1','midday_2','preclose','nextday','manual')),
      tickers      TEXT NOT NULL DEFAULT '[]',
      report       TEXT NOT NULL,
      cost_usd     REAL NOT NULL DEFAULT 0,
      model        TEXT NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_analysis_reports_user
      ON analysis_reports(user_id, created_at);
  `)
}

// ─── Interfaces ──────────────────────────────────────────────────

export interface UserRow {
  id: number
  email: string
  password_hash: string | null
  oauth_provider: string | null
  oauth_id: string | null
  created_at: string
}

export interface AgentConfigRow {
  user_id: number
  provider: 'claude-sdk' | 'webhook' | 'websocket' | 'none'
  encrypted_api_key: string | null
  model: string
  max_budget_usd: number
  external_url: string | null
  updated_at: string
}

export function createUser(email: string, passwordHash: string): UserRow {
  const stmt = getDb().prepare('INSERT INTO users (email, password_hash) VALUES (?, ?) RETURNING *')
  return stmt.get(email, passwordHash) as UserRow
}

export function findOrCreateOAuthUser(provider: string, oauthId: string, email: string): UserRow {
  const byOAuth = getDb().prepare(
    'SELECT * FROM users WHERE oauth_provider = ? AND oauth_id = ?'
  ).get(provider, oauthId) as UserRow | undefined
  if (byOAuth) return byOAuth

  const byEmail = findUserByEmail(email)
  if (byEmail) {
    getDb().prepare(
      'UPDATE users SET oauth_provider = ?, oauth_id = ? WHERE id = ?'
    ).run(provider, oauthId, byEmail.id)
    return { ...byEmail, oauth_provider: provider, oauth_id: oauthId }
  }

  const stmt = getDb().prepare(
    'INSERT INTO users (email, oauth_provider, oauth_id) VALUES (?, ?, ?) RETURNING *'
  )
  return stmt.get(email, provider, oauthId) as UserRow
}

export function findUserByEmail(email: string): UserRow | undefined {
  return getDb().prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined
}

export function findUserById(id: number): UserRow | undefined {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
}

export function upsertAgentConfig(
  userId: number,
  provider: string,
  encryptedApiKey: string | null | undefined,
  model: string,
  maxBudgetUsd: number,
  externalUrl: string | null,
): AgentConfigRow {
  if (encryptedApiKey === undefined) {
    const stmt = getDb().prepare(`
      INSERT INTO agent_configs (user_id, provider, model, max_budget_usd, external_url, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        provider = excluded.provider,
        model = excluded.model,
        max_budget_usd = excluded.max_budget_usd,
        external_url = excluded.external_url,
        updated_at = datetime('now')
      RETURNING *
    `)
    return stmt.get(userId, provider, model, maxBudgetUsd, externalUrl) as AgentConfigRow
  }

  const stmt = getDb().prepare(`
    INSERT INTO agent_configs (user_id, provider, encrypted_api_key, model, max_budget_usd, external_url, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      provider = excluded.provider,
      encrypted_api_key = excluded.encrypted_api_key,
      model = excluded.model,
      max_budget_usd = excluded.max_budget_usd,
      external_url = excluded.external_url,
      updated_at = datetime('now')
    RETURNING *
  `)
  return stmt.get(userId, provider, encryptedApiKey, model, maxBudgetUsd, externalUrl) as AgentConfigRow
}

export function getAgentConfig(userId: number): AgentConfigRow | undefined {
  return getDb().prepare('SELECT * FROM agent_configs WHERE user_id = ?').get(userId) as AgentConfigRow | undefined
}

export function getAllActiveConfigs(): (AgentConfigRow & { email: string })[] {
  return getDb().prepare(`
    SELECT ac.*, u.email FROM agent_configs ac
    JOIN users u ON u.id = ac.user_id
    WHERE ac.provider != 'none'
  `).all() as (AgentConfigRow & { email: string })[]
}

// ─── Watchlists ──────────────────────────────────────────────────

export interface WatchlistRow {
  id: number
  user_id: number
  name: string
  created_at: string
}

export interface WatchlistItemRow {
  id: number
  watchlist_id: number
  ticker: string
  layer: string | null
  strategies: string
  thesis: string
  instrument_type: 'equity' | 'crypto'
  sort_order: number
}

export function getUserWatchlists(userId: number): WatchlistRow[] {
  return getDb().prepare('SELECT * FROM watchlists WHERE user_id = ? ORDER BY name').all(userId) as WatchlistRow[]
}

export function getOrCreateDefaultWatchlist(userId: number): WatchlistRow {
  const existing = getDb().prepare(
    "SELECT * FROM watchlists WHERE user_id = ? AND name = 'Default'"
  ).get(userId) as WatchlistRow | undefined
  if (existing) return existing

  return getDb().prepare(
    "INSERT INTO watchlists (user_id, name) VALUES (?, 'Default') RETURNING *"
  ).get(userId) as WatchlistRow
}

export function getWatchlistItems(watchlistId: number): WatchlistItemRow[] {
  return getDb().prepare(
    'SELECT * FROM watchlist_items WHERE watchlist_id = ? ORDER BY sort_order, ticker'
  ).all(watchlistId) as WatchlistItemRow[]
}

export function upsertWatchlistItem(
  watchlistId: number,
  ticker: string,
  layer: string | null,
  strategies: string,
  thesis: string,
  instrumentType: string,
  sortOrder: number,
): WatchlistItemRow {
  return getDb().prepare(`
    INSERT INTO watchlist_items (watchlist_id, ticker, layer, strategies, thesis, instrument_type, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(watchlist_id, ticker) DO UPDATE SET
      layer = excluded.layer,
      strategies = excluded.strategies,
      thesis = excluded.thesis,
      instrument_type = excluded.instrument_type,
      sort_order = excluded.sort_order
    RETURNING *
  `).get(watchlistId, ticker, layer, strategies, thesis, instrumentType, sortOrder) as WatchlistItemRow
}

export function deleteWatchlistItem(watchlistId: number, ticker: string): void {
  getDb().prepare('DELETE FROM watchlist_items WHERE watchlist_id = ? AND ticker = ?').run(watchlistId, ticker)
}

export function replaceWatchlistItems(
  watchlistId: number,
  items: { ticker: string; layer: string | null; strategies: string; thesis: string; instrumentType: string; sortOrder: number }[],
): void {
  const tx = getDb().transaction(() => {
    getDb().prepare('DELETE FROM watchlist_items WHERE watchlist_id = ?').run(watchlistId)
    const insert = getDb().prepare(`
      INSERT INTO watchlist_items (watchlist_id, ticker, layer, strategies, thesis, instrument_type, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    for (const item of items) {
      insert.run(watchlistId, item.ticker, item.layer, item.strategies, item.thesis, item.instrumentType, item.sortOrder)
    }
  })
  tx()
}

export function getAllUserTickers(userId: number): string[] {
  const rows = getDb().prepare(`
    SELECT DISTINCT wi.ticker FROM watchlist_items wi
    JOIN watchlists w ON w.id = wi.watchlist_id
    WHERE w.user_id = ?
  `).all(userId) as { ticker: string }[]
  return rows.map(r => r.ticker)
}

// ─── Schedule Configs ────────────────────────────────────────────

export interface ScheduleConfigRow {
  user_id: number
  runs_per_day: number
  run_times_ct: string
  daily_budget_usd: number
  per_run_budget_usd: number
  include_chains: number
  max_tickers_per_run: number
  enabled: number
  updated_at: string
}

export function getScheduleConfig(userId: number): ScheduleConfigRow | undefined {
  return getDb().prepare('SELECT * FROM schedule_configs WHERE user_id = ?').get(userId) as ScheduleConfigRow | undefined
}

export function upsertScheduleConfig(userId: number, cfg: Partial<Omit<ScheduleConfigRow, 'user_id' | 'updated_at'>>): ScheduleConfigRow {
  const defaults = getScheduleConfig(userId)
  const vals = {
    runs_per_day: cfg.runs_per_day ?? defaults?.runs_per_day ?? 4,
    run_times_ct: cfg.run_times_ct ?? defaults?.run_times_ct ?? '["09:45","11:30","13:30","15:00"]',
    daily_budget_usd: cfg.daily_budget_usd ?? defaults?.daily_budget_usd ?? 2.0,
    per_run_budget_usd: cfg.per_run_budget_usd ?? defaults?.per_run_budget_usd ?? 0.5,
    include_chains: cfg.include_chains ?? defaults?.include_chains ?? 1,
    max_tickers_per_run: cfg.max_tickers_per_run ?? defaults?.max_tickers_per_run ?? 10,
    enabled: cfg.enabled ?? defaults?.enabled ?? 1,
  }
  return getDb().prepare(`
    INSERT INTO schedule_configs (user_id, runs_per_day, run_times_ct, daily_budget_usd, per_run_budget_usd, include_chains, max_tickers_per_run, enabled, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      runs_per_day = excluded.runs_per_day,
      run_times_ct = excluded.run_times_ct,
      daily_budget_usd = excluded.daily_budget_usd,
      per_run_budget_usd = excluded.per_run_budget_usd,
      include_chains = excluded.include_chains,
      max_tickers_per_run = excluded.max_tickers_per_run,
      enabled = excluded.enabled,
      updated_at = datetime('now')
    RETURNING *
  `).get(userId, vals.runs_per_day, vals.run_times_ct, vals.daily_budget_usd, vals.per_run_budget_usd, vals.include_chains, vals.max_tickers_per_run, vals.enabled) as ScheduleConfigRow
}

export function getAllEnabledSchedules(): (ScheduleConfigRow & { email: string })[] {
  return getDb().prepare(`
    SELECT sc.*, u.email FROM schedule_configs sc
    JOIN users u ON u.id = sc.user_id
    WHERE sc.enabled = 1
  `).all() as (ScheduleConfigRow & { email: string })[]
}

// ─── Token Usage ─────────────────────────────────────────────────

export interface TokenUsageRow {
  id: number
  user_id: number
  date: string
  source: 'scheduled' | 'chat' | 'alert' | 'manual'
  run_id: string | null
  cost_usd: number
  tokens_in: number
  tokens_out: number
  created_at: string
}

export function recordTokenUsage(
  userId: number,
  source: TokenUsageRow['source'],
  costUsd: number,
  tokensIn: number,
  tokensOut: number,
  runId?: string,
): void {
  const date = new Date().toISOString().slice(0, 10)
  getDb().prepare(`
    INSERT INTO token_usage (user_id, date, source, run_id, cost_usd, tokens_in, tokens_out)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(userId, date, source, runId ?? null, costUsd, tokensIn, tokensOut)
}

export function getDailySpend(userId: number, date?: string): number {
  const d = date ?? new Date().toISOString().slice(0, 10)
  const row = getDb().prepare(
    'SELECT COALESCE(SUM(cost_usd), 0) as total FROM token_usage WHERE user_id = ? AND date = ?'
  ).get(userId, d) as { total: number }
  return row.total
}

export function getUsageSummary(userId: number, days = 7): { date: string; total: number; scheduled: number; chat: number; alert: number }[] {
  return getDb().prepare(`
    SELECT date,
      COALESCE(SUM(cost_usd), 0) as total,
      COALESCE(SUM(CASE WHEN source = 'scheduled' THEN cost_usd ELSE 0 END), 0) as scheduled,
      COALESCE(SUM(CASE WHEN source = 'chat' THEN cost_usd ELSE 0 END), 0) as chat,
      COALESCE(SUM(CASE WHEN source = 'alert' THEN cost_usd ELSE 0 END), 0) as alert
    FROM token_usage WHERE user_id = ? AND date >= date('now', ?)
    GROUP BY date ORDER BY date DESC
  `).all(userId, `-${days} days`) as { date: string; total: number; scheduled: number; chat: number; alert: number }[]
}

// ─── Analysis Reports ────────────────────────────────────────────

export interface AnalysisReportRow {
  id: string
  user_id: number
  run_time: string
  run_type: 'morning' | 'midday_1' | 'midday_2' | 'preclose' | 'nextday' | 'manual'
  tickers: string
  report: string
  cost_usd: number
  model: string
  created_at: string
}

export function insertReport(report: Omit<AnalysisReportRow, 'created_at'>): AnalysisReportRow {
  return getDb().prepare(`
    INSERT INTO analysis_reports (id, user_id, run_time, run_type, tickers, report, cost_usd, model)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(report.id, report.user_id, report.run_time, report.run_type, report.tickers, report.report, report.cost_usd, report.model) as AnalysisReportRow
}

export function getReportsForDate(userId: number, date?: string): AnalysisReportRow[] {
  const d = date ?? new Date().toISOString().slice(0, 10)
  return getDb().prepare(
    "SELECT * FROM analysis_reports WHERE user_id = ? AND date(created_at) = ? ORDER BY created_at DESC"
  ).all(userId, d) as AnalysisReportRow[]
}

export function getLatestReport(userId: number): AnalysisReportRow | undefined {
  return getDb().prepare(
    'SELECT * FROM analysis_reports WHERE user_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(userId) as AnalysisReportRow | undefined
}
