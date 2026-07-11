import { brandValue, type Brand } from './brand.js'
import { parseFailure, parseSuccess, type ParseResult } from './parse-result.js'

export type EntityVersion = Brand<number, 'EntityVersion'>

export function parseEntityVersion(value: unknown): ParseResult<EntityVersion> {
  if (typeof value !== 'number') return parseFailure('invalid_type', 'entityVersion')
  if (!Number.isSafeInteger(value)) return parseFailure('invalid_format', 'entityVersion')
  if (value < 1) return parseFailure('out_of_range', 'entityVersion')

  return parseSuccess(brandValue<number, 'EntityVersion'>(value))
}

export function isEntityVersion(value: unknown): value is EntityVersion {
  return parseEntityVersion(value).ok
}

export function incrementEntityVersion(value: EntityVersion): ParseResult<EntityVersion> {
  if (value >= Number.MAX_SAFE_INTEGER) return parseFailure('overflow', 'entityVersion')
  return parseSuccess(brandValue<number, 'EntityVersion'>(value + 1))
}
