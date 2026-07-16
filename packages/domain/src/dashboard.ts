export const DASHBOARD_PRIORITY_VERSION = 'dashboard-priority/1.0.0' as const

export const DASHBOARD_ATTENTION_CODES = [
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
] as const

export type DashboardAttentionCode = (typeof DASHBOARD_ATTENTION_CODES)[number]
export type DashboardPriority = 'critical' | 'high' | 'medium' | 'normal'

export interface DashboardPriorityInput {
  readonly caseId: string
  readonly officeCaseNumber: string
  readonly updatedAt: string
  readonly followUpDate: string | null
  readonly responsibleUserId: string | null
  readonly missingDocumentCount: number
  readonly controlRequiredDocumentCount: number
  readonly pendingHumanApprovalCount: number
  readonly manualRecoveryCount: number
  readonly failedOperationCount: number
  readonly blockedOperationCount: number
}

export interface DashboardPriorityResult {
  readonly priority: DashboardPriority
  readonly priorityScore: number
  readonly primaryAttention: DashboardAttentionCode | null
  readonly attentionCodes: readonly DashboardAttentionCode[]
  readonly requiresAction: boolean
}

const ATTENTION_BASE_SCORE: Readonly<Record<DashboardAttentionCode, number>> = {
  manual_recovery: 1_000,
  operation_failed: 950,
  operation_blocked: 900,
  overdue_follow_up: 850,
  human_approval: 750,
  missing_documents: 650,
  document_control_required: 550,
  follow_up_today: 450,
  unassigned: 400,
  upcoming_follow_up: 300,
}

function localDateDayNumber(value: string): number {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number]
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}

export function daysBetweenLocalDates(from: string, to: string): number {
  return localDateDayNumber(to) - localDateDayNumber(from)
}

export function evaluateDashboardPriority(
  input: DashboardPriorityInput,
  asOfDate: string,
): DashboardPriorityResult {
  const attention = new Set<DashboardAttentionCode>()
  if (input.manualRecoveryCount > 0) attention.add('manual_recovery')
  if (input.failedOperationCount > 0) attention.add('operation_failed')
  if (input.blockedOperationCount > 0) attention.add('operation_blocked')
  if (input.pendingHumanApprovalCount > 0) attention.add('human_approval')
  if (input.missingDocumentCount > 0) attention.add('missing_documents')
  if (input.controlRequiredDocumentCount > 0) attention.add('document_control_required')
  if (input.responsibleUserId === null) attention.add('unassigned')

  if (input.followUpDate !== null) {
    const days = daysBetweenLocalDates(asOfDate, input.followUpDate)
    if (days < 0) attention.add('overdue_follow_up')
    else if (days === 0) attention.add('follow_up_today')
    else if (days <= 7) attention.add('upcoming_follow_up')
  }

  const attentionCodes = DASHBOARD_ATTENTION_CODES.filter((code) => attention.has(code))
  const primaryAttention = attentionCodes[0] ?? null
  const baseScore = primaryAttention === null ? 0 : ATTENTION_BASE_SCORE[primaryAttention]
  const secondaryWeight = Math.min(99, Math.max(0, attentionCodes.length - 1) * 10)
  const countWeight = Math.min(
    9,
    input.missingDocumentCount
      + input.controlRequiredDocumentCount
      + input.pendingHumanApprovalCount
      + input.manualRecoveryCount
      + input.failedOperationCount
      + input.blockedOperationCount,
  )
  const priorityScore = baseScore + secondaryWeight + countWeight
  const priority: DashboardPriority =
    baseScore >= 850 ? 'critical'
      : baseScore >= 650 ? 'high'
        : baseScore >= 400 ? 'medium'
          : 'normal'

  return {
    priority,
    priorityScore,
    primaryAttention,
    attentionCodes,
    requiresAction: attentionCodes.length > 0,
  }
}

export interface DashboardSortableItem {
  readonly caseId: string
  readonly priorityScore: number
  readonly followUpDate: string | null
  readonly updatedAt: string
}

export function compareDashboardItems(
  left: DashboardSortableItem,
  right: DashboardSortableItem,
): number {
  if (left.priorityScore !== right.priorityScore) return right.priorityScore - left.priorityScore
  if (left.followUpDate !== right.followUpDate) {
    if (left.followUpDate === null) return 1
    if (right.followUpDate === null) return -1
    return left.followUpDate.localeCompare(right.followUpDate)
  }
  const updatedComparison = left.updatedAt.localeCompare(right.updatedAt)
  if (updatedComparison !== 0) return updatedComparison
  return left.caseId.localeCompare(right.caseId)
}
