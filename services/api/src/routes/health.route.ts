import type { FastifyInstance } from 'fastify'
import { HEALTH_ROUTE, healthResponseSchema } from '@hasarbotu/contracts'
import type { Clock } from '../clock.js'

export interface HealthRouteOptions {
  readonly clock: Clock
  readonly service: string
  readonly version: string
  /**
   * Opsiyonel gercek bagimlilik kontrolu (Paket 05: veritabani ping'i).
   * Verilmezse `status` her zaman `ok` doner (Paket 04 davranisi korunur).
   * Kontrol sinirli sureli olmali ve hata ayrintisi tasimamalidir.
   */
  readonly dependencyCheck?: () => Promise<boolean>
}

/**
 * `GET /health` — contracts health sozlesmesiyle birebir uyumlu yanit.
 *
 * Bagimlilik kontrolu enjekte edilmisse sonuc `ok`/`degraded` durumuna yansir
 * (HTTP kodu 200 kalir; durum govdededir). Hostname, kullanici, IP, dosya
 * yolu, process.env veya secret yanita eklenmez. Yanit gonderilmeden once
 * contracts semasiyla dogrulanir.
 */
export function registerHealthRoute(app: FastifyInstance, options: HealthRouteOptions): void {
  app.get(HEALTH_ROUTE, async () => {
    let status: 'ok' | 'degraded' = 'ok'
    if (options.dependencyCheck !== undefined) {
      const healthy = await options.dependencyCheck().catch(() => false)
      status = healthy ? 'ok' : 'degraded'
    }
    return healthResponseSchema.parse({
      status,
      service: options.service,
      version: options.version,
      checkedAt: options.clock.nowUtcIso(),
    })
  })
}
