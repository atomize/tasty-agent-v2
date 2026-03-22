import type { AccountContext } from '@tastytrade-monitor/shared'

interface Props {
  account: AccountContext
  env: 'sandbox' | 'production'
}

export function PositionsPanel({ account, env }: Props) {
  const totalPnl = account.openPositions.reduce((sum, p) => sum + p.pnl, 0)

  return (
    <div>
      {/* Sandbox notice */}
      {env === 'sandbox' && (
        <div className="mb-4 bg-amber-900/20 border border-amber-800/40 rounded-lg px-4 py-2.5 text-xs text-amber-400 font-mono">
          Sandbox: all positions and balances reset at midnight daily. Auth credentials survive the reset.
        </div>
      )}

      {/* Account summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <Card label="Net Liquidating Value" value={`$${account.netLiq.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
        <Card label="Buying Power" value={`$${account.buyingPower.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
        <Card
          label="Total P&L"
          value={`${totalPnl >= 0 ? '+' : ''}$${totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
          valueClass={totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}
        />
      </div>

      {/* Positions table */}
      {account.openPositions.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full font-mono">
            <thead>
              <tr>
                <th className="text-left">Ticker</th>
                <th className="text-left">Type</th>
                <th className="text-left">Strike</th>
                <th className="text-left">Expiry</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Cost Basis</th>
                <th className="text-right">Mkt Value</th>
                <th className="text-right">P&L</th>
                <th className="text-right">P&L %</th>
              </tr>
            </thead>
            <tbody>
              {account.openPositions.map((pos, i) => (
                <tr key={i} className="hover:bg-gray-900/50">
                  <td className="font-semibold text-amber-400">{pos.ticker}</td>
                  <td className="text-gray-400 uppercase text-[11px]">{pos.type}</td>
                  <td>{pos.strike ? `$${pos.strike.toFixed(0)}` : '-'}</td>
                  <td className="text-gray-500">{pos.expiration ?? '-'}</td>
                  <td className="text-right">{pos.quantity}</td>
                  <td className="text-right text-gray-400">${pos.costBasis.toFixed(2)}</td>
                  <td className="text-right">${pos.currentValue.toFixed(2)}</td>
                  <td className={`text-right ${pos.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {pos.pnl >= 0 ? '+' : ''}${pos.pnl.toFixed(2)}
                  </td>
                  <td className={`text-right ${pos.pnlPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {pos.pnlPct >= 0 ? '+' : ''}{pos.pnlPct.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-12 text-gray-600 text-sm">
          {env === 'sandbox'
            ? 'No open positions. Sandbox resets positions at midnight — place test orders to populate.'
            : 'No open positions.'
          }
        </div>
      )}
    </div>
  )
}

function Card({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="bg-[#111] border border-gray-800 rounded-lg p-4">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">{label}</div>
      <div className={`font-mono text-lg font-semibold ${valueClass ?? 'text-gray-100'}`}>{value}</div>
    </div>
  )
}
