import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import type { OptionsAlert } from '@tastytrade-monitor/shared'
import { onAlert } from './alertBus.js'
import { log } from './logger.js'

export type OutputMode = 'dashboard' | 'pipe' | 'file'

export function initOutputHandlers(mode: OutputMode): void {
  initJsonlLogger()

  switch (mode) {
    case 'pipe':
      initPipeOutput()
      break
    case 'file':
      initFileOutput()
      break
    case 'dashboard':
      break
  }
}

function initJsonlLogger(): void {
  onAlert((alert: OptionsAlert) => {
    const dateStr = new Date().toISOString().split('T')[0]
    const filename = `alerts_${dateStr}.jsonl`
    const dir = join(process.cwd(), 'packages', 'monitor', 'alerts')
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, filename), JSON.stringify(alert) + '\n')
  })
}

function initPipeOutput(): void {
  onAlert((alert: OptionsAlert) => {
    const encoded = Buffer.from(JSON.stringify(alert)).toString('base64')
    process.stdout.write(`ALERT:${encoded}\n`)
  })

  setInterval(() => {
    process.stdout.write(`KEEPALIVE:${new Date().toISOString()}\n`)
  }, 30_000)
}

function initFileOutput(): void {
  const dir = join(process.cwd(), 'packages', 'monitor', 'alerts')
  mkdirSync(dir, { recursive: true })

  onAlert((alert: OptionsAlert) => {
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `alert_${ts}_${alert.trigger.ticker}.json`
    writeFileSync(join(dir, filename), JSON.stringify(alert, null, 2))
    log.info(`Alert written to ${filename}`)
  })
}
