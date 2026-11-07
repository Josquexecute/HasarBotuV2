import { chromium } from '@playwright/test'
import { createConnection } from 'node:net'
import { once } from 'node:events'
import { createInterface } from 'node:readline'

const connection = createConnection(Number(process.env.HB_FOREGROUND_PORT), '127.0.0.1')
await once(connection, 'connect')
const bounds = JSON.parse(process.env.HB_FOREGROUND_BOUNDS)
const title = 'HasarBotu-Touch-Brave-Fixture-' + process.pid
const browser = await chromium.launch({ executablePath: process.env.HB_TOUCH_BRAVE_PATH, headless: false, chromiumSandbox: true,
  args: [`--window-position=${bounds.x},${bounds.y}`, `--window-size=${bounds.width},${bounds.height}`, '--no-default-browser-check'] })
try {
  const context = await browser.newContext({ viewport: null })
  const page = await context.newPage()
  await page.setContent(`<title>${title}</title><canvas width="320" height="180"></canvas><video muted autoplay></video><button>Tam ekran video</button><script>const canvas=document.querySelector('canvas');canvas.getContext('2d').fillRect(0,0,320,180);document.querySelector('video').srcObject=canvas.captureStream(1);document.querySelector('button').onclick=()=>document.querySelector('video').requestFullscreen()</script>`)
  const cdp = await context.newCDPSession(page)
  const { windowId } = await cdp.send('Browser.getWindowForTarget')
  const report = async () => connection.write(JSON.stringify({ handle: 'title:' + title, fullScreen: await page.evaluate(() => Boolean(document.fullscreenElement)), browserVersion: browser.version() }) + '\n')
  await page.bringToFront()
  await report()
  for await (const line of createInterface({ input: connection })) {
    try {
      const command = JSON.parse(line)
      if (command.type === 'video') {
        await page.getByRole('button', { name: 'Tam ekran video' }).click()
        await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'fullscreen' } })
      } else if (command.type === 'fullscreen' && !command.value) {
        await page.evaluate(() => document.exitFullscreen())
        await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } })
      }
      else if (command.type === 'bounds') await cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: command.value.x, top: command.value.y, width: command.value.width, height: command.value.height } })
      else throw new Error('Unsupported Brave fixture command')
      await page.bringToFront()
      await report()
    } catch (error) { connection.write(JSON.stringify({ error: error.message }) + '\n') }
  }
} finally { await browser.close(); connection.end() }
