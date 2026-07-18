import type { CasePageQuery } from '../../data'
import type { CaseStage, CaseType } from '../../types/case'

/**
 * Dosyalar ekranı filtre durumunu sunucu sorgusuna çevirir (Paket 53).
 *
 * Saf ve test edilebilir: filtreleme, sıralama ve sayfalama sunucuda uygulanır;
 * bileşen hiçbir iş kuralı taşımaz. Sunucunun desteklemediği bir filtre burada
 * uydurulmaz — desteklenen alanlara birebir eşlenir.
 */

export const CASES_PAGE_SIZE = 50

export type CaseStatusFilter = 'Tümü' | 'Açık' | 'Gecikmiş' | 'Kapalı'
export type FollowUpFilter = 'Tümü' | 'late' | 'today' | 'normal'
/**
 * Sunucunun desteklediği sıralama alanları. Tablo başlıklarındaki diğer
 * sütunlar (şirket, aşama, eksik evrak, sorumlu) sunucuda sıralanamaz; API
 * modunda tıklanabilir sunulmazlar ki tıklama sessizce yutulmasın.
 */
export const SERVER_SORT_KEYS = ['lastAction', 'followUp', 'officeNumber', 'plate'] as const
export type CaseSortKey = (typeof SERVER_SORT_KEYS)[number]

export function isServerSortKey(value: string): value is CaseSortKey {
  return (SERVER_SORT_KEYS as readonly string[]).includes(value)
}

export interface CasesFilterState {
  readonly query: string
  readonly typeFilter: 'Tümü' | CaseType
  readonly stageFilter: 'Tümü' | CaseStage
  readonly statusFilter: CaseStatusFilter
  readonly responsibleUserId: 'Tümü' | string
  readonly serviceId: 'Tümü' | string
  readonly followUpFilter: FollowUpFilter
  readonly sortKey: CaseSortKey
  readonly direction: 'asc' | 'desc'
  readonly page: number
}

const CASE_TYPE_CODES: Record<CaseType, 'traffic' | 'casco'> = {
  Trafik: 'traffic',
  Kasko: 'casco',
}

const STAGE_CODES: Record<CaseStage, string> = {
  'Yeni İhbar': 'new_notification',
  'Araç / Servis Bekleniyor': 'vehicle_or_service_pending',
  'Ekspertiz Bekliyor': 'inspection_pending',
  'Hasar Tespiti': 'damage_assessment',
  'Parça ve İşçilik': 'parts_and_labor',
  'Onarım Onayı Bekleniyor': 'repair_approval_pending',
  Onarımda: 'under_repair',
  Raporlama: 'reporting',
  'Kapanış Evrakları': 'closing_documents',
  'Kapanmaya Hazır': 'ready_to_close',
  Kapalı: 'closed',
}

const SORT_FIELDS: Record<CaseSortKey, CasePageQuery['sortBy']> = {
  lastAction: 'updatedAt',
  followUp: 'followUpDate',
  officeNumber: 'officeCaseNumber',
  plate: 'plate',
}

function shiftDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number) as [number, number, number]
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return shifted.toISOString().slice(0, 10)
}

/**
 * Takip aralığı. `Gecikmiş` durumu ve `late` takip filtresi aynı sınırı kullanır;
 * ikisi birlikte seçilirse aralık kesişimi alınır (daha dar olan kazanır).
 */
function followUpRange(
  statusFilter: CaseStatusFilter,
  followUpFilter: FollowUpFilter,
  today: string,
): { from?: string; to?: string } {
  const yesterday = shiftDate(today, -1)
  const bounds: { from?: string; to?: string } = {}
  const apply = (next: { from?: string; to?: string }): void => {
    if (next.from !== undefined && (bounds.from === undefined || next.from > bounds.from)) {
      bounds.from = next.from
    }
    if (next.to !== undefined && (bounds.to === undefined || next.to < bounds.to)) {
      bounds.to = next.to
    }
  }
  // "Gecikmiş" sunucuda ayrı bir durum değildir: açık dosya + geçmiş takip tarihi.
  if (statusFilter === 'Gecikmiş') apply({ to: yesterday })
  if (followUpFilter === 'late') apply({ to: yesterday })
  if (followUpFilter === 'today') apply({ from: today, to: today })
  if (followUpFilter === 'normal') apply({ from: today })
  return bounds
}

export function buildCasesPageQuery(
  state: CasesFilterState,
  today: string,
  pageSize: number = CASES_PAGE_SIZE,
): CasePageQuery {
  const { from, to } = followUpRange(state.statusFilter, state.followUpFilter, today)
  return {
    // "Gecikmiş" de açık dosyadır; yalnız "Kapalı" seçimi closed'a gider.
    status: state.statusFilter === 'Kapalı' ? 'closed' : 'open',
    ...(state.query.trim() === '' ? {} : { search: state.query.trim() }),
    ...(state.typeFilter === 'Tümü' ? {} : { caseType: CASE_TYPE_CODES[state.typeFilter] }),
    ...(state.stageFilter === 'Tümü' ? {} : { stage: STAGE_CODES[state.stageFilter] }),
    ...(state.responsibleUserId === 'Tümü' ? {} : { responsibleUserId: state.responsibleUserId }),
    ...(state.serviceId === 'Tümü' ? {} : { serviceId: state.serviceId }),
    ...(from === undefined ? {} : { followUpFrom: from }),
    ...(to === undefined ? {} : { followUpTo: to }),
    sortBy: SORT_FIELDS[state.sortKey],
    sortDirection: state.direction,
    page: state.page,
    pageSize,
  }
}

/**
 * Sayfa numarasını geçerli aralığa çeker. Son sayfadaki kayıtlar silinir veya
 * filtre dışı kalırsa istemci boş sayfada takılı kalmaz.
 */
export function clampPage(page: number, totalPages: number): number {
  if (totalPages <= 0) return 1
  if (page < 1) return 1
  return Math.min(page, totalPages)
}

/** Filtre/arama/sıralama değişimini sayfa sıfırlaması için tespit eder. */
export function filterIdentity(state: CasesFilterState): string {
  return [
    state.query.trim(),
    state.typeFilter,
    state.stageFilter,
    state.statusFilter,
    state.responsibleUserId,
    state.serviceId,
    state.followUpFilter,
    state.sortKey,
    state.direction,
  ].join('|')
}
