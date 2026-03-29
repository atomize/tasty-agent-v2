import { useState, useEffect, useRef, useCallback } from 'react'
import type { Watchlist, WatchlistItem } from '@tastytrade-monitor/shared'

const SECTOR_TEMPLATES: Record<string, string[]> = {
  'AI Supply Chain': [
    'Layer 1 — Chip Packaging', 'Layer 1 — Chip Inspection', 'Layer 1 — Chip Cleaning',
    'Layer 2 — Optical Interconnects', 'Layer 2 — Optical Networking', 'Layer 2 — Optical Components',
    'Layer 3 — Signal Connectivity', 'Layer 3 — Signal Integrity', 'Layer 3 — Custom ASICs',
    'Layer 4 — Rack Integration', 'Layer 4 — DC Construction', 'Layer 4 — Networking',
    'Layer 5 — Thermal & Power', 'Layer 5 — Thermal Systems', 'Layer 5 — Electrical Enclosures',
    'Layer 6 — Copper', 'Layer 6 — Copper Miners ETF', 'Layer 6 — Rare Earth',
    'Layer 7 — Nuclear Power', 'Layer 7 — Uranium', 'Layer 7 — Uranium Mining', 'Layer 7 — Nuclear PPAs',
  ],
  'Defense & Aerospace': ['Prime Contractors', 'Missile Systems', 'Space & Satellite', 'Cybersecurity'],
  'Energy': ['Oil Majors', 'Renewables', 'Nuclear', 'Utilities', 'Infrastructure'],
  'AI Semiconductors': ['GPU / Accelerator', 'Custom ASIC', 'Memory / HBM', 'Server Integration'],
  'Biotech': ['Gene Therapy', 'Oncology', 'Rare Disease', 'Medical Devices'],
  'Macro Hedges': ['Index ETFs', 'Sector ETFs', 'Volatility'],
  'Crypto': ['Layer 1', 'DeFi', 'Infrastructure'],
  'Custom': [],
}

const STRATEGIES = ['supply_chain', 'midterm_macro', 'crypto']

interface Props {
  watchlists: Watchlist[]
  searchResults: { ticker: string; description: string; instrumentType: string }[]
  onRequestWatchlist: () => void
  onSave: (name: string, items: WatchlistItem[]) => void
  onDelete: (watchlistName: string, ticker: string) => void
  onCreate: (name: string) => void
  onDeleteWatchlist: (name: string) => void
  onRenameWatchlist: (oldName: string, newName: string) => void
  onSync: () => void
  onSearch: (query: string) => void
}

