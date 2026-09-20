import type { JobResultRequestInput, JobResultResponse } from '@hasarbotu/contracts'
import type { AgentApiClient } from './api-client.js'
import { AgentApiError } from './api-client.js'
import type { AgentConfig } from './config.js'
import { verifyTarget } from './verifier.js'
import { provisionCaseWorkspace } from './workspace-provisioner.js'
import { executeFileOperation } from './file-operation-executor.js'
import { extractPdfText, type PdfTextExtractionResult } from './pdf-text-extractor.js'
import { extractPolicyOcr, type PolicyOcrExtractionResult } from './policy-ocr-extractor.js'
import { probeRootHealth } from './root-health.js'
import { checkCaseFreshness } from './freshness-gate-client.js'

/**
 * File Agent çalışma döngüsü (Paket 14). Bir işi claim eder, yerel root
 * eşlemesiyle güvenle çözer, GERÇEK dosyadan doğrular ve sonucu API'ye bildirir.
 * Uzun hash sırasında lease heartbeat ile korunur. Agent doğrudan DB'ye yazmaz.
 */
export type RunOnceResult =
  | { readonly kind: 'no_work' }
  | { readonly kind: 'storage_unavailable' }
  | { readonly kind: 'reported'; readonly jobId: string; readonly outcome: string; readonly reported: JobResultResponse }

/**
 * D4 fail-closed: yapılandırılmış köklerden biri tamamen erişilemezse (kök
 * kayıp/sürücü değil/reparse point) yeni iş HİÇ claim EDİLMEZ. Bu, uzun bir
 * `P:\` kesintisinde işlerin tekrar tekrar claim edilip anında başarısız
 * olarak attempt bütçesini tüketmesini (ve zamanla sessizce `dead_letter`a
 * düşmesini) ÖNLER — kesinti boyunca işler `pending` kalır (PENDING_STORAGE).
 * Yalnız HAFİF (yazma probu OLMAYAN) kontrol yapılır; belirli bir fiziksel
 * işin yazma-yeteneği ihtiyacı ilgili yürütücüde AYRICA doğrulanır.
 */
async function allConfiguredRootsReachable(roots: Readonly<Record<string, string>>): Promise<boolean> {
  for (const rootAbsolute of Object.values(roots)) {
    const health = await probeRootHealth(rootAbsolute, undefined, { verifyWritable: false })
    if (!health.ok) return false
  }
  return true
}

