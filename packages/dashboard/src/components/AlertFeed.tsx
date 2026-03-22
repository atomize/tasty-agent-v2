import { useState } from 'react'
import type { OptionsAlert } from '@tastytrade-monitor/shared'

interface Props {
  alerts: OptionsAlert[]
}

const SEVERITY_CLASSES: Record<string, string> = {
  high: 'border-l-red-500 bg-red-950/20',
  medium: 'border-l-amber-500 bg-amber-950/20',
  low: 'border-l-gray-600 bg-gray-900/20',
}

const TRIGGER_LABELS: Record<string, string> = {
  IV_SPIKE: 'IV Spike',
  PRICE_MOVE: 'Price Move',
  CRYPTO_PRICE_MOVE: 'Crypto Move',
  IV_RANK_HIGH: 'IV Rank High',
  IV_RANK_LOW: 'IV Rank Low',
  SCHEDULED_OPEN: 'Scheduled Open',
  SCHEDULED_CLOSE: 'Scheduled Close',
  MANUAL: 'Manual',
}

export function AlertFeed({ alerts }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<string>('')

  const filtered = typeFilter
    ? alerts.filter(a => a.trigger.type === typeFilter)
    : alerts

  return (
    <div>
      <div className="mb-3 flex gap-2 flex-wrap">
        <button
          onClick={() => setTypeFilter('')}
          className={`px-2 py-1 text-[10px] rounded uppercase font-medium ${
            !typeFilter ? 'bg-amber-600 text-black' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >
          All ({alerts.length})
        </button>
        {Object.entries(TRIGGER_LABELS).map(([key, label]) => {
          const count = alerts.filter(a => a.trigger.type === key).length
          if (count === 0) return null
          return (
            <button
              key={key}
              onClick={() => setTypeFilter(key)}
              className={`px-2 py-1 text-[10px] rounded uppercase font-medium ${
                typeFilter === key ? 'bg-amber-600 text-black' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {label} ({count})
            </button>
          )
        })}
      </div>

      <div className="space-y-1">
        {filtered.map(alert => (
          <div
            key={alert.id}
            className={`border-l-2 rounded-r px-3 py-2 cursor-pointer transition-colors ${
              SEVERITY_CLASSES[alert.severity] ?? SEVERITY_CLASSES.low
            } ${alert.id === filtered[0]?.id ? 'animate-flash' : ''}`}
            onClick={() => setExpandedId(expandedId === alert.id ? null : alert.id)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="font-mono text-[10px] text-gray-500">
                  {new Date(alert.timestamp).toLocaleTimeString()}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase severity-${alert.severity}`}>
                  {alert.severity}
                </span>
                <span className="text-[10px] text-gray-500 uppercase">
                  {TRIGGER_LABELS[alert.trigger.type] ?? alert.trigger.type}
                </span>
                <span className="font-mono font-semibold text-amber-400 text-sm">
                  {alert.trigger.ticker}
                </span>
              </div>
              <span className="text-xs text-gray-400 max-w-[400px] truncate">
                {alert.trigger.description}
              </span>
            </div>

            {expandedId === alert.id && (
              <div className="mt-3 border-t border-gray-800 pt-3">
                <pre className="text-[11px] text-gray-400 whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto">
                  {alert.agentContext}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-gray-600 text-sm">
          No alerts yet. Triggers will fire on IV spikes, price moves, and scheduled times.
        </div>
      )}
    </div>
  )
}
