import type { FieldPhotoKind, FieldUpload } from '@hasarbotu/contracts'

export interface FieldCase { id: string; plate: string; officeNumber: string; status: 'open' | 'closed'; canUpload: boolean }
export class FieldApiError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code) }
}
export async function fieldRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try { response = await fetch('/api/v1/field' + path, { ...init, credentials: 'include', cache: 'no-store', redirect: 'error', headers: { accept: 'application/json', ...init.headers } }) }
  catch (error) { if (error instanceof Error && error.name === 'AbortError') throw error; throw new FieldApiError('network_unavailable', 0) }
  const data: unknown = await response.json()
  if (!response.ok) throw new FieldApiError(typeof data === 'object' && data !== null && 'code' in data && typeof data.code === 'string' ? data.code : 'request_failed', response.status)
  return data as T
}
export function readPhotoBlob(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = () => reject(new Error('file_unreadable')); reader.readAsArrayBuffer(blob) })
}
export async function uploadFieldPhoto(input: { file: File; caseId: string; userId: string; kind: FieldPhotoKind; signal: AbortSignal; onProgress: (percent: number) => void }) {
  const { FIELD_PHOTO_MAX_BYTES, FIELD_PHOTO_CHUNK_BYTES, fieldUploadSchema } = await import('@hasarbotu/contracts')
  if (input.file.size === 0 || input.file.size > FIELD_PHOTO_MAX_BYTES) throw new FieldApiError('image_too_large', 400)
  if (!window.crypto?.subtle) throw new FieldApiError('secure_browser_required', 400)
  input.onProgress(0)
  const bytes = await readPhotoBlob(input.file)
  const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, '0')).join('')
  const contentHash = hex(await crypto.subtle.digest('SHA-256', bytes))
  // The same photo reselected after a reload resumes the same server upload.
  const identity = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${input.userId}:${input.caseId}:${input.kind}:${contentHash}`))).slice(0, 32)
  const clientKey = `${identity.slice(0,8)}-${identity.slice(8,12)}-4${identity.slice(13,16)}-8${identity.slice(17,20)}-${identity.slice(20,32)}`
  let upload = fieldUploadSchema.parse(await fieldRequest(`/cases/${input.caseId}/uploads`, { method: 'POST', signal: input.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientKey, kind: input.kind, fileName: input.file.name, byteSize: input.file.size, contentHash }) }))
  if (upload.status === 'failed') throw new FieldApiError(upload.errorCode ?? 'image_conversion_failed', 409)
  while (upload.status === 'receiving' && upload.receivedBytes < input.file.size) {
    const offset = upload.receivedBytes
    upload = fieldUploadSchema.parse(await fieldRequest(`/uploads/${upload.id}/chunk?offset=${offset}`, { method: 'PUT', signal: input.signal, headers: { 'content-type': 'application/octet-stream' }, body: input.file.slice(offset, offset + FIELD_PHOTO_CHUNK_BYTES) }))
    input.onProgress(Math.floor(upload.receivedBytes / input.file.size * 100))
  }
  if (upload.status === 'receiving') upload = fieldUploadSchema.parse(await fieldRequest(`/uploads/${upload.id}/finish`, { method: 'POST', signal: input.signal }))
  input.onProgress(100)
  return upload
}
export const FIELD_KIND_LABELS: Record<FieldPhotoKind, string> = { damage: 'Hasar', chassis: 'Şase', odometer: 'Kilometre' }
export function fieldErrorMessage(error: unknown): string {
  const code = error instanceof FieldApiError ? error.code : ''
  if (error instanceof FieldApiError && error.status === 401) return 'Oturumunuz sona erdi. Yeniden giriş yapın.'
  return ({ image_too_large: 'Fotoğraf işlenemeyecek kadar büyük. En fazla 40 MB ve 64 megapiksel fotoğraf seçin.', unsupported_image: 'Bu dosya okunamadı. JPEG, PNG, WebP, HEIC veya AVIF fotoğraf seçin.',
    image_conversion_failed: 'Fotoğraf işlenemedi. Orijinal korundu; başka bir fotoğraf seçin.', case_busy: 'Bu dosya kapalı veya üzerinde klasör işlemi sürüyor. Açık dosyayı seçin.',
    case_unavailable: 'Dosyanın klasörü henüz hazır değil.', case_location_changed: 'Dosyanın klasörü değişti. Güncel dosyadan tekrar deneyin.',
    storage_full: 'Sunucuda yeterli alan yok. Ofis yöneticisine bildirin.', upload_queue_full: 'Bekleyen yüklemeler tamamlandıktan sonra tekrar deneyin.',
    case_not_fresh: 'Ofis klasörünün eşitlenmesi bekleniyor.', storage_unavailable: 'Ofis klasörüne erişim bekleniyor.', photo_write_failed: 'Fotoğrafın ofis klasörüne aktarımı bekleniyor.',
    upload_cancelled: 'Yükleme iptal edildi. Aynı fotoğrafı yeniden seçerek devam edebilirsiniz.',
    secure_browser_required: 'Bu ekranı HTTPS bağlantısıyla güncel bir tarayıcıda açın.', network_unavailable: 'Bağlantı kesildi. Tekrar deneyince kaldığı yerden devam eder.',
  } as Record<string, string>)[code] ?? 'İşlem tamamlanamadı. Bağlantınızı kontrol edip yeniden deneyin.'
}
export type { FieldUpload, FieldPhotoKind }
