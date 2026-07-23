/**
 * Paket 65A — OOXML preflight ve immutable yazım planı (saf çekirdek).
 *
 * Bu modül HİÇBİR dosyaya dokunmaz. Yalnız:
 *  - ZIP/OOXML güvenlik kurallarını saf fonksiyon olarak uygular,
 *  - minor-unit tutarı deterministik Excel ondalık dizesine çevirir,
 *  - uygulanan kategori provenance'ından immutable yazım planı FINGERPRINT'i
 *    üretir ve bayatlığı ölçer.
 *
 * Gerçek unzip/parse File Agent'ta fflate ile yapılır; burada yalnız o katmanın
 * ürettiği metadata (giriş adları, boyutlar, content-type) üzerinde karar verilir.
 *
 * DÜRÜSTLÜK: kategori tutarları YALNIZ uygulanan provenance'tan gelir; operasyon
 * türünden TÜRETİLMEZ. Bu modülde operasyon türü hiç parametre değildir — türetme
 * yapısal olarak imkânsızdır.
 */
import { sha256Text } from './pdf-text-extraction.js'
import { LABOR_ALLOCATION_CATEGORIES, type LaborCategoryAmount } from './labor-allocation-categories.js'
import { LABOR_EXCEL_PROFILE_SCHEMA_VERSION } from './labor-excel-profile.js'

export const LABOR_WORKBOOK_PREFLIGHT_VERSION = 'labor-workbook-preflight/1.0.0' as const
export const LABOR_WORKBOOK_PLAN_SCHEMA_VERSION = 'labor-workbook-write-plan/1.0.0' as const

/**
 * Merkezi, test edilebilir limitler. Dağınık sihirli sayı yok; her eşik burada.
 */
export const LABOR_WORKBOOK_LIMITS = {
  /** Bir `.xlsx` için makul üst sınır; normal föy workbook'u çok altındadır. */
  maxZipEntries: 512,
  /** Açılmış toplam boyut tavanı (zip-bomb koruması). */
  maxUncompressedBytes: 64 * 1024 * 1024,
  /** Ham arşiv boyutu tavanı. */
  maxCompressedBytes: 32 * 1024 * 1024,
  /** Giriş başına açılma oranı tavanı (uncompressed / compressed). */
  maxCompressionRatio: 200,
  /** Giriş adı uzunluk tavanı. */
  maxEntryNameLength: 240,
} as const

/** Preflight'ın üretebileceği kapalı küme engel/manuel kodları. */
export const LABOR_WORKBOOK_PREFLIGHT_CODES = [
  'WORKBOOK_ZIP_SLIP',
  'WORKBOOK_ABSOLUTE_ENTRY',
  'WORKBOOK_PARENT_TRAVERSAL',
  'WORKBOOK_ENTRY_NAME_INVALID',
  'WORKBOOK_ZIP_METADATA_INVALID',
  'WORKBOOK_DUPLICATE_ENTRY',
  'WORKBOOK_TOO_MANY_ENTRIES',
  'WORKBOOK_UNCOMPRESSED_TOO_LARGE',
  'WORKBOOK_COMPRESSED_TOO_LARGE',
  'WORKBOOK_COMPRESSION_RATIO',
  'WORKBOOK_ENCRYPTED',
  'WORKBOOK_MACRO_CONTENT',
  'WORKBOOK_VBA_PROJECT',
  'WORKBOOK_DIGITAL_SIGNATURE',
  'WORKBOOK_EXTERNAL_LINK',
  'WORKBOOK_UNSUPPORTED_OBJECT',
] as const
export type LaborWorkbookPreflightCode = (typeof LABOR_WORKBOOK_PREFLIGHT_CODES)[number]

/** File Agent'ın verdiği tek ZIP girişinin salt okunur metadata'sı. */
export interface ZipEntryMeta {
  readonly name: string
  readonly compressedSize: number
  readonly uncompressedSize: number
  /** OOXML paket şifreliyse (ör. CDFV2/encrypted) true. */
  readonly encrypted?: boolean
}

/**
 * ZIP girişi adının kökten çıkıp çıkmadığını (zip-slip) belirler.
 *
 * Adı ÜRETİP tahmin etmeyiz; File Agent'ın okuduğu adı normalize edip kontrol
 * ederiz. Ters/düz eğik çizgi, sürücü harfi, UNC ve `..` segmenti reddedilir.
 */
