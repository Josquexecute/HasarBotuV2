import { describe, expect, it } from 'vitest'
import { MAX_SEARCH_LENGTH, casesQuerySchema } from '../src/index.js'

describe('Cases sorgu sozlesmesi', () => {
  it('bos sorgu varsayilanlari uygular (arama filtresi yok)', () => {
    const result = casesQuerySchema.safeParse({})
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.search).toBeUndefined()
    expect(result.data.page).toBe(1)
    expect(result.data.pageSize).toBe(25)
    expect(result.data.sortBy).toBe('updatedAt')
    expect(result.data.sortDirection).toBe('desc')
  })

  it('gecerli tam sorguyu kabul eder', () => {
    const result = casesQuerySchema.safeParse({
      search: '34 MPA 764',
      caseType: 'traffic',
      status: 'open',
      stage: 'inspection_pending',
      responsibleUserId: 'usr-2',
      serviceId: 'service-1',
      followUpFrom: '2026-07-01',
      followUpTo: '2026-07-31',
      sortBy: 'followUpDate',
      sortDirection: 'asc',
      page: 2,
      pageSize: 50,
    })
    expect(result.success).toBe(true)
  })

  it('bos/bosluk arama acikca reddedilir; uzunluk sinirlanir', () => {
    expect(casesQuerySchema.safeParse({ search: '' }).success).toBe(false)
    expect(casesQuerySchema.safeParse({ search: '   ' }).success).toBe(false)
    expect(casesQuerySchema.safeParse({ search: 'a'.repeat(MAX_SEARCH_LENGTH) }).success).toBe(true)
    expect(casesQuerySchema.safeParse({ search: 'a'.repeat(MAX_SEARCH_LENGTH + 1) }).success).toBe(false)
  })

  it('followUpFrom > followUpTo reddedilir', () => {
    const result = casesQuerySchema.safeParse({
      followUpFrom: '2026-07-31',
      followUpTo: '2026-07-01',
    })
    expect(result.success).toBe(false)
  })

  it('esit from/to araligini kabul eder', () => {
    const result = casesQuerySchema.safeParse({
      followUpFrom: '2026-07-10',
      followUpTo: '2026-07-10',
    })
    expect(result.success).toBe(true)
  })

  it('takip araligi yalniz LocalDate kabul eder; tarih-saat reddedilir', () => {
    expect(casesQuerySchema.safeParse({ followUpFrom: '2026-07-01T00:00:00Z' }).success).toBe(false)
    expect(casesQuerySchema.safeParse({ followUpTo: '2026-02-30' }).success).toBe(false)
  })

  it('bilinmeyen sorgu alani reddedilir (strict)', () => {
    expect(casesQuerySchema.safeParse({ unknownFilter: 'x' }).success).toBe(false)
  })

  it('kontrolsuz coercion yoktur: string sayfa reddedilir', () => {
    expect(casesQuerySchema.safeParse({ page: '2' }).success).toBe(false)
    expect(casesQuerySchema.safeParse({ pageSize: '10' }).success).toBe(false)
  })

  it('pageSize ust siniri uygular', () => {
    expect(casesQuerySchema.safeParse({ pageSize: 100 }).success).toBe(true)
    expect(casesQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false)
  })

  it('page ust siniri 10000 uygular; NaN/Infinity/ondalik reddedilir', () => {
    expect(casesQuerySchema.safeParse({ page: 10_000 }).success).toBe(true)
    expect(casesQuerySchema.safeParse({ page: 10_001 }).success).toBe(false)
    expect(casesQuerySchema.safeParse({ page: Number.NaN }).success).toBe(false)
    expect(casesQuerySchema.safeParse({ page: Number.POSITIVE_INFINITY }).success).toBe(false)
    expect(casesQuerySchema.safeParse({ page: 1.5 }).success).toBe(false)
    expect(casesQuerySchema.safeParse({ pageSize: true }).success).toBe(false)
  })
})
