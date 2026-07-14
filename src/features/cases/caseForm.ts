import { CaseCommandError, type CaseCommandFieldError, type ServiceReferenceRecord } from '../../data'
import type { CaseStage, CaseStageCode } from '../../types/case'

export const CASE_STAGE_OPTIONS: readonly { value: CaseStageCode; label: CaseStage }[] = [
  { value: 'new_notification', label: 'Yeni İhbar' },
  { value: 'vehicle_or_service_pending', label: 'Araç / Servis Bekleniyor' },
  { value: 'inspection_pending', label: 'Ekspertiz Bekliyor' },
  { value: 'damage_assessment', label: 'Hasar Tespiti' },
  { value: 'parts_and_labor', label: 'Parça ve İşçilik' },
  { value: 'repair_approval_pending', label: 'Onarım Onayı Bekleniyor' },
  { value: 'under_repair', label: 'Onarımda' },
  { value: 'reporting', label: 'Raporlama' },
  { value: 'closing_documents', label: 'Kapanış Evrakları' },
  { value: 'ready_to_close', label: 'Kapanmaya Hazır' },
]

const NON_ALPHANUMERIC = /[^\p{L}\p{N}]+/gu
const TURKISH_PLATE_SEGMENTS = /^(\d{2})([A-Z]{1,3})(\d{2,4})$/

/** Domain plaka kanonikalizasyonuyla ayni, UI tarafinda saf on-duzenleme. */
export function normalizePlateInput(value: string): string {
  const trimmed = value.trim()
  const searchKey = trimmed.normalize('NFKC').toUpperCase().replace(NON_ALPHANUMERIC, '')
  const segments = TURKISH_PLATE_SEGMENTS.exec(searchKey)
  return segments === null
    ? trimmed.normalize('NFKC').toUpperCase().replace(NON_ALPHANUMERIC, ' ').trim()
    : `${segments[1]} ${segments[2]} ${segments[3]}`
}

export function optionalText(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

export function nullableText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

const FIELD_LABELS: Readonly<Record<string, string>> = {
  caseType: 'Dosya türü',
  plate: 'Plaka',
  workflowStage: 'İlk aşama',
  notificationFormNumber: 'İhbar numarası',
  insurerClaimNumber: 'Hasar dosya numarası',
  responsibleUserId: 'Sorumlu',
  expertUserId: 'Eksper',
  serviceId: 'Servis',
  insurerId: 'Sigorta şirketi',
  followUpDate: 'Takip tarihi',
  lossDate: 'Hasar tarihi',
  notificationDate: 'İhbar tarihi',
}

function fieldMessage(error: CaseCommandFieldError): string {
  if (error.code === 'unknown_reference') return 'Bu kayıt organizasyonunuzda bulunamadı.'
  if (error.code === 'inactive_or_ineligible_reference') return 'Bu kayıt pasif veya bu alan için uygun değil.'
  if (error.code === 'notification_before_loss_date') return 'İhbar tarihi hasar tarihinden önce olamaz.'
  if (error.code === 'required' || error.code.endsWith('_required')) return 'Bu alan zorunludur.'
  if (error.code.includes('date')) return 'Geçerli bir tarih girin.'
  if (error.path === 'plate') return 'Geçerli bir plaka girin.'
  return 'Girilen değer kabul edilmedi.'
}

export function commandFieldMessages(error: CaseCommandError): Readonly<Record<string, string>> {
  return Object.fromEntries(error.fieldErrors.map((item) => [item.path, fieldMessage(item)]))
}

export function commandErrorMessage(error: CaseCommandError): string {
  switch (error.kind) {
    case 'validation':
      return 'Bazı alanlar kabul edilmedi. İşaretli alanları kontrol edin.'
    case 'unknown_reference':
      return 'Seçilen referans organizasyonunuzda bulunamadı.'
    case 'version_conflict':
      return 'Dosya başka bir işlemle güncellendi. Güncel veriyi yeniden yükleyin.'
    case 'idempotency_conflict':
      return 'Bu oluşturma anahtarı farklı bilgilerle kullanıldı. Formu kontrol edip yeniden deneyin.'
    case 'not_found':
      return 'Dosya bulunamadı veya erişim alanınızda değil.'
    case 'unauthorized':
      return 'Oturumunuz sona erdi. Yeniden giriş yapın.'
    case 'unavailable':
      return 'Sunucuya ulaşılamadı. Bilgileriniz korunuyor; bağlantıyı kontrol edip yeniden deneyin.'
  }
}

export function fieldLabel(path: string): string {
  return FIELD_LABELS[path] ?? path
}

const SERVICE_TYPE_LABELS: Record<ServiceReferenceRecord['serviceType'], string> = {
  authorized: 'Yetkili servis',
  private: 'Özel servis',
  glass: 'Cam servisi',
  mobile: 'Mobil servis',
  other: 'Diğer servis',
}

export function serviceOptionLabel(service: ServiceReferenceRecord): string {
  const agreement = service.agreement.agreementStatus === 'agreed'
    ? 'seçili sigorta şirketiyle anlaşmalı'
    : service.agreement.agreementStatus === 'not_agreed'
      ? 'seçili sigorta şirketiyle anlaşmalı değil'
      : 'anlaşma kontrolü gerekli'
  return `${service.name} · ${SERVICE_TYPE_LABELS[service.serviceType]} · ${agreement}`
}

export function serviceEvaluationSummary(service: ServiceReferenceRecord | null | undefined): string {
  if (service === null || service === undefined) return 'Servis seçildiğinde tür ve sigorta şirketine özel anlaşma sonucu gösterilir.'
  return `${SERVICE_TYPE_LABELS[service.serviceType]} · ${service.agreement.reason} Kural ${service.agreement.ruleVersion}.`
}

export function makeSubmissionKey(): string {
  const cryptoRef = (globalThis as {
    crypto?: { randomUUID?: () => string; getRandomValues?: (array: Uint8Array) => Uint8Array }
  }).crypto
  if (cryptoRef?.randomUUID !== undefined) return cryptoRef.randomUUID()
  if (cryptoRef?.getRandomValues !== undefined) {
    const bytes = cryptoRef.getRandomValues(new Uint8Array(16))
    return `case-${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`
  }
  throw new CaseCommandError('unavailable', 'secure idempotency key generation unavailable')
}
