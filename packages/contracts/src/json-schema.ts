import { z } from 'zod'
import { failureEnvelopeSchema } from './common/envelope.js'
import { healthResponseSchema } from './health/index.js'
import { loginRequestSchema, sessionResponseSchema } from './v1/auth/index.js'
import { casesQuerySchema } from './v1/cases/query.js'
import { caseCreateRequestSchema, caseUpdateRequestSchema } from './v1/cases/commands.js'
import {
  caseDetailParamsSchema,
  caseDetailResponseSchema,
  caseListResponseSchema,
} from './v1/cases/dto.js'
import { auditEventsQuerySchema } from './v1/audit/query.js'
import { auditEventsResponseSchema } from './v1/audit/dto.js'
import { caseLocationAssignRequestSchema } from './v1/storage/commands.js'
import {
  caseLocationHistoryResponseSchema,
  caseLocationResponseSchema,
  storageRootsResponseSchema,
} from './v1/storage/dto.js'
import { registerDocumentRequestSchema, registerPhotoRequestSchema } from './v1/documents/commands.js'
import {
  documentDetailResponseSchema,
  documentsListResponseSchema,
  photosListResponseSchema,
} from './v1/documents/dto.js'
import { jobResultRequestSchema } from './v1/agent/commands.js'
import { agentRegisterResponseSchema, claimResponseSchema } from './v1/agent/dto.js'
import { documentRequirementsParamsSchema, documentRequirementsResponseSchema } from './v1/document-requirements/dto.js'
import {
  expertsReferenceResponseSchema,
  insurersReferenceResponseSchema,
  servicesReferenceResponseSchema,
  usersReferenceResponseSchema,
} from './v1/references/dto.js'
import { servicesReferenceQuerySchema } from './v1/references/query.js'
import { workspacePlanRequestSchema } from './v1/workspace/commands.js'
import { workspaceProvisioningResponseSchema } from './v1/workspace/dto.js'
import { fileOperationPlanRequestSchema } from './v1/file-operations/commands.js'
import { fileOperationResponseSchema } from './v1/file-operations/dto.js'
import { closePlanRequestSchema, reopenPlanRequestSchema } from './v1/case-lifecycle/commands.js'
import { caseLifecycleOperationResponseSchema } from './v1/case-lifecycle/dto.js'

/**
 * JSON Schema uretim hedefleri. Zod 4 yerlesik `z.toJSONSchema` ile uretilir;
 * ek OpenAPI bagimliligi yoktur.
 */
export const JSON_SCHEMA_TARGETS = {
  'health-response': healthResponseSchema,
  'failure-envelope': failureEnvelopeSchema,
  'auth-login-request': loginRequestSchema,
  'auth-session-response': sessionResponseSchema,
  'cases-query': casesQuerySchema,
  'case-create-request': caseCreateRequestSchema,
  'case-update-request': caseUpdateRequestSchema,
  'cases-list-response': caseListResponseSchema,
  'case-detail-params': caseDetailParamsSchema,
  'case-detail-response': caseDetailResponseSchema,
  'audit-events-query': auditEventsQuerySchema,
  'audit-events-response': auditEventsResponseSchema,
  'storage-roots-response': storageRootsResponseSchema,
  'case-location-assign-request': caseLocationAssignRequestSchema,
  'case-location-response': caseLocationResponseSchema,
  'case-location-history-response': caseLocationHistoryResponseSchema,
  'document-register-request': registerDocumentRequestSchema,
  'photo-register-request': registerPhotoRequestSchema,
  'documents-list-response': documentsListResponseSchema,
  'document-detail-response': documentDetailResponseSchema,
  'photos-list-response': photosListResponseSchema,
  'job-claim-response': claimResponseSchema,
  'job-result-request': jobResultRequestSchema,
  'agent-register-response': agentRegisterResponseSchema,
  'document-requirements-response': documentRequirementsResponseSchema,
  'document-requirements-params': documentRequirementsParamsSchema,
  'reference-insurers-response': insurersReferenceResponseSchema,
  'reference-services-response': servicesReferenceResponseSchema,
  'reference-services-query': servicesReferenceQuerySchema,
  'reference-users-response': usersReferenceResponseSchema,
  'reference-experts-response': expertsReferenceResponseSchema,
  'workspace-plan-request': workspacePlanRequestSchema,
  'workspace-provisioning-response': workspaceProvisioningResponseSchema,
  'file-operation-plan-request': fileOperationPlanRequestSchema,
  'file-operation-response': fileOperationResponseSchema,
  'case-close-plan-request': closePlanRequestSchema,
  'case-reopen-plan-request': reopenPlanRequestSchema,
  'case-lifecycle-operation-response': caseLifecycleOperationResponseSchema,
} as const

export type JsonSchemaName = keyof typeof JSON_SCHEMA_TARGETS

/**
 * Butun hedef semalarin JSON Schema karsiligini deterministik (ada gore sirali)
 * uretir. Ayni girdi icin cikti her zaman ayni olur.
 */
export function buildJsonSchemas(): Record<JsonSchemaName, unknown> {
  const names = (Object.keys(JSON_SCHEMA_TARGETS) as JsonSchemaName[]).sort()
  const output = {} as Record<JsonSchemaName, unknown>
  for (const name of names) {
    output[name] = z.toJSONSchema(JSON_SCHEMA_TARGETS[name])
  }
  return output
}
