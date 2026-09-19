import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from './server.js'

export {
  buildApp,
  DEFAULT_BODY_LIMIT_BYTES,
  DEFAULT_REQUEST_TIMEOUT_MS,
  REDACTED_LOG_PATHS,
  type BuildAppOptions,
} from './app.js'
export {
  createConfiguredEmailAiProviderRegistry,
  createConfiguredPolicyAiProviderRegistry,
  startServer,
} from './server.js'
export {
  ConfigError,
  DEFAULT_HOST,
  DEFAULT_LOG_LEVEL,
  DEFAULT_NODE_ENV,
  DEFAULT_PORT,
  LOG_LEVELS,
  MAX_PORT,
  MIN_PORT,
  NODE_ENVS,
  parseConfig,
  type ApiConfig,
  type LogLevel,
  type NodeEnv,
} from './config.js'
export { fixedClock, systemClock, type Clock } from './clock.js'
export { API_SERVICE_NAME, API_VERSION } from './package-info.js'

export { ARGON2_OPTIONS, hashPassword, verifyPassword } from './auth/password.js'
export { generateSessionToken, hashSessionToken } from './auth/token.js'
export {
  SESSION_COOKIE_NAME,
  buildClearSessionCookie,
  buildSessionCookie,
  parseCookies,
} from './auth/cookies.js'
export { createFixedWindowLimiter, type FixedWindowLimiter } from './auth/rate-limit.js'
export {
  LOCKOUT_MINUTES,
  MAX_FAILED_LOGINS,
  SESSION_TTL_SECONDS,
} from './auth/service.js'
export { DEFAULT_LOGIN_RATE_LIMIT, registerAuthRoutes, type AuthRoutesOptions } from './auth/routes.js'
export { createAuthStore, type AuthStore } from './auth/store.js'

/**
 * Import edildiginde sunucu BASLATILMAZ. Yalniz gercek entrypoint dogrudan
 * calistirildiginda (node dist/index.js veya tsx watch src/index.ts) baslar.
 */
const entryScript = process.argv[1]
if (entryScript !== undefined && resolve(entryScript) === fileURLToPath(import.meta.url)) {
  void startServer()
}
export { requireSession, resolveSession } from './auth/guard.js'
export { createCasesStore, registerCasesRoutes, type CasesStore } from './cases/index.js'
export {
  createV1ImportQuarantineStore,
  registerV1ImportQuarantineRoutes,
  type V1ImportQuarantineStore,
} from './v1-import-quarantine/index.js'
export { createDashboardStore, registerDashboardRoutes, type DashboardStore } from './dashboard/index.js'
export { createFeeStore, registerFeeRoutes, type FeeStore } from './fees/index.js'
export {
  CaseVehicleProfileError,
  createCaseVehicleProfileStore,
  registerCaseVehicleProfileRoutes,
  type CaseVehicleProfileStore,
} from './case-vehicle-profile/index.js'
export {
  createOperationalAlertStore,
  registerOperationalAlertRoutes,
  type OperationalAlertStore,
} from './operational-alerts/index.js'
export {createDeterministicPolicyAiProviderRegistry,createGeminiPolicyProvider,createOpenAiPolicyProvider,createPolicyAiProviderRegistry,DEFAULT_GEMINI_API_ORIGIN,GEMINI_FREE_TIER_FALLBACK_MODEL_ID,GEMINI_FREE_TIER_MODEL_ID,GEMINI_UNAVAILABLE_BACKOFF_MS,MAX_GEMINI_API_KEY_LENGTH,normalizeGeminiApiKey,type DeterministicPolicyAiProviderRegistry,type GeminiFreeTierModelId,type GeminiPolicyProviderConfig,type OpenAiPolicyProviderConfig,type PolicyAiProviderAdapter,type PolicyAiProviderRegistry} from './policy-ai/index.js'
export {
  createDeterministicEmailAiProviderRegistry,
  createEmailAiProviderRegistry,
  createGeminiEmailAiProvider,
  type DeterministicEmailAiProviderRegistry,
  type EmailAiProviderAdapter,
  type EmailAiProviderDescriptor,
  type EmailAiProviderRequest,
  type EmailAiProviderResponse,
  type EmailAiProviderRegistry,
} from './email-ai/index.js'
export {
  createTrafficValueLossReportStore,
  createTrafficValueLossStore,
  hashTrafficValueLossReportPdf,
  registerTrafficValueLossRoutes,
  renderTrafficValueLossReportPdf,
  trafficValueLossReportFilename,
  TrafficValueLossReportStoreError,
  TrafficValueLossStoreError,
  type TrafficValueLossReportStore,
  type TrafficValueLossStore,
} from './traffic-value-loss/index.js'
export {
  V1_REMEDIATION_MAPPING_VERSION,
  applyV1Import,
  applyV1Remediation,
  discoverV1Folders,
  parseV1TakipJson,
  planV1Import,
  planV1Remediation,
  readV1ClaimTypeFolderEvidence,
  readV1Sidecar,
  v1TakipJsonV1Schema,
  type V1DiscoveredFolder,
  type V1ClaimTypeFolderEvidence,
  type V1ClaimTypePathEvidence,
  type V1ClaimTypeResolution,
  type V1ExplicitResolutionManifest,
  type V1FieldBackfillPlanItem,
  type V1ImportAction,
  type V1ImportApplyOutcome,
  type V1ImportApplyResult,
  type V1ImportPlan,
  type V1ImportPlanEntry,
  type V1ImportPlanSummary,
  type V1NamedAssignment,
  type V1NotePlanItem,
  type V1RemediationApplyResult,
  type V1RemediationEntry,
  type V1RemediationFieldItem,
  type V1RemediationNoteItem,
  type V1RemediationOptions,
  type V1RemediationPlan,
  type V1RemediationSummary,
  type V1RemediationTaskItem,
  type V1ResolutionEvidence,
  type V1ResolvedReference,
  type V1SidecarReadResult,
  type V1TakipJsonParseResult,
  type V1TakipJsonV1,
  type V1TaskPlanItem,
} from './v1-import/index.js'
