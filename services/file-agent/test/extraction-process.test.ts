import { fork, spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createExtractionWorker,
  EXTRACTION_PROCESS_PROTOCOL,
  extractionHostExecArgv,
  getActiveExtractionMemory,
  getExtractionProcessPeakRss,
  type ExtractionProcessEnvelope,
  type ExtractionWorker,
} from '../src/extraction-process.js'

interface FixtureMessage {
  kind: string
  pid?: number
  resourceLimits?: { maxOldGenerationSizeMb?: number }
  echo?: string
  sequence?: number
}
const fixture = new URL('./fixtures/extraction-process-worker.mjs', import.meta.url)
const owned: ExtractionWorker<FixtureMessage>[] = []
function create(mode: string) {
  const worker = createExtractionWorker<FixtureMessage>(fixture, { workerData: { mode, echo: 'synthetic' }, execArgv: [],
    resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 }, name: 'synthetic-extraction' })
  owned.push(worker)
  return worker
}
const exited = (worker: ExtractionWorker<FixtureMessage>) => new Promise<number>(resolve => worker.once('exit', resolve))
const firstMessage = (worker: ExtractionWorker<FixtureMessage>) => new Promise<FixtureMessage>(resolve => worker.once('message', resolve))
function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error }
}
afterEach(async () => { await Promise.all(owned.splice(0).map(worker => worker.terminate())) })

