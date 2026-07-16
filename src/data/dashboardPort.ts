import { caseStages, mockCases } from '../mocks/cases'
import type { CaseStage, CaseStageCode, CaseType } from '../types/case'

export type DashboardPriorityRecord = 'critical' | 'high' | 'medium' | 'normal'
export type DashboardAttentionCodeRecord =
  | 'manual_recovery'
  | 'operation_failed'
  | 'operation_blocked'
  | 'overdue_follow_up'
  | 'human_approval'
  | 'missing_documents'
  | 'document_control_required'
  | 'follow_up_today'
  | 'unassigned'
  | 'upcoming_follow_up'
export type DashboardHumanApprovalKindRecord =
  | 'case_lifecycle'
  | 'policy_analysis'
  | 'policy_ai_review'
  | 'traffic_value_loss'
export type DashboardOpenStageCode = Exclude<CaseStageCode, 'closed'>

export interface DashboardCaseRecord {
  readonly caseId: string
  readonly type: CaseType
  readonly officeNumber: string
  readonly plate: string
  readonly stage: CaseStage
  readonly stageCode: DashboardOpenStageCode
  readonly responsibleUserId: string | null
  readonly responsibleUserName: string
  readonly insurerName: string
  readonly serviceName: string
  readonly followUpDate: string | null
  readonly followUpLabel: string
  readonly followUpTone: 'normal' | 'today' | 'late'
  readonly updatedAt: string
  readonly version: number
  readonly missingDocumentCount: number
  readonly controlRequiredDocumentCount: number
  readonly documentRuleVersion: string
  readonly pendingHumanApprovalCount: number
  readonly pendingHumanApprovalKinds: readonly DashboardHumanApprovalKindRecord[]
  readonly manualRecoveryCount: number
  readonly failedOperationCount: number
  readonly blockedOperationCount: number
  readonly priority: DashboardPriorityRecord
  readonly priorityScore: number
  readonly primaryAttention: DashboardAttentionCodeRecord | null
  readonly attentionCodes: readonly DashboardAttentionCodeRecord[]
  readonly requiresAction: boolean
}

export interface DashboardSummaryRecord {
  readonly openCaseCount: number
  readonly overdueFollowUpCount: number
  readonly dueTodayCount: number
  readonly upcomingFollowUpCount: number
  readonly missingDocumentCaseCount: number
  readonly controlRequiredDocumentCaseCount: number
  readonly pendingHumanApprovalCaseCount: number
  readonly actionRequiredCaseCount: number
  readonly criticalCaseCount: number
}

export interface DashboardSnapshotRecord {
  readonly asOfDate: string
  readonly evaluatedAt: string
  readonly priorityVersion: string
  readonly summary: DashboardSummaryRecord
  readonly stageCounts: Readonly<Record<DashboardOpenStageCode, number>>
  readonly items: readonly DashboardCaseRecord[]
}

export interface DashboardDataPort {
  loadDashboard(): Promise<DashboardSnapshotRecord>
}