export function detectZipEntryHazard(name: string): LaborWorkbookPreflightCode | null {
  if (name.length === 0 || name.length > LABOR_WORKBOOK_LIMITS.maxEntryNameLength) {
    return 'WORKBOOK_ENTRY_NAME_INVALID'
  }
  // Kontrol karakteri veya NUL taşıyan ad geçersizdir.
  for (const ch of name) {
    const code = ch.codePointAt(0) as number
    if (code < 0x20 || code === 0x7f) return 'WORKBOOK_ENTRY_NAME_INVALID'
  }
  const unified = name.replaceAll('\\', '/')
  // UNC (`//server`) veya kök (`/xl/...`) mutlak yoldur.
  if (unified.startsWith('/')) return 'WORKBOOK_ABSOLUTE_ENTRY'
  // Sürücü harfi öneki (`C:/...`).
  if (/^[A-Za-z]:/.test(unified)) return 'WORKBOOK_ABSOLUTE_ENTRY'
  // `..` segmenti üst dizine çıkarır.
  if (unified.split('/').some((segment) => segment === '..')) return 'WORKBOOK_PARENT_TRAVERSAL'
  return null
}

/** ZIP girişi adını dupe tespiti için normalize eder (Windows davranışı: harf-duyarsız). */
export function normalizeZipEntryName(name: string): string {
  return name.replaceAll('\\', '/').normalize('NFC').toLocaleLowerCase('tr')
}

export interface ZipStructureResult {
  readonly ok: boolean
  readonly codes: readonly LaborWorkbookPreflightCode[]
}

/**
 * ZIP giriş listesini güvenlik/zip-bomb açısından doğrular.
 *
 * Tüm ihlalleri toplar (ilkinde durmaz) ki preflight raporu eksiksiz olsun.
 */
export function validateZipStructure(entries: readonly ZipEntryMeta[]): ZipStructureResult {
  const codes = new Set<LaborWorkbookPreflightCode>()

  if (entries.length > LABOR_WORKBOOK_LIMITS.maxZipEntries) codes.add('WORKBOOK_TOO_MANY_ENTRIES')

  let totalUncompressed = 0
  let totalCompressed = 0
  const seen = new Set<string>()

  for (const entry of entries) {
    const hazard = detectZipEntryHazard(entry.name)
    if (hazard !== null) codes.add(hazard)

    if (entry.encrypted === true) codes.add('WORKBOOK_ENCRYPTED')

    const normalized = normalizeZipEntryName(entry.name)
    if (seen.has(normalized)) codes.add('WORKBOOK_DUPLICATE_ENTRY')
    seen.add(normalized)

    if (!Number.isSafeInteger(entry.compressedSize)
      || !Number.isSafeInteger(entry.uncompressedSize)
      || entry.compressedSize < 0
      || entry.uncompressedSize < 0
      || (entry.compressedSize === 0 && entry.uncompressedSize > 0)) {
      codes.add('WORKBOOK_ZIP_METADATA_INVALID')
      continue
    }

    totalUncompressed += entry.uncompressedSize
    totalCompressed += entry.compressedSize

    // Giriş başına açılma oranı: dizin veya boş girişte oran hesaplanmaz.
    if (entry.compressedSize > 0 && entry.uncompressedSize > 0) {
      const ratio = entry.uncompressedSize / entry.compressedSize
      if (ratio > LABOR_WORKBOOK_LIMITS.maxCompressionRatio) codes.add('WORKBOOK_COMPRESSION_RATIO')
    }
  }

  if (totalUncompressed > LABOR_WORKBOOK_LIMITS.maxUncompressedBytes) {
    codes.add('WORKBOOK_UNCOMPRESSED_TOO_LARGE')
  }
  if (totalCompressed > LABOR_WORKBOOK_LIMITS.maxCompressedBytes) {
    codes.add('WORKBOOK_COMPRESSED_TOO_LARGE')
  }

  return { ok: codes.size === 0, codes: [...codes] }
}

/**
 * Yasaklı OOXML parçalarını tespit eder: makro, VBA, dijital imza, harici
 * bağlantı ve gömülü nesne. Giriş adları ve `[Content_Types].xml` birlikte
 * incelenir; ada göre TAHMİN etmek yerine ilişki de kontrol edilir.
 */
