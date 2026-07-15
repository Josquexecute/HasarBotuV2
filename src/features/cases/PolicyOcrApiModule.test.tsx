import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PolicyOcrApiModule } from './PolicyOcrApiModule'

const CASE = '019f8000-0000-7000-8000-000000000001'
const DOC = '019f8000-0000-7000-8000-000000000002'
const VERSION = '019f8000-0000-7000-8000-000000000003'
const EXTRACTION = '019f8000-0000-7000-8000-000000000004'
const RUN = '019f8000-0000-7000-8000-000000000005'
const PAGE = '019f8000-0000-7000-8000-000000000006'
const BLOCK = '019f8000-0000-7000-8000-000000000007'
const LINE = '019f8000-0000-7000-8000-000000000008'
const HASH = 'a'.repeat(64)
const DATE = '2026-07-15T09:00:00.000Z'

const extraction = { id: EXTRACTION, documentId: DOC, documentVersionId: VERSION, extractionVersion: 1, status: 'ocr_required', parserName: 'pdfjs-dist', parserVersion: '6.1.200', normalizationVersion: 'pdf-text-normalization/1.0.0', offsetUnit: 'unicode_code_point', pageCount: 1, textPageCount: 0, imageOnlyPageCount: 1, emptyPageCount: 0, failedPageCount: 0, segmentCount: 0, rawCharacterCount: 0, normalizedCharacterCount: 0, outputHash: HASH, failureCode: null, version: 2, createdAt: DATE, startedAt: DATE, completedAt: DATE }
const run = { id: RUN, caseId: CASE, documentId: DOC, documentVersionId: VERSION, textExtractionId: EXTRACTION, ocrVersion: 1, status: 'ready', engineName: 'tesseract.js', engineVersion: '7.0.0', languageDataVersion: 'tessdata-4.0.0-full/1.0.0', languageDataHash: HASH, languageMode: 'tur+eng', renderProfile: 'standard', renderProfileVersion: 'policy-ocr-render-standard/1.0.0', preprocessingVersion: 'policy-ocr-preprocessing/1.0.0', qualityVersion: 'policy-ocr-quality/1.0.0', normalizationVersion: 'policy-ocr-normalization/1.0.0', locatorVersion: 'policy-ocr-locator/1.0.0', offsetUnit: 'unicode_code_point', sourceHash: HASH, sourceSize: 1000, eligiblePageCount: 1, processedPageCount: 1, readyPageCount: 1, lowQualityPageCount: 0, emptyPageCount: 0, failedPageCount: 0, blockCount: 1, lineCount: 1, wordCount: 3, normalizedCharacterCount: 18, meanConfidence: 92, outputHash: HASH, failureCode: null, activeJobId: null, version: 2, createdAt: DATE, startedAt: DATE, completedAt: DATE }
const pdfPage = { id: PAGE, extractionId: EXTRACTION, pageNumber: 1, status: 'image_only', rawText: '', normalizedText: '', rawTextHash: HASH, normalizedTextHash: HASH, segmentCount: 0 }
const page = { id: PAGE, ocrRunId: RUN, textPageId: PAGE, pageNumber: 1, status: 'accepted_candidate', languageMode: 'tur+eng', imageWidth: 2480, imageHeight: 3508, renderDpi: 300, rotationDegrees: 0, deskewDegrees: 0.25, threshold: 143, rawOcrText: 'KASKO CAM TEMİNATI', rawTextHash: HASH, normalizedText: 'KASKO CAM TEMİNATI', normalizedTextHash: HASH, normalizedCharacterCount: 18, meanConfidence: 92, minimumConfidence: 88, qualityStatus: 'high', readingOrderQuality: 'reliable', compositeStatus: 'ocr_only', qualityReasonCode: 'quality_good', requiresHumanReview: false, blockCount: 1, lineCount: 1, wordCount: 3, lowConfidenceWordCount: 0, unreadableRegionCount: 0, processingDurationMs: 450 }
const elements = [
  { id: BLOCK, ocrRunId: RUN, pageId: PAGE, pageNumber: 1, type: 'block', parentId: null, elementIndex: 0, readingOrder: 0, startOffset: 0, endOffset: 18, text: 'KASKO CAM TEMİNATI', textHash: HASH, confidence: 92, bbox: { x: 10, y: 20, width: 500, height: 80 }, sourceLayer: 'ocr' },
  { id: LINE, ocrRunId: RUN, pageId: PAGE, pageNumber: 1, type: 'line', parentId: BLOCK, elementIndex: 1, readingOrder: 1, startOffset: 0, endOffset: 18, text: 'KASKO CAM TEMİNATI', textHash: HASH, confidence: 92, bbox: { x: 10, y: 20, width: 500, height: 40 }, sourceLayer: 'ocr' },
]

