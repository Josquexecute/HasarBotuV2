import {
  LABOR_OPERATION_TYPES,
  type LaborAllocationAmount,
  type LaborOperationType,
} from './labor-allocation-ai.js'
import { normalizeLaborText } from './labor-sheet.js'

/**
 * Paket 60 — Excel şablon profilleri (HB-2026-067).
 *
 * Profil, kanonik operasyon türlerini sigorta şirketi bazlı Excel sütunlarına
 * eşleyen SÜRÜMLÜ ve KULLANICI TANIMLI bir yapılandırmadır. HB-2026-060 gereği
 * hiçbir şirketin kolon seti ürüne gömülmez: kolonlar ve eşleme tamamen
 * kullanıcı verisidir; bu modül yalnız kuralları tanımlar.
 *
 * Projeksiyon SALT OKUNURDUR ve dosyaya yazmaz. Dürüstlük kuralı: kullanıcı
 * uygulama sırasında tutarı değiştirdiyse (P58 `modified`), tür bazlı dağılım
 * artık doğrulanmış değildir; bu satır için sütun tutarı UYDURULMAZ, satır
 * "manuel sütun girişi gerekli" olarak işaretlenir.
 */
export const LABOR_EXCEL_PROFILE_SCHEMA_VERSION = 'labor-excel-profile/1.0.0' as const
export const MAX_LABOR_EXCEL_COLUMNS = 24
export const MAX_LABOR_EXCEL_COLUMN_KEY_LENGTH = 40
export const MAX_LABOR_EXCEL_COLUMN_LABEL_LENGTH = 80
export const MAX_LABOR_EXCEL_PROFILE_NAME_LENGTH = 80

export interface LaborExcelColumn {
  /** Normalize anahtar: A-Z, 0-9 ve alt çizgi; profil içinde tekildir. */
  readonly key: string
  /** Kullanıcının şablondaki gerçek sütun başlığı. */
  readonly label: string
}

/** Her kanonik tür ya bir sütuna eşlenir ya da açıkça eşlenmemiş bırakılır. */
export type LaborExcelMapping = Readonly<Record<LaborOperationType, string | null>>

export function normalizeLaborExcelColumnKey(value: string): string | null {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, '_')
  if (normalized.length < 1 || normalized.length > MAX_LABOR_EXCEL_COLUMN_KEY_LENGTH) return null
  if (!/^[A-Z0-9_]+$/.test(normalized)) return null
  return normalized
}

export type LaborExcelProfileInvalidReason =
  | 'invalid_name'
  | 'invalid_columns'
  | 'invalid_column_key'
  | 'duplicate_column_key'
  | 'invalid_column_label'
  | 'invalid_mapping_keys'
  | 'unknown_mapping_target'
  | 'no_mapped_operation_type'

export type LaborExcelProfileValidation =
  | { readonly valid: false; readonly reason: LaborExcelProfileInvalidReason }
  | {
    readonly valid: true
    readonly name: string
    readonly columns: readonly LaborExcelColumn[]
    readonly mapping: LaborExcelMapping
  }

/**
 * Profil girdisini doğrular ve normalize eder.
 *
 * - Eşleme HER kanonik türü içermek zorundadır (fazla/eksik anahtar yok);
 *   `null` "bilerek eşlenmedi" demektir ve projeksiyonda incelemeye düşer.
 * - En az bir tür eşlenmiş olmalıdır; tamamen boş profil anlamsızdır.
 */
export function validateLaborExcelProfileInput(input: {
  readonly name: string
  readonly columns: readonly { readonly key: string; readonly label: string }[]
  readonly mapping: Readonly<Record<string, string | null>>
}): LaborExcelProfileValidation {
  const name = normalizeLaborText(input.name, MAX_LABOR_EXCEL_PROFILE_NAME_LENGTH)
  if (name === null) return { valid: false, reason: 'invalid_name' }

  if (input.columns.length < 1 || input.columns.length > MAX_LABOR_EXCEL_COLUMNS) {
    return { valid: false, reason: 'invalid_columns' }
  }
  const columns: LaborExcelColumn[] = []
  const seenKeys = new Set<string>()
  for (const column of input.columns) {
    const key = normalizeLaborExcelColumnKey(column.key)
    if (key === null) return { valid: false, reason: 'invalid_column_key' }
    if (seenKeys.has(key)) return { valid: false, reason: 'duplicate_column_key' }
    seenKeys.add(key)
    const label = normalizeLaborText(column.label, MAX_LABOR_EXCEL_COLUMN_LABEL_LENGTH)
    if (label === null) return { valid: false, reason: 'invalid_column_label' }
    columns.push({ key, label })
  }

  const mappingKeys = Object.keys(input.mapping)
  if (mappingKeys.length !== LABOR_OPERATION_TYPES.length
    || !LABOR_OPERATION_TYPES.every((type) => mappingKeys.includes(type))) {
    return { valid: false, reason: 'invalid_mapping_keys' }
  }
  const mapping: Partial<Record<LaborOperationType, string | null>> = {}
  let mappedCount = 0
  for (const type of LABOR_OPERATION_TYPES) {
    const raw = input.mapping[type]
    if (raw === null || raw === undefined) {
      mapping[type] = null
      continue
    }
    const key = normalizeLaborExcelColumnKey(raw)
    if (key === null || !seenKeys.has(key)) return { valid: false, reason: 'unknown_mapping_target' }
    mapping[type] = key
    mappedCount += 1
  }
  if (mappedCount === 0) return { valid: false, reason: 'no_mapped_operation_type' }

  return { valid: true, name, columns, mapping: mapping as LaborExcelMapping }
}

