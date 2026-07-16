import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DocumentPhotoApiModule } from './DocumentPhotoApiModule'

const CASE_ID = '019f6000-0000-7000-8000-000000000001'
const DOCUMENT_ID = '019f6000-0000-7000-8000-000000000002'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function successFetch(): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.includes('/document-requirements')) return jsonResponse(200, {
      caseId: CASE_ID,
      caseType: 'casco',
      ruleSetVersion: '2026.07.14.1',
      overallStatus: 'control_required',
      requirements: [
        { requirementCode: 'casco_policy', canonicalDocumentType: 'casco_policy', status: 'present', reason: 'File Agent tarafından fiziksel olarak doğrulanmış ready belge bulundu.', ruleVersion: '2026.07.14.1', sourceRule: 'base_required', matchedDocumentIds: [DOCUMENT_ID], relatedDocumentStatuses: [{ documentId: DOCUMENT_ID, status: 'ready' }], evaluatedAt: '2026-07-14T08:00:00.000Z', requiresHumanReview: false },
        { requirementCode: 'recourse_fault_ratio', canonicalDocumentType: 'fault_ratio', status: 'control_required', reason: 'Rücu durumu kesinleşmedi; eksik otomatik üretilmedi.', ruleVersion: '2026.07.14.1', sourceRule: 'recourse_undetermined', matchedDocumentIds: [], relatedDocumentStatuses: [{ documentId: 'candidate-1', status: 'failed' }], evaluatedAt: '2026-07-14T08:00:00.000Z', requiresHumanReview: true },
        { requirementCode: 'statement', canonicalDocumentType: 'statement', status: 'not_applicable', reason: 'KTT doğrulanmış olduğundan Beyan ayrıca zorunlu değildir.', ruleVersion: '2026.07.14.1', sourceRule: 'incident_alternative', matchedDocumentIds: [], relatedDocumentStatuses: [], evaluatedAt: '2026-07-14T08:00:00.000Z', requiresHumanReview: false },
      ],
      alternativeGroups: [{ groupCode: 'incident_document', operator: 'any_of', status: 'present', reason: 'Alternatif grupta doğrulanmış ready belge bulundu.', memberRequirementCodes: ['accident_report', 'ktt', 'statement'], matchedDocumentIds: [DOCUMENT_ID], requiresHumanReview: false }],
      missingCount: 0,
      controlRequiredCount: 1,
      evaluatedAt: '2026-07-14T08:00:00.000Z',
    })
    if (url.includes(`/documents/${DOCUMENT_ID}`)) return jsonResponse(200, { document: { documentType: 'casco_policy', versions: [{ id: 'version-1', documentId: DOCUMENT_ID, versionNumber: 3, originalFileName: 'kasko-police.pdf', displayName: 'Kasko Poliçesi', mimeType: 'application/pdf', byteSize: 3072, contentHash: 'a'.repeat(64), relativePath: 'EVRAK/kasko-police.pdf', status: 'ready', hashVerified: true, sizeVerified: true, verifiedAt: '2026-07-14T08:00:00.000Z' }] } })
    if (url.includes('/documents?')) return jsonResponse(200, { items: [{ id: DOCUMENT_ID, documentType: 'casco_policy' }], pageInfo: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 } })
    if (url.includes('/photos?')) return jsonResponse(200, { items: [{ id: 'photo-1', originalFileName: 'hasar.jpg', displayName: 'Hasar Ön', mimeType: 'image/jpeg', byteSize: 4096, relativePath: 'HASAR/hasar.jpg', status: 'pending', hashVerified: false, sizeVerified: false, verifiedAt: null }], pageInfo: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 } })
    return jsonResponse(404, {})
  }) as unknown as typeof fetch
}

afterEach(() => vi.restoreAllMocks())

describe('Evrak ve Fotoğraf gerçek API görünümü', () => {
  it('kural gruplarını, gerekçeyi, sürümü ve güvenli metadata alanlarını gösterir', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(successFetch() as never)
    render(<DocumentPhotoApiModule caseId={CASE_ID} source="api" />)
    expect(screen.getByRole('status')).toHaveTextContent('yükleniyor')
    await waitFor(() => expect(screen.getByText('Kasko Temel Evrakları')).toBeInTheDocument())
    expect(screen.getByText('Rüculu Kasko Evrakları')).toBeInTheDocument()
    expect(screen.getByText('Olay Belgeleri ve Tramer')).toBeInTheDocument()
    expect(screen.getByText(/kural 2026\.07\.14\.1/)).toBeInTheDocument()
    expect(screen.getByText('Rücu durumu kesinleşmedi; eksik otomatik üretilmedi.')).toBeInTheDocument()
    expect(screen.getAllByText('Kontrol gerekli').length).toBeGreaterThan(0)
    expect(screen.getByText('Uygulanmaz')).toBeInTheDocument()
    expect(screen.getAllByText('Fiziksel doğrulandı').length).toBeGreaterThan(0)
    expect(screen.getByText('Doğrulama başarısız')).toBeInTheDocument()
    expect(screen.getByText('Doğrulama bekliyor')).toBeInTheDocument()
    expect(screen.getByText('EVRAK/kasko-police.pdf')).toBeInTheDocument()
    expect(screen.getByText('HASAR/hasar.jpg')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('P:\\')
  })

  it.each([
    [401, 'Oturum gerekli'],
    [404, 'Dosya bulunamadı'],
  ] as const)('HTTP %s durumunu mock fallback olmadan gösterir', async (status, label) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(status, {}))
    render(<DocumentPhotoApiModule caseId={CASE_ID} source="api" />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(label))
    expect(screen.queryByText('12 anonim mock görsel')).not.toBeInTheDocument()
  })

  it('ağ hatasını ve yeniden deneme eylemini açıkça gösterir', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network'))
    const user = userEvent.setup()
    render(<DocumentPhotoApiModule caseId={CASE_ID} source="api" />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Bağlantı kurulamadı'))
    expect(screen.queryByText('12 anonim mock görsel')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Yeniden dene/ }))
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(6))
  })

  it('gerçek boş yanıtı ayrı boş durumuyla gösterir', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes('/document-requirements')) return jsonResponse(200, { caseId: CASE_ID, caseType: 'traffic', ruleSetVersion: '2026.07.14.1', overallStatus: 'present', requirements: [], alternativeGroups: [], missingCount: 0, controlRequiredCount: 0, evaluatedAt: '2026-07-14T08:00:00.000Z' })
      return jsonResponse(200, { items: [], pageInfo: { page: 1, pageSize: 100, totalItems: 0, totalPages: 0 } })
    }) as never)
    render(<DocumentPhotoApiModule caseId={CASE_ID} source="api" />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Evrak veya fotoğraf kaydı yok'))
  })
})
