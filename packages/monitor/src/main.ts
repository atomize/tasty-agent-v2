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
import { initEncryption } from './crypto.js'
import { getDb } from './db.js'
import { initOrchestrator } from './agent-orchestrator.js'

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
    if (multiTenant) initOrchestrator()
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

main().catch((err) => {
  log.error('Fatal error:', err)
  process.exit(1)
})
