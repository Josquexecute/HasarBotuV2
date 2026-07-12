/**
 * Oturum cerezi politikasi: HttpOnly + SameSite=Strict + Path=/ (+ uretimde
 * Secure). Imzali cerez gerekmez; deger sunucu tarafinda hash'iyle aranan
 * opak token'dir.
 */
export const SESSION_COOKIE_NAME = 'hb_session'

export interface SessionCookieOptions {
  readonly maxAgeSeconds: number
  readonly secure: boolean
}

export function buildSessionCookie(token: string, options: SessionCookieOptions): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${options.maxAgeSeconds}`,
  ]
  if (options.secure) parts.push('Secure')
  return parts.join('; ')
}

export function buildClearSessionCookie(options: { readonly secure: boolean }): string {
  const parts = [`${SESSION_COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0']
  if (options.secure) parts.push('Secure')
  return parts.join('; ')
}

/** Cookie basligini kucuk, bagimliliksiz bir ayristiriciyla okur. */
export function parseCookies(header: string | undefined): Readonly<Record<string, string>> {
  const cookies: Record<string, string> = {}
  if (header === undefined) return cookies
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    const name = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (name.length > 0) cookies[name] = value
  }
  return cookies
}
