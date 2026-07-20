import { describe, expect, it } from 'vitest'
import {
  LABOR_ALLOCATION_CATEGORIES,
  normalizeLaborExcelColumnKey,
  normalizeLaborExcelTargetSheet,
  selectLaborExcelProfileCandidates,
  projectLaborAllocationToExcel,
  validateLaborExcelProfileInput,
  type LaborExcelProjectionLineInput,
} from '../src/index.js'

const COLUMNS = [
  { key: 'ISCILIK', label: 'İşçilik Bedeli' },
  { key: 'PARCA', label: 'Parça Bedeli' },
  { key: 'BOYA', label: 'Boya ve Sarf' },
]

/**
 * Sentetik eşleme; hiçbir gerçek sigorta şirketi kolonu ürüne gömülmez.
 *
 * P64: eşleme artık DAĞITIM KATEGORİSİ eksenindedir. `replace` burada yoktur
 * çünkü parça bedeli bir işçilik sütunu değildir.
 */
function mapping(overrides: Partial<Record<string, string | null>> = {}) {
  return {
    bodywork: 'ISCILIK',
    mechanical: 'ISCILIK',
    electrical: null,
    upholstery_lock: null,
    glass: null,
    calibration: null,
    repair: 'ISCILIK',
    paint: 'BOYA',
    ...overrides,
  }
}

function profile(mappingOverrides: Partial<Record<string, string | null>> = {}) {
  const validation = validateLaborExcelProfileInput({
    name: 'Sentetik Şablon',
    columns: COLUMNS,
    mapping: mapping(mappingOverrides),
  })
  if (!validation.valid) throw new Error(`profile_invalid_${validation.reason}`)
  return { columns: validation.columns, mapping: validation.mapping }
}

function line(overrides: Partial<LaborExcelProjectionLineInput> = {}): LaborExcelProjectionLineInput {
  return {
    lineOrdinal: 1,
    description: 'Ön tampon',
    appliedPartAmountMinor: 0,
    appliedLaborAmountMinor: 1_000_000,
    modified: false,
    controlRequired: false,
    // P64: projeksiyonun kaynağı UYGULANAN kategori dağılımıdır.
    categoryAmounts: LABOR_ALLOCATION_CATEGORIES.map((category) => ({
      category,
      amountMinor: category === 'repair' ? 800_000 : category === 'paint' ? 200_000 : 0,
    })),
    ...overrides,
  }
}

describe('normalizeLaborExcelColumnKey', () => {
  it('boşlukları alt çizgiye çevirir ve büyük harfe alır', () => {
    expect(normalizeLaborExcelColumnKey(' iscilik bedeli ')).toBe('ISCILIK_BEDELI')
  })

  it('geçersiz karakteri reddeder', () => {
    expect(normalizeLaborExcelColumnKey('parça')).toBeNull()
    expect(normalizeLaborExcelColumnKey('')).toBeNull()
  })
})

