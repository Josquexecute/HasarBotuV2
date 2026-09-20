import { z } from 'zod'
import { idSchema, localDateSchema } from '../common/primitives.js'

/** Source identities are distinct from application login accounts and VIN prefixes. */
export const eksistCaseDataSchema = z.strictObject({
  sourceId: idSchema,
  assignmentDate: localDateSchema,
  assignmentDateText: z.string().min(1).max(120),
  insurerName: z.string().min(1).max(500),
  expertName: z.string().min(1).max(500),
  expertLicenseNumber: z.string().max(500),
  corporateExpertLicenseNumber: z.string().max(500),
  serviceName: z.string().max(500),
  serviceRevised: z.boolean(),
  vehicleFields: z.record(z.string(), z.string()),
})
export type EksistCaseData = z.infer<typeof eksistCaseDataSchema>
