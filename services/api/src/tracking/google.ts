import { createCipheriv, createDecipheriv, createHash, createPublicKey, randomBytes, verify, type JsonWebKey } from 'node:crypto'
import { z } from 'zod'

export interface GoogleConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  encryptionKey: string
  sbmSenders: string[]
  automaticSbmEnabled: boolean
}

export function parseGoogleConfig(env: Readonly<Record<string,string | undefined>>): GoogleConfig | undefined {
  const keys = ['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REDIRECT_URI','GOOGLE_TOKEN_ENCRYPTION_KEY'] as const
  if (keys.every((key) => !env[key])) return undefined
  for (const key of keys) if (!env[key]?.trim()) throw new Error(`Missing ${key}`)
  if (!/^[a-f0-9]{64}$/i.test(env.GOOGLE_TOKEN_ENCRYPTION_KEY!)) throw new Error('Invalid GOOGLE_TOKEN_ENCRYPTION_KEY: 32-byte hexadecimal key required')
  let redirect: URL
  try { redirect = new URL(env.GOOGLE_REDIRECT_URI!) } catch { throw new Error('Invalid GOOGLE_REDIRECT_URI') }
  if ((redirect.protocol !== 'https:' && !(redirect.protocol === 'http:' && ['127.0.0.1','localhost'].includes(redirect.hostname))) || redirect.username || redirect.password || redirect.search || redirect.hash || redirect.pathname !== '/api/v1/google/callback') throw new Error('Invalid GOOGLE_REDIRECT_URI')
  const sbmSenders = (env.SBM_SENDER_ADDRESSES ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (sbmSenders.some((s) => !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(s))) throw new Error('Invalid SBM_SENDER_ADDRESSES')
  // This opt-in represents an operator's completed real-message validation, never a default.
  if (env.SBM_AUTOMATIC_ENABLED && !['true','false'].includes(env.SBM_AUTOMATIC_ENABLED)) throw new Error('Invalid SBM_AUTOMATIC_ENABLED')
  if (env.SBM_AUTOMATIC_ENABLED === 'true' && !sbmSenders.length) throw new Error('SBM_SENDER_ADDRESSES required for automatic processing')
  return { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET!, redirectUri: redirect.href, encryptionKey: env.GOOGLE_TOKEN_ENCRYPTION_KEY!, sbmSenders, automaticSbmEnabled: env.SBM_AUTOMATIC_ENABLED === 'true' }
}

export const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export const randomToken = () => randomBytes(32).toString('base64url')
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'

export function encryptToken(token: string, key: string, context: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv)
  cipher.setAAD(Buffer.from(context))
  const data = Buffer.concat([cipher.update(token,'utf8'),cipher.final()])
  return [iv,cipher.getAuthTag(),data].map((part) => part.toString('base64url')).join('.')
}

export function decryptToken(value: string, key: string, context: string): string {
  const parts = value.split('.')
  if (parts.length !== 3) throw new Error('Invalid encrypted credential')
  const [iv,tag,data] = parts.map((p) => Buffer.from(p,'base64url'))
  const cipher = createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv!)
  cipher.setAAD(Buffer.from(context))
  cipher.setAuthTag(tag!)
  return Buffer.concat([cipher.update(data!),cipher.final()]).toString('utf8')
}

const claimsSchema = z.object({ iss: z.string(), sub: z.string().min(1), aud: z.union([z.string(),z.array(z.string())]), azp: z.string().optional(), exp: z.number(), iat: z.number(), nonce: z.string(), email: z.string().email(), email_verified: z.boolean(), hd: z.string().optional() })
export type GoogleIdentity = z.infer<typeof claimsSchema>

