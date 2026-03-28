import type { PaperPosition } from '@tastytrade-monitor/shared'
import type { SnapshotProvider } from './execution.js'

export function markToMarket(
  positions: PaperPosition[],
  snapshots: SnapshotProvider,
): PaperPosition[] {
  const now = new Date().toISOString()

  for (const pos of positions) {
    const snap = snapshots.getSnapshot(pos.ticker)
    if (!snap) continue

    if (pos.instrument === 'stock') {
      pos.currentPrice = snap.price
      const direction = pos.side === 'long' ? 1 : -1
      pos.unrealizedPnl = direction * (snap.price - pos.avgCost) * pos.quantity
    } else {
      const underlyingMove = snap.price - getEntryUnderlying(pos, snap.price)
      const optionPnl = pos.delta * underlyingMove * 100 * pos.quantity
      pos.unrealizedPnl = optionPnl
      if (pos.avgCost > 0) {
        pos.currentPrice = pos.avgCost + (optionPnl / (100 * pos.quantity))
      }
    }

    pos.unrealizedPnlPct = pos.avgCost > 0
      ? (pos.unrealizedPnl / (Math.abs(pos.avgCost) * pos.quantity * (pos.instrument === 'stock' ? 1 : 100))) * 100
      : 0
  }

  return positions
}

const entryUnderlyingCache = new Map<string, number>()

export function recordEntryUnderlying(positionId: string, price: number): void {
  entryUnderlyingCache.set(positionId, price)
}

function getEntryUnderlying(pos: PaperPosition, currentPrice: number): number {
  return entryUnderlyingCache.get(pos.id) ?? currentPrice
}

export function checkExpirations(positions: PaperPosition[]): { expired: PaperPosition[]; active: PaperPosition[] } {
  const today = new Date().toISOString().slice(0, 10)
  const expired: PaperPosition[] = []
  const active: PaperPosition[] = []

  for (const pos of positions) {
    if (pos.instrument !== 'stock' && pos.expiration && pos.expiration <= today) {
      expired.push(pos)
    } else {
      active.push(pos)
    }
  }

  return { expired, active }
}

export function checkStops(
  positions: PaperPosition[],
  snapshots: SnapshotProvider,
): { stopped: PaperPosition[]; active: PaperPosition[] } {
  const stopped: PaperPosition[] = []
  const active: PaperPosition[] = []

  for (const pos of positions) {
    const lossPct = pos.unrealizedPnlPct
    if (lossPct <= -50) {
      stopped.push(pos)
    } else {
      active.push(pos)
    }
  }

  return { stopped, active }
}
