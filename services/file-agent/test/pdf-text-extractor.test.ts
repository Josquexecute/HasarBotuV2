import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { JobPayload, PdfExtractionChunkRequest } from '@hasarbotu/contracts'
import { extractPdfText } from '../src/pdf-text-extractor.js'

type PdfPage = { readonly kind: 'text'; readonly text: string } | { readonly kind: 'image' } | { readonly kind: 'empty' }

function streamObject(content: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`, 'ascii'), content, Buffer.from('\nendstream', 'ascii')])
}

function syntheticPdf(pages: readonly PdfPage[], options: { readonly encrypted?: boolean } = {}): Buffer {
  const objects: Buffer[] = []
  const pageIds = pages.map((_, index) => 4 + index * 2)
  objects[0] = Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'ascii')
  objects[1] = Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`, 'ascii')
  objects[2] = Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', 'ascii')
  for (const [index, page] of pages.entries()) {
    const pageId = pageIds[index]!
    const contentId = pageId + 1
    objects[pageId - 1] = Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`, 'ascii')
    const content = page.kind === 'text'
      ? Buffer.from(`BT /F1 14 Tf 50 750 Td (${page.text.replace(/[\\()]/g, '\\$&')}) Tj ET`, 'ascii')
      : page.kind === 'image'
        ? Buffer.from('q BI /W 1 /H 1 /CS /G /BPC 8 ID \x00 EI Q', 'binary')
        : Buffer.from('q Q', 'ascii')
    objects[contentId - 1] = streamObject(content)
  }
  const encryptionObjectId = options.encrypted ? objects.length + 1 : null
  if (encryptionObjectId !== null) objects.push(Buffer.from(`<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${'00'.repeat(32)}> /U <${'11'.repeat(32)}> /P -4 >>`, 'ascii'))
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%synthetic\n', 'ascii')]
  const offsets = [0]
  for (let index = 0; index < objects.length; index += 1) {
    const object = objects[index]
    if (object === undefined) throw new Error(`missing object ${index + 1}`)
    offsets.push(parts.reduce((total, part) => total + part.length, 0))
    parts.push(Buffer.from(`${index + 1} 0 obj\n`, 'ascii'), object, Buffer.from('\nendobj\n', 'ascii'))
  }
  const xrefOffset = parts.reduce((total, part) => total + part.length, 0)
  const encryptionTrailer = encryptionObjectId === null ? '' : ` /Encrypt ${encryptionObjectId} 0 R /ID [<${'22'.repeat(16)}><${'22'.repeat(16)}>]`
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R${encryptionTrailer} >>\nstartxref\n${xrefOffset}\n%%EOF\n`, 'ascii'))
  return Buffer.concat(parts)
}

const extractionId = '00000000-0000-4000-8000-000000000024'
function payload(pdf: Buffer, overrides: Partial<Extract<JobPayload, { kind: 'pdf_text_extraction' }>> = {}): Extract<JobPayload, { kind: 'pdf_text_extraction' }> {
  return {
    kind: 'pdf_text_extraction', extractionId, extractionVersion: 1, storageRootKey: 'test-root', relativePath: 'EVRAK/policy.pdf',
    declaredHash: createHash('sha256').update(pdf).digest('hex'), declaredSize: pdf.length, parserVersion: '6.1.200', normalizationVersion: 'pdf-text-normalization/1.0.0',
    maxSourceBytes: 2_000_000, maxPages: 20, maxPageCharacters: 20_000, maxTotalCharacters: 100_000, timeoutMs: 20_000, workerMemoryMb: 192,
    ...overrides,
  }
}

