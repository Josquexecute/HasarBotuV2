import type { CaseListItem, CaseLegacyReferences } from '@hasarbotu/contracts'
import { CASE_STAGE_LABELS as STAGE_LABELS } from './caseStages'
import { toOfficeDate } from '@hasarbotu/domain'
import type { CaseRecord, CaseStatus, CaseType } from '../types/case'
import type { CasePageQuery, CasePageResult, CasesDataPort } from './ports'

/**
 * Cases HTTP siniri:
 * - Basarili cevaplari ortak contracts paketiyle runtime'da dogrular.
 * - Listeyi server pagination'i uzerinden eksiksiz ve deterministik toplar.
 * - Tek case detayini gercek detail endpoint'inden okur.
 */

const MONTHS_TR = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
const MAX_CASE_LIST_PAGES = 10_000

export function deriveFollowUp(followUpDate: string | null, today: Date | string = new Date()): {
  followUp: string
  followUpTone: CaseRecord['followUpTone']
} {
  if (followUpDate === null) return { followUp: '—', followUpTone: 'normal' }
  const todayString = toOfficeDate(today)
  if (followUpDate === todayString) return { followUp: 'Bugün', followUpTone: 'today' }

  const [year, month, day] = followUpDate.split('-').map(Number) as [number, number, number]
  const label = `${day} ${MONTHS_TR[month - 1]}${year === Number(todayString.slice(0, 4)) ? '' : ` ${year}`}`
  return {
    followUp: label,
    followUpTone: followUpDate < todayString ? 'late' : 'normal',
  }
}

export function deriveStatus(
  dto: { readonly status: 'open' | 'closed'; readonly followUpDate: string | null },
  today: Date | string = new Date(),
): CaseStatus {
  if (dto.status === 'closed') return 'Kapalı'
  if (dto.followUpDate !== null && dto.followUpDate < toOfficeDate(today)) return 'Gecikmiş'
  return 'Açık'
}

export function mapCaseDtoToRecord(
  dto: CaseListItem & { readonly legacyReferences?: CaseLegacyReferences },
  today: Date = new Date(),
): CaseRecord {
  const { followUp, followUpTone } = deriveFollowUp(dto.followUpDate, today)
  const caseType: CaseType = dto.caseType === null ? 'Seçiniz' : dto.caseType === 'traffic' ? 'Trafik' : 'Kasko'
  return {
    caseId: dto.id,
    plate: dto.plate,
    transmission: dto.transmission ?? 'unknown',
    officeNumber: dto.officeCaseNumber,
    noticeNumber: dto.notificationFormNumber ?? '—',
    claimNumber: dto.insurerClaimNumber ?? '—',
    company: dto.eksist?.insurerName ?? '—',
    type: caseType,
    status: deriveStatus(dto, today),
    stage: STAGE_LABELS[dto.stage],
    missingDocuments: 0,
    assignee: '—',
    expert: dto.eksist?.expertName ?? '—',
    service: dto.serviceDetails?.name ?? dto.eksist?.serviceName ?? dto.serviceProfile?.name ?? '—',
    followUp,
    followUpTone,
    lastAction: dto.lastInterventionAt ?? '—',
    vehicle: dto.eksist ? ['Marka', 'Araç Tipi', 'Model Yılı'].map(label => dto.eksist!.vehicleFields[label]).filter(Boolean).join(' · ') : '—',
    insured: '—',
    estimatedDamage: 0,
    notes: [],
    version: dto.version,
    workflowStage: dto.stage,
    responsibleUserId: dto.responsibleUserId,
    expertUserId: dto.expertUserId,
    serviceId: dto.serviceId,
    ...(dto.serviceDetails === undefined ? {} : { serviceDetails: dto.serviceDetails }),
    serviceProfile: dto.serviceProfile,
    insurerId: dto.insurerId,
    followUpDate: dto.followUpDate,
    lossDate: dto.lossDate,
    notificationDate: dto.notificationDate,
    lifecycleStatus: dto.status,
    ...(dto.eksist ? { eksist: dto.eksist } : {}),
    ...(dto.legacyReferences === undefined ? {} : { legacyReferences: dto.legacyReferences }),
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
        requestJson(`/api/v1/cases?status=${status}&page=${page}&pageSize=100&includeEksist=true&includeServiceDetails=true`),
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
        pagePayload = await requestJson(`/api/v1/cases?status=${status}&page=${page}&pageSize=100&includeEksist=true&includeServiceDetails=true`)
      }
    },

    /**
     * Tek sayfa okur (Paket 53). Filtre, sıralama ve sayfalama sunucuda uygulanır;
     * istemci hiçbir zaman bütün listeyi çekip kendisi sayfalamaz.
     */
    async listCasePage(query: CasePageQuery): Promise<CasePageResult> {
      const search = new URLSearchParams()
      search.set('includeEksist', 'true')
      search.set('includeServiceDetails', 'true')
      search.set('page', String(query.page))
      search.set('pageSize', String(query.pageSize))
      if (query.status !== undefined) search.set('status', query.status)
      if (query.search !== undefined && query.search.trim() !== '') {
        search.set('search', query.search.trim())
      }
      if (query.caseType !== undefined) search.set('caseType', query.caseType)
      if (query.stage !== undefined) search.set('stage', query.stage)
      if (query.responsibleUserId !== undefined) search.set('responsibleUserId', query.responsibleUserId)
      if (query.serviceId !== undefined) search.set('serviceId', query.serviceId)
      if (query.serviceName !== undefined) search.set('serviceName', query.serviceName)
      if (query.followUpFrom !== undefined) search.set('followUpFrom', query.followUpFrom)
      if (query.followUpTo !== undefined) search.set('followUpTo', query.followUpTo)
      if (query.sortBy !== undefined) search.set('sortBy', query.sortBy)
      if (query.sortDirection !== undefined) search.set('sortDirection', query.sortDirection)

      const [{ caseListResponseSchema }, payload] = await Promise.all([
        import('@hasarbotu/contracts'),
        requestJson(`/api/v1/cases?${search.toString()}`),
      ])
      const parsed = caseListResponseSchema.safeParse(payload)
      if (!parsed.success || parsed.data.pageInfo.totalPages > MAX_CASE_LIST_PAGES) {
        throw new HttpCasesError('unavailable', 'cases API pagination response is invalid')
      }
      return {
        items: parsed.data.items.map((item) => mapCaseDtoToRecord(item)),
        page: parsed.data.pageInfo.page,
        pageSize: parsed.data.pageInfo.pageSize,
        totalCount: parsed.data.pageInfo.totalItems,
        totalPages: parsed.data.pageInfo.totalPages,
      }
    },

    async getCase(caseId: string): Promise<CaseRecord> {
      const { caseDetailWithLegacyReferencesResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = caseDetailWithLegacyReferencesResponseSchema.safeParse(
        await requestJson(`/api/v1/cases/${encodeURIComponent(caseId)}?includeLegacyReferences=true&includeEksist=true&includeServiceDetails=true`),
      )
      if (!parsed.success) throw new HttpCasesError('unavailable', 'case detail response is invalid')
      return mapCaseDtoToRecord(parsed.data.case)
    },
  }
}
