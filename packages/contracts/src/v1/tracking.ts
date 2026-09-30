import { z } from 'zod'

export const applicationNumberSchema = z.string().regex(/^[0-9]{1,128}$/)
export const tramerStatusSchema = z.enum(['entry_pending', 'result_pending', 'completed', 'cancelled'])
export const tramerCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('assign'), assignedUserId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('number'), applicationNumber: applicationNumberSchema, expectedVersion: z.number().int().positive() }).strict(),
  z.object({ action: z.literal('cancel'), reason: z.string().trim().min(1).max(2000), expectedVersion: z.number().int().positive() }).strict(),
])
export type TramerCommand = z.infer<typeof tramerCommandSchema>
export const trackingFileSchema = z.object({
  caseId: z.string().uuid(), locationVersion: z.number().int().positive(),
  storageRootKey: z.string().min(1).max(64),
  relativePath: z.string().min(1).max(2000).refine((p) => !/[:\\<>"|?*]/.test(p) && ![...p].some((c) => c.charCodeAt(0) < 32) && !p.startsWith('/') && !p.split('/').some((s) => s === '..' || s === '.' || s === '')),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/), byteSize: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict()
export type TrackingFile = z.infer<typeof trackingFileSchema>
export const trackingLocationsSchema = z.object({ locations: z.array(z.object({
  caseId: z.string().uuid(), storageRootKey: z.string(), relativePath: z.string(), version: z.number().int(), scanStartedAt: z.string().datetime(),
})), nextCursor: z.string().nullable() })
export const trackingSnapshotSchema = z.object({
  tramer: z.array(z.object({ id: z.string(), caseId: z.string(), plate: z.string(), officeNumber: z.string(), assignedUserId: z.string(), assignedName: z.string(), applicationNumber: z.string().nullable(), status: tramerStatusSchema, resultText: z.string().nullable(), version: z.number(), canEdit: z.boolean() })),
  documents: z.array(z.object({ id: z.string(), caseId: z.string(), plate: z.string(), officeNumber: z.string(), fileName: z.string(), relativePath: z.string(), status: z.enum(['pending','approved','rejected']), documentType: z.string().nullable(), observedAt: z.string(), canReview: z.boolean() })),
  notifications: z.array(z.object({ id: z.string(), caseId: z.string(), plate: z.string(), officeNumber: z.string(), title: z.string(), kind: z.enum(['document','tramer']), readAt: z.string().nullable(), presentedAt: z.string().nullable(), createdAt: z.string() })),
  mailConnections: z.array(z.object({ id: z.string(), email: z.string(), status: z.enum(['connected','disconnected','permission_required','error']), lastSuccessAt: z.string().nullable(), lastError: z.string().nullable() })),
  reviews: z.array(z.object({ id: z.string(), applicationNumber: z.string().nullable(), resultText: z.string().nullable(), reason: z.string(), email: z.string(), receivedAt: z.string() })),
  users: z.array(z.object({ id: z.string(), displayName: z.string() })),
  history: z.array(z.object({ id: z.string(), action: z.string(), actor: z.string().nullable(), occurredAt: z.string(), details: z.record(z.string(), z.unknown()) })),
  canManage: z.boolean(), googleEnabled: z.boolean(), automaticSbmEnabled: z.boolean(),
  services: z.array(z.object({ kind: z.enum(['folder','mail']), status: z.enum(['running','error','stale']), lastAttemptAt: z.string(), lastSuccessAt: z.string().nullable() })),
})
export type TrackingSnapshot = z.infer<typeof trackingSnapshotSchema>
export const trackingPendingNotificationsSchema = z.object({ notifications: z.array(z.object({ id: z.string(),caseId: z.string(),plate: z.string(),title: z.string() })) })
