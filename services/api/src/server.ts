import {
  checkDatabaseHealth,
  closeDatabasePool,
  createDatabasePool,
  parseDatabaseUrl,
} from '@hasarbotu/database'
import type pg from 'pg'
import { buildApp } from './app.js'
import { ConfigError, parseConfig, type ApiConfig } from './config.js'
import {
  createGeminiPolicyProvider,
  createOpenAiPolicyProvider,
  createPolicyAiProviderRegistry,
  GEMINI_POLICY_PROVIDER_ID,
  type PolicyAiProviderAdapter,
  type PolicyAiProviderRegistry,
} from './policy-ai/index.js'
import {
  createEmailAiProviderRegistry,
  createGeminiEmailAiProvider,
  type EmailAiProviderAdapter,
  type EmailAiProviderRegistry,
} from './email-ai/index.js'
import {
  createGeminiLaborAllocationProvider,
  createLaborAllocationProviderRegistry,
  type LaborAllocationProviderRegistry,
} from './labor-allocation-ai/index.js'

/** Server environment config'inden secret sızdırmadan provider registry kurar. */
export function createConfiguredPolicyAiProviderRegistry(
  config: Pick<ApiConfig, 'openAiPolicyProvider' | 'geminiPolicyProvider'>,
): PolicyAiProviderRegistry {
  const adapters: PolicyAiProviderAdapter[] = []
  if (config.openAiPolicyProvider !== undefined) {
    adapters.push(createOpenAiPolicyProvider(config.openAiPolicyProvider))
  }
  if (config.geminiPolicyProvider !== undefined) {
    adapters.push(createGeminiPolicyProvider(config.geminiPolicyProvider))
  }
  return createPolicyAiProviderRegistry(adapters)
}

/** Aynı server secret/config sınırından e-posta için ayrı output-contract adapter kaydı kurar. */
export function createConfiguredEmailAiProviderRegistry(
  config: Pick<ApiConfig, 'geminiPolicyProvider'>,
): EmailAiProviderRegistry {
  const adapters: EmailAiProviderAdapter[] = []
  if (config.geminiPolicyProvider !== undefined) {
    adapters.push(createGeminiEmailAiProvider(config.geminiPolicyProvider))
  }
  return createEmailAiProviderRegistry(adapters)
}

/**
 * Paket 55: işçilik dağıtımı sağlayıcı kaydı. Gerçek Gemini adaptörü yalnız
 * kendi opt-in'i ile eklenir; deterministik harness yalnız açık izinle görünür
 * ve üretimde config aşamasında zaten reddedilir.
 */
export function createConfiguredLaborAllocationProviderRegistry(
  config: Pick<ApiConfig, 'geminiLaborAllocationProvider' | 'laborAllocationAllowDeterministicProviders'>,
): LaborAllocationProviderRegistry {
  return createLaborAllocationProviderRegistry({
    ...(config.geminiLaborAllocationProvider === undefined
      ? {}
      : { gemini: createGeminiLaborAllocationProvider(config.geminiLaborAllocationProvider) }),
    allowDeterministic: config.laborAllocationAllowDeterministicProviders,
  })
}

/**
 * Sunucu yasam dongusu: config oku -> (varsa) DB havuzu kur -> uygulamayi kur
 * -> dinle -> sinyalde graceful kapan. Uygulama fabrikasindan (app.ts) ayridir.
 *
 * - Gecersiz config'te sunucu BASLATILMAZ; hata mesaji yalnizca alan adi ve
 *   kurali tasir (deger/secret/process.env icerigi yazilmaz).
 * - Production DATABASE_URL olmadan config asamasinda durur. Development/test
 *   DB verilmisse health gercek ping'le `ok`/`degraded` uretir; verilmemisse
 *   Paket 04 uyumlulugu korunur.
 * - SIGINT ve SIGTERM graceful kapanis baslatir; ayni anda yalniz BIR kapanis
 *   yurur ve DB havuzu da kapatilir.
 */
export async function startServer(): Promise<void> {
  let config
  try {
    config = parseConfig(process.env)
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`API configuration error - ${error.message}`)
      process.exitCode = 1
      return
    }
    throw error
  }

  let pool: pg.Pool | undefined
  if (config.databaseUrl !== undefined) {
    pool = createDatabasePool({ config: parseDatabaseUrl(config.databaseUrl) })
  }

  // Paket 55 icin de policy-ai/email-ai ile AYNI kural: registry SUNUCU
  // burada acikca kurup gecirmezse, buildApp kendi (yalniz test/gelistirme
  // amacli) determinist varsayilanina duser. `config.geminiLaborAllocationProvider`
  // tanimsizsa bu registry BOS doner (fail-closed) -- sahte "AI" cevabi degil,
  // acik `provider_disabled` sonucu uretir (bkz. labor-allocation-ai/store.ts).
  const laborAllocationProviders = createConfiguredLaborAllocationProviderRegistry(config)

  const app = buildApp({
    logLevel: config.logLevel,
    ...(pool !== undefined
      ? {
          healthDependencyCheck: async () => (await checkDatabaseHealth(pool)).ok,
          auth: { pool, cookieSecure: config.cookieSecure },
          policyAiProviders: createConfiguredPolicyAiProviderRegistry(config),
          emailAiProviders: createConfiguredEmailAiProviderRegistry(config),
          laborAllocationProviders,
          // Registry bos ise providerId'yi hic gecirme: store kendi
          // (kayitta hic bulunmayan) varsayilanini arar ve ayni sekilde
          // fail-closed `provider_disabled` uretir -- registry ile providerId
          // her zaman AYNI kaynaktan (config) turer, birbirinden kopmaz.
          ...(config.geminiLaborAllocationProvider === undefined
            ? {}
            : { laborAllocationProviderId: GEMINI_POLICY_PROVIDER_ID }),
        }
      : {}),
  })

  let shuttingDown = false
  const shutdown = (signal: 'SIGINT' | 'SIGTERM'): void => {
    if (shuttingDown) return
    shuttingDown = true
    app.log.info({ signal }, 'graceful shutdown started')
    app
      .close()
      .then(async () => {
        if (pool !== undefined) await closeDatabasePool(pool)
        app.log.info('shutdown complete')
        process.exitCode = 0
      })
      .catch((error: unknown) => {
        app.log.error({ err: error }, 'shutdown failed')
        process.exitCode = 1
      })
  }
  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))

  try {
    await app.listen({ host: config.host, port: config.port })
  } catch (error) {
    app.log.error({ err: error }, 'server failed to start')
    await app.close().catch(() => undefined)
    if (pool !== undefined) await closeDatabasePool(pool).catch(() => undefined)
    process.exitCode = 1
  }
}
