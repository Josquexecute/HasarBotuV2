import { createHash } from 'node:crypto'
import { uuidv7 } from '@hasarbotu/database'
import type { Queryable } from './executor.js'

/**
 * Idempotency yardımcı (Paket 09 `idempotency_keys` tablosu üzerinde). Kritik
 * POST komutları aynı `Idempotency-Key` ile tekrar edildiğinde saklanan yanıt
 * aynen döner; farklı gövdeyle gelirse çağıran 409 üretir. Kayıt, iş yazımıyla
 * AYNI transaction'da yazılır (eşzamanlı yarışta unique ihlali → geri alma).
 */
export const IDEMPOTENCY_UNIQUE_CONSTRAINT = 'idempotency_keys_unique'

export interface IdempotentRecord {
  readonly requestHash: string
  readonly responseStatus: number
  readonly responseBody: unknown
}

export function hashRequestBody(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex')
}

export async function findIdempotent(
  exec: Queryable,
  organizationId: string,
  scope: string,
  key: string,
): Promise<IdempotentRecord | undefined> {
  const result = await exec.query(
    'SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE organization_id = $1 AND scope = $2 AND idem_key = $3',
    [organizationId, scope, key],
  )
  const row = result.rows[0] as
    | { request_hash: string; response_status: number; response_body: unknown }
    | undefined
  if (row === undefined) return undefined
  return { requestHash: row.request_hash, responseStatus: row.response_status, responseBody: row.response_body }
}

export async function insertIdempotent(
  exec: Queryable,
  input: {
    organizationId: string
    scope: string
    key: string
    requestHash: string
    responseStatus: number
    responseBody: unknown
    caseId?: string | null
  },
): Promise<void> {
  await exec.query(
    `INSERT INTO idempotency_keys
       (id, organization_id, scope, idem_key, request_hash, response_status, response_body, case_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
    [
      uuidv7(),
      input.organizationId,
      input.scope,
      input.key,
      input.requestHash,
      input.responseStatus,
      JSON.stringify(input.responseBody),
      input.caseId ?? null,
    ],
  )
}

/** pg unique-violation mu (idempotency anahtarı yarışı)? */
export function isIdempotencyRace(error: unknown): boolean {
  const pgError = error as { code?: string; constraint?: string }
  return pgError.code === '23505' && pgError.constraint === IDEMPOTENCY_UNIQUE_CONSTRAINT
}
