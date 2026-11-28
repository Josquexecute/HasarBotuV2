import { constants } from 'node:fs'
import { copyFile, lstat, open, readdir, realpath } from 'node:fs/promises'
import { basename, extname, join, relative } from 'node:path'
import { Worker } from 'node:worker_threads'
import { CASE_FOLDER_COPY_LIMIT, idSchema, type CaseFolderBrowseRequest, type CaseFolderEntry, type CaseFolderPreview } from '@hasarbotu/contracts'

const NAME = /^[^<>:"/\\|?*]+$/u
const DEVICE = /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[0-9¹²³]|LPT[0-9¹²³])(?:\.|$)/iu
const SAFE_NAME = (name: string) => name.length <= 255 && NAME.test(name) && !/[. ]$/u.test(name)
  && !DEVICE.test(name) && !Array.from(name).some(character => character.charCodeAt(0) < 32)
const safeName = (value: unknown): value is string => typeof value === 'string' && SAFE_NAME(value)
const safePath = (path: unknown): path is string[] => Array.isArray(path) && path.length <= 64 && path.every(safeName)

export function parseBrowseRequest(value: unknown): CaseFolderBrowseRequest | null {
  if (!value || typeof value !== 'object') return null
  const { caseId, action, path, locationVersion, page, source, names } = value as Record<string, unknown>
  if (!idSchema.safeParse(caseId).success || typeof caseId !== 'string' || !safePath(path)
    || (path.length > 0 && locationVersion === undefined)
    || (locationVersion !== undefined && (typeof locationVersion !== 'number' || !Number.isSafeInteger(locationVersion) || locationVersion < 1))) return null
  const base = { caseId, path, ...(locationVersion === undefined ? {} : { locationVersion }) }
  if (action === 'list' || (action === 'reveal' && path.length)) return { ...base, action }
  if (action === 'preview' && path.length && (page === undefined || (typeof page === 'number' && Number.isSafeInteger(page) && page >= 1))) {
    return { ...base, action, ...(page === undefined ? {} : { page }) }
  }
  if (locationVersion === undefined) return null
  if (action === 'add') return { ...base, action, locationVersion }
  if (action === 'paste' && safePath(source) && source.length < 64 && Array.isArray(names)
    && names.length > 0 && names.length <= CASE_FOLDER_COPY_LIMIT && names.every(safeName)) {
    return { ...base, action, locationVersion, source, names: [...new Set<string>(names)] }
  }
  return null
}

export async function resolveFolderEntry(root: string, path: readonly string[], directory: boolean) {
  const target = join(root, ...path)
  const info = await lstat(target)
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile() || info.nlink > 1)
    || relative(target, await realpath(target)) !== '') {
    throw new Error('Unsafe case folder entry')
  }
  return { target, info }
}

export async function copyCaseFiles(root: string, path: readonly string[], sources: readonly string[], resolveSource: (source: string) => Promise<string>) {
  const directory = await resolveFolderEntry(root, path, true)
  let count = 0
  for (const source of sources) {
    try {
      const target = await resolveSource(source)
      const name = basename(target)
      if (!SAFE_NAME(name)) continue
      const extension = extname(name)
      const stem = name.slice(0, name.length - extension.length)
      for (let attempt = 1; attempt <= 1000; attempt++) {
        const suffix = attempt === 1 ? '' : ` (${attempt})`
        const copyName = `${stem.slice(0, 255 - extension.length - suffix.length)}${suffix}${extension}`
        if (!SAFE_NAME(copyName)) break
        const current = await resolveFolderEntry(root, path, true)
        if (current.info.dev !== directory.info.dev || current.info.ino !== directory.info.ino) throw new Error('Destination changed')
        try {
          // The exclusive native copy preserves Windows file metadata and never replaces an existing entry.
          await copyFile(target, join(directory.target, copyName), constants.COPYFILE_EXCL)
          count++
          break
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code
          if (code !== 'EEXIST') throw error
        }
      }
    } catch {
      // A missing source or denied write should not discard other files in the batch.
    }
  }
  return { kind: 'copied' as const, count, skipped: sources.length - count }
}

const ordered = new Intl.Collator('tr-TR', { numeric: true, sensitivity: 'base' })

