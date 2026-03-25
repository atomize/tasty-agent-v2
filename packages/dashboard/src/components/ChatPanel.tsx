import { useState, useRef, useEffect } from 'react'
import type { ChatMessage } from '@tastytrade-monitor/shared'

interface Props {
  messages: ChatMessage[]
  onSend: (message: string) => void
  onClear: () => void
  isOpen: boolean
  onClose: () => void
  watchlistCount: number
  alertCount: number
}

export function ChatPanel({ messages, onSend, onClear, isOpen, onClose, watchlistCount, alertCount }: Props) {
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (isOpen) inputRef.current?.focus()
  }, [isOpen])

  useEffect(() => {
    const last = messages[messages.length - 1]
    if (last?.role === 'assistant') setSending(false)
  }, [messages])

  const handleSend = () => {
    const text = input.trim()
    if (!text || sending) return
    setSending(true)
    onSend(text)
    setInput('')
  }

  if (!isOpen) return null

  return (
    <div className="fixed bottom-4 right-4 w-[420px] h-[560px] flex flex-col bg-[#0f0f0f] border border-gray-800 rounded-lg shadow-2xl z-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800 bg-[#0a0a0a]">
        <div>
          <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Agent Chat</h3>
          <p className="text-[10px] text-gray-600 font-mono">
            Context: {watchlistCount} symbols, {alertCount} alerts
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onClear}
            className="text-[10px] text-gray-600 hover:text-gray-400 font-mono transition-colors"
          >
            Clear
          </button>
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-gray-300 transition-colors text-lg leading-none"
          >
            ×
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-gray-600 text-xs font-mono py-8">
            Ask your agent about watchlist tickers, market conditions, or trade ideas.
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-xs font-mono leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-amber-500/15 text-amber-200 border border-amber-500/20'
                  : 'bg-gray-800/50 text-gray-300 border border-gray-700/50'
              }`}
            >
              <div className="whitespace-pre-wrap break-words">{msg.content}</div>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[9px] text-gray-600">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </span>
                {msg.costUsd !== undefined && msg.costUsd > 0 && (
                  <span className="text-[9px] text-gray-700">${msg.costUsd.toFixed(4)}</span>
                )}
              </div>
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg px-3 py-2">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-800 px-3 py-2.5 bg-[#0a0a0a]">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="Ask about your watchlist..."
            rows={1}
            className="flex-1 bg-[#111] border border-gray-700 rounded px-3 py-1.5 text-xs text-gray-200 font-mono focus:border-amber-500 focus:outline-none placeholder:text-gray-700 resize-none"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="px-3 py-1.5 text-xs font-mono rounded bg-amber-500 text-black font-semibold hover:bg-amber-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

export function ChatToggleButton({ onClick, messageCount }: { onClick: () => void; messageCount: number }) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-4 right-4 w-12 h-12 rounded-full bg-amber-500 text-black shadow-lg hover:bg-amber-600 transition-colors flex items-center justify-center z-40"
      title="Open Agent Chat"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
      </svg>
      {messageCount > 0 && (
        <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
          {messageCount > 9 ? '9+' : messageCount}
        </span>
      )}
    </button>
  )
}
