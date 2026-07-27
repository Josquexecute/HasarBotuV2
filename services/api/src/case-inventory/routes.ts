import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  CASE_INVENTORY_EXPORT_ROUTE,
  CASE_INVENTORY_MAX_ROWS,
  CASE_INVENTORY_PREVIEW_ROUTE,
  caseInventoryPreviewResponseSchema,
  caseInventoryQuerySchema,
  failureEnvelopeSchema,
  zodErrorToApiError,
  type RoleCode,
} from '@hasarbotu/contracts'
import { CASE_INVENTORY_COLUMNS, buildInventoryExportFilename } from '@hasarbotu/domain'
import { createAuthStore } from '../auth/store.js'
import { requireSession } from '../auth/guard.js'
import { createAuditService } from '../audit/service.js'
import type { Clock } from '../clock.js'
import { createCaseInventoryStore } from './store.js'
import { buildInventoryXlsx } from './xlsx-writer.js'

export interface CaseInventoryRoutesOptions {
  readonly pool: pg.Pool
  readonly clock: Clock
}

/** Telefon (servis + araç sahibi) yalnız dosya düzenleme yetkisi olan rollere üretilir. */
const PHONE_ROLES = ['admin', 'expert', 'case_manager'] as const satisfies readonly RoleCode[]

function includesPhonesFor(roles: readonly RoleCode[]): boolean {
  return roles.some((role) => (PHONE_ROLES as readonly string[]).includes(role))
}

export function registerCaseInventoryRoutes(
  app: FastifyInstance,
  options: CaseInventoryRoutesOptions,
): void {
  const auth = createAuthStore(options.pool)
  const store = createCaseInventoryStore(options.pool)
  const audit = createAuditService()

  app.get(CASE_INVENTORY_PREVIEW_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(auth, request, reply)
    if (session === undefined) return
    const query = caseInventoryQuerySchema.safeParse(request.query)
    if (!query.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({
        ok: false, error: zodErrorToApiError(query.error, requestId),
      }))
    }
    const totalCount = await store.count(session.user.organizationId, query.data)
    return caseInventoryPreviewResponseSchema.parse({
      totalCount,
      maxRows: CASE_INVENTORY_MAX_ROWS,
      truncated: totalCount > CASE_INVENTORY_MAX_ROWS,
      includesPhones: includesPhonesFor(session.user.roles),
    })
  })

  app.get(CASE_INVENTORY_EXPORT_ROUTE, async (request, reply) => {
    const requestId = String(request.id)
    const session = await requireSession(auth, request, reply)
    if (session === undefined) return
    const query = caseInventoryQuerySchema.safeParse(request.query)
    if (!query.success) {
      return reply.code(400).send(failureEnvelopeSchema.parse({
        ok: false, error: zodErrorToApiError(query.error, requestId),
      }))
    }
    const includePhones = includesPhonesFor(session.user.roles)
    const cellRows = await store.rows(session.user.organizationId, query.data, includePhones)
    const rows = cellRows.map((cells) => {
      const record: Record<string, string> = {}
      for (const column of CASE_INVENTORY_COLUMNS) record[column.key] = cells[column.key]?.value ?? ''
      return record
    })
    const bytes = buildInventoryXlsx({
      columns: CASE_INVENTORY_COLUMNS,
      rows,
      sheetName: 'Dosya Envanteri',
    })
    const filename = buildInventoryExportFilename({
      dateIso: options.clock.nowUtcIso(),
      userLabel: session.user.displayName,
    })
    await audit.record(options.pool, {
      organizationId: session.user.organizationId,
      actorUserId: session.user.id,
      requestId,
      action: 'case_inventory.exported',
      entityType: 'case_inventory_export',
      entityId: requestId,
      details: {
        rowCount: rows.length,
        includesPhones: includePhones,
        caseType: query.data.caseType ?? null,
        status: query.data.status ?? null,
      },
    })
    return reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .send(Buffer.from(bytes))
  })
}
