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
export { startServer } from './server.js'
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
export {createDeterministicPolicyAiProviderRegistry,type DeterministicPolicyAiProviderRegistry,type PolicyAiProviderAdapter,type PolicyAiProviderRegistry} from './policy-ai/index.js'
