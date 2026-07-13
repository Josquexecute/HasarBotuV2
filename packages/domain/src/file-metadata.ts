import { brandValue, type Brand } from './brand.js'
import { parseFailure, parseSuccess, type ParseResult } from './parse-result.js'

/**
 * Dosya meta verisi doğrulayıcıları (Paket 13). Yalnız METADATA doğrular; dosya
 * içeriğine dokunmaz. Orijinal ad güvenliği (yol ayracı, traversal, kontrol
 * karakteri, ayrılmış aygıt adı reddi), güvenli gösterim adı türetimi,
 * uzantı↔MIME tutarlılığı ve SHA-256 biçimi burada tanımlanır.
 */

export type SafeFileName = Brand<string, 'SafeFileName'>
export type Sha256Hex = Brand<string, 'Sha256Hex'>

export const MAX_FILE_NAME_LENGTH = 255
export const MAX_DISPLAY_NAME_LENGTH = 200

const BACKSLASH = String.fromCharCode(92)

const WINDOWS_RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
])

function hasControlChar(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 32 || (code >= 127 && code <= 159)) return true
  }
  return false
}

// Dosya ADINDA yasak: yol ayracı (/ \), sürücü/ADS (:) ve Windows yasak karakterleri.
const FORBIDDEN_NAME_CHARS = /[<>:"/|?*]/

/**
 * Orijinal dosya adı güvenlik doğrulaması. Ad TEK bir dosya adı olmalıdır (yol
 * DEĞİL): ayraç, traversal, kontrol karakteri, ayrılmış aygıt adı, segment sonu
 * nokta/boşluk reddedilir. Başarıda kırpılmış adı brand'li döndürür.
 */
export function parseOriginalFileName(value: unknown): ParseResult<SafeFileName> {
  if (typeof value !== 'string') return parseFailure('invalid_type', 'originalFileName')
  const trimmed = value.trim()
  if (trimmed.length === 0) return parseFailure('required', 'originalFileName')
  if (trimmed.length > MAX_FILE_NAME_LENGTH) return parseFailure('out_of_range', 'originalFileName')
  if (hasControlChar(trimmed)) return parseFailure('invalid_format', 'originalFileName')
  if (trimmed.includes(BACKSLASH) || FORBIDDEN_NAME_CHARS.test(trimmed)) {
    return parseFailure('invalid_format', 'originalFileName')
  }
  if (trimmed === '.' || trimmed === '..') return parseFailure('invalid_format', 'originalFileName')
  if (trimmed.endsWith('.') || trimmed.endsWith(' ')) return parseFailure('invalid_format', 'originalFileName')
  const base = (trimmed.split('.')[0] ?? '').toLowerCase()
  if (WINDOWS_RESERVED_NAMES.has(base)) return parseFailure('unsupported_value', 'originalFileName')
  return parseSuccess(brandValue<string, 'SafeFileName'>(trimmed))
}

/**
 * Güvenli gösterim adı: yasak/kontrol karakterleri `_` ile değiştirilir, uzunluk
 * sınırlanır. UI'de gösterilebilir; fiziksel dosya adı değildir.
 */
export function toSafeDisplayName(value: string): string {
  let out = ''
  for (const char of value.trim()) {
    const code = char.charCodeAt(0)
    if (code < 32 || (code >= 127 && code <= 159)) out += '_'
    else if (char === BACKSLASH || FORBIDDEN_NAME_CHARS.test(char)) out += '_'
    else out += char
  }
  out = out.slice(0, MAX_DISPLAY_NAME_LENGTH).trim()
  return out.length > 0 ? out : 'dosya'
}

/** Uzantıyı (noktasız, küçük harf) döndürür; uzantı yoksa null. */
export function extractExtension(fileName: string): string | null {
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0 || dot === fileName.length - 1) return null
  return fileName.slice(dot + 1).toLowerCase()
}

export type FileCategory = 'document' | 'photo'

interface FileTypeRule {
  readonly mimeTypes: readonly string[]
  readonly category: FileCategory
}

/** İzin verilen uzantı → kabul edilen MIME kümesi + kategori. */
export const ALLOWED_FILE_TYPES: Readonly<Record<string, FileTypeRule>> = {
  pdf: { mimeTypes: ['application/pdf'], category: 'document' },
  xlsx: {
    mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    category: 'document',
  },
  xls: { mimeTypes: ['application/vnd.ms-excel'], category: 'document' },
  docx: {
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    category: 'document',
  },
  jpg: { mimeTypes: ['image/jpeg'], category: 'photo' },
  jpeg: { mimeTypes: ['image/jpeg'], category: 'photo' },
  png: { mimeTypes: ['image/png'], category: 'photo' },
  webp: { mimeTypes: ['image/webp'], category: 'photo' },
}

/** Uzantı izinli mi ve MIME uzantıyla tutarlı mı? */
export function isMimeExtensionConsistent(extension: string | null, mimeType: string): boolean {
  if (extension === null) return false
  const rule = ALLOWED_FILE_TYPES[extension]
  if (rule === undefined) return false
  return rule.mimeTypes.includes(mimeType.toLowerCase())
}

/** İzinli uzantının kategorisi; izinli değilse null. */
export function fileCategoryOf(extension: string | null): FileCategory | null {
  if (extension === null) return null
  return ALLOWED_FILE_TYPES[extension]?.category ?? null
}

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/

/** SHA-256 hex (64 küçük-harf hex). BEYAN edilen hash'tir; doğrulanmış değildir. */
export function parseSha256Hex(value: unknown): ParseResult<Sha256Hex> {
  if (typeof value !== 'string') return parseFailure('invalid_type', 'contentHash')
  const normalized = value.trim().toLowerCase()
  if (normalized.length === 0) return parseFailure('required', 'contentHash')
  if (!SHA256_HEX_PATTERN.test(normalized)) return parseFailure('invalid_format', 'contentHash')
  return parseSuccess(brandValue<string, 'Sha256Hex'>(normalized))
}
