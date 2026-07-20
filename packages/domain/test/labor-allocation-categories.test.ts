import { describe, expect, it } from 'vitest'
import {
  AMBIGUOUS_OPERATION_TYPES,
  LABOR_ALLOCATION_CATEGORIES,
  LABOR_EXCEL_PROFILE_LEGACY_SCHEMA_VERSION,
  LABOR_EXCEL_PROFILE_SCHEMA_VERSION,
  LABOR_OPERATION_TYPES,
  categoryControlRequired,
  deriveCategoryAmounts,
  deriveCategoryFromOperation,
  isProfileWritable,
  projectLaborAllocationToExcel,
  validateLaborCategoryAllocation,
  validateLaborExcelProfileInput,
} from '../src/index.js'

/**
 * Paket 64 — dağıtım kategorisi ekseni.
 *
 * Ana iddia: operasyon türü ile Excel işçilik sütunu AYNI EKSEN DEĞİLDİR.
 * Kategori türetilemiyorsa tutar UYDURULMAZ; satır manuel girişe düşer.
 */
const COLUMNS = [
  { key: 'KAPORTA', label: 'Kaporta' },
  { key: 'BOYA', label: 'Boya' },
  { key: 'KALIBRASYON', label: 'Kalibrasyon' },
]

function categoryMapping(overrides: Partial<Record<string, string | null>> = {}) {
  return {
    bodywork: 'KAPORTA',
    mechanical: null,
    electrical: null,
    upholstery_lock: null,
    glass: null,
    calibration: 'KALIBRASYON',
    repair: 'KAPORTA',
    paint: 'BOYA',
    ...overrides,
  }
}

const PROFILE = {
  columns: COLUMNS,
  mapping: categoryMapping() as never,
}

function line(overrides: Record<string, unknown> = {}) {
  return {
    lineOrdinal: 1,
    description: 'Ön tampon',
    appliedPartAmountMinor: 0,
    appliedLaborAmountMinor: 100_000,
    modified: false,
    controlRequired: false,
    allocations: [{ operationType: 'repair' as const, amountMinor: 100_000 }],
    ...overrides,
  }
}

describe('Paket 64 — kategori ekseni operasyon türünden ayrıdır', () => {
  it('iki küme aynı sayıda olsa da aynı şey değildir', () => {
    expect(LABOR_ALLOCATION_CATEGORIES).toHaveLength(8)
    expect(LABOR_OPERATION_TYPES).toHaveLength(8)
    // Aynı adı taşıyan üyeler var ama kümeler ÖZDEŞ DEĞİL.
    expect([...LABOR_ALLOCATION_CATEGORIES].sort())
      .not.toEqual([...LABOR_OPERATION_TYPES].sort())
    expect(LABOR_ALLOCATION_CATEGORIES).toContain('bodywork')
    expect(LABOR_OPERATION_TYPES).not.toContain('bodywork')
    expect(LABOR_OPERATION_TYPES).toContain('replace')
    expect(LABOR_ALLOCATION_CATEGORIES).not.toContain('replace')
  })

  it('yalnız tek anlamlı türleri kategoriye çevirir', () => {
    expect(deriveCategoryFromOperation('paint')).toBe('paint')
    expect(deriveCategoryFromOperation('calibration')).toBe('calibration')
    expect(deriveCategoryFromOperation('repair')).toBe('repair')
  })

  it('branş bilgisi taşımayan türler için kategori UYDURMAZ', () => {
    for (const type of ['remove_install', 'consumable', 'related_operation', 'other'] as const) {
      expect(deriveCategoryFromOperation(type)).toBeNull()
    }
    // `replace` işçilik değildir; parça bedelidir.
    expect(deriveCategoryFromOperation('replace')).toBeNull()
    expect(AMBIGUOUS_OPERATION_TYPES).toContain('remove_install')
  })

  it('tek anlamlı dağılımı kategori tutarlarına çevirir', () => {
    const result = deriveCategoryAmounts([
      { operationType: 'repair', amountMinor: 60_000 },
      { operationType: 'paint', amountMinor: 40_000 },
    ])
    expect(result.ok).toBe(true)
    // Sıra kategori listesine göre deterministiktir.
    expect(result.ok && result.amounts).toEqual([
      { category: 'repair', amountMinor: 60_000 },
      { category: 'paint', amountMinor: 40_000 },
    ])
  })

  it('belirsiz tek tutar TÜM satırı reddeder; kısmi dağılım üretmez', () => {
    const result = deriveCategoryAmounts([
      { operationType: 'repair', amountMinor: 60_000 },
      { operationType: 'remove_install', amountMinor: 40_000 },
    ])
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toBe('category_ambiguous')
    expect(!result.ok && result.operationType).toBe('remove_install')
  })

  it('parça bedelini işçilik sütununa taşımaz', () => {
    const result = deriveCategoryAmounts([{ operationType: 'replace', amountMinor: 90_000 }])
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toBe('not_labor_amount')
  })

  it('sıfır tutarlı belirsiz tür belirsizlik yaratmaz', () => {
    const result = deriveCategoryAmounts([
      { operationType: 'repair', amountMinor: 100_000 },
      { operationType: 'remove_install', amountMinor: 0 },
    ])
    expect(result.ok).toBe(true)
    expect(result.ok && result.amounts).toEqual([{ category: 'repair', amountMinor: 100_000 }])
  })
})