export function detectForbiddenOoxmlParts(input: {
  readonly entryNames: readonly string[]
  readonly contentTypesXml: string
  readonly relationshipXmls?: readonly string[]
}): readonly LaborWorkbookPreflightCode[] {
  const codes = new Set<LaborWorkbookPreflightCode>()
  const paths = input.entryNames.map((name) => normalizeZipEntryName(name))
  const types = input.contentTypesXml.toLowerCase()
  const relationships = (input.relationshipXmls ?? []).join('\n')

  if (paths.some((p) => p === 'xl/vbaproject.bin')) codes.add('WORKBOOK_VBA_PROJECT')
  if (types.includes('ms-office.vbaproject') || types.includes('macroenabled')) {
    codes.add('WORKBOOK_MACRO_CONTENT')
  }
  if (paths.some((p) => p.startsWith('_xmlsignatures/') || p.includes('/_xmlsignatures/'))) {
    codes.add('WORKBOOK_DIGITAL_SIGNATURE')
  }
  if (paths.some((p) => p.startsWith('xl/externallinks/'))) codes.add('WORKBOOK_EXTERNAL_LINK')
  if (/\bTargetMode\s*=\s*["']External["']/i.test(relationships)
    || /\bType\s*=\s*["'][^"']*\/externalLink["']/i.test(relationships)) {
    codes.add('WORKBOOK_EXTERNAL_LINK')
  }
  if (paths.some((p) => p.startsWith('xl/embeddings/') || p.includes('oleobject'))) {
    codes.add('WORKBOOK_UNSUPPORTED_OBJECT')
  }
  return [...codes]
}

/**
 * Minor-unit (kuruş) tutarını deterministik Excel ondalık dizesine çevirir.
 *
 * FLOAT KULLANILMAZ: string aritmetiği ile son iki hane ayrılır. Locale ayıracı
 * yoktur; OOXML sayısal değeri nokta kullanır. Negatif değer plan üretmez.
 *
 *   0      -> "0.00"
 *   5      -> "0.05"
 *   50     -> "0.50"
 *   123456 -> "1234.56"
 */
export function minorToExcelNumericString(minor: number): string | null {
  if (!Number.isSafeInteger(minor) || minor < 0) return null
  const digits = String(minor)
  if (digits.length <= 2) return `0.${digits.padStart(2, '0')}`
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`
}

/**
 * Uygulanan kategori dağılımını profil eşlemesiyle sütun başına toplar.
 *
 * Aynı sütuna birden çok kategori düşerse KANONİK SIRA (LABOR_ALLOCATION_
 * CATEGORIES) ile deterministik toplanır. Pozitif tutar eşlenmemiş sütuna
 * düşerse veya toplam işçilik tutarını tutmuyorsa `null` döner: plan üretilmez.
 */
export function aggregateAppliedCategoriesToColumns(input: {
  readonly appliedAmounts: readonly LaborCategoryAmount[]
  readonly mapping: Readonly<Record<string, string | null>>
  readonly laborAmountMinor: number
}): { readonly columnKey: string; readonly amountMinor: number }[] | null {
  const byCategory = new Map(input.appliedAmounts.map((item) => [item.category, item.amountMinor]))
  const total = input.appliedAmounts.reduce((sum, item) => sum + item.amountMinor, 0)
  if (total !== input.laborAmountMinor) return null

  const columnTotals = new Map<string, number>()
  // Kanonik sırada gez: aynı sütuna eşlenen kategorilerin toplamı deterministik.
  for (const category of LABOR_ALLOCATION_CATEGORIES) {
    const amount = byCategory.get(category) ?? 0
    const target = input.mapping[category] ?? null
    if (target === null) {
      // Pozitif tutar eşlenmemiş sütuna düşerse plan üretilemez.
      if (amount > 0) return null
      continue
    }
    columnTotals.set(target, (columnTotals.get(target) ?? 0) + amount)
  }
  return [...columnTotals.entries()].map(([columnKey, amountMinor]) => ({ columnKey, amountMinor }))
}

/**
 * Immutable yazım planının bayatlık FINGERPRINT'i.
 *
 * Bu alanların HERHANGİ biri değişirse plan bayatlar. Ham fiziksel kök yol ve
 * PII taşınmaz; yalnız kimlikler, sürümler, hash ve göreli yol.
 */
export interface LaborWorkbookPlanFingerprint {
  readonly organizationId: string
  readonly caseId: string
  readonly insurerId: string | null
  readonly applicationId: string
  readonly applicationTargetSheetVersion: number
  readonly sheetId: string
  readonly sheetVersion: number
  readonly profileId: string
  readonly profileSchemaVersion: string
  readonly profileVersion: number
  /** Çözülen klasör modeli: lean | insurer_scoped, active | closed. */
  readonly folderModel: string
  /** Köke göreli workbook yolu (mutlak `P:\...` DEĞİL). */
  readonly relativeWorkbookPath: string
  readonly workbookSha256: string
  readonly workbookSize: number
  readonly workbookModifiedIso: string
  readonly targetWorksheetPart: string
  /** Uygulanan kategori provenance'ının hash'i. */
  readonly appliedProvenanceHash: string
}

/** Fingerprint'i kanonik olarak diziler ve tek yönlü hash'ler. */
export function buildLaborWorkbookPlanHash(fingerprint: LaborWorkbookPlanFingerprint): string {
  // Anahtar sırası SABİT: alanlar alfabetik yazılır ki aynı girdi aynı hash'i versin.
  const canonical = JSON.stringify(fingerprint, Object.keys(fingerprint).sort())
  return sha256Text(`${LABOR_WORKBOOK_PLAN_SCHEMA_VERSION}\n${canonical}`)
}

/**
 * Plan, mevcut gerçek duruma göre bayat mı?
 *
 * Workbook (hash/boyut/zaman), application, sheet veya profil sürümü değişmişse
 * plan artık geçerli değildir ve fiziksel yazıma uygun sayılmaz.
 */
export function laborWorkbookPlanStale(
  planned: LaborWorkbookPlanFingerprint,
  current: Pick<LaborWorkbookPlanFingerprint,
    'workbookSha256' | 'workbookSize' | 'workbookModifiedIso'
    | 'applicationTargetSheetVersion' | 'sheetVersion' | 'profileVersion'>,
): boolean {
  return planned.workbookSha256 !== current.workbookSha256
    || planned.workbookSize !== current.workbookSize
    || planned.workbookModifiedIso !== current.workbookModifiedIso
    || planned.applicationTargetSheetVersion !== current.applicationTargetSheetVersion
    || planned.sheetVersion !== current.sheetVersion
    || planned.profileVersion !== current.profileVersion
}

/** Plan üretiminin reddedilme nedenleri (kapalı küme). */
export const LABOR_WORKBOOK_PLAN_REJECTIONS = [
  'PLAN_APPLICATION_NOT_COMPLETED',
  'PLAN_PROVENANCE_MISSING',
  'PLAN_PROFILE_NOT_WRITABLE',
  'PLAN_STALE',
  'PLAN_CATEGORY_TOTAL_MISMATCH',
  'PLAN_CATEGORY_COLUMN_UNMAPPED',
] as const
export type LaborWorkbookPlanRejection = (typeof LABOR_WORKBOOK_PLAN_REJECTIONS)[number]

export type LaborWorkbookPlanEligibility =
  | { readonly ok: false; readonly reason: LaborWorkbookPlanRejection }
  | {
    readonly ok: true
    readonly columns: readonly { readonly columnKey: string; readonly amountMinor: number }[]
  }

/**
 * Plan KAYNAĞININ uygunluğunu belirler.
 *
 * Girdi olarak operasyon türü ALINMAZ: kategori yalnız uygulanan provenance'tan
 * gelir ve buradan türetme yapısal olarak imkânsızdır. Reddedilen her yol
 * kapalı küme bir kod döndürür; sessiz geçiş yoktur.
 */
export function assertLaborWorkbookPlanSource(input: {
  readonly applicationCompleted: boolean
  readonly appliedAmounts: readonly LaborCategoryAmount[] | null
  readonly profileSchemaVersion: string
  readonly profileWritable: boolean
  readonly stale: boolean
  readonly mapping: Readonly<Record<string, string | null>>
  readonly laborAmountMinor: number
}): LaborWorkbookPlanEligibility {
  if (!input.applicationCompleted) return { ok: false, reason: 'PLAN_APPLICATION_NOT_COMPLETED' }
  // Provenance yoksa plan üretilmez; operasyon türünden türetme YOK.
  if (input.appliedAmounts === null) return { ok: false, reason: 'PLAN_PROVENANCE_MISSING' }
  if (input.profileSchemaVersion !== LABOR_EXCEL_PROFILE_SCHEMA_VERSION || !input.profileWritable) {
    return { ok: false, reason: 'PLAN_PROFILE_NOT_WRITABLE' }
  }
  if (input.stale) return { ok: false, reason: 'PLAN_STALE' }

  const total = input.appliedAmounts.reduce((sum, item) => sum + item.amountMinor, 0)
  if (total !== input.laborAmountMinor) return { ok: false, reason: 'PLAN_CATEGORY_TOTAL_MISMATCH' }

  const columns = aggregateAppliedCategoriesToColumns({
    appliedAmounts: input.appliedAmounts,
    mapping: input.mapping,
    laborAmountMinor: input.laborAmountMinor,
  })
  if (columns === null) return { ok: false, reason: 'PLAN_CATEGORY_COLUMN_UNMAPPED' }
  return { ok: true, columns }
}
