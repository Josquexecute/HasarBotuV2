import { app, session } from 'electron'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { downloadVerifiedInstaller } from '../../dist/main/updates-core.js'

app.whenReady().then(async () => {
  const directory = process.argv[2], output = process.argv[3]
  const body = Buffer.from('MZsynthetic-network-regression')
  const release = { version: '0.1.87', size: body.length, sha256: createHash('sha256').update(body).digest('hex') }
  let stall = true, requests = 0
  const server = createServer((_req, res) => {
    requests++
    res.writeHead(200, { 'content-length': String(body.length) })
    if (stall) res.write(body.subarray(0, 2))
    else res.end(body)
  })
  try {
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const origin = `http://127.0.0.1:${server.address().port}`
    const options = { release, origin, directory, fetch: session.defaultSession.fetch.bind(session.defaultSession), progress() {}, idleTimeoutMs: 150 }
    const started = Date.now()
    await assert.rejects(downloadVerifiedInstaller(options), /veri gelmiyor/)
    const stallMs = Date.now() - started
    assert.deepEqual(await readdir(directory), [])
    stall = false
    const installer = await downloadVerifiedInstaller(options)
    assert.deepEqual(await readFile(installer), body)
    assert.equal(requests, 2)
    await writeFile(output, JSON.stringify({ passed: true, electron: process.versions.electron, stallMs, requests, bytes: body.length }))
  } catch (error) {
    await writeFile(output, JSON.stringify({ passed: false, error: String(error.stack) }))
    process.exitCode = 1
  } finally { server.closeAllConnections(); server.close(); app.quit() }
})
