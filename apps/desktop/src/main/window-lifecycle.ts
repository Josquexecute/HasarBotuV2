import type { App, BrowserWindow } from 'electron'

/** Hide the main window to the tray; explicit quit and Windows shutdown still exit. */
export function hideToTrayOnClose(app: App, window: BrowserWindow): void {
  let quitting = false
  const allowQuit = () => { quitting = true }
  app.on('before-quit', allowQuit)
  window.on('query-session-end', allowQuit)
  window.on('close', event => {
    if (quitting) return
    event.preventDefault()
    window.hide()
  })
  window.once('closed', () => app.removeListener('before-quit', allowQuit))
}
