import {
  checkDatabaseHealth,
  closeDatabasePool,
  createDatabasePool,
  parseDatabaseUrl,
} from '@hasarbotu/database'
import type pg from 'pg'
import { buildApp } from './app.js'
import { ConfigError, parseConfig } from './config.js'

/**
 * Sunucu yasam dongusu: config oku -> (varsa) DB havuzu kur -> uygulamayi kur
 * -> dinle -> sinyalde graceful kapan. Uygulama fabrikasindan (app.ts) ayridir.
 *
 * - Gecersiz config'te sunucu BASLATILMAZ; hata mesaji yalnizca alan adi ve
 *   kurali tasir (deger/secret/process.env icerigi yazilmaz).
 * - DATABASE_URL verilmisse health, sinirli sureli gercek DB ping'iyle
 *   `ok`/`degraded` uretir; verilmemisse Paket 04 davranisi korunur.
 * - SIGINT ve SIGTERM graceful kapanis baslatir; ayni anda yalniz BIR kapanis
 *   yurur ve DB havuzu da kapatilir.
 */
export async function startServer(): Promise<void> {
  let config
  try {
    config = parseConfig(process.env)
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`API configuration error - ${error.message}`)
      process.exitCode = 1
      return
    }
    throw error
  }

  let pool: pg.Pool | undefined
  if (config.databaseUrl !== undefined) {
    pool = createDatabasePool({ config: parseDatabaseUrl(config.databaseUrl) })
  }

  const app = buildApp({
    logLevel: config.logLevel,
    ...(pool !== undefined
      ? {
          healthDependencyCheck: async () => (await checkDatabaseHealth(pool)).ok,
          auth: { pool, cookieSecure: config.nodeEnv === 'production' },
        }
      : {}),
  })

  let shuttingDown = false
  const shutdown = (signal: 'SIGINT' | 'SIGTERM'): void => {
    if (shuttingDown) return
    shuttingDown = true
    app.log.info({ signal }, 'graceful shutdown started')
    app
      .close()
      .then(async () => {
        if (pool !== undefined) await closeDatabasePool(pool)
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
    if (pool !== undefined) await closeDatabasePool(pool).catch(() => undefined)
    process.exitCode = 1
  }
}
