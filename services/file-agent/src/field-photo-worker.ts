import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { link, lstat, mkdtemp, open, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fieldPhotoJobSchema, type FieldPhotoJob, FIELD_PHOTO_MAX_BYTES } from '@hasarbotu/contracts'
import type { AgentConfig } from './config.js'
import { checkCaseFreshness } from './freshness-gate-client.js'
import { assertRealPathUnderRoot, resolveUnderRoot } from './path-resolver.js'

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
export function nextFieldPhotoName(kind: FieldPhotoJob['kind'], existing: readonly string[]) {
  const names = existing.map(name => name.normalize('NFC').toLocaleUpperCase('tr'))
  if (kind === 'damage') {
    const numbers = names.map(name => /^HASAR\s*(\d+)\.(?:JPG|JPEG)$/u.exec(name)).filter(match => match !== null).map(match => Number(match![1])).filter(Number.isSafeInteger)
    return `HASAR ${Math.max(100, ...numbers) + 1}.jpg`
  }
  const stem = kind === 'chassis' ? 'ŞASE' : 'KM'
  if (!names.includes(`${stem}.JPG`) && !names.includes(`${stem}.JPEG`)) return `${stem}.jpg`
  let number = 2
  while (names.includes(`${stem} ${number}.JPG`) || names.includes(`${stem} ${number}.JPEG`)) number++
  return `${stem} ${number}.jpg`
}
async function processImage(original: string, output: string, signal?: AbortSignal): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const worker = spawn(process.execPath, ['--max-old-space-size=512', fileURLToPath(new URL('./field-photo-image-worker.js', import.meta.url)), original, output], { windowsHide: true, signal, stdio: ['ignore','pipe','ignore'] })
    let text = ''
    const timer = setTimeout(() => { worker.kill(); reject(new Error('image_conversion_failed')) }, 60_000)
    worker.stdout.on('data', chunk => { text += String(chunk); if (text.length > 10_000) { worker.kill(); reject(new Error('image_conversion_failed')) } })
    worker.once('error', error => { clearTimeout(timer); reject(error) })
    worker.once('close', code => {
      clearTimeout(timer)
      try {
        const result = JSON.parse(text) as { width?: number; height?: number; error?: string }
        if (code !== 0 || !result.width || !result.height) { reject(new Error(result.error ?? 'image_conversion_failed')); return }
        resolve({ width: result.width, height: result.height })
      } catch { reject(new Error('image_conversion_failed')) }
    })
  })
}

/** File.Move is an atomic, no-replace operation on Windows, including pCloud drives. */
async function publishWithoutOverwrite(source: string, destination: string) {
  if (process.platform !== 'win32') { await link(source, destination); await unlink(source); return }
  const code = await new Promise<number | null>((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command',
      "try { [IO.File]::Move($env:HB_PHOTO_STAGE,$env:HB_PHOTO_DESTINATION); exit 0 } catch { exit 1 }"],
    { windowsHide: true, env: { ...process.env, HB_PHOTO_STAGE: source, HB_PHOTO_DESTINATION: destination }, stdio: 'ignore' })
    const timer = setTimeout(() => { child.kill(); reject(new Error('photo_write_failed')) }, 30_000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', value => { clearTimeout(timer); resolve(value) })
  })
  if (code !== 0) {
    try { await lstat(destination) } catch { throw new Error('photo_write_failed') }
    const collision = new Error('photo_name_conflict') as NodeJS.ErrnoException; collision.code = 'EEXIST'; throw collision
  }
}

