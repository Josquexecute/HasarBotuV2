import { app, ipcMain, nativeTheme, screen } from 'electron'
import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startDesktopShell } from '../../dist/main/shell.js'
import { startDesktopAssistant } from '../../dist/main/assistant.js'
import { startDesktopUpdates } from '../../dist/main/updates.js'

const checks = []
const check = (name, pass) => { checks.push({ name, pass: Boolean(pass) }); if (!pass) throw new Error(name) }
const until = async (predicate, description = 'assistant condition') => {
  const deadline = Date.now() + 5000
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`${description} timed out`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
app.enableSandbox()
// Keep the harness alive until the result file has finished writing.
app.on('window-all-closed', () => {})
void app.whenReady().then(async () => {
  let shell
  let assistant
  try {
    shell = await startDesktopShell({ apiOrigin: 'http://127.0.0.1:1', assetRoot: process.env.HB_ASSISTANT_ASSETS, show: false })
    startDesktopUpdates(shell, 'http://127.0.0.1:1')
    check('sandbox main preload can check updates; development install stays disabled', await shell.window.webContents.executeJavaScript('window.hasarbotuUpdates.check().then(state => !state.supported && state.phase === "disabled")'))
    const options = { shell, assetRoot: process.env.HB_ASSISTANT_ASSETS, userDataPath: app.getPath('userData'), quit: () => {} }
    assistant = await startDesktopAssistant(options)
    const win = assistant.window
    check('isolated character cannot invoke installation', await win.webContents.executeJavaScript('typeof window.hasarbotuUpdates === "undefined"'))
    const appearance = { scheme: 'dark', accentColor: '#15803d', characterColor: '#b9e7c8', textSize: 'large', reduceMotion: true }
    await until(() => win.webContents.executeJavaScript('document.querySelector("canvas").style.filter.includes("drop-shadow")'), 'initial appearance ready')
    const beforePalette = await win.webContents.executeJavaScript('document.querySelector("canvas").toDataURL()')
    check('trusted main frame can publish appearance', await shell.window.webContents.executeJavaScript(`window.hasarbotuAppearance.set(${JSON.stringify(appearance)})`))
    await until(() => win.webContents.executeJavaScript('document.querySelector("canvas").style.filter.includes("21, 128, 61")'), 'personalized character color')
    const afterPalette = await win.webContents.executeJavaScript('document.querySelector("canvas").toDataURL()')
    check('appearance changes actual character pixels', beforePalette !== afterPalette)
    const colors = [
      ['#000000', '#ffffff'], ['#ffffff', '#111111'], ['#ff0000', '#111111'],
      ['#00ff00', '#111111'], ['#0000ff', '#ffffff'], ['#ffff00', '#111111'],
      ['#00ffff', '#111111'], ['#ff00ff', '#111111'], ['#ff8000', '#111111'],
      ['#808080', '#111111'], ['#4a82b7', '#111111'], ['#eff2fa', '#111111'],
    ]
    for (const reduceMotion of [true, false]) {
      for (const [characterColor, eyeColor] of colors) {
        await shell.window.webContents.executeJavaScript(`window.hasarbotuAppearance.set(${JSON.stringify({ ...appearance, characterColor, reduceMotion })})`)
        const [body, eyes] = [characterColor, eyeColor].map(color => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)))
        // Read the shipped Canvas output, including the animated and neutral engines.
        await until(() => win.webContents.executeJavaScript(`(() => {
          const canvas = document.querySelector('canvas')
          const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
          const count = rgb => {
            let matches = 0
            for (let i = 0; i < pixels.length; i += 4) {
              if (pixels[i] === rgb[0] && pixels[i + 1] === rgb[1] && pixels[i + 2] === rgb[2] && pixels[i + 3] === 255) matches++
            }
            return matches
          }
          return count(${JSON.stringify(body)}) > 500 && count(${JSON.stringify(eyes)}) > 10
        })()`), `exact body and contrasting eyes ${characterColor}, reduced motion ${reduceMotion}`)
        check(`exact body and contrasting eyes ${characterColor}, reduced motion ${reduceMotion}`, true)
        if (reduceMotion) await writeFile(join(process.env.HB_ASSISTANT_OUTPUT, `assistant-color-${characterColor.slice(1)}.png`), (await win.webContents.capturePage()).toPNG())
      }
    }
    check('malformed color payload is rejected', !(await shell.window.webContents.executeJavaScript(`window.hasarbotuAppearance.set(${JSON.stringify({ ...appearance, accentColor: 'url(file:///private)' })})`)))
    check('character cannot publish appearance', await win.webContents.executeJavaScript('typeof window.hasarbotuAppearance === "undefined"'))
    await writeFile(join(process.env.HB_ASSISTANT_OUTPUT, 'assistant-custom-appearance.png'), (await win.webContents.capturePage()).toPNG())
    await shell.window.webContents.executeJavaScript(`window.hasarbotuAppearance.set(${JSON.stringify({ ...appearance, accentColor: '#635bff', characterColor: '#eff2fa', reduceMotion: false })})`)
    await win.webContents.executeJavaScript('window.rendererErrors = []; window.addEventListener("error", event => window.rendererErrors.push(event.message)); undefined')
    // Gaze animation must not depend on the host's accessibility preference.
    win.webContents.debugger.attach('1.3')
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
    await until(() => win.webContents.executeJavaScript('!matchMedia("(prefers-reduced-motion: reduce)").matches'))
    check(`native always-on-top window (actual: ${win.isAlwaysOnTop()})`, win.isAlwaysOnTop())
    check('independent window', !win.getParentWindow())
    check('fixed 120 DIP character', win.getBounds().width === 120 && win.getBounds().height === 120 && !win.isResizable())
    const surface = await win.webContents.executeJavaScript('({ node: typeof require, process: typeof process, ready: !document.querySelector("button").disabled, keys: Object.keys(window.hasarbotuAssistant) })')
    check('sandbox renderer and bounded preload', surface.node === 'undefined' && surface.process === 'undefined' && surface.ready && surface.keys.sort().join(',') === 'cancel,drag,menu,move,onAppearance,onGaze,press,release')
    await until(() => win.webContents.executeJavaScript('(()=>{ const c=document.querySelector("canvas"); return c && c.getContext("2d").getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3 && v>0) })()'))
    check('upstream Mochi actually renders in sandbox canvas', true)
    check('main renderer keeps privilege-free preload', await shell.window.webContents.executeJavaScript('typeof window.hasarbotuAssistant === "undefined" && Object.keys(window.hasarbotuDesktop).sort().join(",") === "isDesktopShell,platform"'))
    const prefs = win.webContents.getLastWebPreferences()
    check('sandbox isolation and web security', prefs.sandbox && prefs.contextIsolation && prefs.webSecurity && !prefs.nodeIntegration)
    check('helper session isolated from authenticated main app', win.webContents.session !== shell.window.webContents.session)
    shell.window.webContents.setZoomFactor(1.5)
    check('main zoom does not resize helper content', await win.webContents.executeJavaScript('innerWidth === 120'))
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
    let cursor = { x: saved.x + 60, y: saved.y + 60 }
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
      await win.webContents.executeJavaScript('window.gazeOff = window.hasarbotuAssistant.onGaze((value) => { window.gaze = value }); undefined')
      await until(() => win.webContents.executeJavaScript('window.gaze?.x === 0 && window.gaze?.y === 0'))
      check('native cursor reaches renderer as relative gaze', true)
      await win.webContents.executeJavaScript('window.gazeOff(); window.gaze = undefined')
      await new Promise((resolve) => setTimeout(resolve, 180))
      check('gaze subscription can be removed', await win.webContents.executeJavaScript('window.gaze === undefined'))
      await win.webContents.executeJavaScript(`window.eyeCenter = (axis = 'x') => {
        const c = document.querySelector('canvas')
        const p = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
        let sum = 0, count = 0
        for (let i = 0; i < p.length; i += 4) {
          if (p[i] < 50 && p[i + 1] < 50 && p[i + 2] < 50 && p[i + 3] > 200) {
            sum += axis === 'y' ? Math.floor((i / 4) / c.width) : (i / 4) % c.width
            count++
          }
        }
        return count ? sum / count / devicePixelRatio : 60
      }; undefined`)
      cursor = { x: saved.x - 800, y: saved.y + 60 }
      await until(() => win.webContents.executeJavaScript('window.eyeCenter() < 55'), 'leftward gaze in canvas')
      cursor = { x: saved.x + 800, y: saved.y + 60 }
      await until(() => win.webContents.executeJavaScript('window.eyeCenter() > 65'), 'rightward gaze in canvas')
      check('cursor movement visibly moves Mochi eyes left and right', true)
      cursor = { x: saved.x + 60, y: saved.y - 800 }
      await until(() => win.webContents.executeJavaScript('window.eyeCenter("y") < 56'), 'upward gaze in canvas')
      await writeFile(join(process.env.HB_ASSISTANT_OUTPUT, 'assistant-gaze-up.png'), (await win.webContents.capturePage()).toPNG())
      const upperEyeY = await win.webContents.executeJavaScript('window.eyeCenter("y")')
      cursor = { x: saved.x + 60, y: saved.y + 800 }
      await until(() => win.webContents.executeJavaScript(`window.eyeCenter("y") > ${upperEyeY + 12}`), 'downward gaze in canvas')
      await writeFile(join(process.env.HB_ASSISTANT_OUTPUT, 'assistant-gaze-down.png'), (await win.webContents.capturePage()).toPNG())
      check('cursor movement visibly moves Mochi eyes in the correct vertical direction', true)
      cursor = { x: saved.x + 60, y: saved.y + 60 }
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
    await win.webContents.executeJavaScript('document.querySelector("button").click()')
    await until(() => assistant.menuWindow.isVisible())
    check('accessible button opens the designed shortcut panel',true)
    await until(() => assistant.menuWindow.webContents.executeJavaScript('!!document.querySelector(".desktop-assistant-panel")'))
    check('menu shares authenticated session with bounded IPC; character stays isolated',await assistant.menuWindow.webContents.executeJavaScript('typeof require === "undefined" && Object.keys(window.hasarbotuAssistantMenu).join(",") === "choose"') && assistant.menuWindow.webContents.session === shell.window.webContents.session && win.webContents.session !== shell.window.webContents.session)
    check('unauthenticated panel hides case data and has no overflow',await assistant.menuWindow.webContents.executeJavaScript('!document.querySelector("input") && document.body.scrollWidth === innerWidth && document.querySelector("main").scrollHeight <= document.querySelector("main").clientHeight'))
    await writeFile(join(process.env.HB_ASSISTANT_OUTPUT,'assistant-menu.png'),(await assistant.menuWindow.webContents.capturePage()).toPNG())
    await assistant.menuWindow.webContents.executeJavaScript('document.querySelector("header button").click()')
    await until(() => !assistant.menuWindow.isVisible())
    check('menu close command hides the actual panel',true)
    shell.window.minimize()
    await until(() => shell.window.isMinimized())
    check('helper survives main minimize', win.isVisible() && win.isAlwaysOnTop())
    await win.webContents.executeJavaScript('window.hasarbotuAssistant.menu()')
    await until(() => assistant.menuWindow.isVisible())
    assistant.menu.items.find((item) => item.label === 'Dosyalar').click()
    check('case shortcut keeps the main window minimized', shell.window.isMinimized() && assistant.menuWindow.isVisible())
    await assistant.menuWindow.webContents.executeJavaScript('[...document.querySelectorAll("button")].find(button => button.textContent === "Giriş yap").click()')
    await until(() => !shell.window.isMinimized())
    check('explicit login shortcut restores main window', true)
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
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await until(() => win.webContents.executeJavaScript('matchMedia("(prefers-reduced-motion: reduce)").matches'))
    // The media-query change event applies the neutral pose at the next render.
    await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))')
    const still = await win.webContents.executeJavaScript('document.querySelector("canvas").toDataURL()')
    await new Promise((resolve) => setTimeout(resolve, 300))
    check('reduced motion renders a still visible character', await win.webContents.executeJavaScript(`document.querySelector("canvas").toDataURL() === ${JSON.stringify(still)}`))
    // Use a real Chromium scale change: CDP's synthetic DPR does not notify
    // physical-pixel ResizeObservers, unlike zoom or moving between monitors.
    const originalRatio = await win.webContents.executeJavaScript('devicePixelRatio')
    win.webContents.setZoomFactor(2)
    await until(() => win.webContents.executeJavaScript(`devicePixelRatio === ${originalRatio * 2} && document.querySelector("canvas").width === Math.round(120 * devicePixelRatio)`), 'scaled canvas resolution')
    check('real Chromium scaling rebuilds the still canvas at native resolution', true)
    win.webContents.setZoomFactor(1)
    await until(() => win.webContents.executeJavaScript(`devicePixelRatio === ${originalRatio} && document.querySelector("canvas").width === Math.round(120 * devicePixelRatio)`))
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
    await until(() => win.webContents.executeJavaScript('!matchMedia("(prefers-reduced-motion: reduce)").matches'))
    const readCursor = screen.getCursorScreenPoint
    let hiddenCursorReads = 0
    try {
      screen.getCursorScreenPoint = () => { hiddenCursorReads++; return readCursor() }
      win.hide()
      await until(() => win.webContents.executeJavaScript('document.hidden'))
      const hiddenCanvas = await win.webContents.executeJavaScript('document.querySelector("canvas").toDataURL()')
      await new Promise((resolve) => setTimeout(resolve, 300))
      check('hidden helper stops cursor polling', hiddenCursorReads === 0)
      check('hidden helper stops drawing', await win.webContents.executeJavaScript(`document.querySelector("canvas").toDataURL() === ${JSON.stringify(hiddenCanvas)}`))
      assistant.show()
      await until(() => hiddenCursorReads > 0)
      check('showing helper restarts gaze', true)
    } finally { screen.getCursorScreenPoint = readCursor }
    check('renderer interaction has no uncaught errors', await win.webContents.executeJavaScript('window.rendererErrors.length === 0'))
    win.webContents.debugger.detach()
    assistant.dispose()
    check('dispose removes IPC listeners', ipcMain.listenerCount('hasarbotu:assistant') === 0)
    check('dispose removes shortcut panel and its IPC',assistant.menuWindow.isDestroyed() && ipcMain.listenerCount('hasarbotu:assistant-menu') === 0)
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
