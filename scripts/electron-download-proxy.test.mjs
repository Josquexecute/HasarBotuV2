import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { connect } from 'node:net'
import { once } from 'node:events'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createTestTlsCertificate } from './test-tls-certificate.mjs'

const execute = promisify(execFile)
async function listen(server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server.address().port
}
async function close(server) {
  server.closeAllConnections()
  await new Promise((done, reject) => server.close(error => error ? reject(error) : done()))
}

test('electron-builder downloader retains proxy, NO_PROXY, and TLS verification with the security override', { timeout: 20_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hb-electron-proxy-'))
  const certificate = join(directory, 'localhost.crt')
  const { cert, key } = createTestTlsCertificate()
  await writeFile(certificate, cert)
  const requests = [], tunnels = [], sockets = new Set()
  const direct = createServer((request, response) => {
    requests.push(`direct:${request.url}`)
    response.end('direct-download')
  })
  const secure = createHttpsServer({ cert, key }, (_request, response) => response.end('secure-download'))
  const proxy = createServer((request, response) => {
    requests.push(request.url)
    response.end('proxy-download')
  })
  proxy.on('connect', (request, socket, head) => {
    tunnels.push(request.url)
    const upstream = connect(secure.address().port, '127.0.0.1')
    sockets.add(socket); sockets.add(upstream)
    socket.on('error', () => upstream.destroy())
    upstream.on('error', () => socket.destroy())
    socket.on('close', () => { upstream.destroy(); sockets.delete(socket) })
    upstream.on('close', () => sockets.delete(upstream))
    upstream.once('connect', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) upstream.write(head)
      socket.pipe(upstream).pipe(socket)
    })
  })
  const [directPort, securePort, proxyPort] = await Promise.all([listen(direct), listen(secure), listen(proxy)])
  const script = `
    const assert = require('node:assert/strict')
    const { createRequire } = require('node:module')
    const { readFileSync } = require('node:fs')
    const { join } = require('node:path')
    const builderRequire = createRequire(require.resolve('app-builder-lib/package.json'))
    builderRequire('@electron/get')
    assert.ok(globalThis.GLOBAL_AGENT, 'Electron proxy bootstrap did not run')
    const { GotDownloader } = builderRequire('@electron/get/dist/cjs/GotDownloader.js')
    const downloader = new GotDownloader()
    const [directory, directPort, securePort, certificate] = process.argv.slice(1)
    const options = { quiet: true, retry: 0, timeout: { request: 3000 } }
    ;(async () => {
      await downloader.download('http://downloads.invalid/proxy', join(directory, 'proxy.bin'), options)
      await downloader.download('http://127.0.0.1:' + directPort + '/direct', join(directory, 'direct.bin'), options)
      const secureUrl = 'https://localhost:' + securePort + '/secure'
      await assert.rejects(downloader.download(secureUrl, join(directory, 'untrusted.bin'), options))
      await assert.rejects(downloader.download('https://wrong.example.invalid:' + securePort + '/secure', join(directory, 'wrong-host.bin'), { ...options, https: { certificateAuthority: readFileSync(certificate) } }))
      await downloader.download(secureUrl, join(directory, 'trusted.bin'), { ...options, https: { certificateAuthority: readFileSync(certificate) } })
    })().catch(error => { console.error(error); process.exitCode = 1 })
  `
  try {
    await execute(process.execPath, ['-e', script, directory, String(directPort), String(securePort), certificate], {
      windowsHide: true, timeout: 15_000,
      env: { ...process.env, ELECTRON_GET_USE_PROXY: 'true', ELECTRON_GET_NO_PROGRESS: '1',
        GLOBAL_AGENT_HTTP_PROXY: `http://127.0.0.1:${proxyPort}`, GLOBAL_AGENT_HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`,
        GLOBAL_AGENT_NO_PROXY: '127.0.0.1', NODE_EXTRA_CA_CERTS: '', NODE_TLS_REJECT_UNAUTHORIZED: '1', ROARR_LOG: 'true' },
    }).catch(error => { throw new Error(error.stdout + error.stderr.slice(0, 500)) })
    assert.deepEqual(requests, ['http://downloads.invalid/proxy', 'direct:/direct'])
    assert.equal(tunnels.length, 3)
    assert.equal(await readFile(join(directory, 'proxy.bin'), 'utf8'), 'proxy-download')
    assert.equal(await readFile(join(directory, 'direct.bin'), 'utf8'), 'direct-download')
    assert.equal(await readFile(join(directory, 'trusted.bin'), 'utf8'), 'secure-download')
  } finally {
    for (const socket of sockets) socket.destroy()
    await Promise.all([close(proxy), close(direct), close(secure)])
    await rm(directory, { recursive: true, force: true })
  }
})
