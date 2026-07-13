/**
 * Auth/oturum sinir katmani (Paket 10). UI yalniz bu arayuzu tuketir; gercek
 * e-posta+sifre API'sine baglanir. Oturum HttpOnly cerezle SUNUCU tarafinda
 * tutulur ve tarayicida ayni-origin proxy ile tasinir (credentials: 'include').
 * Parola veya oturum token'i UI state/localStorage icinde ASLA saklanmaz.
 */

/** Surumlu auth route sabitleri (contracts ile ayni; UI'da yerel tutulur). */
const AUTH_LOGIN_ROUTE = '/api/v1/auth/login'
const AUTH_LOGOUT_ROUTE = '/api/v1/auth/logout'
const AUTH_SESSION_ROUTE = '/api/v1/auth/session'

export interface SessionUser {
  readonly id: string
  readonly organizationId: string
  readonly email: string
  readonly displayName: string
  readonly roles: readonly string[]
}

interface SessionResponseDto {
  user: {
    id: string
    organizationId: string
    email: string
    displayName: string
    roles: string[]
  }
  expiresAt: string
}

function toSessionUser(dto: SessionResponseDto): SessionUser {
  return {
    id: dto.user.id,
    organizationId: dto.user.organizationId,
    email: dto.user.email,
    displayName: dto.user.displayName,
    roles: dto.user.roles,
  }
}

/**
 * `invalid_credentials`: e-posta/parola hatali (401) veya bicimsel red (400).
 * `rate_limited`: cok fazla deneme (429). `unavailable`: ag/5xx — gercek hata
 * asla gizlenmez, sahte oturum uydurulmaz.
 */
export type AuthErrorKind = 'invalid_credentials' | 'rate_limited' | 'unavailable'

export class HttpAuthError extends Error {
  readonly kind: AuthErrorKind
  readonly retryAfterSeconds: number | undefined

  constructor(kind: AuthErrorKind, message: string, retryAfterSeconds?: number) {
    super(message)
    this.name = 'HttpAuthError'
    this.kind = kind
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export interface AuthPort {
  /** Uygulama acilisinda oturum bootstrap: gecerli oturum -> kullanici, 401 -> null. */
  bootstrap(): Promise<SessionUser | null>
  /** Basari: oturum kullanicisi. Hata: `HttpAuthError`. */
  login(email: string, password: string): Promise<SessionUser>
  /** En iyi caba: sunucu oturumu iptal eder ve cerezi temizler. */
  logout(): Promise<void>
}

export interface AuthAdapterOptions {
  /** Tarayicida bos birakilir (ayni-origin proxy); Node testlerinde mutlak URL. */
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
  /** Node testleri icin ek basliklar (ör. oturum cerezi). */
  readonly headers?: Readonly<Record<string, string>>
}

export function createHttpAuthAdapter(options: AuthAdapterOptions = {}): AuthPort {
  const baseUrl = options.baseUrl ?? ''
  const fetchImpl = options.fetchImpl ?? fetch
  const extraHeaders = options.headers ?? {}

  return {
    async bootstrap(): Promise<SessionUser | null> {
      let response: Response
      try {
        response = await fetchImpl(`${baseUrl}${AUTH_SESSION_ROUTE}`, {
          credentials: 'include',
          headers: { accept: 'application/json', ...extraHeaders },
        })
      } catch {
        throw new HttpAuthError('unavailable', 'auth session endpoint unreachable')
      }
      if (response.status === 401) return null
      if (!response.ok) throw new HttpAuthError('unavailable', `auth session HTTP ${response.status}`)
      return toSessionUser((await response.json()) as SessionResponseDto)
    },

    async login(email: string, password: string): Promise<SessionUser> {
      let response: Response
      try {
        response = await fetchImpl(`${baseUrl}${AUTH_LOGIN_ROUTE}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json', accept: 'application/json', ...extraHeaders },
          body: JSON.stringify({ email, password }),
        })
      } catch {
        throw new HttpAuthError('unavailable', 'auth login endpoint unreachable')
      }
      if (response.ok) return toSessionUser((await response.json()) as SessionResponseDto)
      if (response.status === 429) {
        const header = response.headers?.get?.('retry-after')
        const retry = header !== null && header !== undefined ? Number(header) : Number.NaN
        throw new HttpAuthError(
          'rate_limited',
          'too many login attempts',
          Number.isFinite(retry) && retry > 0 ? retry : undefined,
        )
      }
      // 400 (bicimsel) ve 401 (kimlik) kullaniciya tekduze "gecersiz" olarak yansir.
      if (response.status === 400 || response.status === 401) {
        throw new HttpAuthError('invalid_credentials', 'invalid credentials')
      }
      throw new HttpAuthError('unavailable', `auth login HTTP ${response.status}`)
    },

    async logout(): Promise<void> {
      try {
        await fetchImpl(`${baseUrl}${AUTH_LOGOUT_ROUTE}`, {
          method: 'POST',
          credentials: 'include',
          headers: { accept: 'application/json', ...extraHeaders },
        })
      } catch {
        // Cikis en iyi cabadir: ag hatasinda bile istemci oturum state'i temizlenir.
      }
    },
  }
}
