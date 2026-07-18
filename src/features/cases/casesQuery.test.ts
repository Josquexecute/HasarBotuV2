import { describe, expect, it } from 'vitest'
import {
  CASES_PAGE_SIZE,
  buildCasesPageQuery,
  clampPage,
  filterIdentity,
  isServerSortKey,
  type CasesFilterState,
} from './casesQuery'

const TODAY = '2026-07-18'

function state(overrides: Partial<CasesFilterState> = {}): CasesFilterState {
  return {
    query: '',
    typeFilter: 'Tümü',
    stageFilter: 'Tümü',
    statusFilter: 'Tümü',
    responsibleUserId: 'Tümü',
    serviceId: 'Tümü',
    followUpFilter: 'Tümü',
    sortKey: 'lastAction',
    direction: 'desc',
    page: 1,
    ...overrides,
  }
}

describe('buildCasesPageQuery', () => {
  it('sayfa boyutu operasyonel uyarı caseIds sınırını aşmaz', () => {
    // Satır uyarı isteği aktif sayfa kimliklerini gönderir; sayfa boyutu 100'ü
    // aşarsa "bilinmiyor" satırlar oluşurdu.
    expect(CASES_PAGE_SIZE).toBeLessThanOrEqual(100)
    expect(buildCasesPageQuery(state(), TODAY).pageSize).toBe(CASES_PAGE_SIZE)
  })

  it('filtre yokken yalnız açık dosyaları ve varsayılan sıralamayı ister', () => {
    expect(buildCasesPageQuery(state(), TODAY)).toEqual({
      status: 'open',
      sortBy: 'updatedAt',
      sortDirection: 'desc',
      page: 1,
      pageSize: CASES_PAGE_SIZE,
    })
  })

  it('arama, tür, aşama, sorumlu ve servis filtrelerini sunucuya taşır', () => {
    const query = buildCasesPageQuery(state({
      query: '  34 mpa 764  ',
      typeFilter: 'Kasko',
      stageFilter: 'Onarımda',
      responsibleUserId: 'user-1',
      serviceId: 'service-1',
    }), TODAY)
    expect(query).toMatchObject({
      search: '34 mpa 764',
      caseType: 'casco',
      stage: 'under_repair',
      responsibleUserId: 'user-1',
      serviceId: 'service-1',
    })
  })

  it('kapalı durum closed, gecikmiş ise açık + geçmiş takip olarak eşlenir', () => {
    expect(buildCasesPageQuery(state({ statusFilter: 'Kapalı' }), TODAY).status).toBe('closed')
    expect(buildCasesPageQuery(state({ statusFilter: 'Açık' }), TODAY)).toMatchObject({
      status: 'open',
    })
    expect(buildCasesPageQuery(state({ statusFilter: 'Gecikmiş' }), TODAY)).toMatchObject({
      status: 'open',
      followUpTo: '2026-07-17',
    })
  })

  it('takip filtresini tarih aralığına çevirir', () => {
    expect(buildCasesPageQuery(state({ followUpFilter: 'late' }), TODAY).followUpTo).toBe('2026-07-17')
    expect(buildCasesPageQuery(state({ followUpFilter: 'today' }), TODAY)).toMatchObject({
      followUpFrom: TODAY,
      followUpTo: TODAY,
    })
    expect(buildCasesPageQuery(state({ followUpFilter: 'normal' }), TODAY)).toMatchObject({
      followUpFrom: TODAY,
    })
  })

  it('gecikmiş durum ile takip filtresi birlikte seçilirse aralık kesişir', () => {
    const query = buildCasesPageQuery(
      state({ statusFilter: 'Gecikmiş', followUpFilter: 'today' }),
      TODAY,
    )
    // Daha dar sınırlar kazanır: from=bugün, to=dün → sunucu boş sonuç döndürür,
    // uydurma bir "yaklaşık" sonuç üretilmez.
    expect(query).toMatchObject({ followUpFrom: TODAY, followUpTo: '2026-07-17' })
  })

  it('ay ve yıl sınırında takip tarihini doğru kaydırır', () => {
    expect(buildCasesPageQuery(state({ followUpFilter: 'late' }), '2026-01-01').followUpTo)
      .toBe('2025-12-31')
    expect(buildCasesPageQuery(state({ followUpFilter: 'late' }), '2026-03-01').followUpTo)
      .toBe('2026-02-28')
  })

  it('sıralama alanlarını sunucu adlarına eşler', () => {
    expect(buildCasesPageQuery(state({ sortKey: 'followUp', direction: 'asc' }), TODAY))
      .toMatchObject({ sortBy: 'followUpDate', sortDirection: 'asc' })
    expect(buildCasesPageQuery(state({ sortKey: 'officeNumber' }), TODAY).sortBy)
      .toBe('officeCaseNumber')
    expect(buildCasesPageQuery(state({ sortKey: 'plate' }), TODAY).sortBy).toBe('plate')
  })

  it('sayfa numarasını taşır', () => {
    expect(buildCasesPageQuery(state({ page: 4 }), TODAY).page).toBe(4)
  })
})

describe('isServerSortKey', () => {
  it('yalnız sunucunun desteklediği alanları kabul eder', () => {
    expect(isServerSortKey('plate')).toBe(true)
    expect(isServerSortKey('lastAction')).toBe(true)
    expect(isServerSortKey('company')).toBe(false)
    expect(isServerSortKey('missingDocuments')).toBe(false)
  })
})

describe('clampPage', () => {
  it('son sayfa küçüldüğünde geçerli son sayfaya döner', () => {
    expect(clampPage(7, 3)).toBe(3)
    expect(clampPage(3, 3)).toBe(3)
    expect(clampPage(1, 3)).toBe(1)
  })

  it('sonuç boşsa ilk sayfaya döner', () => {
    expect(clampPage(5, 0)).toBe(1)
    expect(clampPage(0, 4)).toBe(1)
    expect(clampPage(-2, 4)).toBe(1)
  })
})

describe('filterIdentity', () => {
  it('sayfa değişimi kimliği değiştirmez', () => {
    expect(filterIdentity(state({ page: 1 }))).toBe(filterIdentity(state({ page: 9 })))
  })

  it('filtre, arama ve sıralama değişimi kimliği değiştirir', () => {
    const base = filterIdentity(state())
    expect(filterIdentity(state({ query: 'abc' }))).not.toBe(base)
    expect(filterIdentity(state({ typeFilter: 'Kasko' }))).not.toBe(base)
    expect(filterIdentity(state({ responsibleUserId: 'user-1' }))).not.toBe(base)
    expect(filterIdentity(state({ sortKey: 'plate' }))).not.toBe(base)
    expect(filterIdentity(state({ direction: 'asc' }))).not.toBe(base)
  })
})
