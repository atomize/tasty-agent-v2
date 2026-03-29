import { useState, useEffect } from 'react'
import type { AgentConfigResponse, ScheduleConfigResponse, BudgetStatus, ScheduleConfig } from '@tastytrade-monitor/shared'

interface AgentSettingsProps {
  config: AgentConfigResponse | null
  onSave: (config: { provider: string; apiKey?: string; model?: string; maxBudgetUsd?: number; externalUrl?: string }) => void
  onRequest: () => void
  onTestAlert: (ticker: string) => void
  env: 'sandbox' | 'production'
  scheduleConfig: ScheduleConfigResponse | null
  budgetStatus: BudgetStatus | null
  onSaveSchedule: (cfg: Partial<ScheduleConfig>) => void
  onRequestSchedule: () => void
  onRequestBudget: () => void
}

const MODELS = [
  'claude-sonnet-4-20250514',
  'claude-opus-4-20250514',
  'claude-haiku-3-20250422',
]

export function AgentSettings({ config, onSave, onRequest, onTestAlert, env, scheduleConfig, budgetStatus, onSaveSchedule, onRequestSchedule, onRequestBudget }: AgentSettingsProps) {
  const [provider, setProvider] = useState<string>(config?.provider ?? 'none')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(config?.model ?? 'claude-sonnet-4-20250514')
  const [maxBudget, setMaxBudget] = useState(config?.maxBudgetUsd ?? 0.50)
  const [externalUrl, setExternalUrl] = useState(config?.externalUrl ?? '')
  const [saved, setSaved] = useState(false)
  const [testFired, setTestFired] = useState(false)

  const [schedEnabled, setSchedEnabled] = useState(true)
  const [dailyBudget, setDailyBudget] = useState(2.0)
  const [perRunBudget, setPerRunBudget] = useState(0.5)
  const [maxTickersPerRun, setMaxTickersPerRun] = useState(10)
  const [includeChains, setIncludeChains] = useState(true)
  const [schedSaved, setSchedSaved] = useState(false)

  useEffect(() => {
    onRequest()
    onRequestSchedule()
    onRequestBudget()
  }, [onRequest, onRequestSchedule, onRequestBudget])

  useEffect(() => {
    if (!config) return
    setProvider(config.provider)
    setModel(config.model)
    setMaxBudget(config.maxBudgetUsd)
    setExternalUrl(config.externalUrl ?? '')
  }, [config])

  useEffect(() => {
    if (!scheduleConfig) return
    setSchedEnabled(scheduleConfig.enabled)
    setDailyBudget(scheduleConfig.dailyBudgetUsd)
    setPerRunBudget(scheduleConfig.perRunBudgetUsd)
    setMaxTickersPerRun(scheduleConfig.maxTickersPerRun)
    setIncludeChains(scheduleConfig.includeChains)
  }, [scheduleConfig])

  const handleSave = () => {
    const payload: Record<string, unknown> = { provider, model, maxBudgetUsd: maxBudget }
    if (apiKey && !apiKey.includes('****')) payload.apiKey = apiKey
    if (externalUrl) payload.externalUrl = externalUrl
    onSave(payload as { provider: string; apiKey?: string; model?: string; maxBudgetUsd?: number; externalUrl?: string })
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const hasKey = !!config?.maskedApiKey
  const isConfigured = config && config.provider !== 'none'

  return (
    <div className="max-w-lg space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-1">Agent Configuration</h2>
        <p className="text-[11px] text-gray-600 font-mono">Configure your AI agent backend for alert analysis</p>
      </div>

      {/* Status banner */}
      {isConfigured ? (
        <div className="flex items-center gap-2 px-3 py-2 rounded border border-green-800/50 bg-green-900/10">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs text-green-400 font-medium">
            Agent active — {config.provider === 'claude-sdk' ? 'Claude API' : config.provider}
            {hasKey && ' — API key configured'}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2 rounded border border-gray-800 bg-gray-900/30">
          <span className="w-2 h-2 rounded-full bg-gray-600" />
          <span className="text-xs text-gray-500 font-medium">Agent disabled — select a provider below</span>
        </div>
      )}

      {/* Provider selector */}
      <div>
        <label className="block text-[11px] text-gray-500 uppercase tracking-wide mb-1.5">Provider</label>
        <div className="grid grid-cols-2 gap-2">
          {[
            { id: 'none', label: 'Disabled', desc: 'No agent' },
            { id: 'claude-sdk', label: 'Claude API', desc: 'Your API key' },
            { id: 'webhook', label: 'Webhook', desc: 'HTTP endpoint' },
            { id: 'websocket', label: 'WebSocket', desc: 'WS endpoint' },
          ].map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setProvider(opt.id)}
              className={`text-left px-3 py-2 rounded border transition-colors ${
                provider === opt.id
                  ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                  : 'border-gray-800 bg-[#0a0a0a] text-gray-500 hover:border-gray-700'
              }`}
            >
              <div className="text-xs font-medium">{opt.label}</div>
              <div className="text-[10px] mt-0.5 opacity-60">{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Claude SDK settings */}
      {provider === 'claude-sdk' && (
        <>
          <div>
            <label className="block text-[11px] text-gray-500 uppercase tracking-wide mb-1.5">Anthropic API Key</label>
            {hasKey && !apiKey && (
              <div className="flex items-center gap-2 mb-2 px-3 py-1.5 rounded bg-green-900/10 border border-green-800/30">
                <svg className="w-3.5 h-3.5 text-green-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                </svg>
                <span className="text-[11px] text-green-400 font-mono">Key saved: {config?.maskedApiKey}</span>
              </div>
            )}
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder={hasKey ? 'Enter new key to replace existing' : 'sk-ant-api03-...'}
              className="w-full bg-[#0a0a0a] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 font-mono focus:border-amber-500 focus:outline-none placeholder:text-gray-700"
            />
            {!hasKey && (
              <p className="text-[10px] text-yellow-600 mt-1 font-mono">No API key saved — enter your key and click Save</p>
            )}
          </div>

          <div>
            <label className="block text-[11px] text-gray-500 uppercase tracking-wide mb-1.5">Model</label>
            <select
              value={model}
              onChange={e => setModel(e.target.value)}
              className="w-full bg-[#0a0a0a] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 font-mono focus:border-amber-500 focus:outline-none"
            >
              {MODELS.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-gray-500 uppercase tracking-wide mb-1.5">
              Max Budget per Alert: ${maxBudget.toFixed(2)}
            </label>
            <input
              type="range"
              min={0.10}
              max={5.00}
              step={0.10}
              value={maxBudget}
              onChange={e => setMaxBudget(parseFloat(e.target.value))}
              className="w-full accent-amber-500"
            />
            <div className="flex justify-between text-[10px] text-gray-700 font-mono">
              <span>$0.10</span>
              <span>$5.00</span>
            </div>
          </div>
        </>
      )}

      {/* External agent settings */}
      {(provider === 'webhook' || provider === 'websocket') && (
        <div>
          <label className="block text-[11px] text-gray-500 uppercase tracking-wide mb-1.5">
            {provider === 'webhook' ? 'Webhook URL' : 'WebSocket URL'}
          </label>
          <input
            type="url"
            value={externalUrl}
            onChange={e => setExternalUrl(e.target.value)}
            placeholder={provider === 'webhook' ? 'https://your-agent.example.com/analyze' : 'wss://your-agent.example.com'}
            className="w-full bg-[#0a0a0a] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 font-mono focus:border-amber-500 focus:outline-none placeholder:text-gray-700"
          />
          <p className="text-[10px] text-gray-600 mt-1 font-mono">
            {provider === 'webhook'
              ? 'POST with { alert } body, expects { analysis, model? } response'
              : 'Send { type: "alert", data } messages, receive { type: "agent_analysis", data }'}
          </p>
        </div>
      )}

      {/* Save + Test buttons */}
      <div className="pt-2 flex gap-3 items-center">
        <button
          type="button"
          onClick={handleSave}
          className={`px-6 py-2 text-sm font-semibold rounded transition-colors ${
            saved
              ? 'bg-green-600 text-white'
              : 'bg-amber-500 hover:bg-amber-600 text-black'
          }`}
        >
          {saved ? 'Saved!' : 'Save Configuration'}
        </button>

        {provider !== 'none' && env === 'sandbox' && (
          <button
            type="button"
            disabled={provider === 'claude-sdk' && !hasKey && !apiKey}
            onClick={() => {
              onTestAlert('NVDA')
              setTestFired(true)
              setTimeout(() => setTestFired(false), 5000)
            }}
            className={`px-4 py-2 text-sm font-medium rounded border transition-colors ${
              testFired
                ? 'border-green-600 text-green-400 bg-green-900/20'
                : provider === 'claude-sdk' && !hasKey && !apiKey
                  ? 'border-gray-800 text-gray-700 bg-transparent cursor-not-allowed'
                  : 'border-amber-800/50 text-amber-400/70 hover:border-amber-500/50 hover:text-amber-400 bg-amber-900/10'
            }`}
          >
            {testFired ? 'Alert Sent — check Analysis tab' : 'TEST — Fire Synthetic Alert'}
          </button>
        )}
      </div>

      {saved && (
        <p className="text-[11px] text-green-400 font-mono animate-pulse">Configuration saved to server</p>
      )}

      {/* Schedule Configuration */}
      <div className="pt-4 border-t border-gray-800">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-1">Scheduled Analysis</h2>
        <p className="text-[11px] text-gray-600 font-mono mb-4">4x/day intraday analysis during market hours (9:45, 11:30, 1:30, 3:00 CT)</p>

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={schedEnabled}
                onChange={e => setSchedEnabled(e.target.checked)}
                className="accent-amber-500"
              />
              <span className="text-xs text-gray-400">Enable scheduled analysis</span>
            </label>
          </div>

          <div>
            <label className="block text-[11px] text-gray-500 uppercase tracking-wide mb-1.5">
              Daily Budget: ${dailyBudget.toFixed(2)}
            </label>
            <input
              type="range"
              min={0.5}
              max={20}
              step={0.5}
              value={dailyBudget}
              onChange={e => setDailyBudget(parseFloat(e.target.value))}
              className="w-full accent-amber-500"
            />
            <div className="flex justify-between text-[10px] text-gray-700 font-mono">
              <span>$0.50</span>
              <span>$20.00</span>
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-gray-500 uppercase tracking-wide mb-1.5">
              Per-Run Budget: ${perRunBudget.toFixed(2)}
            </label>
            <input
              type="range"
              min={0.1}
              max={5}
              step={0.1}
              value={perRunBudget}
              onChange={e => setPerRunBudget(parseFloat(e.target.value))}
              className="w-full accent-amber-500"
            />
            <div className="flex justify-between text-[10px] text-gray-700 font-mono">
              <span>$0.10</span>
              <span>$5.00</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wide mb-1.5">Max Tickers/Run</label>
              <input
                type="number"
                min={1}
                max={50}
                value={maxTickersPerRun}
                onChange={e => setMaxTickersPerRun(parseInt(e.target.value) || 10)}
                className="w-full bg-[#0a0a0a] border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 font-mono focus:border-amber-500 focus:outline-none"
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer pt-4">
              <input
                type="checkbox"
                checked={includeChains}
                onChange={e => setIncludeChains(e.target.checked)}
                className="accent-amber-500"
              />
              <span className="text-xs text-gray-400">Include option chains</span>
            </label>
          </div>

          <button
            onClick={() => {
              onSaveSchedule({
                enabled: schedEnabled,
                dailyBudgetUsd: dailyBudget,
                perRunBudgetUsd: perRunBudget,
                maxTickersPerRun,
                includeChains,
              })
              setSchedSaved(true)
              setTimeout(() => setSchedSaved(false), 3000)
            }}
            className={`px-4 py-1.5 text-sm font-semibold rounded transition-colors ${
              schedSaved
                ? 'bg-green-600 text-white'
                : 'bg-amber-500 hover:bg-amber-600 text-black'
            }`}
          >
            {schedSaved ? 'Schedule Saved!' : 'Save Schedule'}
          </button>
        </div>
      </div>

      {/* Budget Usage */}
      {budgetStatus && (
        <div className="pt-4 border-t border-gray-800">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">Token Usage</h2>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] font-mono">
              <span className="text-gray-500">Today</span>
              <span className={budgetStatus.paused ? 'text-red-400' : 'text-gray-300'}>
                ${budgetStatus.dailySpentUsd.toFixed(2)} / ${budgetStatus.dailyBudgetUsd.toFixed(2)}
                {budgetStatus.paused && ' PAUSED'}
              </span>
            </div>
            <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  budgetStatus.usagePct > 90 ? 'bg-red-500' : budgetStatus.usagePct > 60 ? 'bg-amber-500' : 'bg-green-500'
                }`}
                style={{ width: `${Math.min(100, budgetStatus.usagePct)}%` }}
              />
            </div>
            {budgetStatus.history.length > 0 && (
              <div className="mt-3">
                <span className="text-[10px] text-gray-600 uppercase tracking-wide">7-Day History</span>
                <div className="mt-1 space-y-1">
                  {budgetStatus.history.map(day => (
                    <div key={day.date} className="flex items-center gap-2 text-[10px] font-mono">
                      <span className="text-gray-600 w-12">{day.date.slice(5)}</span>
                      <div className="flex-1 h-1 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-500/60 rounded-full"
                          style={{ width: `${Math.min(100, (day.total / budgetStatus.dailyBudgetUsd) * 100)}%` }}
                        />
                      </div>
                      <span className="text-gray-600 w-12 text-right">${day.total.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
