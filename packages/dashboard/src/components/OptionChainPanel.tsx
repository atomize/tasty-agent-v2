import { useState, useEffect } from 'react'
import type { TickerSnapshot, OptionChainResponse, OptionExpiration } from '@tastytrade-monitor/shared'

interface Props {
  snapshots: TickerSnapshot[]
  optionChain: OptionChainResponse | null
  requestChain: (ticker: string) => void
  env?: 'sandbox' | 'production'
}

export function OptionChainPanel({ snapshots, optionChain, requestChain, env }: Props) {
  const [selectedTicker, setSelectedTicker] = useState<string>('')
  const [selectedExpIdx, setSelectedExpIdx] = useState(0)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')

  const tickers = snapshots
    .filter(s => s.price > 0)
    .sort((a, b) => a.ticker.localeCompare(b.ticker))

  const filteredTickers = filter
    ? tickers.filter(s =>
        s.ticker.toLowerCase().includes(filter.toLowerCase()) ||
        (s.layer ?? '').toLowerCase().includes(filter.toLowerCase())
      )
    : tickers

  useEffect(() => {
    if (optionChain?.ticker === selectedTicker) {
      setLoading(false)
    }
  }, [optionChain, selectedTicker])

  function handleSelect(ticker: string) {
    setSelectedTicker(ticker)
    setSelectedExpIdx(0)
    setLoading(true)
    requestChain(ticker)
  }

  const isCrypto = optionChain?.instrumentType === 'crypto'
  const expirations: OptionExpiration[] = optionChain?.ticker === selectedTicker
    ? optionChain.expirations
    : []
  const activeExp = expirations[selectedExpIdx]

  return (
    <div className="flex gap-4 h-[calc(100vh-10rem)]">
      {/* Ticker selector sidebar */}
      <div className="w-48 shrink-0 flex flex-col border-r border-gray-800">
        <input
          type="text"
          placeholder="Filter tickers..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="mb-2 px-2 py-1.5 bg-[#111] border border-gray-800 rounded text-xs text-gray-300 placeholder-gray-600 outline-none focus:border-gray-600"
        />
        <div className="overflow-y-auto flex-1 space-y-0.5">
          {filteredTickers.map(s => (
            <button
              key={s.ticker}
              onClick={() => handleSelect(s.ticker)}
              className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center justify-between transition-colors ${
                selectedTicker === s.ticker
                  ? 'bg-amber-900/30 text-amber-400'
                  : 'text-gray-400 hover:bg-gray-900/50 hover:text-gray-300'
              }`}
            >
              <span className="font-mono font-medium">{s.ticker}</span>
              <span className="text-[10px] text-gray-600 truncate ml-1 max-w-[70px]">
                {s.strategies?.includes('crypto') ? 'CRYPTO' : s.layer?.split('—')[0]?.trim() ?? ''}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-auto">
        {!selectedTicker && (
          <div className="text-center py-16 text-gray-600 text-sm">
            Select a ticker from the sidebar to view its option chain.
          </div>
        )}

        {selectedTicker && loading && (
          <div className="text-center py-16 text-gray-500 text-sm">
            Loading option chain for {selectedTicker}...
          </div>
        )}

        {selectedTicker && !loading && isCrypto && (
          <div className="text-center py-16">
            <div className="inline-block bg-amber-900/20 border border-amber-800/40 rounded-lg px-6 py-4">
              <p className="text-amber-400 text-sm font-medium mb-1">
                No options available for {selectedTicker}
              </p>
              <p className="text-gray-500 text-xs">
                Crypto instruments on tastytrade are spot-only. Options chains are available for equities and ETFs.
              </p>
            </div>
          </div>
        )}

        {selectedTicker && !loading && !isCrypto && expirations.length === 0 && (
          <div className="text-center py-16">
            {env === 'sandbox' ? (
              <div className="inline-block bg-amber-900/20 border border-amber-800/40 rounded-lg px-6 py-4 max-w-md">
                <p className="text-amber-400 text-sm font-medium mb-1">
                  Option chains unavailable in sandbox
                </p>
                <p className="text-gray-500 text-xs leading-relaxed">
                  The tastytrade sandbox environment does not support the option chain API.
                  Switch to <span className="text-gray-400">TASTYTRADE_ENV=production</span> with
                  real credentials to load live option chains for {selectedTicker}.
                </p>
              </div>
            ) : (
              <div className="text-gray-600 text-sm">
                No option chain data returned for {selectedTicker}.
              </div>
            )}
          </div>
        )}

        {selectedTicker && !loading && !isCrypto && expirations.length > 0 && (
          <div>
            {/* Expiration tabs */}
            <div className="flex gap-2 mb-4">
              {expirations.map((exp, i) => (
                <button
                  key={exp.expiration}
                  onClick={() => setSelectedExpIdx(i)}
                  className={`px-3 py-1.5 rounded text-xs font-mono transition-colors ${
                    selectedExpIdx === i
                      ? 'bg-amber-600 text-black font-medium'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {exp.expiration} ({exp.daysToExpiry} DTE)
                </button>
              ))}
              <button
                onClick={() => handleSelect(selectedTicker)}
                className="ml-auto px-2 py-1 text-[10px] bg-gray-800 text-gray-500 rounded hover:bg-gray-700 hover:text-gray-300"
              >
                Refresh
              </button>
            </div>

            {/* Strike table */}
            {activeExp && <StrikeTable expiration={activeExp} />}
          </div>
        )}
      </div>
    </div>
  )
}

