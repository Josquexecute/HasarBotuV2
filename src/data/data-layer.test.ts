import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { caseListItemSchema } from '@hasarbotu/contracts'
import { mockCases } from '../mocks/cases'
import { createHttpCasesAdapter, deriveFollowUp, deriveStatus, HttpCasesError, mapCaseDtoToRecord } from './httpAdapter'
import { createMockCasesAdapter } from './mockAdapter'
import { DATA_SOURCE_STORAGE_KEY, resolveConfiguredDataSource } from './ports'
import { useCase } from './useCase'
import { useCases } from './useCases'

const TODAY = new Date(2026, 6, 12) // 12 Temmuz 2026 (yerel)

const dto = caseListItemSchema.parse({
  id: 'case-1',
  caseType: 'casco' as const,
  officeCaseNumber: '2026/184',
  notificationFormNumber: 'F-2026-0988',
  insurerClaimNumber: null,
  plate: '34 MPA 764',
  status: 'open' as const,
  stage: 'inspection_pending',
  followUpDate: '2026-07-14',
  lastInterventionAt: null,
  createdAt: '2026-07-10T08:00:00.000Z',
  updatedAt: '2026-07-11T09:00:00.000Z',
  version: 4,
  responsibleUserId: 'user-1',
  serviceId: null,
  serviceProfile: null,
  insurerId: 'insurer-1',
  expertUserId: 'expert-1',
  lossDate: '2026-07-10',
  notificationDate: '2026-07-11',
})

function listBody(items: readonly unknown[], page = 1, totalPages = items.length === 0 ? 0 : 1, totalItems = items.length) {
  return { items, pageInfo: { page, pageSize: 100, totalItems, totalPages } }
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
    const adapter = createMockCasesAdapter()
    expect(await adapter.listCases()).toBe(mockCases)
    expect(await adapter.getCase(mockCases[0]!.caseId)).toBe(mockCases[0])
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
      expertUserId: 'expert-1',
      lossDate: '2026-07-10',
      notificationDate: '2026-07-11',
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
      fetchImpl: fetchResponding(200, listBody([dto])),
    })
    const cases = await adapter.listCases()
    expect(cases).toHaveLength(1)
    expect(cases[0]?.plate).toBe('34 MPA 764')

    const empty = createHttpCasesAdapter({ fetchImpl: fetchResponding(200, listBody([])) })
    expect(await empty.listCases()).toEqual([])
  })

  it('server pagination sayfalarinin tamamini toplar ve detail endpointini ayri okur', async () => {
    const second = { ...dto, id: 'case-2', officeCaseNumber: '2026/185', plate: '34 MPA 765' }
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/cases/case-2')) return fetchResponding(200, { case: second })(input)
      if (url.includes('page=2')) return fetchResponding(200, listBody([second], 2, 2, 2))(input)
      return fetchResponding(200, listBody([dto], 1, 2, 2))(input)
    }) as unknown as typeof fetch
    const adapter = createHttpCasesAdapter({ fetchImpl })
    expect((await adapter.listCases()).map((item) => item.caseId)).toEqual(['case-1', 'case-2'])
    expect(await adapter.getCase('case-2')).toMatchObject({ caseId: 'case-2', plate: '34 MPA 765' })
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('page=2&pageSize=100'), expect.anything())
    expect(fetchImpl).toHaveBeenCalledWith('/api/v1/cases/case-2', expect.anything())
  })

  it('bozuk successful response contracts sinirinda fail-closed reddedilir', async () => {
    await expect(createHttpCasesAdapter({
      fetchImpl: fetchResponding(200, { items: [{ ...dto, caseType: 'unknown' }], pageInfo: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 } }),
    }).listCases()).rejects.toMatchObject({ kind: 'unavailable' })
    await expect(createHttpCasesAdapter({
      fetchImpl: fetchResponding(200, { case: { ...dto, stage: 'unknown_stage' } }),
    }).getCase('case-1')).rejects.toMatchObject({ kind: 'unavailable' })
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
      .mockImplementation(fetchResponding(200, listBody([])) as never)
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
      .mockImplementation(fetchResponding(200, listBody([dto])) as never)
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

describe('tek case detail kancasi', () => {
  it('API listesinde olmasa bile kapali case detail endpointinden yuklenir', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const closed = { ...dto, status: 'closed' as const, stage: 'closed' as const }
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      fetchResponding(200, { case: closed }) as never,
    )
    try {
      const { result } = renderHook(() => useCase('case-1'))
      await waitFor(() => expect(result.current.status).toBe('ok'))
      expect(result.current.item).toMatchObject({ caseId: 'case-1', lifecycleStatus: 'closed', status: 'Kapalı' })
      expect(fetchSpy).toHaveBeenCalledWith('/api/v1/cases/case-1', expect.anything())
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('detail 404 durumunu not_found olarak ayirir', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(fetchResponding(404) as never)
    try {
      const { result } = renderHook(() => useCase('case-yok'))
      await waitFor(() => expect(result.current.status).toBe('not_found'))
      expect(result.current.item).toBeNull()
    } finally {
      fetchSpy.mockRestore()
    }
  })
})

describe('veri kaynagi production kapisi', () => {
  it('production build localStorage mock degerini ve env mock varsayimini yok sayar', () => {
    expect(resolveConfiguredDataSource({
      production: true,
      environmentValue: 'mock',
      storedValue: 'mock',
    })).toBe('api')
    expect(resolveConfiguredDataSource({
      production: false,
      environmentValue: undefined,
      storedValue: 'mock',
    })).toBe('mock')
  })
})
