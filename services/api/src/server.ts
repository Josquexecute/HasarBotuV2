import { buildApp } from './app.js'
import { ConfigError, parseConfig } from './config.js'

/**
 * Sunucu yasam dongusu: config oku -> uygulamayi kur -> dinle -> sinyalde
 * graceful kapan. Uygulama fabrikasindan (app.ts) bilincli olarak ayridir.
 *
 * - Gecersiz config'te sunucu BASLATILMAZ; hata mesaji yalnizca alan adi ve
 *   kurali tasir (deger/secret/process.env icerigi yazilmaz).
 * - SIGINT ve SIGTERM graceful kapanis baslatir; ayni anda yalniz BIR kapanis
 *   yurur (cift sinyal ikinci kapanis baslatmaz).
 * - Kapanis hatalari yapilandirilmis `err` alaniyla loglanir; hassas veri
 *   interpolation ile mesaja eklenmez.
 */
export async function startServer(): Promise<void> {
  let config
  try {
    config = parseConfig(process.env)
  } catch (error) {
    if (error instanceof ConfigError) {
      // Logger henuz kurulamadigi icin tek satir guvenli stderr cikisi.
      console.error(`API configuration error - ${error.message}`)
      process.exitCode = 1
      return
    }
    throw error
  }

  const app = buildApp({ logLevel: config.logLevel })

  let shuttingDown = false
  const shutdown = (signal: 'SIGINT' | 'SIGTERM'): void => {
    if (shuttingDown) return
    shuttingDown = true
    app.log.info({ signal }, 'graceful shutdown started')
    app
      .close()
      .then(() => {
        app.log.info('shutdown complete')
        process.exitCode = 0
      })
      .catch((error: unknown) => {
        app.log.error({ err: error }, 'shutdown failed')
        process.exitCode = 1
      })
  }
  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))

  try {
    await app.listen({ host: config.host, port: config.port })
  } catch (error) {
    app.log.error({ err: error }, 'server failed to start')
    await app.close().catch(() => undefined)
    process.exitCode = 1
  }
}