const STAGE_LABELS: Readonly<Record<CaseStageCode, CaseStage>> = {
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

const OPEN_STAGE_CODES = Object.entries(STAGE_LABELS)
  .filter(([, label]) => caseStages.includes(label))
  .map(([code]) => code as DashboardOpenStageCode)

const ROOT_KEYS = new Set(['asOfDate', 'evaluatedAt', 'priorityVersion', 'summary', 'stageCounts', 'items'])
const SUMMARY_KEYS = new Set([
  'openCaseCount',
  'overdueFollowUpCount',
  'dueTodayCount',
  'upcomingFollowUpCount',
  'missingDocumentCaseCount',
  'controlRequiredDocumentCaseCount',
  'pendingHumanApprovalCaseCount',
  'actionRequiredCaseCount',
  'criticalCaseCount',
])
const STAGE_COUNT_KEYS = new Set(['stage', 'count'])
const ITEM_KEYS = new Set([
  'caseId',
  'caseType',
  'officeCaseNumber',
  'plate',
  'stage',
  'responsibleUserId',
  'responsibleUserName',
  'insurerName',
  'serviceName',
  'followUpDate',
  'updatedAt',
  'version',
  'missingDocumentCount',
  'controlRequiredDocumentCount',
  'documentRuleVersion',
  'pendingHumanApprovalCount',
  'pendingHumanApprovalKinds',
  'manualRecoveryCount',
  'failedOperationCount',
  'blockedOperationCount',
  'priority',
  'priorityScore',
  'primaryAttention',
  'attentionCodes',
  'requiresAction',
])

const PRIORITIES = new Set<DashboardPriorityRecord>(['critical', 'high', 'medium', 'normal'])
const ATTENTION_CODES = new Set<DashboardAttentionCodeRecord>([
  'manual_recovery',
  'operation_failed',
  'operation_blocked',
  'overdue_follow_up',
  'human_approval',
  'missing_documents',
  'document_control_required',
  'follow_up_today',
  'unassigned',
  'upcoming_follow_up',
])
const APPROVAL_KINDS = new Set<DashboardHumanApprovalKindRecord>([
  'case_lifecycle',
  'policy_analysis',
  'policy_ai_review',
  'traffic_value_loss',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertExactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error('dashboard_response_invalid')
  }
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('dashboard_response_invalid')
  return value
}

function nullableString(value: unknown): string | null {
  if (value === null) return null
  return requiredString(value)
}

function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('dashboard_response_invalid')
  return value as number
}

function uniqueEnumArray<T extends string>(value: unknown, allowed: ReadonlySet<T>): readonly T[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !allowed.has(item as T))) {
    throw new Error('dashboard_response_invalid')
  }
  if (new Set(value).size !== value.length) throw new Error('dashboard_response_invalid')
  return value as T[]
}

function formatFollowUp(followUpDate: string | null, asOfDate: string): {
  label: string
  tone: DashboardCaseRecord['followUpTone']
} {
  if (followUpDate === null) return { label: 'Takip tarihi yok', tone: 'normal' }
  const date = new Date(`${followUpDate}T00:00:00Z`)
  const label = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' }).format(date)
  if (followUpDate < asOfDate) return { label: `Gecikmiş · ${label}`, tone: 'late' }
  if (followUpDate === asOfDate) return { label: 'Bugün', tone: 'today' }
  return { label, tone: 'normal' }
}

