import {
  LABOR_ALLOCATION_CATEGORIES,
  type LaborAllocationCategory,
  type LaborCategoryAmount,
} from './labor-allocation-categories.js'
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
/**
 * Paket 64 — şema sürümü 2.0.0.
 *
 * 1.0.0 profilleri kanonik OPERASYON TÜRÜNÜ Excel sütununa eşliyordu. Gerçek
 * şablon keşfi bunun yanlış eksen olduğunu gösterdi: sütunlar işçilik BRANŞI
 * (kaporta, mekanik, elektrik...), operasyon türü ise işlemin ne olduğudur.
 *
 * Eski kayıtlar SESSİZCE YENİDEN YORUMLANMAZ. 1.0.0 profilleri okunabilir
 * kalır ama fiziksel yazıma UYGUN DEĞİLDİR; yazım yalnız 2.0.0 kategori
 * eşlemesiyle yapılır.
 */
export const LABOR_EXCEL_PROFILE_SCHEMA_VERSION = 'labor-excel-profile/2.0.0' as const
export const LABOR_EXCEL_PROFILE_LEGACY_SCHEMA_VERSION = 'labor-excel-profile/1.0.0' as const
export const LABOR_EXCEL_PROFILE_SCHEMA_VERSIONS = [
  LABOR_EXCEL_PROFILE_LEGACY_SCHEMA_VERSION,
  LABOR_EXCEL_PROFILE_SCHEMA_VERSION,
] as const

export type LaborExcelProfileSchemaVersion =
  (typeof LABOR_EXCEL_PROFILE_SCHEMA_VERSIONS)[number]

/**
 * Profil fiziksel yazıma uygun mu?
 *
 * Yalnız kategori eksenli 2.0.0 profilleri yazabilir. Bu kontrol tek yerde
 * durur ki "eski profil de yazar" varsayımı hiçbir çağrı yolunda oluşmasın.
 */
export function isProfileWritable(schemaVersion: string): boolean {
  return schemaVersion === LABOR_EXCEL_PROFILE_SCHEMA_VERSION
}

export const MAX_LABOR_EXCEL_COLUMNS = 24
export const MAX_LABOR_EXCEL_COLUMN_KEY_LENGTH = 40
export const MAX_LABOR_EXCEL_COLUMN_LABEL_LENGTH = 80
export const MAX_LABOR_EXCEL_PROFILE_NAME_LENGTH = 80
export const MAX_LABOR_EXCEL_TARGET_SHEET_LENGTH = 31

/**
 * Paket 63 — profil durumu. Pasif profil YENİ projeksiyonda seçilemez ama
 * eski kayıtlarda okunabilir kalır; bu yüzden silme değil durum kullanılır.
 */
export const LABOR_EXCEL_PROFILE_STATUSES = ['active', 'inactive'] as const
export type LaborExcelProfileStatus = (typeof LABOR_EXCEL_PROFILE_STATUSES)[number]

/**
 * Yazmadan ÖNCE hangi kimliklerin dosyada doğrulanması gerektiği.
 *
 * Bilerek yalnız "ne doğrulanacak" tutulur, "nerede bulunacak" değil: gerçek
 * şablon dosyası okunmadan hücre koordinatı uydurmak yanlış güven yaratır.
 * Geometri, şablon ilk kez okunduğunda modele girer.
 */
export interface LaborExcelIdentityChecks {
  readonly plate: boolean
  readonly officeNumber: boolean
}

export const EMPTY_LABOR_EXCEL_IDENTITY_CHECKS: LaborExcelIdentityChecks = {
  plate: false,
  officeNumber: false,
}

/**
 * Hedef sayfa adı. Excel sayfa adı 31 karakterle sınırlıdır ve
 * `: \ / ? * [ ]` karakterlerini taşıyamaz.
 */
export function normalizeLaborExcelTargetSheet(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (normalized.length < 1 || normalized.length > MAX_LABOR_EXCEL_TARGET_SHEET_LENGTH) return null
  if (/[:\\/?*[\]]/.test(normalized)) return null
  for (const character of normalized) {
    const code = character.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return null
  }
  return normalized
}

export interface LaborExcelColumn {
  /** Normalize anahtar: A-Z, 0-9 ve alt çizgi; profil içinde tekildir. */
  readonly key: string
  /** Kullanıcının şablondaki gerçek sütun başlığı. */
  readonly label: string
}

/** Aday seçiminde profilin karar için gereken asgari bilgisi. */
export interface LaborExcelProfileCandidateInput {
  readonly profileId: string
  readonly insurerId: string | null
  readonly status: LaborExcelProfileStatus
}

export type LaborExcelProfileCandidateScope = 'insurer' | 'generic'

export interface LaborExcelProfileCandidate {
  readonly profileId: string
  /**
   * `insurer`: profil dosyanın sigorta şirketine bağlıdır.
   * `generic`: profil hiçbir şirkete bağlı değildir (P60'ta modellendi).
   */
  readonly scope: LaborExcelProfileCandidateScope
}