export type LaborExcelProjectionLineStatus = 'projected' | 'manual_entry_required'

export interface LaborExcelProjectionLineInput {
  readonly lineOrdinal: number
  readonly description: string
  readonly appliedPartAmountMinor: number
  readonly appliedLaborAmountMinor: number
  /** P58: kullanıcı öneriyi değiştirerek uyguladıysa true. */
  readonly modified: boolean
  readonly controlRequired: boolean
  /** Kaynak öneri satırının tür bazlı dağılımı (yalnız değiştirilmemişse geçerli). */
  readonly allocations: readonly LaborAllocationAmount[]
}

export interface LaborExcelProjectionLine {
  readonly lineOrdinal: number
  readonly description: string
  readonly status: LaborExcelProjectionLineStatus
  readonly reviewRequired: boolean
  /** Profil sütun anahtarına göre tutar; manuel satırda tüm hücreler 0'dır. */
  readonly cells: Readonly<Record<string, number>>
  /** Eşlenmemiş türlere düşen toplam; sütuna yazılamaz, incelemeye düşer. */
  readonly unmappedAmountMinor: number
  readonly totalMinor: number
}

export interface LaborExcelProjection {
  readonly schemaVersion: typeof LABOR_EXCEL_PROFILE_SCHEMA_VERSION
  readonly lines: readonly LaborExcelProjectionLine[]
  readonly columnTotals: Readonly<Record<string, number>>
  readonly projectedLineCount: number
  readonly manualEntryLineCount: number
  readonly reviewRequiredLineCount: number
  readonly unmappedTotalMinor: number
}

/**
 * Uygulanmış dağıtımı profil sütunlarına projekte eder. Dosyaya yazmaz.
 *
 * Dürüstlük kuralları:
 * - `modified` satır: tür bazlı dağılım doğrulanmış değildir → hücre tutarı
 *   uydurulmaz, satır `manual_entry_required` olur (yalnız uygulanmış TOPLAM
 *   referans için gösterilir; o kullanıcının kendi verisidir).
 * - Değiştirilmemiş satırda dahi dağılım toplamı uygulanmış toplamı tutmuyorsa
 *   (veri tutarsızlığı) satır projekte EDİLMEZ; sessizce düzeltme yapılmaz.
 * - Eşlenmemiş türe düşen tutar hiçbir sütuna yazılmaz; satır incelemeye düşer.
 */
export function projectLaborAllocationToExcel(
  profile: {
    readonly columns: readonly LaborExcelColumn[]
    readonly mapping: LaborExcelMapping
  },
  lines: readonly LaborExcelProjectionLineInput[],
): LaborExcelProjection {
  const emptyCells = (): Record<string, number> => Object.fromEntries(
    profile.columns.map((column) => [column.key, 0]),
  )
  const columnTotals = emptyCells()
  const projectedLines: LaborExcelProjectionLine[] = []
  let projectedLineCount = 0
  let manualEntryLineCount = 0
  let reviewRequiredLineCount = 0
  let unmappedTotalMinor = 0

  for (const line of lines) {
    const totalMinor = line.appliedPartAmountMinor + line.appliedLaborAmountMinor
    const allocationSum = line.allocations.reduce((sum, item) => sum + item.amountMinor, 0)
    const projectable = !line.modified && allocationSum === totalMinor

    if (!projectable) {
      manualEntryLineCount += 1
      reviewRequiredLineCount += 1
      projectedLines.push({
        lineOrdinal: line.lineOrdinal,
        description: line.description,
        status: 'manual_entry_required',
        reviewRequired: true,
        cells: emptyCells(),
        unmappedAmountMinor: 0,
        totalMinor,
      })
      continue
    }

    const cells = emptyCells()
    let unmappedAmountMinor = 0
    for (const allocation of line.allocations) {
      const target = profile.mapping[allocation.operationType]
      if (target === null) {
        unmappedAmountMinor += allocation.amountMinor
        continue
      }
      cells[target] = (cells[target] ?? 0) + allocation.amountMinor
    }
    for (const column of profile.columns) {
      columnTotals[column.key] = (columnTotals[column.key] ?? 0) + (cells[column.key] ?? 0)
    }
    unmappedTotalMinor += unmappedAmountMinor
    const reviewRequired = line.controlRequired || unmappedAmountMinor > 0
    if (reviewRequired) reviewRequiredLineCount += 1
    projectedLineCount += 1
    projectedLines.push({
      lineOrdinal: line.lineOrdinal,
      description: line.description,
      status: 'projected',
      reviewRequired,
      cells,
      unmappedAmountMinor,
      totalMinor,
    })
  }

  return {
    schemaVersion: LABOR_EXCEL_PROFILE_SCHEMA_VERSION,
    lines: projectedLines,
    columnTotals,
    projectedLineCount,
    manualEntryLineCount,
    reviewRequiredLineCount,
    unmappedTotalMinor,
  }
}
