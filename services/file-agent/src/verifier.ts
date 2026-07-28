import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { JobPayload } from '@hasarbotu/contracts'
import { assertRealPathUnderRoot, PathSafetyError, resolveUnderRoot } from './path-resolver.js'
import { probeRootHealth, STORAGE_UNAVAILABLE_ERROR_CODE } from './root-health.js'

/**
 * Dosya/dizin doğrulama (Paket 14). Agent GERÇEK dosyadan SHA-256'yı STREAMING
 * olarak hesaplar (tüm dosya belleğe ALINMAZ) ve boyutu gerçek okumadan alır.
 * İstemcinin beyan ettiği hash'e GÜVENMEZ; yalnız gözleneni raporlar (eşleşme
 * kararı sunucudadır). Dosya içeriği loglanmaz.
 *
 * D4: hedef yol çözülmeden ÖNCE kökün kendisi sağlıklı mı diye bakılır.
 * Aksi hâlde `P:\` bağlantısı geçici koparsa `assertRealPathUnderRoot`in
 * ENOENT'i "hedef silinmiş" (`missing`) sanılır — oysa dosya YERİNDE olabilir,
 * yalnız kök o an görünmüyordur. Bu karışıklık `verification_status`u
 * KALICI OLARAK `missing` yapabileceği için ciddi bir veri bütünlüğü
 * riskidir; bu yüzden burada `storage_unavailable` (RETRYABLE) ile ayrılır.
 * Salt-okuma olduğu için köke yazma/silme trafiği YÜKLENMEZ
 * (`verifyWritable: false`) — yalnız kökün varlığı/türü doğrulanır.
 */
export interface VerifyResult {
  readonly outcome: 'verified' | 'missing' | 'failed'
  readonly observedHash?: string
  readonly observedSize?: number
  readonly errorCode?: string
}

/** Streaming SHA-256 + gerçek okunan byte sayısı. Dosya belleğe alınmaz. */
export async function streamSha256(absolutePath: string): Promise<{ hash: string; size: number }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const hash = createHash('sha256')
    let size = 0
    const stream = createReadStream(absolutePath)
    stream.on('data', (chunk: string | Buffer) => {
      size += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
      hash.update(chunk)
    })
    stream.on('error', rejectPromise)
    stream.on('end', () => resolvePromise({ hash: hash.digest('hex'), size }))
  })
}

function errno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code
}

export async function verifyTarget(rootAbsolute: string, payload: JobPayload): Promise<VerifyResult> {
  if (payload.kind === 'workspace' || payload.kind === 'file_operation' || payload.kind === 'file_operation_cleanup') {
    return { outcome: 'failed', errorCode: 'unsupported_job_kind' }
  }

  const rootHealth = await probeRootHealth(rootAbsolute, undefined, { verifyWritable: false })
  if (!rootHealth.ok) return { outcome: 'failed', errorCode: STORAGE_UNAVAILABLE_ERROR_CODE }

  let candidate: string
  try {
    candidate = resolveUnderRoot(rootAbsolute, payload.relativePath)
  } catch (error) {
    if (error instanceof PathSafetyError) return { outcome: 'failed', errorCode: error.code }
    return { outcome: 'failed', errorCode: 'resolve_error' }
  }

  let realPath: string
  try {
    realPath = await assertRealPathUnderRoot(rootAbsolute, candidate)
  } catch (error) {
    if (error instanceof PathSafetyError) return { outcome: 'failed', errorCode: error.code }
    if (errno(error) === 'ENOENT') return { outcome: 'missing' }
    return { outcome: 'failed', errorCode: 'access_error' }
  }

  let isDirectory: boolean
  let isFile: boolean
  try {
    const stats = await stat(realPath)
    isDirectory = stats.isDirectory()
    isFile = stats.isFile()
  } catch (error) {
    if (errno(error) === 'ENOENT') return { outcome: 'missing' }
    return { outcome: 'failed', errorCode: 'access_error' }
  }

  if (payload.kind === 'directory') {
    return isDirectory ? { outcome: 'verified' } : { outcome: 'failed', errorCode: 'not_a_directory' }
  }

  if (!isFile) return { outcome: 'failed', errorCode: 'not_a_file' }
  try {
    const { hash, size } = await streamSha256(realPath)
    return { outcome: 'verified', observedHash: hash, observedSize: size }
  } catch {
    return { outcome: 'failed', errorCode: 'read_error' }
  }
}
