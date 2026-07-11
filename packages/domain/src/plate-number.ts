import { brandValue, type Brand } from './brand.js'
import { parseFailure, parseSuccess, type ParseResult } from './parse-result.js'

export type PlateNumber = Brand<string, 'PlateNumber'>
export type PlateSearchKey = Brand<string, 'PlateSearchKey'>

const NON_ALPHANUMERIC = /[^\p{L}\p{N}]+/gu
const TURKISH_PLATE_SEGMENTS = /^(\d{2})([A-Z]{1,3})(\d{2,4})$/

function toSearchKey(value: string): string {
  return value.normalize('NFKC').toUpperCase().replace(NON_ALPHANUMERIC, '')
}

export function parsePlateNumber(value: unknown): ParseResult<PlateNumber> {
  if (typeof value !== 'string') return parseFailure('invalid_type', 'plateNumber')

  const trimmed = value.trim()
  if (trimmed.length === 0) return parseFailure('required', 'plateNumber')

  const searchKey = toSearchKey(trimmed)
  if (searchKey.length === 0) return parseFailure('invalid_format', 'plateNumber')

  const segments = TURKISH_PLATE_SEGMENTS.exec(searchKey)
  const canonical = segments === null
    ? trimmed.normalize('NFKC').toUpperCase().replace(NON_ALPHANUMERIC, ' ').trim()
    : `${segments[1]} ${segments[2]} ${segments[3]}`

  return parseSuccess(brandValue<string, 'PlateNumber'>(canonical))
}

export function plateSearchKey(value: PlateNumber): PlateSearchKey {
  return brandValue<string, 'PlateSearchKey'>(toSearchKey(value))
}
