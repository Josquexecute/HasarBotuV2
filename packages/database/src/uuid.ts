import { randomBytes } from 'node:crypto'

/**
 * UUIDv7 ureteci (RFC 9562): 48 bit milisaniye zaman damgasi + surum/varyant
 * bitleri + 74 bit rastgelelik. Zaman-sirali oldugu icin B-tree indeks dostudur.
 *
 * Kimlik uretimi bilinçli olarak persistence katmanindadir (HB-2026-009);
 * domain paketi kimlik uretmez, yalnizca dogrular.
 */
export function uuidv7(): string {
  const bytes = randomBytes(16)
  const ms = BigInt(Date.now())

  bytes[0] = Number((ms >> 40n) & 0xffn)
  bytes[1] = Number((ms >> 32n) & 0xffn)
  bytes[2] = Number((ms >> 24n) & 0xffn)
  bytes[3] = Number((ms >> 16n) & 0xffn)
  bytes[4] = Number((ms >> 8n) & 0xffn)
  bytes[5] = Number(ms & 0xffn)
  // surum 7 (0111) ve RFC 4122 varyanti (10xx)
  bytes[6] = (bytes[6] & 0x0f) | 0x70
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** Degerin bu uretecin cikardigi bicimde bir UUIDv7 olup olmadigini soyler. */
export function isUuidV7(value: string): boolean {
  return UUID_PATTERN.test(value)
}
