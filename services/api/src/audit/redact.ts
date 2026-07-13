/**
 * Audit redaksiyonu (Paket 11). Audit `details` icine yazilmadan ONCE calisir:
 * hassas ADli alanlar `[redacted]` ile degistirilir, asiri uzun metinler
 * kirpilir, derinlik/eleman sayisi sinirlanir. Amac: parola, oturum token'i,
 * cerez, sir, tam poliçe metni veya gereksiz kisisel verinin audit'e ASLA
 * sizmamasi (savunma-derinligi; cagiran zaten guvenli ozet gecmeye calisir).
 */

export const REDACTED = '[redacted]'
export const MAX_AUDIT_STRING_LENGTH = 512
export const MAX_AUDIT_DEPTH = 6
export const MAX_AUDIT_ARRAY_ITEMS = 50
export const MAX_AUDIT_OBJECT_KEYS = 50

/**
 * Hassas alan adi kalibi (buyuk/kucuk harf duyarsiz). Anahtar ADINA gore
 * redaksiyon yapar — deger tipine degil. Parola/token/cerez/oturum/sir/hash/
 * kimlik bilgisi + tam poliçe/ham metin + belirgin PII alanlarini kapsar.
 */
export const SENSITIVE_KEY_PATTERN =
  /pass(word|wd)?|secret|token|cookie|authorization|session|api[_-]?key|credential|hash|otp|cvv|card[_-]?number|\biban\b|\bssn\b|policy[_-]?(text|body|raw|content)|raw[_-]?text|full[_-]?text|private[_-]?key/i

function redactString(value: string): string {
  if (value.length <= MAX_AUDIT_STRING_LENGTH) return value
  return `${value.slice(0, MAX_AUDIT_STRING_LENGTH)}…[truncated]`
}

/**
 * Degeri audit icin guvenli, JSON-serialize edilebilir bir kopyaya cevirir.
 * `undefined`/fonksiyon/symbol atlanir; `bigint` string'e cevrilir; sonlu
 * olmayan sayilar `null` olur.
 */
export function redactValue(value: unknown, depth = 0): unknown {
  if (value === null) return null
  const type = typeof value
  if (type === 'string') return redactString(value as string)
  if (type === 'number') return Number.isFinite(value as number) ? value : null
  if (type === 'boolean') return value
  if (type === 'bigint') return (value as bigint).toString()
  if (type !== 'object') return undefined // function/symbol/undefined

  if (depth >= MAX_AUDIT_DEPTH) return REDACTED

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_AUDIT_ARRAY_ITEMS).map((item) => redactValue(item, depth + 1))
    return items
  }

  const output: Record<string, unknown> = {}
  let count = 0
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (count >= MAX_AUDIT_OBJECT_KEYS) break
    count += 1
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = REDACTED
      continue
    }
    const redacted = redactValue(raw, depth + 1)
    if (redacted !== undefined) output[key] = redacted
  }
  return output
}

export interface ChangeSummary {
  readonly changedFields: string[]
  readonly before: Record<string, unknown>
  readonly after: Record<string, unknown>
}

/**
 * Guvenli degisiklik ozeti: degisen alan ADlarini ve yalniz bu alanlarin
 * eski/yeni degerlerini (redaksiyonlu) dondurur. `fields` verilirse yalniz o
 * alanlar karsilastirilir; verilmezse iki nesnenin anahtar birlesimi kullanilir.
 */
export function summarizeChange(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
  fields?: readonly string[],
): ChangeSummary {
  const keys = fields ?? [...new Set([...Object.keys(before), ...Object.keys(after)])]
  const changedFields: string[] = []
  const beforeOut: Record<string, unknown> = {}
  const afterOut: Record<string, unknown> = {}
  for (const key of keys) {
    const a = before[key]
    const b = after[key]
    if (Object.is(a, b)) continue
    changedFields.push(key)
    // Alan ADI hassassa eski/yeni deger tumuyle redakte edilir (deger tipinden bagimsiz).
    const sensitive = SENSITIVE_KEY_PATTERN.test(key)
    beforeOut[key] = sensitive ? REDACTED : redactValue(a)
    afterOut[key] = sensitive ? REDACTED : redactValue(b)
  }
  return { changedFields, before: beforeOut, after: afterOut }
}