describe('Paket 64 — projeksiyon kategori eksenine bağlı', () => {
  it('tek anlamlı satırı doğru sütuna projekte eder', () => {
    const result = projectLaborAllocationToExcel(PROFILE, [line()])
    expect(result.lines[0]?.status).toBe('projected')
    expect(result.lines[0]?.cells).toEqual({ KAPORTA: 100_000, BOYA: 0, KALIBRASYON: 0 })
  })

  it('belirsiz kategorili satırı manuel girişe düşürür; tutar uydurmaz', () => {
    const result = projectLaborAllocationToExcel(PROFILE, [line({
      allocations: [{ operationType: 'remove_install', amountMinor: 100_000 }],
    })])
    expect(result.lines[0]?.status).toBe('manual_entry_required')
    expect(result.lines[0]?.cells).toEqual({ KAPORTA: 0, BOYA: 0, KALIBRASYON: 0 })
    expect(result.manualEntryLineCount).toBe(1)
    // Toplam yine de referans olarak görünür; o kullanıcının kendi verisidir.
    expect(result.lines[0]?.totalMinor).toBe(100_000)
  })

  it('kullanıcı değiştirdiyse yine manuel girişte kalır', () => {
    const result = projectLaborAllocationToExcel(PROFILE, [line({ modified: true })])
    expect(result.lines[0]?.status).toBe('manual_entry_required')
  })

  it('eşlenmemiş kategoriye düşen tutarı hiçbir sütuna yazmaz', () => {
    const profile = { columns: COLUMNS, mapping: categoryMapping({ paint: null }) as never }
    const result = projectLaborAllocationToExcel(profile, [line({
      allocations: [
        { operationType: 'repair', amountMinor: 60_000 },
        { operationType: 'paint', amountMinor: 40_000 },
      ],
    })])
    expect(result.lines[0]?.status).toBe('projected')
    expect(result.lines[0]?.unmappedAmountMinor).toBe(40_000)
    expect(result.lines[0]?.cells.BOYA).toBe(0)
    expect(result.lines[0]?.reviewRequired).toBe(true)
  })
})

describe('Paket 64 — profil şema sürümü', () => {
  it('yalnız kategori eksenli 2.0.0 fiziksel yazıma uygundur', () => {
    expect(LABOR_EXCEL_PROFILE_SCHEMA_VERSION).toBe('labor-excel-profile/2.0.0')
    expect(isProfileWritable(LABOR_EXCEL_PROFILE_SCHEMA_VERSION)).toBe(true)
    // Eski profil okunabilir ama YAZILAMAZ.
    expect(isProfileWritable(LABOR_EXCEL_PROFILE_LEGACY_SCHEMA_VERSION)).toBe(false)
    expect(isProfileWritable('labor-excel-profile/9.9.9')).toBe(false)
  })

  it('profil doğrulaması kategori anahtarları bekler', () => {
    const valid = validateLaborExcelProfileInput({
      name: 'Kategori Profili', columns: COLUMNS, mapping: categoryMapping(),
    })
    expect(valid.valid).toBe(true)

    // Operasyon türü anahtarlarıyla gelen ESKİ eşleme reddedilir; sessizce
    // yeniden yorumlanmaz.
    const legacy = validateLaborExcelProfileInput({
      name: 'Eski Profil',
      columns: COLUMNS,
      mapping: {
        repair: 'KAPORTA', replace: null, remove_install: null, paint: 'BOYA',
        consumable: null, calibration: 'KALIBRASYON', related_operation: null, other: null,
      },
    })
    expect(legacy.valid).toBe(false)
    expect(!legacy.valid && legacy.reason).toBe('invalid_mapping_keys')
  })
})

