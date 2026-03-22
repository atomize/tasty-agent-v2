import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'

export const TradeRecommendationSchema = z.object({
  signal: z.string().describe('1 sentence: what fired and why it matters'),
  trade: z.string().describe('[Buy/Sell] [Call/Put/Spread] [TICKER] [Strike] [Expiry] @ [price], or "Spot only — no options" for crypto'),
  size: z.string().describe('[1-5]% of buying power, or "N/A" for crypto'),
  thesis: z.string().describe('1-2 sentences max'),
  stop: z.string().describe('Exit condition'),
  invalidation: z.string().describe('What kills the trade'),
})

export type TradeRecommendation = z.infer<typeof TradeRecommendationSchema>

export const tradeRecommendationJsonSchema = zodToJsonSchema(TradeRecommendationSchema, {
  $refStrategy: 'none',
})

export function formatRecommendation(rec: TradeRecommendation): string {
  return [
    `**Signal**: ${rec.signal}`,
    `**Trade**: ${rec.trade}`,
    `**Size**: ${rec.size}`,
    `**Thesis**: ${rec.thesis}`,
    `**Stop**: ${rec.stop}`,
    `**Invalidation**: ${rec.invalidation}`,
  ].join('\n')
}
