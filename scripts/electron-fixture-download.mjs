import assert from 'node:assert/strict'
import { resolve } from 'node:path'

/** Native Electron download verification; save path is supplied only by an isolated test fixture. */
export async function downloadElectronFixture(electron, destination, trigger) {
  destination = resolve(destination)
  // Playwright's allowAndName download manager competes with Electron's native setSavePath.
  // Restore Chromium's default for this isolated fixture so the actual shell policy owns the download.
  const cdp = await electron.context().newCDPSession(electron.windows()[0])
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'default', eventsEnabled: true })
  await cdp.detach()
  await electron.evaluate(({ BrowserWindow }, destination) => {
    const session = BrowserWindow.getAllWindows()[0].webContents.session
    globalThis.fixtureDownload = new Promise(resolve => {
      const listener = (_event, item) => {
        item.setSavePath(destination)
        item.once('done', (_event, state) => { clearTimeout(timeout); resolve({ state, bytes: item.getReceivedBytes(), filename: item.getFilename(), path: item.getSavePath(), totalBytes: item.getTotalBytes() }) })
      }
      const timeout = setTimeout(() => { session.off('will-download', listener); resolve({ state: 'timed_out', bytes: 0 }) }, 15000)
      session.once('will-download', listener)
    })
  }, destination)
  await trigger()
  const result = await electron.evaluate(() => globalThis.fixtureDownload)
  assert.equal(result.state, 'completed', `Native Electron download must complete through the shell policy: ${JSON.stringify(result)}`)
  assert.ok(result.bytes > 0)
  return result
}
