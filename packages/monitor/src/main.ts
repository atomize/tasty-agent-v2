import { WebSocket } from 'ws'

// Node.js polyfill: the SDK depends on isomorphic-ws and @dxfeed/dxlink-api
// which expect a global WebSocket constructor available in the environment.
Object.assign(globalThis, {
  WebSocket,
  window: { WebSocket, setTimeout, clearTimeout },
})

import { config } from './config.js'
import { initClient } from './tastytrade-auth.js'
import { initState } from './state.js'
import { startStreamer } from './streamer.js'
import { startBroadcaster } from './broadcaster.js'
import { startAccountPolling } from './account.js'
import { startAccountStreamer } from './accountStreamer.js'
import { startMetricsPolling } from './marketMetrics.js'
import { startScheduledTriggers } from './marketHours.js'
import { initOutputHandlers, type OutputMode } from './outputModes.js'
import { setOutputMode, log } from './logger.js'
import { getUniqueSymbols } from './watchlist.config.js'
import { initEncryption, decrypt } from './crypto.js'
import { getDb, getAgentConfig } from './db.js'
import { initOrchestrator, onAnalysisForPaperTrader } from './agent-orchestrator.js'
import type { PaperOrder, PaperPosition, PaperAccount } from '@tastytrade-monitor/shared'
import { getSnapshot } from './state.js'
import { broadcastToAll } from './broadcaster.js'

function parseArgs(): OutputMode {
  const modeIdx = process.argv.indexOf('--mode')
  if (modeIdx !== -1 && process.argv[modeIdx + 1]) {
    const mode = process.argv[modeIdx + 1] as OutputMode
    if (['dashboard', 'pipe', 'file'].includes(mode)) return mode
  }
  return 'dashboard'
}

async function main() {
  const mode = parseArgs()
  setOutputMode(mode)

  const isSandbox = config.tastytrade.env === 'sandbox'

  log.info('='.repeat(60))
  log.info('  tastytrade Options Monitor')
  log.info(`  Mode: ${mode}`)
  log.info(`  Environment: ${config.tastytrade.env}`)
  log.info(`  Symbols: ${getUniqueSymbols().length}`)
  if (isSandbox) {
    log.info('  ⚠ Sandbox: all quotes are 15-minute delayed')
    log.info('  ⚠ Sandbox: positions reset at midnight daily')
  }
  log.info('='.repeat(60))

  initState()
  initOutputHandlers(mode)

  const client = await initClient()

  startAccountPolling()
  startAccountStreamer()
  startMetricsPolling()

  await startStreamer(client)

  const multiTenant = initEncryption()
  if (multiTenant) {
    getDb()
    log.info('Multi-tenant mode: SQLite DB and encryption initialized')
  }

  if (mode !== 'pipe') {
    startBroadcaster()
    if (multiTenant) {
      initOrchestrator()
      await initPaperTrading()
    }
    log.info(`Dashboard WebSocket: ws://localhost:${config.server.wsPort}`)
  }

  startScheduledTriggers()

  setInterval(() => {
    const mem = process.memoryUsage()
    const rss = (mem.rss / 1024 / 1024).toFixed(1)
    const heap = (mem.heapUsed / 1024 / 1024).toFixed(1)
    const heapTotal = (mem.heapTotal / 1024 / 1024).toFixed(1)
    log.info(`Memory: RSS=${rss}MB heap=${heap}/${heapTotal}MB`)
  }, 300_000)

  log.info('Monitor is running. Press Ctrl+C to stop.')
}

async function initPaperTrading(): Promise<void> {
  try {
    const { initPaperTraderEngine, handleAnalysis, tickMarkToMarket } = await import('@tastytrade-monitor/paper-trader')
    const database = getDb()
    const snapshotProvider = { getSnapshot: (ticker: string) => getSnapshot(ticker) as { price: number; bid: number; ask: number } | undefined }

    initPaperTraderEngine(database, snapshotProvider, {
      onOrderFilled(order: PaperOrder, _position: PaperPosition, account: PaperAccount) {
        broadcastToAll({ type: 'paper_trade_executed', data: order })
        broadcastToAll({ type: 'paper_account', data: account })
      },
      onOrderRejected(order: PaperOrder, account: PaperAccount) {
        broadcastToAll({ type: 'paper_trade_executed', data: order })
        broadcastToAll({ type: 'paper_account', data: account })
      },
      onPositionClosed(_position: PaperPosition, _pnl: number, account: PaperAccount) {
        broadcastToAll({ type: 'paper_account', data: account })
      },
      onAccountUpdated(account: PaperAccount, positions: PaperPosition[]) {
        broadcastToAll({ type: 'paper_account', data: account })
        broadcastToAll({ type: 'paper_positions', data: positions })
      },
      log,
    }, async (userId: number) => {
      const cfg = getAgentConfig(userId)
      if (!cfg?.encrypted_api_key) return null
      const apiKey = decrypt(cfg.encrypted_api_key)
      const { chatDirect } = await import('@tastytrade-monitor/claude-agent/invoke-direct')
      return { chatDirect, apiKey, model: cfg.model }
    })

    onAnalysisForPaperTrader((userId, alert, analysisText, recommendation) => {
      void handleAnalysis({ userId, alertId: alert.id, ticker: alert.trigger.ticker, analysisText, recommendation: recommendation as { signal: string; trade: string; size: string; thesis: string; stop: string; invalidation: string } | null })
    })

    setInterval(tickMarkToMarket, 10_000)

    log.info('Paper trading engine initialized')
  } catch (err) {
    log.warn(`Paper trading init failed: ${(err as Error).message}`)
  }
}

main().catch((err) => {
  log.error('Fatal error:', err)
  process.exit(1)
})
