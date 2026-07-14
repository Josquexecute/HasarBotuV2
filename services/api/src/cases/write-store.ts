import { createHash } from 'node:crypto'
import type pg from 'pg'
import type { CaseCreateRequest, CaseUpdateRequest, CaseListItem } from '@hasarbotu/contracts'
import { parsePlateNumber, plateSearchKey } from '@hasarbotu/domain'
import { uuidv7 } from '@hasarbotu/database'
import { rowToDto, SELECT_FIELDS, toLocalDateString, type CaseRow } from './store.js'
import { createAuditService } from '../audit/service.js'

/**
 * Cases yazma katmani (Paket 09) — kritik islem modeli:
 * dogrula -> tek transaction icinde uygula (ofis numarasi + kayit + audit +
 * idempotency) -> dogrulanmis DTO dondur. Ofis numarasi firma+yil sayacindan
 * atanir ve ASLA yeniden dagitilmaz; basarisiz transaction sayaci tuketmez.
 */

export class ReferenceCheckError extends Error {
  readonly field: string
  readonly code: string

  constructor(field: string, code = 'unknown_reference') {
    super(`invalid input: ${field}`)
    this.name = 'ReferenceCheckError'
    this.field = field
    this.code = code
  }
}

export type UpdateOutcome =
  | { readonly kind: 'ok'; readonly item: CaseListItem }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'version_conflict' }

export interface IdempotentRecord {
  readonly requestHash: string
  readonly responseStatus: number
  readonly responseBody: unknown
}

export function hashRequestBody(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex')
}

interface ActorContext {
  readonly organizationId: string
  readonly actorUserId: string
  readonly requestId: string
}

const REFERENCE_CHECKS: readonly { field: string; sql: string }[] = [
  { field: 'responsibleUserId', sql: "SELECT status = 'active' AS allowed FROM users WHERE id::text = $1 AND organization_id = $2" },
  {
    field: 'expertUserId',
    sql: `SELECT u.status = 'active' AND EXISTS (
      SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = u.id AND r.code = 'expert'
    ) AS allowed FROM users u WHERE u.id::text = $1 AND u.organization_id = $2`,
  },
  { field: 'serviceId', sql: 'SELECT is_active AS allowed FROM service_centers WHERE id::text = $1 AND organization_id = $2' },
  { field: 'insurerId', sql: 'SELECT is_active AS allowed FROM insurers WHERE id::text = $1 AND organization_id = $2' },
]

async function assertReferences(
  client: pg.PoolClient,
  organizationId: string,
  input: Readonly<Record<string, unknown>>,
): Promise<void> {
  for (const check of REFERENCE_CHECKS) {
    const value = input[check.field]
    if (typeof value !== 'string') continue
    const result = await client.query(check.sql, [value, organizationId])
    if (result.rowCount === 0) throw new ReferenceCheckError(check.field)
    if ((result.rows[0] as { allowed: boolean }).allowed !== true) {
      throw new ReferenceCheckError(check.field, 'inactive_or_ineligible_reference')
    }
  }
}

function assertDateOrder(lossDate: string | null | undefined, notificationDate: string | null | undefined): void {
  if (lossDate !== null && lossDate !== undefined && notificationDate !== null && notificationDate !== undefined && notificationDate < lossDate) {
    throw new ReferenceCheckError('notificationDate', 'notification_before_loss_date')
  }
}