describe('extraction child ownership', () => {
  it('keeps runtime profilers and strips eval, input type, inspector and test-runner context', () => {
    expect(extractionHostExecArgv(['--expose-gc', '--import', 'file:///synthetic/profiler.mjs', '--require=synthetic-loader',
      '-r', 'another-loader', '--input-type', 'module', '-e', 'parent program', '--test', '--test-name-pattern', 'extract',
      '--test-reporter=spec', '--inspect-port', '9229', '--watch', '--max-old-space-size=512'])).toEqual([
      '--expose-gc', '--import', 'file:///synthetic/profiler.mjs', '--require=synthetic-loader', '-r', 'another-loader', '--max-old-space-size=512',
    ])
    expect(extractionHostExecArgv(['--eval=parent()', '--print=parent()', '-eparent()', '-pparent()', '-pe', 'parent()', '--input-type=module'])).toEqual([])
  })

  it('a real node -e caller cannot recursively execute its eval program inside the extraction child', () => {
    const helper = new URL('../src/extraction-process.ts', import.meta.url)
    const code = `import { createExtractionWorker } from ${JSON.stringify(helper.href)};
      if(process.env.HB_EXTRACTION_EVAL_GUARD==='1'){process.stderr.write('parent_eval_reexecuted');process.exit(44)}
      process.env.HB_EXTRACTION_EVAL_GUARD='1';
      const messages=[];const worker=createExtractionWorker(new URL(${JSON.stringify(fixture.href)}),{workerData:{mode:'ordered'},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:96}});
      worker.on('message',message=>messages.push(message));worker.on('error',()=>{process.exitCode=1});
      worker.on('exit',code=>{console.log(JSON.stringify({code,ownerPid:process.pid,messages}));if(code!==0)process.exitCode=1});`
    const env = { ...process.env }; delete env.HB_EXTRACTION_EVAL_GUARD
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code],
      { env, encoding: 'utf8', windowsHide: true, timeout: 10000 })
    expect(result.status, result.stderr).toBe(0)
    const output = JSON.parse(result.stdout) as { code: number; ownerPid: number; messages: FixtureMessage[] }
    expect(output.code).toBe(0)
    expect(output.messages.map(message => message.kind)).toEqual(['started', 'page', 'page', 'complete'])
    expect(output.messages[0]?.pid).not.toBe(output.ownerPid)
  }, 15000)

  it('preserves ordered messages and per-job Worker resource limits in a separate PID', async () => {
    const worker = create('ordered'), messages: FixtureMessage[] = [], errors: Error[] = []
    worker.on('message', message => messages.push(message)); worker.on('error', error => errors.push(error))
    expect(await exited(worker)).toBe(0)
    expect(errors).toEqual([])
    expect(messages.map(message => message.kind)).toEqual(['started', 'page', 'page', 'complete'])
    expect(messages[0]).toMatchObject({ pid: worker.pid, echo: 'synthetic', resourceLimits: { maxOldGenerationSizeMb: 96 } })
    expect(worker.pid).not.toBe(process.pid)
    expect(messages.filter(message => message.kind === 'page').map(message => message.sequence)).toEqual([0, 1])
    expect(getActiveExtractionMemory()).toEqual([])
  }, 15000)

  it('reports a crashing Worker and closes its child before releasing ownership', async () => {
    const worker = create('crash'), errors: Error[] = []
    worker.on('error', error => errors.push(error))
    expect(await exited(worker)).not.toBe(0)
    expect(errors.map(error => error.message)).toContain('worker_crashed')
    expect(getActiveExtractionMemory()).toEqual([])
    expect(isAlive(worker.pid!)).toBe(false)
  }, 15000)

  it('terminate resolves after child close, registry removal and nested Worker process death', async () => {
    const worker = create('nested')
    worker.on('error', error => { throw error })
    await new Promise<void>(resolve => worker.on('message', message => { if (message.kind === 'nested-started') resolve() }))
    let registryRemovedAtExit = false
    worker.once('exit', () => { registryRemovedAtExit = !getActiveExtractionMemory().some(item => item.pid === worker.pid) })
    await worker.terminate()
    expect(registryRemovedAtExit).toBe(true)
    expect(isAlive(worker.pid!)).toBe(false)
    expect(getActiveExtractionMemory()).toEqual([])
  }, 15000)

  it('records opt-in whole-process memory and OS lifetime peak separately from the parent', async () => {
    const before = process.env.HASARBOTU_EXTRACTION_MEMORY_METRICS
    process.env.HASARBOTU_EXTRACTION_MEMORY_METRICS = '1'
    try {
      const worker = create('hang')
      worker.on('error', error => { throw error })
      await firstMessage(worker)
      const memory = getActiveExtractionMemory().find(item => item.pid === worker.pid)
      expect(memory?.rss).toBeGreaterThan(0)
      expect(memory?.peakRss).toBeGreaterThanOrEqual(memory!.rss)
      expect(getExtractionProcessPeakRss()).toBeGreaterThanOrEqual(memory!.peakRss)
      await worker.terminate()
      expect(getActiveExtractionMemory()).toEqual([])
    } finally {
      if (before === undefined) delete process.env.HASARBOTU_EXTRACTION_MEMORY_METRICS
      else process.env.HASARBOTU_EXTRACTION_MEMORY_METRICS = before
    }
  }, 15000)

  it('a disconnected parent channel cannot leave the child and nested Workers orphaned', async () => {
    const host = fork(new URL('../src/extraction-process-host.ts', import.meta.url), [], {
      execArgv: ['--import', 'tsx'], serialization: 'advanced', windowsHide: true, stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    })
    // Explicit parent-side IPC disconnect can suppress ChildProcess 'close' on Windows;
    // 'exit' plus the OS PID check establishes that no child remains after owner loss.
    const ended = new Promise<number | null>(resolve => host.once('exit', resolve))
    try {
      const nestedStarted = new Promise<void>(resolve => host.on('message', raw => {
        const message = raw as ExtractionProcessEnvelope
        if (message.kind === 'message' && (message.message as FixtureMessage).kind === 'nested-started') resolve()
      }))
      host.send({ protocol: EXTRACTION_PROCESS_PROTOCOL, kind: 'start', workerUrl: fixture.href,
        options: { workerData: { mode: 'nested' }, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 96 } } })
      await nestedStarted
      host.disconnect()
      expect(await ended).not.toBe(0)
      expect(isAlive(host.pid!)).toBe(false)
    } finally {
      if (host.exitCode === null && host.signalCode === null) host.kill('SIGKILL')
      await ended
    }
  }, 15000)
})
