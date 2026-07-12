import Fastify, { type FastifyInstance } from 'fastify'
import { errorHandler, notFoundHandler } from './errors/index.js'
import { registerHealthRoute } from './routes/index.js'
import { registerAuthRoutes, type AuthRoutesOptions } from './auth/routes.js'
import { registerCasesRoutes } from './cases/routes.js'
import { systemClock, type Clock } from './clock.js'
import { API_SERVICE_NAME, API_VERSION } from './package-info.js'
import { DEFAULT_LOG_LEVEL, type LogLevel } from './config.js'

/**
 * Log redaksiyonu: kimlik/dogrulama tasiyabilecek alanlar hicbir log
 * seviyesinde ham degerle yazilmaz. Bu liste buildApp icinde YAPISAL olarak
 * uygulanir; disaridan logger nesnesi verilemedigi icin redaksiyon
 * yanlislikla devre disi birakilamaz.
 */
export const REDACTED_LOG_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
] as const

/** Bilincli guvenli varsayimlar (Paket 04). */
export const DEFAULT_BODY_LIMIT_BYTES = 1_048_576
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

export interface BuildAppOptions {
  /** Zaman kaynagi; testler sabit clock enjekte eder. Varsayilan: sistem saati. */
  readonly clock?: Clock
  /** Pino log seviyesi. Varsayilan: `info`. */
  readonly logLevel?: LogLevel
  /** Testlerde log yakalamak icin hedef stream. */
  readonly loggerStream?: { write: (message: string) => void }
  /** `false` ile log tamamen kapatilir (sessiz testler). Varsayilan: acik. */
  readonly loggerEnabled?: boolean
  /**
   * Health icin gercek bagimlilik kontrolu (Paket 05: DB ping). Verilmezse
   * health her zaman `ok` doner. Sonuc `true` degilse `degraded` yansir.
   */
  readonly healthDependencyCheck?: () => Promise<boolean>
  /**
   * Auth uclari (Paket 06). Yalniz DB havuzu yapilandirilmissa verilir;
   * verilmezse /api/v1/auth/* kayitli olmaz ve guvenli 404 doner.
   */
  readonly auth?: AuthRoutesOptions
}

/**
 * Saf uygulama fabrikasi: yapilandirilmis Fastify instance dondurur,
 * KENDILIGINDEN PORT DINLEMEZ. Testler `app.inject` ile gercek TCP portu
 * acmadan calisir. Sunucu yasam dongusu `server.ts` icindedir.
 */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const logger =
    options.loggerEnabled === false
      ? false
      : {
          level: options.logLevel ?? DEFAULT_LOG_LEVEL,
          redact: { paths: [...REDACTED_LOG_PATHS], censor: '[redacted]' },
          ...(options.loggerStream !== undefined ? { stream: options.loggerStream } : {}),
        }

  const app = Fastify({
    logger,
    // Proxy basliklarina guvenilmez; LAN/proxy senaryosu ayri pakettir.
    trustProxy: false,
    bodyLimit: DEFAULT_BODY_LIMIT_BYTES,
    requestTimeout: DEFAULT_REQUEST_TIMEOUT_MS,
    // Istemcinin gonderdigi request-id basligina guvenilmez; Fastify uretir.
    requestIdHeader: false,
  })

  app.setNotFoundHandler(notFoundHandler)
  app.setErrorHandler(errorHandler)
  registerHealthRoute(app, {
    clock: options.clock ?? systemClock,
    service: API_SERVICE_NAME,
    version: API_VERSION,
    ...(options.healthDependencyCheck !== undefined
      ? { dependencyCheck: options.healthDependencyCheck }
      : {}),
  })
  if (options.auth !== undefined) {
    registerAuthRoutes(app, options.auth)
    registerCasesRoutes(app, { pool: options.auth.pool })
  }

  return app
}