describe('validateLaborExcelProfileInput', () => {
  it('geçerli profili normalize eder', () => {
    const result = validateLaborExcelProfileInput({
      name: '  Sentetik Şablon ',
      columns: [{ key: ' iscilik ', label: ' İşçilik ' }],
      mapping: mapping({
        bodywork: null, mechanical: null, paint: null, repair: 'iscilik',
      }),
    })
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.name).toBe('Sentetik Şablon')
    expect(result.columns[0]?.key).toBe('ISCILIK')
    expect(result.mapping.repair).toBe('ISCILIK')
    expect(result.mapping.glass).toBeNull()
  })

  it('eşleme HER kanonik türü içermelidir', () => {
    const partial = { ...mapping() }
    delete (partial as Record<string, unknown>).glass
    const result = validateLaborExcelProfileInput({ name: 'X', columns: COLUMNS, mapping: partial })
    expect(result).toEqual({ valid: false, reason: 'invalid_mapping_keys' })
  })

  it('bilinmeyen türü reddeder', () => {
    const result = validateLaborExcelProfileInput({
      name: 'X', columns: COLUMNS, mapping: { ...mapping(), welding: 'ISCILIK' },
    })
    expect(result).toEqual({ valid: false, reason: 'invalid_mapping_keys' })
  })

  it('tanımsız sütuna eşlemeyi reddeder', () => {
    const result = validateLaborExcelProfileInput({
      name: 'X', columns: COLUMNS, mapping: mapping({ repair: 'YOK_BOYLE' }),
    })
    expect(result).toEqual({ valid: false, reason: 'unknown_mapping_target' })
  })

  it('mükerrer sütun anahtarını reddeder', () => {
    const result = validateLaborExcelProfileInput({
      name: 'X',
      columns: [{ key: 'A', label: 'A' }, { key: ' a ', label: 'B' }],
      mapping: mapping({ repair: 'A', bodywork: null, mechanical: null, paint: null }),
    })
    expect(result).toEqual({ valid: false, reason: 'duplicate_column_key' })
  })

  it('hiç eşlenmemiş profil anlamsızdır', () => {
    const empty = Object.fromEntries(LABOR_ALLOCATION_CATEGORIES.map((category) => [category, null]))
    const result = validateLaborExcelProfileInput({ name: 'X', columns: COLUMNS, mapping: empty })
    expect(result).toEqual({ valid: false, reason: 'no_mapped_operation_type' })
  })

  it('boş ad ve sütunsuz profil reddedilir', () => {
    expect(validateLaborExcelProfileInput({ name: '   ', columns: COLUMNS, mapping: mapping() }))
      .toEqual({ valid: false, reason: 'invalid_name' })
    expect(validateLaborExcelProfileInput({ name: 'X', columns: [], mapping: mapping() }))
      .toEqual({ valid: false, reason: 'invalid_columns' })
  })
})

