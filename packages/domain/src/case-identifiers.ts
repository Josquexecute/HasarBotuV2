import { brandValue, type Brand } from './brand.js'
import { parseFailure, parseSuccess, type ParseResult } from './parse-result.js'

export const MIN_OFFICE_CASE_YEAR = 2000
export const MAX_OFFICE_CASE_YEAR = 9999

export interface OfficeCaseNumber {
  readonly year: number
  readonly sequence: number
}

export type NotificationFormNumber = Brand<string, 'NotificationFormNumber'>
export type InsurerClaimNumber = Brand<string, 'InsurerClaimNumber'>

export function createOfficeCaseNumber(year: unknown, sequence: unknown): ParseResult<OfficeCaseNumber> {
  if (typeof year !== 'number' || typeof sequence !== 'number') {
    return parseFailure('invalid_type', 'officeCaseNumber')
  }
  if (!Number.isSafeInteger(year) || !Number.isSafeInteger(sequence)) {
    return parseFailure('invalid_format', 'officeCaseNumber')
  }
  if (year < MIN_OFFICE_CASE_YEAR || year > MAX_OFFICE_CASE_YEAR || sequence < 1) {
    return parseFailure('out_of_range', 'officeCaseNumber')
  }

  return parseSuccess({ year, sequence })
}

export function parseOfficeCaseNumber(value: unknown): ParseResult<OfficeCaseNumber> {
  if (typeof value !== 'string') return parseFailure('invalid_type', 'officeCaseNumber')

  const normalized = value.trim()
  if (normalized.length === 0) return parseFailure('required', 'officeCaseNumber')

  const match = /^(\d{4})\/([1-9]\d*)$/.exec(normalized)
  if (match === null) return parseFailure('invalid_format', 'officeCaseNumber')

  return createOfficeCaseNumber(Number(match[1]), Number(match[2]))
}

export function formatOfficeCaseNumber(value: OfficeCaseNumber): string {
  return `${value.year}/${value.sequence}`
}

function parseReferenceNumber<Name extends string>(
  value: unknown,
  field: string,
): ParseResult<Brand<string, Name>> {
  if (typeof value !== 'string') return parseFailure('invalid_type', field)

  const normalized = value.trim()
  if (normalized.length === 0) return parseFailure('required', field)

  return parseSuccess(brandValue<string, Name>(normalized))
}

export const parseNotificationFormNumber = (value: unknown): ParseResult<NotificationFormNumber> =>
  parseReferenceNumber<'NotificationFormNumber'>(value, 'notificationFormNumber')

export const parseInsurerClaimNumber = (value: unknown): ParseResult<InsurerClaimNumber> =>
  parseReferenceNumber<'InsurerClaimNumber'>(value, 'insurerClaimNumber')
