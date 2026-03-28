import type { TradeSignal } from '@tastytrade-monitor/shared'

export interface TradeRecommendation {
  signal: string
  trade: string
  size: string
  thesis: string
  stop: string
  invalidation: string
}

export function parseRecommendation(
  alertId: string,
  ticker: string,
  rec: TradeRecommendation,
): TradeSignal | null {
  const trade = parseTradeLine(rec.trade)
  if (!trade) return null

  const sizeMatch = rec.size.match(/([\d.]+)\s*%/)
  const sizePercent = sizeMatch ? parseFloat(sizeMatch[1]) : 2

  return {
    alertId,
    ticker: trade.ticker || ticker,
    action: trade.action,
    instrument: trade.instrument,
    strike: trade.strike,
    expiration: trade.expiration,
    price: trade.price,
    sizePercent: Math.min(sizePercent, 5),
    thesis: rec.thesis,
    stopCondition: rec.stop,
    invalidation: rec.invalidation,
  }
}

export function parseAnalysisText(
  alertId: string,
  ticker: string,
  analysisText: string,
): TradeSignal | null {
  const rec = extractRecommendationFromMarkdown(analysisText)
  if (!rec) return null
  return parseRecommendation(alertId, ticker, rec)
}

function extractRecommendationFromMarkdown(text: string): TradeRecommendation | null {
  const fields: Record<string, string> = {}
  const pattern = /\*\*(\w+)\*\*:\s*(.+?)(?=\n\*\*|\n*$)/gs
  let match
  while ((match = pattern.exec(text)) !== null) {
    fields[match[1].toLowerCase()] = match[2].trim()
  }

  if (!fields.trade) return null

  return {
    signal: fields.signal ?? '',
    trade: fields.trade,
    size: fields.size ?? '2%',
    thesis: fields.thesis ?? '',
    stop: fields.stop ?? '',
    invalidation: fields.invalidation ?? '',
  }
}

interface ParsedTrade {
  action: 'buy' | 'sell'
  instrument: 'call' | 'put' | 'stock'
  ticker: string
  strike: number | null
  expiration: string | null
  price: number
}

function parseTradeLine(trade: string): ParsedTrade | null {
  if (/spot only|no options|n\/a/i.test(trade)) return null

  const normalized = trade.replace(/[$,]/g, '')

  const actionMatch = normalized.match(/^(buy|sell)\s+/i)
  if (!actionMatch) return null
  const action = actionMatch[1].toLowerCase() as 'buy' | 'sell'

  let instrument: 'call' | 'put' | 'stock' = 'stock'
  if (/\bcall\b/i.test(normalized)) instrument = 'call'
  else if (/\bput\b/i.test(normalized)) instrument = 'put'

  const tickerMatch = normalized.match(/(?:call|put|stock|spread)\s+([A-Z]{1,5})/i)
  const ticker = tickerMatch ? tickerMatch[1].toUpperCase() : ''

  let strike: number | null = null
  if (instrument !== 'stock') {
    const strikeMatch = normalized.match(/[A-Z]{1,5}\s+([\d.]+)/)
    strike = strikeMatch ? parseFloat(strikeMatch[1]) : null
  }

  let expiration: string | null = null
  const dateMatch = normalized.match(/(\d{4}-\d{2}-\d{2})/)
  if (dateMatch) {
    expiration = dateMatch[1]
  } else {
    const monthMatch = normalized.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i)
    if (monthMatch) {
      expiration = monthMatch[0]
    }
  }

  const priceMatch = normalized.match(/@\s*([\d.]+)/)
  const price = priceMatch ? parseFloat(priceMatch[1]) : 0

  if (price === 0) return null

  return { action, instrument, ticker, strike, expiration, price }
}
