/**
 * Dosya Envanteri ve Excel dışa aktarma — saf domain çekirdeği.
 *
 * Bu modül veritabanına, dosya sistemine veya Excel kütüphanesine dokunmaz.
 * Yalnız envanter satırının BİÇİMİNİ, güvenli hücre değerini ve dosya adını
 * belirler. Gerçek sorgu API'de, gerçek `.xlsx` yazımı export job'ındadır.
 *
 * DÜRÜSTLÜK: eksik bilgi tahmin edilmez. Telefon numeric DEĞİL, baştaki sıfırı
 * koruyan string olarak taşınır. Kullanıcı verisi formül olarak çalıştırılamaz.
 */
export const CASE_INVENTORY_VERSION = 'case-inventory/1.0.0' as const

/** Export hücre tipi. Telefon/plaka/dosya no DAİMA text'tir; sayı değil. */
export type InventoryCellType = 'text' | 'date'

export interface InventoryColumn {
  readonly key: string
  /** Türkçe başlık; Excel ilk satırında görünür. */
  readonly header: string
  readonly cellType: InventoryCellType
  /** Kişisel veri sütunu mu? Telefon ve araç sahibi PII kabul edilir. */
  readonly pii: boolean
}

/**
 * Zorunlu 16 sütun. Sıra Excel çıktısındaki sıradır. Telefonlar ve dosya no /
 * plaka `text` tipindedir ki baştaki sıfır ve biçim korunsun.
 */
export const CASE_INVENTORY_COLUMNS: readonly InventoryColumn[] = [
  { key: 'officeNumber', header: 'Dosya No', cellType: 'text', pii: false },
  { key: 'plate', header: 'Plaka', cellType: 'text', pii: false },
  { key: 'insurerName', header: 'Sigorta Şirketi', cellType: 'text', pii: false },
  { key: 'responsibleName', header: 'Dosya Sorumlusu', cellType: 'text', pii: false },
  { key: 'caseType', header: 'Dosya Türü', cellType: 'text', pii: false },
  { key: 'caseStatus', header: 'Dosya Durumu', cellType: 'text', pii: false },
  { key: 'accidentDate', header: 'Kaza Tarihi', cellType: 'date', pii: false },
  { key: 'notificationDate', header: 'İhbar Tarihi', cellType: 'date', pii: false },
  { key: 'expertReportStatus', header: 'Eksper Raporu Durumu', cellType: 'text', pii: false },
  { key: 'expertReportDate', header: 'Eksper Raporu Tarihi', cellType: 'date', pii: false },
  { key: 'expertReportNumber', header: 'Eksper Rapor No', cellType: 'text', pii: false },
  { key: 'serviceName', header: 'Servis Adı', cellType: 'text', pii: false },
  { key: 'serviceCity', header: 'Servis İli', cellType: 'text', pii: false },
  { key: 'servicePhone', header: 'Servis Telefonu', cellType: 'text', pii: true },
  { key: 'ownerNames', header: 'Araç Sahibi veya Sahipleri', cellType: 'text', pii: true },
  { key: 'ownerPhones', header: 'Araç Sahibi Telefonu veya Telefonları', cellType: 'text', pii: true },
] as const

/** Eksik değer işareti; UI ve export tutarlı kullanır. */
export const CASE_INVENTORY_MISSING_MARKER = 'Eksik' as const

/** Birden çok araç sahibi/telefon tek satırda bu ayıraçla birleştirilir. */
export const CASE_INVENTORY_MULTI_VALUE_SEPARATOR = '; ' as const

/**
 * Excel formül enjeksiyonuna karşı hücre değerini güvenli kılar.
 *
 * Excel/OOXML'de `=`, `+`, `-`, `@` ve sekme/CR/LF ile BAŞLAYAN bir metin,
 * bazı istemcilerde formül/DDE olarak yorumlanabilir. Bu karakterlerle
 * başlayan kullanıcı verisi tek tırnakla öne alınır ki metin olarak kalsın.
 * Değer sessizce SİLİNMEZ; yalnız nötrlenir.
 */
export function escapeExcelCellValue(value: string): string {
  if (value.length === 0) return value
  const first = value[0] as string
  if (first === '=' || first === '+' || first === '-' || first === '@'
    || first === '\t' || first === '\r' || first === '\n') {
    return `'${value}`
  }
  return value
}

/**
 * Telefonu export için NUMERIC DEĞİL string olarak normalize eder.
 *
 * Baştaki sıfır korunur (`05321234567` → `05321234567`). Boş/eksik değer
 * `null` döner. Sayıya çevirme YAPILMAZ; bu, `0`'ı düşürür ve biçimi bozardı.
 */
