import { mkdtemp, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { startCaseFolders } from '../src/main/case-folder.js'
import type { DesktopShell } from '../src/main/shell.js'
import type { BrowserWindow } from 'electron'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input: unknown) => Promise<unknown>>(),
  select: vi.fn(), open: vi.fn(async () => ''),
}))
vi.mock('electron', () => ({
  dialog: { showOpenDialog: mocks.select }, shell: { openPath: mocks.open },
  ipcMain: { handle: (name: string, handler: (event: unknown, input: unknown) => Promise<unknown>) => mocks.handlers.set(name, handler), removeHandler: (name: string) => mocks.handlers.delete(name) },
}))
const caseId = '019f7000-0000-7000-8000-000000000001'
let directory: string, defaults: string, event: unknown, assistantEvent: { sender: { mainFrame: { url: string } }; senderFrame: { url: string } }, fetchMock: ReturnType<typeof vi.fn>, localRoot: string
beforeEach(async () => {
  vi.clearAllMocks()
  directory = await mkdtemp(join(tmpdir(), 'hb-case-folder-controller-'))
  localRoot = join(directory, 'root')
  await mkdir(join(localRoot, '2026/34ABC123-AXA'), { recursive: true })
  defaults = join(directory, 'defaults.json')
  await writeFile(defaults, JSON.stringify({ 'test-root': localRoot }))
  fetchMock = vi.fn(async () => Response.json({ location: { caseId,storageRootKey: 'test-root',relativePath: '2026/34ABC123-AXA',version: 1,verificationStatus: 'verified',source: 'imported',createdAt: '2026-10-15T00:00:00Z',updatedAt: '2026-10-15T00:00:00Z' } }))
  const mainFrame = { url: 'http://127.0.0.1:1234/dosyalar' }
  const contents = { mainFrame,session: { fetch: fetchMock } }
  event = { sender: contents,senderFrame: mainFrame }
  const shell = { origin: 'http://127.0.0.1:1234',window: { webContents: contents,once: vi.fn() } } as unknown as DesktopShell
  const menuFrame = { url: 'http://127.0.0.1:1234/touch-assistant' }
  const menuContents = { mainFrame: menuFrame }
  assistantEvent = { sender: menuContents, senderFrame: menuFrame }
  startCaseFolders(shell, directory, defaults, 'https://office.example', { webContents: menuContents, isDestroyed: () => false } as unknown as BrowserWindow)
})
it('allows only the designated Touch main frame at its exact menu URL', async () => {
  expect(await invoke(assistantEvent)).toEqual({ opened: true })
  assistantEvent.senderFrame.url = 'http://127.0.0.1:1234/ayarlar'
  await expect(invoke(assistantEvent)).rejects.toThrow('Untrusted')
  assistantEvent.senderFrame.url = 'http://127.0.0.1:1234/touch-assistant'
  await expect(invoke({ ...assistantEvent, senderFrame: { ...assistantEvent.senderFrame } })).rejects.toThrow('Untrusted')
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })
const invoke = (sender = event, input: unknown = caseId) => mocks.handlers.get('hasarbotu:open-case-folder')!(sender, input)
it('loads the authenticated current location and opens that exact physical folder', async () => {
  expect(await invoke()).toEqual({ opened: true })
  expect(fetchMock).toHaveBeenCalledWith(`http://127.0.0.1:1234/api/v1/cases/${caseId}/location`, expect.objectContaining({ credentials: 'include',redirect: 'error',cache: 'no-store' }))
  expect(mocks.open).toHaveBeenCalledExactlyOnceWith(await realpath(join(localRoot, '2026/34ABC123-AXA')))
  expect(mocks.select).not.toHaveBeenCalled()
})
it('uses the office default before prompting when an old local root mapping no longer exists',async () => {
  await writeFile(join(directory,'case-folder-roots.json'),JSON.stringify({ 'https://office.example:test-root': join(directory,'obsolete-root') }))
  expect(await invoke()).toEqual({ opened: true })
  expect(mocks.open).toHaveBeenCalledExactlyOnceWith(await realpath(join(localRoot,'2026/34ABC123-AXA')))
  expect(mocks.select).not.toHaveBeenCalled()
})
it('prefers the configured office source even when an older local copy still exists',async () => {
  const oldRoot = join(directory,'old-local-copy')
  await mkdir(join(oldRoot,'2026/34ABC123-AXA'),{ recursive: true })
  await writeFile(join(directory,'case-folder-roots.json'),JSON.stringify({ 'https://office.example:test-root': oldRoot }))
  expect(await invoke()).toEqual({ opened: true })
  expect(mocks.open).toHaveBeenCalledExactlyOnceWith(await realpath(join(localRoot,'2026/34ABC123-AXA')))
})
it('rejects untrusted frames, denied API access and arbitrary filesystem input', async () => {
  await expect(invoke({ sender: {},senderFrame: {} })).rejects.toThrow('Untrusted')
  expect(await invoke(event, '../arbitrary')).toMatchObject({ opened: false })
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }))
  expect(await invoke()).toMatchObject({ opened: false,error: expect.any(String) })
  expect(mocks.open).not.toHaveBeenCalled()
})
it('selects a local root once, persists it by API origin and reuses it', async () => {
  await writeFile(defaults, '{}')
  mocks.select.mockResolvedValue({ canceled: false,filePaths: [localRoot] })
  expect(await invoke()).toEqual({ opened: true })
  expect(JSON.parse(await readFile(join(directory, 'case-folder-roots.json'), 'utf8'))).toEqual({ 'https://office.example:test-root': localRoot })
  expect(await invoke()).toEqual({ opened: true })
  expect(mocks.select).toHaveBeenCalledTimes(1)
})
it('opens a moved case directory directly without appending its old path or changing the shared root', async () => {
  const moved = join(localRoot, '2026/Ekim 2026/34ABC123-AXA')
  await mkdir(join(localRoot, '2026/Ekim 2026'), { recursive: true })
  await rename(join(localRoot, '2026/34ABC123-AXA'), moved)
  mocks.select.mockResolvedValue({ canceled: false, filePaths: [moved] })
  expect(await invoke()).toEqual({ opened: true })
  expect(mocks.open).toHaveBeenLastCalledWith(await realpath(moved))
  await expect(readFile(join(directory, 'case-folder-roots.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  const overrides = JSON.parse(await readFile(join(directory, 'case-folder-overrides.json'), 'utf8'))
  expect(overrides).toEqual({ [`https://office.example:${caseId}:1`]: await realpath(moved) })
  expect(await invoke()).toEqual({ opened: true })
  expect(mocks.select).toHaveBeenCalledTimes(1)
})
it('keeps direct folder choices separate for same-plate cases and expires them when the API location changes', async () => {
  const chosen = join(directory, 'manually-chosen/34ABC123-AXA')
  await mkdir(chosen, { recursive: true })
  await rm(join(localRoot, '2026/34ABC123-AXA'), { recursive: true })
  mocks.select.mockResolvedValue({ canceled: false, filePaths: [chosen] })
  expect(await invoke()).toEqual({ opened: true })
  const next = join(localRoot, '2026/Kasım 2026/34ABC123-AXA')
  await mkdir(next, { recursive: true })
  fetchMock.mockImplementation(async () => Response.json({ location: { caseId, storageRootKey: 'test-root', relativePath: '2026/Kasım 2026/34ABC123-AXA', version: 2, verificationStatus: 'verified', source: 'imported', createdAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T00:00:00Z' } }))
  expect(await invoke()).toEqual({ opened: true })
  expect(mocks.open).toHaveBeenLastCalledWith(await realpath(next))
  const otherId = '019f7000-0000-7000-8000-000000000002'
  const otherPath = '2026/Aralık 2026/34ABC123-AXA'
  await mkdir(join(localRoot, otherPath), { recursive: true })
  fetchMock.mockResolvedValueOnce(Response.json({ location: { caseId: otherId, storageRootKey: 'test-root', relativePath: otherPath, version: 1, verificationStatus: 'verified', source: 'imported', createdAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T00:00:00Z' } }))
  expect(await invoke(event, otherId)).toEqual({ opened: true })
  expect(mocks.open).toHaveBeenLastCalledWith(await realpath(join(localRoot, otherPath)))
  expect(mocks.select).toHaveBeenCalledTimes(1)
})
it('reports a missing selected path clearly without leaking an ENOENT error or saving a bad root', async () => {
  await writeFile(defaults, '{}')
  mocks.select.mockResolvedValue({ canceled: false, filePaths: [join(directory, 'wrong-root')] })
  const result = await invoke()
  expect(result).toMatchObject({ opened: false, error: expect.stringContaining('güncel klasörünü') })
  expect(JSON.stringify(result)).not.toContain('ENOENT')
  expect(mocks.open).not.toHaveBeenCalled()
  await expect(readFile(join(directory, 'case-folder-roots.json'))).rejects.toMatchObject({ code: 'ENOENT' })
})
