import { describe, expect, it } from 'vitest'
import {
  AMBIGUOUS_OPERATION_TYPES,
  LABOR_ALLOCATION_CATEGORIES,
  LABOR_EXCEL_PROFILE_LEGACY_SCHEMA_VERSION,
  LABOR_EXCEL_PROFILE_SCHEMA_VERSION,
  LABOR_OPERATION_TYPES,
  deriveCategoryAmounts,
  deriveCategoryFromOperation,
  isProfileWritable,
  projectLaborAllocationToExcel,
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
