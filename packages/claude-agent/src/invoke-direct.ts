import Anthropic from '@anthropic-ai/sdk'
import { TradeRecommendationSchema, formatRecommendation } from './schema.js'
import type { TradeRecommendation } from './schema.js'

export interface DirectInvokeOptions {
  apiKey: string
  model: string
  maxTokens?: number
}

export interface AnalysisResult {
  text: string
  recommendation: TradeRecommendation | null
}

/**
 * Lightweight alert analysis using the Anthropic Messages API directly.
 * Returns both formatted text (for dashboard display) and the structured
 * TradeRecommendation (for paper trader) when parsing succeeds.
 */
export async function analyzeAlertDirect(
  prompt: string,
  options: DirectInvokeOptions,
): Promise<AnalysisResult> {
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

  if (!text) return { text: '', recommendation: null }

  try {
    const cleaned = text.replace(/```json\s*|\s*```/g, '').trim()
    const parsed = JSON.parse(cleaned)
    const rec = TradeRecommendationSchema.parse(parsed)
    return { text: formatRecommendation(rec), recommendation: rec }
  } catch {
    return { text: text.slice(0, 2000), recommendation: null }
  }
}

export interface ChatDirectOptions {
  apiKey: string
  model: string
  systemPrompt: string
  maxTokens?: number
}

export async function chatDirect(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  options: ChatDirectOptions,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const { apiKey, model, systemPrompt, maxTokens = 2048 } = options

  const client = new Anthropic({ apiKey })

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
  })

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')

  return {
    text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
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
