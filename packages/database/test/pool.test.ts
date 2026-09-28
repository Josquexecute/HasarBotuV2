import { expect, it, vi } from 'vitest'
import { createDatabasePool } from '../src/pool.js'
import { parseDatabaseUrl } from '../src/config.js'

it('handles idle connection errors without leaking connection details', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const pool = createDatabasePool({ config: parseDatabaseUrl('postgresql://user:secret@localhost:5432/synthetic_test') })
  try {
    expect(() => pool.emit('error', new Error('secret connection failure'))).not.toThrow()
    expect(log).toHaveBeenCalledWith('database_pool_idle_connection_error')
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret')
  } finally { await pool.end(); log.mockRestore() }
})
