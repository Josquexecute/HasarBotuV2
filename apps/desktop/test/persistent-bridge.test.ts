import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { startPersistentBridge } from '../src/main/persistent-bridge.js'

it('reuses the origin after restart and refuses collisions instead of hiding storage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hb-bridge-origin-'))
  const options = { apiOrigin: 'http://127.0.0.1:3100' }
  try {
    const first = await startPersistentBridge(options, directory)
    const origin = first.origin
    try { await expect(startPersistentBridge(options, directory)).rejects.toMatchObject({ code: 'EADDRINUSE' }) }
    finally { await first.close() }
    const second = await startPersistentBridge(options, directory)
    try { expect(second.origin).toBe(origin) } finally { await second.close() }
    const other = await startPersistentBridge({ apiOrigin: 'https://other.example' }, directory)
    try { expect(other.origin).not.toBe(origin) } finally { await other.close() }
  } finally { await rm(directory, { recursive: true, force: true }) }
})
