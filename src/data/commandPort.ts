import type { CaseRecord } from '../types/case'
import { mapCaseDtoToRecord } from './httpAdapter'

/**
 * CaseCommandPort (Paket 10): dosya olusturma/guncelleme yazma sinirini UI'dan
 * ayirir. HttpApiAdapter Paket 09 kritik-islem uclarina baglanir:
 *   - createCase -> POST /api/v1/cases (zorunlu Idempotency-Key)
 *   - updateCase -> PATCH /api/v1/cases/:caseId (zorunlu expectedVersion)
 * Oturum HttpOnly cerezle tasinir (credentials: 'include'). Mock adapter yalniz
 * demo icindir ve HICBIR yazma yapmaz.
 */

const CASES_ROUTE = '/api/v1/cases'

export interface CaseCreateInput {
  readonly caseType: 'traffic' | 'casco'
  readonly plate: string
  readonly workflowStage?: string
  readonly notificationFormNumber?: string
  readonly insurerClaimNumber?: string
  readonly responsibleUserId?: string
  readonly expertUserId?: string
  readonly serviceId?: string
  readonly insurerId?: string
  readonly followUpDate?: string
  readonly lossDate?: string
  readonly notificationDate?: string
}

export interface CaseUpdateInput {
  readonly serviceRevision?: { readonly name: string }
  readonly expectedVersion: number
  readonly workflowStage?: string
  readonly followUpDate?: string | null
  readonly notificationFormNumber?: string | null
  readonly insurerClaimNumber?: string | null
  readonly responsibleUserId?: string | null
  readonly expertUserId?: string | null
  readonly serviceId?: string | null
  readonly insurerId?: string | null
  readonly lossDate?: string | null
  readonly notificationDate?: string | null
}

/**
 * `unauthorized` 401, `validation` 400 sema, `unknown_reference` 400 org-disi
 * referans, `version_conflict` 409 bayat surum, `idempotency_conflict` 409 ayni
 * anahtar farkli govde, `not_found` 404, `unavailable` ag/5xx.
 */
export type CaseCommandErrorKind =
  | 'unauthorized'
  | 'validation'
  | 'unknown_reference'
  | 'version_conflict'
  | 'idempotency_conflict'
  | 'not_found'
  | 'unavailable'

export interface CaseCommandFieldError {
  readonly path: string
  readonly code: string
}

export class CaseCommandError extends Error {
  readonly kind: CaseCommandErrorKind
  readonly fieldErrors: readonly CaseCommandFieldError[]

  constructor(kind: CaseCommandErrorKind, message: string, fieldErrors: readonly CaseCommandFieldError[] = []) {
    super(message)
    this.name = 'CaseCommandError'
    this.kind = kind
    this.fieldErrors = fieldErrors
  }
}

export interface CaseCommandPort {
  createCase(input: CaseCreateInput, idempotencyKey?: string): Promise<CaseRecord>
  updateCase(caseId: string, input: CaseUpdateInput): Promise<CaseRecord>
}

export interface CaseCommandAdapterOptions {
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
  readonly headers?: Readonly<Record<string, string>>
  /** Idempotency-Key uretimi (test enjeksiyonu icin); varsayilan crypto.randomUUID. */
  readonly idempotencyKeyFactory?: () => string
}

function defaultIdempotencyKey(): string {
  const cryptoRef = (globalThis as {
    crypto?: { randomUUID?: () => string; getRandomValues?: (array: Uint8Array) => Uint8Array }
  }).crypto
  if (cryptoRef?.randomUUID !== undefined) return cryptoRef.randomUUID()
  if (cryptoRef?.getRandomValues !== undefined) {
    const bytes = cryptoRef.getRandomValues(new Uint8Array(16))
    return `idem-${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`
  }
  throw new CaseCommandError('unavailable', 'secure idempotency key generation unavailable')
}

interface FailureBodyShape {
  error?: { code?: string; fieldErrors?: { path?: string; code?: string }[] }
}

