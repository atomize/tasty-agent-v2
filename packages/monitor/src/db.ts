import Database from 'better-sqlite3'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { log } from './logger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db

  const dataDir = resolve(__dirname, '..', '..', '..', 'data')
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
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      email      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

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
}

export interface UserRow {
  id: number
  email: string
  password_hash: string
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

export function findUserByEmail(email: string): UserRow | undefined {
  return getDb().prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined
}

export function findUserById(id: number): UserRow | undefined {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
}

export function upsertAgentConfig(
  userId: number,
  provider: string,
  encryptedApiKey: string | null,
  model: string,
  maxBudgetUsd: number,
  externalUrl: string | null,
): AgentConfigRow {
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
