/**
 * Paket 64 — fiziksel vaka klasörü yolu çözümleme (HB-2026-071).
 *
 * Kök yol BU MODÜLE GÖMÜLMEZ; deployment yapılandırmasından gelir ve
 * çözümleyiciye parametre olarak verilir.
 *
 * Sürücüde İKİ düzen bir arada yaşıyor (2026-07-21 doğrulaması):
 *
 *   Yalın:  <kök>\<yıl>\<Ay YYYY>\<PLAKA>
 *   Eski:   <kök>\<yıl>\<Sigorta Klasörü>\<Ay YYYY>\<PLAKA>
 *
 * Sigorta klasörü ZORUNLU DEĞİLDİR. Güncel dosyalar çoğunlukla yalın
 * düzendedir; arşiv yıllarında sigorta seviyesi bulunabilir. Çözümleyici
 * ikisini de arar ve hangi fiziksel yolu seçtiğini açıkça bildirir.
 *
 * Kapanan dosyalar ay klasörünün İÇİNDEKİ `KAPALI <AY> <YIL>` klasöründe
 * durur; bu da her iki düzende geçerlidir.
 *
 * Klasör adları ÜRETİLİP birebir denenmez: mevcut dizinler listelenir ve
 * Türkçe harf duyarsız eşleştirilir. Aynı ay için bir şirkette `TEMMUZ 2026`,
 * diğerinde `Temmuz 2026` görüldüğü için üretim tabanlı eşleştirme yanlış
 * negatif verirdi.
 *
 * Birden fazla fiziksel konum eşleşirse (iki düzende birden, ya da hem aktif
 * hem kapalı) OTOMATİK SEÇİM YAPILMAZ; `case_folder_ambiguous` döner. Yanlış
 * klasöre yazmak, bulamamaktan daha pahalıdır.
 *
 * Bu modül SAF'tır: dosya sistemine kendisi bakmaz, aday adları üretir ve
 * güvenlik kurallarını uygular. Gerçek dizin listeleme File Agent'ta yapılır.
 */

import { TURKISH_MONTH_NAMES } from './case-workspace.js'

export const CASE_FOLDER_PATH_VERSION = 'case-folder-path/2.0.0' as const

export type CaseFolderPathFailure =
  | 'invalid_year'
  | 'invalid_month'
  | 'invalid_plate'
  | 'invalid_insurer_folder'
  | 'insurer_folder_escapes_root'

export interface CaseFolderPathCandidates {
  readonly year: string
  readonly insurerFolderName: string
  /** Ay klasörü için kabul edilebilir adlar; harf duyarsız eşleştirilir. */
  readonly monthFolderNames: readonly string[]
  /** Kapanan dosya alt seviyesi adayları. */
  readonly closedFolderNames: readonly string[]
  readonly plateFolderName: string
}

export type CaseFolderPathResolution =
  | { readonly ok: false; readonly reason: CaseFolderPathFailure }
  | { readonly ok: true; readonly candidates: CaseFolderPathCandidates }

/** Plaka klasörü: boşluksuz, büyük harf, yalnız harf ve rakam. */
export function normalizePlateFolderName(plate: string): string | null {
  const normalized = plate.replace(/\s+/g, '').toLocaleUpperCase('tr')
  if (normalized.length < 4 || normalized.length > 16) return null
  if (!/^[0-9A-ZÇĞİÖŞÜ]+$/.test(normalized)) return null
  return normalized
}

/**
 * Sigorta şirketi klasör adı doğrulaması.
 *
 * Ekrandaki şirket adı ile fiziksel klasör adı AYNI KABUL EDİLMEZ; bu değer
 * ayrı ve doğrulanan bir eşlemeden gelir. Buradaki kontrol, o eşlemenin
 * kökün dışına çıkacak bir değer taşımasını engeller.
 */