function response(status: number, body: unknown) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }) }

function successFetch() {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'POST' && url.endsWith('/source-reference')) return response(201, { sourceReference: { sourceKey: 'ocr-1-1', documentId: DOC, documentVersionId: VERSION, pageNumber: 1, sectionHeading: 'OCR', clauseIdentifier: 'Sayfa 1', rawExcerpt: 'KASKO CAM TEMİNATI', locator: `ocr:${RUN}:page:1`, sourceType: 'policy', confidence: .92, extractionLocator: null, ocrLocator: { ocrRunId: RUN, pageId: PAGE, blockId: BLOCK, lineId: LINE, wordId: null, startOffset: 0, endOffset: 18, engineVersion: '7.0.0', languageDataVersion: 'tessdata-4.0.0-full/1.0.0', locatorVersion: 'policy-ocr-locator/1.0.0', qualityStatus: 'high', readingOrderQuality: 'reliable', bbox: { x: 10, y: 20, width: 500, height: 40 } } } })
    if (url.endsWith('/documents?page=1&pageSize=100')) return response(200, { items: [{ id: DOC, documentType: 'casco_policy' }] })
    if (url.endsWith(`/documents/${DOC}`)) return response(200, { document: { versions: [{ id: VERSION, versionNumber: 1, displayName: 'Sentetik Görsel Poliçe', mimeType: 'application/pdf', extension: 'pdf', byteSize: 1000, status: 'ready', hashVerified: true, sizeVerified: true, verifiedAt: DATE }] } })
    if (url.includes(`/text-extractions/${EXTRACTION}/pages?`)) return response(200, { items: [pdfPage], pageInfo: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 } })
    if (url.includes('/text-extractions')) return response(200, { items: [extraction] })
    if (url.includes('/ocr-runs') && url.includes('/pages?')) return response(200, { items: [page], pageInfo: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 } })
    if (url.includes('/ocr-runs') && url.includes('/elements?')) return response(200, { items: elements, pageInfo: { page: 1, pageSize: 100, totalItems: 2, totalPages: 1 } })
    if (url.includes('/ocr-runs')) return response(200, { items: [run] })
    return response(500, {})
  })
}

afterEach(() => vi.restoreAllMocks())

