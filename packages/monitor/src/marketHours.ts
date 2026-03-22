import { config } from './config.js'
import { triggerScheduled } from './triggers.js'
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

export function startScheduledTriggers(): void {
  setInterval(() => {
    const ct = getChicagoDate()
    const day = ct.getDay()
    if (day === 0 || day === 6) return

    const minutes = ct.getHours() * 60 + ct.getMinutes()

    // 9:45am CT = 585 minutes
    if (minutes === 570 + config.schedule.openRunMinutesAfterOpen) {
      triggerScheduled('SCHEDULED_OPEN')
    }

    // 3:00pm CT = 900 minutes
    if (minutes === 960 - config.schedule.closeRunMinutesBefore) {
      triggerScheduled('SCHEDULED_CLOSE')
    }
  }, 60_000)

  log.info('Scheduled triggers active (9:45am + 3:00pm CT on trading days)')
}
