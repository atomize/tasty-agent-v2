#!/usr/bin/env node

/**
 * Persistent alert listener that invokes `pi --print` on-demand per alert.
 *
 * Stays alive as the main container process, connects to the monitor WS,
 * and spawns a one-shot `pi --print --no-session` for each incoming alert.
 * The pi extension (alert-receiver.ts) is still loaded for interactive use;
 * this runner handles the headless/container case.
 */

import { WebSocket } from 'ws'
import { spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const WS_URL = process.env.MONITOR_WS_URL || 'ws://localhost:3001'
const PI_MODEL = process.env.PI_MODEL || 'claude-sonnet-4-20250514'
const MAX_QUEUE = 5
const COOLDOWN_MS = 300_000
const RECONNECT_MS = 5_000
const PI_TIMEOUT_MS = 60_000

const alertQueue = []
const cooldowns = new Map()
let isProcessing = false
let currentTicker = null
let lastError = null
let lastAlertTime = null
let ws = null

function sendStatus(state, ticker, error) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  currentTicker = ticker
  lastError = error
  ws.send(JSON.stringify({
    type: 'agent_status',
    data: {
      connected: true,
      state,
      model: PI_MODEL,
      currentTicker: ticker,
      lastError: error,
      lastAlertTime,
      queueDepth: alertQueue.length,
    },
  }))
}

function log(msg) {
  console.error(`[runner] ${msg}`)
}

function loadFile(name) {
  const path = resolve(__dirname, name)
  return existsSync(path) ? readFileSync(path, 'utf-8').trim() : ''
}

const systemPrompt = loadFile('SYSTEM.md')
const agentsContext = loadFile('AGENTS.md')

function strategyHint(alert) {
  const strategies = alert.strategies || []
  const layer = alert.supplyChainLayer || ''
  if (strategies.includes('crypto')) return 'Crypto spot — no options available. Directional bias only.'
  if (strategies.includes('supply_chain') || layer.startsWith('Layer'))
    return `AI supply chain: ${layer}. Check IV rank for premium selling vs buying.`
  if (strategies.includes('midterm_macro') || layer.startsWith('Macro'))
    return `Macro play: ${layer}. 30-90 day horizon, check hedging needs.`
  return ''
}

function buildPrompt(alert) {
  const isDelayed = (alert.agentContext || '').includes('15-min delayed')
  const hint = strategyHint(alert)

  let prompt = systemPrompt + '\n\n'
  if (agentsContext) prompt += agentsContext + '\n\n'
  if (isDelayed) prompt += '[SANDBOX — 15-min delayed data]\n'
  if (hint) prompt += `[Strategy: ${hint}]\n\n`
  prompt += alert.agentContext || JSON.stringify(alert.trigger, null, 2)
  prompt += '\n\nRespond using the exact format from your system prompt. Under 150 words.'

  return prompt
}

function invokePi(prompt) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false

    log(`Spawning pi --print (prompt: ${prompt.length} chars)`)

    const child = spawn('pi', ['--print', '--no-session'], {
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      log('pi timeout — killing process')
      child.kill('SIGTERM')
      setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 5000)
      reject(new Error('pi timed out'))
    }, PI_TIMEOUT_MS)

    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      log(`pi spawn error: ${err.message}`)
      reject(err)
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (stderr) log(`pi stderr: ${stderr.slice(0, 500)}`)
      if (code !== 0) {
        log(`pi exited with code ${code}`)
        return reject(new Error(`pi exited ${code}: ${stderr.slice(0, 200)}`))
      }
      resolve(stdout.trim())
    })

    child.stdin.write(prompt)
    child.stdin.end()
  })
}

function sendAnalysis(alert, analysis) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return

  ws.send(JSON.stringify({
    type: 'agent_analysis',
    data: {
      alertId: alert.id,
      timestamp: new Date().toISOString(),
      model: PI_MODEL,
      analysis,
      ticker: alert.trigger?.ticker || 'unknown',
      triggerType: alert.trigger?.type || 'unknown',
    },
  }))

  log(`Analysis posted for ${alert.trigger?.ticker}`)
}

async function processAlert(alert) {
  isProcessing = true
  const ticker = alert.trigger?.ticker || '?'
  lastAlertTime = new Date().toISOString()
  log(`Processing alert: ${ticker} ${alert.trigger?.type}`)
  sendStatus('processing', ticker, null)

  try {
    const prompt = buildPrompt(alert)
    const analysis = await invokePi(prompt)

    if (analysis) {
      sendAnalysis(alert, analysis)
    } else {
      log(`Empty response from pi for ${ticker}`)
    }
    sendStatus('idle', null, null)
  } catch (err) {
    const errMsg = err.message?.slice(0, 200) || 'unknown error'
    log(`pi invocation failed for ${ticker}: ${errMsg}`)
    sendStatus('error', ticker, errMsg)
  }

  isProcessing = false

  if (alertQueue.length > 0) {
    const next = alertQueue.shift()
    setTimeout(() => processAlert(next), 1000)
  }
}

function handleAlert(data) {
  if (!data || !data.id || !data.trigger) return

  const cooldownKey = `${data.trigger.ticker}:${data.trigger.type}`
  const last = cooldowns.get(cooldownKey)
  if (last && Date.now() - last < COOLDOWN_MS) {
    log(`Cooldown active for ${cooldownKey}, skipping`)
    return
  }
  cooldowns.set(cooldownKey, Date.now())

  if (isProcessing) {
    if (alertQueue.length >= MAX_QUEUE) alertQueue.shift()
    alertQueue.push(data)
    log(`Queued alert for ${data.trigger.ticker} (queue: ${alertQueue.length})`)
    return
  }

  processAlert(data)
}

let heartbeatInterval = null

function connect() {
  log(`Connecting to ${WS_URL}`)

  try {
    ws = new WebSocket(WS_URL)
  } catch (err) {
    log(`Connection failed: ${err.message}`)
    setTimeout(connect, RECONNECT_MS)
    return
  }

  ws.on('open', () => {
    log('Connected to monitor WS')
    sendStatus('idle', null, null)

    if (heartbeatInterval) clearInterval(heartbeatInterval)
    heartbeatInterval = setInterval(() => {
      const state = isProcessing ? 'processing' : (lastError ? 'error' : 'idle')
      sendStatus(state, currentTicker, lastError)
    }, 30_000)
  })

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw))
      if (msg.type === 'alert' && msg.data) {
        handleAlert(msg.data)
      }
    } catch { /* ignore */ }
  })

  ws.on('close', () => {
    log('Disconnected from monitor WS, reconnecting...')
    if (heartbeatInterval) clearInterval(heartbeatInterval)
    heartbeatInterval = null
    ws = null
    setTimeout(connect, RECONNECT_MS)
  })

  ws.on('error', (err) => {
    log(`WS error: ${err.message}`)
    ws?.close()
  })
}

log(`Starting persistent alert runner`)
log(`Monitor WS: ${WS_URL}`)
log(`Model: ${PI_MODEL}`)
if (systemPrompt) log(`System prompt loaded (${systemPrompt.length} chars)`)

connect()

process.on('SIGTERM', () => {
  log('SIGTERM received, shutting down')
  ws?.close()
  process.exit(0)
})
