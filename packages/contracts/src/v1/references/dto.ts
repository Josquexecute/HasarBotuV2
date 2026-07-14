import { z } from 'zod'
import { insurerIdSchema, serviceIdSchema, userIdSchema } from '../../common/primitives.js'

const referenceNameSchema = z.string().trim().min(1).max(200)

export const insurerReferenceSchema = z.strictObject({
  id: insurerIdSchema,
  name: referenceNameSchema,
})
export type InsurerReference = z.infer<typeof insurerReferenceSchema>

export const serviceReferenceSchema = z.strictObject({
  id: serviceIdSchema,
  name: referenceNameSchema,
  centerType: z.enum(['yetkili', 'ozel']),
})
export type ServiceReference = z.infer<typeof serviceReferenceSchema>

export const userReferenceSchema = z.strictObject({
  id: userIdSchema,
  displayName: referenceNameSchema,
})
export type UserReference = z.infer<typeof userReferenceSchema>

export const insurersReferenceResponseSchema = z.strictObject({ items: z.array(insurerReferenceSchema) })
export const servicesReferenceResponseSchema = z.strictObject({ items: z.array(serviceReferenceSchema) })
export const usersReferenceResponseSchema = z.strictObject({ items: z.array(userReferenceSchema) })
export const expertsReferenceResponseSchema = z.strictObject({ items: z.array(userReferenceSchema) })

export type InsurersReferenceResponse = z.infer<typeof insurersReferenceResponseSchema>
export type ServicesReferenceResponse = z.infer<typeof servicesReferenceResponseSchema>
export type UsersReferenceResponse = z.infer<typeof usersReferenceResponseSchema>
export type ExpertsReferenceResponse = z.infer<typeof expertsReferenceResponseSchema>
