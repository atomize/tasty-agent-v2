import type { BudgetStatus, TokenUsageSummary } from '@tastytrade-monitor/shared'
import { recordTokenUsage, getDailySpend, getUsageSummary, getScheduleConfig } from './db.js'
import { log } from './logger.js'

const DEFAULT_DAILY_BUDGET = 2.0

export function checkBudget(userId: number): { allowed: boolean; remaining: number; dailyBudget: number } {
  const cfg = getScheduleConfig(userId)
  const dailyBudget = cfg?.daily_budget_usd ?? DEFAULT_DAILY_BUDGET
  const spent = getDailySpend(userId)
  const remaining = Math.max(0, dailyBudget - spent)
  return { allowed: remaining > 0, remaining, dailyBudget }
}

export function checkRunBudget(userId: number): { allowed: boolean; perRunBudget: number; remaining: number } {
  const cfg = getScheduleConfig(userId)
  const perRunBudget = cfg?.per_run_budget_usd ?? 0.5
  const { allowed, remaining } = checkBudget(userId)
  return { allowed: allowed && remaining >= perRunBudget * 0.1, perRunBudget, remaining }
}

export function trackUsage(
  userId: number,
  source: 'scheduled' | 'chat' | 'alert' | 'manual',
  costUsd: number,
  tokensIn: number,
  tokensOut: number,
  runId?: string,
): void {
  recordTokenUsage(userId, source, costUsd, tokensIn, tokensOut, runId)
  const { remaining, dailyBudget } = checkBudget(userId)
  const pct = dailyBudget > 0 ? ((dailyBudget - remaining) / dailyBudget * 100).toFixed(1) : '0'
  log.info(`Token usage: user=${userId} source=${source} cost=$${costUsd.toFixed(4)} daily=${pct}% ($${(dailyBudget - remaining).toFixed(2)}/$${dailyBudget.toFixed(2)})`)
}

export function getBudgetStatus(userId: number): BudgetStatus {
  const cfg = getScheduleConfig(userId)
  const dailyBudget = cfg?.daily_budget_usd ?? DEFAULT_DAILY_BUDGET
  const spent = getDailySpend(userId)
  const remaining = Math.max(0, dailyBudget - spent)
  const usagePct = dailyBudget > 0 ? (spent / dailyBudget) * 100 : 0

  const rawHistory = getUsageSummary(userId, 7)
  const history: TokenUsageSummary[] = rawHistory.map(r => ({
    date: r.date,
    total: r.total,
    scheduled: r.scheduled,
    chat: r.chat,
    alert: r.alert,
  }))

  return {
    dailyBudgetUsd: dailyBudget,
    dailySpentUsd: spent,
    remainingUsd: remaining,
    usagePct,
    paused: remaining <= 0,
    history,
  }
}