function parseDashboardResponse(value: unknown): DashboardSnapshotRecord {
  if (!isRecord(value) || !isRecord(value.summary) || !Array.isArray(value.stageCounts) || !Array.isArray(value.items)) {
    throw new Error('dashboard_response_invalid')
  }
  assertExactKeys(value, ROOT_KEYS)
  assertExactKeys(value.summary, SUMMARY_KEYS)
  const asOfDate = requiredString(value.asOfDate)
  const summary: DashboardSummaryRecord = {
    openCaseCount: count(value.summary.openCaseCount),
    overdueFollowUpCount: count(value.summary.overdueFollowUpCount),
    dueTodayCount: count(value.summary.dueTodayCount),
    upcomingFollowUpCount: count(value.summary.upcomingFollowUpCount),
    missingDocumentCaseCount: count(value.summary.missingDocumentCaseCount),
    controlRequiredDocumentCaseCount: count(value.summary.controlRequiredDocumentCaseCount),
    pendingHumanApprovalCaseCount: count(value.summary.pendingHumanApprovalCaseCount),
    actionRequiredCaseCount: count(value.summary.actionRequiredCaseCount),
    criticalCaseCount: count(value.summary.criticalCaseCount),
  }
  if (value.stageCounts.length !== OPEN_STAGE_CODES.length) throw new Error('dashboard_response_invalid')
  const stageCounts = Object.fromEntries(OPEN_STAGE_CODES.map((stage) => [stage, 0])) as Record<DashboardOpenStageCode, number>
  const seenStages = new Set<DashboardOpenStageCode>()
  for (const raw of value.stageCounts) {
    if (!isRecord(raw)) throw new Error('dashboard_response_invalid')
    assertExactKeys(raw, STAGE_COUNT_KEYS)
    const stage = requiredString(raw.stage) as DashboardOpenStageCode
    if (!OPEN_STAGE_CODES.includes(stage) || seenStages.has(stage)) throw new Error('dashboard_response_invalid')
    seenStages.add(stage)
    stageCounts[stage] = count(raw.count)
  }
  const items = value.items.map((raw): DashboardCaseRecord => {
    if (!isRecord(raw)) throw new Error('dashboard_response_invalid')
    assertExactKeys(raw, ITEM_KEYS)
    const caseType = requiredString(raw.caseType)
    if (caseType !== 'traffic' && caseType !== 'casco') throw new Error('dashboard_response_invalid')
    const stageCode = requiredString(raw.stage) as DashboardOpenStageCode
    const stage = STAGE_LABELS[stageCode]
    if (stage === undefined || stage === 'Kapalı') throw new Error('dashboard_response_invalid')
    const priority = requiredString(raw.priority) as DashboardPriorityRecord
    if (!PRIORITIES.has(priority)) throw new Error('dashboard_response_invalid')
    const primaryAttention = raw.primaryAttention === null
      ? null
      : requiredString(raw.primaryAttention) as DashboardAttentionCodeRecord
    if (primaryAttention !== null && !ATTENTION_CODES.has(primaryAttention)) {
      throw new Error('dashboard_response_invalid')
    }
    const followUpDate = nullableString(raw.followUpDate)
    const followUp = formatFollowUp(followUpDate, asOfDate)
    if (typeof raw.requiresAction !== 'boolean') throw new Error('dashboard_response_invalid')
    return {
      caseId: requiredString(raw.caseId),
      type: caseType === 'traffic' ? 'Trafik' : 'Kasko',
      officeNumber: requiredString(raw.officeCaseNumber),
      plate: requiredString(raw.plate),
      stage,
      stageCode,
      responsibleUserId: nullableString(raw.responsibleUserId),
      responsibleUserName: nullableString(raw.responsibleUserName) ?? 'Atanmamış',
      insurerName: nullableString(raw.insurerName) ?? 'Sigorta atanmamış',
      serviceName: nullableString(raw.serviceName) ?? 'Servis atanmamış',
      followUpDate,
      followUpLabel: followUp.label,
      followUpTone: followUp.tone,
      updatedAt: requiredString(raw.updatedAt),
      version: count(raw.version),
      missingDocumentCount: count(raw.missingDocumentCount),
      controlRequiredDocumentCount: count(raw.controlRequiredDocumentCount),
      documentRuleVersion: requiredString(raw.documentRuleVersion),
      pendingHumanApprovalCount: count(raw.pendingHumanApprovalCount),
      pendingHumanApprovalKinds: uniqueEnumArray(raw.pendingHumanApprovalKinds, APPROVAL_KINDS),
      manualRecoveryCount: count(raw.manualRecoveryCount),
      failedOperationCount: count(raw.failedOperationCount),
      blockedOperationCount: count(raw.blockedOperationCount),
      priority,
      priorityScore: count(raw.priorityScore),
      primaryAttention,
      attentionCodes: uniqueEnumArray(raw.attentionCodes, ATTENTION_CODES),
      requiresAction: raw.requiresAction,
    }
  })
  return {
    asOfDate,
    evaluatedAt: requiredString(value.evaluatedAt),
    priorityVersion: requiredString(value.priorityVersion),
    summary,
    stageCounts,
    items,
  }
}

export type DashboardErrorKind = 'unauthorized' | 'unavailable'

export class DashboardError extends Error {
  readonly kind: DashboardErrorKind

  constructor(kind: DashboardErrorKind, message: string) {
    super(message)
    this.name = 'DashboardError'
    this.kind = kind
  }
}

export interface DashboardAdapterOptions {
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
  readonly headers?: Readonly<Record<string, string>>
}

export function createHttpDashboardAdapter(
  options: DashboardAdapterOptions = {},
): DashboardDataPort {
  const fetchImpl = options.fetchImpl ?? fetch
  const baseUrl = options.baseUrl ?? ''
  return {
    async loadDashboard(): Promise<DashboardSnapshotRecord> {
      let response: Response
      try {
        response = await fetchImpl(`${baseUrl}/api/v1/dashboard`, {
          credentials: 'include',
          headers: { accept: 'application/json', ...(options.headers ?? {}) },
        })
      } catch {
        throw new DashboardError('unavailable', 'dashboard API unreachable')
      }
      if (response.status === 401) throw new DashboardError('unauthorized', 'dashboard API HTTP 401')
      if (!response.ok) throw new DashboardError('unavailable', `dashboard API HTTP ${response.status}`)
      try {
        return parseDashboardResponse(await response.json())
      } catch {
        throw new DashboardError('unavailable', 'dashboard API response invalid')
      }
    },
  }
}

