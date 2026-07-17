import type { CaseListItem, CaseStageDto } from '@hasarbotu/contracts'
import type { CaseRecord, CaseStage, CaseStatus, CaseType } from '../types/case'
import type { CasesDataPort } from './ports'

/**
 * Cases HTTP siniri:
 * - Basarili cevaplari ortak contracts paketiyle runtime'da dogrular.
 * - Listeyi server pagination'i uzerinden eksiksiz ve deterministik toplar.
 * - Tek case detayini gercek detail endpoint'inden okur.
 */

const STAGE_LABELS: Record<CaseStageDto, CaseStage> = {
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
  closed: 'Kapalı',
}

const MONTHS_TR = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
const MAX_CASE_LIST_PAGES = 10_000

function toLocalDateString(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${value.getFullYear()}-${month}-${day}`
}

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

export function deriveStatus(
  dto: { readonly status: 'open' | 'closed'; readonly followUpDate: string | null },
  today: Date = new Date(),
): CaseStatus {
  if (dto.status === 'closed') return 'Kapalı'
  if (dto.followUpDate !== null && dto.followUpDate < toLocalDateString(today)) return 'Gecikmiş'
  return 'Açık'
}

export function mapCaseDtoToRecord(dto: CaseListItem, today: Date = new Date()): CaseRecord {
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
    stage: STAGE_LABELS[dto.stage],
    missingDocuments: 0,
    assignee: '—',
    expert: '—',
    service: dto.serviceProfile?.name ?? '—',
    followUp,
    followUpTone,
    lastAction: dto.lastInterventionAt ?? '—',
    vehicle: '—',
    insured: '—',
    estimatedDamage: 0,
    notes: [],
    version: dto.version,
    workflowStage: dto.stage,
    responsibleUserId: dto.responsibleUserId,
    expertUserId: dto.expertUserId,
    serviceId: dto.serviceId,
    serviceProfile: dto.serviceProfile,
    insurerId: dto.insurerId,
    followUpDate: dto.followUpDate,
    lossDate: dto.lossDate,
    notificationDate: dto.notificationDate,
    lifecycleStatus: dto.status,
  }
}

export type HttpCasesErrorKind = 'unauthorized' | 'not_found' | 'unavailable'

export class HttpCasesError extends Error {
  readonly kind: HttpCasesErrorKind

  constructor(kind: HttpCasesErrorKind, message: string) {
    super(message)
    this.name = 'HttpCasesError'
    this.kind = kind
  }
}

export interface HttpCasesAdapterOptions {
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
  readonly headers?: Readonly<Record<string, string>>
}

export function createHttpCasesAdapter(options: HttpCasesAdapterOptions = {}): CasesDataPort {
  const baseUrl = options.baseUrl ?? ''
  const fetchImpl = options.fetchImpl ?? fetch
  const headers = { accept: 'application/json', ...(options.headers ?? {}) }

  const requestJson = async (path: string): Promise<unknown> => {
    let response: Response
    try {
      response = await fetchImpl(`${baseUrl}${path}`, { credentials: 'include', headers })
    } catch {
      throw new HttpCasesError('unavailable', 'cases API unreachable')
    }
    if (response.status === 401) throw new HttpCasesError('unauthorized', 'cases API HTTP 401')
    if (response.status === 404) throw new HttpCasesError('not_found', 'cases API HTTP 404')
    if (!response.ok) throw new HttpCasesError('unavailable', `cases API HTTP ${response.status}`)
    try {
      return await response.json()
    } catch {
      throw new HttpCasesError('unavailable', 'cases API returned invalid JSON')
    }
  }

  return {
    async listCases(status = 'open'): Promise<readonly CaseRecord[]> {
      const result: CaseRecord[] = []
      let page = 1
      // Oturum 401'i, buyuyen contracts chunk'i yuklenene kadar gecikmesin.
      // Ilk istek ve runtime sema yuklemesi paralel baslar; Promise.all 401'i
      // hemen reddederek global "oturum sona erdi" kapisini tetikler.
      const [{ caseListResponseSchema }, firstPagePayload] = await Promise.all([
        import('@hasarbotu/contracts'),
        requestJson(`/api/v1/cases?status=${status}&page=${page}&pageSize=100`),
      ])
      let pagePayload = firstPagePayload
      while (true) {
        const parsed = caseListResponseSchema.safeParse(
          pagePayload,
        )
        if (!parsed.success || parsed.data.pageInfo.page !== page
          || parsed.data.pageInfo.totalPages > MAX_CASE_LIST_PAGES) {
          throw new HttpCasesError('unavailable', 'cases API pagination response is invalid')
        }
        result.push(...parsed.data.items.map((item) => mapCaseDtoToRecord(item)))
        if (page >= parsed.data.pageInfo.totalPages) return result
        page += 1
        pagePayload = await requestJson(`/api/v1/cases?status=${status}&page=${page}&pageSize=100`)
      }
    },

    async getCase(caseId: string): Promise<CaseRecord> {
      const { caseDetailResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = caseDetailResponseSchema.safeParse(
        await requestJson(`/api/v1/cases/${encodeURIComponent(caseId)}`),
      )
      if (!parsed.success) throw new HttpCasesError('unavailable', 'case detail response is invalid')
      return mapCaseDtoToRecord(parsed.data.case)
    },
  }
}
