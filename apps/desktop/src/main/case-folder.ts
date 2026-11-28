import { dialog, ipcMain, shell as electronShell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { readFile, realpath, writeFile, rename } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { AUTH_SESSION_ROUTE, CASE_DETAIL_ROUTE, CASE_FOLDER_COPY_LIMIT, PERMISSION_DEFINITIONS, caseDetailResponseSchema, caseLocationResponseSchema, idSchema, sessionResponseSchema, type CaseFolderBrowseResult } from '@hasarbotu/contracts'
import type { DesktopShell } from './shell.js'
import { resolveCaseFolder, resolveSavedCaseFolder, resolveSelectedCaseFolder } from './case-folder-core.js'
import { copyCaseFiles, listFolderEntries, parseBrowseRequest, previewFolderFile, resolveFolderEntry } from './case-folder-browser.js'

class CaseLocationError extends Error {
  constructor(readonly status: number) {
    super(status === 404 ? 'Bu dosyanın kayıtlı klasörü yok.' : 'Klasör bilgisi alınamadı. Oturumu ve bağlantıyı kontrol edin.')
  }
}

async function readRoots(file: string): Promise<Record<string, string>> {
  let content: string
  try { content = await readFile(file, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
  const value: unknown = JSON.parse(content)
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(item => typeof item !== 'string')) throw new Error('Yerel klasör ayarları okunamadı.')
  return value as Record<string, string>
}

export function startCaseFolders(shell: DesktopShell, userDataPath: string, defaultsFile: string, apiOrigin: string, assistantWindow?: BrowserWindow): void {
  const isMainFrame = (event: IpcMainInvokeEvent) => event.sender === shell.window.webContents
    && event.senderFrame && event.senderFrame === event.sender.mainFrame
    && new URL(event.senderFrame.url).origin === shell.origin

  const authenticatedFetch = (path: string) => shell.window.webContents.session.fetch(`${shell.origin}${path}`, {
    credentials: 'include', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000),
  })

  async function requireDocumentWrite(caseId: string) {
    const response = await authenticatedFetch(AUTH_SESSION_ROUTE)
    if (!response.ok) throw new CaseLocationError(response.status)
    const { user } = sessionResponseSchema.parse(await response.json())
    const roles: readonly string[] = PERMISSION_DEFINITIONS.find(item => item.code === 'documents_write')!.roles
    const allowed = user.permissions?.includes('documents_write') ?? user.roles.some(role => roles.includes(role))
    if (!allowed) throw new CaseLocationError(403)
    const detail = await authenticatedFetch(CASE_DETAIL_ROUTE.replace(':caseId', encodeURIComponent(caseId)))
    if (!detail.ok) throw new CaseLocationError(detail.status)
    const { case: item } = caseDetailResponseSchema.parse(await detail.json())
    if (item.id !== caseId || item.status === 'closed') throw new CaseLocationError(409)
    return user.id
  }

  async function locate(caseId: string) {
    const response = await authenticatedFetch(`/api/v1/cases/${encodeURIComponent(caseId)}/location`)
    if (!response.ok) throw new CaseLocationError(response.status)
    const { location } = caseLocationResponseSchema.parse(await response.json())
    if (location.caseId !== caseId) throw new Error('Klasör bilgisi seçilen dosyayla eşleşmiyor. Dosyayı yenileyip tekrar deneyin.')
    const settingsFile = join(userDataPath, 'case-folder-roots.json')
    const overridesFile = join(userDataPath, 'case-folder-overrides.json')
    const [settings, overrides, defaults] = await Promise.all([readRoots(settingsFile), readRoots(overridesFile), readRoots(defaultsFile)])
    const key = `${apiOrigin}:${location.storageRootKey}`
    const roots = [...new Set([defaults[location.storageRootKey], settings[key]].filter((root): root is string => !!root))]
    const caseKey = `${apiOrigin}:${caseId}:`
    const overrideKey = `${caseKey}${location.version}`
    const candidates = [
      ...(overrides[overrideKey] ? [() => resolveSavedCaseFolder(overrides[overrideKey]!)] : []),
      ...roots.map(root => () => resolveCaseFolder(root, location.relativePath)),
    ]
    let target: string | undefined
    for (const resolve of candidates) {
      try { target = await resolve(); break } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
      }
    }
    return { location, target, settingsFile, overridesFile, settings, overrides, key, caseKey, overrideKey }
  }

  let busy = false
  ipcMain.handle('hasarbotu:open-case-folder', async (event, input: unknown) => {
    const fromMain = isMainFrame(event)
    const fromAssistant = assistantWindow && !assistantWindow.isDestroyed() && event.sender === assistantWindow.webContents
      && event.senderFrame === event.sender.mainFrame && event.senderFrame.url === `${shell.origin}/touch-assistant`
    if (!fromMain && !fromAssistant) throw new Error('Untrusted folder caller')
    if (busy) return { opened: false, error: 'Başka bir klasör açılıyor. İşlem bitince yeniden deneyin.' }
    busy = true
    try {
      const caseId = idSchema.parse(input)
      const { location, target: stored, settingsFile, overridesFile, settings, overrides, key, caseKey, overrideKey } = await locate(caseId)
      let target = stored
      if (!target) {
        const selected = await dialog.showOpenDialog(fromAssistant ? assistantWindow! : shell.window, { title: 'Ana klasörü veya bu dosyanın kendi klasörünü seçin', message: `Kayıtlı konum bulunamadı. Ana depolama klasörünü veya doğrudan ${location.relativePath.split('/').at(-1)} klasörünü seçebilirsiniz.`, properties: ['openDirectory'] })
        if (selected.canceled || !selected.filePaths[0]) return { opened: false }
        const resolved = await resolveSelectedCaseFolder(selected.filePaths[0], location.relativePath)
        target = resolved.target
        if (resolved.root) {
          settings[key] = resolved.root
          await writeFile(`${settingsFile}.tmp`, JSON.stringify(settings), 'utf8')
          await rename(`${settingsFile}.tmp`, settingsFile)
        } else {
          for (const saved of Object.keys(overrides)) if (saved.startsWith(caseKey)) delete overrides[saved]
          overrides[overrideKey] = target
          await writeFile(`${overridesFile}.tmp`, JSON.stringify(overrides), 'utf8')
          await rename(`${overridesFile}.tmp`, overridesFile)
        }
      }
      const error = await electronShell.openPath(target)
      if (error) throw new Error('Klasör Windows Gezgini’nde açılamadı. Sürücü veya ağ bağlantısını kontrol edin.')
      return { opened: true }
    } catch (error) {
      if (['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        return { opened: false, error: 'Klasöre erişim engellendi. Sürücü veya ağ klasörünün erişim izinlerini kontrol edin.' }
      }
      if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        return { opened: false, error: 'Klasör bu konumda bulunamadı. Dosyanın güncel klasörünü veya tüm dosyaların bulunduğu ana klasörü seçin; ağ/pCloud bağlantısını kontrol edin.' }
      }
      return { opened: false, error: error instanceof Error ? error.message : 'Klasör açılamadı.' }
    } finally { busy = false }
  })
  let writing = false
  ipcMain.handle('hasarbotu:browse-case-folder', async (event, input: unknown): Promise<CaseFolderBrowseResult> => {
    if (!isMainFrame(event)) throw new Error('Untrusted folder caller')
    const request = parseBrowseRequest(input)
    if (!request) return { kind: 'error', message: 'Geçersiz klasör veya dosya seçimi.' }
    const writes = request.action === 'add' || request.action === 'paste'
    if (writes && writing) return { kind: 'error', message: 'Bir dosya işlemi sürüyor. İşlem bitince yeniden deneyin.' }
    if (writes) writing = true
    try {
      const writer = writes ? await requireDocumentWrite(request.caseId) : null
      const { location, target } = await locate(request.caseId)
      if (request.locationVersion !== undefined && request.locationVersion !== location.version) {
        return { kind: 'error', message: 'Klasör konumu değişti. Listeyi yenileyin.', reset: true }
      }
      if (!target) return { kind: 'error', message: 'Yerel klasör bulunamadı. Klasörü Aç ile konumu seçip listeyi yenileyin.', reset: true }
      if (request.action === 'add') {
        await resolveFolderEntry(target, request.path, true)
        const picked = await dialog.showOpenDialog(shell.window, { title: 'Klasöre eklenecek dosyaları seçin', properties: ['openFile', 'multiSelections', 'dontAddToRecent'] })
        if (picked.canceled) return { kind: 'copied', count: 0, skipped: 0 }
        if (picked.filePaths.length > CASE_FOLDER_COPY_LIMIT) return { kind: 'error', message: `Bir işlemde en fazla ${CASE_FOLDER_COPY_LIMIT} dosya ekleyebilirsiniz.` }
        const current = await locate(request.caseId)
        if (current.location.version !== location.version || current.target !== target) {
          return { kind: 'error', message: 'Klasör konumu değişti. Listeyi yenileyin.', reset: true }
        }
        if (await requireDocumentWrite(request.caseId) !== writer) return { kind: 'error', message: 'Oturum değişti. Listeyi yenileyin.', reset: true }
        return await copyCaseFiles(target, request.path, picked.filePaths, async source => (await resolveFolderEntry(await realpath(dirname(source)), [basename(source)], false)).target)
      }
      if (request.action === 'paste') {
        return await copyCaseFiles(target, request.path, request.names, async name => (await resolveFolderEntry(target, [...request.source, name], false)).target)
      }
      const entry = await resolveFolderEntry(target, request.path, request.action === 'list')
      if (request.action === 'list') {
        const entries = await listFolderEntries(entry.target)
        const current = await resolveFolderEntry(target, request.path, true)
        if (current.info.dev !== entry.info.dev || current.info.ino !== entry.info.ino) {
          return { kind: 'error', message: 'Klasör değişti. Listeyi yenileyin.' }
        }
        return { kind: 'listed', rootName: basename(target), locationVersion: location.version, entries }
      }
      if (request.action === 'preview') return await previewFolderFile(entry.target, entry.info, request.page)
      electronShell.showItemInFolder(entry.target)
      return { kind: 'revealed' }
    } catch (error) {
      if (error instanceof CaseLocationError) {
        const message = error.status === 409 ? 'Kapalı dosyanın klasörü salt okunurdur.'
          : error.status === 403 ? (writes ? 'Bu klasöre dosya ekleme yetkiniz yok.' : 'Bu dosyanın klasörünü görüntüleme yetkiniz yok.') : error.message
        return { kind: 'error', message, reset: error.status === 401 || error.status === 404 || (!writes && error.status === 403) }
      }
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EACCES' || code === 'EPERM') return { kind: 'error', message: 'Bu konuma erişilemiyor. Windows klasör izinlerini kontrol edin.' }
      if (code === 'ENOENT' || code === 'ENOTDIR') return { kind: 'error', message: 'Öğe taşınmış veya silinmiş olabilir. Listeyi yenileyin.' }
      return request.action === 'preview'
        ? { kind: 'error', message: 'Önizleme yüklenemedi. Dosyayı Windows Gezgini’nde bulabilirsiniz.' }
        : { kind: 'error', message: 'Klasöre erişilemedi. Oturumu ve depolama bağlantısını kontrol edin.' }
    } finally { if (writes) writing = false }
  })
  shell.window.once('closed', () => {
    ipcMain.removeHandler('hasarbotu:open-case-folder')
    ipcMain.removeHandler('hasarbotu:browse-case-folder')
  })
}
