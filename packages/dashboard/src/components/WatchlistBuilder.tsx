import { useState, useEffect, useRef } from 'react'
import type { Watchlist, WatchlistItem } from '@tastytrade-monitor/shared'

interface Props {
  watchlists: Watchlist[]
  searchResults: { ticker: string; description: string; instrumentType: string }[]
  onRequestWatchlist: () => void
  onSave: (name: string, items: WatchlistItem[]) => void
  onDelete: (watchlistName: string, ticker: string) => void
  onSync: () => void
  onSearch: (query: string) => void
}

const LAYERS = [
  'Layer 1 — Chip Packaging',
  'Layer 2 — Optical Interconnects',
  'Layer 3 — Signal Connectivity',
  'Layer 4 — Rack Integration',
  'Layer 5 — Thermal & Power',
  'Layer 6 — Raw Materials',
  'Layer 7 — Nuclear Power',
  'Macro — Energy',
  'Macro — Defense',
  'Macro — AI Semis',
  'Macro — Biotech',
  'Macro — Hedges',
  'Crypto',
]

const STRATEGIES = ['supply_chain', 'midterm_macro', 'crypto']

export function WatchlistBuilder({ watchlists, searchResults, onRequestWatchlist, onSave, onDelete, onSync, onSearch }: Props) {
  const [editingItem, setEditingItem] = useState<string | null>(null)
  const [addTicker, setAddTicker] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [localItems, setLocalItems] = useState<WatchlistItem[]>([])
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => { onRequestWatchlist() }, [onRequestWatchlist])

  const wl = watchlists[0]
  useEffect(() => {
    if (wl) {
      setLocalItems(wl.items)
      setDirty(false)
    }
  }, [wl])

  const handleAddTicker = (ticker: string, instrumentType = 'equity') => {
    if (!ticker || localItems.some(i => i.ticker === ticker.toUpperCase())) return
    const newItem: WatchlistItem = {
      ticker: ticker.toUpperCase(),
      layer: null,
      strategies: [],
      thesis: '',
      instrumentType: instrumentType as 'equity' | 'crypto',
      sortOrder: localItems.length,
    }
    setLocalItems(prev => [...prev, newItem])
    setDirty(true)
    setAddTicker('')
    setShowSearch(false)
  }

  const handleUpdateItem = (ticker: string, updates: Partial<WatchlistItem>) => {
    setLocalItems(prev => prev.map(item =>
      item.ticker === ticker ? { ...item, ...updates } : item
    ))
    setDirty(true)
  }

  const handleRemove = (ticker: string) => {
    setLocalItems(prev => prev.filter(i => i.ticker !== ticker))
    setDirty(true)
    if (wl) onDelete(wl.name, ticker)
  }

  const handleSave = () => {
    onSave(wl?.name ?? 'Default', localItems)
    setDirty(false)
  }

  const handleSync = () => {
    setSyncing(true)
    onSync()
    setTimeout(() => setSyncing(false), 3000)
  }

  const handleSearchInput = (q: string) => {
    setAddTicker(q)
    if (q.length >= 1) {
      onSearch(q)
      setShowSearch(true)
    } else {
      setShowSearch(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
            Watchlist Builder
          </h2>
          <p className="text-[11px] text-gray-600 font-mono mt-0.5">
            {localItems.length} symbols — manage your trading watchlist
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-3 py-1.5 text-[11px] font-mono rounded border border-gray-700 text-gray-400 hover:border-amber-500/50 hover:text-amber-400 transition-colors disabled:opacity-50"
          >
            {syncing ? 'Syncing...' : 'Sync from tastytrade'}
          </button>
          {dirty && (
            <button
              onClick={handleSave}
              className="px-4 py-1.5 text-[11px] font-mono rounded bg-amber-500 text-black font-semibold hover:bg-amber-600 transition-colors"
            >
              Save Changes
            </button>
          )}
        </div>
      </div>

      {/* Add ticker input */}
      <div className="relative">
        <div className="flex gap-2">
          <input
            ref={searchRef}
            type="text"
            value={addTicker}
            onChange={e => handleSearchInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && addTicker) handleAddTicker(addTicker)
            }}
            placeholder="Add symbol (e.g. AAPL, TSLA)..."
            className="flex-1 bg-[#0a0a0a] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 font-mono focus:border-amber-500 focus:outline-none placeholder:text-gray-700"
          />
          <button
            onClick={() => addTicker && handleAddTicker(addTicker)}
            className="px-4 py-2 text-sm font-mono rounded border border-gray-700 text-gray-400 hover:border-amber-500/50 hover:text-amber-400 transition-colors"
          >
            Add
          </button>
        </div>
        {showSearch && searchResults.length > 0 && (
          <div className="absolute z-10 top-full mt-1 w-full bg-[#111] border border-gray-700 rounded shadow-lg max-h-48 overflow-auto">
            {searchResults.map(r => (
              <button
                key={r.ticker}
                onClick={() => handleAddTicker(r.ticker, r.instrumentType)}
                className="w-full text-left px-3 py-2 hover:bg-gray-800 transition-colors flex items-center gap-3"
              >
                <span className="text-sm font-mono text-amber-400 font-semibold w-16">{r.ticker}</span>
                <span className="text-xs text-gray-500 truncate">{r.description}</span>
                <span className="text-[10px] text-gray-700 ml-auto">{r.instrumentType}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="border border-gray-800 rounded overflow-hidden">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="bg-[#0a0a0a] text-gray-500 uppercase tracking-wide">
              <th className="text-left px-3 py-2 w-20">Symbol</th>
              <th className="text-left px-3 py-2">Layer</th>
              <th className="text-left px-3 py-2">Strategies</th>
              <th className="text-left px-3 py-2">Thesis</th>
              <th className="text-center px-3 py-2 w-16">Type</th>
              <th className="text-center px-3 py-2 w-12"></th>
            </tr>
          </thead>
          <tbody>
            {localItems.map((item) => (
              <tr
                key={item.ticker}
                className="border-t border-gray-800/50 hover:bg-gray-900/30 transition-colors"
              >
                <td className="px-3 py-2 font-semibold text-amber-400">{item.ticker}</td>
                <td className="px-3 py-2">
                  {editingItem === item.ticker ? (
                    <select
                      value={item.layer ?? ''}
                      onChange={e => handleUpdateItem(item.ticker, { layer: e.target.value || null })}
                      className="bg-[#0a0a0a] border border-gray-700 rounded px-1 py-0.5 text-[11px] text-gray-300 w-full"
                    >
                      <option value="">None</option>
                      {LAYERS.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                  ) : (
                    <span
                      className="text-gray-400 cursor-pointer hover:text-gray-200"
                      onClick={() => setEditingItem(item.ticker)}
                    >
                      {item.layer ?? '-'}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-1 flex-wrap">
                    {STRATEGIES.map(s => (
                      <button
                        key={s}
                        onClick={() => {
                          const newStrategies = item.strategies.includes(s)
                            ? item.strategies.filter(x => x !== s)
                            : [...item.strategies, s]
                          handleUpdateItem(item.ticker, { strategies: newStrategies })
                        }}
                        className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                          item.strategies.includes(s)
                            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                            : 'bg-gray-800 text-gray-600 border border-gray-700 hover:border-gray-600'
                        }`}
                      >
                        {s.replace('_', ' ')}
                      </button>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2">
                  {editingItem === item.ticker ? (
                    <input
                      value={item.thesis}
                      onChange={e => handleUpdateItem(item.ticker, { thesis: e.target.value })}
                      onBlur={() => setEditingItem(null)}
                      className="bg-[#0a0a0a] border border-gray-700 rounded px-1 py-0.5 text-[11px] text-gray-300 w-full"
                      autoFocus
                    />
                  ) : (
                    <span
                      className="text-gray-500 cursor-pointer hover:text-gray-300 truncate block max-w-xs"
                      onClick={() => setEditingItem(item.ticker)}
                      title={item.thesis}
                    >
                      {item.thesis || 'click to add thesis...'}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    item.instrumentType === 'crypto' ? 'bg-purple-900/30 text-purple-400' : 'bg-blue-900/30 text-blue-400'
                  }`}>
                    {item.instrumentType}
                  </span>
                </td>
                <td className="px-3 py-2 text-center">
                  <button
                    onClick={() => handleRemove(item.ticker)}
                    className="text-gray-700 hover:text-red-400 transition-colors"
                    title="Remove"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {localItems.length === 0 && (
          <div className="px-4 py-8 text-center text-gray-600 text-xs font-mono">
            No symbols in watchlist. Add a ticker above or sync from tastytrade.
          </div>
        )}
      </div>
    </div>
  )
}