describe('Paket 64 ara dilim — AI kategori dağılımı doğrulaması', () => {
  const LABOR = 100_000

  function amounts(overrides: Record<string, unknown> = {}) {
    return {
      bodywork: 60_000,
      mechanical: 0,
      electrical: 0,
      upholstery_lock: 0,
      glass: 0,
      calibration: 0,
      repair: 0,
      paint: 40_000,
      ...overrides,
    }
  }

  function input(overrides: Record<string, unknown> = {}) {
    return {
      amounts: amounts(),
      reasoning: 'Kaporta ve boya işçiliği ayrıldı.',
      confidence: 0.8,
      evidenceRefs: ['line-1-description'],
      conflictCodes: [],
      ...overrides,
    }
  }

  it('eksiksiz ve toplamı tutan dağılımı kabul eder', () => {
    const result = validateLaborCategoryAllocation(input(), LABOR)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.totalMinor).toBe(LABOR)
    // Kullanılmayan kategoriler 0 taşır ama listede bulunur.
    expect(result.amounts).toHaveLength(8)
    expect(result.amounts.find((item) => item.category === 'bodywork')?.amountMinor).toBe(60_000)
  })

  it('sekiz kategoriden biri eksikse reddeder; sessiz eksik anahtar yok', () => {
    const partial = amounts()
    delete (partial as Record<string, unknown>).glass
    const result = validateLaborCategoryAllocation(input({ amounts: partial }), LABOR)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toBe('category_keys_incomplete')
    expect(!result.ok && result.detail).toBe('glass')
  })

  it('bilinmeyen kategori anahtarını reddeder', () => {
    const result = validateLaborCategoryAllocation(
      input({ amounts: { ...amounts(), welding: 0 } }), LABOR,
    )
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toBe('category_keys_unknown')
  })

  it('toplam işçilik tutarına eşit değilse reddeder', () => {
    const fazla = validateLaborCategoryAllocation(input({ amounts: amounts({ paint: 40_001 }) }), LABOR)
    expect(fazla.ok).toBe(false)
    expect(!fazla.ok && fazla.reason).toBe('category_total_mismatch')

    const eksik = validateLaborCategoryAllocation(input({ amounts: amounts({ paint: 39_999 }) }), LABOR)
    expect(eksik.ok).toBe(false)
  })

  it('parça tutarı kategori toplamına dahil edilmez', () => {
    // İşçilik 100.000 iken parça 900.000 olsa bile toplam yalnız işçiliğe
    // eşit olmalıdır; parçayı ekleyen bir model çıktısı reddedilir.
    const result = validateLaborCategoryAllocation(
      input({ amounts: amounts({ bodywork: 960_000 }) }), LABOR,
    )
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toBe('category_total_mismatch')
  })

  it('negatif tutarı ve küsuratı reddeder', () => {
    const negatif = validateLaborCategoryAllocation(
      input({ amounts: amounts({ bodywork: -10, paint: 100_010 }) }), LABOR,
    )
    expect(negatif.ok).toBe(false)
    expect(!negatif.ok && negatif.reason).toBe('category_amount_negative')

    const kusurat = validateLaborCategoryAllocation(
      input({ amounts: amounts({ bodywork: 60_000.5, paint: 39_999.5 }) }), LABOR,
    )
    expect(kusurat.ok).toBe(false)
    expect(!kusurat.ok && kusurat.reason).toBe('category_amount_not_integer')
  })

  it('gerekçesiz veya geçersiz güvenli dağılımı reddeder', () => {
    expect(validateLaborCategoryAllocation(input({ reasoning: '   ' }), LABOR).ok).toBe(false)
    expect(validateLaborCategoryAllocation(input({ confidence: 1.5 }), LABOR).ok).toBe(false)
    expect(validateLaborCategoryAllocation(input({ confidence: -0.1 }), LABOR).ok).toBe(false)
  })

  it('bilinmeyen çelişki kodunu reddeder', () => {
    const result = validateLaborCategoryAllocation(
      input({ conflictCodes: ['UYDURMA_KOD'] }), LABOR,
    )
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toBe('category_conflict_code_unknown')
  })

  it('sıfır işçilikte tüm kategoriler sıfır olmalıdır', () => {
    const sifir = validateLaborCategoryAllocation(
      input({ amounts: amounts({ bodywork: 0, paint: 0 }) }), 0,
    )
    expect(sifir.ok).toBe(true)
  })

  it('yüksek güven sunucu kontrol zorlamasını KALDIRAMAZ', () => {
    // Model 0.99 güven bildirse de çelişki kodu varsa kontrol zorunludur.
    expect(categoryControlRequired({
      confidence: 0.99,
      conflictCodes: ['CATEGORY_EVIDENCE_INSUFFICIENT'],
    })).toBe(true)
    // Eşiğin altındaki güven de kontrolü zorlar.
    expect(categoryControlRequired({ confidence: 0.5, conflictCodes: [] })).toBe(true)
    expect(categoryControlRequired({ confidence: 0.9, conflictCodes: [] })).toBe(false)
  })
})
