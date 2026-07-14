import { describe, expect, it, vi } from 'vitest'
import { createHttpPolicyPdfTextAdapter, HttpPolicyPdfTextError } from './policyPdfTextHttpAdapter'
import type { PdfPolicySourceRecord, PdfTextSegmentRecord } from './ports'

const CASE = '019f7000-0000-7000-8000-000000000024'
const DOC = '019f7000-0000-7000-8000-000000000025'
const VERSION = '019f7000-0000-7000-8000-000000000026'
const EXTRACTION = '019f7000-0000-7000-8000-000000000027'
const PAGE = '019f7000-0000-7000-8000-000000000028'
const SEGMENT = '019f7000-0000-7000-8000-000000000029'
const source: PdfPolicySourceRecord = { documentId: DOC, documentVersionId: VERSION, versionNumber: 2, displayName: 'Sentetik Poliçe', mimeType: 'application/pdf', byteSize: 1000, status: 'ready', verifiedAt: '2026-07-14T08:00:00.000Z' }
const extraction = { id: EXTRACTION, documentId: DOC, documentVersionId: VERSION, extractionVersion: 1, status: 'ready', parserName: 'pdfjs-dist', parserVersion: '6.1.200', normalizationVersion: 'pdf-text-normalization/1.0.0', offsetUnit: 'unicode_code_point', pageCount: 1, textPageCount: 1, imageOnlyPageCount: 0, emptyPageCount: 0, failedPageCount: 0, segmentCount: 1, rawCharacterCount: 6, normalizedCharacterCount: 6, outputHash: 'a'.repeat(64), failureCode: null, version: 2, createdAt: '2026-07-14T08:00:00.000Z', startedAt: '2026-07-14T08:00:01.000Z', completedAt: '2026-07-14T08:00:02.000Z' }
const segment: PdfTextSegmentRecord = { id: SEGMENT, extractionId: EXTRACTION, pageId: PAGE, pageNumber: 1, segmentIndex: 0, type: 'title', startOffset: 0, endOffset: 6, text: 'POLİÇE', textHash: 'b'.repeat(64) }
function response(status: number, body: unknown) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }) }

describe('Policy PDF Text HttpApiAdapter', () => {
  it('yalnız ready/hash/size/verified Kasko PDF sürümlerini kaynak listesine alır', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => String(input).includes(`/documents/${DOC}`)
      ? response(200, { document: { versions: [{ id: VERSION, versionNumber: 2, displayName: 'Sentetik Poliçe', mimeType: 'application/pdf', extension: 'pdf', byteSize: 1000, status: 'ready', hashVerified: true, sizeVerified: true, verifiedAt: '2026-07-14T08:00:00.000Z' }, { id: 'pending', versionNumber: 1, displayName: 'Bekleyen', mimeType: 'application/pdf', extension: 'pdf', byteSize: 100, status: 'pending', hashVerified: false, sizeVerified: false, verifiedAt: null }] } })
      : response(200, { items: [{ id: DOC, documentType: 'casco_policy' }, { id: 'other', documentType: 'ruhsat' }] })) as unknown as typeof fetch
    expect(await createHttpPolicyPdfTextAdapter({ fetchImpl }).listSources(CASE)).toEqual([source])
  })

  it('create çağrısında kararlı idempotency key ve boş strict gövde gönderir', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(201, { extraction })) as unknown as typeof fetch
    const result = await createHttpPolicyPdfTextAdapter({ fetchImpl }).createExtraction(CASE, source, 'stable-key')
    expect(result.status).toBe('ready')
    const init = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('stable-key')
    expect(JSON.parse(String(init.body))).toEqual({})
  })

  it('bounded segmentten server-doğrulamalı kaynak referansı ister', async () => {
    const sourceReference = { sourceKey: 'pdf-1-0', documentId: DOC, documentVersionId: VERSION, pageNumber: 1, sectionHeading: 'POLİÇE', clauseIdentifier: 'Sayfa 1 / Segment 1', rawExcerpt: 'POLİÇE', locator: `pdf-text:${EXTRACTION}:${PAGE}:0-6`, sourceType: 'policy', confidence: 1, extractionLocator: { extractionId: EXTRACTION, pageId: PAGE, segmentId: SEGMENT, startOffset: 0, endOffset: 6 } }
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { sourceReference })) as unknown as typeof fetch
    expect(await createHttpPolicyPdfTextAdapter({ fetchImpl }).createSourceReference(CASE, EXTRACTION, segment, 'reference-key')).toEqual(sourceReference)
    const body = JSON.parse(String(((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit).body))
    expect(body).toMatchObject({ pageId: PAGE, segmentId: SEGMENT, startOffset: 0, endOffset: 6, sourceType: 'policy' })
  })

  it.each([[401, 'unauthorized'], [403, 'forbidden'], [404, 'not_found'], [409, 'conflict'], [503, 'unavailable']] as const)('HTTP %s durumunu %s sınıflar ve fallback üretmez', async (status, kind) => {
    const adapter = createHttpPolicyPdfTextAdapter({ fetchImpl: vi.fn().mockResolvedValue(response(status, {})) as unknown as typeof fetch })
    await expect(adapter.listSources(CASE)).rejects.toMatchObject({ name: 'HttpPolicyPdfTextError', kind })
  })

  it('ağ kesintisini unavailable olarak güvenli sınırlar', async () => {
    const adapter = createHttpPolicyPdfTextAdapter({ fetchImpl: vi.fn().mockRejectedValue(new TypeError('network')) as unknown as typeof fetch })
    await expect(adapter.listSources(CASE)).rejects.toBeInstanceOf(HttpPolicyPdfTextError)
  })
})