export type LaborExcelProfileSuggestionReason =
  /** Dosyanın sigorta şirketine bağlı TEK aktif profil var. */
  | 'single_insurer_profile'
  /**
   * Aday var ama otomatik öneri yapılamaz; seçim kullanıcıya aittir.
   * Birden fazla aday olduğunda da, tek aday genel profil olduğunda da budur.
   */
  | 'selection_required'
  /** Hiç aday yok. */
  | 'no_candidates'
  /** Dosyada sigorta şirketi yok; yalnız genel profiller aday olabilir. */
  | 'insurer_unknown'

export interface LaborExcelProfileSelection {
  readonly candidates: readonly LaborExcelProfileCandidate[]
  /** Yalnız ÖNERİDİR; kullanıcı seçmeden hiçbir şey kesinleşmez. */
  readonly suggestedProfileId: string | null
  readonly reason: LaborExcelProfileSuggestionReason
}

/**
 * Paket 63 — dosya için seçilebilir profilleri ve öneriyi belirler.
 *
 * Kurallar:
 * - Girdi ZATEN organizasyona göre süzülmüş olmalıdır; bu fonksiyon
 *   organizasyon sınırını tekrar uygulayamaz çünkü o bilgi burada yoktur.
 *   Sınır sunucuda sorgu seviyesinde uygulanır.
 * - BAŞKA bir sigorta şirketine bağlı profil aday DEĞİLDİR.
 * - Hiçbir şirkete bağlı olmayan (genel) profil adaydır ama ASLA otomatik
 *   önerilmez: öneri yalnız dosyanın şirketine ait tek aktif profille olur.
 * - Pasif profil aday değildir.
 * - Öneri seçim yerine geçmez; kullanıcı onayı olmadan kesinleşmez.
 */
export function selectLaborExcelProfileCandidates(
  caseInsurerId: string | null,
  profiles: readonly LaborExcelProfileCandidateInput[],
): LaborExcelProfileSelection {
  const candidates: LaborExcelProfileCandidate[] = []
  const insurerBound: string[] = []
  for (const profile of profiles) {
    if (profile.status !== 'active') continue
    if (profile.insurerId === null) {
      candidates.push({ profileId: profile.profileId, scope: 'generic' })
      continue
    }
    if (caseInsurerId === null || profile.insurerId !== caseInsurerId) continue
    candidates.push({ profileId: profile.profileId, scope: 'insurer' })
    insurerBound.push(profile.profileId)
  }

  if (candidates.length === 0) {
    return {
      candidates,
      suggestedProfileId: null,
      reason: caseInsurerId === null ? 'insurer_unknown' : 'no_candidates',
    }
  }
  // Öneri yalnız şirkete bağlı TEK aktif profille yapılır; genel profil
  // veya birden fazla aday varsa seçim kullanıcıya bırakılır.
  const suggested = insurerBound.length === 1 ? insurerBound[0] : undefined
  if (suggested === undefined) {
    return { candidates, suggestedProfileId: null, reason: 'selection_required' }
  }
  return { candidates, suggestedProfileId: suggested, reason: 'single_insurer_profile' }
}

/**
 * Her DAĞITIM KATEGORİSİ ya bir sütuna eşlenir ya da açıkça eşlenmemiş
 * bırakılır. P64'ten önce bu eşleme operasyon türü eksenindeydi; keşif o
 * eksenin yanlış olduğunu gösterdi (bkz. `labor-allocation-categories`).
 */
export type LaborExcelMapping = Readonly<Record<LaborAllocationCategory, string | null>>

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
  | 'invalid_target_sheet'

export type LaborExcelProfileValidation =
  | { readonly valid: false; readonly reason: LaborExcelProfileInvalidReason }
  | {
    readonly valid: true
    readonly name: string
    readonly columns: readonly LaborExcelColumn[]
    readonly mapping: LaborExcelMapping
    /** P63: hedef sayfa; tanımlanmamışsa null (yazım öncesi zorunlu olacak). */
    readonly targetSheet: string | null
    readonly identityChecks: LaborExcelIdentityChecks
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
  readonly targetSheet?: string | null
  readonly identityChecks?: LaborExcelIdentityChecks
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

  // P64: eşleme artık DAĞITIM KATEGORİSİ eksenindedir; operasyon türü
  // doğrudan Excel sütununa eşlenmez.
  const mappingKeys = Object.keys(input.mapping)
  if (mappingKeys.length !== LABOR_ALLOCATION_CATEGORIES.length
    || !LABOR_ALLOCATION_CATEGORIES.every((category) => mappingKeys.includes(category))) {
    return { valid: false, reason: 'invalid_mapping_keys' }
  }
  const mapping: Partial<Record<LaborAllocationCategory, string | null>> = {}
  let mappedCount = 0
  for (const category of LABOR_ALLOCATION_CATEGORIES) {
    const raw = input.mapping[category]
    if (raw === null || raw === undefined) {
      mapping[category] = null
      continue
    }
    const key = normalizeLaborExcelColumnKey(raw)
    if (key === null || !seenKeys.has(key)) return { valid: false, reason: 'unknown_mapping_target' }
    mapping[category] = key
    mappedCount += 1
  }
  if (mappedCount === 0) return { valid: false, reason: 'no_mapped_operation_type' }

  // Hedef sayfa isteğe bağlıdır ama VERİLDİYSE geçerli olmalıdır; boş string
  // "tanımlanmadı" ile aynı değildir ve sessizce null'a çevrilmez.
  let targetSheet: string | null = null
  if (input.targetSheet !== undefined && input.targetSheet !== null) {
    targetSheet = normalizeLaborExcelTargetSheet(input.targetSheet)
    if (targetSheet === null) return { valid: false, reason: 'invalid_target_sheet' }
  }

  return {
    valid: true,
    name,
    columns,
    mapping: mapping as LaborExcelMapping,
    targetSheet,
    identityChecks: input.identityChecks ?? EMPTY_LABOR_EXCEL_IDENTITY_CHECKS,
  }
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
  /**
   * P64 — UYGULANAN kategori dağılımı; projeksiyonun TEK kaynağıdır.
   *
   * `null` provenance'ın olmadığını söyler. Operasyon türlerinden kategori
   * TÜRETİLMEZ: bu iki eksen farklı soruları cevaplar ve birini diğerinden
   * uydurmak, kullanıcının onaylamadığı bir dağılımı Excel'e yazmak olurdu.
   */
  readonly categoryAmounts: readonly LaborCategoryAmount[] | null
}