describe('projectLaborAllocationToExcel', () => {
  it('değiştirilmemiş satırı sütunlara dağıtır', () => {
    const result = projectLaborAllocationToExcel(profile(), [line()])
    expect(result.projectedLineCount).toBe(1)
    expect(result.manualEntryLineCount).toBe(0)
    const projected = result.lines[0]
    expect(projected?.status).toBe('projected')
    expect(projected?.cells.ISCILIK).toBe(800_000)
    expect(projected?.cells.BOYA).toBe(200_000)
    expect(projected?.cells.PARCA).toBe(0)
    expect(result.columnTotals.ISCILIK).toBe(800_000)
  })

  it('aynı sütuna eşlenen kategorileri deterministik toplar', () => {
    // Bu profilde hem onarım hem kalibrasyon aynı sütuna eşlenmiştir.
    const result = projectLaborAllocationToExcel(profile({ calibration: 'ISCILIK' }), [line({
      categoryAmounts: LABOR_ALLOCATION_CATEGORIES.map((category) => ({
        category,
        amountMinor: category === 'repair' ? 700_000 : category === 'calibration' ? 300_000 : 0,
      })),
    })])
    expect(result.lines[0]?.cells.ISCILIK).toBe(1_000_000)
  })

  it('provenance yoksa SAYI UYDURMAZ', () => {
    // P64: kaynak artık uygulanan kategori dağılımıdır. Dağılım yoksa hücre
    // üretilemez; eski öneriyi ölçeklemek uydurma olurdu.
    const result = projectLaborAllocationToExcel(profile(), [line({ categoryAmounts: null })])
    const projected = result.lines[0]
    expect(projected?.status).toBe('manual_entry_required')
    expect(projected?.manualEntryReasons).toEqual(['category_provenance_missing'])
    expect(projected?.reviewRequired).toBe(true)
    expect(projected?.cells.ISCILIK).toBe(0)
    expect(projected?.cells.BOYA).toBe(0)
    // Uygulanan TOPLAM referans olarak korunur; o kullanıcının kendi verisidir.
    expect(projected?.totalMinor).toBe(1_000_000)
    expect(result.manualEntryLineCount).toBe(1)
    expect(result.columnTotals.ISCILIK).toBe(0)
  })

  it('kullanıcı değiştirdiyse UYGULANAN kategori tutarları yazılır', () => {
    // P58'de `modified` satır düşerdi; artık dağılımı kullanıcı söylüyor.
    const result = projectLaborAllocationToExcel(profile(), [line({
      modified: true,
      categoryAmounts: LABOR_ALLOCATION_CATEGORIES.map((category) => ({
        category,
        amountMinor: category === 'repair' ? 1_000_000 : 0,
      })),
    })])
    expect(result.lines[0]?.status).toBe('projected')
    expect(result.lines[0]?.cells.ISCILIK).toBe(1_000_000)
  })

  it('kategori toplamı işçilik tutarını tutmuyorsa sessizce düzeltmez', () => {
    const result = projectLaborAllocationToExcel(profile(), [line({
      categoryAmounts: LABOR_ALLOCATION_CATEGORIES.map((category) => ({
        category,
        amountMinor: category === 'repair' ? 999_999 : 0,
      })),
    })])
    expect(result.lines[0]?.status).toBe('manual_entry_required')
    expect(result.lines[0]?.manualEntryReasons).toEqual(['category_total_mismatch'])
    expect(result.projectedLineCount).toBe(0)
  })

  it('eşlenmemiş kategoriye düşen POZİTİF tutar satırı manuel girişe indirir', () => {
    const result = projectLaborAllocationToExcel(profile(), [line({
      categoryAmounts: LABOR_ALLOCATION_CATEGORIES.map((category) => ({
        category,
        amountMinor: category === 'repair' ? 600_000 : category === 'calibration' ? 400_000 : 0,
      })),
    })])
    const projected = result.lines[0]
    expect(projected?.status).toBe('manual_entry_required')
    expect(projected?.manualEntryReasons).toEqual(['category_column_unmapped'])
    // Yarım satır yazmak Excel'de yanıltıcı olurdu: eşlenen kısım da düşer.
    expect(projected?.cells.ISCILIK).toBe(0)
    expect(projected?.unmappedAmountMinor).toBe(400_000)
    expect(projected?.reviewRequired).toBe(true)
    expect(result.unmappedTotalMinor).toBe(400_000)
    // Satır tamamen düştüğü için HİÇBİR sütun toplamına katkı vermez.
    const columnSum = Object.values(result.columnTotals).reduce((sum, value) => sum + value, 0)
    expect(columnSum).toBe(0)
  })

  it('control_required satır projekte edilse de incelemeye düşer', () => {
    const result = projectLaborAllocationToExcel(profile(), [line({ controlRequired: true })])
    expect(result.lines[0]?.status).toBe('projected')
    expect(result.lines[0]?.reviewRequired).toBe(true)
    expect(result.reviewRequiredLineCount).toBe(1)
  })

  it('boş satır listesinde sıfır toplam üretir', () => {
    const result = projectLaborAllocationToExcel(profile(), [])
    expect(result.lines).toHaveLength(0)
    expect(result.columnTotals).toEqual({ ISCILIK: 0, PARCA: 0, BOYA: 0 })
  })
})