export function validateInsurerFolderName(value: string): CaseFolderPathFailure | null {
  const trimmed = value.trim()
  if (trimmed.length < 1 || trimmed.length > 120) return 'invalid_insurer_folder'
  // Yol ayırıcı, sürücü harfi, UNC ön eki ve üst dizin kaçışı yasaktır.
  if (/[\\/]/.test(trimmed)) return 'insurer_folder_escapes_root'
  if (/^[A-Za-z]:/.test(trimmed)) return 'insurer_folder_escapes_root'
  if (trimmed === '.' || trimmed === '..' || trimmed.includes('..')) {
    return 'insurer_folder_escapes_root'
  }
  for (const character of trimmed) {
    const code = character.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return 'invalid_insurer_folder'
  }
  // Windows'ta ada gömülü olamayacak karakterler.
  if (/[<>:"|?*]/.test(trimmed)) return 'invalid_insurer_folder'
  return null
}

/**
 * Vaka klasörü için aday yol parçalarını üretir.
 *
 * Yıl ve ay ÇAĞIRANDAN gelir; bu modül tarih uydurmaz. Çağıran, mevcut iş
 * kuralındaki dosya tarihini (ihbar/açılış) çözmüş olmalıdır.
 */
export function resolveCaseFolderCandidates(input: {
  readonly year: number
  /** 1-12. */
  readonly month: number
  readonly plate: string
  readonly insurerFolderName: string
}): CaseFolderPathResolution {
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100) {
    return { ok: false, reason: 'invalid_year' }
  }
  if (!Number.isInteger(input.month) || input.month < 1 || input.month > 12) {
    return { ok: false, reason: 'invalid_month' }
  }
  const insurerFailure = validateInsurerFolderName(input.insurerFolderName)
  if (insurerFailure !== null) return { ok: false, reason: insurerFailure }

  const plateFolderName = normalizePlateFolderName(input.plate)
  if (plateFolderName === null) return { ok: false, reason: 'invalid_plate' }

  const year = String(input.year)
  // Mevcut ay adı listesi baş harfi büyük tutar; büyük harf yazım ondan
  // TÜRKÇE kurallarıyla türetilir (i → İ).
  const titleMonth = TURKISH_MONTH_NAMES[input.month - 1] as string
  const upperMonth = titleMonth.toLocaleUpperCase('tr')

  return {
    ok: true,
    candidates: {
      year,
      insurerFolderName: input.insurerFolderName.trim(),
      monthFolderNames: [`${upperMonth} ${year}`, `${titleMonth} ${year}`],
      closedFolderNames: [`KAPALI ${upperMonth} ${year}`],
      plateFolderName,
    },
  }
}

/** Harf duyarsız (Türkçe) klasör adı eşleştirme. */
export function matchFolderName(
  candidates: readonly string[],
  existingNames: readonly string[],
): string | null {
  for (const candidate of candidates) {
    const target = candidate.toLocaleLowerCase('tr')
    const found = existingNames.find((name) => name.toLocaleLowerCase('tr') === target)
    if (found !== undefined) return found
  }
  return null
}

/** Klasörün sürücüdeki hangi düzende bulunduğu. */
export type CaseFolderLayout = 'lean' | 'insurer_scoped'

/** Dosyanın aktif ay klasöründe mi kapalı klasörde mi olduğu. */
export type CaseFolderLocation = 'active' | 'closed'

export interface CaseFolderMatch {
  readonly layout: CaseFolderLayout
  readonly location: CaseFolderLocation
  /**
   * Kökten itibaren GERÇEK klasör adları — üretilmiş adlar değil, sürücüde
   * okunan adlar. Rapor ve audit bunu gösterir.
   */
  readonly segments: readonly string[]
  /** Eski düzende bulunduysa sürücüdeki sigorta klasörü adı. */
  readonly insurerFolderName: string | null
}

export type CaseFolderLookupFailure =
  | 'invalid_plate'
  | 'invalid_month'
  | 'case_folder_not_found'
  | 'case_folder_ambiguous'

export type CaseFolderLookup =
  | { readonly ok: false; readonly reason: CaseFolderLookupFailure
      /** Belirsizlikte bulunan TÜM konumlar; kullanıcı hangisini seçeceğini görür. */
      readonly matches: readonly CaseFolderMatch[] }
  | { readonly ok: true; readonly match: CaseFolderMatch }

/**
 * Verilen göreli yolun altındaki klasör adlarını döndürür; yol yoksa `null`.
 *
 * Domain dosya sistemine dokunmaz — listeleme çağıran tarafın (File Agent)
 * işidir ve buraya salt okunur bir görüntü olarak verilir.
 */
export type CaseFolderLister = (segments: readonly string[]) => readonly string[] | null

/** Türkçe harf duyarsız eşleşen TÜM adları döndürür. */
function matchAll(
  candidates: readonly string[],
  existingNames: readonly string[],
): readonly string[] {
  const targets = candidates.map((candidate) => candidate.toLocaleLowerCase('tr'))
  return existingNames.filter((name) => targets.includes(name.toLocaleLowerCase('tr')))
}

/**
 * Vaka klasörünü sürücüde ARAR ve tek bir fiziksel yol seçer.
 *
 * `folderName` verilmezse plakadan türetilir. Aynı plakanın ` - 2`, ` - 3`
 * ekli kardeşleri AYRI vakalardır ve kendi klasör adlarıyla çözümlenir;
 * plakadan tahmin edilmez.
 */
export function lookupCaseFolder(input: {
  readonly year: number
  readonly month: number
  readonly plate: string
  readonly folderName?: string
  readonly listFolders: CaseFolderLister
}): CaseFolderLookup {
  if (!Number.isInteger(input.month) || input.month < 1 || input.month > 12) {
    return { ok: false, reason: 'invalid_month', matches: [] }
  }
  const derived = normalizePlateFolderName(input.plate)
  const target = input.folderName?.trim() ?? derived
  if (target === null || target.length === 0) {
    return { ok: false, reason: 'invalid_plate', matches: [] }
  }

  const year = String(input.year)
  const titleMonth = TURKISH_MONTH_NAMES[input.month - 1] as string
  const upperMonth = titleMonth.toLocaleUpperCase('tr')
  const monthCandidates = [`${upperMonth} ${year}`, `${titleMonth} ${year}`]
  const closedCandidates = [
    `KAPALI ${upperMonth} ${year}`,
    `KAPALI ${titleMonth} ${year}`,
  ]

  const yearChildren = input.listFolders([year])
  if (yearChildren === null) return { ok: false, reason: 'case_folder_not_found', matches: [] }

  const matches: CaseFolderMatch[] = []

  /** Bir ay klasörünün altında aktif ve kapalı konumları tarar. */
  const scanMonth = (
    monthSegments: readonly string[],
    layout: CaseFolderLayout,
    insurerFolderName: string | null,
  ): void => {
    const monthChildren = input.listFolders(monthSegments)
    if (monthChildren === null) return

    for (const found of matchAll([target], monthChildren)) {
      matches.push({ layout, location: 'active', segments: [...monthSegments, found], insurerFolderName })
    }
    // Kapalı klasör ay klasörünün İÇİNDEDİR.
    for (const closedFolder of matchAll(closedCandidates, monthChildren)) {
      const closedSegments = [...monthSegments, closedFolder]
      const closedChildren = input.listFolders(closedSegments)
      if (closedChildren === null) continue
      for (const found of matchAll([target], closedChildren)) {
        matches.push({
          layout, location: 'closed', segments: [...closedSegments, found], insurerFolderName,
        })
      }
    }
  }

  // Yalın düzen: ay klasörü doğrudan yılın altındadır.
  for (const monthFolder of matchAll(monthCandidates, yearChildren)) {
    scanMonth([year, monthFolder], 'lean', null)
  }

  /*
   * Eski düzen: yılın altındaki AY OLMAYAN her klasör bir sigorta klasörü
   * adayıdır. Şirket adları listesi burada aranmaz — ekrandaki sigorta adı
   * ile fiziksel klasör adının aynı olduğu varsayılamaz.
   */
  const monthFolderKeys = new Set(
    matchAll(monthCandidates, yearChildren).map((name) => name.toLocaleLowerCase('tr')),
  )
  for (const child of yearChildren) {
    if (monthFolderKeys.has(child.toLocaleLowerCase('tr'))) continue
    if (validateInsurerFolderName(child) !== null) continue
    const insurerChildren = input.listFolders([year, child])
    if (insurerChildren === null) continue
    for (const monthFolder of matchAll(monthCandidates, insurerChildren)) {
      scanMonth([year, child, monthFolder], 'insurer_scoped', child)
    }
  }

  if (matches.length === 0) return { ok: false, reason: 'case_folder_not_found', matches: [] }
  // Tek eşleşme kullanılır; birden fazlası İNSANA taşınır ve tahmin edilmez.
  if (matches.length > 1) return { ok: false, reason: 'case_folder_ambiguous', matches }
  return { ok: true, match: matches[0] as CaseFolderMatch }
}
