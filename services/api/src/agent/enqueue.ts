import { uuidv7 } from '@hasarbotu/database'
import type { JobPayload, JobTargetType, JobType } from '@hasarbotu/contracts'
import type { Queryable } from '../db/executor.js'

/**
 * Doğrulama işi kuyruğa ekleme (Paket 14). Metadata kaydı (belge sürümü,
 * fotoğraf, vaka konumu) oluşturulduğunda AYNI transaction içinde çağrılır;
 * böylece kayıt + iş atomiktir. Payload YALNIZ güvenli alanlar taşır (mantıksal
 * rootKey + göreli yol + beyan hash/size); mutlak yol ASLA yazılmaz.
 */
export interface EnqueueVerifyJobInput {
  readonly organizationId: string
  readonly type: JobType
  readonly targetType: JobTargetType
  readonly targetId: string
  readonly targetVersion: number
  readonly payload: JobPayload
}

export async function enqueueVerifyJob(exec: Queryable, input: EnqueueVerifyJobInput): Promise<string> {
  const jobId = uuidv7()
  await exec.query(
    `INSERT INTO jobs (id, organization_id, type, target_type, target_id, target_version, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      jobId,
      input.organizationId,
      input.type,
      input.targetType,
      input.targetId,
      input.targetVersion,
      JSON.stringify(input.payload),
    ],
  )
  return jobId
}
