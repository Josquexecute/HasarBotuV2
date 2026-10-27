import './test-display.mjs'
import { app } from 'electron'
import { startDesktopShell } from '../../dist/main/shell.js'
import { startOAuthReturn } from '../../dist/main/oauth.js'

app.enableSandbox()
void app.whenReady().then(async () => {
  globalThis.oauthOpened = []
  const shell = await startDesktopShell({ apiOrigin: process.env.HB_OAUTH_API, assetRoot: process.env.HB_OAUTH_ASSETS,
    userDataPath: app.getPath('userData'), show: false, openExternal: async url => { globalThis.oauthOpened.push(url) } })
  startOAuthReturn(shell)
  globalThis.oauthShell = shell
})