export function WatchlistBuilder({
  watchlists, searchResults, onRequestWatchlist, onSave, onDelete,
  onCreate, onDeleteWatchlist, onRenameWatchlist, onSync, onSearch,
}: Props) {
  const [activeListName, setActiveListName] = useState<string | null>(null)
  const [editingItem, setEditingItem] = useState<string | null>(null)
  const [addTicker, setAddTicker] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [searching, setSearching] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [localItems, setLocalItems] = useState<WatchlistItem[]>([])
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [newListSector, setNewListSector] = useState('Custom')
  const [renamingList, setRenamingList] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [highlightIdx, setHighlightIdx] = useState(-1)
  const searchRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => { onRequestWatchlist() }, [onRequestWatchlist])

  useEffect(() => {
    if (watchlists.length > 0 && !activeListName) {
      setActiveListName(watchlists[0].name)
    }
  }, [watchlists, activeListName])

  const activeWl = watchlists.find(w => w.name === activeListName) ?? watchlists[0]

  useEffect(() => {
    if (activeWl) {
      setLocalItems(activeWl.items)
      setDirty(false)
    }
  }, [activeWl?.name, activeWl?.items.length])

  const activeLayers = activeListName
    ? SECTOR_TEMPLATES[activeListName] ?? SECTOR_TEMPLATES['Custom']
    : []

  const handleAddTicker = (ticker: string, instrumentType = 'equity', description = '') => {
    if (!ticker || localItems.some(i => i.ticker === ticker.toUpperCase())) return
    const newItem: WatchlistItem = {
      ticker: ticker.toUpperCase(),
      description: description || undefined,
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
    setHighlightIdx(-1)
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
    if (activeWl) onDelete(activeWl.name, ticker)
  }

  const handleSave = () => {
    if (activeWl) {
      onSave(activeWl.name, localItems)
      setDirty(false)
    }
  }

  const handleSync = () => {
    setSyncing(true)
    onSync()
    setTimeout(() => setSyncing(false), 3000)
  }

  const debouncedSearch = useCallback((q: string) => {
    clearTimeout(debounceRef.current)
    if (q.length < 1) {
      setShowSearch(false)
      setSearching(false)
      return
    }
    setSearching(true)
    debounceRef.current = setTimeout(() => {
      onSearch(q)
      setShowSearch(true)
    }, 300)
  }, [onSearch])

  useEffect(() => {
    if (searchResults.length > 0) setSearching(false)
  }, [searchResults])

  const handleSearchInput = (q: string) => {
    setAddTicker(q)
    setHighlightIdx(-1)
    debouncedSearch(q)
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (!showSearch || searchResults.length === 0) {
      if (e.key === 'Enter' && addTicker) handleAddTicker(addTicker)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIdx(prev => Math.min(prev + 1, searchResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIdx(prev => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (highlightIdx >= 0 && highlightIdx < searchResults.length) {
        const r = searchResults[highlightIdx]
        handleAddTicker(r.ticker, r.instrumentType, r.description)
      } else if (addTicker) {
        handleAddTicker(addTicker)
      }
    } else if (e.key === 'Escape') {
      setShowSearch(false)
      setHighlightIdx(-1)
    }
  }

  const handleCreateList = () => {
    if (!newListName.trim()) return
    onCreate(newListName.trim())
    setActiveListName(newListName.trim())
    setShowCreateModal(false)
    setNewListName('')
    setNewListSector('Custom')
  }

  const handleDeleteList = (name: string) => {
    if (!confirm(`Delete watchlist "${name}" and all its items?`)) return
    onDeleteWatchlist(name)
    if (activeListName === name) {
      setActiveListName(watchlists.find(w => w.name !== name)?.name ?? null)
    }
  }

  const handleRenameSubmit = (oldName: string) => {
    if (renameValue.trim() && renameValue.trim() !== oldName) {
      onRenameWatchlist(oldName, renameValue.trim())
      if (activeListName === oldName) setActiveListName(renameValue.trim())
    }
    setRenamingList(null)
    setRenameValue('')
  }

  return (
    <div className="flex gap-4 h-full">
      {/* Sidebar: watchlist selector */}
      <div className="w-56 shrink-0 space-y-2">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Watchlists</h2>
          <button
            onClick={() => setShowCreateModal(true)}
            className="text-[11px] font-mono text-amber-400 hover:text-amber-300 transition-colors"
          >
            + New
          </button>
        </div>

        {watchlists.map(wl => (
          <div
            key={wl.name}
            className={`group rounded border transition-colors cursor-pointer ${
              activeListName === wl.name
                ? 'border-amber-500/50 bg-amber-500/5'
                : 'border-gray-800 bg-[#0a0a0a] hover:border-gray-700'
            }`}
          >
            {renamingList === wl.name ? (
              <div className="px-3 py-2">
                <input
                  autoFocus
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleRenameSubmit(wl.name)
                    if (e.key === 'Escape') { setRenamingList(null); setRenameValue('') }
                  }}
                  onBlur={() => handleRenameSubmit(wl.name)}
                  className="w-full bg-transparent border border-gray-700 rounded px-1.5 py-0.5 text-xs text-gray-200 font-mono focus:border-amber-500 focus:outline-none"
                />
              </div>
            ) : (
              <div
                className="px-3 py-2 flex items-center justify-between"
                onClick={() => setActiveListName(wl.name)}
              >
                <div className="min-w-0">
                  <div className="text-xs font-medium text-gray-300 truncate">{wl.name}</div>
                  <div className="text-[10px] text-gray-600 font-mono">{wl.items.length} symbols</div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={e => { e.stopPropagation(); setRenamingList(wl.name); setRenameValue(wl.name) }}
                    className="text-gray-600 hover:text-gray-400 text-[10px] px-1"
                    title="Rename"
                  >
                    ✎
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); handleDeleteList(wl.name) }}
                    className="text-gray-600 hover:text-red-400 text-[10px] px-1"
                    title="Delete"
                  >
                    ×
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {watchlists.length === 0 && (
          <div className="text-center text-gray-600 text-[11px] font-mono py-6">
            No watchlists yet
          </div>
        )}

        <button
          onClick={handleSync}
          disabled={syncing}
          className="w-full mt-3 px-3 py-1.5 text-[10px] font-mono rounded border border-gray-800 text-gray-500 hover:border-gray-700 hover:text-gray-400 transition-colors disabled:opacity-50"
        >
          {syncing ? 'Syncing...' : 'Sync from tastytrade'}
        </button>
      </div>

      {/* Main: watchlist editor */}
      <div className="flex-1 min-w-0 space-y-4">
        {activeWl ? (
          <>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
                  {activeWl.name}
                </h2>
                <p className="text-[11px] text-gray-600 font-mono mt-0.5">
                  {localItems.length} symbols
                  {SECTOR_TEMPLATES[activeWl.name] && (
                    <span className="text-gray-700"> — {Object.keys(SECTOR_TEMPLATES).find(k => k === activeWl.name) ? 'sector template' : 'custom'}</span>
                  )}
                </p>
              </div>
              {dirty && (
                <button
                  onClick={handleSave}
                  className="px-4 py-1.5 text-[11px] font-mono rounded bg-amber-500 text-black font-semibold hover:bg-amber-600 transition-colors"
                >
                  Save Changes
                </button>
              )}
            </div>

            {/* Add ticker input with debounced search */}
            <div className="relative">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    ref={searchRef}
                    type="text"
                    value={addTicker}
                    onChange={e => handleSearchInput(e.target.value)}
                    onKeyDown={handleSearchKeyDown}
                    onBlur={() => setTimeout(() => setShowSearch(false), 200)}
                    onFocus={() => { if (addTicker.length >= 1 && searchResults.length > 0) setShowSearch(true) }}
                    placeholder="Search by ticker or company name..."
                    className="w-full bg-[#0a0a0a] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 font-mono focus:border-amber-500 focus:outline-none placeholder:text-gray-700"
                  />
                  {searching && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <div className="w-3.5 h-3.5 border-2 border-gray-600 border-t-amber-400 rounded-full animate-spin" />
                    </div>
                  )}
                </div>
                <button
                  onClick={() => addTicker && handleAddTicker(addTicker)}
                  className="px-4 py-2 text-sm font-mono rounded border border-gray-700 text-gray-400 hover:border-amber-500/50 hover:text-amber-400 transition-colors"
                >
                  Add
                </button>
              </div>
              {showSearch && searchResults.length > 0 && (
                <div ref={dropdownRef} className="absolute z-10 top-full mt-1 w-full bg-[#111] border border-gray-700 rounded shadow-lg max-h-48 overflow-auto">
                  {searchResults.map((r, idx) => (
                    <button
                      key={r.ticker}
                      onMouseDown={() => handleAddTicker(r.ticker, r.instrumentType, r.description)}
                      onMouseEnter={() => setHighlightIdx(idx)}
                      className={`w-full text-left px-3 py-2 transition-colors flex items-center gap-3 ${
                        idx === highlightIdx ? 'bg-amber-900/30' : 'hover:bg-gray-800'
                      }`}
                    >
                      <span className="text-sm font-mono text-amber-400 font-semibold w-16">{r.ticker}</span>
                      <span className="text-xs text-gray-400 truncate flex-1">{r.description}</span>
                      <span className="text-[10px] text-gray-700 shrink-0">{r.instrumentType}</span>
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
                    <th className="text-left px-3 py-2">Company</th>
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
                      <td className="px-3 py-2 text-gray-500 text-[11px] max-w-[140px] truncate" title={item.description}>
                        {item.description || <span className="text-gray-700 italic">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {editingItem === item.ticker ? (
                          <select
                            value={item.layer ?? ''}
                            onChange={e => handleUpdateItem(item.ticker, { layer: e.target.value || null })}
                            className="bg-[#0a0a0a] border border-gray-700 rounded px-1 py-0.5 text-[11px] text-gray-300 w-full"
                          >
                            <option value="">None</option>
                            {activeLayers.map(l => <option key={l} value={l}>{l}</option>)}
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
                  No symbols in this watchlist. Search for a ticker above or sync from tastytrade.
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-64 text-gray-600 text-sm font-mono">
            Select a watchlist or create a new one
          </div>
        )}
      </div>

      {/* Create watchlist modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-[#111] border border-gray-700 rounded-lg p-5 w-96 space-y-4">
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">New Watchlist</h3>

            <div>
              <label className="block text-[11px] text-gray-500 uppercase tracking-wide mb-1.5">Sector Template</label>
              <select
                value={newListSector}
                onChange={e => {
                  setNewListSector(e.target.value)
                  if (!newListName || Object.keys(SECTOR_TEMPLATES).includes(newListName)) {
                    setNewListName(e.target.value === 'Custom' ? '' : e.target.value)
                  }
                }}
                className="w-full bg-[#0a0a0a] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 font-mono focus:border-amber-500 focus:outline-none"
              >
                {Object.keys(SECTOR_TEMPLATES).map(s => (
                  <option key={s} value={s}>{s} ({SECTOR_TEMPLATES[s].length} layers)</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-gray-500 uppercase tracking-wide mb-1.5">Name</label>
              <input
                autoFocus
                value={newListName}
                onChange={e => setNewListName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreateList() }}
                placeholder="e.g. Quantum Computing"
                className="w-full bg-[#0a0a0a] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 font-mono focus:border-amber-500 focus:outline-none placeholder:text-gray-700"
              />
            </div>

            {newListSector !== 'Custom' && SECTOR_TEMPLATES[newListSector]?.length > 0 && (
              <div>
                <span className="text-[10px] text-gray-600 uppercase tracking-wide">Layers included:</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {SECTOR_TEMPLATES[newListSector].slice(0, 8).map(l => (
                    <span key={l} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500">{l}</span>
                  ))}
                  {SECTOR_TEMPLATES[newListSector].length > 8 && (
                    <span className="text-[10px] text-gray-600">+{SECTOR_TEMPLATES[newListSector].length - 8} more</span>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                onClick={handleCreateList}
                disabled={!newListName.trim()}
                className="flex-1 px-4 py-2 text-sm font-semibold rounded bg-amber-500 text-black hover:bg-amber-600 transition-colors disabled:opacity-50"
              >
                Create
              </button>
              <button
                onClick={() => { setShowCreateModal(false); setNewListName(''); setNewListSector('Custom') }}
                className="px-4 py-2 text-sm font-medium rounded border border-gray-700 text-gray-400 hover:text-gray-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
