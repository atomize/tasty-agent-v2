import { IncomingMessage, ServerResponse } from 'node:http'
import { createHmac, randomBytes } from 'node:crypto'
import * as arctic from 'arctic'
import { findOrCreateOAuthUser } from './db.js'
import { signTokenForOAuth } from './auth.js'
import { log } from './logger.js'

const STATE_MAX_AGE_S = 600
const STATE_COOKIE = 'oauth_state'

const hmacSecret = process.env.JWT_SECRET || 'dev-secret-change-in-production'

function getPublicUrl(req: IncomingMessage): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '')
  const host = req.headers.host ?? 'localhost:3001'
  const proto = req.headers['x-forwarded-proto'] ?? 'http'
  return `${proto}://${host}`
}

const github = process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
  ? { id: process.env.GITHUB_CLIENT_ID, secret: process.env.GITHUB_CLIENT_SECRET }
  : null

const gitlab = process.env.GITLAB_CLIENT_ID && process.env.GITLAB_CLIENT_SECRET
  ? { id: process.env.GITLAB_CLIENT_ID, secret: process.env.GITLAB_CLIENT_SECRET }
  : null

function makeGitHub(redirectUri: string): arctic.GitHub {
  return new arctic.GitHub(github!.id, github!.secret, redirectUri)
}

function makeGitLab(redirectUri: string): arctic.GitLab {
  return new arctic.GitLab('https://gitlab.com', gitlab!.id, gitlab!.secret, redirectUri)
}

export function getEnabledOAuthProviders(): string[] {
  const providers: string[] = []
  if (github) providers.push('github')
  if (gitlab) providers.push('gitlab')
  return providers
}

function signState(state: string): string {
  const sig = createHmac('sha256', hmacSecret).update(state).digest('hex')
  return `${state}.${sig}`
}

function verifyState(signed: string): string | null {
  const dot = signed.lastIndexOf('.')
  if (dot === -1) return null
  const state = signed.slice(0, dot)
  const sig = signed.slice(dot + 1)
  const expected = createHmac('sha256', hmacSecret).update(state).digest('hex')
  if (sig !== expected) return null
  return state
}