describe('güvenli PDF metin çıkarıcı', () => {
  let base: string
  let root: string
  beforeEach(async () => { base = await mkdtemp(join(tmpdir(), 'hb-pdf-test-')); root = join(base, 'root'); await mkdir(join(root, 'EVRAK'), { recursive: true }) })
  afterEach(async () => { await rm(base, { recursive: true, force: true }) })

  async function run(pdf: Buffer, overrides = {}, workerUrl?: URL) {
    await writeFile(join(root, 'EVRAK', 'policy.pdf'), pdf)
    const chunks: PdfExtractionChunkRequest[] = []
    const result = await extractPdfText(root, payload(pdf, overrides), { ...(workerUrl === undefined ? {} : { workerUrl }), onChunk: async (chunk) => { chunks.push(chunk) } })
    return { result, chunks }
  }

  it('metin katmanlı sentetik PDF için raw/normalized sayfa, segment ve exact parser sürümü üretir', async () => {
    const pdf = syntheticPdf([{ kind: 'text', text: 'KASKO POLICE OZEL SART' }])
    const first = await run(pdf)
    expect(first.result.outcome, JSON.stringify(first.result)).toBe('verified')
    expect(first.result.pdfExtraction).toMatchObject({ status: 'ready', parserVersion: '6.1.200', normalizationVersion: 'pdf-text-normalization/1.0.0', pageCount: 1, textPageCount: 1, segmentCount: 1 })
    expect(first.chunks[0]?.pages[0]).toMatchObject({ pageNumber: 1, status: 'text', normalizedText: 'KASKO POLICE OZEL SART' })
    const second = await run(pdf)
    expect(second.result.pdfExtraction?.outputHash).toBe(first.result.pdfExtraction?.outputHash)
  })

  it('görsel-only ve mixed PDF durumlarını OCR gerekli/kısmi olarak ayırır', async () => {
    const image = await run(syntheticPdf([{ kind: 'image' }]))
    expect(image.result.pdfExtraction).toMatchObject({ status: 'ocr_required', imageOnlyPageCount: 1, textPageCount: 0 })
    const mixed = await run(syntheticPdf([{ kind: 'text', text: 'POLICE' }, { kind: 'image' }]))
    expect(mixed.result.pdfExtraction).toMatchObject({ status: 'partial', imageOnlyPageCount: 1, textPageCount: 1 })
    expect(mixed.chunks.map((chunk) => chunk.sequence)).toEqual([0, 1])
  })

  it('bozuk, PDF olmayan, değişmiş ve limit aşan kaynağı güvenli kodla reddeder', async () => {
    const malformed = await run(Buffer.from('%PDF-not-a-real-document', 'ascii'))
    expect(malformed.result).toEqual({ outcome: 'failed', errorCode: 'malformed_pdf' })
    const notPdf = Buffer.from('not-pdf', 'ascii')
    const invalid = await run(notPdf)
    expect(invalid.result).toEqual({ outcome: 'failed', errorCode: 'invalid_pdf_magic' })
    const valid = syntheticPdf([{ kind: 'text', text: 'POLICE' }])
    const changed = await run(valid, { declaredHash: 'a'.repeat(64) })
    expect(changed.result).toEqual({ outcome: 'failed', errorCode: 'source_changed' })
    const limited = await run(valid, { maxSourceBytes: valid.length - 1 })
    expect(limited.result).toEqual({ outcome: 'failed', errorCode: 'source_size_limit_exceeded' })
  })

  it('parola korumalı sentetik PDF içeriğini açmaya çalışmadan encrypted_pdf döndürür', async () => {
    const encrypted = await run(syntheticPdf([{ kind: 'text', text: 'GIZLI SENTETIK METIN' }], { encrypted: true }))
    expect(encrypted.result).toEqual({ outcome: 'failed', errorCode: 'encrypted_pdf' })
    expect(encrypted.chunks).toEqual([])
  })

  it('çıktı limiti ve izole worker timeout durumunda temp kalıntısı bırakmaz', async () => {
    const pdf = syntheticPdf([{ kind: 'text', text: 'UZUN POLICE METNI' }])
    const limited = await run(pdf, { maxPageCharacters: 5 })
    expect(limited.result).toEqual({ outcome: 'failed', errorCode: 'output_limit_exceeded' })
    const before = (await readdir(tmpdir())).filter((name) => name.startsWith('hasarbotu-pdf-')).sort()
    const timeout = await run(pdf, { timeoutMs: 1_000 }, new URL('./fixtures/hanging-worker.mjs', import.meta.url))
    expect(timeout.result).toEqual({ outcome: 'failed', errorCode: 'parser_timeout' })
    const after = (await readdir(tmpdir())).filter((name) => name.startsWith('hasarbotu-pdf-')).sort()
    expect(after).toEqual(before)
  })

  it('symlink/reparse kaynak bileşenini root içinde olsa bile reddeder', async () => {
    const pdf = syntheticPdf([{ kind: 'text', text: 'POLICE' }])
    const targetDirectory = join(base, 'junction-target')
    await mkdir(targetDirectory)
    await writeFile(join(targetDirectory, 'policy.pdf'), pdf)
    await rm(join(root, 'EVRAK'), { recursive: true, force: true })
    try {
      await symlink(targetDirectory, join(root, 'EVRAK'), 'junction')
    } catch (error) {
      throw new Error(`sentetik symlink oluşturulamadı: ${(error as NodeJS.ErrnoException).code ?? 'unknown'}`)
    }
    const result = await extractPdfText(root, payload(pdf), { onChunk: async () => undefined })
    expect(result).toEqual({ outcome: 'failed', errorCode: 'reparse_point_rejected' })
  })

  it('API/sonuç yüzeyine mutlak root veya kaynak içeriği sızdırmaz', async () => {
    const pdf = syntheticPdf([{ kind: 'text', text: 'SENTETIK POLICE' }])
    const { result } = await run(pdf, { timeoutMs: 1_000 }, new URL('./fixtures/hanging-worker.mjs', import.meta.url))
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(root)
    expect(serialized).not.toContain('SENTETIK POLICE')
  })
})
