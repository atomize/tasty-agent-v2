import { useState } from 'react'

interface AuthGateProps {
  error: string | null
  onLogin: (email: string, password: string) => void
  onRegister: (email: string, password: string) => void
}

export function AuthGate({ error, onLogin, onRegister }: AuthGateProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError(null)

    if (!email || !password) {
      setLocalError('Email and password are required')
      return
    }

    if (mode === 'register') {
      if (password.length < 6) {
        setLocalError('Password must be at least 6 characters')
        return
      }
      if (password !== confirmPw) {
        setLocalError('Passwords do not match')
        return
      }
      onRegister(email, password)
    } else {
      onLogin(email, password)
    }
  }

  const displayError = localError || error

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-lg font-bold tracking-wider uppercase text-gray-300">
            tastytrade Monitor
          </h1>
          <p className="text-xs text-gray-600 mt-1 font-mono">Multi-tenant agent configuration</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-[#141414] border border-gray-800 rounded-lg p-6 space-y-4">
          <div className="flex gap-2 mb-2">
            <button
              type="button"
              onClick={() => { setMode('login'); setLocalError(null) }}
              className={`flex-1 py-1.5 text-xs font-medium uppercase tracking-wide rounded transition-colors ${
                mode === 'login' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'text-gray-500 hover:text-gray-400'
              }`}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => { setMode('register'); setLocalError(null) }}
              className={`flex-1 py-1.5 text-xs font-medium uppercase tracking-wide rounded transition-colors ${
                mode === 'register' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'text-gray-500 hover:text-gray-400'
              }`}
            >
              Register
            </button>
          </div>

          <div>
            <label className="block text-[11px] text-gray-500 uppercase tracking-wide mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full bg-[#0a0a0a] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 font-mono focus:border-amber-500 focus:outline-none"
              autoComplete="email"
            />
          </div>

          <div>
            <label className="block text-[11px] text-gray-500 uppercase tracking-wide mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-[#0a0a0a] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 font-mono focus:border-amber-500 focus:outline-none"
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            />
          </div>

          {mode === 'register' && (
            <div>
              <label className="block text-[11px] text-gray-500 uppercase tracking-wide mb-1">Confirm Password</label>
              <input
                type="password"
                value={confirmPw}
                onChange={e => setConfirmPw(e.target.value)}
                className="w-full bg-[#0a0a0a] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 font-mono focus:border-amber-500 focus:outline-none"
                autoComplete="new-password"
              />
            </div>
          )}

          {displayError && (
            <div className="text-red-400 text-xs font-mono bg-red-900/20 border border-red-800/30 rounded px-3 py-2">
              {displayError}
            </div>
          )}

          <button
            type="submit"
            className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-black text-sm font-semibold rounded transition-colors"
          >
            {mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  )
}
