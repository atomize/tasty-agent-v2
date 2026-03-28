import { useEffect, useState } from 'react'
import type { PaperAccount, PaperPosition, PaperOrder } from '@tastytrade-monitor/shared'

interface Props {
  account: PaperAccount | null
  positions: PaperPosition[]
  orders: PaperOrder[]
  onRequestState: () => void
  onConfigure: (config: { enabled: boolean; startingBalance?: number; useAITrader?: boolean }) => void
  onClosePosition: (positionId: string) => void
  onReset: () => void
}

export function PaperTradingPanel({ account, positions, orders, onRequestState, onConfigure, onClosePosition, onReset }: Props) {
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  useEffect(() => { onRequestState() }, [onRequestState])

  if (!account) {
    return (
      <div className="text-center py-16">
        <div className="inline-block bg-gray-900/50 border border-gray-800 rounded-lg px-8 py-6">
          <p className="text-gray-400 text-sm font-medium mb-2">Paper Trading</p>
          <p className="text-gray-600 text-xs">Loading paper trading account...</p>
        </div>
      </div>
    )
  }

  const totalReturn = account.startingBalance > 0
    ? ((account.equity - account.startingBalance) / account.startingBalance) * 100
    : 0
  const totalPnl = account.realizedPnl + account.unrealizedPnl

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Account summary */}
      <div className="border border-gray-800 rounded-lg p-4 bg-[#0a0a0a]">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Paper Account</h2>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-mono text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={account.useAITrader}
                onChange={e => onConfigure({ enabled: account.enabled, useAITrader: e.target.checked })}
                className="accent-amber-500"
              />
              AI Trader
            </label>
            <button
              onClick={() => onConfigure({ enabled: !account.enabled })}
              className={`px-3 py-1 text-xs font-mono rounded transition-colors ${
                account.enabled
                  ? 'bg-green-900/30 text-green-400 border border-green-800/50 hover:bg-green-900/50'
                  : 'bg-gray-800 text-gray-500 border border-gray-700 hover:bg-gray-700'
              }`}
            >
              {account.enabled ? 'Enabled' : 'Disabled'}
            </button>
            <button
              onClick={() => setShowResetConfirm(true)}
              className="px-3 py-1 text-xs font-mono rounded bg-red-900/20 text-red-400 border border-red-800/30 hover:bg-red-900/40 transition-colors"
            >
              Reset
            </button>
          </div>
        </div>

        <div className="grid grid-cols-6 gap-4">
          <StatCard label="Starting" value={`$${account.startingBalance.toLocaleString()}`} />
          <StatCard label="Cash" value={`$${account.cash.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
          <StatCard label="Equity" value={`$${account.equity.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} color={totalPnl >= 0 ? 'green' : 'red'} />
          <StatCard label="Total P&L" value={`${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(0)} (${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(1)}%)`} color={totalPnl >= 0 ? 'green' : 'red'} />
          <StatCard label="Trades" value={String(account.totalTrades)} />
          <StatCard label="Win Rate" value={`${account.winRate.toFixed(0)}%`} color={account.winRate >= 50 ? 'green' : 'amber'} />
        </div>
      </div>

      {/* Open positions */}
      <div className="border border-gray-800 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 bg-[#0a0a0a] border-b border-gray-800">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
            Open Positions ({positions.length})
          </h3>
        </div>
        {positions.length === 0 ? (
          <div className="px-4 py-8 text-center text-gray-600 text-xs font-mono">
            No open positions — trades will appear here when alerts trigger analysis
          </div>
        ) : (
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-gray-600 text-left border-b border-gray-800">
                <th className="px-4 py-2">Ticker</th>
                <th className="px-2 py-2">Type</th>
                <th className="px-2 py-2">Side</th>
                <th className="px-2 py-2 text-right">Strike</th>
                <th className="px-2 py-2 text-right">Entry</th>
                <th className="px-2 py-2 text-right">Current</th>
                <th className="px-2 py-2 text-right">P&L</th>
                <th className="px-2 py-2 text-right">P&L %</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {positions.map(pos => (
                <tr key={pos.id} className="border-b border-gray-800/50 hover:bg-gray-900/30">
                  <td className="px-4 py-2 text-amber-400 font-semibold">{pos.ticker}</td>
                  <td className="px-2 py-2 text-gray-400 uppercase">{pos.instrument}</td>
                  <td className="px-2 py-2">
                    <span className={pos.side === 'long' ? 'text-green-400' : 'text-red-400'}>
                      {pos.side}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right text-gray-400">{pos.strike ?? '-'}</td>
                  <td className="px-2 py-2 text-right text-gray-300">${pos.avgCost.toFixed(2)}</td>
                  <td className="px-2 py-2 text-right text-gray-300">${pos.currentPrice.toFixed(2)}</td>
                  <td className={`px-2 py-2 text-right ${pos.unrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {pos.unrealizedPnl >= 0 ? '+' : ''}${pos.unrealizedPnl.toFixed(0)}
                  </td>
                  <td className={`px-2 py-2 text-right ${pos.unrealizedPnlPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {pos.unrealizedPnlPct >= 0 ? '+' : ''}{pos.unrealizedPnlPct.toFixed(1)}%
                  </td>
                  <td className="px-2 py-2 text-right">
                    <button
                      onClick={() => onClosePosition(pos.id)}
                      className="text-gray-600 hover:text-red-400 transition-colors"
                    >
                      Close
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Recent orders */}
      <div className="border border-gray-800 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 bg-[#0a0a0a] border-b border-gray-800">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
            Recent Orders ({orders.length})
          </h3>
        </div>
        {orders.length === 0 ? (
          <div className="px-4 py-6 text-center text-gray-600 text-xs font-mono">
            No orders yet
          </div>
        ) : (
          <div className="divide-y divide-gray-800/50 max-h-[300px] overflow-auto">
            {orders.map(order => (
              <div key={order.id} className="px-4 py-2.5 flex items-center gap-3">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  order.status === 'filled' ? 'bg-green-400' : order.status === 'rejected' ? 'bg-red-400' : 'bg-gray-500'
                }`} />
                <span className="text-amber-400 font-mono text-xs font-semibold w-12">{order.signal.ticker}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase ${
                  order.status === 'filled'
                    ? 'bg-green-900/30 text-green-400 border border-green-800/50'
                    : order.status === 'rejected'
                      ? 'bg-red-900/30 text-red-400 border border-red-800/50'
                      : 'bg-gray-800 text-gray-500 border border-gray-700'
                }`}>{order.status}</span>
                <span className="text-gray-400 text-xs font-mono">
                  {order.signal.action} {order.signal.instrument}{order.signal.strike ? ' ' + order.signal.strike : ''}
                </span>
                {order.filledPrice && (
                  <span className="text-gray-500 text-xs font-mono">@ ${order.filledPrice.toFixed(2)}</span>
                )}
                <span className="flex-1" />
                <span className="text-gray-600 text-[10px] font-mono" title={order.decision.reason}>
                  {order.decision.usedAI ? 'AI' : 'Rules'}: {order.decision.reason.slice(0, 40)}
                </span>
                <span className="text-gray-700 text-[10px] font-mono">
                  {new Date(order.createdAt).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reset confirmation modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[#111] border border-gray-800 rounded-lg p-6 max-w-sm">
            <p className="text-gray-300 text-sm mb-4">Reset paper account to starting balance? All positions and trade history will be cleared.</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-1.5 text-xs font-mono rounded border border-gray-700 text-gray-400 hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { onReset(); setShowResetConfirm(false) }}
                className="px-4 py-1.5 text-xs font-mono rounded bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: string; color?: 'green' | 'red' | 'amber' }) {
  const textColor = color === 'green' ? 'text-green-400' : color === 'red' ? 'text-red-400' : color === 'amber' ? 'text-amber-400' : 'text-gray-200'
  return (
    <div>
      <div className="text-[10px] text-gray-600 uppercase tracking-wide mb-0.5">{label}</div>
      <div className={`text-sm font-mono font-semibold ${textColor}`}>{value}</div>
    </div>
  )
}
