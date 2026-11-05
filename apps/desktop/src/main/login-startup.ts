import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'

interface LoginStartupOptions {
  readonly packaged: boolean
  readonly platform: string
  readonly customProfile: boolean
  readonly userDataPath: string
  readonly executable: string
  readonly loginItems: {
    getLoginItemSettings(options: { path: string; args: string[] }): { openAtLogin: boolean }
    setLoginItemSettings(options: { openAtLogin: boolean; path: string; args: string[] }): void
  }
}

/** Register once per real installed profile; later Windows startup choices remain authoritative. */
export async function configureLoginStartup(options: LoginStartupOptions): Promise<void> {
  if (!options.packaged || options.platform !== 'win32' || options.customProfile) return
  const file = join(options.userDataPath, 'login-startup.json')
  let previousExecutable: string | undefined
  try {
    const saved: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (!saved || typeof saved !== 'object' || !('schemaVersion' in saved) || saved.schemaVersion !== 1
      || !('executable' in saved) || typeof saved.executable !== 'string') throw new Error('Invalid login startup state')
    previousExecutable = saved.executable
    if (previousExecutable.toLowerCase() === options.executable.toLowerCase()) return
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const target = { path: options.executable, args: [] as string[] }
  const enabled = options.loginItems.getLoginItemSettings({ ...target, path: previousExecutable ?? target.path }).openAtLogin
  if (previousExecutable ? enabled : !enabled) options.loginItems.setLoginItemSettings({ ...target, openAtLogin: true })
  await writeFile(file + '.next', JSON.stringify({ schemaVersion: 1, executable: options.executable }))
  await rename(file + '.next', file)
}
