import { HEALTH_ROUTE, healthResponseSchema } from '@hasarbotu/contracts'
import { checkApiCompatibility, type CompatibilityOutcome } from './compatibility.js'

/**
 * API hazırlık kapısı (D3).
 *
 * Kabuk, pencereyi AÇMADAN ÖNCE API'nin ayakta ve UYUMLU olduğunu doğrular.
 * Sorgu main process'ten SUNUCU-SUNUCU yapılır; köprü üzerinden değil. Sebep:
 * `/health`, sürümlü `/api/v1` tabanının DIŞINDADIR (`contracts/common/routes`)
 * ve köprü yalnız `/api/*` iletir. Hazırlık bir renderer sorunu değil, kabuk
 * sorunudur; tarayıcıya hiç uğramaz.
 *
 * Yanıt contracts şemasıyla doğrulanır: kabuk gövdeyi elle ayrıştırmaz ve
 * beklenmeyen bir gövdeyi "hazır" saymaz.
 */

/**
 * Hazırlık sonucu. Uyum katmanının `compatible` başarısı burada `ready`
 * olarak temsil edilir; bu yüzden dışarıda bırakılır ve her sonuç tek bir
 * anlam taşır.
 */
export type ReadinessOutcome =
  | 'ready'
  | 'unreachable'
  | 'invalid_response'
  | 'api_degraded'
  | Exclude<CompatibilityOutcome, 'compatible'>

export interface ReadinessResult {
  readonly outcome: ReadinessOutcome
  readonly ready: boolean
  /** Yalnız yanıt çözümlenebildiyse doldurulur; tanı ve rapor içindir. */
  readonly apiVersion?: string
}

export interface ReadinessProbeOptions {
  readonly apiOrigin: string
  /** Tek denemenin üst süre sınırı. */
  readonly timeoutMs?: number
  /** Test ve yalıtım için enjekte edilebilir; varsayılan global `fetch`. */
  readonly fetchImpl?: typeof fetch
}

export const DEFAULT_READINESS_TIMEOUT_MS = 5_000

/**
 * Tek bir hazırlık sorgusu yapar. Ağ hatası, zaman aşımı, HTTP hatası ve
 * sözleşmeye uymayan gövde ayrı sonuçlara ayrılır; hiçbiri "hazır" sayılmaz.
 *
 * Hata AYRINTISI (ham hata metni, yol, gövde) sonuca taşınmaz — repo
 * genelindeki kural. Yalnız sınıflandırılmış bir sonuç ve varsa API sürümü
 * döner.
 */
export async function probeApiReadiness(options: ReadinessProbeOptions): Promise<ReadinessResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS

  let payload: unknown
  try {
    const response = await fetchImpl(`${options.apiOrigin}${HEALTH_ROUTE}`, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return { outcome: 'unreachable', ready: false }
    payload = await response.json()
  } catch {
    // Ağ hatası, DNS, bağlantı reddi, zaman aşımı ve JSON çözümleme hatası
    // aynı kullanıcı gerçeğine karşılık gelir: API'ye ulaşılamıyor.
    return { outcome: 'unreachable', ready: false }
  }

  const parsed = healthResponseSchema.safeParse(payload)
  if (!parsed.success) return { outcome: 'invalid_response', ready: false }

  const health = parsed.data
  const compatibility = checkApiCompatibility(health.service, health.version)
  if (!compatibility.compatible) {
    return { outcome: compatibility.outcome, ready: false, apiVersion: health.version }
  }
  // API ayakta ama bağımlılığı sağlıksız: oturum açma dâhil her akış
  // başarısız olur. Yarım çalışan bir pencere açmak yerine açıkça bildirilir.
  if (health.status !== 'ok') {
    return { outcome: 'api_degraded', ready: false, apiVersion: health.version }
  }
  return { outcome: 'ready', ready: true, apiVersion: health.version }
}
