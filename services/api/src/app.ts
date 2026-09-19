import Fastify, { type FastifyInstance } from 'fastify'
import { errorHandler, notFoundHandler } from './errors/index.js'
import { registerHealthRoute } from './routes/index.js'
import { registerAuthRoutes, type AuthRoutesOptions } from './auth/routes.js'
import { registerCasesRoutes } from './cases/routes.js'
import { registerCasesWriteRoutes } from './cases/write-routes.js'
import { registerEksistRoutes } from './eksist/routes.js'
import { registerAuditRoutes } from './audit/index.js'
import { registerStorageRoutes } from './storage/index.js'
import { registerDocumentRoutes } from './documents/index.js'
import { registerAgentRoutes } from './agent/index.js'
import { registerDocumentRequirementsRoutes } from './document-requirements/index.js'
import { registerKascoMandatoryCheckRoutes } from './kasco-mandatory-check/index.js'
import { registerReferenceRoutes } from './references/index.js'
import { registerWorkspaceRoutes } from './workspace/index.js'
import { registerFileOperationRoutes } from './file-operations/index.js'
import { registerCaseLifecycleRoutes } from './case-lifecycle/index.js'
import { registerPolicyAnalysisRoutes } from './policy-analysis/index.js'
import { registerTextExtractionRoutes } from './text-extractions/index.js'
import { registerPolicyOcrRoutes } from './policy-ocr/index.js'
import { registerPolicyAiRoutes, type PolicyAiProviderRegistry } from './policy-ai/index.js'
import { registerTrafficValueLossRoutes } from './traffic-value-loss/index.js'
import { registerDashboardRoutes } from './dashboard/index.js'
import { registerCaseOperationsRoutes } from './case-operations/index.js'
import { registerFeeRoutes } from './fees/index.js'
import { registerEmailDraftRoutes } from './email-drafts/index.js'
import { registerEmailAiRoutes, type EmailAiProviderRegistry } from './email-ai/index.js'
import { registerPertRoutes } from './pert/index.js'
import { registerOperationalAlertRoutes } from './operational-alerts/index.js'
import { registerCaseVehicleProfileRoutes } from './case-vehicle-profile/index.js'
import { registerCaseVehicleOwnersRoutes } from './case-vehicle-owners/index.js'
import { registerCaseInventoryRoutes } from './case-inventory/index.js'
import { registerUserRoutes } from './users/index.js'
import { registerV1ImportQuarantineRoutes } from './v1-import-quarantine/index.js'
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
  'req.headers["x-agent-secret"]',
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
  /** Paket 26 provider adapter kaydı. Varsayılan boştur; core AI kapalı çalışır. */
  readonly policyAiProviders?: PolicyAiProviderRegistry
  /** Paket 42 e-posta AI provider kaydı. Varsayılan boştur; e-posta çekirdeği AI olmadan çalışır. */
  readonly emailAiProviders?: EmailAiProviderRegistry
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
    registerCasesWriteRoutes(app, { pool: options.auth.pool })
    registerEksistRoutes(app, { pool: options.auth.pool })
    registerAuditRoutes(app, { pool: options.auth.pool })
    registerStorageRoutes(app, { pool: options.auth.pool })
    registerDocumentRoutes(app, { pool: options.auth.pool })
    registerAgentRoutes(app, { pool: options.auth.pool })
    registerDocumentRequirementsRoutes(app, { pool: options.auth.pool })
    registerKascoMandatoryCheckRoutes(app, { pool: options.auth.pool })
    registerReferenceRoutes(app, { pool: options.auth.pool })
    registerWorkspaceRoutes(app, { pool: options.auth.pool })
    registerFileOperationRoutes(app, { pool: options.auth.pool })
    registerCaseLifecycleRoutes(app, { pool: options.auth.pool })
    registerPolicyAnalysisRoutes(app, { pool: options.auth.pool })
    registerTextExtractionRoutes(app, { pool: options.auth.pool })
    registerPolicyOcrRoutes(app, { pool: options.auth.pool })
    registerPolicyAiRoutes(app, {
      pool: options.auth.pool,
      providers: options.policyAiProviders ?? { get: () => undefined, list: () => [] },
    })
    registerTrafficValueLossRoutes(app, { pool: options.auth.pool })
    registerDashboardRoutes(app, {
      pool: options.auth.pool,
      clock: options.clock ?? systemClock,
    })
    registerCaseOperationsRoutes(app, {
      pool: options.auth.pool,
      clock: options.clock ?? systemClock,
    })
    registerFeeRoutes(app, {
      pool: options.auth.pool,
      clock: options.clock ?? systemClock,
    })
    registerEmailDraftRoutes(app, {
      pool: options.auth.pool,
      clock: options.clock ?? systemClock,
    })
    registerEmailAiRoutes(app, {
      pool: options.auth.pool,
      clock: options.clock ?? systemClock,
      providers: options.emailAiProviders ?? { get: () => undefined, list: () => [] },
    })
    registerPertRoutes(app, {
      pool: options.auth.pool,
    })
    registerOperationalAlertRoutes(app, {
      pool: options.auth.pool,
      clock: options.clock ?? systemClock,
    })
    registerCaseVehicleProfileRoutes(app, { pool: options.auth.pool })
    registerCaseVehicleOwnersRoutes(app, { pool: options.auth.pool })
    registerCaseInventoryRoutes(app, { pool: options.auth.pool, clock: options.clock ?? systemClock })
    registerUserRoutes(app, { pool: options.auth.pool })
    registerV1ImportQuarantineRoutes(app, { pool: options.auth.pool })
  }

  return app
}
