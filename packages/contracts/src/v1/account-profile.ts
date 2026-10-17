import { z } from 'zod'
import { entityVersionSchema, idSchema } from '../common/primitives.js'

export const ACCOUNT_PROFILE_ROUTE = '/api/v1/me/profile' as const
// Existing dashboard, note and fee DTOs accept user names up to 160 characters.
export const accountDisplayNameSchema = z.string().trim().min(1).max(160)
  .refine(value => ![...value].some(character => { const code = character.codePointAt(0)!; return code < 32 || code >= 127 && code <= 159 }), 'invalid_display_name')
  .transform(value => value.replace(/\s+/gu, ' '))
export const accountProfileSchema = z.strictObject({
  userId: idSchema,
  displayName: z.string().min(1).max(200),
  version: entityVersionSchema,
})
export type AccountProfile = z.infer<typeof accountProfileSchema>
export const accountProfileUpdateSchema = z.strictObject({
  expectedUserId: idSchema,
  expectedVersion: entityVersionSchema,
  displayName: accountDisplayNameSchema,
})
export const adminProfileUpdateSchema = accountProfileUpdateSchema.omit({ expectedUserId: true })
