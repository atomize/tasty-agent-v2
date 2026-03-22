import type { OptionExpiration, OptionStrike } from '@tastytrade-monitor/shared'
import { MarketDataSubscriptionType } from '@tastytrade/api'
import { getClient } from './tastytrade-auth.js'
import { getEntryByTicker } from './watchlist.config.js'
import { config } from './config.js'
import { log } from './logger.js'

const ENRICHMENT_TIMEOUT_MS = 3_500

/**
 * Fetch the nearest N expirations for a symbol's option chain.
 *
 * 1. Calls the tastytrade REST API `/option-chains/{symbol}/nested` to get the
 *    chain structure (expirations, strikes, streamer symbols).
 * 2. Subscribes to DXLink for Quote + Greeks events on each option to fill in
 *    bid/ask, OI, delta, and IV.
 * 3. Unsubscribes and returns the merged result.
 *
 * On sandbox the REST endpoint returns 502 — we skip the call entirely and
 * return an empty array so the dashboard can show a clear message.
 */
export async function fetchOptionChain(
  symbol: string,
  maxExpirations = 3,
): Promise<OptionExpiration[]> {
  const entry = getEntryByTicker(symbol)
  if (entry?.instrumentType === 'crypto') return []

  if (config.tastytrade.env === 'sandbox') {
    log.info(`Option chains not available in sandbox mode (${symbol})`)
    return []
  }

  try {
    const client = getClient()
    const raw = await client.instrumentsService.getNestedOptionChain(symbol) as unknown

    const chainItems = normalizeChainItems(raw)
    if (chainItems.length === 0) {
      log.warn(`No option chain data for ${symbol}`)
      return []
    }

    const allExpirations = chainItems[0].expirations ?? []
    const today = new Date()

    const sorted = allExpirations
      .filter(exp => {
        const d = exp['expiration-date'] ?? ''
        return d && new Date(d) > today
      })
      .sort((a, b) =>
        (a['expiration-date'] ?? '').localeCompare(b['expiration-date'] ?? ''),
      )
      .slice(0, maxExpirations)

    if (sorted.length === 0) return []

    const { results, streamerSymbols, symbolMap } = buildResults(sorted, today)

    if (streamerSymbols.length > 0) {
      try {
        await enrichWithMarketData(results, symbolMap, streamerSymbols)
      } catch (err) {
        log.warn(`Could not enrich chain for ${symbol}: ${(err as Error).message}`)
      }
    }

    log.info(`Fetched option chain for ${symbol}: ${results.length} expirations, ${streamerSymbols.length} options`)
    return results
  } catch (err) {
    log.error(`Failed to fetch option chain for ${symbol}:`, err)
    return []
  }
}

// ─── Response parsing ────────────────────────────────────────────

interface NestedStrike {
  'strike-price'?: string
  call?: string
  put?: string
  'call-streamer-symbol'?: string
  'put-streamer-symbol'?: string
}

interface NestedExpiration {
  'expiration-date'?: string
  'days-to-expiration'?: number
  'expiration-type'?: string
  strikes?: NestedStrike[]
}

interface NestedChainItem {
  'underlying-symbol'?: string
  expirations?: NestedExpiration[]
}

function normalizeChainItems(raw: unknown): NestedChainItem[] {
  if (!raw) return []
  if (Array.isArray(raw)) {
    if (raw.length === 0) return []
    if (raw[0]?.expirations) return raw as NestedChainItem[]
    if (raw[0]?.['expiration-date']) return [{ expirations: raw }] as NestedChainItem[]
    return []
  }
  const obj = raw as Record<string, unknown>
  if (obj.expirations) return [raw as NestedChainItem]
  if (obj.items && Array.isArray(obj.items)) return normalizeChainItems(obj.items)
  return []
}

// ─── Build skeleton results ──────────────────────────────────────

interface SymbolRef { expIdx: number; strikeIdx: number; side: 'call' | 'put' }

