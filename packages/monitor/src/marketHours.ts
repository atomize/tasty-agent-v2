import { config } from './config.js'
import { triggerScheduled } from './triggers.js'
import { getAllEnabledSchedules, getAgentConfig } from './db.js'
import { runScheduledAnalysis, type RunType } from './scheduledAnalysis.js'
import { broadcastNewReport } from './broadcaster.js'
import { log } from './logger.js'

function getChicagoDate(): Date {
  return new Date(
    new Date().toLocaleString('en-US', { timeZone: config.schedule.timezone })
  )
}

export function isMarketOpen(): boolean {
  const ct = getChicagoDate()
  const day = ct.getDay()
  if (day === 0 || day === 6) return false

  const minutes = ct.getHours() * 60 + ct.getMinutes()
  return minutes >= 570 && minutes <= 960  // 9:30 - 16:00
}

function getChicagoTimeStr(): string {
  const ct = getChicagoDate()
  const h = ct.getHours().toString().padStart(2, '0')
  const m = ct.getMinutes().toString().padStart(2, '0')
  return `${h}:${m}`
}

function resolveRunType(runIndex: number, totalRuns: number): RunType {
  if (runIndex === 0) return 'morning'
  if (runIndex === totalRuns - 1) return 'preclose'
  if (runIndex === 1) return 'midday_1'
  return 'midday_2'
}

export function startScheduledTriggers(): void {
  setInterval(() => {
    const ct = getChicagoDate()
    const day = ct.getDay()
    if (day === 0 || day === 6) return

    const minutes = ct.getHours() * 60 + ct.getMinutes()

    if (minutes === 570 + config.schedule.openRunMinutesAfterOpen) {
      triggerScheduled('SCHEDULED_OPEN')
    }

    if (minutes === 960 - config.schedule.closeRunMinutesBefore) {
      triggerScheduled('SCHEDULED_CLOSE')
    }

    checkScheduledAnalysisRuns()
  }, 60_000)

  log.info('Scheduled triggers active (alerts + per-user analysis runs)')
}

function checkScheduledAnalysisRuns(): void {
  const timeStr = getChicagoTimeStr()
  const schedules = getAllEnabledSchedules()

  for (const sched of schedules) {
    let runTimes: string[]
    try { runTimes = JSON.parse(sched.run_times_ct) } catch { continue }

    const runIndex = runTimes.indexOf(timeStr)
    if (runIndex === -1) continue

    const agentCfg = getAgentConfig(sched.user_id)
    if (!agentCfg || agentCfg.provider === 'none') continue

    const isLastRun = runIndex === runTimes.length - 1
    const runType = resolveRunType(runIndex, runTimes.length)
    log.info(`Triggering scheduled analysis [${runType}] for user ${sched.user_id} (${sched.email}) at ${timeStr} CT`)

    runScheduledAnalysis(sched.user_id, agentCfg, runType)
      .then(report => {
        if (report) broadcastNewReport(report)

        if (isLastRun) {
          log.info(`Triggering next-day prep for user ${sched.user_id} (${sched.email})`)
          return runScheduledAnalysis(sched.user_id, agentCfg, 'nextday')
        }
        return null
      })
      .then(nextdayReport => {
        if (nextdayReport) broadcastNewReport(nextdayReport)
      })
      .catch(err => {
        log.error(`Scheduled analysis failed for user ${sched.user_id}: ${(err as Error).message}`)
      })
  }
}
