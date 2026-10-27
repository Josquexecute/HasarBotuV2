import { parentPort } from 'node:worker_threads'

for (let pageNumber = 1; pageNumber <= 3; pageNumber += 1) {
  parentPort.postMessage({ kind: 'page', page: { pageNumber } })
}
parentPort.postMessage({ kind: 'complete', summary: {} })
setInterval(() => undefined, 1000)
