import { mkdtemp, mkdir, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { startCaseFolders } from '../src/main/case-folder.js'
import type { DesktopShell } from '../src/main/shell.js'
import type { BrowserWindow } from 'electron'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input: unknown) => Promise<unknown>>(),
  select: vi.fn(), open: vi.fn(async () => ''), reveal: vi.fn(),
}))
vi.mock('electron', () => ({
  dialog: { showOpenDialog: mocks.select }, shell: { openPath: mocks.open, showItemInFolder: mocks.reveal },
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
const browse = (action: string, path: string[] = [], sender = event) =>
  mocks.handlers.get('hasarbotu:browse-case-folder')!(sender, { caseId, action, path, ...(path.length ? { locationVersion: 1 } : {}) })

it('lists real folders and files, previews text and reveals a selected file under the current case', async () => {
  const root = join(localRoot, '2026/34ABC123-AXA')
  await mkdir(join(root, 'Evrak', 'Arşiv'), { recursive: true })
  await writeFile(join(root, 'Evrak', 'Not.txt'), 'Servis kaydı', 'utf8')
  expect(await browse('list')).toMatchObject({ kind: 'listed', rootName: '34ABC123-AXA', entries: [{ name: 'Evrak', kind: 'directory' }] })
  expect(await browse('list', ['Evrak'])).toMatchObject({ kind: 'listed', entries: [
    { name: 'Arşiv', kind: 'directory' },
    { name: 'Not.txt', kind: 'file', size: Buffer.byteLength('Servis kaydı') },
  ] })
  expect(await browse('preview', ['Evrak', 'Not.txt'])).toEqual({ kind: 'text', text: 'Servis kaydı' })
  expect(await browse('reveal', ['Evrak', 'Not.txt'])).toEqual({ kind: 'revealed' })
  expect(mocks.reveal).toHaveBeenCalledWith(await realpath(join(root, 'Evrak', 'Not.txt')))
  expect(fetchMock).toHaveBeenCalledTimes(4)
})

it('keeps traversal, linked folders and denied or unrelated frames outside the file browser', async () => {
  const root = join(localRoot, '2026/34ABC123-AXA')
  await symlink(directory, join(root, 'Bağlantı'), 'junction')
  await expect(browse('list', [], assistantEvent)).rejects.toThrow('Untrusted')
  expect(await browse('list')).toMatchObject({ kind: 'listed', entries: [] })
  expect(await browse('list', ['Bağlantı'])).toMatchObject({ kind: 'error' })
  expect(await browse('list', ['..'])).toMatchObject({ kind: 'error' })
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }))
  expect(await browse('list')).toMatchObject({ kind: 'error', reset: true })
  expect(mocks.select).not.toHaveBeenCalled()
})

it('requires refreshing before using a path from a previous location version', async () => {
  const root = join(localRoot, '2026/34ABC123-AXA')
  await writeFile(join(root, 'Kayıt.txt'), 'Yeni konum', 'utf8')
  const handler = mocks.handlers.get('hasarbotu:browse-case-folder')!
  expect(await handler(event, { caseId, action: 'reveal', path: ['Kayıt.txt'], locationVersion: 2 }))
    .toMatchObject({ kind: 'error', reset: true })
  expect(mocks.reveal).not.toHaveBeenCalled()
})

it('adds native-picker files with document permission and leaves existing copies intact', async () => {
  const root = join(localRoot, '2026/34ABC123-AXA')
  const source = join(directory, 'Not.txt')
  await writeFile(source, 'Yeni belge')
  await writeFile(join(root, 'Not.txt'), 'Mevcut belge')
  mocks.select.mockResolvedValue({ canceled: false, filePaths: [source] })
  const session = (permissions: string[]) => Response.json({ user: {
    id: caseId, organizationId: caseId, email: 'expert@example.test', displayName: 'Uzman', roles: ['expert'], permissions,
  }, expiresAt: null })
  const add = () => mocks.handlers.get('hasarbotu:browse-case-folder')!(event, { caseId, action: 'add', path: [], locationVersion: 1 })
  fetchMock.mockResolvedValueOnce(session(['case_read']))
  expect(await add()).toMatchObject({ kind: 'error' })
  expect(mocks.select).not.toHaveBeenCalled()
  const getLocation = fetchMock.getMockImplementation() as () => Promise<Response>
  let status = 'open'
  fetchMock.mockImplementation(async (url: string) => url.endsWith('/auth/session') ? session(['case_read', 'documents_write'])
    : url.endsWith('/location') ? getLocation() : Response.json({ case: {
      id: caseId, caseType: 'traffic', officeCaseNumber: '2026/100', notificationFormNumber: null, insurerClaimNumber: null,
      plate: '34ABC123', status, stage: 'inspection_pending', responsibleUserId: null, expertUserId: null, serviceId: null,
      serviceProfile: null, insurerId: null, followUpDate: null, lossDate: null, notificationDate: null, lastInterventionAt: null,
      createdAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T00:00:00Z', version: 1,
    } }))
  status = 'closed'
  expect(await add()).toMatchObject({ kind: 'error' })
  expect(mocks.select).not.toHaveBeenCalled()
  status = 'open'
  expect(await add()).toMatchObject({ kind: 'copied', count: 1, skipped: 0 })
  expect(await readFile(join(root, 'Not.txt'), 'utf8')).toBe('Mevcut belge')
  expect(await readFile(join(root, 'Not (2).txt'), 'utf8')).toBe('Yeni belge')
  await mkdir(join(root, 'Kopyalar'))
  const paste = (source: string[], names: string[]) => mocks.handlers.get('hasarbotu:browse-case-folder')!(event, { caseId, action: 'paste', path: ['Kopyalar'], locationVersion: 1, source, names })
  expect(await paste(['..'], ['Not.txt'])).toMatchObject({ kind: 'error' })
  expect(await paste([], ['Not.txt', 'Not (2).txt'])).toEqual({ kind: 'copied', count: 2, skipped: 0 })
  expect(await readFile(join(root, 'Kopyalar', 'Not.txt'), 'utf8')).toBe('Mevcut belge')
  expect(await readFile(join(root, 'Kopyalar', 'Not (2).txt'), 'utf8')).toBe('Yeni belge')
})
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
