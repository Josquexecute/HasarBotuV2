import { app, BrowserWindow, screen } from 'electron'
import { createInterface } from 'node:readline'
import { createConnection } from 'node:net'
import { once } from 'node:events'

// A separate process is essential: production deliberately ignores its own panels.
app.on('window-all-closed', () => {})
void app.whenReady().then(async () => {
const connection = createConnection(Number(process.env.HB_FOREGROUND_PORT), '127.0.0.1')
await once(connection, 'connect')
const bounds = JSON.parse(process.env.HB_FOREGROUND_BOUNDS)
const window = new BrowserWindow({ ...bounds, show: false, webPreferences: { sandbox: true, nodeIntegration: false } })
await window.loadURL('data:text/html,' + encodeURIComponent('<title>Touch synthetic video fixture</title><canvas width="320" height="180"></canvas><video muted autoplay></video><script>const canvas=document.querySelector("canvas");canvas.getContext("2d").fillRect(0,0,320,180);document.querySelector("video").srcObject=canvas.captureStream(1)</script>'))
const report = () => connection.write(JSON.stringify({ handle: window.getNativeWindowHandle().readBigUInt64LE().toString(), bounds: window.getBounds(), fullScreen: window.isFullScreen(), visible: window.isVisible(), display: screen.getDisplayMatching(window.getBounds()).id }) + '\n')
window.show(); window.focus(); report()
for await (const line of createInterface({ input: connection })) {
  try {
    const command = JSON.parse(line)
    if (command.type === 'fullscreen') window.setFullScreen(command.value)
    else if (command.type === 'bounds') window.setBounds(command.value)
    else if (command.type === 'cover') window.setAlwaysOnTop(command.value, 'pop-up-menu')
    else if (command.type === 'video') await window.webContents.executeJavaScript('document.querySelector("video").requestFullscreen()', true)
    else if (command.type === 'quit') break
    window.focus()
    report()
  } catch (error) { connection.write(JSON.stringify({ error: error.message }) + '\n') }
}
window.destroy()
app.exit()
}).catch(error => { console.error(error); app.exit(1) })
