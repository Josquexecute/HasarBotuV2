import { brandValue, type Brand } from './brand.js'
import { parseFailure, parseSuccess, type ParseResult } from './parse-result.js'

export type UtcDateTime = Brand<string, 'UtcDateTime'>
export type LocalDate = Brand<string, 'LocalDate'>

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const UTC_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{3})?Z$/

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return false

  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= (daysInMonth[month - 1] ?? 0)
}

export function parseLocalDate(value: unknown): ParseResult<LocalDate> {
  if (typeof value !== 'string') return parseFailure('invalid_type', 'localDate')

  const match = LOCAL_DATE_PATTERN.exec(value)
  if (match === null) return parseFailure('invalid_format', 'localDate')

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!isValidCalendarDate(year, month, day)) return parseFailure('out_of_range', 'localDate')

  return parseSuccess(brandValue<string, 'LocalDate'>(value))
}

export function parseUtcDateTime(value: unknown): ParseResult<UtcDateTime> {
  if (typeof value !== 'string') return parseFailure('invalid_type', 'utcDateTime')

  const match = UTC_DATE_TIME_PATTERN.exec(value)
  if (match === null) return parseFailure('invalid_format', 'utcDateTime')

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  if (!isValidCalendarDate(year, month, day) || hour > 23 || minute > 59 || second > 59) {
    return parseFailure('out_of_range', 'utcDateTime')
  }

  return parseSuccess(brandValue<string, 'UtcDateTime'>(value))
}

export function isLocalDate(value: unknown): value is LocalDate {
  return parseLocalDate(value).ok
}

export function isUtcDateTime(value: unknown): value is UtcDateTime {
  return parseUtcDateTime(value).ok
}
