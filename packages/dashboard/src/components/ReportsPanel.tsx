import { useState, useEffect, useRef } from 'react'
import type { AnalysisReport, BudgetStatus, AgentStatus } from '@tastytrade-monitor/shared'

interface Props {
  reports: AnalysisReport[]
  budgetStatus: BudgetStatus | null
  agentStatus: AgentStatus | null
  onRequestReports: (date?: string) => void
  onRunNow: () => void
  onRequestBudget: () => void
}

const RUN_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  morning: { label: 'Morning Scan', color: 'text-yellow-400 bg-yellow-900/20' },
  midday_1: { label: 'Midday #1', color: 'text-blue-400 bg-blue-900/20' },
  midday_2: { label: 'Midday #2', color: 'text-cyan-400 bg-cyan-900/20' },
  preclose: { label: 'Pre-Close', color: 'text-orange-400 bg-orange-900/20' },
  nextday: { label: 'Next-Day Prep', color: 'text-purple-400 bg-purple-900/20' },
  manual: { label: 'Manual', color: 'text-gray-400 bg-gray-800' },
}

export function ReportsPanel({ reports, budgetStatus, agentStatus, onRequestReports, onRunNow, onRequestBudget }: Props) {
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [runRequested, setRunRequested] = useState(false)
  const prevReportCount = useRef(reports.length)

  const isProcessing = agentStatus?.state === 'processing'
  const running = runRequested || isProcessing

  useEffect(() => {
    onRequestReports(selectedDate)
    onRequestBudget()
  }, [selectedDate, onRequestReports, onRequestBudget])

  useEffect(() => {
    if (reports.length > prevReportCount.current && runRequested) {
      setRunRequested(false)
    }
    prevReportCount.current = reports.length
  }, [reports.length, runRequested])

  const handleRunNow = () => {
    setRunRequested(true)
    onRunNow()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Analysis Reports</h2>
          <p className="text-[11px] text-gray-600 font-mono mt-0.5">
            Scheduled analysis results — {reports.length} reports for {selectedDate}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="bg-[#0a0a0a] border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 font-mono focus:border-amber-500 focus:outline-none"
          />
          <button
            onClick={handleRunNow}
            disabled={running || (budgetStatus?.paused ?? false)}
            className="px-4 py-1.5 text-[11px] font-mono rounded bg-amber-500 text-black font-semibold hover:bg-amber-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {running ? 'Running...' : 'Run Now'}
          </button>
        </div>
      </div>

      {/* Agent progress banner */}
      {running && (
        <div className="border border-amber-800/50 bg-amber-900/20 rounded-lg px-4 py-3 flex items-center gap-3">
          <div className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
          <div className="flex-1">
            <span className="text-amber-400 text-sm font-mono">
              {isProcessing && agentStatus?.currentTicker
                ? `Analyzing ${agentStatus.currentTicker}...`
                : 'Agent processing...'}
            </span>
            {agentStatus && (
              <div className="flex items-center gap-3 mt-1 text-[10px] font-mono text-gray-500">
                <span>Model: {agentStatus.model}</span>
                {(agentStatus.queueDepth ?? 0) > 0 && <span>Queue: {agentStatus.queueDepth}</span>}
              </div>
            )}
          </div>
          <div className="w-24 h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-amber-400 rounded-full animate-pulse" style={{ width: '60%' }} />
          </div>
        </div>
      )}

      {/* Budget bar */}
      {budgetStatus && (
        <div className="border border-gray-800 rounded p-3 bg-[#0a0a0a]">
          <div className="flex items-center justify-between text-[11px] font-mono mb-1.5">
            <span className="text-gray-500">Daily Token Budget</span>
            <span className={budgetStatus.paused ? 'text-red-400' : 'text-gray-400'}>
              ${budgetStatus.dailySpentUsd.toFixed(2)} / ${budgetStatus.dailyBudgetUsd.toFixed(2)}
              {budgetStatus.paused && ' — PAUSED'}
            </span>
          </div>
          <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                budgetStatus.usagePct > 90 ? 'bg-red-500' : budgetStatus.usagePct > 60 ? 'bg-amber-500' : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(100, budgetStatus.usagePct)}%` }}
            />
          </div>
          {budgetStatus.history.length > 0 && (
            <div className="flex gap-1 mt-2">
              {budgetStatus.history.slice(0, 7).reverse().map(day => (
                <div key={day.date} className="flex-1 text-center">
                  <div
                    className="mx-auto w-full bg-gray-800 rounded-sm overflow-hidden"
                    style={{ height: '24px' }}
                  >
                    <div
                      className="w-full bg-amber-500/40 rounded-sm"
                      style={{ height: `${Math.min(100, (day.total / budgetStatus.dailyBudgetUsd) * 100)}%`, marginTop: 'auto' }}
                    />
                  </div>
                  <span className="text-[9px] text-gray-700 mt-0.5 block">{day.date.slice(5)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Timeline */}
      {reports.length === 0 ? (
        <div className="px-4 py-12 text-center text-gray-600 text-xs font-mono">
          No reports for this date.{' '}
          {!budgetStatus?.paused && (
            <button onClick={handleRunNow} className="text-amber-500 hover:text-amber-400">
              Run an analysis now
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map(report => {
            const typeInfo = RUN_TYPE_LABELS[report.runType] ?? RUN_TYPE_LABELS.manual
            const expanded = expandedId === report.id
            const tickers = Array.isArray(report.tickers) ? report.tickers : []

            return (
              <div key={report.id} className="border border-gray-800 rounded overflow-hidden">
                <button
                  onClick={() => setExpandedId(expanded ? null : report.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-[#0a0a0a] hover:bg-gray-900/50 transition-colors text-left"
                >
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${typeInfo.color}`}>
                    {typeInfo.label}
                  </span>
                  <span className="text-[11px] text-gray-400 font-mono">
                    {new Date(report.createdAt).toLocaleTimeString()}
                  </span>
                  <span className="text-[11px] text-gray-600 font-mono truncate flex-1">
                    {tickers.join(', ')}
                  </span>
                  <span className="text-[10px] text-gray-600 font-mono">
                    ${report.costUsd.toFixed(3)} · {report.model.split('-').slice(-1)[0]}
                  </span>
                  <span className="text-gray-600">{expanded ? '▼' : '▶'}</span>
                </button>
                {expanded && (
                  <div className="px-4 py-3 border-t border-gray-800 text-xs text-gray-300 font-mono leading-relaxed whitespace-pre-wrap max-h-96 overflow-auto">
                    {report.report}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
