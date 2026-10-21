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
  const reportedErrors = new WeakSet<Error>()
  const reportConnectionError = (error: Error, diagnostic: string) => {
    if (reportedErrors.has(error)) return
    reportedErrors.add(error)
    console.error(diagnostic)
  }
  // pg-pool handles idle client errors, but detaches that listener on checkout.
  // Keep a listener through active queries and rollback after a lost connection.
  pool.on('connect', client => client.on('error', error => reportConnectionError(error, 'database_pool_client_connection_error')))
  // The same idle error also reaches the pool. Log it once without connection details.
  pool.on('error', error => reportConnectionError(error, 'database_pool_idle_connection_error'))
  return pool
}

/** Havuzdaki tum baglantilari kapatir; graceful shutdown yolunda cagrilir. */
export async function closeDatabasePool(pool: pg.Pool): Promise<void> {
  await pool.end()
}
