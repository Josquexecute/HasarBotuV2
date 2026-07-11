import { parseFailure, parseSuccess, type ParseResult } from './parse-result.js'

export const CASE_TYPES = ['traffic', 'casco'] as const

export type CaseType = (typeof CASE_TYPES)[number]

export function isCaseType(value: unknown): value is CaseType {
  return typeof value === 'string' && CASE_TYPES.some((item) => item === value)
}

export function parseCaseType(value: unknown): ParseResult<CaseType> {
  if (typeof value !== 'string') return parseFailure('invalid_type', 'caseType')

  const normalized = value.trim()
  if (normalized.length === 0) return parseFailure('required', 'caseType')
  if (!isCaseType(normalized)) {
    return parseFailure('unsupported_value', 'caseType')
  }

  return parseSuccess(normalized)
}

export function isValueLossRequired(caseType: CaseType): boolean {
  return caseType === 'traffic'
}
