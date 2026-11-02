import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'

test('actual installer validates TLS and restores legacy/services/task/firewall after success or a late failure', {
  skip: process.platform !== 'win32' || !process.env.TEST_CADDY_EXE || !process.env.TEST_WINSW_EXE,
  timeout: 120_000,
}, async () => {
  const api = createServer((_req, res) => { res.setHeader('content-type','application/json'); res.end('{"service":"hasarbotu-api","status":"ok"}') })
  api.listen(3100, '127.0.0.1'); await once(api, 'listening')
  try {
    for (const fail of [false, true]) {
      const root = resolve(process.env.RUNNER_TEMP ?? tmpdir()), directory = await mkdtemp(join(root, 'hb-install-test-'))
      const portProbe = createServer(); portProbe.listen(0, '127.0.0.1'); await once(portProbe, 'listening')
      const port = portProbe.address().port; await new Promise(done => portProbe.close(done))
      try {
        const child = spawn('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',resolve('deploy/windows-service/office-network-installer.fixture.ps1')], {
          windowsHide: true, env: {...process.env, HB_TEST_ROOT: directory, HB_TEST_SOURCE: resolve('deploy/windows-service'), HB_TEST_NODE: process.execPath,
            HB_TEST_HTTPS_PORT: String(port), HB_TEST_INJECT_FAIL: String(fail)}, stdio: ['ignore','pipe','pipe'],
        })
        let output = ''
        child.stdout.on('data', bytes => { output += bytes }); child.stderr.on('data', bytes => { output += bytes })
        const code = await new Promise((done, reject) => { child.once('error', reject); child.once('exit', done) })
        assert.equal(code, 0, output.slice(-4000))
        assert.match(output, /"fixture":"PASS"/)
      } finally {
        if (!resolve(directory).startsWith(root + sep)) throw Error('UNSAFE_FIXTURE_CLEANUP')
        await rm(directory, {recursive:true,force:true})
      }
    }
  } finally { await new Promise(done => api.close(done)) }
})
