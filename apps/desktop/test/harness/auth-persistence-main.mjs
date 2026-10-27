import './test-display.mjs'
import { app } from 'electron'
import { writeFile } from 'node:fs/promises'
import { startDesktopShell } from '../../dist/main/shell.js'

app.enableSandbox()
void app.whenReady().then(async () => {
  let shell
  try {
    shell = await startDesktopShell({ apiOrigin: process.env.HB_AUTH_API, assetRoot: process.env.HB_AUTH_ASSETS, userDataPath: app.getPath('userData'), show: false })
    const mode = process.env.HB_AUTH_MODE
    const result = await shell.window.webContents.executeJavaScript(`(async () => {
      const mode = ${JSON.stringify(mode)}
      const response = await fetch('/api/v1/auth/' + mode, { credentials: 'include',
        ...(mode === 'session' ? {} : { method: 'POST' }),
        ...(mode === 'login' ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'persistent@example.test', password: 'persistent-password-42' }) } : {}) })
      return { status: response.status, body: response.status === 204 ? null : await response.json() }
    })()`)
    const cookie = (await shell.window.webContents.session.cookies.get({ name: 'hb_session' }))[0]
    await writeFile(process.env.HB_AUTH_RESULT, JSON.stringify({ ...result, origin: shell.origin,
      cookiePersistent: cookie ? !cookie.session : false, cookieRemainingSeconds: (cookie?.expirationDate ?? 0) - Date.now() / 1000 }))
    await shell.close()
    app.quit()
  } catch (error) {
    await writeFile(process.env.HB_AUTH_RESULT, JSON.stringify({ error: String(error) }))
    if (shell) await shell.close()
    app.exit(1)
  }
})
