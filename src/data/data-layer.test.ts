import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { mockCases } from '../mocks/cases'
import {
  createFallbackCasesAdapter,
  createHttpCasesAdapter,
  createMockCasesAdapter,
  DATA_SOURCE_STORAGE_KEY,
  deriveFollowUp,
  deriveStatus,
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
}

describe('MockDataAdapter (varsayilan)', () => {
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
    })
  })

  it('takip turetimi: bugun/gecmis/bos (HB-2026-010 turetilmis gorunum)', () => {
    expect(deriveFollowUp('2026-07-12', TODAY)).toEqual({ followUp: 'Bugün', followUpTone: 'today' })
    expect(deriveFollowUp('2026-07-10', TODAY)).toEqual({ followUp: '10 Tem', followUpTone: 'late' })
    expect(deriveFollowUp(null, TODAY)).toEqual({ followUp: '—', followUpTone: 'normal' })
    expect(deriveStatus({ status: 'open', followUpDate: '2026-07-10' }, TODAY)).toBe('Gecikmiş')
    expect(deriveStatus({ status: 'open', followUpDate: null }, TODAY)).toBe('Açık')
  })

  it('basarili yanit eslenmis kayitlar dondurur; hata durumunda firlatir', async () => {
    const okFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [dto] }),
    }) as unknown as typeof fetch
    const adapter = createHttpCasesAdapter({ baseUrl: 'http://api.test', fetchImpl: okFetch })
    const cases = await adapter.listCases()
    expect(cases).toHaveLength(1)
    expect(cases[0]?.plate).toBe('34 MPA 764')
    expect((okFetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0]).toBe(
      'http://api.test/api/v1/cases?status=open&pageSize=100',
    )

    const failFetch = vi.fn().mockResolvedValue({ ok: false, status: 401 }) as unknown as typeof fetch
    await expect(
      createHttpCasesAdapter({ fetchImpl: failFetch }).listCases(),
    ).rejects.toThrow('cases API HTTP 401')
  })
})

describe('guvenli fallback', () => {
  it('birincil hata verirse mock listesi doner ve isaretlenir', async () => {
    const broken = { listCases: () => Promise.reject(new Error('ag yok')) }
    const result = await createFallbackCasesAdapter(broken, createMockCasesAdapter()).listCases()
    expect(result.usedFallback).toBe(true)
    expect(result.cases).toBe(mockCases)
  })
})

describe('useCases kancasi', () => {
  it('varsayilan (mock) kaynakta ilk render mock verisiyle esdegerdir ve ag cagrisi yapilmaz', () => {
    window.localStorage.removeItem(DATA_SOURCE_STORAGE_KEY)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { result } = renderHook(() => useCases())
    expect(result.current.cases).toBe(mockCases)
    expect(result.current.source).toBe('mock')
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it("api kaynagi secilip API ulasilamazsa mock'a guvenli donus yapilir", async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('baglanti yok'))
    try {
      const { result } = renderHook(() => useCases())
      expect(result.current.cases).toBe(mockCases)
      await waitFor(() => expect(result.current.usedFallback).toBe(true))
      expect(result.current.cases).toBe(mockCases)
    } finally {
      fetchSpy.mockRestore()
      window.localStorage.removeItem(DATA_SOURCE_STORAGE_KEY)
    }
  })
})
