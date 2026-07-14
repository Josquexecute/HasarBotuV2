import { describe, expect, it, vi } from 'vitest'
import {
  createHttpDocumentWorkspaceAdapter,
  HttpDocumentWorkspaceError,
  isSafeMetadataRelativePath,
} from './documentHttpAdapter'

const CASE_ID = '019f6000-0000-7000-8000-000000000001'
const DOCUMENT_ID = '019f6000-0000-7000-8000-000000000002'
const VERSION_ID = '019f6000-0000-7000-8000-000000000003'
const PHOTO_ID = '019f6000-0000-7000-8000-000000000004'

const requirements = {
  caseId: CASE_ID,
  caseType: 'traffic',
  ruleSetVersion: '2026.07.14.1',
  overallStatus: 'control_required',
  requirements: [{
    requirementCode: 'traffic_victim_policy',
    canonicalDocumentType: 'victim_traffic_policy',
    status: 'control_required',
    reason: 'Aday belge doğrulanmamış veya doğrulaması başarısız; mevcut kabul edilmedi.',
    ruleVersion: '2026.07.14.1',
    sourceRule: 'base_required',
    matchedDocumentIds: [],
    relatedDocumentStatuses: [{ documentId: VERSION_ID, status: 'pending' }],
    evaluatedAt: '2026-07-14T08:00:00.000Z',
    requiresHumanReview: true,
  }],
  alternativeGroups: [],
  missingCount: 0,
  controlRequiredCount: 1,
  evaluatedAt: '2026-07-14T08:00:00.000Z',
}

const documentList = { items: [{ id: DOCUMENT_ID, documentType: 'victim_traffic_policy' }], pageInfo: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 } }
const documentDetail = {
  document: {
    id: DOCUMENT_ID,
    documentType: 'victim_traffic_policy',
    versions: [{
      id: VERSION_ID,
      documentId: DOCUMENT_ID,
      versionNumber: 2,
      originalFileName: 'magdur-police.pdf',
      displayName: 'Mağdur Poliçesi',
      mimeType: 'application/pdf',
      byteSize: 2048,
      relativePath: '2026/34ABC123/EVRAK/magdur-police.pdf',
      status: 'pending',
      hashVerified: false,
      sizeVerified: false,
      verifiedAt: null,
    }],
  },
}
const photoList = {
  items: [{
    id: PHOTO_ID,
    originalFileName: 'hasar-001.jpg',
    displayName: 'Hasar 001',
    mimeType: 'image/jpeg',
    byteSize: 4096,
    relativePath: '2026/34ABC123/HASAR/hasar-001.jpg',
    status: 'ready',
    hashVerified: true,
    sizeVerified: true,
    verifiedAt: '2026-07-14T08:01:00.000Z',
  }],
  pageInfo: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 },
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function successfulFetch(overrides: { documentDetail?: unknown } = {}): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.includes('/document-requirements')) return jsonResponse(200, requirements)
    if (url.includes(`/documents/${DOCUMENT_ID}`)) return jsonResponse(200, overrides.documentDetail ?? documentDetail)
    if (url.includes('/documents?')) return jsonResponse(200, documentList)
    if (url.includes('/photos?')) return jsonResponse(200, photoList)
    return jsonResponse(404, {})
  }) as unknown as typeof fetch
}