export function normalizePhoneForExport(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

/**
 * Birden çok araç sahibini ve telefonunu tek satırda birleştirir.
 *
 * İsim ve telefon sıraları BİRBİRİYLE EŞLEŞİR: i. isim i. telefona karşılık
 * gelir. Telefonu olmayan sahip için hücrede yeri boş kalır ki hizalama
 * bozulmasın. Sıra, çağıranın verdiği (ordinal'e göre sıralı) sıradır.
 */
export function joinOwners(
  owners: readonly { readonly name: string; readonly phone: string | null }[],
): { readonly names: string; readonly phones: string } {
  const names = owners.map((owner) => owner.name.trim())
  const phones = owners.map((owner) => normalizePhoneForExport(owner.phone) ?? '')
  return {
    names: names.join(CASE_INVENTORY_MULTI_VALUE_SEPARATOR),
    phones: phones.join(CASE_INVENTORY_MULTI_VALUE_SEPARATOR),
  }
}

/** ISO tarihi (veya `YYYY-MM-DD`) Excel için `dd.mm.yyyy` biçimine çevirir. */
export function formatInventoryDate(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim())
  if (match === null) return null
  const [, year, month, day] = match
  return `${day}.${month}.${year}`
}

/** Windows'ta dosya adında yasak karakterler. Kontrol karakterleri ayrı ele alınır. */
const WINDOWS_INVALID_FILENAME = /[<>:"/\\|?*]/g
/** Unicode kontrol karakterleri (Cc kategorisi); regex'e ham kontrol baytı gömülmez. */
const CONTROL_CHARACTERS = /\p{Cc}/gu

/**
 * Export dosya adını üretir: `Dosya_Envanteri_<tarih>_<kullanici>.xlsx`.
 *
 * Kullanıcı adı ve tarih güvenli karakterlere indirgenir; Windows'ta geçersiz
 * karakter, boşluk ve kişisel veri (ham e-posta gibi) dosya adına GİRMEZ.
 * Kullanıcı etiketi zaten güvenli bir görünen ad/slug olmalıdır; yine de
 * temizlenir.
 */
export function buildInventoryExportFilename(input: {
  readonly dateIso: string
  readonly userLabel: string
}): string {
  const datePart = (/^\d{4}-\d{2}-\d{2}/.exec(input.dateIso)?.[0] ?? '')
    .replaceAll('-', '')
  const safeUser = input.userLabel
    .normalize('NFC')
    .replace(CONTROL_CHARACTERS, '')
    .replace(WINDOWS_INVALID_FILENAME, '')
    .replaceAll(/\s+/g, '_')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 40)
  const user = safeUser.length === 0 ? 'kullanici' : safeUser
  const date = datePart.length === 8 ? datePart : 'tarih'
  return `Dosya_Envanteri_${date}_${user}.xlsx`
}

/**
 * Araç sahibi mini-yakalama çekirdeği.
 *
 * Ad/telefon hiçbir tabloda yoktu; envanter export'unun `ownerNames`/
 * `ownerPhones` sütunları başka türlü hep "Eksik" kalırdı. Liste TEK SEFERDE
 * değiştirilir (efekt/geçmiş sürüm zinciri yok); en küçük güvenli tasarım.
 */
export const MAX_CASE_VEHICLE_OWNERS = 6 as const
export const MAX_OWNER_NAME_LENGTH = 200 as const
export const MAX_OWNER_PHONE_LENGTH = 32 as const

export interface CaseVehicleOwnerInput {
  readonly name: string
  readonly phone: string | null
}

export type CaseVehicleOwnersInvalidReason =
  | 'OWNERS_TOO_MANY'
  | 'OWNER_NAME_INVALID'
  | 'OWNER_PHONE_INVALID'

export type CaseVehicleOwnersValidation =
  | { readonly valid: true; readonly owners: readonly CaseVehicleOwnerInput[] }
  | { readonly valid: false; readonly reasonCode: CaseVehicleOwnersInvalidReason }

const CONTROL_CHARACTER = /\p{Cc}/u
/** Yalnız rakam, boşluk ve yaygın ayraçlar (+, (), ., -). Harf/özel karakter YOK. */
const OWNER_PHONE_PATTERN = /^[0-9()+. -]+$/

function normalizeOwnerName(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_OWNER_NAME_LENGTH) return null
  if (CONTROL_CHARACTER.test(trimmed)) return null
  return trimmed
}

/** `null` = telefon yok (geçerli). `undefined` = geçersiz girdi. */
function normalizeOwnerPhone(value: string | null): string | null | undefined {
  if (value === null) return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  if (trimmed.length < 3 || trimmed.length > MAX_OWNER_PHONE_LENGTH) return undefined
  if (!OWNER_PHONE_PATTERN.test(trimmed) || CONTROL_CHARACTER.test(trimmed)) return undefined
  return trimmed
}

