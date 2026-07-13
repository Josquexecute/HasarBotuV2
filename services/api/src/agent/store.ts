import type pg from 'pg'
import {
  agentSchema,
  claimedJobSchema,
  jobPayloadSchema,
  type Agent,
  type ClaimedJob,
  type JobResultRequest,
} from '@hasarbotu/contracts'
import { uuidv7 } from '@hasarbotu/database'
import { withTransaction } from '../db/executor.js'
import { createAuditService } from '../audit/service.js'
import { generateAgentSecret, hashAgentSecret } from './auth.js'

/**
 * File Agent kontrol katmanı veri erişimi (Paket 14). Agent kimliği + iş
 * kuyruğu. Claim `FOR UPDATE SKIP LOCKED` ile tektir. Sonuç bildirimi metadata
 * doğrulamasını, iş durumunu ve merkezi audit'i TEK transaction'da atomik yapar.
 * Yarışta eski metadata sürümü ÜZERİNE yazılmaz; `ready` yalnız gerçek dosyadan
 * gözlenen hash/size, BEYAN edilenle eşleşince oluşur.
 */
export const DEFAULT_LEASE_SECONDS = 120
const RETRY_BACKOFF_BASE_SECONDS = 30
const RETRY_BACKOFF_CAP_SECONDS = 3600

function backoffSeconds(attemptCount: number): number {
  return Math.min(RETRY_BACKOFF_BASE_SECONDS * 2 ** Math.max(0, attemptCount - 1), RETRY_BACKOFF_CAP_SECONDS)
}

interface AgentRow {
  id: string
  organization_id: string
  name: string
  status: 'active' | 'disabled'
  last_seen_at: Date | null
  created_at: Date
}
interface JobRow {
  id: string
  organization_id: string
  type: string
  status: string
  target_type: string
  target_id: string
  target_version: number
  payload: unknown
  attempt_count: number
  max_attempts: number
  leased_by_agent_id: string | null
  lease_expires_at: Date | null
}

function agentToDto(row: AgentRow): Agent {
  return agentSchema.parse({
    id: row.id,
    name: row.name,
    status: row.status,
    lastSeenAt: row.last_seen_at === null ? null : row.last_seen_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  })
}
const AGENT_FIELDS = 'id, organization_id, name, status, last_seen_at, created_at'
const JOB_FIELDS =
  'id, organization_id, type, status, target_type, target_id, target_version, payload, attempt_count, max_attempts, leased_by_agent_id, lease_expires_at'

function claimedJobToDto(row: JobRow): ClaimedJob {
  return claimedJobSchema.parse({
    id: row.id,
    type: row.type,
    targetType: row.target_type,
    targetId: row.target_id,
    targetVersion: row.target_version,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    leaseExpiresAt: (row.lease_expires_at as Date).toISOString(),
    payload: jobPayloadSchema.parse(row.payload),
  })
}

export type ReportOutcome =
  | { readonly kind: 'ok'; readonly status: string; readonly lastErrorCode: string | null }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'not_leaseholder' }
  | { readonly kind: 'conflict' }

interface ApplyContext {
  readonly client: pg.PoolClient
  readonly organizationId: string
  readonly agentId: string
  readonly requestId: string
}

