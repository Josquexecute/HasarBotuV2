import './test-display.mjs'
import { app } from 'electron'
import { startDesktopShell } from '../../dist/main/shell.js'
const { startDesktopAssistant } = await import(process.env.HB_FAULT_ASSISTANT_MODULE ?? '../../dist/main/assistant.js')

app.enableSandbox()
app.on('window-all-closed', () => {})
void app.whenReady().then(async () => {
  globalThis.faultShell = await startDesktopShell({ apiOrigin: process.env.HB_FAULT_API, assetRoot: process.env.HB_FAULT_ASSETS, userDataPath: app.getPath('userData'), show: true })
  globalThis.faultAssistant = await startDesktopAssistant({ shell: faultShell, assetRoot: process.env.HB_FAULT_ASSETS, userDataPath: app.getPath('userData'), quit: () => {} })
})
