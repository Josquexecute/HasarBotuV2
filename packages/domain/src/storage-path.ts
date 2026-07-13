import { brandValue, type Brand } from './brand.js'
import { parseFailure, parseSuccess, type ParseResult } from './parse-result.js'

/**
 * Depolama referansi (Paket 12).
 *
 * Kaynak doğruluk yalnız MANTIKSAL `storageRootKey` + POSIX biçimli GÖRELİ
 * yoldur. Mutlak `P:\`, sürücü harfi, UNC veya cihaza özel mount yolu burada
 * ASLA doğrulanmaz veya saklanmaz — cihaz→mutlak eşlemesi yalnız yerel File
 * Agent/config işidir (ARCHITECTURE + FILE_STORAGE_AND_AGENT_PLAN).
 *
 * `parseRelativePath` güvenlik sınırıdır: traversal (`..`), absolute path,
 * sürücü ön eki, UNC/backslash, kontrol karakteri, Windows yasak karakterleri
 * ve ayrılmış aygıt adları reddedilir.
 */

export type StorageRootKey = Brand<string, 'StorageRootKey'>
export type RelativePath = Brand<string, 'RelativePath'>

export interface StorageLocation {
  readonly rootKey: StorageRootKey
  readonly relativePath: RelativePath
}

export const MAX_STORAGE_ROOT_KEY_LENGTH = 64
export const MAX_RELATIVE_PATH_LENGTH = 400
export const MAX_PATH_SEGMENT_LENGTH = 255

/** rootKey: küçük harf slug (organizasyon kod stiliyle uyumlu). */
const STORAGE_ROOT_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function parseStorageRootKey(value: unknown): ParseResult<StorageRootKey> {
  if (typeof value !== 'string') return parseFailure('invalid_type', 'storageRootKey')
  const normalized = value.trim()
  if (normalized.length === 0) return parseFailure('required', 'storageRootKey')
  if (normalized.length > MAX_STORAGE_ROOT_KEY_LENGTH) return parseFailure('out_of_range', 'storageRootKey')
  if (!STORAGE_ROOT_KEY_PATTERN.test(normalized)) return parseFailure('invalid_format', 'storageRootKey')
  return parseSuccess(brandValue<string, 'StorageRootKey'>(normalized))
}

/** Windows'ta ayrılmış aygıt adları (uzantılı veya uzantısız reddedilir). */
const WINDOWS_RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
])

const BACKSLASH = String.fromCharCode(92)

/** Kontrol karakteri (C0 0-31, DEL 127, C1 128-159) ve null byte. */
function hasControlChar(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 32 || (code >= 127 && code <= 159)) return true
  }
  return false
}

/**
 * Windows'ta yol/dosya adında yasak karakterler. `:` sürücü/ADS ön ekini,
 * backslash yerel ayracı, `< > " | ? *` ise yasak adları kapsar. `/` geçerli
 * POSIX ayracıdır ve sözleşmedeki tek ayraçtır.
 */
const FORBIDDEN_PATH_CHARS = /[<>:"|?*]/

/**
 * Güvenli göreli yol doğrulaması. Başarıda kanonik (değiştirilmemiş) değeri
 * brand'li döndürür; girdi zaten kanoniktir çünkü boş/`.`/`..` segmentleri ve
 * çift ayraç reddedilir (yeniden normalize gerekmez).
 */
export function parseRelativePath(value: unknown): ParseResult<RelativePath> {
  if (typeof value !== 'string') return parseFailure('invalid_type', 'relativePath')
  if (value.length === 0) return parseFailure('required', 'relativePath')
  if (value.length > MAX_RELATIVE_PATH_LENGTH) return parseFailure('out_of_range', 'relativePath')

  // Kontrol/null karakteri; backslash (UNC/yerel ayraç); Windows yasak karakteri.
  if (hasControlChar(value)) return parseFailure('invalid_format', 'relativePath')
  if (value.includes(BACKSLASH)) return parseFailure('invalid_format', 'relativePath')
  if (FORBIDDEN_PATH_CHARS.test(value)) return parseFailure('invalid_format', 'relativePath')

  // Absolute (POSIX kök) ve sürücü ön eki (C:, P: ...) reddi.
  if (value.startsWith('/')) return parseFailure('invalid_format', 'relativePath')
  if (/^[A-Za-z]:/.test(value)) return parseFailure('invalid_format', 'relativePath')

  for (const segment of value.split('/')) {
    // Boş segment: çift ayraç, baştaki veya sondaki ayraç.
    if (segment.length === 0) return parseFailure('invalid_format', 'relativePath')
    if (segment.length > MAX_PATH_SEGMENT_LENGTH) return parseFailure('out_of_range', 'relativePath')
    // Traversal / geçerli-dizin referansı.
    if (segment === '.' || segment === '..') return parseFailure('invalid_format', 'relativePath')
    // Windows: baştaki boşluk, sondaki boşluk veya nokta normalize edilir -> risk.
    if (segment.startsWith(' ') || segment.endsWith(' ') || segment.endsWith('.')) {
      return parseFailure('invalid_format', 'relativePath')
    }
    // Ayrılmış aygıt adı (uzantı öncesi taban ad).
    const base = (segment.split('.')[0] ?? '').toLowerCase()
    if (WINDOWS_RESERVED_NAMES.has(base)) return parseFailure('unsupported_value', 'relativePath')
  }

  return parseSuccess(brandValue<string, 'RelativePath'>(value))
}

export function isRelativePath(value: unknown): value is RelativePath {
  return parseRelativePath(value).ok
}

export function isStorageRootKey(value: unknown): value is StorageRootKey {
  return parseStorageRootKey(value).ok
}

/** rootKey + göreli yolu birlikte doğrular. */
export function parseStorageLocation(rootKey: unknown, relativePath: unknown): ParseResult<StorageLocation> {
  const keyResult = parseStorageRootKey(rootKey)
  if (!keyResult.ok) return parseFailure(keyResult.error.code, keyResult.error.field)
  const pathResult = parseRelativePath(relativePath)
  if (!pathResult.ok) return parseFailure(pathResult.error.code, pathResult.error.field)
  return parseSuccess({ rootKey: keyResult.value, relativePath: pathResult.value })
}
