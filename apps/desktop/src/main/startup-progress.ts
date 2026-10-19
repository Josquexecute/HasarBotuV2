import { BrowserWindow } from 'electron'
import { SECURE_WEB_PREFERENCES } from './security.js'
import { hardenSession } from './shell.js'

const messages = {
  connecting: ['Sunucuya bağlanılıyor', 'Ofis bağlantısı kontrol ediliyor.'],
  configuring: ['Ofis bağlantısı hazırlanıyor', 'Windows izin ekranı açılırsa onaylayın. Bu işlem biraz sürebilir.'],
  loading: ['HasarBotu açılıyor', 'Çalışma alanınız hazırlanıyor.'],
} as const

/** Visible before network setup; this isolated page has no preload or scripting. */
export async function createStartupProgress() {
  const window = new BrowserWindow({
    width: 460, height: 230, title: 'HasarBotu · Başlatılıyor', show: false,
    resizable: false, maximizable: false, minimizable: true, closable: false,
    backgroundColor: '#121923',
    webPreferences: { ...SECURE_WEB_PREFERENCES, partition: 'hasarbotu-startup' },
  })
  hardenSession(window.webContents.session)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.on('will-frame-navigate', event => event.preventDefault())
  window.webContents.on('will-attach-webview', event => event.preventDefault())
  const update = async (stage: keyof typeof messages) => {
    if (window.isDestroyed()) return
    const [title, detail] = messages[stage]
    await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>HasarBotu · Başlatılıyor</title><style>body{margin:0;padding:30px;color:#eef2fa;background:#121923;font:16px/1.6 system-ui}h1{font-size:20px;margin:0 0 12px}p{margin:0;color:#bdc9db}</style></head><body><main role="status" aria-live="polite"><h1>${title}</h1><p>${detail}</p></main></body></html>`))
  }
  try {
    await update('connecting')
    window.show()
  } catch (error) { window.destroy(); throw error }
  return {
    window,
    update,
    hide: () => { if (!window.isDestroyed()) window.hide() },
    dispose: () => { if (!window.isDestroyed()) window.destroy() },
  }
}
