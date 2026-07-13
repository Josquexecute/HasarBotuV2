import type { JobResultResponse } from '@hasarbotu/contracts'
import type { AgentApiClient } from './api-client.js'
import type { AgentConfig } from './config.js'
import { verifyTarget } from './verifier.js'

/**
 * File Agent çalışma döngüsü (Paket 14). Bir işi claim eder, yerel root
 * eşlemesiyle güvenle çözer, GERÇEK dosyadan doğrular ve sonucu API'ye bildirir.
 * Uzun hash sırasında lease heartbeat ile korunur. Agent doğrudan DB'ye yazmaz.
 */
export type RunOnceResult =
  | { readonly kind: 'no_work' }
  | { readonly kind: 'reported'; readonly jobId: string; readonly outcome: string; readonly reported: JobResultResponse }

export async function runOnce(client: AgentApiClient, config: AgentConfig): Promise<RunOnceResult> {
  const job = await client.claim()
  if (job === null) return { kind: 'no_work' }

  const rootAbsolute = config.roots[job.payload.storageRootKey]
  if (rootAbsolute === undefined) {
    // Bu agent bu kökü eşleyemiyor; güvenli neden koduyla başarısız bildir.
    const reported = await client.reportResult(job.id, { outcome: 'failed', errorCode: 'unknown_root_mapping' })
    return { kind: 'reported', jobId: job.id, outcome: 'failed', reported }
  }

  const heartbeatMs = Math.max(1000, Math.floor((config.leaseSeconds * 1000) / 3))
  const heartbeat = setInterval(() => {
    void client.heartbeat(job.id).catch(() => undefined)
  }, heartbeatMs)

  let result
  try {
    result = await verifyTarget(rootAbsolute, job.payload)
  } finally {
    clearInterval(heartbeat)
  }

  const reported = await client.reportResult(job.id, {
    outcome: result.outcome,
    ...(result.observedHash !== undefined ? { observedHash: result.observedHash } : {}),
    ...(result.observedSize !== undefined ? { observedSize: result.observedSize } : {}),
    ...(result.errorCode !== undefined ? { errorCode: result.errorCode } : {}),
  })
  return { kind: 'reported', jobId: job.id, outcome: result.outcome, reported }
}

/** Sürekli döngü: iş varken hemen devam eder, boş kuyrukta poll aralığı bekler. */
export async function runLoop(
  client: AgentApiClient,
  config: AgentConfig,
  options: { readonly signal?: AbortSignal } = {},
): Promise<void> {
  const { signal } = options
  while (signal === undefined || !signal.aborted) {
    const result = await runOnce(client, config)
    if (result.kind === 'no_work') {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, config.pollIntervalMs))
    }
  }
}
