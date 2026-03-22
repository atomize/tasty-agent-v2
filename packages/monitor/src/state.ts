import type { TickerSnapshot } from '@tastytrade-monitor/shared'
import { WATCHLIST, getEntryByTicker } from './watchlist.config.js'
import { config } from './config.js'

export interface PricePoint {
  price: number
  timestamp: number
}

export interface IvPoint {
  iv: number
  timestamp: number
}

interface TickerState {
  snapshot: TickerSnapshot
  priceHistory: PricePoint[]
  ivHistory: IvPoint[]
}

const state = new Map<string, TickerState>()

function freshSnapshot(ticker: string): TickerSnapshot {
  const entry = getEntryByTicker(ticker)
  return {
    ticker,
    price: 0,
    bid: 0,
    ask: 0,
    priceChange1D: 0,
    priceChangePct1D: 0,
    volume: 0,
    layer: entry?.layer ?? null,
    strategies: entry?.strategies ?? [],
    isDelayed: config.tastytrade.env === 'sandbox',
    lastUpdated: new Date().toISOString(),
  }
}

export function initState(): void {
  for (const entry of WATCHLIST) {
    if (!state.has(entry.ticker)) {
      state.set(entry.ticker, {
        snapshot: freshSnapshot(entry.ticker),
        priceHistory: [],
        ivHistory: [],
      })
    }
  }
}

export function getSnapshot(ticker: string): TickerSnapshot | undefined {
  return state.get(ticker)?.snapshot
}

export function getAllSnapshots(): TickerSnapshot[] {
  return Array.from(state.values()).map(s => s.snapshot)
}

export function getPriceHistory(ticker: string): PricePoint[] {
  return state.get(ticker)?.priceHistory ?? []
}

export function getIvHistory(ticker: string): IvPoint[] {
  return state.get(ticker)?.ivHistory ?? []
}

const MAX_HISTORY = 200

export function updateQuote(ticker: string, bid: number, ask: number): void {
  const ts = state.get(ticker)
  if (!ts) return

  ts.snapshot.bid = bid
  ts.snapshot.ask = ask
  const mid = (bid + ask) / 2
  if (mid > 0) {
    ts.snapshot.price = mid
    updateDayChange(ts.snapshot)
  }
  ts.snapshot.lastUpdated = new Date().toISOString()
}

export function updateTrade(ticker: string, price: number, volume: number): void {
  const ts = state.get(ticker)
  if (!ts) return

  ts.snapshot.price = price
  ts.snapshot.volume = volume
  updateDayChange(ts.snapshot)
  ts.snapshot.lastUpdated = new Date().toISOString()

  ts.priceHistory.push({ price, timestamp: Date.now() })
  if (ts.priceHistory.length > MAX_HISTORY) {
    ts.priceHistory.splice(0, ts.priceHistory.length - MAX_HISTORY)
  }
}

export function updateSummary(
  ticker: string,
  data: {
    prevDayClose?: number
    dayOpen?: number
    dayHigh?: number
    dayLow?: number
    openInterest?: number
  }
): void {
  const ts = state.get(ticker)
  if (!ts) return

  if (data.prevDayClose != null) ts.snapshot.prevDayClose = data.prevDayClose
  if (data.dayOpen != null) ts.snapshot.dayOpen = data.dayOpen
  if (data.dayHigh != null) ts.snapshot.dayHigh = data.dayHigh
  if (data.dayLow != null) ts.snapshot.dayLow = data.dayLow
  if (data.openInterest != null) ts.snapshot.openInterest = data.openInterest

  updateDayChange(ts.snapshot)
}

export function updateProfile(
  ticker: string,
  data: {
    high52Week?: number
    low52Week?: number
    beta?: number
    description?: string
    tradingStatus?: string
  }
): void {
  const ts = state.get(ticker)
  if (!ts) return

  if (data.high52Week != null) ts.snapshot.high52Week = data.high52Week
  if (data.low52Week != null) ts.snapshot.low52Week = data.low52Week
  if (data.beta != null) ts.snapshot.beta = data.beta
  if (data.description != null) ts.snapshot.description = data.description
  if (data.tradingStatus != null) ts.snapshot.tradingStatus = data.tradingStatus
}

export function updateMarketMetrics(
  ticker: string,
  data: { iv?: number; ivRank?: number; ivPercentile?: number }
): void {
  const ts = state.get(ticker)
  if (!ts) return

  if (data.iv != null) {
    const oldIv = ts.snapshot.iv
    ts.snapshot.iv = data.iv

    ts.ivHistory.push({ iv: data.iv, timestamp: Date.now() })
    if (ts.ivHistory.length > MAX_HISTORY) {
      ts.ivHistory.splice(0, ts.ivHistory.length - MAX_HISTORY)
    }

    if (oldIv != null && oldIv > 0) {
      ts.snapshot.ivPctChange5Min = ((data.iv - oldIv) / oldIv) * 100
    }
  }
  if (data.ivRank != null) ts.snapshot.ivRank = data.ivRank
  if (data.ivPercentile != null) ts.snapshot.ivPercentile = data.ivPercentile
}

function updateDayChange(snap: TickerSnapshot): void {
  if (snap.prevDayClose && snap.prevDayClose > 0 && snap.price > 0) {
    snap.priceChange1D = snap.price - snap.prevDayClose
    snap.priceChangePct1D = ((snap.price - snap.prevDayClose) / snap.prevDayClose) * 100
  }
}
