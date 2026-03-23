import { useState, useEffect } from 'react'
import type { AgentConfigResponse } from '@tastytrade-monitor/shared'

interface AgentSettingsProps {
  config: AgentConfigResponse | null
  onSave: (config: { provider: string; apiKey?: string; model?: string; maxBudgetUsd?: number; externalUrl?: string }) => void
  onRequest: () => void
  onTestAlert: (ticker: string) => void
}

const MODELS = [
  'claude-sonnet-4-20250514',
  'claude-opus-4-20250514',
  'claude-haiku-3-20250422',
]

export function AgentSettings({ config, onSave, onRequest, onTestAlert }: AgentSettingsProps) {
  const [provider, setProvider] = useState<string>(config?.provider ?? 'none')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(config?.model ?? 'claude-sonnet-4-20250514')
  const [maxBudget, setMaxBudget] = useState(config?.maxBudgetUsd ?? 0.50)
  const [externalUrl, setExternalUrl] = useState(config?.externalUrl ?? '')
  const [saved, setSaved] = useState(false)
  const [testFired, setTestFired] = useState(false)

  useEffect(() => {
    onRequest()
  }, [onRequest])

  useEffect(() => {
    if (!config) return
    setProvider(config.provider)
    setModel(config.model)
    setMaxBudget(config.maxBudgetUsd)
    setExternalUrl(config.externalUrl ?? '')
  }, [config])

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

        {provider !== 'none' && (
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
                  : 'border-gray-700 text-gray-400 hover:border-amber-500/50 hover:text-amber-400 bg-transparent'
            }`}
          >
            {testFired ? 'Alert Sent — check Analysis tab' : 'Fire Test Alert'}
          </button>
        )}
      </div>

      {saved && (
        <p className="text-[11px] text-green-400 font-mono animate-pulse">Configuration saved to server</p>
      )}
    </div>
  )
}
