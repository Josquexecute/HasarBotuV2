import { parseFailure, parseSuccess, type ParseResult } from './parse-result.js'

export const CASE_STATUSES = ['open', 'closed'] as const

export type CaseStatus = (typeof CASE_STATUSES)[number]

export const CASE_STAGES = [
  'new_notification',
  'vehicle_or_service_pending',
  'inspection_pending',
  'damage_assessment',
  'parts_and_labor',
  'repair_approval_pending',
  'under_repair',
  'reporting',
  'closing_documents',
  'ready_to_close',
  'closed',
] as const

export type CaseStage = (typeof CASE_STAGES)[number]

/** Kullanici tarafindan secilebilen acik vaka asamalari; `closed` yalniz lifecycle saga'si tarafindan atanir. */
export const OPEN_CASE_STAGES = CASE_STAGES.filter((stage) => stage !== 'closed')
export type OpenCaseStage = (typeof OPEN_CASE_STAGES)[number]

export function isCaseStatus(value: unknown): value is CaseStatus {
  return typeof value === 'string' && CASE_STATUSES.some((item) => item === value)
}

export function isCaseStage(value: unknown): value is CaseStage {
  return typeof value === 'string' && CASE_STAGES.some((item) => item === value)
}

function parseCode<Value extends string>(
  value: unknown,
  values: readonly Value[],
  field: string,
): ParseResult<Value> {
  if (typeof value !== 'string') return parseFailure('invalid_type', field)

  const normalized = value.trim()
  if (normalized.length === 0) return parseFailure('required', field)
  if (!values.some((item) => item === normalized)) {
    return parseFailure('unsupported_value', field)
  }

  return parseSuccess(normalized as Value)
}

export const parseCaseStatus = (value: unknown): ParseResult<CaseStatus> =>
  parseCode(value, CASE_STATUSES, 'caseStatus')

export const parseCaseStage = (value: unknown): ParseResult<CaseStage> =>
  parseCode(value, CASE_STAGES, 'caseStage')