function setCookie(res: ServerResponse, name: string, value: string, maxAge: number): void {
  res.setHeader('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`)
}

function getCookie(req: IncomingMessage, name: string): string | null {
  const header = req.headers.cookie
  if (!header) return null
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return null
}

function clearCookie(res: ServerResponse, name: string): void {
  res.setHeader('Set-Cookie', `${name}=; Path=/; HttpOnly; Max-Age=0`)
}

function respondCallbackHtml(res: ServerResponse, token: string, user: { id: number; email: string }): void {
  const payload = JSON.stringify({ type: 'oauth_callback', token, user })
  const html = `<!DOCTYPE html><html><body><script>
    if (window.opener) {
      window.opener.postMessage(${JSON.stringify(payload)}, '*');
    }
    window.close();
  </script><p>Authenticated. You can close this window.</p></body></html>`
  res.writeHead(200, { 'Content-Type': 'text/html' })
  res.end(html)
}

function respondError(res: ServerResponse, status: number, message: string): void {
  const html = `<!DOCTYPE html><html><body>
    <h3>Authentication Error</h3><p>${message}</p>
    <script>setTimeout(()=>window.close(),3000)</script>
  </body></html>`
  res.writeHead(status, { 'Content-Type': 'text/html' })
  res.end(html)
}

export async function handleOAuthRoute(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
  const path = url.pathname

  if (path === '/auth/github') return handleGitHubStart(req, res)
  if (path === '/auth/github/callback') return handleGitHubCallback(req, res, url)
  if (path === '/auth/gitlab') return handleGitLabStart(req, res)
  if (path === '/auth/gitlab/callback') return handleGitLabCallback(req, res, url)

  return false
}

async function handleGitHubStart(req: IncomingMessage, res: ServerResponse): Promise<true> {
  if (!github) { respondError(res, 404, 'GitHub OAuth not configured'); return true }

  const base = getPublicUrl(req)
  const gh = makeGitHub(`${base}/auth/github/callback`)
  const state = arctic.generateState()

  setCookie(res, STATE_COOKIE, signState(state), STATE_MAX_AGE_S)
  const authUrl = gh.createAuthorizationURL(state, ['user:email'])
  res.writeHead(302, { Location: authUrl.toString() })
  res.end()
  return true
}

async function handleGitHubCallback(req: IncomingMessage, res: ServerResponse, url: URL): Promise<true> {
  if (!github) { respondError(res, 404, 'GitHub OAuth not configured'); return true }

  try {
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const storedSigned = getCookie(req, STATE_COOKIE)
    clearCookie(res, STATE_COOKIE)

    if (!code || !state || !storedSigned) {
      respondError(res, 400, 'Missing OAuth parameters'); return true
    }
    const storedState = verifyState(storedSigned)
    if (storedState !== state) {
      respondError(res, 403, 'Invalid state — possible CSRF'); return true
    }

    const base = getPublicUrl(req)
    const gh = makeGitHub(`${base}/auth/github/callback`)
    const tokens = await gh.validateAuthorizationCode(code)
    const accessToken = tokens.accessToken()

    const profileRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'tasty-v2-monitor' },
    })
    const profile = await profileRes.json() as { id: number; login: string; email: string | null }

    let email = profile.email
    if (!email) {
      const emailsRes = await fetch('https://api.github.com/user/emails', {
        headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'tasty-v2-monitor' },
      })
      const emails = await emailsRes.json() as { email: string; primary: boolean; verified: boolean }[]
      email = emails.find(e => e.primary && e.verified)?.email ?? emails[0]?.email ?? `${profile.login}@github.noreply`
    }

    const user = findOrCreateOAuthUser('github', String(profile.id), email)
    const token = signTokenForOAuth(user)
    log.info(`GitHub OAuth: ${email} (github:${profile.id})`)
    respondCallbackHtml(res, token, { id: user.id, email: user.email })
  } catch (err) {
    log.warn('GitHub OAuth callback error:', err)
    respondError(res, 500, 'GitHub authentication failed')
  }
  return true
}

async function handleGitLabStart(req: IncomingMessage, res: ServerResponse): Promise<true> {
  if (!gitlab) { respondError(res, 404, 'GitLab OAuth not configured'); return true }

  const base = getPublicUrl(req)
  const gl = makeGitLab(`${base}/auth/gitlab/callback`)
  const state = arctic.generateState()

  setCookie(res, STATE_COOKIE, signState(state), STATE_MAX_AGE_S)
  const authUrl = gl.createAuthorizationURL(state, ['read_user'])
  res.writeHead(302, { Location: authUrl.toString() })
  res.end()
  return true
}

async function handleGitLabCallback(req: IncomingMessage, res: ServerResponse, url: URL): Promise<true> {
  if (!gitlab) { respondError(res, 404, 'GitLab OAuth not configured'); return true }

  try {
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const storedSigned = getCookie(req, STATE_COOKIE)
    clearCookie(res, STATE_COOKIE)

    if (!code || !state || !storedSigned) {
      respondError(res, 400, 'Missing OAuth parameters'); return true
    }
    const storedState = verifyState(storedSigned)
    if (storedState !== state) {
      respondError(res, 403, 'Invalid state — possible CSRF'); return true
    }

    const base = getPublicUrl(req)
    const gl = makeGitLab(`${base}/auth/gitlab/callback`)
    const tokens = await gl.validateAuthorizationCode(code)
    const accessToken = tokens.accessToken()

    const profileRes = await fetch('https://gitlab.com/api/v4/user', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const profile = await profileRes.json() as { id: number; username: string; email: string }

    const user = findOrCreateOAuthUser('gitlab', String(profile.id), profile.email)
    const token = signTokenForOAuth(user)
    log.info(`GitLab OAuth: ${profile.email} (gitlab:${profile.id})`)
    respondCallbackHtml(res, token, { id: user.id, email: user.email })
  } catch (err) {
    log.warn('GitLab OAuth callback error:', err)
    respondError(res, 500, 'GitLab authentication failed')
  }
  return true
}
