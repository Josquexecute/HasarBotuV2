import { z } from 'zod'
import { utcDateTimeSchema } from '../common/primitives.js'

export const HEALTH_STATUSES = ['ok', 'degraded'] as const
export type HealthStatus = (typeof HEALTH_STATUSES)[number]
export const healthStatusSchema = z.enum(HEALTH_STATUSES)

/**
 * `/health` yaniti sozlesmesi. Surumlu API tabaninin disinda, calisma zamani
 * dogrulanabilir minimum sistem durumu.
 *
 * Bu paket sozlesmeyi tanimlar; gercek servis veya veritabani saglik kontrolu
 * bu pakette uygulanmaz.
 */
export const healthResponseSchema = z.strictObject({
  status: healthStatusSchema,
  service: z.string().min(1),
  version: z.string().min(1),
  checkedAt: utcDateTimeSchema,
})

export type HealthResponse = z.infer<typeof healthResponseSchema>
