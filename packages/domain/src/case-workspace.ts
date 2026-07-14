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
 * notificationDate + kanonik plakadan `YYYY/Ay YYYY/PLAKA` tabanını üretir.
 * Saat, timezone, DB veya dosya sistemi kullanmaz; aynı girdi aynı sonucu verir.
 */
export function buildCaseWorkspaceBasePath(notificationDate: string, plate: string): CaseWorkspacePathResult {
  const date = parseLocalDate(notificationDate)
  if (!date.ok) return { ok: false, error: 'invalid_notification_date' }
  const parsedPlate = parsePlateNumber(plate)
  if (!parsedPlate.ok) return { ok: false, error: 'invalid_plate' }

  const year = Number(notificationDate.slice(0, 4))
  const monthIndex = Number(notificationDate.slice(5, 7)) - 1
  const month = TURKISH_MONTH_NAMES[monthIndex]
  if (month === undefined) return { ok: false, error: 'invalid_notification_date' }
  const compactPlate = String(parsedPlate.value).replaceAll(' ', '')
  const parsedPath = parseRelativePath(`${year}/${month} ${year}/${compactPlate}`)
  return parsedPath.ok
    ? { ok: true, relativePath: parsedPath.value }
    : { ok: false, error: 'invalid_plate' }
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
  const occupied = new Set(occupiedPaths.map((path) => path.toLocaleUpperCase('tr-TR')))
  for (let suffix = 1; suffix <= maxSuffix; suffix += 1) {
    const candidate = suffix === 1 ? basePath : `${basePath} - ${suffix}`
    if (occupied.has(candidate.toLocaleUpperCase('tr-TR'))) continue
    const parsed = parseRelativePath(candidate)
    if (parsed.ok) return { ok: true, relativePath: parsed.value }
  }
  return { ok: false, error: 'path_limit_exhausted' }
}
