import { parseLocalDate } from './temporal.js'
import { parsePlateNumber } from './plate-number.js'
import { parseRelativePath, type RelativePath } from './storage-path.js'

/** Paket 19 vaka çalışma klasörünün değişmez alt klasörleri. */
export const CASE_WORKSPACE_SUBDIRECTORIES = [
  'EVRAK',
  'HASAR',
  'OLAY YERİ',
  'ONARIM',
  'DEĞER KAYBI',
] as const

export type CaseWorkspaceSubdirectory = (typeof CASE_WORKSPACE_SUBDIRECTORIES)[number]

export const TURKISH_MONTH_NAMES = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
] as const

export type CaseWorkspacePathError = 'invalid_notification_date' | 'invalid_plate' | 'path_limit_exhausted'

export type CaseWorkspacePathResult =
  | { readonly ok: true; readonly relativePath: RelativePath }
  | { readonly ok: false; readonly error: CaseWorkspacePathError }

/**
 * notificationDate + kanonik plakadan `YYYY OFİS/_EKSİK DOSYALAR/PLAKA` tabanını üretir.
 * Ofis envanteri yalnız YYYY OFİS altını izlediği için yıl klasörü aynı kapsamı kullanır.
 * Saat, timezone, DB veya dosya sistemi kullanmaz; aynı girdi aynı sonucu verir.
 */
export function buildCaseWorkspaceBasePath(notificationDate: string, plate: string): CaseWorkspacePathResult {
  const date = parseLocalDate(notificationDate)
  if (!date.ok) return { ok: false, error: 'invalid_notification_date' }
  const parsedPlate = parsePlateNumber(plate)
  if (!parsedPlate.ok) return { ok: false, error: 'invalid_plate' }

  const year = Number(notificationDate.slice(0, 4))
  const compactPlate = String(parsedPlate.value).replaceAll(' ', '')
  const parsedPath = parseRelativePath(`${year} OFİS/_EKSİK DOSYALAR/${compactPlate}`)
  return parsedPath.ok
    ? { ok: true, relativePath: parsedPath.value }
    : { ok: false, error: 'invalid_plate' }
}

/** Tamamlanan ihbarı kendi ihbar ayına taşır; aynı plakalı dosyanın soneki korunur. */
export function buildCompletedCaseWorkspacePath(notificationDate: string | null, pendingPath: string): CaseWorkspacePathResult {
  if (notificationDate === null || !parseLocalDate(notificationDate).ok) return { ok: false, error: 'invalid_notification_date' }
  const [yearFolder, pendingFolder, name, ...rest] = pendingPath.split('/')
  const year = notificationDate.slice(0, 4)
  if (!parseRelativePath(pendingPath).ok || yearFolder !== `${year} OFİS` || pendingFolder !== '_EKSİK DOSYALAR'
    || !name || rest.length || !parsePlateNumber(name.replace(/ - (?:[2-9]|[1-9]\d+)$/, '')).ok) return { ok: false, error: 'invalid_plate' }
  const month = TURKISH_MONTH_NAMES[Number(notificationDate.slice(5, 7)) - 1]!
  const path = parseRelativePath(`${yearFolder}/${month} ${year}/${name}`)
  return path.ok ? { ok: true, relativePath: path.value } : { ok: false, error: 'invalid_plate' }
}

/**
 * Rezerve edilmiş yollar arasından ilk güvenli adı seçer: PLAKA, PLAKA - 2, ...
 * Karşılaştırma Windows dosya sistemi davranışına uygun olarak harf-duyarsızdır.
 */
export function selectAvailableCaseWorkspacePath(
  basePath: string,
  occupiedPaths: readonly string[],
  maxSuffix = 10_000,
): CaseWorkspacePathResult {
  const occupied = new Set(occupiedPaths.map((path) => path.normalize('NFC').toUpperCase().normalize('NFC')))
  for (let suffix = 1; suffix <= maxSuffix; suffix += 1) {
    const candidate = suffix === 1 ? basePath : `${basePath} - ${suffix}`
    if (occupied.has(candidate.normalize('NFC').toUpperCase().normalize('NFC'))) continue
    const parsed = parseRelativePath(candidate)
    if (parsed.ok) return { ok: true, relativePath: parsed.value }
  }
  return { ok: false, error: 'path_limit_exhausted' }
}