describe('Paket 25 yerel OCR UI', () => {
  it('gerçek API sürümü, kalite, iki metin katmanı, geometri ve kaynak referansını gösterir', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(successFetch() as never)
    const user = userEvent.setup()
    render(<PolicyOcrApiModule caseId={CASE} source="api" />)
    expect(screen.getByRole('status')).toHaveTextContent('yükleniyor')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Poliçe OCR Katmanı' })).toBeInTheDocument())
    expect(screen.getByText('OCR tamamen yerel çalışır.')).toBeInTheDocument()
    expect(screen.getByText('Bu sonuç poliçe yorumu değildir.')).toBeInTheDocument()
    expect(screen.getByText(/tesseract.js 7.0.0/)).toBeInTheDocument()
    expect(screen.getByText(/Düşük güvenli kelime: 0/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Paket 24 PDF metni' })).toBeInTheDocument()
    expect(screen.getByText(/x:10 y:20 w:500 h:40/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Sayfa 1 · satır/ }))
    await waitFor(() => expect(screen.getByText('OCR kaynak referansı doğrulandı')).toBeInTheDocument())
    expect(screen.getByText(`ocr:${RUN}:page:1`)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/[A-Z]:\\|\\\\|password|secret/i)
  })

  it('100 öğelik kanıt listesini gerçek API sayfalamasıyla ilerletir', async () => {
    const base = successFetch()
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      ...elements[1], id: `line-${index}`, elementIndex: index + 1, readingOrder: index + 1, text: `Kanıt ${index + 1}`,
    }))
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/ocr-runs') && url.includes('/elements?')) {
        const second = url.includes('page=2')
        return response(200, { items: second ? [{ ...elements[1], id: 'line-page-2', text: 'İkinci sayfa kanıtı' }] : firstPage, pageInfo: { page: second ? 2 : 1, pageSize: 100, totalItems: 101, totalPages: 2 } })
      }
      return base(input, init)
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock as never)
    const user = userEvent.setup()
    render(<PolicyOcrApiModule caseId={CASE} source="api" />)
    await waitFor(() => expect(screen.getByText('Kanıt 100')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Sonraki' }))
    await waitFor(() => expect(screen.getByText('İkinci sayfa kanıtı')).toBeInTheDocument())
    expect(screen.getByText('Sayfa 2')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/elements?page=2&pageSize=100'), expect.anything())
  })

  it.each([[401, 'Oturum gerekli'], [403, 'Yetki yetersiz'], [404, 'Kayıt bulunamadı']] as const)('HTTP %s durumunda mock fallback yapmaz', async (status, label) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(status, {}))
    render(<PolicyOcrApiModule caseId={CASE} source="api" />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(label))
    expect(screen.queryByText('Sentetik Görsel Poliçe')).not.toBeInTheDocument()
  })

  it('ağ hatasında güvenli retry gösterir ve mock mod fiziksel çağrı yapmaz', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network'))
    const view = render(<PolicyOcrApiModule caseId={CASE} source="api" />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Bağlantı kurulamadı'))
    expect(screen.getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument()
    view.unmount(); fetchMock.mockClear()
    render(<PolicyOcrApiModule caseId={CASE} source="mock" />)
    expect(screen.getByText(/Mock modda PDF rasterize edilmez/)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('düşük kaliteyi kesin kanıt gibi göstermeden insan kontrolü uyarısı üretir', async () => {
    const fetchMock = successFetch()
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/ocr-runs') && url.includes('/pages?')) return response(200, { items: [{ ...page, status: 'low_confidence', qualityStatus: 'low', readingOrderQuality: 'ambiguous', compositeStatus: 'control_required', qualityReasonCode: 'low_confidence', requiresHumanReview: true, meanConfidence: 58, lowConfidenceWordCount: 2 }], pageInfo: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 } })
      if (url.includes('/ocr-runs') && url.includes('/elements?')) return response(200, { items: [], pageInfo: { page: 1, pageSize: 100, totalItems: 0, totalPages: 0 } })
      if (url.includes('/ocr-runs')) return response(200, { items: [{ ...run, status: 'low_confidence', readyPageCount: 0, lowQualityPageCount: 1, meanConfidence: 58 }] })
      if (url.endsWith('/documents?page=1&pageSize=100')) return response(200, { items: [{ id: DOC, documentType: 'casco_policy' }] })
      if (url.endsWith(`/documents/${DOC}`)) return response(200, { document: { versions: [{ id: VERSION, versionNumber: 1, displayName: 'Sentetik', mimeType: 'application/pdf', extension: 'pdf', byteSize: 1000, status: 'ready', hashVerified: true, sizeVerified: true, verifiedAt: DATE }] } })
      if (url.includes(`/text-extractions/${EXTRACTION}/pages?`)) return response(200, { items: [pdfPage], pageInfo: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 } })
      return response(200, { items: [extraction] })
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock as never)
    render(<PolicyOcrApiModule caseId={CASE} source="api" />)
    await waitFor(() => expect(screen.getByText('Düşük güvenli metin insan kontrolü gerektirir.')).toBeInTheDocument())
    expect(screen.getByText('İnsan kontrolü gerekli')).toBeInTheDocument()
    expect(screen.getByText(/okuma sırası belirsiz/)).toBeInTheDocument()
  })
})
