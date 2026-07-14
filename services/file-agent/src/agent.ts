import type { JobResultRequestInput, JobResultResponse } from '@hasarbotu/contracts'
import type { AgentApiClient } from './api-client.js'
import { AgentApiError } from './api-client.js'
import type { AgentConfig } from './config.js'
import { verifyTarget } from './verifier.js'
import { provisionCaseWorkspace } from './workspace-provisioner.js'
import { executeFileOperation } from './file-operation-executor.js'
import { extractPdfText, type PdfTextExtractionResult } from './pdf-text-extractor.js'

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

  const heartbeatMs = Math.max(1000, Math.floor((config.leaseSeconds * 1000) / 3))
  const heartbeat = setInterval(() => {
    void client.heartbeat(job.id).catch(() => undefined)
  }, heartbeatMs)

  let result
  try {
    if (job.payload.kind === 'pdf_text_extraction') {
      const rootAbsolute = config.roots[job.payload.storageRootKey]
      if (rootAbsolute === undefined) result = { outcome: 'failed' as const, errorCode: 'unknown_root_mapping' }
      else {
        result = await extractPdfText(rootAbsolute, job.payload, {
          onHeartbeat: async () => { await client.heartbeat(job.id, 'applying') },
          onChunk: async (chunk) => { await client.reportExtractionChunk(job.id, chunk) },
        })
      }
    } else if (job.payload.kind === 'file_operation' || job.payload.kind === 'file_operation_cleanup') {
      await client.heartbeat(job.id, job.payload.kind === 'file_operation' ? 'applying' : 'cleanup')
      result = await executeFileOperation(config.roots, job.payload)
    } else {
      const rootAbsolute = config.roots[job.payload.storageRootKey]
      if (rootAbsolute === undefined) {
        result = { outcome: 'failed' as const, errorCode: 'unknown_root_mapping' }
      } else if (job.payload.kind === 'workspace') {
      await client.heartbeat(job.id, 'applying')
      result = await provisionCaseWorkspace(rootAbsolute, job.payload, {
        onVerifying: async () => {
          await client.heartbeat(job.id, 'verifying')
        },
      })
      } else {
        result = await verifyTarget(rootAbsolute, job.payload)
      }
    }
  } finally {
    clearInterval(heartbeat)
  }

  const reportInput: JobResultRequestInput = {
    outcome: result.outcome,
    ...(result.observedHash !== undefined ? { observedHash: result.observedHash } : {}),
    ...(result.observedSize !== undefined ? { observedSize: result.observedSize } : {}),
    ...(result.errorCode !== undefined ? { errorCode: result.errorCode } : {}),
    ...('fileOperation' in result && result.fileOperation !== undefined ? { fileOperation: result.fileOperation } : {}),
    ...((result as PdfTextExtractionResult).pdfExtraction !== undefined ? { pdfExtraction: (result as PdfTextExtractionResult).pdfExtraction } : {}),
  }
  const reported = await client.reportResult(job.id, reportInput)
  return { kind: 'reported', jobId: job.id, outcome: result.outcome, reported }
}

/** Sürekli döngü: iş varken hemen devam eder, boş kuyrukta poll aralığı bekler. */
export async function runLoop(
  client: AgentApiClient,
  config: AgentConfig,
  options: {
    readonly signal?: AbortSignal
    /** Ham exception yerine yalnız güvenli döngü hata kodu bildirilir. */
    readonly onCycleError?: (code: 'api_unavailable' | 'agent_cycle_failed') => void
  } = {},
): Promise<void> {
  const { signal } = options
  while (signal === undefined || !signal.aborted) {
    try {
      const result = await runOnce(client, config)
      if (result.kind !== 'no_work') continue
    } catch (error) {
      options.onCycleError?.(error instanceof AgentApiError ? 'api_unavailable' : 'agent_cycle_failed')
    }
    if (signal === undefined || !signal.aborted) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, config.pollIntervalMs))
    }
  }
}