describe('Paket 63 — profil adayı seçimi', () => {
  const INSURER_A = 'insurer-a'
  const INSURER_B = 'insurer-b'

  function candidate(
    profileId: string,
    insurerId: string | null,
    status: 'active' | 'inactive' = 'active',
  ) {
    return { profileId, insurerId, status }
  }

  it('dosyanın şirketine ait tek aktif profili önerir', () => {
    const result = selectLaborExcelProfileCandidates(INSURER_A, [
      candidate('p1', INSURER_A),
    ])
    expect(result.suggestedProfileId).toBe('p1')
    expect(result.reason).toBe('single_insurer_profile')
    expect(result.candidates).toEqual([{ profileId: 'p1', scope: 'insurer' }])
  })

  it('birden fazla adayda öneri yapmaz; seçim kullanıcıya kalır', () => {
    const result = selectLaborExcelProfileCandidates(INSURER_A, [
      candidate('p1', INSURER_A),
      candidate('p2', INSURER_A),
    ])
    expect(result.suggestedProfileId).toBeNull()
    expect(result.reason).toBe('selection_required')
    expect(result.candidates).toHaveLength(2)
  })

  it('başka sigorta şirketinin profilini aday yapmaz', () => {
    const result = selectLaborExcelProfileCandidates(INSURER_A, [
      candidate('yabanci', INSURER_B),
    ])
    expect(result.candidates).toHaveLength(0)
    expect(result.reason).toBe('no_candidates')
    expect(result.suggestedProfileId).toBeNull()
  })

  it('pasif profil aday değildir', () => {
    const result = selectLaborExcelProfileCandidates(INSURER_A, [
      candidate('pasif', INSURER_A, 'inactive'),
    ])
    expect(result.candidates).toHaveLength(0)
    expect(result.reason).toBe('no_candidates')
  })

  it('pasifleşen tek profil öneriyi düşürür', () => {
    const active = selectLaborExcelProfileCandidates(INSURER_A, [candidate('p1', INSURER_A)])
    expect(active.suggestedProfileId).toBe('p1')
    const after = selectLaborExcelProfileCandidates(INSURER_A, [
      candidate('p1', INSURER_A, 'inactive'),
    ])
    expect(after.suggestedProfileId).toBeNull()
  })

  it('genel profil adaydır ama ASLA otomatik önerilmez', () => {
    const result = selectLaborExcelProfileCandidates(INSURER_A, [candidate('genel', null)])
    expect(result.candidates).toEqual([{ profileId: 'genel', scope: 'generic' }])
    expect(result.suggestedProfileId).toBeNull()
    expect(result.reason).toBe('selection_required')
  })

  it('genel profil şirkete bağlı tek profilin önerisini engellemez', () => {
    const result = selectLaborExcelProfileCandidates(INSURER_A, [
      candidate('genel', null),
      candidate('p1', INSURER_A),
    ])
    expect(result.suggestedProfileId).toBe('p1')
    expect(result.candidates).toHaveLength(2)
  })

  it('dosyada sigorta şirketi yoksa yalnız genel profiller aday olur', () => {
    const bos = selectLaborExcelProfileCandidates(null, [candidate('p1', INSURER_A)])
    expect(bos.candidates).toHaveLength(0)
    expect(bos.reason).toBe('insurer_unknown')

    const genel = selectLaborExcelProfileCandidates(null, [candidate('genel', null)])
    expect(genel.candidates).toEqual([{ profileId: 'genel', scope: 'generic' }])
    expect(genel.suggestedProfileId).toBeNull()
  })
})

describe('Paket 63 — hedef sayfa ve kimlik doğrulama kuralları', () => {
  it('hedef sayfa adını normalize eder', () => {
    expect(normalizeLaborExcelTargetSheet('  Isçilik   Föyü ')).toBe('Isçilik Föyü')
  })

  it('Excel sayfa adında yasak karakterleri ve uzunluğu reddeder', () => {
    for (const invalid of ['a:b', 'a/b', 'a\b', 'a?b', 'a*b', 'a[b', 'a]b', '', '   ']) {
      expect(normalizeLaborExcelTargetSheet(invalid)).toBeNull()
    }
    expect(normalizeLaborExcelTargetSheet('x'.repeat(32))).toBeNull()
    expect(normalizeLaborExcelTargetSheet('x'.repeat(31))).toBe('x'.repeat(31))
  })

  it('hedef sayfa verilmezse null kalır ama geçersizse profil reddedilir', () => {
    const bos = validateLaborExcelProfileInput({
      name: 'Profil', columns: COLUMNS, mapping: mapping(),
    })
    expect(bos.valid && bos.targetSheet).toBeNull()
    expect(bos.valid && bos.identityChecks).toEqual({ plate: false, officeNumber: false })

    const gecersiz = validateLaborExcelProfileInput({
      name: 'Profil', columns: COLUMNS, mapping: mapping(), targetSheet: 'Sayfa:1',
    })
    expect(gecersiz.valid).toBe(false)
    expect(!gecersiz.valid && gecersiz.reason).toBe('invalid_target_sheet')
  })

  it('kimlik doğrulama kurallarını olduğu gibi taşır', () => {
    const result = validateLaborExcelProfileInput({
      name: 'Profil',
      columns: COLUMNS,
      mapping: mapping(),
      targetSheet: 'Föy',
      identityChecks: { plate: true, officeNumber: false },
    })
    expect(result.valid && result.targetSheet).toBe('Föy')
    expect(result.valid && result.identityChecks).toEqual({ plate: true, officeNumber: false })
  })
})
