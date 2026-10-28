import './test-display.mjs'
import { app } from 'electron'
import { startDesktopShell } from '../../dist/main/shell.js'

app.enableSandbox()
void app.whenReady().then(async () => {
  globalThis.calculatorShell = await startDesktopShell({ apiOrigin: process.env.HB_CALCULATOR_API, assetRoot: process.env.HB_CALCULATOR_ASSETS,
    userDataPath: app.getPath('userData'), show: false })
})