export function createCasesWriteStore(pool: pg.Pool) {
  const audit = createAuditService()
  return {
    async findIdempotent(
      organizationId: string,
      scope: string,
      key: string,
    ): Promise<IdempotentRecord | undefined> {
      const result = await pool.query(
        'SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE organization_id = $1 AND scope = $2 AND idem_key = $3',
        [organizationId, scope, key],
      )
      const row = result.rows[0] as
        | { request_hash: string; response_status: number; response_body: unknown }
        | undefined
      if (row === undefined) return undefined
      return {
        requestHash: row.request_hash,
        responseStatus: row.response_status,
        responseBody: row.response_body,
      }
    },

    /**
     * Dosya olusturma: referans kontrolu, ofis numarasi atamasi, kayit, audit
     * ve idempotency kaydi TEK transaction icindedir. Idempotency yarisinda
     * (ayni anahtar es zamanli) unique ihlali yakalanir ve `null` doner;
     * cagiran saklanan yaniti yeniden okur.
     */
    async createCase(
      actor: ActorContext,
      input: CaseCreateRequest,
      idempotency: { scope: string; key: string; requestHash: string; buildResponse: (item: CaseListItem) => unknown },
    ): Promise<CaseListItem | null> {
      const plateResult = parsePlateNumber(input.plate)
      if (!plateResult.ok) throw new ReferenceCheckError('plate')
      const plate = plateResult.value
      const normalized = plateSearchKey(plate)
      const year = new Date().getFullYear()
      const caseId = uuidv7()
      assertDateOrder(input.lossDate, input.notificationDate)

      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await assertReferences(client, actor.organizationId, input)

        const counter = await client.query(
          `INSERT INTO office_counters (organization_id, office_year, last_sequence)
           VALUES ($1, $2, 1)
           ON CONFLICT (organization_id, office_year)
           DO UPDATE SET last_sequence = office_counters.last_sequence + 1
           RETURNING last_sequence`,
          [actor.organizationId, year],
        )
        const sequence = (counter.rows[0] as { last_sequence: number }).last_sequence
        const officeNumber = `${year}/${sequence}`

        await client.query(
          `INSERT INTO cases (id, organization_id, office_year, office_sequence, office_number,
             case_type, workflow_stage, notification_form_number, insurer_claim_number,
             plate, plate_normalized, responsible_user_id, expert_user_id, service_center_id, insurer_id,
             follow_up_date, loss_date, notification_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
          [
            caseId,
            actor.organizationId,
            year,
            sequence,
            officeNumber,
            input.caseType,
            input.workflowStage,
            input.notificationFormNumber ?? null,
            input.insurerClaimNumber ?? null,
            plate,
            normalized,
            input.responsibleUserId ?? null,
            input.expertUserId ?? null,
            input.serviceId ?? null,
            input.insurerId ?? null,
            input.followUpDate ?? null,
            input.lossDate ?? null,
            input.notificationDate ?? null,
          ],
        )

        const row = await client.query(`SELECT ${SELECT_FIELDS} FROM cases WHERE id = $1`, [caseId])
        const item = rowToDto(row.rows[0] as CaseRow)

        await audit.record(client, {
          organizationId: actor.organizationId,
          actorUserId: actor.actorUserId,
          requestId: actor.requestId,
          action: 'case.created',
          entityType: 'case',
          entityId: caseId,
          details: {
            officeCaseNumber: officeNumber,
            caseType: input.caseType,
            assignedReferenceFields: ['responsibleUserId', 'expertUserId', 'serviceId', 'insurerId'].filter(
              (field) => (input as Record<string, unknown>)[field] !== undefined,
            ),
            dateFieldsPresent: ['followUpDate', 'lossDate', 'notificationDate'].filter(
              (field) => (input as Record<string, unknown>)[field] !== undefined,
            ),
          },
        })
        await client.query(
          `INSERT INTO idempotency_keys (id, organization_id, scope, idem_key, request_hash, response_status, response_body, case_id)
           VALUES ($1, $2, $3, $4, $5, 201, $6::jsonb, $7)`,
          [
            uuidv7(),
            actor.organizationId,
            idempotency.scope,
            idempotency.key,
            idempotency.requestHash,
            JSON.stringify(idempotency.buildResponse(item)),
            caseId,
          ],
        )
        await client.query('COMMIT')
        return item
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        const pgError = error as { code?: string; constraint?: string }
        if (pgError.code === '23505' && pgError.constraint === 'idempotency_keys_unique') {
          // Es zamanli ayni anahtar: transaction geri alindi, sayac tuketilmedi.
          return null
        }
        throw error
      } finally {
        client.release()
      }
    },

    /** Optimistic locking ile guvenli alan guncellemesi (PATCH semantigi). */
    async updateCase(
      actor: ActorContext,
      caseId: string,
      input: CaseUpdateRequest,
    ): Promise<UpdateOutcome> {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const current = await client.query(
          `SELECT version, loss_date, notification_date FROM cases WHERE id::text = $1 AND organization_id = $2 FOR UPDATE`,
          [caseId, actor.organizationId],
        )
        const existing = current.rows[0] as { version: number; loss_date: Date | null; notification_date: Date | null } | undefined
        if (existing === undefined) {
          await client.query('ROLLBACK')
          return { kind: 'not_found' }
        }
        if (existing.version !== input.expectedVersion) {
          await client.query('ROLLBACK')
          return { kind: 'version_conflict' }
        }

        await assertReferences(client, actor.organizationId, input)
        const currentLossDate = existing.loss_date === null ? null : toLocalDateString(existing.loss_date)
        const currentNotificationDate = existing.notification_date === null ? null : toLocalDateString(existing.notification_date)
        assertDateOrder(
          input.lossDate === undefined ? currentLossDate : input.lossDate,
          input.notificationDate === undefined ? currentNotificationDate : input.notificationDate,
        )

        const columnByField: Record<string, string> = {
          workflowStage: 'workflow_stage',
          followUpDate: 'follow_up_date',
          notificationFormNumber: 'notification_form_number',
          insurerClaimNumber: 'insurer_claim_number',
          responsibleUserId: 'responsible_user_id',
          expertUserId: 'expert_user_id',
          serviceId: 'service_center_id',
          insurerId: 'insurer_id',
          lossDate: 'loss_date',
          notificationDate: 'notification_date',
        }
        const sets: string[] = []
        const params: unknown[] = []
        const changedFields: string[] = []
        for (const [field, column] of Object.entries(columnByField)) {
          const value = (input as Record<string, unknown>)[field]
          if (value === undefined) continue
          params.push(value)
          sets.push(`${column} = $${params.length}`)
          changedFields.push(field)
        }
        params.push(caseId, actor.organizationId)
        const updated = await client.query(
          `UPDATE cases SET ${sets.join(', ')}, version = version + 1, updated_at = now()
           WHERE id::text = $${params.length - 1} AND organization_id = $${params.length}
           RETURNING ${SELECT_FIELDS}`,
          params,
        )
        const item = rowToDto(updated.rows[0] as CaseRow)

        await audit.record(client, {
          organizationId: actor.organizationId,
          actorUserId: actor.actorUserId,
          requestId: actor.requestId,
          action: 'case.updated',
          entityType: 'case',
          entityId: item.id,
          details: { changedFields, fromVersion: input.expectedVersion, toVersion: item.version },
        })
        await client.query('COMMIT')
        return { kind: 'ok', item }
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
    },
  }
}

export type CasesWriteStore = ReturnType<typeof createCasesWriteStore>
