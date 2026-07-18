export type OperationalAlertTypeRecord =
  | 'overdue_task'
  | 'overdue_follow_up'
  | 'missing_required_document'

export type OperationalAlertSeverityRecord = 'high' | 'medium' | 'low'

export interface OperationalAlertRecord {
  readonly dedupeKey: string
  readonly type: OperationalAlertTypeRecord
  readonly severity: OperationalAlertSeverityRecord
  readonly caseId: string
  readonly plate: string
  readonly officeNumber: string
  readonly summary: string
  readonly sourceDate: string
  readonly caseDetailPath: string
}

export interface OperationalAlertsRecord {
  readonly schemaVersion: 'operational-alert/1.0.0'
  readonly totalCount: number
  readonly evaluatedAt: string
  readonly alerts: readonly OperationalAlertRecord[]
}

export interface OperationalAlertDataPort {
  list(): Promise<OperationalAlertsRecord>
}

/** Durum Panosu özetinde gösterilen öne çıkan uyarı sayısı (tam liste Bildirimler'dedir). */
export const DASHBOARD_ALERT_PREVIEW_LIMIT = 3

export type OperationalAlertTypeCounts = Readonly<Record<OperationalAlertTypeRecord, number>>

/**
 * Yanıttaki uyarıların tür dağılımı. İkinci bir türetim değildir: yalnız API'nin
 * döndürdüğü listeyi sayar. Toplam sayaç bu fonksiyondan değil, yanıttaki
 * `totalCount` alanından okunmalıdır.
 */
export function countOperationalAlertsByType(
  alerts: readonly OperationalAlertRecord[],
): OperationalAlertTypeCounts {
  const counts: Record<OperationalAlertTypeRecord, number> = {
    overdue_task: 0,
    overdue_follow_up: 0,
    missing_required_document: 0,
  }
  for (const alert of alerts) counts[alert.type] += 1
  return counts
}

export type OperationalAlertErrorKind = 'unauthorized' | 'forbidden' | 'unavailable'

export class OperationalAlertError extends Error {
  readonly kind: OperationalAlertErrorKind

  constructor(kind: OperationalAlertErrorKind, message: string) {
    super(message)
    this.name = 'OperationalAlertError'
    this.kind = kind
  }
}

export interface OperationalAlertAdapterOptions {
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
  readonly headers?: Readonly<Record<string, string>>
}

function mapError(status: number): OperationalAlertError {
  if (status === 401) return new OperationalAlertError('unauthorized', 'session required')
  if (status === 403) return new OperationalAlertError('forbidden', 'permission required')
  return new OperationalAlertError('unavailable', `operational alerts HTTP ${status}`)
}

/**
 * Salt okunur uyarı adaptörü. Hata durumunda MOCK'A DÜŞMEZ: çağıran taraf
 * gerçek boş durum veya erişilemez durumu gösterir.
 */
export function createHttpOperationalAlertAdapter(
  options: OperationalAlertAdapterOptions = {},
): OperationalAlertDataPort {
  const baseUrl = options.baseUrl ?? ''
  const fetchImpl = options.fetchImpl ?? fetch
  const headers = options.headers ?? {}

  return {
    async list() {
      let response: Response
      try {
        response = await fetchImpl(`${baseUrl}/api/v1/operational-alerts`, {
          method: 'GET',
          credentials: 'include',
          headers: { accept: 'application/json', ...headers },
        })
      } catch {
        throw new OperationalAlertError('unavailable', 'operational alerts endpoint unreachable')
      }
      if (!response.ok) throw mapError(response.status)
      let value: unknown
      try {
        value = await response.json()
      } catch {
        throw new OperationalAlertError('unavailable', 'operational alerts response invalid')
      }
      const { operationalAlertsResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = operationalAlertsResponseSchema.safeParse(value)
      if (!parsed.success) {
        throw new OperationalAlertError('unavailable', 'operational alerts response invalid')
      }
      return parsed.data
    },
  }
}
