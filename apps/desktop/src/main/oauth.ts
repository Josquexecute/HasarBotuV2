import { ipcMain } from 'electron'
import type { DesktopShell } from './shell.js'

// Cosmetic focus only. The browser-bound API completion remains the sole session authority.
export function startOAuthReturn(shell: DesktopShell): void {
  ipcMain.handle('hasarbotu:oauth-focus', (event) => {
    if (event.sender !== shell.window.webContents || event.senderFrame !== event.sender.mainFrame
      || new URL(event.senderFrame.url).origin !== shell.origin) throw new Error('Untrusted OAuth caller')
    if (shell.window.isMinimized()) shell.window.restore()
    shell.window.show()
    shell.window.focus()
  })
  shell.window.once('closed', () => ipcMain.removeHandler('hasarbotu:oauth-focus'))
}
