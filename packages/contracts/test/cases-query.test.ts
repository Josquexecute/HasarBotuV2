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
      followUpFrom: '2026-07-01T00:00:00Z',
      followUpTo: '2026-07-31T00:00:00Z',
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
      followUpFrom: '2026-07-31T00:00:00Z',
      followUpTo: '2026-07-01T00:00:00Z',
    })
    expect(result.success).toBe(false)
  })

  it('esit from/to araligini kabul eder', () => {
    const result = casesQuerySchema.safeParse({
      followUpFrom: '2026-07-10T00:00:00Z',
      followUpTo: '2026-07-10T00:00:00Z',
    })
    expect(result.success).toBe(true)
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
})
