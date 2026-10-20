import { app, dialog, ipcMain, nativeTheme, screen } from 'electron'
import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startDesktopShell } from '../../dist/main/shell.js'
import { startDesktopAssistant } from '../../dist/main/assistant.js'
import { startDesktopUpdates } from '../../dist/main/updates.js'
import { createStartupProgress } from '../../dist/main/startup-progress.js'

const checks = []
const check = (name, pass) => { checks.push({ name, pass: Boolean(pass) }); if (!pass) throw new Error(name) }
const until = async (predicate, description = 'assistant condition') => {
  const deadline = Date.now() + 5000
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`${description} timed out`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
// Draw the actual shipped poses at physical 2x resolution, including the sparse
// idle stretch, without waiting a minute or changing the production scheduler.
async function sampleGestures() {
  const { BotEngine } = await import('/vendor/coucou/mochi/engine.js')
  const { AssistantMotion } = await import('/desktop-assistant-motion.js')
  const original = Object.getOwnPropertyDescriptor(performance, 'now')
  let time = 0
  Object.defineProperty(performance, 'now', { configurable: true, value: () => time })
  try {
    let unclipped = true
    const tapKinds = new Set()
    const tapPixels = new Set()
    for (const kind of ['curious', 'stretch', 'drag', 'release', 'success', 'sleep', 'wake', 'working', 'error', 'notification', 'celebrate', 'surprised', 'edge', 'tap-0', 'tap-1', 'tap-2', 'tap-3', 'tap-4', 'tap-5']) {
      time = 0
      const bot = new BotEngine()
      bot.bodyColor = [.937, .949, .98]
      bot.nextBlink = Infinity
      const motion = new AssistantMotion(bot, () => time, () => .5)
      if (kind === 'curious') motion.curious()
      if (kind === 'stretch') { time = 60000; motion.tick() }
      if (kind === 'drag' || kind === 'release') { motion.press(); motion.drag(-1) }
      if (kind === 'release') {
        for (let i = 0; i < 10; i++) { time += 1000 / 60; bot.update(1 / 60) }
        motion.release()
      }
      if (kind === 'success') motion.success()
      if (kind === 'sleep' || kind === 'wake') { time = 120000; motion.tick() }
      if (kind === 'wake') { motion.press(); motion.release() }
      if (kind === 'working') { motion.work(true); time += 450; motion.tick() }
      if (['error', 'notification', 'celebrate', 'surprised'].includes(kind)) motion.react(kind)
      if (kind === 'edge') motion.edge(-1)
      if (kind.startsWith('tap-')) {
        for (let click = 0; click <= Number(kind.slice(4)); click++) {
          if (click > 0) for (let frame = 0; frame < 90; frame++) { time += 1000 / 60; bot.update(1 / 60) }
          motion.press()
          motion.release()
        }
        tapKinds.add(motion.lastTap)
      }
      const start = time
      for (const elapsed of [70, 180, 480, 1100, 1500]) {
        while (time - start < elapsed) { time += 1000 / 60; bot.update(1 / 60) }
        const cell = document.createElement('canvas')
        cell.width = cell.height = 240
        const context = cell.getContext('2d')
        context.scale(2, 2)
        bot.draw(context, 120, 120)
        const pixels = context.getImageData(0, 0, 240, 240).data
        if (kind.startsWith('tap-') && elapsed === 180) {
          let signature = 0
          for (const value of pixels) signature = (Math.imul(signature, 31) + value) >>> 0
          tapPixels.add(signature)
        }
        for (let i = 0; i < 240; i++) {
          if (pixels[(i * 240) * 4 + 3] || pixels[(i * 240 + 239) * 4 + 3]
            || pixels[i * 4 + 3] || pixels[(239 * 240 + i) * 4 + 3]) unclipped = false
        }
      }
    }
    return { unclipped, distinctTapKinds: tapKinds.size, distinctTapDraws: tapPixels.size }
  } finally {
    if (original) Object.defineProperty(performance, 'now', original)
    else delete performance.now
  }
}
app.enableSandbox()
// Keep the harness alive until the result file has finished writing.
app.on('window-all-closed', () => {})
void app.whenReady().then(async () => {
  let shell
  let assistant
  try {
    const progress = await createStartupProgress()
    check('startup feedback is visible before any API connection or shell exists', progress.window.isVisible())
    check('startup feedback explains the initial connection', await progress.window.webContents.executeJavaScript('document.body.textContent.includes("Sunucuya bağlanılıyor")'))
    await progress.update('configuring')
    check('startup feedback explains possible Windows approval', await progress.window.webContents.executeJavaScript('document.body.textContent.includes("Windows izin ekranı")'))
    const startupPreferences = progress.window.webContents.getLastWebPreferences()
    check('startup page is isolated and has no preload', startupPreferences.sandbox && !startupPreferences.nodeIntegration && !startupPreferences.preload)
    progress.hide()
    check('gate prompts can hide the progress window without losing the startup lifecycle', !progress.window.isVisible() && !progress.window.isDestroyed())
    shell = await startDesktopShell({ apiOrigin: 'http://127.0.0.1:1', assetRoot: process.env.HB_ASSISTANT_ASSETS, show: false })
    progress.dispose()
    check('startup progress is destroyed after the real shell exists', progress.window.isDestroyed())
    startDesktopUpdates(shell, 'http://127.0.0.1:1')
    check('sandbox main preload can check updates; development install stays disabled', await shell.window.webContents.executeJavaScript('window.hasarbotuUpdates.check().then(state => !state.supported && state.phase === "disabled")'))
    const options = { shell, assetRoot: process.env.HB_ASSISTANT_ASSETS, userDataPath: app.getPath('userData'), quit: () => {} }
    assistant = await startDesktopAssistant(options)
    check('shortcut React workspace is not loaded before the first menu request', assistant.menuWindow.webContents.getURL() === '')
    const win = assistant.window
    await win.webContents.executeJavaScript(`window.canvasSignature = () => {
      const canvas = document.querySelector('canvas')
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      let hash = 0
      for (const value of pixels) hash = (Math.imul(hash, 31) + value) >>> 0
      return hash
    }; undefined`)
    check('isolated character cannot invoke installation', await win.webContents.executeJavaScript('typeof window.hasarbotuUpdates === "undefined"'))
    const appearance = { scheme: 'dark', accentColor: '#15803d', characterColor: '#b9e7c8', textSize: 'large', reduceMotion: true }
    await until(() => win.webContents.executeJavaScript('document.querySelector("canvas").style.filter.includes("drop-shadow")'), 'initial appearance ready')
    const beforePalette = await win.webContents.executeJavaScript('window.canvasSignature()')
    check('trusted main frame can publish appearance', await shell.window.webContents.executeJavaScript(`window.hasarbotuAppearance.set(${JSON.stringify(appearance)})`))
    await until(() => win.webContents.executeJavaScript('document.querySelector("canvas").style.filter.includes("21, 128, 61")'), 'personalized character color')
    const afterPalette = await win.webContents.executeJavaScript('window.canvasSignature()')
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
        if (process.env.HB_CAPTURE_SCREENSHOTS === '1') { if (reduceMotion) await writeFile(join(process.env.HB_ASSISTANT_OUTPUT, `assistant-color-${characterColor.slice(1)}.png`), (await win.webContents.capturePage()).toPNG()) }
      }
    }
    check('malformed color payload is rejected', !(await shell.window.webContents.executeJavaScript(`window.hasarbotuAppearance.set(${JSON.stringify({ ...appearance, accentColor: 'url(file:///private)' })})`)))
    check('character cannot publish appearance', await win.webContents.executeJavaScript('typeof window.hasarbotuAppearance === "undefined"'))
    if (process.env.HB_CAPTURE_SCREENSHOTS === '1') { await writeFile(join(process.env.HB_ASSISTANT_OUTPUT, 'assistant-custom-appearance.png'), (await win.webContents.capturePage()).toPNG()) }
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
    check('sandbox renderer and bounded preload', surface.node === 'undefined' && surface.process === 'undefined' && surface.ready && surface.keys.sort().join(',') === 'activate,cancel,drag,menu,move,onAppearance,onGaze,onMotion,press,release')
    await win.webContents.executeJavaScript('window.motionEvents = []; window.motionOff = window.hasarbotuAssistant.onMotion(value => window.motionEvents.push(value)); undefined')
    for (const value of [null, {}, { type: 'drag', x: Infinity }, { type: 'drag', x: 2 }, { type: 'drag', x: '1' }, { type: 'unknown' }]) {
      win.webContents.send('hasarbotu:assistant-motion', value)
    }
    await win.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 80))')
    check('motion preload rejects malformed cosmetic events', await win.webContents.executeJavaScript('window.motionEvents.length === 0'))
    const feedback = ipcMain.listeners('hasarbotu:assistant-success').at(-1)
    feedback({ sender: win.webContents, senderFrame: win.webContents.mainFrame })
    feedback({ sender: shell.window.webContents, senderFrame: { url: shell.window.webContents.getURL() } })
    await win.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 80))')
    check('character and untrusted frames cannot announce saved notes', await win.webContents.executeJavaScript('window.motionEvents.length === 0 && typeof window.hasarbotuAssistantFeedback === "undefined"'))
    const beforeSuccess = await win.webContents.executeJavaScript('window.canvasSignature()')
    await shell.window.webContents.executeJavaScript('window.hasarbotuAssistantFeedback.noteSaved()')
    await until(() => win.webContents.executeJavaScript('window.motionEvents.some(value => value.type === "success")'))
    await until(() => win.webContents.executeJavaScript(`window.canvasSignature() !== ${JSON.stringify(beforeSuccess)}`))
    check('confirmed note feedback reaches the isolated renderer and changes actual character pixels', true)
    await win.webContents.executeJavaScript('window.motionEvents = []')
    const report = ipcMain.listeners('hasarbotu:assistant-feedback').at(-1)
    report({ sender: win.webContents, senderFrame: win.webContents.mainFrame }, { type: 'notification' })
    report({ sender: shell.window.webContents, senderFrame: { url: shell.window.webContents.getURL() } }, { type: 'completed' })
    await win.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 80))')
    check('isolated character and forged frames cannot publish workflow feedback', await win.webContents.executeJavaScript('window.motionEvents.length === 0'))
    await shell.window.webContents.executeJavaScript(`window.hasarbotuAssistantFeedback.activity('first', 'start'); window.hasarbotuAssistantFeedback.activity('second', 'start'); window.hasarbotuAssistantFeedback.activity('first', 'finish')`)
    await until(() => win.webContents.executeJavaScript('window.motionEvents.some(value => value.type === "working" && value.active)'))
    check('overlapping work stays active until the last real operation finishes', await win.webContents.executeJavaScript('window.motionEvents.filter(value => value.type === "working").every(value => value.active)'))
    await shell.window.webContents.executeJavaScript(`window.hasarbotuAssistantFeedback.activity('second', 'fail', 'Belge yüklenemedi. Evrak bölümünden yeniden deneyin.')`)
    await until(() => win.webContents.executeJavaScript('window.motionEvents.some(value => value.type === "error" && value.active) && document.querySelector("button").title.includes("Açıklama")'))
    const showMessage = dialog.showMessageBox
    let errorDialog
    try {
      dialog.showMessageBox = async (_owner, options) => { errorDialog = options; return { response: 0, checkboxChecked: false } }
      await win.webContents.executeJavaScript('window.hasarbotuAssistant.press(); window.hasarbotuAssistant.release()')
      await until(() => Boolean(errorDialog))
      check('clicking a failed operation opens its safe explanation without opening the shortcut panel', errorDialog.detail === 'Belge yüklenemedi. Evrak bölümünden yeniden deneyin.' && !assistant.menuWindow.isVisible())
      errorDialog = undefined
      await shell.window.webContents.executeJavaScript(`window.hasarbotuAssistantFeedback.activity('keyboard', 'start'); window.hasarbotuAssistantFeedback.activity('keyboard', 'fail', 'Görev tamamlanamadı.')`)
      await until(() => win.webContents.executeJavaScript('document.querySelector("button").title.includes("Açıklama")'))
      await win.webContents.executeJavaScript('document.querySelector("button").click()')
      await until(() => Boolean(errorDialog))
      check('keyboard activation opens the same error explanation', errorDialog.detail === 'Görev tamamlanamadı.')
    } finally { dialog.showMessageBox = showMessage }
    await shell.window.webContents.executeJavaScript('window.hasarbotuAssistantFeedback.taskCompleted(); window.hasarbotuAssistantFeedback.notificationReceived()')
    await until(() => win.webContents.executeJavaScript('window.motionEvents.some(value => value.type === "celebrate") && window.motionEvents.some(value => value.type === "notification")'))
    check('confirmed completion and new notification cross the bounded preload', true)
    await new Promise(resolve => setTimeout(resolve, 330))
    if (process.env.HB_CAPTURE_SCREENSHOTS === '1') { await writeFile(join(process.env.HB_ASSISTANT_OUTPUT, 'assistant-success.png'), (await win.webContents.capturePage()).toPNG()) }
    await until(() => win.webContents.executeJavaScript('(()=>{ const c=document.querySelector("canvas"); return c && c.getContext("2d").getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3 && v>0) })()'))
    check('upstream Mochi actually renders in sandbox canvas', true)
    const samples = await win.webContents.executeJavaScript('(' + sampleGestures.toString() + ')()')
    check('all nineteen gesture phases render without clipping at 2x physical resolution', samples.unclipped)
    check('six successive clicks select and draw six distinct reactions in the real canvas', samples.distinctTapKinds === 6 && samples.distinctTapDraws === 6)
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
    const positionPath = join(app.getPath('userData'), 'assistant-position.json')
    const readPersistedPosition = async () => {
      await until(async () => {
        try {
          const value = JSON.parse(await readFile(positionPath, 'utf8'))
          return value.x === win.getBounds().x && value.y === win.getBounds().y
        } catch (error) { if (error.code === 'ENOENT') return false; throw error }
      }, 'debounced position persisted')
      return JSON.parse(await readFile(positionPath, 'utf8'))
    }
    const saved = await readPersistedPosition()
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
      await win.webContents.executeJavaScript('window.gaze = undefined')
      await new Promise((resolve) => setTimeout(resolve, 180))
      check('stationary cursor does not keep sending duplicate gaze IPC', await win.webContents.executeJavaScript('window.gaze === undefined'))
      await win.webContents.executeJavaScript('window.gazeOff(); window.gaze = undefined')
      cursor = { x: cursor.x + 16, y: cursor.y }
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
      if (process.env.HB_CAPTURE_SCREENSHOTS === '1') { await writeFile(join(process.env.HB_ASSISTANT_OUTPUT, 'assistant-gaze-up.png'), (await win.webContents.capturePage()).toPNG()) }
      const upperEyeY = await win.webContents.executeJavaScript('window.eyeCenter("y")')
      cursor = { x: saved.x + 60, y: saved.y + 800 }
      await until(() => win.webContents.executeJavaScript(`window.eyeCenter("y") > ${upperEyeY + 12}`), 'downward gaze in canvas')
      if (process.env.HB_CAPTURE_SCREENSHOTS === '1') { await writeFile(join(process.env.HB_ASSISTANT_OUTPUT, 'assistant-gaze-down.png'), (await win.webContents.capturePage()).toPNG()) }
      check('cursor movement visibly moves Mochi eyes in the correct vertical direction', true)
      cursor = { x: saved.x + 60, y: saved.y + 60 }
      await input('press')
      cursor = { x: cursor.x - 96, y: cursor.y + 32 }
      await input('drag')
      await until(() => win.getBounds().x === saved.x - 96)
      await until(() => win.webContents.executeJavaScript('window.motionEvents.some(value => value.type === "drag" && value.x === -1)'))
      check('native dragging sends bounded direction without desktop coordinates', await win.webContents.executeJavaScript('window.motionEvents.filter(value => value.type === "drag").every(value => Object.keys(value).sort().join(",") === "type,x")'))
      await new Promise(resolve => setTimeout(resolve, 100))
      if (process.env.HB_CAPTURE_SCREENSHOTS === '1') { await writeFile(join(process.env.HB_ASSISTANT_OUTPUT, 'assistant-drag.png'), (await win.webContents.capturePage()).toPNG()) }
      await input('release')
      await until(() => win.webContents.executeJavaScript('window.motionEvents.some(value => value.type === "release")'))
      check('drag IPC moves native window and saves position', win.getBounds().x === saved.x - 96)
      Object.assign(saved, await readPersistedPosition())
      await win.webContents.executeJavaScript('window.motionEvents = []')
      await input('press')
      cursor = { x: cursor.x + 12, y: cursor.y }
      await input('release')
      await until(() => win.webContents.executeJavaScript('window.motionEvents.some(value => value.type === "edge")'))
      check('movement first observed on release sends drag before landing and then edge feedback', await win.webContents.executeJavaScript('window.motionEvents.map(value => value.type).join(",") === "drag,release,edge"'))
      Object.assign(saved, await readPersistedPosition())
    } finally { screen.getCursorScreenPoint = originalCursor }
    await win.webContents.executeJavaScript(`window.sleepClockDescriptor=Object.getOwnPropertyDescriptor(performance,'now');window.sleepClockBase=performance.now.bind(performance);Object.defineProperty(performance,'now',{configurable:true,value:()=>window.sleepClockBase()+130000});document.querySelector('#assistant').dispatchEvent(new Event('pointerleave'));undefined`)
    await until(() => win.webContents.executeJavaScript(`document.querySelector('#assistant').dataset.sleeping==='true'`),'actual assistant sleep')
    check('sleep indicator is visible, animated and inside the assistant window',await win.webContents.executeJavaScript(`(()=>{const e=document.querySelector('.assistant-sleep'),r=e.getBoundingClientRect();return getComputedStyle(e).display==='flex'&&getComputedStyle(e.firstElementChild).animationName==='assistant-sleep-float'&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()`))
    win.webContents.send('hasarbotu:assistant-gaze',{x:1,y:1})
    win.webContents.send('hasarbotu:assistant-motion',{type:'notification'})
    await win.webContents.executeJavaScript(`document.querySelector('#assistant').dispatchEvent(new Event('pointerenter'));undefined`)
    await new Promise(resolve=>setTimeout(resolve,800))
    check('sleep survives native gaze, hover and notifications',await win.webContents.executeJavaScript(`document.querySelector('#assistant').dataset.sleeping==='true'`))
    await win.webContents.executeJavaScript(`document.querySelector('#assistant').click();undefined`)
    await until(()=>win.webContents.executeJavaScript(`document.querySelector('#assistant').dataset.sleeping==='false'`),'click wakes sleeping assistant')
    check('click removes the actual sleep indicator',await win.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.assistant-sleep')).display==='none'`))
    await win.webContents.executeJavaScript(`if(window.sleepClockDescriptor)Object.defineProperty(performance,'now',window.sleepClockDescriptor);else delete performance.now;undefined`)
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
    if (process.env.HB_CAPTURE_SCREENSHOTS === '1') { await writeFile(join(process.env.HB_ASSISTANT_OUTPUT,'assistant-menu.png'),(await assistant.menuWindow.webContents.capturePage()).toPNG()) }
    await assistant.menuWindow.webContents.executeJavaScript('document.querySelector("header button").click()')
    await until(() => !assistant.menuWindow.isVisible())
    check('menu close command hides the actual panel',true)
    await win.webContents.executeJavaScript('window.motionEvents = []')
    await assistant.menuWindow.webContents.executeJavaScript('window.hasarbotuAssistantFeedback.noteSaved()')
    await until(() => win.webContents.executeJavaScript('window.motionEvents.some(value => value.type === "success")'))
    check('standalone quick-note panel also reaches cosmetic feedback', true)
    await win.webContents.executeJavaScript('document.querySelector("button").dispatchEvent(new Event("pointerenter"))')
    await new Promise(resolve => setTimeout(resolve, 1050))
    if (process.env.HB_CAPTURE_SCREENSHOTS === '1') { await writeFile(join(process.env.HB_ASSISTANT_OUTPUT, 'assistant-curious.png'), (await win.webContents.capturePage()).toPNG()) }
    await win.webContents.executeJavaScript('document.querySelector("button").dispatchEvent(new Event("pointerleave")); window.motionOff(); undefined')
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
      if (process.env.HB_CAPTURE_SCREENSHOTS === '1') { await writeFile(join(process.env.HB_ASSISTANT_OUTPUT, `assistant-${theme}.png`), (await win.webContents.capturePage()).toPNG()) }
    }
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await until(() => win.webContents.executeJavaScript('matchMedia("(prefers-reduced-motion: reduce)").matches'))
    // The media-query change event applies the neutral pose at the next render.
    await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))')
    const still = await win.webContents.executeJavaScript('window.canvasSignature()')
    await new Promise((resolve) => setTimeout(resolve, 300))
    check('reduced motion renders a still visible character', await win.webContents.executeJavaScript(`window.canvasSignature() === ${JSON.stringify(still)}`))
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
      const hiddenCanvas = await win.webContents.executeJavaScript('window.canvasSignature()')
      await new Promise((resolve) => setTimeout(resolve, 300))
      check('hidden helper stops cursor polling', hiddenCursorReads === 0)
      check('hidden helper stops drawing', await win.webContents.executeJavaScript(`window.canvasSignature() === ${JSON.stringify(hiddenCanvas)}`))
      assistant.show()
      await until(() => hiddenCursorReads > 0)
      check('showing helper restarts gaze', true)
    } finally { screen.getCursorScreenPoint = readCursor }
    check('renderer interaction has no uncaught errors', await win.webContents.executeJavaScript('window.rendererErrors.length === 0'))
    win.webContents.debugger.detach()
    // A final movement followed immediately by disposal must survive recreation.
    command({ sender: win.webContents, senderFrame: win.webContents.mainFrame }, 'left')
    Object.assign(saved, { x: win.getBounds().x, y: win.getBounds().y })
    await assistant.dispose()
    check('dispose removes IPC listeners', ipcMain.listenerCount('hasarbotu:assistant') === 0)
    check('dispose removes success feedback listener', ipcMain.listenerCount('hasarbotu:assistant-success') === 0)
    check('dispose removes workflow feedback listener', ipcMain.listenerCount('hasarbotu:assistant-feedback') === 0)
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
    await assistant?.dispose()
    await shell?.close()
    await writeFile(process.env.HB_ASSISTANT_RESULT, JSON.stringify(checks, null, 2))
    await writeFile(join(process.env.HB_ASSISTANT_OUTPUT, 'assistant-checks.json'), JSON.stringify(checks, null, 2))
    app.exit(checks.every((item) => item.pass) ? 0 : 1)
  }
})