export function createAgentStore(pool: pg.Pool) {
  const audit = createAuditService()

  async function recordJobAudit(
    ctx: ApplyContext,
    job: JobRow,
    action: string,
    extra: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await audit.record(ctx.client, {
      organizationId: ctx.organizationId,
      requestId: ctx.requestId,
      action,
      entityType: 'job',
      entityId: job.id,
      details: { jobType: job.type, targetType: job.target_type, targetId: job.target_id, agentId: ctx.agentId, ...extra },
    })
  }

  return {
    // ---- Agents (yönetici) ----
    async registerAgent(organizationId: string, name: string): Promise<{ agent: Agent; secret: string }> {
      const secret = generateAgentSecret()
      const id = uuidv7()
      const result = await pool.query(
        `INSERT INTO agents (id, organization_id, name, secret_hash) VALUES ($1, $2, $3, $4) RETURNING ${AGENT_FIELDS}`,
        [id, organizationId, name, hashAgentSecret(secret)],
      )
      return { agent: agentToDto(result.rows[0] as AgentRow), secret }
    },

    async listAgents(organizationId: string): Promise<Agent[]> {
      const result = await pool.query(
        `SELECT ${AGENT_FIELDS} FROM agents WHERE organization_id = $1 ORDER BY created_at DESC, id DESC`,
        [organizationId],
      )
      return (result.rows as AgentRow[]).map(agentToDto)
    },

    async setAgentStatus(
      organizationId: string,
      agentId: string,
      status: 'active' | 'disabled',
    ): Promise<Agent | undefined> {
      const result = await pool.query(
        `UPDATE agents SET status = $3 WHERE organization_id = $1 AND id::text = $2 RETURNING ${AGENT_FIELDS}`,
        [organizationId, agentId, status],
      )
      const row = result.rows[0] as AgentRow | undefined
      return row === undefined ? undefined : agentToDto(row)
    },

    async findAgentForAuth(
      agentId: string,
      secretHash: string,
    ): Promise<{ id: string; organizationId: string; status: 'active' | 'disabled' } | undefined> {
      const result = await pool.query(
        'SELECT id, organization_id, status FROM agents WHERE id::text = $1 AND secret_hash = $2',
        [agentId, secretHash],
      )
      const row = result.rows[0] as { id: string; organization_id: string; status: 'active' | 'disabled' } | undefined
      return row === undefined ? undefined : { id: row.id, organizationId: row.organization_id, status: row.status }
    },

    async touchLastSeen(agentId: string): Promise<void> {
      await pool.query('UPDATE agents SET last_seen_at = now() WHERE id = $1', [agentId])
    },

    // ---- Jobs ----
    /** Sıradaki uygun işi tek agent'a kilitler (SKIP LOCKED). Attempt sınırı aşılırsa dead_letter. */
    async claimJob(
      agent: { id: string; organizationId: string },
      leaseSeconds = DEFAULT_LEASE_SECONDS,
    ): Promise<ClaimedJob | null> {
      return withTransaction(pool, async (client) => {
        const sel = await client.query(
          `SELECT ${JOB_FIELDS} FROM jobs
           WHERE organization_id = $1
             AND ( (status = 'pending' AND next_attempt_at <= now())
                OR (status = 'leased' AND lease_expires_at < now()) )
           ORDER BY next_attempt_at, created_at
           FOR UPDATE SKIP LOCKED
           LIMIT 1`,
          [agent.organizationId],
        )
        const job = sel.rows[0] as JobRow | undefined
        if (job === undefined) return null

        const nextAttempt = job.attempt_count + 1
        if (nextAttempt > job.max_attempts) {
          await client.query(
            "UPDATE jobs SET status = 'dead_letter', leased_by_agent_id = NULL, lease_expires_at = NULL, updated_at = now() WHERE id = $1",
            [job.id],
          )
          return null
        }

        const upd = await client.query(
          `UPDATE jobs SET status = 'leased', attempt_count = $2, leased_by_agent_id = $3,
             lease_expires_at = now() + make_interval(secs => $4), heartbeat_at = now(), updated_at = now()
           WHERE id = $1 RETURNING ${JOB_FIELDS}`,
          [job.id, nextAttempt, agent.id, leaseSeconds],
        )
        return claimedJobToDto(upd.rows[0] as JobRow)
      })
    },

    async heartbeat(
      agent: { id: string; organizationId: string },
      jobId: string,
      leaseSeconds = DEFAULT_LEASE_SECONDS,
    ): Promise<Date | undefined> {
      const result = await pool.query(
        `UPDATE jobs SET lease_expires_at = now() + make_interval(secs => $4), heartbeat_at = now(), updated_at = now()
         WHERE id::text = $1 AND organization_id = $2 AND leased_by_agent_id = $3
           AND status = 'leased' AND lease_expires_at > now()
         RETURNING lease_expires_at`,
        [jobId, agent.organizationId, agent.id, leaseSeconds],
      )
      const row = result.rows[0] as { lease_expires_at: Date } | undefined
      return row?.lease_expires_at
    },

    /**
     * İş sonucu (idempotent, atomik). `verified`+eşleşme → metadata `ready`;
     * uyuşmazlık → `failed`; `missing` → `missing`; `failed` → retry/backoff veya
     * `dead_letter`. Yarışta (metadata sürümü/durumu değişmişse) ÜZERİNE yazmaz.
     */
    async reportResult(
      agent: { id: string; organizationId: string },
      jobId: string,
      result: JobResultRequest,
      requestId: string,
    ): Promise<ReportOutcome> {
      return withTransaction(pool, async (client): Promise<ReportOutcome> => {
        const sel = await client.query(
          `SELECT ${JOB_FIELDS}, last_error_code FROM jobs WHERE id::text = $1 AND organization_id = $2 FOR UPDATE`,
          [jobId, agent.organizationId],
        )
        const job = sel.rows[0] as (JobRow & { last_error_code: string | null }) | undefined
        if (job === undefined) return { kind: 'not_found' }

        // Idempotent: terminal iş yeniden bildirilirse mevcut durumu döner.
        if (['succeeded', 'failed', 'dead_letter'].includes(job.status)) {
          return { kind: 'ok', status: job.status, lastErrorCode: job.last_error_code }
        }
        if (job.status !== 'leased') return { kind: 'conflict' }
        if (job.leased_by_agent_id !== agent.id) return { kind: 'not_leaseholder' }
        if (job.lease_expires_at !== null && job.lease_expires_at.getTime() < Date.now()) return { kind: 'conflict' }

        const ctx: ApplyContext = { client, organizationId: agent.organizationId, agentId: agent.id, requestId }

        // ---- retry edilebilir hata ----
        if (result.outcome === 'failed') {
          const errorCode = result.errorCode ?? 'verification_failed'
          if (job.attempt_count >= job.max_attempts) {
            await client.query(
              "UPDATE jobs SET status = 'dead_letter', last_error_code = $2, leased_by_agent_id = NULL, lease_expires_at = NULL, updated_at = now() WHERE id = $1",
              [job.id, errorCode],
            )
            await recordJobAudit(ctx, job, 'job.dead_letter', { errorCode })
            return { kind: 'ok', status: 'dead_letter', lastErrorCode: errorCode }
          }
          await client.query(
            `UPDATE jobs SET status = 'pending', last_error_code = $2,
               next_attempt_at = now() + make_interval(secs => $3),
               leased_by_agent_id = NULL, lease_expires_at = NULL, heartbeat_at = NULL, updated_at = now()
             WHERE id = $1`,
            [job.id, errorCode, backoffSeconds(job.attempt_count)],
          )
          await recordJobAudit(ctx, job, 'job.retry_scheduled', { errorCode, attempt: job.attempt_count })
          return { kind: 'ok', status: 'pending', lastErrorCode: errorCode }
        }

        // ---- definitive sonuç: verified / missing ----
        const applied = await applyVerification(ctx, job, result)
        await client.query('UPDATE jobs SET status = $2, last_error_code = $3, updated_at = now() WHERE id = $1', [
          job.id,
          applied.jobStatus,
          applied.errorCode,
        ])
        await recordJobAudit(ctx, job, applied.auditAction, {
          outcome: result.outcome,
          result: applied.metadataResult,
          ...(applied.errorCode !== null ? { errorCode: applied.errorCode } : {}),
        })
        return { kind: 'ok', status: applied.jobStatus, lastErrorCode: applied.errorCode }
      })
    },
  }
}

