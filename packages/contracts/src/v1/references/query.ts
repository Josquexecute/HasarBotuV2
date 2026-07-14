import { z } from 'zod'
import { SERVICE_SUPPORTED_OPERATIONS } from '@hasarbotu/domain'
import { insurerIdSchema, localDateSchema } from '../../common/primitives.js'

export const servicesReferenceQuerySchema = z.strictObject({
  insurerId: insurerIdSchema.optional(),
  evaluationDate: localDateSchema.optional(),
  dateSource: z.enum(['loss_date', 'policy_date']).default('loss_date'),
  operation: z.enum(SERVICE_SUPPORTED_OPERATIONS).default('closure_documents'),
})

export type ServicesReferenceQuery = z.infer<typeof servicesReferenceQuerySchema>
export type ServicesReferenceQueryInput = z.input<typeof servicesReferenceQuerySchema>
