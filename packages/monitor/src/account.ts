import type { AccountContext } from '@tastytrade-monitor/shared'
import { getClient } from './tastytrade-auth.js'
import { log } from './logger.js'
import { config } from './config.js'

let cachedAccount: AccountContext = {
  netLiq: 0,
  buyingPower: 0,
  openPositions: [],
}

export function getAccountContext(): AccountContext {
  return cachedAccount
}

export async function fetchAccountData(): Promise<AccountContext> {
  try {
    const client = getClient()
    const raw = await client.accountsAndCustomersService.getCustomerAccounts()

    const items = Array.isArray(raw) ? raw : (raw as Record<string, unknown>)?.items as unknown[] | undefined
    if (!items?.length) {
      log.warn(`No accounts found (raw type: ${typeof raw}, isArray: ${Array.isArray(raw)}, keys: ${raw ? Object.keys(raw as object).slice(0, 5).join(',') : 'null'})`)
      return cachedAccount
    }

    const acctEntry = items[0] as Record<string, unknown>
    const acct = (acctEntry.account ?? acctEntry) as Record<string, unknown>
    const accountNumber = String(
      acct['account-number'] ?? acct.accountNumber ?? ''
    )
    if (!accountNumber) {
      log.warn('Could not determine account number')
      return cachedAccount
    }

    await delay(config.rateLimit.minMsBetweenRestCalls)
    const balRaw = await client.balancesAndPositionsService.getAccountBalanceValues(accountNumber)
    const balData = (balRaw ?? {}) as Record<string, unknown>

    await delay(config.rateLimit.minMsBetweenRestCalls)
    const posRaw = await client.balancesAndPositionsService.getPositionsList(accountNumber)
    const positions = (Array.isArray(posRaw) ? posRaw : []) as Record<string, unknown>[]

    cachedAccount = {
      netLiq: asNumber(balData?.['net-liquidating-value'] ?? balData?.netLiquidatingValue),
      buyingPower: asNumber(balData?.['derivative-buying-power'] ?? balData?.derivativeBuyingPower),
      openPositions: (Array.isArray(positions) ? positions : []).map((p: Record<string, unknown>) => ({
        ticker: String(p['underlying-symbol'] ?? p.underlyingSymbol ?? ''),
        type: inferPositionType(p),
        strike: asOptNumber(p['strike-price'] ?? p.strikePrice),
        expiration: (p['expiration-date'] ?? p.expirationDate) as string | undefined,
        quantity: asNumber(p.quantity),
        costBasis: asNumber(p['average-open-price'] ?? p.averageOpenPrice) * asNumber(p.quantity),
        currentValue: asNumber(p['close-price'] ?? p.closePrice) * asNumber(p.quantity) * (String(p['instrument-type'] ?? p.instrumentType).includes('Option') ? 100 : 1),
        pnl: 0,
        pnlPct: 0,
      })),
    }

    for (const pos of cachedAccount.openPositions) {
      pos.pnl = pos.currentValue - pos.costBasis
      pos.pnlPct = pos.costBasis !== 0 ? (pos.pnl / Math.abs(pos.costBasis)) * 100 : 0
    }

    log.info(`Account data refreshed: net liq $${cachedAccount.netLiq.toLocaleString()}, ${cachedAccount.openPositions.length} positions`)
    return cachedAccount
  } catch (err) {
    log.error('Failed to fetch account data:', err)
    return cachedAccount
  }
}

export function startAccountPolling(intervalMs = 30_000): void {
  fetchAccountData()
  setInterval(fetchAccountData, intervalMs)
}

function inferPositionType(p: Record<string, unknown>): 'call' | 'put' | 'stock' {
  const instrType = String(p['instrument-type'] ?? p.instrumentType ?? '').toLowerCase()
  if (instrType.includes('equity') || instrType.includes('stock')) return 'stock'
  const optType = String(p['option-type'] ?? p.optionType ?? '').toUpperCase()
  return optType === 'P' ? 'put' : 'call'
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
  const n = asNumber(v)
  return n !== 0 ? n : undefined
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