function fieldErrorsOf(body: unknown): readonly CaseCommandFieldError[] {
  const errors = (body as FailureBodyShape | null)?.error?.fieldErrors
  if (!Array.isArray(errors)) return []
  return errors.flatMap((item) =>
    typeof item.path === 'string' && typeof item.code === 'string'
      ? [{ path: item.path, code: item.code }]
      : [],
  )
}

/** 400/409 govdesindeki kararli hata kodunu guvenli okur. */
function errorCodeOf(body: unknown): string | undefined {
  const failure = body as FailureBodyShape | null
  const direct = failure?.error?.code
  if (typeof direct === 'string' && direct !== 'validation_error') return direct
  const field = failure?.error?.fieldErrors?.[0]?.code
  return typeof field === 'string' ? field : direct
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function mapCommandError(status: number, body: unknown): CaseCommandError {
  if (status === 401) return new CaseCommandError('unauthorized', 'session required')
  if (status === 404) return new CaseCommandError('not_found', 'case not found')
  const code = errorCodeOf(body)
  const fieldErrors = fieldErrorsOf(body)
  if (status === 409) {
    if (code === 'idempotency_conflict') return new CaseCommandError('idempotency_conflict', 'idempotency conflict')
    return new CaseCommandError('version_conflict', 'version conflict')
  }
  if (status === 400) {
    if (code === 'unknown_reference') return new CaseCommandError('unknown_reference', 'unknown reference', fieldErrors)
    return new CaseCommandError('validation', 'validation failed', fieldErrors)
  }
  return new CaseCommandError('unavailable', `cases command HTTP ${status}`)
}

export function createHttpCaseCommandAdapter(options: CaseCommandAdapterOptions = {}): CaseCommandPort {
  const baseUrl = options.baseUrl ?? ''
  const fetchImpl = options.fetchImpl ?? fetch
  const extraHeaders = options.headers ?? {}
  const makeKey = options.idempotencyKeyFactory ?? defaultIdempotencyKey

  return {
    async createCase(input: CaseCreateInput, idempotencyKey?: string): Promise<CaseRecord> {
      let response: Response
      try {
        response = await fetchImpl(`${baseUrl}${CASES_ROUTE}`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            'idempotency-key': idempotencyKey ?? makeKey(),
            ...extraHeaders,
          },
          body: JSON.stringify(input),
        })
      } catch {
        throw new CaseCommandError('unavailable', 'cases create endpoint unreachable')
      }
      if (response.status !== 201) throw mapCommandError(response.status, await readJson(response))
      const { caseDetailResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = caseDetailResponseSchema.safeParse(await readJson(response))
      if (!parsed.success) throw new CaseCommandError('unavailable', 'cases create response is invalid')
      return mapCaseDtoToRecord(parsed.data.case)
    },

    async updateCase(caseId: string, input: CaseUpdateInput): Promise<CaseRecord> {
      let response: Response
      try {
        response = await fetchImpl(`${baseUrl}${CASES_ROUTE}/${encodeURIComponent(caseId)}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'content-type': 'application/json', accept: 'application/json', ...extraHeaders },
          body: JSON.stringify(input),
        })
      } catch {
        throw new CaseCommandError('unavailable', 'cases update endpoint unreachable')
      }
      if (!response.ok) throw mapCommandError(response.status, await readJson(response))
      const { caseDetailResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = caseDetailResponseSchema.safeParse(await readJson(response))
      if (!parsed.success) throw new CaseCommandError('unavailable', 'cases update response is invalid')
      return mapCaseDtoToRecord(parsed.data.case)
    },
  }
}

/**
 * Demo/mock komut adapteri: yalniz acikca secilen mock modda kullanilir ve
 * HICBIR yazma yapmaz. Cagriyi reddederek "mock modda gercek yazma yok"
 * gercegini gizlemeden yansitir (AI/UI onaysiz yazamaz ilkesiyle uyumlu).
 */
export function createMockCaseCommandAdapter(): CaseCommandPort {
  const refuse = (): Promise<never> =>
    Promise.reject(new CaseCommandError('unavailable', 'mock modda gercek yazma yapilmaz'))
  return {
    createCase: refuse,
    updateCase: refuse,
  }
}
