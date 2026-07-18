import {
  MAX_LABOR_ITEM_ACTION_LENGTH,
  MAX_LABOR_ITEM_DESCRIPTION_LENGTH,
  normalizeLaborText,
} from './labor-sheet.js'

/**
 * Paket 46 — İşçilik öğrenme sözlüğü (türetilmiş read-model).
 *
 * Sözlük yeni bir gerçek kaynağı değildir: yalnız kullanıcıların açık onayla
 * kaydettiği güncel föy sürümlerinden organization kapsamında türetilir. AI
 * yoktur, otomatik doldurma yoktur; sonuç sıralı bir öneri listesidir ve
 * kullanıcı seçimi olmadan hiçbir alan değişmez.
 */
export const LABOR_DICTIONARY_SCHEMA_VERSION = 'labor-dictionary/1.0.0' as const

export const MAX_LABOR_DICTIONARY_ENTRIES = 200
export const MAX_LABOR_DICTIONARY_QUERY_LENGTH = 160

export interface LaborDictionaryEntryInput {
  readonly description: string
  readonly action: string
  readonly usageCount: number
  readonly lastPartAmountMinor: number
  readonly lastLaborAmountMinor: number
  readonly lastUsedAt: string
}

export interface LaborDictionaryEntry extends LaborDictionaryEntryInput {
  /** Eşleştirme anahtarı: aksan/büyük-küçük duyarsız normalize edilmiş metin. */
  readonly matchKey: string
}

/**
 * Türkçe duyarlı arama anahtarı: küçük harfe indirger, aksanları ayırıp
 * birleştirici işaretleri atar ve boşlukları tekilleştirir. Yalnız eşleştirme
 * içindir; kullanıcıya her zaman orijinal metin gösterilir.
 */
export function laborDictionaryMatchKey(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replace(/\s+/gu, ' ')
}

/** Sözlük satırını normalize eder; geçersiz metin/tutar satırı elenir (null). */
export function normalizeLaborDictionaryEntry(
  input: LaborDictionaryEntryInput,
): LaborDictionaryEntry | null {
  const description = normalizeLaborText(input.description, MAX_LABOR_ITEM_DESCRIPTION_LENGTH)
  const action = normalizeLaborText(input.action, MAX_LABOR_ITEM_ACTION_LENGTH)
  if (description === null || action === null) return null
  if (!Number.isSafeInteger(input.usageCount) || input.usageCount < 1) return null
  for (const amount of [input.lastPartAmountMinor, input.lastLaborAmountMinor]) {
    if (!Number.isSafeInteger(amount) || amount < 0) return null
  }
  return {
    description,
    action,
    usageCount: input.usageCount,
    lastPartAmountMinor: input.lastPartAmountMinor,
    lastLaborAmountMinor: input.lastLaborAmountMinor,
    lastUsedAt: input.lastUsedAt,
    matchKey: laborDictionaryMatchKey(`${description} ${action}`),
  }
}

/**
 * Sözlüğü deterministik sıralar: önce kullanım sayısı (çok → az), sonra en son
 * kullanım (yeni → eski), sonra Türkçe alfabetik kalem ve işlem.
 */
export function sortLaborDictionary(
  entries: readonly LaborDictionaryEntry[],
): readonly LaborDictionaryEntry[] {
  return [...entries].sort((left, right) => (
    right.usageCount - left.usageCount
    || right.lastUsedAt.localeCompare(left.lastUsedAt)
    || left.description.localeCompare(right.description, 'tr')
    || left.action.localeCompare(right.action, 'tr')
  ))
}

/**
 * Serbest metin sorgusunu sözlükte arar. Boş sorgu tüm listeyi sıralı döner;
 * dolu sorgu normalize edilmiş alt dize eşleşmesi uygular. Sonuç `limit` ile
 * sınırlanır ve hiçbir zaman kullanıcı adına seçim yapmaz.
 */
export function searchLaborDictionary(
  entries: readonly LaborDictionaryEntry[],
  query: string,
  limit: number = MAX_LABOR_DICTIONARY_ENTRIES,
): readonly LaborDictionaryEntry[] {
  const safeLimit = Number.isSafeInteger(limit) && limit > 0
    ? Math.min(limit, MAX_LABOR_DICTIONARY_ENTRIES)
    : MAX_LABOR_DICTIONARY_ENTRIES
  const normalizedQuery = laborDictionaryMatchKey(query.slice(0, MAX_LABOR_DICTIONARY_QUERY_LENGTH))
  const sorted = sortLaborDictionary(entries)
  if (normalizedQuery.length === 0) return sorted.slice(0, safeLimit)
  return sorted
    .filter((entry) => entry.matchKey.includes(normalizedQuery))
    .slice(0, safeLimit)
}