/**
 * Sahip listesini doğrular. Boş liste GEÇERLİDİR (kullanıcı "sahip bilinmiyor"
 * durumuna dönebilir); yalnız üst sınır ve satır biçimi zorlanır.
 */
export function validateCaseVehicleOwners(
  owners: readonly CaseVehicleOwnerInput[],
): CaseVehicleOwnersValidation {
  if (owners.length > MAX_CASE_VEHICLE_OWNERS) return { valid: false, reasonCode: 'OWNERS_TOO_MANY' }
  const normalized: CaseVehicleOwnerInput[] = []
  for (const owner of owners) {
    const name = normalizeOwnerName(owner.name)
    if (name === null) return { valid: false, reasonCode: 'OWNER_NAME_INVALID' }
    const phone = normalizeOwnerPhone(owner.phone)
    if (phone === undefined) return { valid: false, reasonCode: 'OWNER_PHONE_INVALID' }
    normalized.push({ name, phone })
  }
  return { valid: true, owners: normalized }
}

/** Bir envanter satırının ham (henüz Excel'e çevrilmemiş) alanları. */
export interface CaseInventoryRow {
  readonly caseId: string
  readonly officeNumber: string
  readonly plate: string
  readonly insurerName: string | null
  readonly responsibleName: string | null
  readonly caseType: 'traffic' | 'casco'
  readonly caseStatus: string
  readonly accidentDate: string | null
  readonly notificationDate: string | null
  readonly expertReportStatus: string | null
  readonly expertReportDate: string | null
  readonly expertReportNumber: string | null
  readonly serviceName: string | null
  readonly serviceCity: string | null
  readonly servicePhone: string | null
  readonly owners: readonly { readonly name: string; readonly phone: string | null }[]
}

/** Dosya türü kodunu Türkçe etikete çevirir. */
export function caseTypeLabel(caseType: 'traffic' | 'casco'): string {
  return caseType === 'traffic' ? 'Trafik' : 'Kasko'
}

/**
 * Bir envanter satırını export hücre değerlerine çevirir.
 *
 * `includePhones=false` ise (yetkisiz kullanıcı) telefon sütunları hiç
 * doldurulmaz — UI'da gizlemek yetmez, veri de üretilmez. Eksik değer
 * `missingAsMarker` politikasına göre `Eksik` ya da boş olur; davranış TÜM
 * sütunlarda tutarlıdır.
 */
export function buildInventoryCells(
  row: CaseInventoryRow,
  options: { readonly includePhones: boolean; readonly missingAsMarker: boolean },
): Readonly<Record<string, { readonly value: string; readonly cellType: InventoryCellType }>> {
  const owners = joinOwners(row.owners)
  const missing = options.missingAsMarker ? CASE_INVENTORY_MISSING_MARKER : ''

  const raw: Record<string, { text: string | null; cellType: InventoryCellType }> = {
    officeNumber: { text: row.officeNumber, cellType: 'text' },
    plate: { text: row.plate, cellType: 'text' },
    insurerName: { text: row.insurerName, cellType: 'text' },
    responsibleName: { text: row.responsibleName, cellType: 'text' },
    caseType: { text: caseTypeLabel(row.caseType), cellType: 'text' },
    caseStatus: { text: row.caseStatus, cellType: 'text' },
    accidentDate: { text: formatInventoryDate(row.accidentDate), cellType: 'date' },
    notificationDate: { text: formatInventoryDate(row.notificationDate), cellType: 'date' },
    expertReportStatus: { text: row.expertReportStatus, cellType: 'text' },
    expertReportDate: { text: formatInventoryDate(row.expertReportDate), cellType: 'date' },
    expertReportNumber: { text: row.expertReportNumber, cellType: 'text' },
    serviceName: { text: row.serviceName, cellType: 'text' },
    serviceCity: { text: row.serviceCity, cellType: 'text' },
    // Telefon: yetkisizde HİÇ üretilmez; her zaman text.
    servicePhone: {
      text: options.includePhones ? normalizePhoneForExport(row.servicePhone) : null,
      cellType: 'text',
    },
    ownerNames: { text: owners.names.length === 0 ? null : owners.names, cellType: 'text' },
    ownerPhones: {
      text: options.includePhones && owners.phones.length > 0 ? owners.phones : null,
      cellType: 'text',
    },
  }

  const cells: Record<string, { value: string; cellType: InventoryCellType }> = {}
  for (const column of CASE_INVENTORY_COLUMNS) {
    const entry = raw[column.key] as { text: string | null; cellType: InventoryCellType }
    const value = entry.text === null || entry.text.length === 0 ? missing : entry.text
    // Her metin hücresi formül enjeksiyonuna karşı nötrlenir.
    cells[column.key] = { value: escapeExcelCellValue(value), cellType: entry.cellType }
  }
  return cells
}
