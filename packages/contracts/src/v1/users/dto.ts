import { z } from 'zod'
import { emailSchema, roleCodeSchema, ROLE_CODES } from '../auth/index.js'
import { entityVersionSchema, idSchema } from '../../common/primitives.js'

export const userStatusSchema = z.enum(['active', 'disabled'])

export const userSummarySchema = z.strictObject({
  id: idSchema,
  email: emailSchema,
  displayName: z.string().min(1).max(200),
  status: userStatusSchema,
  roles: z.array(roleCodeSchema).max(ROLE_CODES.length),
  version: entityVersionSchema,
})
export type UserSummary = z.infer<typeof userSummarySchema>

export const usersResponseSchema = z.strictObject({
  items: z.array(userSummarySchema).max(5_000),
})
export type UsersResponse = z.infer<typeof usersResponseSchema>

export const userResponseSchema = z.strictObject({
  user: userSummarySchema,
})
export type UserResponse = z.infer<typeof userResponseSchema>
