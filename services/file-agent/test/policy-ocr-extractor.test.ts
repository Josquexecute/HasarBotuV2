import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createCanvas, loadImage, PDFDocument } from '@napi-rs/canvas'
import { afterEach, describe, expect, it } from 'vitest'
import type { JobPayload, PolicyOcrChunkRequest } from '@hasarbotu/contracts'
import { policyOcrLanguageDataHash } from '@hasarbotu/domain'
import { extractPolicyOcr } from '../src/policy-ocr-extractor.js'
import { streamSha256 } from '../src/verifier.js'

type Payload = Extract<JobPayload, { readonly kind: 'policy_ocr' }>
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true }))) })
async function root() { const value = await mkdtemp(join(tmpdir(), 'hb-policy-ocr-test-')); roots.push(value); return value }

async function scannedPdf(directory: string, text = 'KASKO POLICESI CAM TEMINATI') {
  const canvas = createCanvas(1500, 2100)
  const context = canvas.getContext('2d')
  context.fillStyle = 'white'; context.fillRect(0, 0, 1500, 2100)
  context.fillStyle = 'black'; context.font = 'bold 72px Arial'; context.fillText(text, 80, 180)
  context.font = '48px Arial'; context.fillText('Muafiyet kontrol gerektirir', 80, 300)
  const image = await loadImage(canvas.toBuffer('image/png'))
  const pdf = new PDFDocument({ rasterDPI: 144 })
  const page = pdf.beginPage(750, 1050)
  ;(page as unknown as { drawImage: (source: typeof image, x: number, y: number, width: number, height: number) => void }).drawImage(image, 0, 0, 750, 1050)
  pdf.endPage()
  const path = join(directory, 'policy.pdf')
  await writeFile(path, pdf.close())
  return path
}

async function variantPdf(directory: string, options: { text: string; foreground?: string; background?: string; rotate180?: boolean; secondColumn?: string }) {
  const canvas = createCanvas(1500, 2100)
  const context = canvas.getContext('2d')
  context.fillStyle = options.background ?? 'white'; context.fillRect(0, 0, 1500, 2100)
  if (options.rotate180) { context.translate(1500, 2100); context.rotate(Math.PI) }
  context.fillStyle = options.foreground ?? 'black'; context.font = 'bold 64px Arial'; context.fillText(options.text, 70, 180)
  context.font = '44px Arial'; context.fillText('POLICE KOSULLARI', 70, 300)
  if (options.secondColumn !== undefined) { context.fillText(options.secondColumn, 820, 300); context.fillText('EK SARTLAR', 820, 390) }
  const image = await loadImage(canvas.toBuffer('image/png'))
  const pdf = new PDFDocument({ rasterDPI: 144 }); const page = pdf.beginPage(750, 1050)
  ;(page as unknown as { drawImage: (source: typeof image, x: number, y: number, width: number, height: number) => void }).drawImage(image, 0, 0, 750, 1050)
  pdf.endPage(); const path = join(directory, 'policy.pdf'); await writeFile(path, pdf.close()); return path
}

async function payload(directory: string): Promise<Payload> {
  const observed = await streamSha256(join(directory, 'policy.pdf'))
  return { kind: 'policy_ocr', ocrRunId: '01900000-0000-7000-8000-000000000001', ocrRunVersion: 1, textExtractionId: '01900000-0000-7000-8000-000000000002', storageRootKey: 'test', relativePath: 'policy.pdf', declaredHash: observed.hash, declaredSize: observed.size, languageMode: 'tur+eng', languageDataVersion: 'tessdata-4.0.0-full/1.0.0', languageDataHash: policyOcrLanguageDataHash('tur+eng'), engineVersion: '7.0.0', renderProfile: 'standard', renderProfileVersion: 'policy-ocr-render-standard/1.0.0', preprocessingVersion: 'policy-ocr-preprocessing/1.0.0', qualityVersion: 'policy-ocr-quality/1.0.0', normalizationVersion: 'policy-ocr-normalization/1.0.0', locatorVersion: 'policy-ocr-locator/1.0.0', renderDpi: 300, eligiblePages: [{ textPageId: '01900000-0000-7000-8000-000000000003', pageNumber: 1, sourcePageStatus: 'image_only' }], maxSourceBytes: 64 * 1024 * 1024, maxImagePixels: 30_000_000, maxPageCharacters: 200_000, maxTotalCharacters: 5_000_000, maxElementsPerPage: 20_000, timeoutMs: 300_000, workerMemoryMb: 512 }
}

