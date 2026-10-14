import { contextBridge, ipcRenderer } from 'electron'

/**
 * Preload allowlist (D2).
 *
 * Desktop information stays data-only. The user's appearance feature adds a
 * separate, cosmetic-only surface; no generic IPC, URL, filesystem or Electron
 * API is exposed. Main validates the sender frame and every appearance field.
 *
 * UI verisi göreli `/api/...` üzerinden gelir. Kullanıcının istediği renk
 * ve güncelleme komutları ayrı, dar yüzeylerde main-frame doğrulamasıyla
 * uygulanır; renderer kurulum yolu veya indirme adresi belirleyemez.
 *
 * `sandbox: true` olduğu için bu dosya CommonJS olmalıdır; kaynak `.cts`
 * yazılır ve `.cjs` olarak derlenir.
 */

const surface = Object.freeze({
  /** UI, masaüstü kabuğunda çalıştığını bu bayrakla ayırt edebilir. */
  isDesktopShell: true,
  /** Yalnız bilgi amaçlı; OS kimliği dışında hiçbir ayrıntı taşımaz. */
  platform: process.platform,
})

contextBridge.exposeInMainWorld('hasarbotuDesktop', surface)
// Only trusted main-frame check/install commands; renderers supply no URLs or paths.
contextBridge.exposeInMainWorld('hasarbotuUpdates', Object.freeze({
  check: () => ipcRenderer.invoke('hasarbotu:update-check'),
  install: () => ipcRenderer.invoke('hasarbotu:update-install'),
  onState: (callback: unknown) => {
    if (typeof callback !== 'function') throw new TypeError('Update callback must be a function')
    const listener = (_event: unknown, value: unknown) => callback(value)
    ipcRenderer.on('hasarbotu:update-state', listener)
    return () => ipcRenderer.removeListener('hasarbotu:update-state', listener)
  },
}))
contextBridge.exposeInMainWorld('hasarbotuAppearance', Object.freeze({
  set: (value: unknown) => ipcRenderer.invoke('hasarbotu:assistant-appearance', value),
  onReady: (callback: unknown) => {
    if (typeof callback !== 'function') throw new TypeError('Appearance callback must be a function')
    const listener = () => callback()
    ipcRenderer.on('hasarbotu:appearance-ready', listener)
    return () => ipcRenderer.removeListener('hasarbotu:appearance-ready', listener)
  },
}))
