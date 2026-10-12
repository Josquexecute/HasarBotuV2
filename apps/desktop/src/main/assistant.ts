import { BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen, type IpcMainEvent } from 'electron'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ASSISTANT_SIZE, assistantGaze, assistantMenuBounds, clampAssistantPosition, isAssistantCommand, isAssistantMenuAction, parseAssistantPosition, type Point } from './assistant-policy.js'
import { SECURE_WEB_PREFERENCES } from './security.js'
import { hardenSession, type DesktopShell } from './shell.js'

interface AssistantOptions {
  readonly shell: DesktopShell
  readonly assetRoot: string
  readonly userDataPath: string
  readonly quit: () => void
}

/** A separate, narrowly privileged UI window; business operations still use the main app/API. */
export async function startDesktopAssistant(options: AssistantOptions) {
  const statePath = join(options.userDataPath, 'assistant-position.json')
  const url = `${options.shell.origin}/desktop-assistant.html`
  const menuUrl = `${options.shell.origin}/desktop-assistant-menu.html`
  const primary = screen.getPrimaryDisplay().workArea
  let position: Point = { x: primary.x + primary.width - ASSISTANT_SIZE - 16, y: primary.y + Math.round(primary.height / 2) }
  try {
    const saved: unknown = JSON.parse(readFileSync(statePath, 'utf8'))
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

  const menuWindow = new BrowserWindow({ width: 360,height: 366,title: 'HasarBotu Hızlı İşlemler',show: false,frame: false,
    alwaysOnTop: true,skipTaskbar: true,resizable: false,minimizable: false,maximizable: false,fullscreenable: false,backgroundColor: '#121923',
    webPreferences: { ...SECURE_WEB_PREFERENCES,partition: 'hasarbotu-assistant',preload: fileURLToPath(new URL('../preload/assistant-menu-preload.cjs',import.meta.url)) },
  })
  menuWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  menuWindow.webContents.on('will-navigate',(event) => event.preventDefault())
  menuWindow.webContents.on('will-frame-navigate',(event) => event.preventDefault())
  menuWindow.webContents.on('will-redirect',(event) => event.preventDefault())
  menuWindow.webContents.on('will-attach-webview',(event) => event.preventDefault())
  menuWindow.webContents.setZoomFactor(1)
  void menuWindow.webContents.setVisualZoomLevelLimits(1,1)

  let tray: Tray | undefined
  let disposed = false
  let gazeTimer: ReturnType<typeof setInterval> | undefined
  const stopGaze = () => {
    clearInterval(gazeTimer)
    gazeTimer = undefined
  }
  const startGaze = () => {
    stopGaze()
    gazeTimer = setInterval(() => {
      if (disposed || window.isDestroyed() || !window.isVisible()) return
      window.webContents.send('hasarbotu:assistant-gaze', assistantGaze(screen.getCursorScreenPoint(), position))
    }, 80)
  }
  window.on('show', startGaze)
  window.on('hide', stopGaze)
  let drag: { cursor: Point; origin: Point; moved: boolean } | undefined
  let menuOpen = false
  const persist = () => {
    try {
      writeFileSync(`${statePath}.tmp`, JSON.stringify(position), 'utf8')
      renameSync(`${statePath}.tmp`, statePath)
    } catch { console.warn('desktop assistant could not save position') }
  }
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
    // Only native menu closures supply these constant routes; renderers cannot supply a URL.
    if (route && main.webContents.getURL() !== `${options.shell.origin}${route}`) {
      void main.loadURL(`${options.shell.origin}${route}`).catch(() => {
        console.error('desktop assistant could not open the requested page')
      })
    }
  }
  const show = () => {
    move(position)
    window.showInactive()
    // Electron's default floating level moves behind the Windows taskbar, which
    // can drop WS_EX_TOPMOST. Keep this small work-area-clamped control above it.
    window.setAlwaysOnTop(true, 'pop-up-menu')
  }
  const actions = {
    open: () => showMain(),
    note: () => {
      showMain()
      const main = options.shell.window
      if (main.isDestroyed() || !main.webContents.getURL().startsWith(`${options.shell.origin}/`)) return
      // Constant DOM notification preserves the current route and selected case.
      void main.webContents.executeJavaScript("window.dispatchEvent(new Event('hasarbotu:quick-note'))").catch(() => {
        console.error('desktop assistant could not open quick note')
      })
    },
    cases: () => showMain('/dosyalar'),notifications: () => showMain('/bildirimler'),settings: () => showMain('/ayarlar'),
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
    if (menuOpen) return
    menuOpen = true
    menuWindow.setBounds(assistantMenuBounds(position,screen.getDisplayNearestPoint(position).workArea))
    menuWindow.show()
    menuWindow.setAlwaysOnTop(true,'pop-up-menu')
    menuWindow.focus()
  }
  const hideMenu = () => { menuOpen = false;if (!menuWindow.isDestroyed()) menuWindow.hide() }
  const handleMenuAction = (event: IpcMainEvent,action: unknown) => {
    if (disposed || event.sender !== menuWindow.webContents || event.senderFrame !== menuWindow.webContents.mainFrame
      || event.senderFrame?.url !== menuUrl || !isAssistantMenuAction(action)) return
    hideMenu()
    if (action === 'close') return
    actions[action]()
  }
  menuWindow.on('blur',hideMenu)
  menuWindow.on('close',(event) => { event.preventDefault();hideMenu() })
  const updateDrag = () => {
    if (!drag) return
    const cursor = screen.getCursorScreenPoint()
    const dx = cursor.x - drag.cursor.x
    const dy = cursor.y - drag.cursor.y
    drag.moved ||= Math.hypot(dx, dy) >= 5
    if (drag.moved) move({ x: drag.origin.x + dx, y: drag.origin.y + dy })
  }
  const handleCommand = (event: IpcMainEvent, command: unknown) => {
    if (disposed || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
      || event.senderFrame?.url !== url || !isAssistantCommand(command)) return
    if (command === 'press') {
      if (!menuOpen) drag = { cursor: screen.getCursorScreenPoint(), origin: position, moved: false }
    } else if (command === 'drag') updateDrag()
    else if (command === 'release') {
      if (!drag) return
      updateDrag()
      const moved = drag.moved
      drag = undefined
      if (moved) persist()
      else openMenu()
    } else if (command === 'cancel') {
      if (drag?.moved) persist()
      drag = undefined
    } else if (command === 'menu') openMenu()
    else {
      move({ x: position.x + (command === 'left' ? -16 : command === 'right' ? 16 : 0),
        y: position.y + (command === 'up' ? -16 : command === 'down' ? 16 : 0) })
      persist()
    }
  }
  const onDisplayChange = () => { drag = undefined;hideMenu();move(position);persist() }
  const dispose = () => {
    if (disposed) return
    disposed = true
    stopGaze()
    assistantSession.removeListener('will-download', denyDownload)
    ipcMain.removeListener('hasarbotu:assistant', handleCommand)
    ipcMain.removeListener('hasarbotu:assistant-menu',handleMenuAction)
    screen.removeListener('display-added', onDisplayChange)
    screen.removeListener('display-removed', onDisplayChange)
    screen.removeListener('display-metrics-changed', onDisplayChange)
    menu.closePopup()
    options.shell.window.removeListener('closed', dispose)
    tray?.destroy()
    if (!menuWindow.isDestroyed()) menuWindow.destroy()
    if (!window.isDestroyed()) window.destroy()
  }
  window.on('closed', dispose)
  menuWindow.on('closed',dispose)
  // Alt+F4 hides only the helper; the tray remains available to recover it.
  window.on('close', (event) => { event.preventDefault(); drag = undefined; window.hide() })
  options.shell.window.once('closed', dispose)
  ipcMain.on('hasarbotu:assistant', handleCommand)
  ipcMain.on('hasarbotu:assistant-menu',handleMenuAction)
  screen.on('display-added', onDisplayChange)
  screen.on('display-removed', onDisplayChange)
  screen.on('display-metrics-changed', onDisplayChange)
  try {
    const icon = nativeImage.createFromPath(join(options.assetRoot, 'brand', 'logo-mark-dark.png')).resize({ width: 20, height: 20 })
    if (icon.isEmpty()) throw new Error('desktop assistant tray icon missing')
    tray = new Tray(icon)
    tray.setToolTip('HasarBotu · Yardımcı')
    tray.setContextMenu(menu)
    tray.on('double-click', () => showMain())
    await Promise.all([window.loadURL(url),menuWindow.loadURL(menuUrl)])
    await readyToShow
    show()
  } catch (error) { dispose(); throw error }
  return { window, menu, menuWindow, show, dispose }
}