describe('Document workspace HttpApiAdapter', () => {
  it('gereksinim, belge sürümü ve fotoğraf metadata yanıtlarını tek güvenli modele birleştirir', async () => {
    const fetchImpl = successfulFetch()
    const data = await createHttpDocumentWorkspaceAdapter({ baseUrl: 'http://api.test', fetchImpl }).getCaseDocumentWorkspace(CASE_ID)
    expect(data.ruleSetVersion).toBe('2026.07.14.1')
    expect(data.requirements[0]).toMatchObject({ status: 'control_required', canonicalDocumentType: 'victim_traffic_policy' })
    expect(data.documents[0]).toMatchObject({ versionNumber: 2, status: 'pending', relativePath: '2026/34ABC123/EVRAK/magdur-police.pdf' })
    expect(data.photos[0]).toMatchObject({ status: 'ready', mimeType: 'image/jpeg' })
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  it('gerçek boş API listelerini boş metadata olarak korur; mock fallback üretmez', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/document-requirements')) return jsonResponse(200, { ...requirements, requirements: [], alternativeGroups: [], missingCount: 0, controlRequiredCount: 0 })
      return jsonResponse(200, { items: [], pageInfo: { page: 1, pageSize: 100, totalItems: 0, totalPages: 0 } })
    }) as unknown as typeof fetch
    const data = await createHttpDocumentWorkspaceAdapter({ fetchImpl }).getCaseDocumentWorkspace(CASE_ID)
    expect(data.requirements).toEqual([])
    expect(data.documents).toEqual([])
    expect(data.photos).toEqual([])
  })

  it.each([
    [401, 'unauthorized'],
    [404, 'not_found'],
    [503, 'unavailable'],
  ] as const)('HTTP %s hatasını %s olarak sınıflandırır', async (status, kind) => {
    const adapter = createHttpDocumentWorkspaceAdapter({ fetchImpl: vi.fn().mockResolvedValue(jsonResponse(status, {})) as unknown as typeof fetch })
    await expect(adapter.getCaseDocumentWorkspace(CASE_ID)).rejects.toMatchObject({ name: 'HttpDocumentWorkspaceError', kind })
  })

  it('ağ hatasını unavailable olarak açıkça döndürür', async () => {
    const adapter = createHttpDocumentWorkspaceAdapter({ fetchImpl: vi.fn().mockRejectedValue(new TypeError('network')) as unknown as typeof fetch })
    await expect(adapter.getCaseDocumentWorkspace(CASE_ID)).rejects.toBeInstanceOf(HttpDocumentWorkspaceError)
  })

  it('mutlak veya üst dizine çıkan metadata yolunu ekrana ulaşmadan reddeder', async () => {
    expect(isSafeMetadataRelativePath('EVRAK/police.pdf')).toBe(true)
    expect(isSafeMetadataRelativePath('P:\\BARAN\\police.pdf')).toBe(false)
    expect(isSafeMetadataRelativePath('../police.pdf')).toBe(false)
    const unsafeDetail = {
      document: {
        ...documentDetail.document,
        versions: [{ ...documentDetail.document.versions[0], relativePath: 'P:\\BARAN\\magdur-police.pdf' }],
      },
    }
    const adapter = createHttpDocumentWorkspaceAdapter({ fetchImpl: successfulFetch({ documentDetail: unsafeDetail }) })
    await expect(adapter.getCaseDocumentWorkspace(CASE_ID)).rejects.toMatchObject({ kind: 'unavailable' })
  })

  it('doğrulama kanıtı eksik ready metadata’yı fiziksel doğrulanmış saymaz', async () => {
    const unverifiedReady = {
      document: {
        ...documentDetail.document,
        versions: [{ ...documentDetail.document.versions[0], status: 'ready', hashVerified: false, sizeVerified: true, verifiedAt: '2026-07-14T08:00:00.000Z' }],
      },
    }
    const adapter = createHttpDocumentWorkspaceAdapter({ fetchImpl: successfulFetch({ documentDetail: unverifiedReady }) })
    await expect(adapter.getCaseDocumentWorkspace(CASE_ID)).rejects.toMatchObject({ kind: 'unavailable' })
  })

  it('metadata sayfalarının tamamını sessiz eksiltmeden okur', async () => {
    const secondPhoto = { ...photoList.items[0], id: '019f6000-0000-7000-8000-000000000005', displayName: 'Hasar 002', relativePath: '2026/34ABC123/HASAR/hasar-002.jpg' }
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/document-requirements')) return jsonResponse(200, requirements)
      if (url.includes(`/documents/${DOCUMENT_ID}`)) return jsonResponse(200, documentDetail)
      if (url.includes('/documents?')) return jsonResponse(200, documentList)
      if (url.includes('/photos?') && url.includes('page=1')) return jsonResponse(200, { items: photoList.items, pageInfo: { page: 1, pageSize: 100, totalItems: 2, totalPages: 2 } })
      if (url.includes('/photos?') && url.includes('page=2')) return jsonResponse(200, { items: [secondPhoto], pageInfo: { page: 2, pageSize: 100, totalItems: 2, totalPages: 2 } })
      return jsonResponse(404, {})
    }) as unknown as typeof fetch
    const data = await createHttpDocumentWorkspaceAdapter({ fetchImpl }).getCaseDocumentWorkspace(CASE_ID)
    expect(data.photos.map((photo) => photo.displayName)).toEqual(['Hasar 001', 'Hasar 002'])
  })
})