describe('yerel policy OCR File Agent hattı', () => {
  it('sentetik görüntü PDF’sini yerel tur+eng modelle raw/normalized metin ve geometriye dönüştürür', async () => {
    const directory = await root(); await scannedPdf(directory)
    const chunks: PolicyOcrChunkRequest[] = []
    const phases: string[] = []
    const result = await extractPolicyOcr(directory, await payload(directory), { onChunk: async (chunk) => { chunks.push(chunk) }, onHeartbeat: async (phase) => { phases.push(phase) } })
    expect(result.outcome).toBe('verified')
    expect(result.policyOcr).toMatchObject({ status: 'ready', engineVersion: '7.0.0', languageDataVersion: 'tessdata-4.0.0-full/1.0.0', renderProfileVersion: 'policy-ocr-render-standard/1.0.0', locatorVersion: 'policy-ocr-locator/1.0.0', eligiblePageCount: 1, processedPageCount: 1, readyPageCount: 1 })
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.pages[0]).toMatchObject({ status: 'accepted_candidate', qualityStatus: 'high', readingOrderQuality: 'reliable', compositeStatus: 'ocr_only' })
    expect(chunks[0]?.pages[0]?.normalizedText).toContain('KASKO POLİCESİ')
    expect(chunks[0]?.pages[0]?.rawOcrText.length).toBeGreaterThan(0)
    expect(chunks[0]?.pages[0]?.elements.some((item) => item.type === 'word' && item.bbox.width > 0)).toBe(true)
    expect(phases).toEqual(expect.arrayContaining(['rendering', 'preprocessing', 'recognizing', 'normalizing', 'validating']))
    expect(JSON.stringify({ result, chunks })).not.toMatch(/[A-Z]:\\|\\\\|secret|traineddata/i)
  }, 30_000)

  it('model checksum uyuşmazlığını worker başlamadan fail-closed reddeder', async () => {
    const directory = await root(); await scannedPdf(directory); const input = await payload(directory)
    expect(await extractPolicyOcr(directory, { ...input, languageDataHash: 'f'.repeat(64) }, { onChunk: async () => undefined })).toEqual({ outcome: 'failed', errorCode: 'language_asset_hash_mismatch' })
  })

  it('kaynak hash değişikliğini, traversal ve motor sürümü sapmasını reddeder', async () => {
    const directory = await root(); await scannedPdf(directory); const input = await payload(directory)
    expect(await extractPolicyOcr(directory, { ...input, declaredHash: 'f'.repeat(64) }, { onChunk: async () => undefined })).toEqual({ outcome: 'failed', errorCode: 'source_changed' })
    expect((await extractPolicyOcr(directory, { ...input, relativePath: '../policy.pdf' } as Payload, { onChunk: async () => undefined })).errorCode).toBe('unsafe_relative_path')
    expect((await extractPolicyOcr(directory, { ...input, engineVersion: '8.0.0' } as unknown as Payload, { onChunk: async () => undefined })).errorCode).toBe('engine_version_mismatch')
  })

  it('görsel piksel limitinde kaynak üretmeden güvenli limit kodu döndürür', async () => {
    const directory = await root(); await scannedPdf(directory); const input = await payload(directory)
    expect(await extractPolicyOcr(directory, { ...input, maxImagePixels: 100 }, { onChunk: async () => undefined })).toEqual({ outcome: 'failed', errorCode: 'image_pixel_limit_exceeded' })
  })

  it('worker timeout/crash durumlarında ana Agent yaşar ve operation temp dizinini temizler', async () => {
    const directory = await root(); await scannedPdf(directory); const input = await payload(directory)
    const before = new Set((await readdir(tmpdir())).filter((name) => name.startsWith('hasarbotu-ocr-')))
    const timeoutWorker = join(directory, 'timeout-worker.mjs')
    await writeFile(timeoutWorker, 'setInterval(() => undefined, 1000)\n')
    const timedOut = await extractPolicyOcr(directory, { ...input, timeoutMs: 50 }, { onChunk: async () => undefined, workerUrl: pathToFileURL(timeoutWorker) })
    expect(timedOut).toEqual({ outcome: 'failed', errorCode: 'ocr_timeout' })
    const crashWorker = join(directory, 'crash-worker.mjs')
    await writeFile(crashWorker, 'throw new Error("synthetic crash")\n')
    const crashed = await extractPolicyOcr(directory, input, { onChunk: async () => undefined, workerUrl: pathToFileURL(crashWorker) })
    expect(crashed).toEqual({ outcome: 'failed', errorCode: 'worker_crashed' })
    const after = (await readdir(tmpdir())).filter((name) => name.startsWith('hasarbotu-ocr-') && !before.has(name))
    expect(after).toEqual([])
  }, 30_000)

  it.each([
    ['tur', 'KASKO POLİÇESİ TEMİNATI', /KASKO/u],
    ['eng', 'CASCO POLICY GLASS COVERAGE', /GLASS COVERAGE/u],
    ['tur+eng', 'KASKO POLICY CAM COVERAGE', /CAM COVERAGE/u],
  ] as const)('%s yerel dil varlığıyla sentetik metni okur', async (languageMode, text, expected) => {
    const directory = await root(); await variantPdf(directory, { text }); const input = await payload(directory)
    const chunks: PolicyOcrChunkRequest[] = []
    const result = await extractPolicyOcr(directory, { ...input, languageMode, languageDataHash: policyOcrLanguageDataHash(languageMode) }, { onChunk: async (chunk) => { chunks.push(chunk) } })
    expect(result.outcome).toBe('verified')
    expect(chunks[0]?.pages[0]?.normalizedText).toMatch(expected)
    expect(chunks[0]?.pages[0]?.languageMode).toBe(languageMode)
  }, 30_000)

  it('rotated, düşük kontrast ve çok sütunlu sentetik sayfaları fail-closed kaliteyle işler', async () => {
    const rotatedRoot = await root(); await variantPdf(rotatedRoot, { text: 'ROTATED POLICY', rotate180: true }); const rotatedChunks: PolicyOcrChunkRequest[] = []
    expect((await extractPolicyOcr(rotatedRoot, await payload(rotatedRoot), { onChunk: async (chunk) => { rotatedChunks.push(chunk) } })).outcome).toBe('verified')
    expect(rotatedChunks[0]?.pages[0]?.normalizedText.length).toBeGreaterThan(0)
    expect([0, 180]).toContain(rotatedChunks[0]?.pages[0]?.rotationDegrees)

    const contrastRoot = await root(); await variantPdf(contrastRoot, { text: 'LOW CONTRAST POLICY', foreground: '#b8b8b8', background: '#eeeeee' }); const contrastChunks: PolicyOcrChunkRequest[] = []
    expect((await extractPolicyOcr(contrastRoot, await payload(contrastRoot), { onChunk: async (chunk) => { contrastChunks.push(chunk) } })).outcome).toBe('verified')
    expect(contrastChunks[0]?.pages[0]?.normalizedText).toContain('CONTRAST')

    const columnsRoot = await root(); await variantPdf(columnsRoot, { text: 'LEFT COLUMN POLICY', secondColumn: 'RIGHT COLUMN LIMIT' }); const columnChunks: PolicyOcrChunkRequest[] = []
    expect((await extractPolicyOcr(columnsRoot, await payload(columnsRoot), { onChunk: async (chunk) => { columnChunks.push(chunk) } })).outcome).toBe('verified')
    expect(columnChunks[0]?.pages[0]?.normalizedText).toMatch(/LEFT|RIGHT/u)
    if (columnChunks[0]?.pages[0]?.readingOrderQuality === 'ambiguous') expect(columnChunks[0]?.pages[0]?.requiresHumanReview).toBe(true)
  }, 90_000)
})
