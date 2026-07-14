import type { CaseRecord, CaseStage, CaseStageCode, CaseStatus, CaseType } from '../types/case'
import type { CasesDataPort } from './ports'

/**
 * HttpApiAdapter: salt okunur `GET /api/v1/cases` ucunu tuketir ve wire DTO'yu
 * UI CaseRecord modeline cevirir. Oturum cerezi tarayicida ayni-origin Vite
 * proxy'siyle tasinir (`credentials: 'include'`); Node testleri `headers` ile
 * cerez enjekte eder. API'de bulunmayan sunum alanlari guvenli '—' ile doldurulur.
 */

interface CaseListItemDto {
  id: string
  caseType: 'traffic' | 'casco'
  officeCaseNumber: string
  notificationFormNumber: string | null
  insurerClaimNumber: string | null
  plate: string
  status: 'open' | 'closed'
  stage: string
  responsibleUserId?: string | null
  serviceId?: string | null
  insurerId?: string | null
  followUpDate: string | null
  updatedAt: string
  version?: number
}

const STAGE_LABELS: Record<string, CaseStage> = {
  new_notification: 'Yeni İhbar',
  vehicle_or_service_pending: 'Araç / Servis Bekleniyor',
  inspection_pending: 'Ekspertiz Bekliyor',
  damage_assessment: 'Hasar Tespiti',
  parts_and_labor: 'Parça ve İşçilik',
  repair_approval_pending: 'Onarım Onayı Bekleniyor',
  under_repair: 'Onarımda',
  reporting: 'Raporlama',
  closing_documents: 'Kapanış Evrakları',
  ready_to_close: 'Kapanmaya Hazır',
}

const MONTHS_TR = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

function toLocalDateString(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${value.getFullYear()}-${month}-${day}`
}

/**
 * Takip goruntusu ve tonu TURETILMIS operasyon gorunumudur (HB-2026-010):
 * gecmis gun 'late', bugun 'today', ilerisi 'normal'.
 */
export function deriveFollowUp(followUpDate: string | null, today: Date = new Date()): {
  followUp: string
  followUpTone: CaseRecord['followUpTone']
} {
  if (followUpDate === null) return { followUp: '—', followUpTone: 'normal' }
  const todayString = toLocalDateString(today)
  if (followUpDate === todayString) return { followUp: 'Bugün', followUpTone: 'today' }

  const [year, month, day] = followUpDate.split('-').map(Number) as [number, number, number]
  const label = `${day} ${MONTHS_TR[month - 1]}${year === today.getFullYear() ? '' : ` ${year}`}`
  return {
    followUp: label,
    followUpTone: followUpDate < todayString ? 'late' : 'normal',
  }
}

/** Yasam dongusu open|closed'tir; UI durum cipi turetilmis gorunumdur. */
export function deriveStatus(dto: Pick<CaseListItemDto, 'status' | 'followUpDate'>, today: Date = new Date()): CaseStatus {
  if (dto.followUpDate !== null && dto.followUpDate < toLocalDateString(today)) return 'Gecikmiş'
  return 'Açık'
}

export function mapCaseDtoToRecord(dto: CaseListItemDto, today: Date = new Date()): CaseRecord {
  const { followUp, followUpTone } = deriveFollowUp(dto.followUpDate, today)
  const caseType: CaseType = dto.caseType === 'traffic' ? 'Trafik' : 'Kasko'
  return {
    caseId: dto.id,
    plate: dto.plate,
    officeNumber: dto.officeCaseNumber,
    noticeNumber: dto.notificationFormNumber ?? '—',
    claimNumber: dto.insurerClaimNumber ?? '—',
    company: '—',
    type: caseType,
    status: deriveStatus(dto, today),
    stage: STAGE_LABELS[dto.stage] ?? 'Yeni İhbar',
    missingDocuments: 0,
    assignee: '—',
    expert: '—',
    service: '—',
    followUp,
    followUpTone,
    lastAction: '—',
    vehicle: '—',
    insured: '—',
    estimatedDamage: 0,
    notes: [],
    ...(dto.version === undefined ? {} : { version: dto.version }),
    workflowStage: dto.stage as CaseStageCode,
    responsibleUserId: dto.responsibleUserId ?? null,
    serviceId: dto.serviceId ?? null,
    insurerId: dto.insurerId ?? null,
    followUpDate: dto.followUpDate,
  }
}

/**
 * API hata sinifi: 401 oturum gereksinimi, diger her sey servis kullanilamiyor.
 * Sahte veri gercek API hatasini HICBIR ZAMAN maskelemez (HB-2026-014).
 */
export type HttpCasesErrorKind = 'unauthorized' | 'unavailable'

export class HttpCasesError extends Error {
  readonly kind: HttpCasesErrorKind

  constructor(kind: HttpCasesErrorKind, message: string) {
    super(message)
    this.name = 'HttpCasesError'
    this.kind = kind
  }
}

export interface HttpCasesAdapterOptions {
  /** Tarayicida bos birakilir (ayni-origin proxy); Node testlerinde mutlak URL. */
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
  /** Node testleri icin ek basliklar (ör. oturum cerezi). */
  readonly headers?: Readonly<Record<string, string>>
}

export function createHttpCasesAdapter(options: HttpCasesAdapterOptions = {}): CasesDataPort {
  const baseUrl = options.baseUrl ?? ''
  const fetchImpl = options.fetchImpl ?? fetch

  return {
    async listCases(): Promise<readonly CaseRecord[]> {
      let response: Response
      try {
        response = await fetchImpl(`${baseUrl}/api/v1/cases?status=open&pageSize=100`, {
          credentials: 'include',
          headers: { accept: 'application/json', ...(options.headers ?? {}) },
        })
      } catch {
        throw new HttpCasesError('unavailable', 'cases API unreachable')
      }
      if (response.status === 401) {
        throw new HttpCasesError('unauthorized', 'cases API HTTP 401')
      }
      if (!response.ok) {
        throw new HttpCasesError('unavailable', `cases API HTTP ${response.status}`)
      }
      const body = (await response.json()) as { items: CaseListItemDto[] }
      return body.items.map((item) => mapCaseDtoToRecord(item))
    },
  }
}
