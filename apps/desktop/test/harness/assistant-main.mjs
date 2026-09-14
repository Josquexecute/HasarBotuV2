import { app, ipcMain, nativeTheme, screen } from 'electron'
import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startDesktopShell } from '../../dist/main/shell.js'
import { startDesktopAssistant } from '../../dist/main/assistant.js'

const checks = []
const check = (name, pass) => { checks.push({ name, pass: Boolean(pass) }); if (!pass) throw new Error(name) }
const until = async (predicate) => {
  const deadline = Date.now() + 5000
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('assistant condition timed out')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
app.enableSandbox()
void app.whenReady().then(async () => {
  let shell
  let assistant
  try {
    shell = await startDesktopShell({ apiOrigin: 'http://127.0.0.1:1', assetRoot: process.env.HB_ASSISTANT_ASSETS, show: false })
    const options = { shell, assetRoot: process.env.HB_ASSISTANT_ASSETS, userDataPath: app.getPath('userData'), quit: () => {} }
    assistant = await startDesktopAssistant(options)
    const win = assistant.window
    check(`native always-on-top window (actual: ${win.isAlwaysOnTop()})`, win.isAlwaysOnTop())
    check('independent window', !win.getParentWindow())
    check('fixed 64 DIP control', win.getBounds().width === 64 && win.getBounds().height === 64 && !win.isResizable())
    const surface = await win.webContents.executeJavaScript('({ node: typeof require, process: typeof process, ready: !document.querySelector("button").disabled, keys: Object.keys(window.hasarbotuAssistant) })')
    check('sandbox renderer and bounded preload', surface.node === 'undefined' && surface.process === 'undefined' && surface.ready && surface.keys.sort().join(',') === 'cancel,drag,menu,move,press,release')
    check('main renderer keeps privilege-free preload', await shell.window.webContents.executeJavaScript('typeof window.hasarbotuAssistant === "undefined" && Object.keys(window.hasarbotuDesktop).sort().join(",") === "isDesktopShell,platform"'))
    const prefs = win.webContents.getLastWebPreferences()
    check('sandbox isolation and web security', prefs.sandbox && prefs.contextIsolation && prefs.webSecurity && !prefs.nodeIntegration)
    check('helper session isolated from authenticated main app', win.webContents.session !== shell.window.webContents.session)
    shell.window.webContents.setZoomFactor(1.5)
    check('main zoom does not resize helper content', await win.webContents.executeJavaScript('innerWidth === 64'))
    shell.window.webContents.setZoomFactor(1)
    const headers = await fetch(win.webContents.getURL())
    check('assistant HTML available from bridge', headers.status === 200)
    const initial = win.getBounds()
    const command = ipcMain.listeners('hasarbotu:assistant').at(-1)
    command({ sender: shell.window.webContents, senderFrame: shell.window.webContents.mainFrame }, 'left')
    command({ sender: win.webContents, senderFrame: { url: win.webContents.getURL() } }, 'left')
    command({ sender: win.webContents, senderFrame: win.webContents.mainFrame }, { action: 'left' })
    check('wrong sender frame and payload rejected', win.getBounds().x === initial.x)
    await win.webContents.executeJavaScript('window.hasarbotuAssistant.move("left")')
    await until(() => win.getBounds().x === initial.x - 16)
    check('renderer keyboard movement reaches native window', true)
    const saved = JSON.parse(await readFile(join(app.getPath('userData'), 'assistant-position.json'), 'utf8'))
    check('actual saved coordinates match window', saved.x === win.getBounds().x && saved.y === win.getBounds().y)
    // Exercise real preload -> IPC -> native movement with a deterministic cursor.
    // Physical mouse acceptance is separate from this integration test.
    const originalCursor = screen.getCursorScreenPoint
    let cursor = { x: saved.x + 32, y: saved.y + 32 }
    const input = async (expectedCommand) => {
      let received = false
      const markReceived = (_event, command) => { if (command === expectedCommand) received = true }
      ipcMain.on('hasarbotu:assistant', markReceived)
      try {
        await win.webContents.executeJavaScript(`window.hasarbotuAssistant.${expectedCommand}()`)
        await until(() => received)
      }
      finally { ipcMain.removeListener('hasarbotu:assistant', markReceived) }
    }
    try {
      screen.getCursorScreenPoint = () => cursor
      await input('press')
      cursor = { x: cursor.x - 96, y: cursor.y + 32 }
      await input('drag')
      await until(() => win.getBounds().x === saved.x - 96)
      await input('release')
      check('drag IPC moves native window and saves position', win.getBounds().x === saved.x - 96)
      Object.assign(saved, JSON.parse(await readFile(join(app.getPath('userData'), 'assistant-position.json'), 'utf8')))
    } finally { screen.getCursorScreenPoint = originalCursor }
    const ownUrl = win.webContents.getURL()
    await win.webContents.executeJavaScript('location.href = "/dosyalar"')
    await new Promise((resolve) => setTimeout(resolve, 200))
    check('assistant document cannot navigate to app routes', win.webContents.getURL() === ownUrl)
    check('CSP blocks inline scripts', await win.webContents.executeJavaScript('(()=>{const s=document.createElement("script"); s.textContent="window.inlineRan=true";document.head.append(s);return window.inlineRan !== true})()'))
    const menuShown = new Promise((resolve) => assistant.menu.once('menu-will-show', resolve))
    await win.webContents.executeJavaScript('document.querySelector("button").click()')
    await menuShown
    assistant.menu.closePopup()
    check('accessible button opens actual native menu', true)
    shell.window.minimize()
    await until(() => shell.window.isMinimized())
    check('helper survives main minimize', win.isVisible() && win.isAlwaysOnTop())
    assistant.menu.items.find((item) => item.label === 'Dosyalar').click()
    await until(() => shell.window.webContents.getURL() === `${shell.origin}/dosyalar` && !shell.window.isMinimized())
    check('shortcut restores main window and navigates', true)
    assistant.menu.items.find((item) => item.label === 'Yardımcıyı gizle').click()
    check('hide action hides native helper', !win.isVisible())
    assistant.menu.items.find((item) => item.label === 'Yardımcıyı göster').click()
    check('show action recovers native helper above other windows', win.isVisible() && win.isAlwaysOnTop())
    win.close()
    check('closing the helper hides it without losing recovery', !win.isDestroyed() && !win.isVisible())
    assistant.show()
    for (const theme of ['light', 'dark']) {
      nativeTheme.themeSource = theme
      await until(() => win.webContents.executeJavaScript(`matchMedia('(prefers-color-scheme: dark)').matches === ${theme === 'dark'}`))
      check(`theme ${theme} has no overflow`, await win.webContents.executeJavaScript('document.body.scrollWidth === innerWidth && document.body.scrollHeight === innerHeight'))
      await writeFile(join(process.env.HB_ASSISTANT_OUTPUT, `assistant-${theme}.png`), (await win.webContents.capturePage()).toPNG())
    }
    assistant.dispose()
    check('dispose removes IPC listeners', ipcMain.listenerCount('hasarbotu:assistant') === 0)
    assistant = await startDesktopAssistant(options)
    check('recreation restores persisted position', assistant.window.getBounds().x === saved.x && assistant.window.getBounds().y === saved.y)
    screen.emit('display-metrics-changed', {}, screen.getPrimaryDisplay(), ['workArea'])
    check('display update keeps visible position', assistant.window.getBounds().x === saved.x)
    shell.window.destroy()
    check('main close destroys helper and IPC', assistant.window.isDestroyed() && ipcMain.listenerCount('hasarbotu:assistant') === 0)
  } catch (error) {
    checks.push({ name: error instanceof Error ? error.message : 'unexpected failure', pass: false })
  } finally {
    assistant?.dispose()
    await shell?.close()
    await writeFile(process.env.HB_ASSISTANT_RESULT, JSON.stringify(checks, null, 2))
    app.exit(checks.every((item) => item.pass) ? 0 : 1)
  }
})
