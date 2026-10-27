import { Worker } from 'node:worker_threads'
import type { HeapInfo } from 'node:v8'
import type { ExtractionProcessEnvelope, ExtractionProcessMemory, ExtractionProcessStart } from './extraction-process.js'

const protocol = 'hasarbotu-extraction-process/1'
let worker: Worker | undefined
let started = false
let finishing = false
let interval: ReturnType<typeof setInterval> | undefined
let phase = 'starting'
let heap: HeapInfo | undefined
let heapSampling = false
const sends = new Set<Promise<void>>()
const metricsEnabled = process.env.HASARBOTU_EXTRACTION_MEMORY_METRICS === '1'

function send(message: ExtractionProcessEnvelope): void {
  if (!process.connected || !process.send) return
  const pending = new Promise<void>((resolve, reject) => {
    process.send!(message, error => error ? reject(error) : resolve())
  })
  sends.add(pending)
  void pending.then(() => sends.delete(pending), () => { sends.delete(pending); void finish(1) })
}

function sample(): void {
  if (!metricsEnabled) return
  const memory = process.memoryUsage()
  const entry: ExtractionProcessMemory = { pid: process.pid, ...memory,
    peakRss: Math.max(memory.rss, process.resourceUsage().maxRSS * 1024), phase,
    ...(heap ? { workerHeapUsed: heap.used_heap_size, workerHeapTotal: heap.total_heap_size, workerExternal: heap.external_memory } : {}) }
  send({ protocol, kind: 'memory', memory: entry })
  if (worker && worker.threadId !== -1 && !heapSampling && !finishing) {
    heapSampling = true
    void worker.getHeapStatistics().then(value => { heap = value }, () => undefined).finally(() => { heapSampling = false })
  }
}

async function finish(code: number): Promise<void> {
  if (finishing) return
  finishing = true
  if (interval) clearInterval(interval)
  sample()
  if (worker && worker.threadId !== -1) await worker.terminate()
  await Promise.allSettled([...sends])
  if (process.connected) process.disconnect()
  process.exit(code)
}

process.once('disconnect', () => {
  // With no parent there is no result to report. OS termination also reclaims nested
  // Worker threads, whose cooperative exit can otherwise outlive a dead owner.
  if (!finishing) process.kill(process.pid, 'SIGKILL')
})
process.once('message', raw => {
  const start = raw as ExtractionProcessStart
  if (started || start?.protocol !== protocol || start.kind !== 'start') { void finish(1); return }
  started = true
  try {
    worker = new Worker(new URL(start.workerUrl), start.options)
    if (metricsEnabled) { sample(); interval = setInterval(sample, 100); interval.unref() }
    worker.on('message', message => {
      if (finishing) return
      const kind = (message as { kind?: unknown }).kind
      if (kind === 'phase') phase = String((message as { phase?: unknown }).phase ?? 'phase')
      else if (kind === 'page' || kind === 'complete' || kind === 'error') phase = kind
      sample()
      send({ protocol, kind: 'message', message })
    })
    worker.once('error', () => { send({ protocol, kind: 'error' }) })
    worker.once('exit', code => { void finish(code) })
  } catch {
    send({ protocol, kind: 'error' })
    void finish(1)
  }
})
