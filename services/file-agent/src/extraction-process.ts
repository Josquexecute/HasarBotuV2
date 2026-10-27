import { fork, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import type { WorkerOptions } from 'node:worker_threads'

export const EXTRACTION_PROCESS_PROTOCOL = 'hasarbotu-extraction-process/1'
export type ExtractionWorkerOptions = Pick<WorkerOptions, 'workerData' | 'execArgv' | 'resourceLimits' | 'name'>
export interface ExtractionProcessMemory {
  readonly pid: number
  readonly rss: number
  readonly peakRss: number
  readonly heapUsed: number
  readonly heapTotal: number
  readonly external: number
  readonly arrayBuffers: number
  readonly phase: string
  readonly workerHeapUsed?: number
  readonly workerHeapTotal?: number
  readonly workerExternal?: number
}
export interface ExtractionProcessStart {
  readonly protocol: typeof EXTRACTION_PROCESS_PROTOCOL
  readonly kind: 'start'
  readonly workerUrl: string
  readonly options: ExtractionWorkerOptions
}
export type ExtractionProcessEnvelope =
  | { readonly protocol: typeof EXTRACTION_PROCESS_PROTOCOL; readonly kind: 'message'; readonly message: unknown }
  | { readonly protocol: typeof EXTRACTION_PROCESS_PROTOCOL; readonly kind: 'error' }
  | { readonly protocol: typeof EXTRACTION_PROCESS_PROTOCOL; readonly kind: 'memory'; readonly memory: ExtractionProcessMemory }

const active = new Map<number, ExtractionProcessMemory>()
let concurrentPeakRss = 0
function recordPeak(): void {
  concurrentPeakRss = Math.max(concurrentPeakRss, [...active.values()].reduce((sum, item) => sum + item.peakRss, 0))
}
/** RSS is the whole child process; heap/external fields describe its host isolate, not all Worker isolates. */
export function getActiveExtractionMemory(): readonly ExtractionProcessMemory[] {
  return [...active.values()].map(item => ({ ...item }))
}
/** Maximum simultaneous owned-child lifetime peaks. Sequential jobs are never added together. */
export function getExtractionProcessPeakRss(): number { return concurrentPeakRss }

export function extractionHostExecArgv(arguments_: readonly string[]): string[] {
  const result: string[] = []
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!
    if (['-e', '--eval', '-p', '--print', '-pe', '-ep', '--input-type'].includes(argument)) { index += 1; continue }
    if (/^(?:--(?:eval|print|input-type)=|-[ep].+)/.test(argument)) continue
    // These control the invoking program/test runner, not an extraction host.
    if (/^--(?:inspect(?:-|=|$)|test(?:-|=|$)|experimental-test(?:-|=|$)|watch(?:-|=|$))/.test(argument)) {
      if (!argument.includes('=') && arguments_[index + 1] && !arguments_[index + 1]!.startsWith('-')) index += 1
      continue
    }
    result.push(argument)
    // Preserve loader/profiler arguments verbatim, including their following module specifier.
    if (['--import', '--require', '-r', '--loader', '--experimental-loader', '--conditions', '-C'].includes(argument)
      && arguments_[index + 1] !== undefined) result.push(arguments_[++index]!)
  }
  return result
}

function hostTarget(): { url: URL; execArgv: string[] } {
  const compiled = new URL('./extraction-process-host.js', import.meta.url)
  const url = existsSync(compiled) ? compiled : new URL('./extraction-process-host.ts', import.meta.url)
  const execArgv = extractionHostExecArgv(process.execArgv)
  if (url.pathname.endsWith('.ts')) execArgv.push('--import', 'tsx')
  return { url, execArgv }
}

type ExtractionEvents<TMessage> = { message: [TMessage]; error: [Error]; exit: [number] }
export class ExtractionWorker<TMessage = unknown> extends EventEmitter<ExtractionEvents<TMessage>> {
  readonly pid: number | undefined
  private readonly child: ChildProcess
  private readonly closed: Promise<number>
  private closeReceived = false

  constructor(url: URL, options: ExtractionWorkerOptions) {
    super()
    const host = hostTarget()
    this.child = fork(host.url, [], { execArgv: host.execArgv, serialization: 'advanced', windowsHide: true,
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })
    this.pid = this.child.pid
    if (this.pid !== undefined) active.set(this.pid, { pid: this.pid, rss: 0, peakRss: 0,
      heapUsed: 0, heapTotal: 0, external: 0, arrayBuffers: 0, phase: 'starting' })
    this.closed = new Promise<number>(resolve => {
      this.child.once('close', code => {
        this.closeReceived = true
        recordPeak()
        if (this.pid !== undefined) active.delete(this.pid)
        const exitCode = code ?? 1
        // Child close means IPC/stdio and all child-owned native/WASM heaps have gone away.
        this.emit('exit', exitCode)
        resolve(exitCode)
      })
    })
    this.child.on('error', () => this.emit('error', new Error('worker_crashed')))
    this.child.on('message', raw => {
      const envelope = raw as ExtractionProcessEnvelope
      if (envelope?.protocol !== EXTRACTION_PROCESS_PROTOCOL || this.closeReceived) return
      if (envelope.kind === 'memory') {
        if (this.pid === undefined || envelope.memory.pid !== this.pid) return
        active.set(this.pid, envelope.memory)
        recordPeak()
      } else if (envelope.kind === 'error') this.emit('error', new Error('worker_crashed'))
      else if (envelope.kind === 'message') this.emit('message', envelope.message as TMessage)
    })
    const start: ExtractionProcessStart = { protocol: EXTRACTION_PROCESS_PROTOCOL, kind: 'start', workerUrl: url.href, options }
    this.child.send(start, error => { if (error && !this.closeReceived) this.emit('error', new Error('worker_crashed')) })
  }

  async terminate(): Promise<number> {
    if (!this.closeReceived) this.child.kill('SIGKILL')
    return this.closed
  }
}

export function createExtractionWorker<TMessage = unknown>(url: URL, options: ExtractionWorkerOptions): ExtractionWorker<TMessage> {
  return new ExtractionWorker<TMessage>(url, options)
}
