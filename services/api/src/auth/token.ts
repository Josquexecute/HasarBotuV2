import { createHash, randomBytes } from 'node:crypto'

/**
 * Oturum token'i: 256 bit rastgelelik, base64url. Veritabaninda ham token
 * SAKLANMAZ; yalniz SHA-256 hex hash'i tutulur. Boylece DB sizintisi aktif
 * oturumlari ele gecirmeye yetmez.
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
