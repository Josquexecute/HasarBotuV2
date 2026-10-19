import { app, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import { startDesktopShell } from '../../dist/main/shell.js'
import { startDesktopAssistant } from '../../dist/main/assistant.js'

app.enableSandbox()
void app.whenReady().then(async () => {
  try {
    const shell = await startDesktopShell({ apiOrigin: 'http://127.0.0.1:1', assetRoot: process.env.HB_ASSISTANT_ASSETS, show: false })
    const assistant = await startDesktopAssistant({ shell, assetRoot: process.env.HB_ASSISTANT_ASSETS, userDataPath: app.getPath('userData'), quit: () => app.quit() })
    const before = assistant.window.getBounds()
    await writeFile(process.env.HB_ASSISTANT_RESULT, JSON.stringify({ x: before.x - 16, y: before.y }))
    const contents = assistant.window.webContents
    ipcMain.listeners('hasarbotu:assistant').at(-1)({ sender: contents, senderFrame: contents.mainFrame }, 'left')
    // Exit in the same turn as movement, before a debounced write can begin.
    app.quit()
  } catch { app.exit(1) }
})
