import { uuidv7 } from '@hasarbotu/database'
import type { Queryable } from '../db/executor.js'
import { redactValue } from './redact.js'

/**
 * Merkezi AuditService (Paket 11). TEK audit yazma yolu; mevcut `audit_events`
 * tablosunu (0002) kullanir, paralel bir sistem kurmaz. `record` bir executor
 * (havuz veya transaction istemcisi) alir; boylece audit kaydi ilgili is
 * transaction'iyla ATOMIK yazilabilir. `details` yazilmadan once redaksiyondan
 * gecer: parola/token/cerez/tam poliçe metni/gereksiz PII audit'e sizmaz.
 */
export interface AuditEventInput {
  readonly organizationId?: string | undefined
  readonly actorUserId?: string | undefined
  readonly action: string
  readonly entityType?: string | undefined
  readonly entityId?: string | undefined
  readonly requestId?: string | undefined
  readonly details?: unknown
}

export function createAuditService() {
  return {
    /** Tek append-only audit kaydi yazar. INSERT disinda islem yapmaz. */
    async record(exec: Queryable, event: AuditEventInput): Promise<void> {
      await exec.query(
        `INSERT INTO audit_events
           (id, organization_id, actor_user_id, action, resource_type, resource_id, request_id, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [
          uuidv7(),
          event.organizationId ?? null,
          event.actorUserId ?? null,
          event.action,
          event.entityType ?? null,
          event.entityId ?? null,
          event.requestId ?? null,
          JSON.stringify(redactValue(event.details ?? {})),
        ],
      )
    },
  }
}

export type AuditService = ReturnType<typeof createAuditService>
