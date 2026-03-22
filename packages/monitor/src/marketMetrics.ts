import { getClient } from './tastytrade-auth.js'
import { WATCHLIST, getUniqueSymbols } from './watchlist.config.js'
import { updateMarketMetrics } from './state.js'
import { config } from './config.js'
import { log } from './logger.js'

export async function fetchMarketMetrics(): Promise<void> {
  if (config.tastytrade.env === 'sandbox') {
    log.info('Skipping market-metrics fetch (not available in sandbox)')
    return
  }

  try {
    const client = getClient()
    const cryptoSet = new Set(
      WATCHLIST.filter(e => e.instrumentType === 'crypto').map(e => e.ticker)
    )
    const symbols = getUniqueSymbols().filter(s => !cryptoSet.has(s))

    const response = await client.marketMetricsService.getMarketMetrics({
      symbols: symbols.join(','),
    }) as Record<string, unknown>

    const items = ((response?.items ?? response) as Record<string, unknown>[]) ?? []
    if (!Array.isArray(items)) return

    for (const item of items) {
      const ticker = String(item.symbol ?? '')
      if (!ticker) continue

      updateMarketMetrics(ticker, {
        iv: asOptNumber(item['implied-volatility-index'] ?? item.impliedVolatilityIndex),
        ivRank: asOptNumber(item['iv-rank'] ?? item.ivRank),
        ivPercentile: asOptNumber(item['iv-percentile'] ?? item.ivPercentile),
      })
    }

    log.info(`Market metrics updated for ${items.length} symbols`)
  } catch (err) {
    log.warn('Market metrics fetch failed (may be production-only):', err)
  }
}

export function startMetricsPolling(intervalMs = 60_000): void {
  fetchMarketMetrics()
  setInterval(fetchMarketMetrics, intervalMs)
}

function asOptNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && isFinite(v)) return v
  if (typeof v === 'string') {
    const n = parseFloat(v)
    return isFinite(n) ? n : undefined
  }
  return undefined
}
