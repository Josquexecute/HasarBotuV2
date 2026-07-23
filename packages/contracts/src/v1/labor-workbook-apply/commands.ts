import { z } from 'zod'
import { idSchema, relativePathSchema } from '../../common/primitives.js'
import { sha256HexSchema } from '../documents/dto.js'

const signatureExpectationSchema = z.strictObject({
  cell: z.string().regex(/^[A-Z]{1,3}[1-9]\d{0,6}$/),
  text: z.string().trim().min(1).max(240),
})

export const laborWorkbookApplyPreviewRequestSchema = z.strictObject({
  applicationId: idSchema,
  profileId: idSchema,
  workbookRelativePath: relativePathSchema.refine(
    (value) => value.toLocaleLowerCase('en-US').endsWith('.xlsx'),
    { error: 'xlsx_required' },
  ),
  expectedSourceSha256: sha256HexSchema.nullable().default(null),
  headers: z.array(signatureExpectationSchema).min(1).max(20),
  identityCellReferences: z.strictObject({
    plateCell: z.string().regex(/^[A-Z]{1,3}[1-9]\d{0,6}$/).nullable(),
    officeNumberCell: z.string().regex(/^[A-Z]{1,3}[1-9]\d{0,6}$/).nullable(),
  }),
  sourceRows: z.array(z.strictObject({
    lineOrdinal: z.number().int().min(1).max(5_000),
    rowNumber: z.number().int().min(2).max(1_048_576),
  })).min(1).max(5_000),
})

export const laborWorkbookApplyApproveRequestSchema = z.strictObject({
  expectedVersion: z.number().int().min(1),
  planHash: sha256HexSchema,
  approvedRevisionSnapshotHash: sha256HexSchema,
  confirmed: z.literal(true),
})

export type LaborWorkbookApplyPreviewRequest =
  z.infer<typeof laborWorkbookApplyPreviewRequestSchema>
export type LaborWorkbookApplyApproveRequest =
  z.infer<typeof laborWorkbookApplyApproveRequestSchema>
