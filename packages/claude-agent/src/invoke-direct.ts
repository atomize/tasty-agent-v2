import Anthropic from '@anthropic-ai/sdk'
import { TradeRecommendationSchema, formatRecommendation } from './schema.js'

export interface DirectInvokeOptions {
  apiKey: string
  model: string
  maxTokens?: number
}

/**
 * Lightweight alert analysis using the Anthropic Messages API directly.
 * Unlike invokeClaudeSDK (which spawns a subprocess via the Agent SDK),
 * this makes a single HTTP call — ~0 extra memory overhead.
 */
export async function analyzeAlertDirect(
  prompt: string,
  options: DirectInvokeOptions,
): Promise<string> {
  const { apiKey, model, maxTokens = 1024 } = options

  const client = new Anthropic({ apiKey })

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
    system:
      'You are a concise options trading analyst. Respond ONLY with valid JSON matching this schema: { signal: string, trade: string, size: string, thesis: string, stop: string, invalidation: string }. No markdown fences, no explanation outside the JSON.',
  })

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')

  if (!text) return ''

  try {
    const cleaned = text.replace(/```json\s*|\s*```/g, '').trim()
    const parsed = JSON.parse(cleaned)
    const rec = TradeRecommendationSchema.parse(parsed)
    return formatRecommendation(rec)
  } catch {
    return text.slice(0, 2000)
  }
}

export function estimateAlertCost(model: string): number {
  const rates: Record<string, { inPer1k: number; outPer1k: number }> = {
    'claude-sonnet-4-20250514': { inPer1k: 0.003, outPer1k: 0.015 },
    'claude-haiku-4-20250414': { inPer1k: 0.0008, outPer1k: 0.004 },
  }
  const r = rates[model] ?? rates['claude-sonnet-4-20250514']
  return r.inPer1k * 1.5 + r.outPer1k * 0.5
}
