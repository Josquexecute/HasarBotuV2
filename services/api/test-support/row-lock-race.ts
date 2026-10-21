import type pg from 'pg'
import { expect, vi } from 'vitest'

/** All commands must reach the database lock before it is released. */
export async function runBehindRowLock<T>(
  pool: pg.Pool,
  lockQuery: string,
  lockValues: unknown[],
  command: () => PromiseLike<T>,
): Promise<T[]> {
  const blocker = await pool.connect()
  const pending: Promise<T>[] = []
  try {
    await blocker.query('BEGIN')
    await blocker.query(lockQuery, lockValues)
    for (let index = 0; index < 5; index++) pending.push(Promise.resolve(command()))
    await vi.waitFor(async () => {
      const waiting = await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'")
      expect(waiting.rowCount).toBe(5)
    }, { timeout: 3000, interval: 10 })
    await blocker.query('COMMIT')
    return await Promise.all(pending)
  } finally {
    await blocker.query('ROLLBACK')
    blocker.release()
    await Promise.all(pending)
  }
}
