import type { FastifyInstance } from 'fastify'
import { HEALTH_ROUTE, healthResponseSchema } from '@hasarbotu/contracts'
import type { Clock } from '../clock.js'

export interface HealthRouteOptions {
  readonly clock: Clock
  readonly service: string
  readonly version: string
}

/**
 * `GET /health` — contracts health sozlesmesiyle birebir uyumlu yanit.
 *
 * Gercek database veya bagimlilik kontrolu YAPILMAZ (Paket 04 kapsami);
 * `status` her zaman `ok` doner. Hostname, kullanici, IP, dosya yolu,
 * process.env veya secret yanita eklenmez. Yanit gonderilmeden once
 * contracts semasiyla dogrulanir; sozlesme kaymasi calisma zamaninda yakalanir.
 */
export function registerHealthRoute(app: FastifyInstance, options: HealthRouteOptions): void {
  app.get(HEALTH_ROUTE, async () =>
    healthResponseSchema.parse({
      status: 'ok',
      service: options.service,
      version: options.version,
      checkedAt: options.clock.nowUtcIso(),
    }),
  )
}