function StrikeTable({ expiration }: { expiration: OptionExpiration }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="text-gray-500 border-b border-gray-800">
            <th colSpan={5} className="text-center text-amber-500/70 py-1.5 text-[10px] uppercase tracking-wider border-r border-gray-800">
              Calls
            </th>
            <th className="px-3 py-1.5 text-center">Strike</th>
            <th colSpan={5} className="text-center text-blue-500/70 py-1.5 text-[10px] uppercase tracking-wider border-l border-gray-800">
              Puts
            </th>
          </tr>
          <tr className="text-gray-500 border-b border-gray-800 text-[10px] uppercase">
            <th className="text-right px-2 py-1">Bid</th>
            <th className="text-right px-2 py-1">Ask</th>
            <th className="text-right px-2 py-1">IV</th>
            <th className="text-right px-2 py-1">Delta</th>
            <th className="text-right px-2 py-1 border-r border-gray-800">OI</th>
            <th className="text-center px-3 py-1"></th>
            <th className="text-right px-2 py-1 border-l border-gray-800">Bid</th>
            <th className="text-right px-2 py-1">Ask</th>
            <th className="text-right px-2 py-1">IV</th>
            <th className="text-right px-2 py-1">Delta</th>
            <th className="text-right px-2 py-1">OI</th>
          </tr>
        </thead>
        <tbody>
          {expiration.strikes.map(s => (
            <tr key={s.strike} className="border-b border-gray-900/50 hover:bg-gray-900/30 transition-colors">
              <td className="text-right px-2 py-1 text-green-400/80">{fmtPrice(s.callBid)}</td>
              <td className="text-right px-2 py-1 text-red-400/80">{fmtPrice(s.callAsk)}</td>
              <td className="text-right px-2 py-1 text-gray-400">{fmtIV(s.callIV)}</td>
              <td className="text-right px-2 py-1 text-gray-400">{fmtDelta(s.callDelta)}</td>
              <td className="text-right px-2 py-1 text-gray-600 border-r border-gray-800">{fmtOI(s.callOI)}</td>
              <td className="text-center px-3 py-1 font-semibold text-gray-200 bg-gray-900/40">${s.strike}</td>
              <td className="text-right px-2 py-1 text-green-400/80 border-l border-gray-800">{fmtPrice(s.putBid)}</td>
              <td className="text-right px-2 py-1 text-red-400/80">{fmtPrice(s.putAsk)}</td>
              <td className="text-right px-2 py-1 text-gray-400">{fmtIV(s.putIV)}</td>
              <td className="text-right px-2 py-1 text-gray-400">{fmtDelta(s.putDelta)}</td>
              <td className="text-right px-2 py-1 text-gray-600">{fmtOI(s.putOI)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function fmtPrice(v: number): string {
  return v > 0 ? `$${v.toFixed(2)}` : '-'
}

function fmtIV(v: number | undefined): string {
  if (v == null) return '-'
  return `${(v * 100).toFixed(0)}%`
}

function fmtDelta(v: number | undefined): string {
  if (v == null) return '-'
  return v.toFixed(2)
}

function fmtOI(v: number): string {
  if (v === 0) return '-'
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`
  return String(v)
}
