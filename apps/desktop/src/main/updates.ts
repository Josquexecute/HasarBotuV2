import { app, ipcMain } from 'electron'
import { dirname, join } from 'node:path'
import { desktopReleaseResponseSchema } from '@hasarbotu/contracts'
import type { DesktopUpdateState } from '@hasarbotu/contracts'
import type { DesktopShell } from './shell.js'
import { downloadVerifiedInstaller, isNewerVersion, scheduleUpdateHelper, verifyInstallerVersion, writeUpdateHelper } from './updates-core.js'

export function startDesktopUpdates(shell: DesktopShell, apiOrigin: string): () => void {
  const supported = app.isPackaged && process.platform === 'win32' && process.arch === 'x64'
  let state: DesktopUpdateState = { currentVersion: app.getVersion(), supported, phase: supported ? 'idle' : 'disabled', downloadedBytes: 0 }
  let busy = false, disposed = false
  const publish = (next: DesktopUpdateState) => {
    state = next
    if (!disposed && !shell.window.isDestroyed()) shell.window.webContents.send('hasarbotu:update-state', state)
  }
  const trusted = (event: Electron.IpcMainInvokeEvent) => event.sender === shell.window.webContents
    && event.senderFrame === event.sender.mainFrame && new URL(event.senderFrame.url).origin === shell.origin
  const fetchAuthenticated: typeof fetch = (input, init) => shell.window.webContents.session.fetch(input as string, init)
  const latest = async () => {
    const response = await fetchAuthenticated(`${shell.origin}/api/v1/desktop-updates/latest`, { credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(30_000), cache: 'no-store' })
    if (!response.ok) throw new Error(response.status === 401 ? 'Güncelleme için hesabınıza giriş yapın.' : 'Güncelleme sunucusuna ulaşılamadı.')
    return desktopReleaseResponseSchema.parse(await response.json()).release
  }
  const check = async () => {
    if (!supported || busy) return state
    busy = true
    publish({ currentVersion: state.currentVersion, supported, phase: 'checking', downloadedBytes: 0 })
    try {
      const release = await latest()
      publish({ ...state, phase: !release ? 'disabled' : isNewerVersion(release.version, state.currentVersion) ? 'available' : 'current', ...(release ? { release } : {}) })
    } catch (error) { publish({ ...state, phase: 'error', message: error instanceof Error ? error.message : 'Güncelleme kontrol edilemedi.' }) }
    finally { busy = false }
    return state
  }
  const install = async () => {
    if (!supported || busy || state.phase !== 'available' || !state.release) return state
    const selectedRelease = state.release
    busy = true
    publish({ ...state, phase: 'checking', downloadedBytes: 0 })
    try {
      const release = await latest()
      if (!release || release.sha256 !== selectedRelease.sha256 || !isNewerVersion(release.version, state.currentVersion)) throw new Error('Yayımlanan sürüm değişti. Güncellemeleri yeniden kontrol edin.')
      publish({ ...state, phase: 'downloading', downloadedBytes: 0 })
      const directory = join(app.getPath('userData'), 'updates', release.sha256)
      const installer = await downloadVerifiedInstaller({ release, origin: shell.origin, directory, fetch: fetchAuthenticated, progress: bytes => publish({ ...state, downloadedBytes: bytes }) })
      await verifyInstallerVersion(installer, release.version)
      const taskName = `HasarBotu-Update-${process.pid}-${release.sha256.slice(0, 12)}`
      const helper = await writeUpdateHelper({ directory, installer, executable: process.execPath, installDirectory: dirname(process.execPath), pid: process.pid, taskName, apiOrigin, userDataPath: app.getPath('userData') })
      await scheduleUpdateHelper(helper, taskName)
      publish({ ...state, phase: 'installing' })
      app.quit()
    } catch (error) { publish({ ...state, phase: 'error', message: error instanceof Error ? error.message : 'Güncelleme kurulamadı.' }) }
    finally { busy = false }
    return state
  }
  ipcMain.handle('hasarbotu:update-check', event => { if (!trusted(event)) throw new Error('Untrusted update caller'); return check() })
  ipcMain.handle('hasarbotu:update-install', event => { if (!trusted(event)) throw new Error('Untrusted update caller'); return install() })
  const dispose = () => { disposed = true; ipcMain.removeHandler('hasarbotu:update-check'); ipcMain.removeHandler('hasarbotu:update-install') }
  shell.window.once('closed', dispose)
  return dispose
}
