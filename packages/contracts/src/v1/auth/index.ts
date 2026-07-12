import { z } from 'zod'
import { API_V1_BASE } from '../../common/routes.js'
import { idSchema, utcDateTimeSchema } from '../../common/primitives.js'

/** Surumlu auth route sabitleri. */
export const AUTH_LOGIN_ROUTE = `${API_V1_BASE}/auth/login` as const
export const AUTH_LOGOUT_ROUTE = `${API_V1_BASE}/auth/logout` as const
export const AUTH_SESSION_ROUTE = `${API_V1_BASE}/auth/session` as const

/** Sabit rol katalogu (DECISIONS: Yonetici, Eksper, Dosya sorumlusu, Sekreter, Muhasebe, Salt okunur). */
export const ROLE_CODES = [
  'admin',
  'expert',
  'case_manager',
  'secretary',
  'accounting',
  'read_only',
] as const
export type RoleCode = (typeof ROLE_CODES)[number]
export const roleCodeSchema = z.enum(ROLE_CODES)

/** Parola politikasi: 10..128 karakter (icerik kurali Paket 06'da bilinçli minimal). */
export const MIN_PASSWORD_LENGTH = 10
export const MAX_PASSWORD_LENGTH = 128
export const passwordSchema = z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH)

/** Basit, sinirli e-posta bicimi; tam RFC dogrulamasi bilinçli hedef degildir. */
export const MAX_EMAIL_LENGTH = 254
export const emailSchema = z
  .string()
  .min(3)
  .max(MAX_EMAIL_LENGTH)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { error: 'invalid_email_format' })

/** `POST /api/v1/auth/login` istek govdesi. Strict: bilinmeyen alan reddedilir. */
export const loginRequestSchema = z.strictObject({
  email: emailSchema,
  password: passwordSchema,
})
export type LoginRequest = z.infer<typeof loginRequestSchema>

/** Oturum sahibi kullanici ozeti; parola/hash HICBIR zaman tasinmaz. */
export const sessionUserSchema = z.strictObject({
  id: idSchema,
  organizationId: idSchema,
  email: emailSchema,
  displayName: z.string().min(1).max(200).regex(/\S/),
  roles: z.array(roleCodeSchema).max(ROLE_CODES.length),
})
export type SessionUser = z.infer<typeof sessionUserSchema>

/** Login ve `GET /api/v1/auth/session` basari govdesi. */
export const sessionResponseSchema = z.strictObject({
  user: sessionUserSchema,
  expiresAt: utcDateTimeSchema,
})
export type SessionResponse = z.infer<typeof sessionResponseSchema>
