import { createReadStream, createWriteStream } from 'node:fs'
import { access, lstat, mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { Worker } from 'node:worker_threads'
import type { JobPayload, PdfExtractionChunkRequest, PdfExtractionResultSummary } from '@hasarbotu/contracts'
import { assertRealPathUnderRoot, PathSafetyError, resolveUnderRoot } from './path-resolver.js'
import { streamSha256 } from './verifier.js'
import type { PdfParserWorkerInput, PdfParserWorkerMessage } from './pdf-parser-protocol.js'

type Payload = Extract<JobPayload, { readonly kind: 'pdf_text_extraction' }>

export interface PdfTextExtractionResult {
  readonly outcome: 'verified' | 'failed'
  readonly errorCode?: string
  readonly pdfExtraction?: PdfExtractionResultSummary
  readonly observedHash?: undefined
  readonly observedSize?: undefined
}

export interface PdfTextExtractorHooks {
  readonly onChunk: (chunk: PdfExtractionChunkRequest) => Promise<void>
  readonly onHeartbeat?: () => Promise<void>
  readonly workerUrl?: URL
}

function errno(error: unknown): string | undefined { return (error as NodeJS.ErrnoException).code }

async function defaultWorkerUrl(): Promise<{ url: URL; execArgv?: string[] }> {
  const compiled = new URL('./pdf-parser-worker.js', import.meta.url)
  try {
    await access(fileURLToPath(compiled))
    return { url: compiled }
  } catch {
    return { url: new URL('./pdf-parser-worker.ts', import.meta.url), execArgv: ['--import', 'tsx'] }
  }
}

async function assertNoReparseComponents(rootAbsolute: string, relativePath: string): Promise<void> {
  let current = rootAbsolute
  for (const component of relativePath.split('/')) {
    current = join(current, component)
    const metadata = await lstat(current)
    if (metadata.isSymbolicLink()) throw new PathSafetyError('reparse_point_rejected', 'reparse point is not allowed')
  }
}

async function runIsolatedParser(
  input: PdfParserWorkerInput,
  payload: Payload,
  hooks: PdfTextExtractorHooks,
): Promise<PdfExtractionResultSummary> {
  const target = hooks.workerUrl === undefined ? await defaultWorkerUrl() : { url: hooks.workerUrl }
  return new Promise((resolvePromise, rejectPromise) => {
    const worker = new Worker(target.url, {
      workerData: input,
      ...(target.execArgv === undefined ? {} : { execArgv: target.execArgv }),
      resourceLimits: { maxOldGenerationSizeMb: payload.workerMemoryMb, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
      name: `pdf-extract-${payload.extractionId}`,
    })
    let sequence = 0
    let settled = false
    let uploads = Promise.resolve()
    const stopAndReject = async (error: Error): Promise<void> => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      await worker.terminate().catch(() => undefined)
      rejectPromise(error)
    }
    const stopAndResolve = async (summary: PdfExtractionResultSummary): Promise<void> => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      await worker.terminate().catch(() => undefined)
      resolvePromise(summary)
    }
    const timeout = setTimeout(() => {
      void stopAndReject(new Error('parser_timeout'))
    }, payload.timeoutMs)
    worker.on('message', (message: PdfParserWorkerMessage) => {
      if (settled) return
      if (message.kind === 'page') {
        const chunk: PdfExtractionChunkRequest = {
          extractionId: payload.extractionId,
          extractionVersion: payload.extractionVersion,
          sequence,
          pages: [message.page],
        }
        sequence += 1
        uploads = uploads.then(async () => { await hooks.onHeartbeat?.(); await hooks.onChunk(chunk) })
        uploads.catch(() => {
          void stopAndReject(new Error('chunk_upload_failed'))
        })
        return
      }
      if (message.kind === 'error') {
        void stopAndReject(new Error(message.errorCode))
        return
      }
      void uploads.then(() => {
        return stopAndResolve(message.summary)
      }).catch(() => stopAndReject(new Error('chunk_upload_failed')))
    })
    worker.on('error', () => {
      void stopAndReject(new Error('worker_crashed'))
    })
    worker.on('exit', (code) => {
      if (settled || code === 0) return
      settled = true
      clearTimeout(timeout)
      rejectPromise(new Error('worker_crashed'))
    })
  })
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (/^[a-z0-9_]{1,64}$/.test(message)) return message
  if (error instanceof PathSafetyError) return error.code
  if (errno(error) === 'ENOENT') return 'source_missing'
  if (errno(error) === 'EACCES' || errno(error) === 'EPERM') return 'access_denied'
  return 'extraction_failed'
}

export async function extractPdfText(
  rootAbsolute: string,
  payload: Payload,
  hooks: PdfTextExtractorHooks,
): Promise<PdfTextExtractionResult> {
  let temporaryDirectory: string | undefined
  try {
    const candidate = resolveUnderRoot(rootAbsolute, payload.relativePath)
    await assertNoReparseComponents(rootAbsolute, payload.relativePath)
    const realSource = await assertRealPathUnderRoot(rootAbsolute, candidate)
    const metadata = await lstat(realSource)
    if (metadata.isSymbolicLink()) return { outcome: 'failed', errorCode: 'reparse_point_rejected' }
    if (!metadata.isFile()) return { outcome: 'failed', errorCode: 'not_a_file' }
    if (metadata.size > payload.maxSourceBytes) return { outcome: 'failed', errorCode: 'source_size_limit_exceeded' }
    const observed = await streamSha256(realSource)
    if (observed.hash !== payload.declaredHash || observed.size !== payload.declaredSize) return { outcome: 'failed', errorCode: 'source_changed' }
    const handle = await open(realSource, 'r')
    const magic = Buffer.alloc(5)
    try { await handle.read(magic, 0, magic.length, 0) } finally { await handle.close() }
    if (magic.toString('ascii') !== '%PDF-') return { outcome: 'failed', errorCode: 'invalid_pdf_magic' }

    temporaryDirectory = await mkdtemp(join(tmpdir(), 'hasarbotu-pdf-'))
    const temporaryPdf = join(temporaryDirectory, 'source.pdf')
    await pipeline(createReadStream(realSource), createWriteStream(temporaryPdf, { flags: 'wx' }))
    const copied = await streamSha256(temporaryPdf)
    if (copied.hash !== observed.hash || copied.size !== observed.size) return { outcome: 'failed', errorCode: 'temporary_copy_mismatch' }
    const summary = await runIsolatedParser({
      filePath: temporaryPdf,
      extractionId: payload.extractionId,
      extractionVersion: payload.extractionVersion,
      sourceHash: observed.hash,
      sourceSize: observed.size,
      maxPages: payload.maxPages,
      maxPageCharacters: payload.maxPageCharacters,
      maxTotalCharacters: payload.maxTotalCharacters,
    }, payload, hooks)
    return { outcome: 'verified', pdfExtraction: summary }
  } catch (error) {
    return { outcome: 'failed', errorCode: safeError(error) }
  } finally {
    if (temporaryDirectory !== undefined) await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined)
  }
}
