import { app } from 'electron'
import { writeFile } from 'node:fs/promises'
import { startDesktopShell } from '../../dist/main/shell.js'

app.enableSandbox()
void app.whenReady().then(async () => {
  let shell
  try {
    shell = await startDesktopShell({ apiOrigin: 'http://127.0.0.1:1', assetRoot: process.env.HB_STORAGE_ASSETS, userDataPath: app.getPath('userData'), show: false })
    const script = process.env.HB_STORAGE_MODE === 'write'
      ? `localStorage.setItem('hasarbotu-theme', JSON.stringify('dark')); localStorage.setItem('note-draft', JSON.stringify({body:'saved draft',key:'unchanged-request-id',attempted:true})); true`
      : `({theme:localStorage.getItem('hasarbotu-theme'),draft:localStorage.getItem('note-draft')})`
    const data = await shell.window.webContents.executeJavaScript(script)
    await shell.window.webContents.session.flushStorageData()
    await writeFile(process.env.HB_STORAGE_RESULT, JSON.stringify({ origin: shell.origin, data }))
    await shell.close()
    app.quit()
  } catch (error) {
    await writeFile(process.env.HB_STORAGE_RESULT, JSON.stringify({ error: String(error) }))
    if (shell) await shell.close()
    app.exit(1)
  }
})
