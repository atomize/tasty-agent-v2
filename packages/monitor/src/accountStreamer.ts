import { STREAMER_STATE } from '@tastytrade/api'
import { getClient } from './tastytrade-auth.js'
import { fetchAccountData } from './account.js'
import { config } from './config.js'
import { log } from './logger.js'

let accountNumber: string | null = null

/**
 * Start the SDK's built-in account streamer for real-time order fills,
 * position updates, and balance changes. This supplements the REST polling
 * in account.ts by giving instant updates when trades execute.
 */
export async function startAccountStreamer(): Promise<void> {
  if (!config.tastytrade.enableTradeScope) {
    log.info('Account streamer skipped (trade scope disabled — read-only mode)')
    return
  }

  try {
    const client = getClient()

    const accounts = await client.accountsAndCustomersService.getCustomerAccounts() as Record<string, unknown>
    const items = accounts?.items as Record<string, unknown>[] | undefined
    if (!items?.length) {
      log.warn('No accounts found — account streamer not started')
      return
    }

    accountNumber = String(
      items[0]['account-number'] ?? items[0].accountNumber ?? ''
    )
    if (!accountNumber) {
      log.warn('Could not determine account number for account streamer')
      return
    }

    const streamer = client.accountStreamer

    streamer.addStreamerStateObserver((state) => {
      switch (state) {
        case STREAMER_STATE.Open:
          log.info('Account streamer connected')
          break
        case STREAMER_STATE.Closed:
          log.warn('Account streamer disconnected')
          break
        case STREAMER_STATE.Error:
          log.error('Account streamer error')
          break
      }
    })

    streamer.addMessageObserver((message: object) => {
      const msg = message as Record<string, unknown>
      const action = msg.action as string | undefined
      const type = msg.type as string | undefined

      if (type === 'OrderAction' || type === 'Order' ||
          action === 'order-fill' || action === 'order-action') {
        log.info(`Account event: ${type ?? action}`)
        fetchAccountData()
      }

      if (type === 'AccountBalance' || action === 'account-balance') {
        log.info('Account balance update received')
        fetchAccountData()
      }
    })

    await streamer.start()
    await streamer.subscribeToAccounts([accountNumber])
    log.info(`Account streamer subscribed to ${accountNumber}`)
  } catch (err) {
    log.error('Failed to start account streamer:', err)
  }
}
