import TastytradeClient from '@tastytrade/api'
import { config } from './config.js'
import { log } from './logger.js'

let client: TastytradeClient | null = null

export async function initClient(): Promise<TastytradeClient> {
  if (client) return client

  const isSandbox = config.tastytrade.env === 'sandbox'
  const baseConfig = isSandbox
    ? TastytradeClient.SandboxConfig
    : TastytradeClient.ProdConfig

  if (!config.tastytrade.refreshToken) {
    throw new Error(
      'TASTYTRADE_REFRESH_TOKEN is required. ' +
      'Generate one at https://my.tastytrade.com/app.html#/manage/api-access/oauth-applications'
    )
  }

  if (!config.tastytrade.clientSecret) {
    throw new Error('TASTYTRADE_CLIENT_SECRET is required.')
  }

  log.info(`Connecting to tastytrade ${isSandbox ? 'sandbox' : 'production'}...`)

  const scopes: string[] = ['read', 'openid']
  if (config.tastytrade.enableTradeScope) {
    scopes.push('trade')
  }

  log.info(`OAuth scopes: ${scopes.join(', ')}${config.tastytrade.enableTradeScope ? '' : ' (read-only — trade scope disabled)'}`)

  client = new TastytradeClient({
    ...baseConfig,
    clientSecret: config.tastytrade.clientSecret,
    refreshToken: config.tastytrade.refreshToken,
    oauthScopes: scopes,
  } as ConstructorParameters<typeof TastytradeClient>[0])

  log.info('tastytrade client initialized')
  return client
}

export function getClient(): TastytradeClient {
  if (!client) throw new Error('Client not initialized — call initClient() first')
  return client
}