function buildResults(sorted: NestedExpiration[], today: Date) {
  const symbolMap = new Map<string, SymbolRef>()
  const streamerSymbols: string[] = []

  const results: OptionExpiration[] = sorted.map((exp, expIdx) => {
    const expDate = exp['expiration-date'] ?? ''
    const dte = exp['days-to-expiration'] ??
      Math.ceil((new Date(expDate).getTime() - today.getTime()) / 86_400_000)

    const strikes: OptionStrike[] = (exp.strikes ?? []).map((s, strikeIdx) => {
      const callSym = s['call-streamer-symbol']
      const putSym = s['put-streamer-symbol']
      if (callSym) {
        symbolMap.set(callSym, { expIdx, strikeIdx, side: 'call' })
        streamerSymbols.push(callSym)
      }
      if (putSym) {
        symbolMap.set(putSym, { expIdx, strikeIdx, side: 'put' })
        streamerSymbols.push(putSym)
      }
      return {
        strike: parseFloat(String(s['strike-price'])) || 0,
        callBid: 0, callAsk: 0, callVolume: 0, callOI: 0,
        callDelta: undefined, callIV: undefined,
        callStreamerSymbol: callSym,
        putBid: 0, putAsk: 0, putVolume: 0, putOI: 0,
        putDelta: undefined, putIV: undefined,
        putStreamerSymbol: putSym,
      }
    })

    return { expiration: expDate, daysToExpiry: dte, strikes }
  })

  return { results, streamerSymbols, symbolMap }
}

// ─── DXLink market data enrichment ──────────────────────────────

async function enrichWithMarketData(
  results: OptionExpiration[],
  symbolMap: Map<string, SymbolRef>,
  streamerSymbols: string[],
): Promise<void> {
  const client = getClient()
  const streamer = client.quoteStreamer

  if (!streamer.dxLinkFeed) {
    log.warn('QuoteStreamer not connected, skipping option enrichment')
    return
  }

  return new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      cleanup()
      resolve()
    }, ENRICHMENT_TIMEOUT_MS)

    let received = 0
    const target = streamerSymbols.length

    function applyEvent(event: Record<string, unknown>) {
      const sym = event.eventSymbol as string | undefined
      if (!sym) return
      const ref = symbolMap.get(sym)
      if (!ref) return

      const strike = results[ref.expIdx]?.strikes?.[ref.strikeIdx]
      if (!strike) return

      const prefix = ref.side === 'call' ? 'call' : 'put'
      const eventType = event.eventType as string

      if (eventType === 'Quote') {
        const bid = asNumber(event.bidPrice)
        const ask = asNumber(event.askPrice)
        if (prefix === 'call') {
          strike.callBid = bid; strike.callAsk = ask
        } else {
          strike.putBid = bid; strike.putAsk = ask
        }
        received++
      } else if (eventType === 'Greeks') {
        const delta = asOptNumber(event.delta)
        const iv = asOptNumber(event.volatility)
        if (prefix === 'call') {
          strike.callDelta = delta; strike.callIV = iv
        } else {
          strike.putDelta = delta; strike.putIV = iv
        }
        received++
      } else if (eventType === 'Summary') {
        const oi = asNumber(event.openInterest)
        const vol = asNumber(event.dayVolume ?? event.volume)
        if (prefix === 'call') {
          strike.callOI = oi; strike.callVolume = vol
        } else {
          strike.putOI = oi; strike.putVolume = vol
        }
      }

      if (received >= target) {
        clearTimeout(timeout)
        cleanup()
        resolve()
      }
    }

    const removeListener = streamer.addEventListener((events) => {
      const arr = Array.isArray(events) ? events : [events]
      for (const e of arr) applyEvent(e as Record<string, unknown>)
    })

    function cleanup() {
      removeListener()
      try { streamer.unsubscribe(streamerSymbols) } catch { /* already disconnected */ }
    }

    streamer.subscribe(streamerSymbols, [
      MarketDataSubscriptionType.Quote,
      MarketDataSubscriptionType.Greeks,
      MarketDataSubscriptionType.Summary,
    ])
  })
}

function asNumber(v: unknown): number {
  if (typeof v === 'number' && isFinite(v)) return v
  if (typeof v === 'string') {
    const n = parseFloat(v)
    return isFinite(n) ? n : 0
  }
  return 0
}

function asOptNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && isFinite(v)) return v
  if (typeof v === 'string') {
    const n = parseFloat(v)
    return isFinite(n) ? n : undefined
  }
  return undefined
}