export function validateGoogleClaims(claims: unknown, clientId: string, nonce: string, corporate: boolean, now = Date.now()): GoogleIdentity {
  const c = claimsSchema.parse(claims)
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud]
  if (!['accounts.google.com','https://accounts.google.com'].includes(c.iss) || !aud.includes(clientId)
    || (aud.length > 1 && c.azp !== clientId) || (c.azp !== undefined && c.azp !== clientId)
    || c.exp <= now / 1000 || c.iat > now / 1000 + 60 || c.nonce !== nonce || !c.email_verified
    || (corporate && (c.hd !== 'baranekspertiz.com' || !c.email.toLowerCase().endsWith('@baranekspertiz.com')))) throw new Error('Google identity rejected')
  return c
}

export class GoogleProviderError extends Error {
  constructor(readonly kind: 'permission_required' | 'temporary', readonly status: number) { super(`Google provider ${kind}`) }
}

export function createGoogleProvider(config: GoogleConfig, fetchImpl: typeof fetch = fetch) {
  let keys: JsonWebKey[] = []
  let keysExpireAt = 0
  async function json(url: string, init: RequestInit = {}) {
    const response = await fetchImpl(url,{ ...init, signal: AbortSignal.timeout(20_000) })
    const body: unknown = await response.json()
    if (!response.ok) {
      const error = body as { error?: string | { status?: string } }
      throw new GoogleProviderError(response.status === 401 || error.error === 'invalid_grant' || (response.status === 403 && typeof error.error === 'object' && error.error.status === 'PERMISSION_DENIED') ? 'permission_required' : 'temporary',response.status)
    }
    return body
  }
  async function token(params: Record<string,string>) {
    return z.object({ access_token: z.string().min(1), refresh_token: z.string().optional(), id_token: z.string().optional(), scope: z.string().optional() }).parse(await json('https://oauth2.googleapis.com/token',{
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.clientId,client_secret: config.clientSecret,...params }),
    }))
  }
  return {
    authorizeUrl(purpose: 'login' | 'mail', state: string, nonce: string, verifier: string) {
      const params = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: `openid email profile${purpose === 'mail' ? ` ${GMAIL_SCOPE}` : ''}`, state, nonce, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', include_granted_scopes: 'false', prompt: purpose === 'mail' ? 'consent select_account' : 'select_account', ...(purpose === 'mail' ? { access_type: 'offline' } : { hd: 'baranekspertiz.com' }) })
      return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
    },
    exchange: (code: string, verifier: string) => token({ code,code_verifier: verifier,redirect_uri: config.redirectUri,grant_type: 'authorization_code' }),
    refresh: (refreshToken: string) => token({ refresh_token: refreshToken,grant_type: 'refresh_token' }),
    async identity(jwt: string, nonce: string, corporate: boolean) {
      const parts = jwt.split('.')
      if (parts.length !== 3) throw new Error('Invalid identity token')
      const header = z.object({ alg: z.literal('RS256'),kid: z.string() }).parse(JSON.parse(Buffer.from(parts[0]!,'base64url').toString('utf8')))
      if (Date.now() >= keysExpireAt || !keys.some((k) => k.kid === header.kid)) {
        const response = z.object({ keys: z.array(z.object({ kty: z.literal('RSA'),kid: z.string(),n: z.string(),e: z.string(),use: z.literal('sig').optional(),alg: z.literal('RS256').optional() })) }).parse(await json('https://www.googleapis.com/oauth2/v3/certs'))
        keys = response.keys
        keysExpireAt = Date.now() + 60 * 60 * 1000
      }
      const jwk = keys.find((k) => k.kid === header.kid)
      if (!jwk || !verify('RSA-SHA256',Buffer.from(`${parts[0]}.${parts[1]}`),createPublicKey({ key: jwk,format: 'jwk' }),Buffer.from(parts[2]!,'base64url'))) throw new Error('Invalid identity signature')
      return validateGoogleClaims(JSON.parse(Buffer.from(parts[1]!,'base64url').toString('utf8')),config.clientId,nonce,corporate)
    },
    gmail: (accessToken: string, path: string) => json(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`,{ headers: { authorization: `Bearer ${accessToken}` } }),
  }
}
export type GoogleProvider = ReturnType<typeof createGoogleProvider>