export async function runOnce(client: AgentApiClient, config: AgentConfig): Promise<RunOnceResult> {
  if (!(await allConfiguredRootsReachable(config.roots))) {
    return { kind: 'storage_unavailable' }
  }

  const job = await client.claim()
  if (job === null) return { kind: 'no_work' }

  const heartbeatMs = Math.max(1000, Math.floor((config.leaseSeconds * 1000) / 3))
  const heartbeat = setInterval(() => {
    void client.heartbeat(job.id).catch(() => undefined)
  }, heartbeatMs)

  let result
  try {
    if (job.payload.kind === 'policy_ocr') {
      const rootAbsolute = config.roots[job.payload.storageRootKey]
      if (rootAbsolute === undefined) result = { outcome: 'failed' as const, errorCode: 'unknown_root_mapping' }
      else {
        result = await extractPolicyOcr(rootAbsolute, job.payload, {
          onHeartbeat: async (phase) => { await client.heartbeat(job.id, phase) },
          onChunk: async (chunk) => { await client.reportPolicyOcrChunk(job.id, chunk) },
        })
      }
    } else if (job.payload.kind === 'pdf_text_extraction') {
      const rootAbsolute = config.roots[job.payload.storageRootKey]
      if (rootAbsolute === undefined) result = { outcome: 'failed' as const, errorCode: 'unknown_root_mapping' }
      else {
        result = await extractPdfText(rootAbsolute, job.payload, {
          onHeartbeat: async () => { await client.heartbeat(job.id, 'applying') },
          onChunk: async (chunk) => { await client.reportExtractionChunk(job.id, chunk) },
        })
      }
    } else if (job.payload.kind === 'file_operation' || job.payload.kind === 'file_operation_cleanup') {
      const sourceRootAbsolute = config.roots[job.payload.source.storageRootKey]
      const destinationRootAbsolute = config.roots[job.payload.destination.storageRootKey]
      if (sourceRootAbsolute === undefined || destinationRootAbsolute === undefined) {
        result = { outcome: 'failed' as const, errorCode: 'unknown_root_mapping' }
      } else {
        // Rename/move dokunduğu HER İKİ tarafı (kaynak ve hedef) da fail-
        // closed kontrol edilir -- biri bile taze değilse işlem yapılmaz.
        const [sourceFreshness, destinationFreshness] = await Promise.all([
          checkCaseFreshness(config.freshnessGate, sourceRootAbsolute, job.payload.source.relativePath),
          checkCaseFreshness(config.freshnessGate, destinationRootAbsolute, job.payload.destination.relativePath),
        ])
        if (!sourceFreshness.ready || !destinationFreshness.ready) {
          result = { outcome: 'failed' as const, errorCode: 'case_not_fresh' }
        } else {
          await client.heartbeat(job.id, job.payload.kind === 'file_operation' ? 'applying' : 'cleanup')
          result = await executeFileOperation(config.roots, job.payload)
        }
      }
    } else {
      const rootAbsolute = config.roots[job.payload.storageRootKey]
      if (rootAbsolute === undefined) {
        result = { outcome: 'failed' as const, errorCode: 'unknown_root_mapping' }
      } else if (job.payload.kind === 'workspace') {
        const freshness = await checkCaseFreshness(config.freshnessGate, rootAbsolute, job.payload.relativePath, { operation: 'workspace' })
        if (!freshness.ready) {
          result = { outcome: 'failed' as const, errorCode: 'case_not_fresh' }
        } else {
          await client.heartbeat(job.id, 'applying')
          result = await provisionCaseWorkspace(rootAbsolute, job.payload, {
            onVerifying: async () => {
              await client.heartbeat(job.id, 'verifying')
            },
          })
        }
      } else {
        result = await verifyTarget(rootAbsolute, job.payload)
      }
    }
  } finally {
    clearInterval(heartbeat)
  }

  const reportInput: JobResultRequestInput = {
    outcome: result.outcome,
    ...('observedHash' in result && result.observedHash !== undefined
      ? { observedHash: result.observedHash }
      : {}),
    ...('observedSize' in result && result.observedSize !== undefined
      ? { observedSize: result.observedSize }
      : {}),
    ...('errorCode' in result && result.errorCode !== undefined
      ? { errorCode: result.errorCode }
      : {}),
    ...('fileOperation' in result && result.fileOperation !== undefined ? { fileOperation: result.fileOperation } : {}),
    ...((result as PdfTextExtractionResult).pdfExtraction !== undefined ? { pdfExtraction: (result as PdfTextExtractionResult).pdfExtraction } : {}),
    ...((result as PolicyOcrExtractionResult).policyOcr !== undefined ? { policyOcr: (result as PolicyOcrExtractionResult).policyOcr } : {}),
  }
  const reported = await client.reportResult(job.id, reportInput)
  return { kind: 'reported', jobId: job.id, outcome: result.outcome, reported }
}

/** Sürekli döngü: iş varken hemen devam eder, boş kuyrukta/depoda poll aralığı bekler. */
export async function runLoop(
  client: AgentApiClient,
  config: AgentConfig,
  options: {
    readonly signal?: AbortSignal
    /** Ham exception yerine yalnız güvenli döngü hata/durum kodu bildirilir. */
    readonly onCycleError?: (code: 'api_unavailable' | 'agent_cycle_failed' | 'storage_unavailable') => void
  } = {},
): Promise<void> {
  const { signal } = options
  while (signal === undefined || !signal.aborted) {
    try {
      const result = await runOnce(client, config)
      if (result.kind === 'storage_unavailable') options.onCycleError?.('storage_unavailable')
      if (result.kind !== 'no_work' && result.kind !== 'storage_unavailable') continue
    } catch (error) {
      options.onCycleError?.(error instanceof AgentApiError ? 'api_unavailable' : 'agent_cycle_failed')
    }
    if (signal === undefined || !signal.aborted) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, config.pollIntervalMs))
    }
  }
}
