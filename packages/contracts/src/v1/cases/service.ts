import { z } from 'zod'

export const caseServiceContactInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(500),
  phone: z.string().trim().max(80).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
})
export const caseServiceContactSchema = caseServiceContactInputSchema.extend({
  phone: z.string().nullable(),
  address: z.string().nullable(),
})
export type CaseServiceContactInput = z.infer<typeof caseServiceContactInputSchema>
export type CaseServiceContact = z.infer<typeof caseServiceContactSchema>
