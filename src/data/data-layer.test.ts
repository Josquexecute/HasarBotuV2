import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { mockCases } from '../mocks/cases'
import {
  createHttpCasesAdapter,
  createMockCasesAdapter,
  DATA_SOURCE_STORAGE_KEY,
  deriveFollowUp,
  deriveStatus,
  HttpCasesError,
  mapCaseDtoToRecord,
  useCases,
} from './index'

const TODAY = new Date(2026, 6, 12) // 12 Temmuz 2026 (yerel)

const dto = {
  id: 'case-1',
  caseType: 'casco' as const,
  officeCaseNumber: '2026/184',
  notificationFormNumber: 'F-2026-0988',
  insurerClaimNumber: null,
  plate: '34 MPA 764',
  status: 'open' as const,
  stage: 'inspection_pending',
  followUpDate: '2026-07-14',
  updatedAt: '2026-07-11T09:00:00.000Z',
  version: 4,
  responsibleUserId: 'user-1',
  serviceId: null,
  insurerId: 'insurer-1',
}

function fetchResponding(status: number, body?: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch
}

describe('MockDataAdapter (acikca secilen development/demo kaynagi)', () => {
  it('kabul edilmis mock listesini aynen dondurur', async () => {
    expect(await createMockCasesAdapter().listCases()).toBe(mockCases)
  })
})

describe('HttpApiAdapter esleme', () => {
  it('DTO -> CaseRecord: tur/asama/takip turetilmis gorunumleri dogru', () => {
    const record = mapCaseDtoToRecord(dto, TODAY)
    expect(record).toMatchObject({
      caseId: 'case-1',
      type: 'Kasko',
      stage: 'Ekspertiz Bekliyor',
      officeNumber: '2026/184',
      noticeNumber: 'F-2026-0988',
      claimNumber: '—',
      status: 'Açık',
      followUp: '14 Tem',
      followUpTone: 'normal',
      version: 4,
      workflowStage: 'inspection_pending',
      responsibleUserId: 'user-1',
      insurerId: 'insurer-1',
    })
  })

  it('takip turetimi: bugun/gecmis/bos (HB-2026-010 turetilmis gorunum)', () => {
    expect(deriveFollowUp('2026-07-12', TODAY)).toEqual({ followUp: 'Bugün', followUpTone: 'today' })
    expect(deriveFollowUp('2026-07-10', TODAY)).toEqual({ followUp: '10 Tem', followUpTone: 'late' })
    expect(deriveFollowUp(null, TODAY)).toEqual({ followUp: '—', followUpTone: 'normal' })
    expect(deriveStatus({ status: 'open', followUpDate: '2026-07-10' }, TODAY)).toBe('Gecikmiş')
    expect(deriveStatus({ status: 'open', followUpDate: null }, TODAY)).toBe('Açık')
  })

  it('basarili yanit eslenmis kayitlar dondurur; gercek bos liste bos doner', async () => {
    const adapter = createHttpCasesAdapter({
      baseUrl: 'http://api.test',
      fetchImpl: fetchResponding(200, { items: [dto] }),
    })
    const cases = await adapter.listCases()
    expect(cases).toHaveLength(1)
    expect(cases[0]?.plate).toBe('34 MPA 764')

    const empty = createHttpCasesAdapter({ fetchImpl: fetchResponding(200, { items: [] }) })
    expect(await empty.listCases()).toEqual([])
  })

  it('hata siniflandirmasi: 401 unauthorized, 5xx/ag unavailable (mock maskeleme YOK)', async () => {
    await expect(
      createHttpCasesAdapter({ fetchImpl: fetchResponding(401) }).listCases(),
    ).rejects.toMatchObject({ name: 'HttpCasesError', kind: 'unauthorized' })

    await expect(
      createHttpCasesAdapter({ fetchImpl: fetchResponding(503) }).listCases(),
    ).rejects.toMatchObject({ kind: 'unavailable' })

    const networkFail = vi.fn().mockRejectedValue(new TypeError('failed to fetch')) as unknown as typeof fetch
    await expect(
      createHttpCasesAdapter({ fetchImpl: networkFail }).listCases(),
    ).rejects.toBeInstanceOf(HttpCasesError)
  })
})

describe('useCases kancasi (HB-2026-014)', () => {
  it('varsayilan (mock) kaynakta ilk render mock verisiyle esdegerdir ve ag cagrisi yapilmaz', () => {
    window.localStorage.removeItem(DATA_SOURCE_STORAGE_KEY)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { result } = renderHook(() => useCases())
    expect(result.current.cases).toBe(mockCases)
    expect(result.current.source).toBe('mock')
    expect(result.current.status).toBe('ok')
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it.each([
    [401, 'unauthorized'],
    [503, 'unavailable'],
  ] as const)('api kaynaginda HTTP %s -> %s durumu; mock verisi ASLA gosterilmez', async (httpStatus, expected) => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchResponding(httpStatus) as never)
    try {
      const { result } = renderHook(() => useCases())
      expect(result.current.status).toBe('loading')
      expect(result.current.cases).toEqual([])
      await waitFor(() => expect(result.current.status).toBe(expected))
      expect(result.current.cases).toEqual([])
      expect(result.current.cases).not.toBe(mockCases)
    } finally {
      fetchSpy.mockRestore()
      window.localStorage.removeItem(DATA_SOURCE_STORAGE_KEY)
    }
  })

  it('api kaynaginda gercek bos liste ok durumuyla bos doner', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchResponding(200, { items: [] }) as never)
    try {
      const { result } = renderHook(() => useCases())
      await waitFor(() => expect(result.current.status).toBe('ok'))
      expect(result.current.cases).toEqual([])
    } finally {
      fetchSpy.mockRestore()
      window.localStorage.removeItem(DATA_SOURCE_STORAGE_KEY)
    }
  })

  it('api kaynaginda basarili yanit gercek veriyi getirir', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchResponding(200, { items: [dto] }) as never)
    try {
      const { result } = renderHook(() => useCases())
      await waitFor(() => expect(result.current.status).toBe('ok'))
      expect(result.current.cases[0]?.plate).toBe('34 MPA 764')
    } finally {
      fetchSpy.mockRestore()
      window.localStorage.removeItem(DATA_SOURCE_STORAGE_KEY)
    }
  })
})
