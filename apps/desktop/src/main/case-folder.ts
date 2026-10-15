import { dialog, ipcMain, shell as electronShell, type BrowserWindow } from 'electron'
import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { caseLocationResponseSchema, idSchema } from '@hasarbotu/contracts'
import type { DesktopShell } from './shell.js'
import { resolveCaseFolder, resolveSavedCaseFolder, resolveSelectedCaseFolder } from './case-folder-core.js'

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
  let busy = false
  ipcMain.handle('hasarbotu:open-case-folder', async (event, input: unknown) => {
    const fromMain = event.sender === shell.window.webContents && event.senderFrame === event.sender.mainFrame
      && new URL(event.senderFrame.url).origin === shell.origin
    const fromAssistant = assistantWindow && !assistantWindow.isDestroyed() && event.sender === assistantWindow.webContents
      && event.senderFrame === event.sender.mainFrame && event.senderFrame.url === `${shell.origin}/touch-assistant`
    if (!fromMain && !fromAssistant) throw new Error('Untrusted folder caller')
    if (busy) return { opened: false, error: 'Başka bir klasör açılıyor. İşlem bitince yeniden deneyin.' }
    busy = true
    try {
      const caseId = idSchema.parse(input)
      const response = await shell.window.webContents.session.fetch(`${shell.origin}/api/v1/cases/${encodeURIComponent(caseId)}/location`, { credentials: 'include', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000) })
      if (!response.ok) throw new Error(response.status === 404 ? 'Bu dosyanın kayıtlı klasörü yok.' : 'Klasör bilgisi alınamadı. Oturumu ve bağlantıyı kontrol edin.')
      const { location } = caseLocationResponseSchema.parse(await response.json())
      if (location.caseId !== caseId) throw new Error('Klasör bilgisi seçilen dosyayla eşleşmiyor. Dosyayı yenileyip tekrar deneyin.')
      const settingsFile = join(userDataPath, 'case-folder-roots.json')
      const settings = await readRoots(settingsFile)
      const overridesFile = join(userDataPath, 'case-folder-overrides.json')
      const overrides = await readRoots(overridesFile)
      const defaults = await readRoots(defaultsFile)
      // Local mappings belong to the configured API, not to the random loopback port.
      const key = `${apiOrigin}:${location.storageRootKey}`
      const roots = [...new Set([defaults[location.storageRootKey], settings[key]].filter((root): root is string => !!root))]
      // A chosen case directory is never a root for other files; expire it on a server location change.
      const caseKey = `${apiOrigin}:${caseId}:`
      const overrideKey = `${caseKey}${location.version}`
      let target: string | undefined
      if (overrides[overrideKey]) {
        try { target = await resolveSavedCaseFolder(overrides[overrideKey]) } catch (error) {
          if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
        }
      }
      for (const root of roots) {
        if (target) break
        try { target = await resolveCaseFolder(root, location.relativePath) } catch (error) {
          if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
        }
      }
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
  shell.window.once('closed', () => ipcMain.removeHandler('hasarbotu:open-case-folder'))
}