export async function listFolderEntries(target: string): Promise<CaseFolderEntry[]> {
  const items = (await readdir(target, { withFileTypes: true }))
    .filter(entry => SAFE_NAME(entry.name) && (entry.isDirectory() || entry.isFile()))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || ordered.compare(a.name, b.name))
  const result: CaseFolderEntry[] = []
  for (let index = 0; index < items.length; index += 32) {
    const batch = await Promise.all(items.slice(index, index + 32).map(async (item): Promise<CaseFolderEntry | null> => {
      if (item.isDirectory()) return { name: item.name, kind: 'directory' }
      const info = await lstat(join(target, item.name)).catch(() => null)
      if (info && !info.isFile()) return null
      return { name: item.name, kind: 'file', size: info?.size ?? null, modifiedAt: info?.mtime.toISOString() ?? null }
    }))
    for (const entry of batch) if (entry) result.push(entry)
  }
  return result
}

const IMAGE_TYPES = new Map([
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'], ['.gif', 'image/gif'], ['.bmp', 'image/bmp'], ['.avif', 'image/avif'],
])
const TEXT_TYPES = new Set(['.txt', '.csv', '.log', '.json', '.xml'])
const TEXT_LIMIT = 64 * 1024
const MEDIA_LIMIT = 20 * 1024 * 1024

function decodeText(bytes: Uint8Array, truncated: boolean) {
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
    : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8'
  try { return new TextDecoder(encoding, { fatal: true }).decode(bytes, { stream: truncated }) }
  catch { return new TextDecoder('windows-1254').decode(bytes) }
}

type PreviewJob = { format: 'pdf'; page: number } | { format: 'docx' | 'xlsx' }
let activePreviews = 0

async function renderDocument(bytes: Buffer, job: PreviewJob): Promise<CaseFolderPreview> {
  if (activePreviews >= 2) throw new Error('Document preview capacity reached')
  const workerUrl = job.format === 'pdf' ? './case-folder-pdf-worker.js' : './case-folder-office-worker.js'
  const worker = new Worker(new URL(workerUrl, import.meta.url), {
    workerData: { ...job, bytes: Uint8Array.from(bytes) },
    resourceLimits: { maxOldGenerationSizeMb: 128 },
  })
  activePreviews++
  try {
    return await new Promise<CaseFolderPreview>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Document preview timed out')), 12_000)
      const finish = () => clearTimeout(timeout)
      worker.once('message', (preview: CaseFolderPreview) => { finish(); resolve(preview) })
      worker.once('error', error => { finish(); reject(error) })
      worker.once('exit', () => { finish(); reject(new Error('Document preview did not finish')) })
    })
  } finally {
    await worker.terminate().finally(() => { activePreviews-- })
  }
}

export async function previewFolderFile(target: string, info: Awaited<ReturnType<typeof lstat>>, page = 1): Promise<CaseFolderPreview> {
  const extension = extname(basename(target)).toLowerCase()
  const mime = IMAGE_TYPES.get(extension)
  const text = TEXT_TYPES.has(extension)
  const pdf = extension === '.pdf'
  const office = extension === '.docx' || extension === '.xlsx'
  if ((!mime && !text && !pdf && !office) || (!text && info.size > MEDIA_LIMIT)) return { kind: 'unsupported' }

  const file = await open(target, 'r')
  let bytes: Buffer
  let truncated: boolean
  try {
    const opened = await file.stat()
    if (!opened.isFile() || opened.nlink > 1 || opened.dev !== info.dev || opened.ino !== info.ino
      || relative(target, await realpath(target)) !== '') throw new Error('Case folder entry changed')
    if (!text && opened.size > MEDIA_LIMIT) return { kind: 'unsupported' }
    const limit = text ? TEXT_LIMIT : MEDIA_LIMIT
    const buffer = Buffer.alloc(Math.min(opened.size, limit) + 1)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    truncated = opened.size > limit || offset > limit
    bytes = buffer.subarray(0, Math.min(offset, limit))
  } finally { await file.close() }
  if (text) return { kind: 'text', text: decodeText(bytes, truncated), ...(truncated ? { truncated } : {}) }
  if (truncated) return { kind: 'unsupported' }
  if (pdf) return renderDocument(bytes, { format: 'pdf', page })
  if (office) return renderDocument(bytes, { format: extension === '.docx' ? 'docx' : 'xlsx' })
  return { kind: 'image', src: `data:${mime};base64,${bytes.toString('base64')}` }
}
