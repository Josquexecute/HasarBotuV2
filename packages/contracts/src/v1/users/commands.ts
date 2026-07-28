import { z } from 'zod'
import { roleCodeSchema, ROLE_CODES } from '../auth/index.js'
import { entityVersionSchema, idSchema } from '../../common/primitives.js'

export const userRolesUpdateRequestSchema = z.strictObject({
  roles: z.array(roleCodeSchema).min(1).max(ROLE_CODES.length),
  expectedVersion: entityVersionSchema,
})
export type UserRolesUpdateRequest = z.infer<typeof userRolesUpdateRequestSchema>

export const userParamsSchema = z.strictObject({
  userId: idSchema,
})
export type UserParams = z.infer<typeof userParamsSchema>
