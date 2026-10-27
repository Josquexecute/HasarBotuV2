import { seedTestAssistantPosition } from './test-display.mjs'
import { app, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startDesktopShell } from '../../dist/main/shell.js'
import { startDesktopAssistant } from '../../dist/main/assistant.js'
import { checkPlayRendering, checkGazeRendering } from './assistant-play-checks.mjs'

app.enableSandbox()
app.on('window-all-closed', () => {})
const checks = [], output = process.env.HB_PLAY_OUTPUT
const check = (name, pass) => { checks.push({ name, pass: Boolean(pass) }); if (!pass) throw new Error(name) }
const wait = async (predicate, label = 'reaction') => {
  const end = Date.now() + 8000
  while (!await predicate()) { if (Date.now() >= end) throw new Error(`Native ${label} condition timed out`); await new Promise(done => setTimeout(done, 30)) }
}
void app.whenReady().then(async () => {
  let shell, assistant, pixels, gaze
  try {
    const assetRoot = process.env.HB_PLAY_ASSETS
    shell = await startDesktopShell({ apiOrigin: 'http://127.0.0.1:1', assetRoot, userDataPath: app.getPath('userData'), show: false })
    seedTestAssistantPosition()
    assistant = await startDesktopAssistant({ shell, assetRoot, userDataPath: app.getPath('userData'), quit: () => app.quit() })
    const character = code => assistant.window.webContents.executeJavaScript(code)
    const main = code => shell.window.webContents.executeJavaScript(code)
    const state = () => main('window.hasarbotuTouch.getState()')
    const control = command => main(`window.hasarbotuTouch.control(${JSON.stringify(command)})`)
    await wait(async () => Boolean(await state()))
    check('isolated character has no user control surface', await character('typeof window.hasarbotuTouch === "undefined"'))
    const untrusted = ipcMain._invokeHandlers.get('hasarbotu:touch-control')
    check('isolated character cannot invoke UI reaction commands', untrusted({ sender: assistant.window.webContents, senderFrame: assistant.window.webContents.mainFrame }, { type: 'play', id: 'magic' }) === false)
    check('paths and extra fields cannot cross the cosmetic boundary', !await control({ type: 'play', id: '../private' }) && !await control({ type: 'play', id: 'magic', url: 'https://example.test' }))
    const version = (await state()).version
    ipcMain.emit('hasarbotu:touch-state', { sender: shell.window.webContents, senderFrame: shell.window.webContents.mainFrame }, { mood: 'angry', reaction: 'steam', paused: false, reducedMotion: false, sleeping: false })
    check('UI cannot forge character mood or reaction state', (await state()).version === version)
    await character(`(() => { const c = document.querySelector('canvas').getContext('2d'), clear = c.clearRect.bind(c); window.paintCount = 0; c.clearRect = (...args) => { window.paintCount++; clear(...args) } })()`)
    for (const id of ['foam-bat', 'enough-sign', 'reading', 'magic', 'mini-disco']) {
      check(`${id}: trusted command accepted`, await control({ type: 'play', id }))
      await wait(async () => (await state()).reaction === id)
      await character('new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))')
      check(`${id}: actual renderer reports the selected reaction`, await character(`document.querySelector('button').dataset.reaction === ${JSON.stringify(id)}`))
    }
    const paints = await character('window.paintCount')
    await character('new Promise(done => setTimeout(done, 350))')
    check('accessories animate while the original engine is settled', await character(`window.paintCount > ${paints} + 5`))
    await character(`(async () => {
      const { BotEngine } = await import('/vendor/coucou/mochi/engine.js')
      const original = BotEngine.prototype.update
      window.gazeProof = { frames: [], original }
      BotEngine.prototype.update = function(dt) { original.call(this, dt); window.gazeProof.frames.push({ x: this.lookX, y: this.lookY, yaw: this.yaw, pitch: this.pitch }); if (window.gazeProof.frames.length > 600) window.gazeProof.frames.shift() }
    })()`)
    const send = assistant.window.webContents.send.bind(assistant.window.webContents)
    assistant.window.webContents.send = (channel, ...args) => { if (channel !== 'hasarbotu:assistant-gaze') send(channel, ...args) }
    try {
      await control({ type: 'play', id: 'reading' })
      await wait(async () => (await state()).reaction === 'reading')
      send('hasarbotu:assistant-gaze', { x: 1, y: -1 })
      await character('new Promise(done => setTimeout(done, 300))')
      await character('window.gazeProof.frames.length = 0')
      send('hasarbotu:assistant-gaze', { x: -.9, y: .7 })
      await character('new Promise(done => setTimeout(done, 450))')
      check('live reading ignores cursor IPC throughout its body and eye animation', await character('window.gazeProof.frames.length > 8 && window.gazeProof.frames.every(f => f.x === 0 && f.y === 0)'))
      await control({ type: 'play', id: 'grin' })
      await wait(async () => (await state()).reaction === 'grin')
      await character('window.gazeProof.frames.length = 0; new Promise(done => setTimeout(done, 400))')
      check('interrupting a scene keeps the gaze suspended without an intermediate cursor frame', await character('window.gazeProof.frames.length > 8 && window.gazeProof.frames.every(f => f.x === 0 && f.y === 0)'))
      await wait(async () => (await state()).reaction === null)
      await wait(() => character('window.gazeProof.frames.at(-1)?.x === -.9 && window.gazeProof.frames.at(-1)?.y === -.7 && Math.abs(window.gazeProof.frames.at(-1).yaw + .558) < .04 && Math.abs(window.gazeProof.frames.at(-1).pitch + .35) < .04'))
      check('the final frame resumes the latest cursor without a fresh IPC event', await character('Math.abs(window.gazeProof.frames.at(-1).yaw + .558) < .04 && Math.abs(window.gazeProof.frames.at(-1).pitch + .35) < .04'))
      check('live gaze handoffs have no yaw or pitch jump', await character('window.gazeProof.frames.every((f,i,a) => !i || Math.abs(f.yaw-a[i-1].yaw) < .15 && Math.abs(f.pitch-a[i-1].pitch) < .15)'))
    } finally {
      assistant.window.webContents.send = send
      await character(`(async () => { const { BotEngine } = await import('/vendor/coucou/mochi/engine.js'); BotEngine.prototype.update = window.gazeProof.original })()`)
    }
    await control({ type: 'pause' }); await wait(async () => (await state()).paused)
    const pausedPaints = await character('window.paintCount')
    await character('new Promise(done => setTimeout(done, 250))')
    check('pause stops all RAF work and scene drawing', await character(`window.paintCount === ${pausedPaints}`))
    await control({ type: 'play', id: 'coffee-break' }); await wait(async () => (await state()).reaction === 'coffee-break')
    check('explicit play resumes paused reactions', !(await state()).paused)
    await control({ type: 'calm' }); await wait(async () => (await state()).mood === 'happy')
    check('calm takes effect in real native state', (await state()).mood === 'happy')
    await control({ type: 'stop' }); await wait(async () => (await state()).reaction === null)
    await control({ type: 'sleep' }); await wait(async () => (await state()).sleeping)
    check('sleep is visible in the original assistant', await character('document.querySelector("button").dataset.sleeping === "true"'))
    await control({ type: 'wake' }); await wait(async () => !(await state()).sleeping, 'wake')
    check('wake reaches actual renderer state', !(await state()).sleeping)
    const appearance = { scheme: 'system', accentColor: '#635bff', characterColor: '#111111', eyeColor: '#22cc88', reduceMotion: true, textSize: 'normal' }
    check('personal reduced-motion preferences are accepted', await main(`window.hasarbotuAppearance.set(${JSON.stringify(appearance)})`))
    await wait(async () => (await state()).reducedMotion, 'reduced motion')
    check('reduced motion rejects manual effects and preserves personal eyes', !await control({ type: 'play', id: 'steam' }) && await character('document.querySelector("button").dataset.reducedMotion === "true"'))
    appearance.reduceMotion = false
    await main(`window.hasarbotuAppearance.set(${JSON.stringify(appearance)})`)
    await wait(async () => !(await state()).reducedMotion, 'restore motion')
    gaze = await character(`(${checkGazeRendering.toString()})()`)
    check('all 61 scenes render cursor-independent eyes and release gaze only after completion', gaze.passed && gaze.reactions === 61)
    pixels = await character(`(${checkPlayRendering.toString()})(${process.env.HB_RENDER_REACTION_ARTWORK === '1'})`)
    for (const artwork of pixels.artwork) await writeFile(join(output, artwork.name), Buffer.from(artwork.data, 'base64'))
    delete pixels.artwork
    check('61 different animations preserve geometry, skin, eyes and halo at both pixel ratios', pixels.passed && pixels.uniqueAnimations === 61)
    shell.window.show(); shell.window.focus()
    await character('window.hasarbotuAssistant.menu()')
    await wait(() => assistant.menuWindow.webContents.executeJavaScript('!!document.querySelector(".touch-play-controls")'))
    const menu = code => assistant.menuWindow.webContents.executeJavaScript(code)
    await menu('document.querySelector(".touch-play-controls").open = true')
    await wait(() => menu('!document.querySelector(".touch-play-controls select").disabled'))
    check('real menu offers all 61 reactions and random selection', await menu('document.querySelectorAll(".touch-play-controls option").length === 62'))
    check('menu is visible before choosing a reaction', assistant.menuWindow.isVisible())
    await menu(`(() => { const s = document.querySelector('.touch-play-controls select'); s.value = 'magic'; s.dispatchEvent(new Event('change', { bubbles: true })); [...document.querySelectorAll('.touch-play-controls button')].find(b => b.textContent === 'Oynat').click() })()`)
    await wait(async () => (await state()).reaction === 'magic')
    check('real menu plays effects without closing or stealing focus', assistant.menuWindow.isVisible())
    check('expanded controls fit the 420px menu', await menu('document.body.scrollWidth <= innerWidth && document.querySelector("footer").getBoundingClientRect().bottom <= innerHeight'))
    await control({ type: 'stop' })
  } catch (error) {
    checks.push({ name: error.message, pass: false })
    if (shell && assistant) {
      const state = await shell.window.webContents.executeJavaScript('window.hasarbotuTouch.getState()')
      const dataset = await assistant.window.webContents.executeJavaScript('({...document.querySelector("button").dataset})')
      await writeFile(join(output, 'play-diagnostics.json'), JSON.stringify({ state, dataset }))
    }
  }
  finally {
    await assistant?.dispose(); await shell?.close()
    check('cosmetic IPC listeners are removed on shutdown', ipcMain.listenerCount('hasarbotu:touch-state') === 0 && !ipcMain._invokeHandlers.has('hasarbotu:touch-control') && !ipcMain._invokeHandlers.has('hasarbotu:touch-state'))
    await writeFile(join(output, 'play-native-proof.json'), JSON.stringify({ passed: checks.every(item => item.pass), checks, pixels, gaze }, null, 2))
    app.exit(checks.every(item => item.pass) ? 0 : 1)
  }
})
