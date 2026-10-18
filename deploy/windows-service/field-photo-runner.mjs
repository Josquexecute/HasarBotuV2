import { appendFile, readFile } from 'node:fs/promises'
import { resolve, join, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const filename = process.argv[2]
if (!filename || !isAbsolute(filename)) throw Error('An absolute private configuration file is required')
const settings = JSON.parse(await readFile(resolve(filename), 'utf8'))
if (!isAbsolute(settings.runtimeDirectory) || !settings.environment || typeof settings.environment !== 'object') throw Error('Invalid field worker configuration')
const runtime = settings.runtimeDirectory
const { loadAgentConfigFromEnv } = await import(pathToFileURL(join(runtime, 'services/file-agent/dist/config.js')).href)
const { runFieldPhotoOnce } = await import(pathToFileURL(join(runtime, 'services/file-agent/dist/field-photo-worker.js')).href)
const config = loadAgentConfigFromEnv({ ...process.env, ...settings.environment })
const controller = new AbortController()
for (const event of ['SIGINT','SIGTERM']) process.once(event, () => controller.abort())
let failed = false
async function log(message) {
  if (settings.logFile && isAbsolute(settings.logFile)) await appendFile(settings.logFile, `${new Date().toISOString()} ${message}\n`, 'utf8')
  else console.log(message)
}
while (!controller.signal.aborted) {
  try {
    const worked = await runFieldPhotoOnce(config, controller.signal)
    if (failed) { await log('Field photo worker connection restored'); failed = false }
    if (worked) continue
  } catch {
    if (controller.signal.aborted) break
    if (!failed) await log('Field photo worker is waiting for its office connection')
    failed = true
  }
  try { await delay(config.pollIntervalMs, undefined, { signal: controller.signal }) } catch (error) { if (!controller.signal.aborted) throw error }
}