/** Satırın neden elle girilmesi gerektiği; serbest metin değildir. */
export const LABOR_EXCEL_MANUAL_ENTRY_REASONS = [
  'category_provenance_missing',
  'category_total_mismatch',
  'category_column_unmapped',
] as const
export type LaborExcelManualEntryReason = (typeof LABOR_EXCEL_MANUAL_ENTRY_REASONS)[number]

export interface LaborExcelProjectionLine {
  readonly lineOrdinal: number
  readonly description: string
  readonly status: LaborExcelProjectionLineStatus
  readonly reviewRequired: boolean
  /** Profil sütun anahtarına göre tutar; manuel satırda tüm hücreler 0'dır. */
  readonly cells: Readonly<Record<string, number>>
  /** Eşlenmemiş kategorilere düşen toplam; sütuna yazılamaz, incelemeye düşer. */
  readonly unmappedAmountMinor: number
  readonly totalMinor: number
  /** Manuel giriş gerekiyorsa nedenleri; projekte edilen satırda boştur. */
  readonly manualEntryReasons: readonly LaborExcelManualEntryReason[]
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
    const reasons: LaborExcelManualEntryReason[] = []

    /*
     * P64 — projeksiyonun kaynağı YALNIZ uygulanan kategori provenance'ıdır.
     *
     * Provenance yoksa hiçbir hücre üretilmez. Kullanıcının değiştirdiği satır
     * artık engel DEĞİLDİR: dağılımı söyleyen kullanıcının kendisidir ve
     * onayladığı tutarlar tam olarak Excel'e gitmelidir.
     */
    if (line.categoryAmounts === null) {
      reasons.push('category_provenance_missing')
    } else {
      const categorySum = line.categoryAmounts.reduce((sum, item) => sum + item.amountMinor, 0)
      // Kategori toplamı YALNIZ işçilik tutarını açıklar; parça bedeli girmez.
      if (categorySum !== line.appliedLaborAmountMinor) reasons.push('category_total_mismatch')
    }

    if (reasons.length > 0) {
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
        manualEntryReasons: reasons,
      })
      continue
    }

    const cells = emptyCells()
    let unmappedAmountMinor = 0
    for (const amount of line.categoryAmounts as readonly LaborCategoryAmount[]) {
      const target = profile.mapping[amount.category]
      if (target === null || target === undefined) {
        // Sıfır tutarlı kategorinin eşlenmemiş olması sorun değildir; yazılacak
        // bir şey yoktur. Pozitif tutar ise elle girilmek zorundadır.
        if (amount.amountMinor > 0) {
          unmappedAmountMinor += amount.amountMinor
          reasons.push('category_column_unmapped')
        }
        continue
      }
      // Birden çok kategori aynı sütuna eşlenebilir; toplam deterministiktir
      // çünkü kategori sırası sabittir.
      cells[target] = (cells[target] ?? 0) + amount.amountMinor
    }

    if (reasons.length > 0) {
      manualEntryLineCount += 1
      reviewRequiredLineCount += 1
      unmappedTotalMinor += unmappedAmountMinor
      projectedLines.push({
        lineOrdinal: line.lineOrdinal,
        description: line.description,
        status: 'manual_entry_required',
        reviewRequired: true,
        cells: emptyCells(),
        unmappedAmountMinor,
        totalMinor,
        manualEntryReasons: [...new Set(reasons)],
      })
      continue
    }

    for (const column of profile.columns) {
      columnTotals[column.key] = (columnTotals[column.key] ?? 0) + (cells[column.key] ?? 0)
    }
    const reviewRequired = line.controlRequired
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
      manualEntryReasons: [],
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
