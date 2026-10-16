import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { DesktopShell } from '../src/main/shell.js'
import { startDesktopUpdates } from '../src/main/updates.js'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown) => Promise<unknown>>(),
  app: { isPackaged: true, getVersion: () => '0.1.7', getPath: vi.fn(), quit: vi.fn() },
  execFile: vi.fn(),
}))
vi.mock('electron', () => ({ app: mocks.app, ipcMain: { handle: (name: string, handler: (event: unknown) => Promise<unknown>) => mocks.handlers.set(name, handler), removeHandler: (name: string) => mocks.handlers.delete(name) } }))
vi.mock('node:child_process', () => ({ execFile: mocks.execFile }))
const bytes = Buffer.from('MZverified-installer-fixture')
const release = { version: '0.1.8', platform: 'win32', arch: 'x64', sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, publishedAt: '2026-10-14T00:00:00Z', notes: 'Synthetic' }
let directory: string, dispose: () => void, shell: DesktopShell, event: unknown, fetchMock: ReturnType<typeof vi.fn>
beforeEach(async () => {
  vi.clearAllMocks()
  directory = await mkdtemp(join(tmpdir(), 'hb-updater-controller-'))
  mocks.app.getPath.mockReturnValue(directory)
  mocks.execFile.mockImplementation((_file, _args, _options, callback) => callback(null, '0.1.8', ''))
  fetchMock = vi.fn(async (url: string) => url.endsWith('/latest') ? Response.json({ release }) : new Response(bytes))
  const mainFrame = { url: 'http://127.0.0.1:1234/ayarlar' }
  const contents = { mainFrame, session: { fetch: fetchMock }, send: vi.fn() }
  shell = { origin: 'http://127.0.0.1:1234', window: { webContents: contents, once: vi.fn(), isDestroyed: () => false } } as unknown as DesktopShell
  event = { sender: contents, senderFrame: mainFrame }
  dispose = startDesktopUpdates(shell, shell.origin)
})
afterEach(async () => { dispose?.(); await rm(directory, { recursive: true, force: true }) })
function scheduledCommands() { return mocks.execFile.mock.calls.filter(call => String(call[1]).includes('Register-ScheduledTask')) }
async function invoke(name: 'check' | 'install', sender = event) { return await mocks.handlers.get('hasarbotu:update-' + name)!(sender) as { phase: string; currentVersion: string } }
it('checks a shared release, verifies the streamed installer and hands off normal restart', async () => {
  expect((await invoke('check')).phase).toBe('available')
  expect((await invoke('install')).phase).toBe('installing')
  expect(await readFile(join(directory, 'updates', release.sha256, release.sha256 + '.exe'))).toEqual(bytes)
  expect(scheduledCommands()).toHaveLength(1)
  expect(String(scheduledCommands()[0]![1])).toContain("-RunLevel Limited")
  expect(mocks.app.quit).toHaveBeenCalledOnce()
})
it('immediately reports installation revalidation and rejects repeat clicks while it is pending', async () => {
  await invoke('check')
  let complete!: (response: Response) => void
  fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { complete = resolve }))
  const pending = invoke('install')
  const send = vi.mocked(shell.window.webContents.send)
  expect(send.mock.calls.at(-1)?.[1]).toMatchObject({ phase: 'checking', release })
  expect((await invoke('install')).phase).toBe('checking')
  expect(fetchMock).toHaveBeenCalledTimes(2)
  complete(Response.json({ release }))
  expect((await pending).phase).toBe('installing')
  expect(scheduledCommands()).toHaveLength(1)
})
it('rejects untrusted senders and subframes before any network or installer action', async () => {
  await expect(invoke('check', { sender: {}, senderFrame: {} })).rejects.toThrow('Untrusted')
  await expect(invoke('install', { sender: shell.window.webContents, senderFrame: { url: shell.origin } })).rejects.toThrow('Untrusted')
  expect(fetchMock).not.toHaveBeenCalled()
  expect(scheduledCommands()).toHaveLength(0)
})
it('does not install a corrupt download or close the running application', async () => {
  await invoke('check')
  fetchMock.mockImplementation(async (url: string) => url.endsWith('/latest') ? Response.json({ release }) : new Response(Buffer.from('MZcorrupt')))
  expect((await invoke('install')).phase).toBe('error')
  expect(scheduledCommands()).toHaveLength(0)
  expect(mocks.app.quit).not.toHaveBeenCalled()
})
it('rejects a release that changed after the user checked it', async () => {
  await invoke('check')
  fetchMock.mockResolvedValue(Response.json({ release: { ...release, sha256: 'a'.repeat(64) } }))
  expect((await invoke('install')).phase).toBe('error')
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(scheduledCommands()).toHaveLength(0)
})
it('rejects an executable whose internal version differs from the published version', async () => {
  await invoke('check')
  mocks.execFile.mockImplementation((_file, _args, _options, callback) => callback(null, '0.1.7', ''))
  expect((await invoke('install')).phase).toBe('error')
  expect(scheduledCommands()).toHaveLength(0)
  expect(mocks.app.quit).not.toHaveBeenCalled()
})
it('shows equal and older versions as current and refuses installation', async () => {
  fetchMock.mockImplementation(async () => Response.json({ release: { ...release, version: '0.1.6' } }))
  expect((await invoke('check')).phase).toBe('current')
  expect((await invoke('install')).phase).toBe('current')
  expect(scheduledCommands()).toHaveLength(0)
})
it('serializes checks instead of starting overlapping downloads', async () => {
  let resolve!: (value: Response) => void
  fetchMock.mockImplementation(() => new Promise<Response>(done => { resolve = done }))
  const pending = invoke('check')
  expect((await invoke('check')).phase).toBe('checking')
  expect(fetchMock).toHaveBeenCalledOnce()
  resolve(Response.json({ release })); await pending
})
it('keeps the application open if Windows refuses the per-user update task', async () => {
  await invoke('check')
  mocks.execFile.mockImplementation((_file, args, _options, callback) => String(args).includes('Register-ScheduledTask') ? callback(new Error('Task registration denied'), '', '') : callback(null, '0.1.8', ''))
  expect((await invoke('install')).phase).toBe('error')
  expect(mocks.app.quit).not.toHaveBeenCalled()
})
