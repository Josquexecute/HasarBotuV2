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
