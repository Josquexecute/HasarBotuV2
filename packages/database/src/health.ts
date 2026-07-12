import type pg from 'pg'

export const DEFAULT_HEALTH_TIMEOUT_MS = 1_500

export type DatabaseHealth =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'timeout' | 'unreachable' }

/**
 * Sinirli sureli veritabani saglik kontrolu (`SELECT 1`).
 *
 * Hata ayrintisi/ic mesaj DISARI TASINMAZ; yalnizca kararli neden kodu doner.
 * API health endpoint'i bu sonucu `ok`/`degraded` durumuna cevirir.
 */
export async function checkDatabaseHealth(
  pool: pg.Pool,
  timeoutMs: number = DEFAULT_HEALTH_TIMEOUT_MS,
): Promise<DatabaseHealth> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs)
  })

  try {
    const outcome = await Promise.race([pool.query('SELECT 1'), timeout])
    if (outcome === 'timeout') return { ok: false, reason: 'timeout' }
    return { ok: true }
  } catch {
    return { ok: false, reason: 'unreachable' }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
