import pg from 'pg'
import type { DatabaseConfig } from './config.js'

/** Baglanti havuzu guvenli varsayimlari. */
export const DEFAULT_POOL_MAX = 10
export const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000
export const DEFAULT_IDLE_TIMEOUT_MS = 30_000

export interface CreatePoolOptions {
  readonly config: DatabaseConfig
  readonly max?: number
  readonly connectionTimeoutMillis?: number
  readonly idleTimeoutMillis?: number
}

/**
 * pg.Pool fabrikasi. Baglanti bilgisi ayri alanlarla verilir (connection string
 * yerine); boylece sifre yanlislikla log'a URL olarak dusmez.
 */
export function createDatabasePool(options: CreatePoolOptions): pg.Pool {
  const { config } = options
  const pool = new pg.Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    max: options.max ?? DEFAULT_POOL_MAX,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? DEFAULT_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: options.idleTimeoutMillis ?? DEFAULT_IDLE_TIMEOUT_MS,
  })
  // pg-pool removes the broken idle client. Never log the raw error: it may
  // contain connection details. Health checks still query the actual database.
  pool.on('error', () => console.error('database_pool_idle_connection_error'))
  return pool
}

/** Havuzdaki tum baglantilari kapatir; graceful shutdown yolunda cagrilir. */
export async function closeDatabasePool(pool: pg.Pool): Promise<void> {
  await pool.end()
}
