import { config as dotenvConfig } from 'dotenv'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Walk up from packages/monitor/dist (or src) to find .env at repo root
let envDir = __dirname
for (let i = 0; i < 5; i++) {
  if (existsSync(resolve(envDir, '.env'))) break
  envDir = resolve(envDir, '..')
}
dotenvConfig({ path: resolve(envDir, '.env') })

export const config = {
  tastytrade: {
    clientId: process.env.TASTYTRADE_CLIENT_ID ?? '',
    clientSecret: process.env.TASTYTRADE_CLIENT_SECRET ?? '',
    refreshToken: process.env.TASTYTRADE_REFRESH_TOKEN ?? '',
    env: (process.env.TASTYTRADE_ENV ?? 'sandbox') as 'sandbox' | 'production',
    enableTradeScope: process.env.TASTYTRADE_ENABLE_TRADE_SCOPE === 'true',
  },
  triggers: {
    ivSpikePct: 15,
    priceMoveWindowMin: 10,
    priceMovePct: 3,
    cryptoPriceMovePct: 5,
    ivRankBuyThreshold: 20,
    ivRankSellThreshold: 50,
  },
  schedule: {
    timezone: 'America/Chicago',
    openRunMinutesAfterOpen: 15,
    closeRunMinutesBefore: 60,
  },
  rateLimit: {
    minMsBetweenRestCalls: 150,
    alertCooldownMs: 300_000,
  },
  server: {
    wsPort: parseInt(process.env.WS_PORT ?? process.env.PORT ?? '3001', 10),
    serveDashboard: process.env.SERVE_DASHBOARD === 'true',
  },
} as const
