import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PolicyPdfTextApiModule } from './PolicyPdfTextApiModule'

const CASE = '019f7000-0000-7000-8000-000000000024', DOC = '019f7000-0000-7000-8000-000000000025', VERSION = '019f7000-0000-7000-8000-000000000026', EXTRACTION = '019f7000-0000-7000-8000-000000000027', PAGE = '019f7000-0000-7000-8000-000000000028', SEGMENT = '019f7000-0000-7000-8000-000000000029'
const extraction = { id: EXTRACTION, documentId: DOC, documentVersionId: VERSION, extractionVersion: 1, status: 'ready', parserName: 'pdfjs-dist', parserVersion: '6.1.200', normalizationVersion: 'pdf-text-normalization/1.0.0', offsetUnit: 'unicode_code_point', pageCount: 1, textPageCount: 1, imageOnlyPageCount: 0, emptyPageCount: 0, failedPageCount: 0, segmentCount: 1, rawCharacterCount: 23, normalizedCharacterCount: 23, outputHash: 'a'.repeat(64), failureCode: null, version: 2, createdAt: '2026-07-14T08:00:00.000Z', startedAt: '2026-07-14T08:00:01.000Z', completedAt: '2026-07-14T08:00:02.000Z' }
const page = { id: PAGE, extractionId: EXTRACTION, pageNumber: 1, status: 'text', rawText: 'KASKO  POLICE OZEL SART', normalizedText: 'KASKO POLICE OZEL SART', rawTextHash: 'b'.repeat(64), normalizedTextHash: 'c'.repeat(64), segmentCount: 1 }
const segment = { id: SEGMENT, extractionId: EXTRACTION, pageId: PAGE, pageNumber: 1, segmentIndex: 0, type: 'title', startOffset: 0, endOffset: 23, text: 'KASKO POLICE OZEL SART', textHash: 'c'.repeat(64) }
function response(status: number, body: unknown) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }) }
afterEach(() => vi.restoreAllMocks())

describe('Kasko PDF metin çıkarım görünümü', () => {
  it('exact parser/sürüm, sayfa, segment ve server kaynak referansını gerçek API’den gösterir', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST' && url.endsWith('/source-reference')) return response(200, { sourceReference: { sourceKey: 'pdf-1-0', documentId: DOC, documentVersionId: VERSION, pageNumber: 1, sectionHeading: 'KASKO', clauseIdentifier: 'PDF-1', rawExcerpt: segment.text, locator: `pdf-text:${EXTRACTION}:${PAGE}:0-23`, sourceType: 'policy', confidence: 1, extractionLocator: { extractionId: EXTRACTION, pageId: PAGE, segmentId: SEGMENT, startOffset: 0, endOffset: 23 } } })
      if (url.endsWith('/documents?page=1&pageSize=100')) return response(200, { items: [{ id: DOC, documentType: 'casco_policy' }] })
      if (url.endsWith(`/documents/${DOC}`)) return response(200, { document: { versions: [{ id: VERSION, versionNumber: 1, displayName: 'Sentetik Kasko Poliçesi', mimeType: 'application/pdf', extension: 'pdf', byteSize: 1000, status: 'ready', hashVerified: true, sizeVerified: true, verifiedAt: '2026-07-14T08:00:00.000Z' }] } })
      if (url.includes('/pages?')) return response(200, { items: [page] })
      if (url.includes('/segments?')) return response(200, { items: [segment] })
      return response(200, { items: [extraction] })
    }) as never)
    const user = userEvent.setup(); render(<PolicyPdfTextApiModule caseId={CASE} source="api" />)
    expect(screen.getByRole('status')).toHaveTextContent('yükleniyor')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Poliçe Metin Çıkarımı' })).toBeInTheDocument())
    expect(screen.getByText('pdfjs-dist 6.1.200')).toBeInTheDocument(); expect(screen.getByText(/pdf-text-normalization\/1.0.0/)).toBeInTheDocument(); expect(screen.getAllByText('KASKO POLICE OZEL SART')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: /Sayfa 1 · title/ }))
    await waitFor(() => expect(screen.getByText('Kaynak referansı doğrulandı')).toBeInTheDocument())
    expect(screen.getByText(`pdf-text:${EXTRACTION}:${PAGE}:0-23`)).toBeInTheDocument(); expect(document.body.textContent).not.toMatch(/[A-Z]:\\|password|secret/i)
  })

  it('OCR gerekli durumunu analiz sonucu gibi göstermeden açıklar', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(vi.fn(async (input: string | URL | Request) => {
      const url = String(input); if (url.endsWith('/documents?page=1&pageSize=100')) return response(200, { items: [{ id: DOC, documentType: 'casco_policy' }] }); if (url.endsWith(`/documents/${DOC}`)) return response(200, { document: { versions: [{ id: VERSION, versionNumber: 1, displayName: 'Görsel Poliçe', mimeType: 'application/pdf', extension: 'pdf', byteSize: 1000, status: 'ready', hashVerified: true, sizeVerified: true, verifiedAt: '2026-07-14T08:00:00.000Z' }] } }); if (url.includes('/pages?') || url.includes('/segments?')) return response(200, { items: [] }); return response(200, { items: [{ ...extraction, status: 'ocr_required', textPageCount: 0, imageOnlyPageCount: 1, segmentCount: 0 }] })
    }) as never)
    render(<PolicyPdfTextApiModule caseId={CASE} source="api" />); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('yerel OCR katmanında işlenebilir')); expect(fetchMock).toHaveBeenCalled()
  })

  it.each([[401, 'Oturum gerekli'], [403, 'Yetki yetersiz'], [404, 'Dosya bulunamadı']] as const)('HTTP %s durumunda mock fallback yapmaz', async (status, label) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(status, {})); render(<PolicyPdfTextApiModule caseId={CASE} source="api" />); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(label)); expect(screen.queryByText('Sentetik Kasko Poliçesi')).not.toBeInTheDocument()
  })

  it('ağ hatasında yeniden deneme sunar; mock modda hiçbir fiziksel çağrı yapmaz', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network')); const view = render(<PolicyPdfTextApiModule caseId={CASE} source="api" />); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Bağlantı kurulamadı')); expect(screen.getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument(); view.unmount(); fetchMock.mockClear(); render(<PolicyPdfTextApiModule caseId={CASE} source="mock" />); expect(screen.getByText(/Mock modda fiziksel PDF işlemi yapılmaz/)).toBeInTheDocument(); expect(fetchMock).not.toHaveBeenCalled()
  })
})
