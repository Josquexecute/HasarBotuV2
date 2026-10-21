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
  it.each(['6.1.200', '6.2.108', '6.4.299'])('preserves parser %s when reading historical and current evidence', async (parserVersion) => {
    const adapter = createHttpPolicyPdfTextAdapter({ fetchImpl: vi.fn().mockResolvedValue(response(200, { items: [{ ...extraction, parserVersion }] })) as typeof fetch })
    expect((await adapter.listExtractions(CASE, source))[0]?.parserVersion).toBe(parserVersion)
  })

  it('rejects an unsupported parser identity instead of displaying mislabelled evidence', async () => {
    const adapter = createHttpPolicyPdfTextAdapter({ fetchImpl: vi.fn().mockResolvedValue(response(200, { items: [{ ...extraction, parserVersion: 'latest' }] })) as typeof fetch })
    await expect(adapter.listExtractions(CASE, source)).rejects.toMatchObject({ kind: 'unavailable' })
  })

  it('keeps readable page text beyond page 100', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const pageNumber = Number(new URL(String(input), 'http://localhost').searchParams.get('page'))
      return response(200, {
        items: Array.from({ length: pageNumber === 1 ? 100 : 1 }, (_, index) => ({
          id: `page-${pageNumber}-${index}`, pageNumber: (pageNumber - 1) * 100 + index + 1,
          status: 'text', rawText: 'POLICE', normalizedText: 'POLICE', segmentCount: 1,
        })), pageInfo: { page: pageNumber, totalPages: 2 },
      })
    })
    const items = await createHttpPolicyPdfTextAdapter({ fetchImpl }).listPages(CASE, EXTRACTION)
    expect(items).toHaveLength(101)
    expect(items.at(-1)?.pageNumber).toBe(101)
  })

  it('reads every segment page rather than silently truncating evidence at 100 segments', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const page = Number(new URL(String(input), 'http://localhost').searchParams.get('page'))
      return response(200, {
        items: Array.from({ length: page === 3 ? 1 : 100 }, (_, index) => ({ ...segment, id: `segment-${(page - 1) * 100 + index}` })),
        pageInfo: { page, pageSize: 100, totalItems: 201, totalPages: 3 },
      })
    })
    const items = await createHttpPolicyPdfTextAdapter({ fetchImpl }).listSegments(CASE, EXTRACTION, 1)
    expect(items).toHaveLength(201)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(fetchImpl.mock.calls.every(([url]) => String(url).endsWith('&pageNumber=1'))).toBe(true)
  })

  it('finds policy sources beyond the first hundred documents', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes(`/documents/${DOC}`)) return response(200, { document: { versions: [{ ...source, id: VERSION, extension: 'pdf', hashVerified: true, sizeVerified: true }] } })
      const page = Number(new URL(url, 'http://localhost').searchParams.get('page'))
      return response(200, { items: page === 1 ? [{ id: 'other', documentType: 'ruhsat' }] : [{ id: DOC, documentType: 'casco_policy' }], pageInfo: { page, totalPages: 2 } })
    })
    expect(await createHttpPolicyPdfTextAdapter({ fetchImpl }).listSources(CASE)).toEqual([source])
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('rejects a repeating pagination response instead of looping indefinitely', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response(200, { items: [], pageInfo: { page: 1, totalPages: 2 } }))
    await expect(createHttpPolicyPdfTextAdapter({ fetchImpl }).listPages(CASE, EXTRACTION)).rejects.toMatchObject({ kind: 'unavailable' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

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
