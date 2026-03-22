import type TastytradeClient from '@tastytrade/api'
import { MarketDataSubscriptionType } from '@tastytrade/api'
import { getUniqueSymbols, WATCHLIST } from './watchlist.config.js'
import {
  updateQuote,
  updateTrade,
  updateSummary,
  updateProfile,
} from './state.js'
import { checkTriggers } from './triggers.js'
import { log } from './logger.js'

let reconnectAttempts = 0
const MAX_RECONNECT_DELAY = 60_000

const cryptoStreamerMap = new Map<string, string>()

async function resolveCryptoStreamerSymbols(client: TastytradeClient): Promise<void> {
  const cryptoTickers = WATCHLIST
    .filter(e => e.instrumentType === 'crypto')
    .map(e => e.ticker)

  if (cryptoTickers.length === 0) return

  try {
    const response = await client.instrumentsService.getCryptocurrencies(cryptoTickers) as Record<string, unknown>
    const items = (response?.items ?? response) as Record<string, unknown>[]

    if (!Array.isArray(items)) {
      log.warn('No crypto instruments returned from API')
      return
    }

    for (const item of items) {
      const symbol = String(item.symbol ?? '')
      const streamerSymbol = String(item['streamer-symbol'] ?? item.streamerSymbol ?? '')
      if (symbol && streamerSymbol) {
        cryptoStreamerMap.set(symbol, streamerSymbol)
        log.info(`Crypto streamer symbol: ${symbol} → ${streamerSymbol}`)
      }
    }
  } catch (err) {
    log.warn('Could not resolve crypto streamer symbols, using ticker names as fallback:', err)
  }
}

function resolveStreamerSymbol(ticker: string): string {
  return cryptoStreamerMap.get(ticker) ?? ticker
}

export async function startStreamer(client: TastytradeClient): Promise<void> {
  await resolveCryptoStreamerSymbols(client)
  buildReverseMap()

  const symbols = getUniqueSymbols().map(resolveStreamerSymbol)
  log.info(`Subscribing to ${symbols.length} symbols via DXLink...`)

  const streamer = client.quoteStreamer

  streamer.addEventListener((events) => {
    if (Array.isArray(events)) {
      for (const event of events) {
        try { processEvent(event) } catch (err) { log.error('Event processing error:', err) }
      }
    } else {
      try { processEvent(events) } catch (err) { log.error('Event processing error:', err) }
    }
  })

  try {
    await streamer.connect()
    reconnectAttempts = 0
    log.info('DXLink streamer connected')

    streamer.subscribe(symbols, [
      MarketDataSubscriptionType.Quote,
      MarketDataSubscriptionType.Trade,
      MarketDataSubscriptionType.Summary,
      MarketDataSubscriptionType.Profile,
    ])
    log.info(`Subscribed to ${symbols.length} symbols`)
  } catch (err) {
    log.error('Streamer connection failed:', err)
    scheduleReconnect(client)
  }
}

function scheduleReconnect(client: TastytradeClient): void {
  const delay = Math.min(1000 * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY)
  reconnectAttempts++
  log.warn(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts})...`)
  setTimeout(() => startStreamer(client), delay)
}

const reverseStreamerMap = new Map<string, string>()

function buildReverseMap(): void {
  for (const [ticker, streamer] of cryptoStreamerMap) {
    reverseStreamerMap.set(streamer, ticker)
  }
}

function resolveEventTicker(eventSymbol: string): string {
  return reverseStreamerMap.get(eventSymbol) ?? eventSymbol
}

interface DxEvent {
  eventType?: string
  eventSymbol?: string
  [key: string]: unknown
}

function processEvent(raw: unknown): void {
  const event = raw as DxEvent
  const rawSymbol = event.eventSymbol as string | undefined
  if (!rawSymbol) return
  const ticker = resolveEventTicker(rawSymbol)

  switch (event.eventType) {
    case 'Quote':
      updateQuote(
        ticker,
        asNumber(event.bidPrice),
        asNumber(event.askPrice),
      )
      checkTriggers(ticker)
      break

    case 'Trade':
      updateTrade(
        ticker,
        asNumber(event.price),
        asNumber(event.dayVolume),
      )
      checkTriggers(ticker)
      break

    case 'Summary':
      updateSummary(ticker, {
        prevDayClose: asOptNumber(event.prevDayClosePrice),
        dayOpen: asOptNumber(event.dayOpenPrice),
        dayHigh: asOptNumber(event.dayHighPrice),
        dayLow: asOptNumber(event.dayLowPrice),
        openInterest: asOptNumber(event.openInterest),
      })
      break

    case 'Profile':
      updateProfile(ticker, {
        high52Week: asOptNumber(event.high52WeekPrice),
        low52Week: asOptNumber(event.low52WeekPrice),
        beta: asOptNumber(event.beta),
        description: event.description as string | undefined,
        tradingStatus: event.tradingStatus as string | undefined,
      })
      break
  }
}

function asNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0
}

function asOptNumber(v: unknown): number | undefined {
  return typeof v === 'number' && isFinite(v) ? v : undefined
}
