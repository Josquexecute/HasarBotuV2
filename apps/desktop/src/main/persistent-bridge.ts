import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startDesktopBridge, type DesktopBridgeOptions, type DesktopBridge } from '@hasarbotu/desktop-bridge'

/** Keep Chromium's storage origin stable across restarts, separately per API. */
export async function startPersistentBridge(options: DesktopBridgeOptions, userDataPath: string): Promise<DesktopBridge> {
  const key = createHash('sha256').update(new URL(options.apiOrigin).origin).digest('hex')
  const directory = join(userDataPath, 'bridge-origins')
  const file = join(directory, `${key}.json`)
  let savedPort: number | undefined
  try {
    const saved: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (typeof saved !== 'number' || !Number.isInteger(saved) || saved < 1 || saved > 65535) throw new Error('invalid saved bridge port')
    savedPort = saved
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const requested = options.port === undefined || options.port === 0 ? savedPort : options.port
  if (savedPort !== undefined && requested !== savedPort) throw new Error('saved bridge port differs from configuration')
  // EADDRINUSE is intentionally surfaced; choosing a new port hides drafts.
  const bridge = await startDesktopBridge({ ...options, port: requested ?? 0 })
  try {
    if (savedPort === undefined) {
      await mkdir(directory, { recursive: true })
      await writeFile(`${file}.tmp`, JSON.stringify(bridge.port), { mode: 0o600 })
      await rename(`${file}.tmp`, file)
    }
    return bridge
  } catch (error) { await bridge.close(); throw error }
}