export async function runFieldPhotoOnce(config: AgentConfig, signal?: AbortSignal): Promise<boolean> {
  const base = config.apiBaseUrl.replace(/\/$/u, '')
  const headers = { 'x-agent-id': config.agentId, 'x-agent-secret': config.agentSecret }
  async function request(path: string, init: RequestInit = {}) {
    const response = await fetch(base + '/api/v1/field-agent/uploads' + path, { ...init, redirect: 'error', headers: { ...headers, ...init.headers }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(response.status === 409 ? 'case_location_changed' : 'photo_write_failed')
    return response
  }
  const response = await request('/claim', { method: 'POST' })
  const body = await response.json() as { job: unknown }
  if (!body.job) return false
  const job = fieldPhotoJobSchema.parse(body.job)
  const temporary = await mkdtemp(join(tmpdir(), 'hb-field-photo-'))
  try {
    const root = config.roots[job.storageRootKey]
    if (!root) throw new Error('storage_unavailable')
    const folder = resolveUnderRoot(root, job.relativePath)
    await assertRealPathUnderRoot(root, folder)
    const info = await lstat(folder)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('storage_unavailable')
    const originalResponse = await request(`/${job.id}/original`, { headers: { 'x-upload-lease': job.leaseToken } })
    const reader = originalResponse.body!.getReader(), chunks: Buffer[] = []
    let count = 0
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break; count += value.length; if (count > FIELD_PHOTO_MAX_BYTES || count > job.byteSize) throw new Error('unsupported_image'); chunks.push(Buffer.from(value)) }
    } finally { reader.releaseLock() }
    const original = Buffer.concat(chunks)
    if (count !== job.byteSize || sha(original) !== job.contentHash) throw new Error('unsupported_image')
    const input = join(temporary, 'original'), output = join(temporary, 'processed.jpg')
    await writeFile(input, original, { flag: 'wx' })
    const size = await processImage(input, output, signal), jpeg = await readFile(output)
    await assertRealPathUnderRoot(root, folder)
    let fileName = job.outputFileName ?? nextFieldPhotoName(job.kind, await readdir(folder))
    let published = false
    const stage = resolveUnderRoot(root, `${job.relativePath}/.hb-${randomUUID().slice(0,8)}`)
    try {
    for (let attempt = 0; attempt < 20; attempt++) {
      const prepared = { leaseToken: job.leaseToken, fileName, byteSize: jpeg.length, contentHash: sha(jpeg), ...size }
      await request(`/${job.id}/prepare`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(prepared) })
      const target = resolveUnderRoot(root, `${job.relativePath}/${fileName}`)
      await assertRealPathUnderRoot(root, folder)
      const previous = await lstat(target).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error })
      if (previous) {
        if (job.outputFileName === fileName && !previous.isSymbolicLink() && previous.isFile() && previous.size === jpeg.length && sha(await readFile(target)) === prepared.contentHash) { published = true; break }
        fileName = nextFieldPhotoName(job.kind, [...await readdir(folder), fileName]); continue
      }
      // A new, non-replacing photo needs a stable destination namespace. Requiring
      // attestations for unrelated photos would block the next upload in a batch.
      const freshness = await checkCaseFreshness(config.freshnessGate, root, `${job.relativePath}/${fileName}`, { operation: 'file_destination' })
      if (!freshness.ready) throw new Error('case_not_fresh')
      const staged = await open(stage, 'wx')
      try { await staged.writeFile(jpeg); await staged.sync() } finally { await staged.close() }
      try { await publishWithoutOverwrite(stage, target) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        await unlink(stage)
        const previous = await lstat(target)
        if (!previous.isSymbolicLink() && previous.isFile() && previous.size === jpeg.length && sha(await readFile(target)) === prepared.contentHash && job.outputFileName === fileName) { published = true; break }
        fileName = nextFieldPhotoName(job.kind, [...await readdir(folder), fileName]); continue
      }
      const actual = await readFile(target)
      if (actual.length !== jpeg.length || sha(actual) !== prepared.contentHash) throw new Error('photo_write_failed')
      published = true
      break
    }
    } finally { await unlink(stage).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }) }
    if (!published) throw new Error('photo_write_failed')
    await request(`/${job.id}/jpeg`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'x-upload-lease': job.leaseToken }, body: jpeg })
    await request(`/${job.id}/complete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ leaseToken: job.leaseToken }) })
    return true
  } catch (error) {
    if (signal?.aborted) throw error
    const message = error instanceof Error ? error.message : ''
    const code = ['storage_unavailable','case_not_fresh','unsupported_image','image_too_large','image_conversion_failed','case_location_changed'].includes(message) ? message : 'photo_write_failed'
    await request(`/${job.id}/failure`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ leaseToken: job.leaseToken, code, retryable: ['storage_unavailable','case_not_fresh','photo_write_failed'].includes(code) }) })
    return true
  } finally { await rm(temporary, { recursive: true, force: true }) }
}