function mockPriority(item: (typeof mockCases)[number]): Pick<
  DashboardCaseRecord,
  'priority' | 'priorityScore' | 'primaryAttention' | 'attentionCodes' | 'requiresAction'
> {
  const attention: DashboardAttentionCodeRecord[] = []
  if (item.followUpTone === 'late') attention.push('overdue_follow_up')
  if (item.status === 'Kontrol Bekliyor') attention.push('human_approval')
  if (item.missingDocuments > 0) attention.push('missing_documents')
  if (item.followUpTone === 'today') attention.push('follow_up_today')
  const primary = attention[0] ?? null
  const base = primary === 'overdue_follow_up' ? 850
    : primary === 'human_approval' ? 750
      : primary === 'missing_documents' ? 650
        : primary === 'follow_up_today' ? 450
          : 0
  return {
    priority: base >= 850 ? 'critical' : base >= 650 ? 'high' : base >= 400 ? 'medium' : 'normal',
    priorityScore: base + Math.max(0, attention.length - 1) * 10,
    primaryAttention: primary,
    attentionCodes: attention,
    requiresAction: attention.length > 0,
  }
}

export function buildMockDashboard(): DashboardSnapshotRecord {
  const items: DashboardCaseRecord[] = mockCases.map((item) => {
    const priority = mockPriority(item)
    const stageCode = (Object.entries(STAGE_LABELS).find(([, label]) => label === item.stage)?.[0]
      ?? 'new_notification') as DashboardOpenStageCode
    return {
      caseId: item.caseId,
      type: item.type,
      officeNumber: item.officeNumber,
      plate: item.plate,
      stage: item.stage,
      stageCode,
      responsibleUserId: item.assignee,
      responsibleUserName: item.assignee,
      insurerName: item.company,
      serviceName: item.service,
      followUpDate: null,
      followUpLabel: item.followUp,
      followUpTone: item.followUpTone,
      updatedAt: '2026-07-10T10:42:00.000Z',
      version: 1,
      missingDocumentCount: item.missingDocuments,
      controlRequiredDocumentCount: 0,
      documentRuleVersion: 'mock',
      pendingHumanApprovalCount: item.status === 'Kontrol Bekliyor' ? 1 : 0,
      pendingHumanApprovalKinds: item.status === 'Kontrol Bekliyor'
        ? (['policy_analysis'] as const)
        : ([] as const),
      manualRecoveryCount: 0,
      failedOperationCount: 0,
      blockedOperationCount: 0,
      ...priority,
    }
  }).sort((left, right) => right.priorityScore - left.priorityScore || left.caseId.localeCompare(right.caseId))
  const countWith = (code: DashboardAttentionCodeRecord) =>
    items.filter((item) => item.attentionCodes.includes(code)).length
  return {
    asOfDate: '2026-07-10',
    evaluatedAt: '2026-07-10T10:42:00.000Z',
    priorityVersion: 'mock-dashboard-priority',
    summary: {
      openCaseCount: items.length,
      overdueFollowUpCount: countWith('overdue_follow_up'),
      dueTodayCount: countWith('follow_up_today'),
      upcomingFollowUpCount: 0,
      missingDocumentCaseCount: items.filter((item) => item.missingDocumentCount > 0).length,
      controlRequiredDocumentCaseCount: 0,
      pendingHumanApprovalCaseCount: items.filter((item) => item.pendingHumanApprovalCount > 0).length,
      actionRequiredCaseCount: items.filter((item) => item.requiresAction).length,
      criticalCaseCount: items.filter((item) => item.priority === 'critical').length,
    },
    stageCounts: Object.fromEntries(OPEN_STAGE_CODES.map((stage) => [
      stage,
      items.filter((item) => item.stageCode === stage).length,
    ])) as Readonly<Record<DashboardOpenStageCode, number>>,
    items,
  }
}
