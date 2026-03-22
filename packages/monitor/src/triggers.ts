import type { Severity, TriggerType } from '@tastytrade-monitor/shared'
import { config } from './config.js'
import { getSnapshot, getPriceHistory, getIvHistory } from './state.js'
import { getEntryByTicker } from './watchlist.config.js'
import { emitAlert } from './alertBus.js'
import { log } from './logger.js'

const cooldowns = new Map<string, number>()

function cooldownKey(ticker: string, type: TriggerType): string {
  return `${ticker}:${type}`
}

function isOnCooldown(ticker: string, type: TriggerType): boolean {
  const key = cooldownKey(ticker, type)
  const last = cooldowns.get(key)
  if (!last) return false
  return Date.now() - last < config.rateLimit.alertCooldownMs
}

function setCooldown(ticker: string, type: TriggerType): void {
  cooldowns.set(cooldownKey(ticker, type), Date.now())
}

export function checkTriggers(ticker: string): void {
  const entry = getEntryByTicker(ticker)
  const isCrypto = entry?.instrumentType === 'crypto'

  checkPriceMove(ticker, isCrypto)

  if (!isCrypto) {
    checkIvRank(ticker)
    checkIvSpike(ticker)
  }
}

function checkPriceMove(ticker: string, isCrypto = false): void {
  const triggerType: TriggerType = isCrypto ? 'CRYPTO_PRICE_MOVE' : 'PRICE_MOVE'
  if (isOnCooldown(ticker, triggerType)) return

  const history = getPriceHistory(ticker)
  if (history.length < 2) return

  const now = Date.now()
  const windowMs = config.triggers.priceMoveWindowMin * 60_000
  const recent = history.filter(p => now - p.timestamp < windowMs)
  if (recent.length < 2) return

  const oldest = recent[0]
  const newest = recent[recent.length - 1]
  if (oldest.price === 0) return

  const changePct = Math.abs((newest.price - oldest.price) / oldest.price) * 100

  const threshold = isCrypto ? config.triggers.cryptoPriceMovePct : config.triggers.priceMovePct

  if (changePct >= threshold) {
    const severity: Severity =
      changePct >= (isCrypto ? 10 : 6) ? 'high' :
      changePct >= (isCrypto ? 6 : 4) ? 'medium' : 'low'

    setCooldown(ticker, triggerType)
    log.info(`TRIGGER: ${ticker} price moved ${changePct.toFixed(1)}% in ${config.triggers.priceMoveWindowMin}min`)

    emitAlert({
      type: triggerType,
      ticker,
      description: `${ticker} price moved ${changePct.toFixed(1)}% in ${config.triggers.priceMoveWindowMin} minutes`,
      threshold,
      observed: changePct,
      severity,
    })
  }
}

function checkIvRank(ticker: string): void {
  const snap = getSnapshot(ticker)
  if (!snap?.ivRank) return

  if (snap.ivRank >= config.triggers.ivRankSellThreshold) {
    if (isOnCooldown(ticker, 'IV_RANK_HIGH')) return
    const severity: Severity =
      snap.ivRank >= 80 ? 'high' :
      snap.ivRank >= 65 ? 'medium' : 'low'

    setCooldown(ticker, 'IV_RANK_HIGH')
    log.info(`TRIGGER: ${ticker} IV rank high at ${snap.ivRank}`)

    emitAlert({
      type: 'IV_RANK_HIGH',
      ticker,
      description: `${ticker} IV rank is ${snap.ivRank} (above sell threshold of ${config.triggers.ivRankSellThreshold})`,
      threshold: config.triggers.ivRankSellThreshold,
      observed: snap.ivRank,
      severity,
    })
  }

  if (snap.ivRank <= config.triggers.ivRankBuyThreshold) {
    if (isOnCooldown(ticker, 'IV_RANK_LOW')) return
    const severity: Severity =
      snap.ivRank <= 5 ? 'high' :
      snap.ivRank <= 10 ? 'medium' : 'low'

    setCooldown(ticker, 'IV_RANK_LOW')
    log.info(`TRIGGER: ${ticker} IV rank low at ${snap.ivRank}`)

    emitAlert({
      type: 'IV_RANK_LOW',
      ticker,
      description: `${ticker} IV rank is ${snap.ivRank} (below buy threshold of ${config.triggers.ivRankBuyThreshold})`,
      threshold: config.triggers.ivRankBuyThreshold,
      observed: snap.ivRank,
      severity,
    })
  }
}

export function triggerManual(ticker: string): void {
  log.info(`TRIGGER: Manual analysis requested for ${ticker}`)
  emitAlert({
    type: 'MANUAL',
    ticker,
    description: `Manual analysis requested for ${ticker}`,
    threshold: 0,
    observed: 0,
    severity: 'medium',
  })
}

function checkIvSpike(ticker: string): void {
  if (isOnCooldown(ticker, 'IV_SPIKE')) return

  const history = getIvHistory(ticker)
  if (history.length < 2) return

  const now = Date.now()
  const windowMs = config.triggers.priceMoveWindowMin * 60_000
  const recent = history.filter(p => now - p.timestamp < windowMs)
  if (recent.length < 2) return

  const oldest = recent[0]
  const newest = recent[recent.length - 1]
  if (oldest.iv <= 0) return

  const changePct = ((newest.iv - oldest.iv) / oldest.iv) * 100

  if (Math.abs(changePct) >= config.triggers.ivSpikePct) {
    const severity: Severity =
      Math.abs(changePct) >= 30 ? 'high' :
      Math.abs(changePct) >= 20 ? 'medium' : 'low'

    setCooldown(ticker, 'IV_SPIKE')
    log.info(`TRIGGER: ${ticker} IV spiked ${changePct.toFixed(1)}% in ${config.triggers.priceMoveWindowMin}min`)

    emitAlert({
      type: 'IV_SPIKE',
      ticker,
      description: `${ticker} IV ${changePct > 0 ? 'spiked' : 'dropped'} ${Math.abs(changePct).toFixed(1)}% in ${config.triggers.priceMoveWindowMin} minutes`,
      threshold: config.triggers.ivSpikePct,
      observed: Math.abs(changePct),
      severity,
    })
  }
}

export function triggerScheduled(type: 'SCHEDULED_OPEN' | 'SCHEDULED_CLOSE'): void {
  const label = type === 'SCHEDULED_OPEN' ? '9:45am CT open' : '3:00pm CT close'
  log.info(`TRIGGER: Scheduled ${label} analysis`)
  emitAlert({
    type,
    ticker: '*',
    description: `Scheduled ${label} watchlist analysis`,
    threshold: 0,
    observed: 0,
    severity: 'medium',
  })
}
