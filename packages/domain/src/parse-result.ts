export const DOMAIN_PARSE_ERROR_CODES = [
  'required',
  'invalid_type',
  'invalid_format',
  'unsupported_value',
  'out_of_range',
  'overflow',
] as const

export type DomainParseErrorCode = (typeof DOMAIN_PARSE_ERROR_CODES)[number]

export interface DomainParseError {
  readonly code: DomainParseErrorCode
  readonly field?: string
}

export type ParseResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: DomainParseError }

export function parseSuccess<Value>(value: Value): ParseResult<Value> {
  return { ok: true, value }
}

export function parseFailure<Value>(
  code: DomainParseErrorCode,
  field?: string,
): ParseResult<Value> {
  return field === undefined
    ? { ok: false, error: { code } }
    : { ok: false, error: { code, field } }
}
