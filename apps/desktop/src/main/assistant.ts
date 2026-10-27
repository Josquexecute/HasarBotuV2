import { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, screen, type IpcMainEvent } from 'electron'
import { assistantAppearanceSchema, DEFAULT_ASSISTANT_APPEARANCE, idSchema } from '@hasarbotu/contracts'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ASSISTANT_SIZE, assistantEdge, assistantMenuBounds, clampAssistantPosition, isAssistantCommand, isAssistantMenuAction, parseAssistantPosition, type Point } from './assistant-policy.js'
import { createAssistantPositionStore } from './assistant-position.js'
import { createAssistantGazeTracker } from './assistant-gaze.js'
import { AssistantFeedbackState, type AssistantMotionEvent } from './assistant-feedback.js'
import { SECURE_WEB_PREFERENCES } from './security.js'
import { guardAssistantTopmost } from './assistant-topmost.js'
import { parseTouchPlayCommand, parseTouchPlayState, type TouchPlayState } from './assistant-play.js'
import { hardenSession, type DesktopShell } from './shell.js'

interface AssistantOptions {
  readonly shell: DesktopShell
  readonly assetRoot: string
  readonly userDataPath: string
  readonly quit: () => void
}

/** Separate UI windows; business operations use the existing authenticated API. */
export async function startDesktopAssistant(options: AssistantOptions) {
  const mainContents = options.shell.window.webContents
  const mainContentsId = mainContents.id
  const statePath = join(options.userDataPath, 'assistant-position.json')
  const url = `${options.shell.origin}/desktop-assistant.html`
  const menuUrl = `${options.shell.origin}/touch-assistant`
  const primary = screen.getPrimaryDisplay().workArea
  let position: Point = { x: primary.x + primary.width - ASSISTANT_SIZE - 16, y: primary.y + Math.round(primary.height / 2) }
  try {
    const saved: unknown = JSON.parse(await readFile(statePath, 'utf8'))
    const parsed = parseAssistantPosition(saved)
    if (parsed) position = parsed
    else console.warn('desktop assistant ignored invalid saved position')
  } catch (error) {
    // A first launch has no preferences; malformed/unreadable preferences are recoverable.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('desktop assistant could not read saved position')
  }
  const clamp = (point: Point) => clampAssistantPosition(point, screen.getDisplayNearestPoint(point).workArea)
  position = clamp(position)
  const window = new BrowserWindow({
    ...position, width: ASSISTANT_SIZE, height: ASSISTANT_SIZE,
    title: 'HasarBotu Yardımcı', frame: false, transparent: true, backgroundColor: '#00000000',
    show: false, alwaysOnTop: true, skipTaskbar: true, resizable: false,
    minimizable: false, maximizable: false, fullscreenable: false, hasShadow: false,
    webPreferences: {
      ...SECURE_WEB_PREFERENCES,
      // Ephemeral partition keeps business cookies and main-window zoom out of the helper.
      partition: 'hasarbotu-assistant',
      preload: fileURLToPath(new URL('../preload/assistant-preload.cjs', import.meta.url)),
    },
  })
  const readyToShow = new Promise<void>((resolve) => window.once('ready-to-show', () => resolve()))
  const stopTopmostGuard = guardAssistantTopmost(window)
  const assistantSession = window.webContents.session
  hardenSession(assistantSession)
  const denyDownload = (event: Electron.Event) => event.preventDefault()
  assistantSession.on('will-download', denyDownload)
  // This renderer may never navigate, spawn windows, or inherit a different document's IPC rights.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('will-frame-navigate', (event) => event.preventDefault())
  window.webContents.on('will-redirect', (event) => event.preventDefault())
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.webContents.setZoomFactor(1)
  void window.webContents.setVisualZoomLevelLimits(1, 1)

  const menuWindow = new BrowserWindow({ width: 420,height: 720,title: 'HasarBotu Hızlı İşlemler',show: false,frame: false,
    alwaysOnTop: true,skipTaskbar: true,resizable: false,minimizable: false,maximizable: false,fullscreenable: false,backgroundColor: '#121923',
    // Share HttpOnly authentication with the main app; the character stays isolated.
    webPreferences: { ...SECURE_WEB_PREFERENCES,session: options.shell.window.webContents.session,preload: fileURLToPath(new URL('../preload/assistant-menu-preload.cjs',import.meta.url)) },
  })
  menuWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  menuWindow.webContents.on('will-navigate',(event) => event.preventDefault())
  menuWindow.webContents.on('will-frame-navigate',(event) => event.preventDefault())
  menuWindow.webContents.on('will-redirect',(event) => event.preventDefault())
  menuWindow.webContents.on('will-attach-webview',(event) => event.preventDefault())
  menuWindow.webContents.setZoomFactor(1)
  void menuWindow.webContents.setVisualZoomLevelLimits(1,1)
  const denyMenuDownload = (event: Electron.Event, _item: Electron.DownloadItem, contents: Electron.WebContents) => {
    if (contents === menuWindow.webContents) event.preventDefault()
  }
  menuWindow.webContents.session.on('will-download', denyMenuDownload)

  let tray: Tray | undefined
  let disposed = false
  let cleanup: Promise<void> | undefined
  let quitRequested = false
  let appearance = DEFAULT_ASSISTANT_APPEARANCE
  let playState: (TouchPlayState & { version: number }) | null = null
  let playVersion = 0
  const feedback = new AssistantFeedbackState()
  const sendMotion = (value: AssistantMotionEvent) => {
    if (!disposed && !window.isDestroyed() && window.isVisible() && (!appearance.reduceMotion || value.type === 'working' || value.type === 'error')) {
      window.webContents.send('hasarbotu:assistant-motion', value)
    }
  }
  const { start: startGaze, stop: stopGaze } = createAssistantGazeTracker({
    enabled: () => !disposed && !window.isDestroyed() && window.isVisible() && !appearance.reduceMotion && !playState?.paused && !playState?.reducedMotion,
    cursor: () => screen.getCursorScreenPoint(),
    position: () => position,
    send: gaze => window.webContents.send('hasarbotu:assistant-gaze', gaze),
  })
  window.on('show', startGaze)
  window.on('hide', stopGaze)
  let drag: { cursor: Point; origin: Point; moved: boolean; startedAt: number } | undefined
  let menuOpen = false
  let menuReady: Promise<void> | undefined
  const positionStore = createAssistantPositionStore(statePath, () => console.warn('desktop assistant could not save position'))
  const persist = () => positionStore.save(position)
  const move = (point: Point) => {
    const next = clamp(point)
    if (next.x === position.x && next.y === position.y) return
    position = next
    window.setPosition(position.x, position.y, false)
  }
  const showMain = (route?: string) => {
    const main = options.shell.window
    if (main.isDestroyed()) return
    if (main.isMinimized()) main.restore()
    main.show()
    main.focus()
    // Native actions construct routes; renderers can supply only a validated case identity.
    if (route && main.webContents.getURL() !== `${options.shell.origin}${route}`) {
      void main.loadURL(`${options.shell.origin}${route}`).catch(() => {
        console.error('desktop assistant could not open the requested page')
      })
    }
  }
  const show = () => {
    move(position)
    window.showInactive()
    // Restore initial order; the native foreground hook maintains it thereafter.
    window.setAlwaysOnTop(true, 'pop-up-menu')
    sendMotion({ type: 'working', active: feedback.working })
    sendMotion({ type: 'error', active: Boolean(feedback.error) })
    sendMotion({ type: 'edge', x: assistantEdge(position, screen.getDisplayNearestPoint(position).workArea) })
  }
  const actions = {
    open: () => showMain(),
    note: () => openMenu(),
    cases: () => openMenu(),notifications: () => showMain('/bildirimler'),settings: () => showMain('/ayarlar'),
    hide: () => { drag = undefined;window.hide() },
    reset: () => {
      const area = screen.getPrimaryDisplay().workArea
      move({ x: area.x + area.width - ASSISTANT_SIZE - 16, y: area.y + Math.round(area.height / 2) })
      persist()
      show()
    },
    quit: options.quit,
  }
  const menu = Menu.buildFromTemplate([
    { label: 'HasarBotu’yu aç',click: actions.open },{ type: 'separator' },
    { label: 'Hızlı not',click: actions.note },{ label: 'Dosyalar',click: actions.cases },
    { label: 'Bildirimler',click: actions.notifications },{ label: 'Ayarlar',click: actions.settings },
    { type: 'separator' },{ label: 'Yardımcıyı göster',click: show },
    { label: 'Yardımcıyı gizle',click: actions.hide },{ label: 'Konumu sıfırla',click: actions.reset },
    { type: 'separator' },
    { label: 'HasarBotu’dan çık', click: actions.quit },
  ])
  const openMenu = () => {
    drag = undefined
    sendMotion({ type: 'release' })
    if (menuOpen) return
    menuOpen = true
    menuWindow.setBounds(assistantMenuBounds(position,screen.getDisplayNearestPoint(position).workArea))
    // Keep the React workspace out of memory until the first actual menu request.
    menuReady ??= menuWindow.loadURL(menuUrl).then(() => {
    }).catch(error => { menuReady = undefined; throw error })
    void menuReady.then(() => {
      if (disposed || !menuOpen) return
      menuWindow.show()
      menuWindow.setAlwaysOnTop(true,'pop-up-menu')
      menuWindow.focus()
    }).catch(() => {
      if (disposed) return
      menuOpen = false
      console.error('desktop assistant could not load the shortcut panel')
      dialog.showErrorBox('HasarBotu Hızlı İşlemler', 'Panel açılamadı. Yardımcıya tekrar tıklayarak yeniden deneyin.')
    })
  }
  const hideMenu = () => { menuOpen = false;if (!menuWindow.isDestroyed()) menuWindow.hide() }
  const handleMenuAction = (event: IpcMainEvent,action: unknown,caseId?: unknown) => {
    if (disposed || event.sender !== menuWindow.webContents || event.senderFrame !== menuWindow.webContents.mainFrame
      || event.senderFrame?.url !== menuUrl || !isAssistantMenuAction(action)) return
    if ((action === 'open' || action === 'notifications') && caseId !== undefined) {
      const parsed = idSchema.safeParse(caseId)
      if (!parsed.success) return
      hideMenu()
      showMain(action === 'open' ? `/dosyalar/${encodeURIComponent(parsed.data)}` : `/bildirimler?caseId=${encodeURIComponent(parsed.data)}`)
      return
    }
    hideMenu()
    if (action === 'close') return
    actions[action]()
  }
  menuWindow.on('blur',hideMenu)
  const trustedPlayUi = (event: Electron.IpcMainInvokeEvent) => {
    const main = options.shell.window.webContents
    return !disposed && (event.sender === main && event.senderFrame === main.mainFrame && event.senderFrame?.url.startsWith(options.shell.origin + '/')
      || event.sender === menuWindow.webContents && event.senderFrame === menuWindow.webContents.mainFrame && event.senderFrame?.url === menuUrl)
  }
  const handlePlayControl = (event: Electron.IpcMainInvokeEvent, value: unknown) => {
    const command = parseTouchPlayCommand(value)
    if (!trustedPlayUi(event) || !command || window.isDestroyed() || command.type === 'play' && (appearance.reduceMotion || playState?.reducedMotion)) return false
    if ((command.type === 'play' || command.type === 'wake') && !window.isVisible()) show()
    window.webContents.send('hasarbotu:touch-control', command)
    return true
  }
  const handlePlayState = (event: IpcMainEvent, value: unknown) => {
    if (disposed || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame?.url !== url) return
    const parsed = parseTouchPlayState(value)
    if (!parsed) return
    if (playState && Object.entries(parsed).every(([key, entry]) => playState?.[key as keyof TouchPlayState] === entry)) return
    playState = { ...parsed, version: ++playVersion }
    if (parsed.paused || parsed.reducedMotion) stopGaze()
    else if (window.isVisible()) startGaze()
    for (const contents of [mainContents, menuWindow.webContents]) {
      if (!contents.isDestroyed() && contents.getURL()) contents.send('hasarbotu:touch-state', playState)
    }
  }
  const handleAppearance = (event: Electron.IpcMainInvokeEvent, value: unknown) => {
    const main = options.shell.window.webContents
    const trustedMain = event.sender === main && event.senderFrame === main.mainFrame && event.senderFrame?.url.startsWith(options.shell.origin + '/')
    const parsed = assistantAppearanceSchema.safeParse(value)
    // The main settings model owns live previews; a stale menu refresh must not
    // republish saved preferences over an unsaved palette selection.
    if (disposed || !trustedMain || !parsed.success) return false
    appearance = parsed.data
    if (appearance.reduceMotion) stopGaze()
    else if (window.isVisible()) startGaze()
    window.webContents.send('hasarbotu:assistant-appearance', appearance)
    sendMotion({ type: 'working', active: feedback.working })
    sendMotion({ type: 'error', active: Boolean(feedback.error) })
    return true
  }
  const handleSuccess = (event: IpcMainEvent) => {
    if (disposed) return
    const main = options.shell.window.webContents
    const trustedMain = event.sender === main && event.senderFrame === main.mainFrame && event.senderFrame?.url.startsWith(options.shell.origin + '/')
    const trustedMenu = event.sender === menuWindow.webContents && event.senderFrame === menuWindow.webContents.mainFrame && event.senderFrame?.url === menuUrl
    if (trustedMain || trustedMenu) sendMotion({ type: 'success' })
  }
  const handleFeedback = (event: IpcMainEvent, value: unknown) => {
    if (disposed) return
    const main = options.shell.window.webContents
    const trustedMain = event.sender === main && event.senderFrame === main.mainFrame && event.senderFrame?.url.startsWith(options.shell.origin + '/')
    const trustedMenu = event.sender === menuWindow.webContents && event.senderFrame === menuWindow.webContents.mainFrame && event.senderFrame?.url === menuUrl
    if (trustedMain || trustedMenu) for (const motion of feedback.accept(event.sender.id, value)) sendMotion(motion)
  }
  const clearMainFeedback = () => { for (const motion of feedback.clear(mainContentsId)) sendMotion(motion) }
  const clearMenuFeedback = () => { for (const motion of feedback.clear(menuWindow.webContents.id)) sendMotion(motion) }
  const mainNavigation = (_event: Electron.Event, _url: string, isInPlace: boolean, isMainFrame: boolean) => { if (isMainFrame && !isInPlace) clearMainFeedback() }
  const menuNavigation = (_event: Electron.Event, _url: string, isInPlace: boolean, isMainFrame: boolean) => { if (isMainFrame && !isInPlace) clearMenuFeedback() }
  mainContents.on('did-start-navigation', mainNavigation)
  menuWindow.webContents.on('did-start-navigation', menuNavigation)
  mainContents.on('render-process-gone', clearMainFeedback)
  menuWindow.webContents.on('render-process-gone', clearMenuFeedback)
  menuWindow.on('close',(event) => { event.preventDefault();hideMenu() })
  const activate = () => {
    if (!feedback.error) { openMenu(); return }
    const detail = feedback.error
    feedback.error = undefined
    sendMotion({ type: 'error', active: false })
    showMain()
    void dialog.showMessageBox(options.shell.window, { type: 'warning', title: 'HasarBotu · İşlem tamamlanamadı', message: 'Son işlem tamamlanamadı', detail, buttons: ['Tamam'] })
  }
  const updateDrag = () => {
    if (!drag) return
    const cursor = screen.getCursorScreenPoint()
    const dx = cursor.x - drag.cursor.x
    const dy = cursor.y - drag.cursor.y
    drag.moved ||= Math.hypot(dx, dy) >= 5
    if (drag.moved) {
      const previous = position
      move({ x: drag.origin.x + dx, y: drag.origin.y + dy })
      if (position.x !== previous.x || position.y !== previous.y) {
        sendMotion({ type: 'drag', x: Math.max(-1, Math.min(1, (position.x - previous.x) / 24)),
          dx: position.x - previous.x, dy: position.y - previous.y, elapsed: performance.now() - drag.startedAt })
      }
    }
  }
  const handleCommand = (event: IpcMainEvent, command: unknown) => {
    if (disposed || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
      || event.senderFrame?.url !== url || !isAssistantCommand(command)) return
    if (command === 'press') {
      if (!menuOpen) drag = { cursor: screen.getCursorScreenPoint(), origin: position, moved: false, startedAt: performance.now() }
    } else if (command === 'drag') updateDrag()
    else if (command === 'release') {
      if (!drag) { sendMotion({ type: 'release' }); return }
      updateDrag()
      const moved = drag.moved
      drag = undefined
      sendMotion({ type: 'release' })
      if (moved) {
        persist()
        sendMotion({ type: 'edge', x: assistantEdge(position, screen.getDisplayNearestPoint(position).workArea) })
      } else activate()
    } else if (command === 'cancel') {
      if (drag?.moved) persist()
      drag = undefined
      sendMotion({ type: 'release' })
    } else if (command === 'menu') openMenu()
    else if (command === 'activate') activate()
    else {
      move({ x: position.x + (command === 'left' ? -16 : command === 'right' ? 16 : 0),
        y: position.y + (command === 'up' ? -16 : command === 'down' ? 16 : 0) })
      persist()
      sendMotion({ type: 'edge', x: assistantEdge(position, screen.getDisplayNearestPoint(position).workArea) })
    }
  }
  const onDisplayChange = () => { drag = undefined;sendMotion({ type: 'release' });hideMenu();move(position);persist() }
  const dispose = () => {
    if (disposed) return cleanup ?? Promise.resolve()
    disposed = true
    persist()
    cleanup = positionStore.flush().catch(() => {
      console.warn('desktop assistant could not save final position')
    }).finally(() => { app.removeListener('before-quit', beforeQuit) })
    stopGaze()
    stopTopmostGuard()
    assistantSession.removeListener('will-download', denyDownload)
    menuWindow.webContents.session.removeListener('will-download', denyMenuDownload)
    ipcMain.removeListener('hasarbotu:assistant', handleCommand)
    ipcMain.removeListener('hasarbotu:assistant-menu',handleMenuAction)
    ipcMain.removeListener('hasarbotu:assistant-success', handleSuccess)
    ipcMain.removeListener('hasarbotu:assistant-feedback', handleFeedback)
    mainContents.removeListener('did-start-navigation', mainNavigation)
    menuWindow.webContents.removeListener('did-start-navigation', menuNavigation)
    mainContents.removeListener('render-process-gone', clearMainFeedback)
    menuWindow.webContents.removeListener('render-process-gone', clearMenuFeedback)
    ipcMain.removeHandler('hasarbotu:assistant-appearance')
    ipcMain.removeHandler('hasarbotu:touch-control')
    ipcMain.removeHandler('hasarbotu:touch-state')
    ipcMain.removeListener('hasarbotu:touch-state', handlePlayState)
    screen.removeListener('display-added', onDisplayChange)
    screen.removeListener('display-removed', onDisplayChange)
    screen.removeListener('display-metrics-changed', onDisplayChange)
    menu.closePopup()
    options.shell.window.removeListener('closed', dispose)
    tray?.destroy()
    if (!menuWindow.isDestroyed()) menuWindow.destroy()
    if (!window.isDestroyed()) window.destroy()
    return cleanup
  }
  const beforeQuit = (event: Electron.Event) => {
    event.preventDefault()
    if (quitRequested) return
    quitRequested = true
    void dispose().then(() => app.quit())
  }
  window.on('closed', dispose)
  menuWindow.on('closed',dispose)
  // Alt+F4 hides only the helper; the tray remains available to recover it.
  window.on('close', (event) => { event.preventDefault(); drag = undefined; window.hide() })
  options.shell.window.once('closed', dispose)
  // Hide-on-close helper windows must not cancel an explicit app quit/update.
  app.on('before-quit', beforeQuit)
  ipcMain.on('hasarbotu:assistant', handleCommand)
  ipcMain.on('hasarbotu:assistant-menu',handleMenuAction)
  ipcMain.on('hasarbotu:assistant-success', handleSuccess)
  ipcMain.on('hasarbotu:assistant-feedback', handleFeedback)
  ipcMain.handle('hasarbotu:assistant-appearance', handleAppearance)
  ipcMain.handle('hasarbotu:touch-control', handlePlayControl)
  ipcMain.handle('hasarbotu:touch-state', event => trustedPlayUi(event) ? playState : null)
  ipcMain.on('hasarbotu:touch-state', handlePlayState)
  screen.on('display-added', onDisplayChange)
  screen.on('display-removed', onDisplayChange)
  screen.on('display-metrics-changed', onDisplayChange)
  try {
    const icon = nativeImage.createFromPath(join(options.assetRoot, 'brand', 'logo-mark.png')).resize({ width: 20, height: 20 })
    if (icon.isEmpty()) throw new Error('desktop assistant tray icon missing')
    tray = new Tray(icon)
    tray.setToolTip('HasarBotu · Yardımcı')
    tray.setContextMenu(menu)
    tray.on('double-click', () => showMain())
    await window.loadURL(url)
    await readyToShow
    window.webContents.send('hasarbotu:assistant-appearance', appearance)
    options.shell.window.webContents.send('hasarbotu:appearance-ready')
    show()
  } catch (error) { await dispose(); throw error }
  return { window, menu, menuWindow, show, dispose }
}
