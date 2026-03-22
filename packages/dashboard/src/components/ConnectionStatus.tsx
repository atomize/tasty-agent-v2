interface Props {
  connected: boolean
  uptime: number
  env: 'sandbox' | 'production'
  isDelayed: boolean
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function ConnectionStatus({ connected, uptime, env, isDelayed }: Props) {
  return (
    <div className="flex items-center gap-3 text-xs">
      <div className="flex items-center gap-1.5">
        <span
          className={`w-2 h-2 rounded-full ${
            connected ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]' : 'bg-red-500'
          }`}
        />
        <span className={connected ? 'text-green-400' : 'text-red-400'}>
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>

      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
        env === 'sandbox'
          ? 'bg-amber-900/50 text-amber-400 border border-amber-800/50'
          : 'bg-green-900/50 text-green-400 border border-green-800/50'
      }`}>
        {env}
      </span>

      {isDelayed && (
        <span className="text-amber-500 text-[10px]">15m delayed</span>
      )}

      {connected && uptime > 0 && (
        <span className="text-gray-600 font-mono">{formatUptime(uptime)}</span>
      )}
    </div>
  )
}
