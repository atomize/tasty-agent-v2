import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, existsSync } from 'node:fs'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { SDKMessage, SDKAssistantMessage } from '@anthropic-ai/claude-agent-sdk'
import { tradeRecommendationJsonSchema, formatRecommendation } from './schema.js'
import type { TradeRecommendation } from './schema.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = resolve(__dirname, '..')

function loadFile(name: string): string {
  const p = resolve(PKG_ROOT, name)
  return existsSync(p) ? readFileSync(p, 'utf-8').trim() : ''
}

const claudeMd = loadFile('.claude/CLAUDE.md')

function extractTextFromMessage(msg: SDKAssistantMessage): string {
  const content = msg.message?.content
  if (!content) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter(block => block.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('\n')
  }
  return ''
}

export interface InvokeOptions {
  apiKey: string
  model: string
  maxBudgetUsd: number
  maxTurns?: number
}

export async function invokeClaudeSDK(prompt: string, options: InvokeOptions): Promise<string> {
  const { apiKey, model, maxBudgetUsd, maxTurns = 5 } = options

  const q = query({
    prompt,
    options: {
      model,
      cwd: PKG_ROOT,
      systemPrompt: claudeMd || undefined,
      settingSources: ['project'],
      tools: ['Read', 'Grep', 'Glob'],
      allowedTools: ['Read', 'Grep', 'Glob'],
      permissionMode: 'dontAsk',
      maxTurns,
      maxBudgetUsd,
      persistSession: false,
      outputFormat: {
        type: 'json_schema',
        schema: tradeRecommendationJsonSchema as Record<string, unknown>,
      },
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: apiKey,
      },
    },
  })

  let resultText = ''
  let structuredOutput: unknown = null
  const assistantTexts: string[] = []

  for await (const msg of q as AsyncGenerator<SDKMessage, void>) {
    if (msg.type === 'assistant') {
      const text = extractTextFromMessage(msg as SDKAssistantMessage)
      if (text) assistantTexts.push(text)
    }

    if (msg.type === 'result') {
      const result = msg as unknown as {
        subtype: string
        result?: string
        structured_output?: unknown
        num_turns: number
        total_cost_usd: number
        is_error: boolean
        errors?: string[]
      }
      if (result.subtype === 'success') {
        resultText = result.result ?? ''
        structuredOutput = result.structured_output ?? null
      } else if (result.is_error) {
        const errors = result.errors?.join('; ') ?? result.subtype
        throw new Error(`Claude SDK error: ${errors}`)
      }
    }
  }

  if (structuredOutput) {
    try {
      return formatRecommendation(structuredOutput as TradeRecommendation)
    } catch { /* fall through */ }
  }

  if (resultText) return resultText
  if (assistantTexts.length > 0) return assistantTexts[assistantTexts.length - 1]
  return ''
}
