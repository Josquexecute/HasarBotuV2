import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { configureLoginStartup } from '../src/main/login-startup.js'

it('registers a real installed profile once and preserves later Windows opt-out', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'hb-login-startup-'))
  const loginItems = { getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })), setLoginItemSettings: vi.fn() }
  const options = { packaged: true, platform: 'win32', customProfile: false, userDataPath, executable: 'C:\\Test Türkçe\\HasarBotu.exe', loginItems }
  try {
    for (const change of [{ packaged: false }, { platform: 'linux' }, { customProfile: true }]) await configureLoginStartup({ ...options, ...change })
    expect(loginItems.setLoginItemSettings).not.toHaveBeenCalled()
    await configureLoginStartup(options)
    expect(loginItems.setLoginItemSettings).toHaveBeenCalledExactlyOnceWith({ openAtLogin: true, path: options.executable, args: [] })
    expect(JSON.parse(await readFile(join(userDataPath, 'login-startup.json'), 'utf8'))).toEqual({ schemaVersion: 1, executable: options.executable })
    await configureLoginStartup(options)
    expect(loginItems.getLoginItemSettings).toHaveBeenCalledTimes(1)
    expect(loginItems.setLoginItemSettings).toHaveBeenCalledTimes(1)
    await configureLoginStartup({ ...options, executable: 'D:\\New path\\HasarBotu.exe' })
    expect(loginItems.setLoginItemSettings).toHaveBeenCalledTimes(1)
  } finally { await rm(userDataPath, { recursive: true, force: true }) }
})

it('retries a failed registration on the next launch without recording success', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'hb-login-startup-failure-'))
  const loginItems = { getLoginItemSettings: () => ({ openAtLogin: false }), setLoginItemSettings: vi.fn().mockImplementationOnce(() => { throw new Error('Registry unavailable') }) }
  const options = { packaged: true, platform: 'win32', customProfile: false, userDataPath, executable: 'C:\\Test\\HasarBotu.exe', loginItems }
  try {
    await expect(configureLoginStartup(options)).rejects.toThrow('Registry unavailable')
    await expect(readFile(join(userDataPath, 'login-startup.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await configureLoginStartup(options)
    expect(loginItems.setLoginItemSettings).toHaveBeenCalledTimes(2)
  } finally { await rm(userDataPath, { recursive: true, force: true }) }
})
