import type { WatchlistItem, Watchlist } from '@tastytrade-monitor/shared'
import { getClient } from './tastytrade-auth.js'
import { config } from './config.js'
import { log } from './logger.js'
import {
  getUserWatchlists,
  getOrCreateDefaultWatchlist,
  getWatchlistItems,
  replaceWatchlistItems,
  deleteWatchlistItem,
  getAllUserTickers,
  type WatchlistItemRow,
} from './db.js'
import { WATCHLIST } from './watchlist.config.js'

export function getUserWatchlistsWithItems(userId: number): Watchlist[] {
  const lists = getUserWatchlists(userId)

  if (lists.length === 0) {
    seedDefaultWatchlist(userId)
    return getUserWatchlistsWithItems(userId)
  }

  return lists.map(wl => ({
    id: wl.id,
    name: wl.name,
    items: getWatchlistItems(wl.id).map(rowToItem),
  }))
}

export function saveWatchlist(userId: number, name: string, items: WatchlistItem[]): Watchlist {
  const wl = getOrCreateDefaultWatchlist(userId)
  const dbName = name || wl.name

  replaceWatchlistItems(
    wl.id,
    items.map((item, idx) => ({
      ticker: item.ticker.toUpperCase(),
      layer: item.layer,
      strategies: JSON.stringify(item.strategies),
      thesis: item.thesis,
      instrumentType: item.instrumentType,
      sortOrder: item.sortOrder ?? idx,
    })),
  )

  return {
    id: wl.id,
    name: dbName,
    items: getWatchlistItems(wl.id).map(rowToItem),
  }
}

export function removeWatchlistItem(userId: number, watchlistName: string, ticker: string): void {
  const lists = getUserWatchlists(userId)
  const wl = lists.find(l => l.name === watchlistName) ?? lists[0]
  if (!wl) return
  deleteWatchlistItem(wl.id, ticker.toUpperCase())
}

export function getUserTickers(userId: number): string[] {
  return getAllUserTickers(userId)
}

/**
 * Sync watchlists from the tastytrade platform into local DB.
 * Uses the REST API: GET /watchlists
 */
export async function syncFromTastytrade(userId: number): Promise<Watchlist[]> {
  if (config.tastytrade.env === 'sandbox') {
    log.info('Watchlist sync skipped in sandbox mode')
    return getUserWatchlistsWithItems(userId)
  }

  try {
    const client = getClient()
    const raw = await (client as Record<string, unknown> & typeof client).watchlistsService?.getAllWatchlists() as unknown
    if (!raw) {
      log.warn('Watchlist API returned null — tastytrade SDK may not expose this endpoint')
      return getUserWatchlistsWithItems(userId)
    }

    const lists = Array.isArray(raw) ? raw : (raw as Record<string, unknown>)?.items as unknown[] ?? []
    log.info(`Fetched ${lists.length} watchlists from tastytrade`)

    for (const list of lists) {
      const wlData = list as Record<string, unknown>
      const name = String(wlData.name ?? 'Imported')
      const entries = (wlData['watchlist-entries'] ?? wlData.entries ?? []) as Record<string, unknown>[]

      const items: WatchlistItem[] = entries.map((e, idx) => ({
        ticker: String(e.symbol ?? e['underlying-symbol'] ?? '').toUpperCase(),
        layer: null,
        strategies: [],
        thesis: '',
        instrumentType: 'equity' as const,
        sortOrder: idx,
      })).filter(i => i.ticker)

      if (items.length > 0) {
        saveWatchlist(userId, name, items)
      }
    }

    return getUserWatchlistsWithItems(userId)
  } catch (err) {
    log.error(`Failed to sync watchlists from tastytrade: ${(err as Error).message}`)
    return getUserWatchlistsWithItems(userId)
  }
}

/**
 * Search for symbols using the tastytrade instruments API.
 */
export async function searchSymbols(query: string): Promise<{ ticker: string; description: string; instrumentType: string }[]> {
  if (!query || query.length < 1) return []

  try {
    const client = getClient()
    const svc = client.instrumentsService as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>
    const raw = await (svc.getEquities ?? svc.searchSymbol ?? svc.getEquity)?.([query.toUpperCase()]) as unknown
    const items = Array.isArray(raw) ? raw : (raw as Record<string, unknown>)?.items as unknown[] ?? []

    return items.slice(0, 20).map(item => {
      const d = item as Record<string, unknown>
      return {
        ticker: String(d.symbol ?? d['underlying-symbol'] ?? ''),
        description: String(d.description ?? d['short-description'] ?? ''),
        instrumentType: String(d['instrument-type'] ?? 'equity').toLowerCase().includes('crypto') ? 'crypto' : 'equity',
      }
    }).filter(i => i.ticker)
  } catch (err) {
    log.warn(`Symbol search failed for "${query}": ${(err as Error).message}`)
    return query.length >= 1
      ? [{ ticker: query.toUpperCase(), description: 'Manual entry', instrumentType: 'equity' }]
      : []
  }
}

function seedDefaultWatchlist(userId: number): void {
  const wl = getOrCreateDefaultWatchlist(userId)
  replaceWatchlistItems(
    wl.id,
    WATCHLIST.map((entry, idx) => ({
      ticker: entry.ticker,
      layer: entry.layer,
      strategies: JSON.stringify(entry.strategies),
      thesis: entry.thesis,
      instrumentType: entry.instrumentType,
      sortOrder: idx,
    })),
  )
  log.info(`Seeded default watchlist for user ${userId} with ${WATCHLIST.length} items`)
}

function rowToItem(row: WatchlistItemRow): WatchlistItem {
  let strategies: string[] = []
  try { strategies = JSON.parse(row.strategies) } catch { /* empty */ }
  return {
    ticker: row.ticker,
    layer: row.layer,
    strategies,
    thesis: row.thesis,
    instrumentType: row.instrument_type,
    sortOrder: row.sort_order,
  }
}
