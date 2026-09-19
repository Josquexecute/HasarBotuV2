import { Worker } from 'node:worker_threads'
import { access } from 'node:fs/promises'

let active = 0
export async function extractEksist(kind: 'image' | 'pdf', bytes: Buffer): Promise<{ text: string; method: string }> {
  if (active >= 2) throw new Error('extraction_busy')
  active++
  try {
    let url = new URL('./extraction-worker.js', import.meta.url)
    let execArgv: string[] = []
    try { await access(url) } catch { url = new URL('./extraction-worker.ts', import.meta.url); execArgv = ['--import', 'tsx'] }
    return await new Promise((resolve, reject) => {
      const worker = new Worker(url, { workerData: { kind, bytes }, execArgv, resourceLimits: { maxOldGenerationSizeMb: 256 } })
      let settled = false
      const finish = (value?: { text: string; method: string }) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        void worker.terminate()
        if (value) resolve(value)
        else reject(new Error('extraction_failed'))
      }
      const timeout = setTimeout(() => finish(), 90_000)
      worker.on('message', (message: { ok: boolean; text: string; method: string }) => finish(message.ok ? message : undefined))
      worker.on('error', () => finish())
      worker.on('exit', () => finish())
    })
  } finally { active-- }
}
