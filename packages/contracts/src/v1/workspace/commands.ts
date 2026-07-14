import { z } from 'zod'
import { storageRootKeySchema } from '../../common/primitives.js'

export const workspacePlanRequestSchema = z.strictObject({
  storageRootKey: storageRootKeySchema,
})
export type WorkspacePlanRequest = z.infer<typeof workspacePlanRequestSchema>

/** Açık kullanıcı onayı gövdede de kararlı `approved:true` olarak kanıtlanır. */
export const workspaceApproveRequestSchema = z.strictObject({ approved: z.literal(true) })
export type WorkspaceApproveRequest = z.infer<typeof workspaceApproveRequestSchema>
