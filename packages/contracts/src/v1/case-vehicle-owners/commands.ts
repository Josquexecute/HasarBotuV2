import { z } from 'zod'
import { MAX_CASE_VEHICLE_OWNERS } from '@hasarbotu/domain'
import { entityVersionSchema } from '../../common/primitives.js'
import { caseVehicleOwnerSchema } from './dto.js'

export const caseVehicleOwnersSaveRequestSchema = z.strictObject({
  owners: z.array(caseVehicleOwnerSchema).max(MAX_CASE_VEHICLE_OWNERS),
  /** İlk kayıtta `null`; sonrasında beklenen mevcut `setVersion`. */
  expectedSetVersion: entityVersionSchema.nullable(),
  confirmed: z.literal(true),
})

export type CaseVehicleOwnersSaveRequest = z.infer<typeof caseVehicleOwnersSaveRequestSchema>