interface AppliedResult {
  readonly metadataResult: string
  readonly errorCode: string | null
  readonly auditAction: string
  /** İşin nihai durumu: doğrulama başarıyla tamamlandıysa succeeded; içerik
   *  uyuşmazlığı gibi kesin başarısızlıkta failed. */
  readonly jobStatus: 'succeeded' | 'failed'
}

/**
 * Metadata'ya doğrulama sonucunu uygular (yarış korumalı). Sunucu gözlenen
 * hash/size'ı BEYAN edilenle karşılaştırır; agent'ın "eşleşti" iddiasına
 * körü körüne güvenmez. Yalnız `pending`/uyuşan sürümdeki hedef güncellenir.
 */
async function applyVerification(
  ctx: ApplyContext,
  job: JobRow & { last_error_code: string | null },
  result: JobResultRequest,
): Promise<AppliedResult> {
  const { client } = ctx
  if (job.target_type === 'document_version' || job.target_type === 'photo') {
    const table = job.target_type === 'photo' ? 'photos' : 'document_versions'
    const row = await client.query(
      `SELECT content_hash, byte_size, status FROM ${table} WHERE id::text = $1 AND organization_id = $2 FOR UPDATE`,
      [job.target_id, ctx.organizationId],
    )
    const target = row.rows[0] as { content_hash: string; byte_size: string; status: string } | undefined
    if (target === undefined || target.status !== 'pending') {
      return { metadataResult: 'stale_skipped', errorCode: null, auditAction: 'job.verification_stale', jobStatus: 'succeeded' }
    }
    if (result.outcome === 'missing') {
      await client.query(`UPDATE ${table} SET status = 'missing', verified_at = now() WHERE id::text = $1`, [job.target_id])
      return { metadataResult: 'missing', errorCode: null, auditAction: 'job.verification_missing', jobStatus: 'succeeded' }
    }
    // verified: gözlenen ile BEYAN edilen (satırdaki) karşılaştırılır.
    const hashMatch = result.observedHash !== undefined && result.observedHash === target.content_hash
    const sizeMatch = result.observedSize !== undefined && result.observedSize === Number(target.byte_size)
    if (hashMatch && sizeMatch) {
      await client.query(
        `UPDATE ${table} SET hash_verified = true, size_verified = true, verified_at = now(), status = 'ready' WHERE id::text = $1`,
        [job.target_id],
      )
      return { metadataResult: 'ready', errorCode: null, auditAction: 'job.verified', jobStatus: 'succeeded' }
    }
    const errorCode = !hashMatch ? 'hash_mismatch' : 'size_mismatch'
    await client.query(
      `UPDATE ${table} SET hash_verified = $2, size_verified = $3, verified_at = now(), status = 'failed' WHERE id::text = $1`,
      [job.target_id, hashMatch, sizeMatch],
    )
    return { metadataResult: 'failed', errorCode, auditAction: 'job.verification_failed', jobStatus: 'failed' }
  }

  // case_location (dizin): yalnız varlık; hash yok. Sürüm yarış koruması.
  const row = await client.query(
    'SELECT version, verification_status FROM case_locations WHERE id::text = $1 AND organization_id = $2 FOR UPDATE',
    [job.target_id, ctx.organizationId],
  )
  const loc = row.rows[0] as { version: number; verification_status: string } | undefined
  if (loc === undefined || loc.version !== job.target_version || loc.verification_status !== 'pending') {
    return { metadataResult: 'stale_skipped', errorCode: null, auditAction: 'job.verification_stale', jobStatus: 'succeeded' }
  }
  const status = result.outcome === 'missing' ? 'missing' : 'verified'
  await client.query('UPDATE case_locations SET verification_status = $2, updated_at = now() WHERE id::text = $1', [
    job.target_id,
    status,
  ])
  return {
    metadataResult: status,
    errorCode: null,
    auditAction: status === 'verified' ? 'job.verified' : 'job.verification_missing',
    jobStatus: 'succeeded',
  }
}

export type AgentStore = ReturnType<typeof createAgentStore>
