import { z } from 'zod'
import { insurerIdSchema, serviceIdSchema, userIdSchema } from '../../common/primitives.js'
import {
  SERVICE_AGREEMENT_EVALUATION_VERSION,
  SERVICE_ELIGIBILITY_STATUSES,
  SERVICE_SUPPORTED_OPERATIONS,
  SERVICE_TYPES,
} from '@hasarbotu/domain'

const referenceNameSchema = z.string().trim().min(1).max(200)

export const insurerReferenceSchema = z.strictObject({
  id: insurerIdSchema,
  name: referenceNameSchema,
})
export type InsurerReference = z.infer<typeof insurerReferenceSchema>

export const serviceAgreementEvaluationSchema = z.strictObject({
  status: z.enum(SERVICE_ELIGIBILITY_STATUSES),
  agreementStatus: z.enum(['agreed', 'not_agreed', 'control_required']),
  serviceType: z.enum(SERVICE_TYPES),
  operation: z.enum(SERVICE_SUPPORTED_OPERATIONS),
  evaluationDate: z.string().date().nullable(),
  dateSource: z.enum(['loss_date', 'policy_date']),
  isAuthorized: z.boolean(),
  isInsurerAgreed: z.boolean().nullable(),
  reason: z.string().min(1).max(500),
  ruleVersion: z.literal(SERVICE_AGREEMENT_EVALUATION_VERSION),
  matchedAgreementIds: z.array(z.string().uuid()),
  requiresHumanReview: z.boolean(),
})
export type ServiceAgreementEvaluation = z.infer<typeof serviceAgreementEvaluationSchema>

export const serviceReferenceSchema = z.strictObject({
  id: serviceIdSchema,
  name: referenceNameSchema,
  serviceType: z.enum(SERVICE_TYPES),
  isActive: z.boolean(),
  agreement: serviceAgreementEvaluationSchema,
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
