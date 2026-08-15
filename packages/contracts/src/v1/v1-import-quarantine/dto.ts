import { z } from 'zod'
import {
  caseIdSchema,
  caseStatusSchema,
  caseTypeSchema,
  idSchema,
  officeCaseNumberSchema,
  relativePathSchema,
  utcDateTimeSchema,
} from '../../common/primitives.js'
import { pageInfoSchema } from '../../common/pagination.js'
import { v1ImportQuarantineReasonSchema, v1ImportQuarantineStatusSchema } from './query.js'

const safeCodeSchema = z.string().min(1).max(96).regex(/^[a-z0-9_]+$/)
const sourceTokenSchema = z.string().regex(/^[0-9a-f]{16}$/)

export const v1ImportQuarantineCandidateSchema = z.strictObject({
  caseId: caseIdSchema,
  caseType: caseTypeSchema,
  officeCaseNumber: officeCaseNumberSchema,
  lifecycleStatus: caseStatusSchema,
  createdAt: utcDateTimeSchema,
})

export const v1ImportQuarantineEvidenceSummarySchema = z.strictObject({
  detectedCaseType: caseTypeSchema.nullable(),
  resolutionReason: safeCodeSchema.nullable(),
  sidecarConflictPreserved: z.boolean(),
  evidenceCount: z.number().int().min(0).max(100),
  evidenceKinds: z.array(safeCodeSchema).max(20),
})

export const v1ImportQuarantineResolutionSchema = z.strictObject({
  targetCaseId: caseIdSchema,
  resolvedCaseType: caseTypeSchema,
  resolutionKind: z.enum(['deterministic_replan', 'explicit_reconciliation']),
  resolvedAt: utcDateTimeSchema,
})

export const v1ImportQuarantineSchema = z.strictObject({
  id: idSchema,
  sourceToken: sourceTokenSchema,
  sourceRelativePath: relativePathSchema,
  reason: v1ImportQuarantineReasonSchema,
  reasonCode: safeCodeSchema,
  status: v1ImportQuarantineStatusSchema,
  mappingVersion: z.string().regex(/^v1-remediation\/[0-9]+[.][0-9]+[.][0-9]+$/),
  evidenceSummary: v1ImportQuarantineEvidenceSummarySchema,
  candidateCount: z.number().int().min(0).max(100),
  candidateTargets: z.array(v1ImportQuarantineCandidateSchema).max(100),
  createdAt: utcDateTimeSchema,
  resolution: v1ImportQuarantineResolutionSchema.nullable(),
})

export const v1ImportQuarantinesResponseSchema = z.strictObject({
  items: z.array(v1ImportQuarantineSchema),
  pageInfo: pageInfoSchema,
})

export type V1ImportQuarantineCandidate = z.infer<typeof v1ImportQuarantineCandidateSchema>
export type V1ImportQuarantineEvidenceSummary = z.infer<typeof v1ImportQuarantineEvidenceSummarySchema>
export type V1ImportQuarantineResolution = z.infer<typeof v1ImportQuarantineResolutionSchema>
export type V1ImportQuarantine = z.infer<typeof v1ImportQuarantineSchema>
export type V1ImportQuarantinesResponse = z.infer<typeof v1ImportQuarantinesResponseSchema>
