export const CASE_NOTE_TYPES = ['internal', 'contact'] as const
export const CASE_TASK_PRIORITIES = ['low', 'normal', 'high'] as const
export const CASE_TASK_STATUSES = ['open', 'completed', 'cancelled'] as const
export const CASE_TASK_DUE_STATUSES = ['overdue', 'today', 'upcoming', 'scheduled'] as const

export type CaseNoteType = (typeof CASE_NOTE_TYPES)[number]
export type CaseTaskPriority = (typeof CASE_TASK_PRIORITIES)[number]
export type CaseTaskStatus = (typeof CASE_TASK_STATUSES)[number]
export type CaseTaskDueStatus = (typeof CASE_TASK_DUE_STATUSES)[number]

export interface CaseTaskTransition {
  readonly from: CaseTaskStatus
  readonly to: CaseTaskStatus
}
export function canTransitionCaseTask(input: CaseTaskTransition): boolean {
  return input.from === 'open' && (input.to === 'completed' || input.to === 'cancelled')
}

function localDateDayNumber(value: string): number {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number]
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}

export function classifyCaseTaskDueDate(
  dueDate: string,
  asOfDate: string,
): CaseTaskDueStatus {
  const difference = localDateDayNumber(dueDate) - localDateDayNumber(asOfDate)
  if (difference < 0) return 'overdue'
  if (difference === 0) return 'today'
  if (difference <= 7) return 'upcoming'
  return 'scheduled'
}
