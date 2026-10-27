import { parentPort, resourceLimits, threadId, Worker, workerData } from 'node:worker_threads'

parentPort.postMessage({ kind: 'started', pid: process.pid, threadId, resourceLimits, echo: workerData.echo })
if (workerData.mode === 'ordered') {
  parentPort.postMessage({ kind: 'page', sequence: 0 })
  parentPort.postMessage({ kind: 'page', sequence: 1 })
  parentPort.postMessage({ kind: 'complete', value: 'synthetic-summary' })
} else if (workerData.mode === 'crash') {
  throw new Error('synthetic-extraction-worker-crash')
} else if (workerData.mode === 'nested') {
  const nested = new Worker(new URL(import.meta.url), { workerData: { mode: 'hang' }, execArgv: [] })
  nested.on('message', message => parentPort.postMessage({ kind: 'nested-started', pid: message.pid }))
  setInterval(() => undefined, 10000)
} else if (workerData.mode === 'hang') {
  setInterval(() => undefined, 10000)
}
