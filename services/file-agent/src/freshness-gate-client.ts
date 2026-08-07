import { spawn } from 'node:child_process'
import path from 'node:path'
import type { FreshnessGateConfig } from './config.js'

/**
 * Session-0-safe per-case freshness gate client (HB-2026-171, HB-2026-167
 * Karar 1'in File Agent entegrasyonu).
 *
 * `deploy/windows-service/pcloud-session0-freshness-gate.mjs`yi ayrı bir
 * alt-süreç olarak çağırır -- doğrudan `import` DEĞİL. Bu bilinçli bir
 * tercih: o araç npm workspace'in (`rootDir: src`) dışındadır, kendi
 * `.d.ts` tipleri yoktur ve zaten yalnız `node:*` builtin'leri kullanan,
 * spawn-dostu, bağımsız bir CLI olarak tasarlanmıştır (kendi CLI
 * sözleşmesi zaten `run-pcloud-session0-freshness-gate.ps1` ile birebir
 * aynı olacak şekilde belgelenmiştir).
 *
 * Her hata yolu (spawn başarısızlığı, geçersiz JSON, beklenmeyen çıkış
 * kodu, zaman aşımı) fail-closed'dır -- asla sessizce "ready" varsayılmaz.
 */

export type FreshnessCheckResult =
  | { readonly ready: true; readonly caseStatus: 'ready' }
  | { readonly ready: false; readonly caseStatus: string; readonly reason: string }

const DEFAULT_TIMEOUT_MS = 30_000

export async function checkCaseFreshness(
  freshnessGate: FreshnessGateConfig | undefined,
  rootAbsolute: string,
  relativePath: string,
  options: { readonly timeoutMs?: number } = {},
): Promise<FreshnessCheckResult> {
  if (freshnessGate === undefined) {
    return { ready: false, caseStatus: 'unknown', reason: 'freshness_gate_not_configured' }
  }

  const targetCaseRoot = path.join(rootAbsolute, relativePath)
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  let stdout = ''
  let stderr = ''
  let exitCode: number | null = null
  let timedOut = false

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [
        freshnessGate.toolPath,
        '--target-root', targetCaseRoot,
        '--top-level-folder-name', freshnessGate.topLevelFolderName,
        '--case-relative-path', relativePath,
        '--pcloud-db', freshnessGate.pcloudLocalDatabasePath,
        '--attestation-store', freshnessGate.attestationStoreDirectory,
      ], { stdio: ['ignore', 'pipe', 'pipe'] })

      const timer = setTimeout(() => {
        timedOut = true
        child.kill()
      }, timeoutMs)

      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
      child.once('error', (error) => { clearTimeout(timer); reject(error) })
      child.once('close', (code) => { clearTimeout(timer); exitCode = code; resolve() })
    })
  } catch (error) {
    return {
      ready: false,
      caseStatus: 'unknown',
      reason: `freshness_gate_spawn_failed: ${(error as Error).message}`,
    }
  }

  if (timedOut) {
    return { ready: false, caseStatus: 'unknown', reason: 'freshness_gate_timeout' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return {
      ready: false,
      caseStatus: 'unknown',
      reason: `freshness_gate_output_invalid: exit=${String(exitCode)} stderr=${stderr.slice(0, 200)}`,
    }
  }

  if (
    parsed === null
    || typeof parsed !== 'object'
    || !('CaseStatus' in parsed)
    || typeof (parsed as { CaseStatus: unknown }).CaseStatus !== 'string'
  ) {
    return { ready: false, caseStatus: 'unknown', reason: 'freshness_gate_output_missing_case_status' }
  }

  const caseStatus = (parsed as { CaseStatus: string }).CaseStatus
  if (caseStatus === 'ready' && exitCode === 0) {
    return { ready: true, caseStatus: 'ready' }
  }
  return { ready: false, caseStatus, reason: `case_status_${caseStatus}` }
}
