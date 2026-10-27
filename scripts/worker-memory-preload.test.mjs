import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

test('profiles inherited Worker isolates and WASM capacity without attributing process RSS to native memory', async () => {
  const root = resolve('.local'), directory = await mkdtemp(join(root, 'memory-preload-test-'))
  try {
    const workerPath = join(directory, 'worker.cjs')
    await writeFile(workerPath, 'new WebAssembly.Memory({ initial: 5 });')
    const source = `const { Worker } = require('node:worker_threads');
      const memory = new WebAssembly.Memory({ initial: 2 }); memory.grow(1);
      const worker = new Worker(${JSON.stringify(workerPath)});
      worker.once('exit', code => { if(code !== 0) process.exitCode=code });`
    const run = spawnSync(process.execPath, ['--import', pathToFileURL(resolve('scripts/worker-memory-preload.mjs')).href, '-e', source],
      { env: { ...process.env, HB_MEMORY_PROFILE_DIR: directory }, windowsHide: true, encoding: 'utf8', timeout: 10000 })
    assert.equal(run.status, 0, run.stderr)
    const names = (await readdir(directory)).filter(name => name.endsWith('.jsonl'))
    assert.equal(names.length, 2)
    const logs = await Promise.all(names.map(async name => (await readFile(join(directory, name), 'utf8')).trim().split('\n').map(JSON.parse)))
    assert.equal(new Set(logs.map(events => events[0].isolateId)).size, names.length)
    for (let i = 0; i < logs.length; i++) {
      assert.equal(names[i], logs[i][0].isolateId + '.jsonl')
      assert.ok(logs[i].every(event => event.isolateId === logs[i][0].isolateId))
    }
    const main = logs.find(events => events[0].threadId === 0), child = logs.find(events => events[0].threadId !== 0)
    assert.ok(main.some(e => e.event === 'worker-created' && e.childThreadId === child[0].threadId))
    assert.ok(main.some(e => e.event === 'worker-exit' && e.code === 0))
    assert.ok(main.some(e => e.wasmCapacityBytes === 3 * 65536))
    assert.ok(child.some(e => e.wasmCapacityBytes === 5 * 65536))
    for (const entry of logs.flat().filter(e => e.event === 'memory')) {
      assert.equal(entry.rssScope, 'shared-process')
      assert.equal(entry.rssPid, entry.pid)
      assert.ok(Number.isInteger(entry.ppid) && entry.ppid > 0)
      assert.equal(entry.heapScope, 'current-isolate')
      assert.equal(entry.nativeBytes, null)
      assert.equal(entry.nativeScope, 'not-measured-no-residual-subtraction')
    }
  } finally {
    assert.ok(resolve(directory).startsWith(root + sep))
    await rm(directory, { recursive: true, force: true })
  }
})

test('profiles an IPC extraction host under its own PID and links the parent process without summing thread RSS', async () => {
  const root = resolve('.local'), directory = await mkdtemp(join(root, 'memory-preload-process-test-'))
  try {
    const childPath = join(directory, 'child.cjs'), parentPath = join(directory, 'parent.cjs')
    await writeFile(childPath, `const memory = new WebAssembly.Memory({ initial: 4 });
      process.send({ pid: process.pid, ppid: process.ppid }, () => process.disconnect());`)
    await writeFile(parentPath, `const { fork } = require('node:child_process');
      const child = fork(${JSON.stringify(childPath)}, { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
      child.once('message', value => console.log(JSON.stringify(value)));
      child.once('exit', code => { process.exitCode = code; });`)
    const run = spawnSync(process.execPath, ['--import', pathToFileURL(resolve('scripts/worker-memory-preload.mjs')).href, parentPath],
      { env: { ...process.env, HB_MEMORY_PROFILE_DIR: directory }, windowsHide: true, encoding: 'utf8', timeout: 10000 })
    assert.equal(run.status, 0, run.stderr)
    const childIdentity = JSON.parse(run.stdout.trim())
    const names = (await readdir(directory)).filter(name => name.endsWith('.jsonl'))
    assert.equal(names.length, 2)
    const logs = await Promise.all(names.map(async name => (await readFile(join(directory, name), 'utf8')).trim().split('\n').map(JSON.parse)))
    const parent = logs.find(events => events[0].role === 'main'), child = logs.find(events => events[0].role === 'extraction-host')
    assert.ok(parent && child)
    assert.notEqual(parent[0].pid, child[0].pid)
    assert.equal(child[0].pid, childIdentity.pid)
    assert.equal(child[0].ppid, parent[0].pid)
    assert.ok(child.some(e => e.wasmCapacityBytes === 4 * 65536))
    assert.ok(child.filter(e => e.event === 'memory').every(e => e.rssPid === childIdentity.pid && e.rssScope === 'shared-process'))
  } finally {
    assert.ok(resolve(directory).startsWith(root + sep))
    await rm(directory, { recursive: true, force: true })
  }
})
