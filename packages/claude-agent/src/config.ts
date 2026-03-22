import { config as dotenvConfig } from 'dotenv'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

let envDir = __dirname
for (let i = 0; i < 6; i++) {
  if (existsSync(resolve(envDir, '.env'))) break
  envDir = resolve(envDir, '..')
}
dotenvConfig({ path: resolve(envDir, '.env') })

export const config = {
  claudeApiKey: process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || '',
  model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
  maxBudgetUsd: parseFloat(process.env.CLAUDE_MAX_BUDGET_USD || '0.50'),
  maxTurns: parseInt(process.env.CLAUDE_MAX_TURNS || '5', 10),
  monitorWsUrl: process.env.MONITOR_WS_URL || 'ws://localhost:3001',
  cooldownMs: 300_000,
  maxQueue: 5,
  reconnectMs: 5_000,
  heartbeatMs: 30_000,
} as const
