import { parseDatabaseUrl } from '@hasarbotu/database'
import {
  GEMINI_FREE_TIER_FALLBACK_MODEL_ID,
  GEMINI_FREE_TIER_MODEL_ID,
  normalizeGeminiApiKey,
  type GeminiFreeTierModelId,
  type GeminiPolicyProviderConfig,
} from './policy-ai/gemini-provider.js'
import type { OpenAiPolicyProviderConfig } from './policy-ai/openai-provider.js'

/**
 * API runtime yapilandirma siniri.
 *
 * Ortam degiskenleri ACIK parser ile islenir; kontrolsuz coercion yoktur.
 * Gecersiz yapilandirmada sunucu baslatilmaz. Hata mesajlari yalnizca alan
 * adini ve beklenen kurali tasir; ortam DEGERI veya process.env icerigi
 * hicbir zaman hata mesajina yazilmaz (secret sizintisina karsi).
 * Bu paket dotenv kullanmaz; degerler dogrudan process ortamindan gelir.
 */

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

export const NODE_ENVS = ['development', 'production', 'test'] as const
export type NodeEnv = (typeof NODE_ENVS)[number]

export const DEFAULT_HOST = '127.0.0.1'
export const DEFAULT_PORT = 3100
export const DEFAULT_LOG_LEVEL: LogLevel = 'info'
export const DEFAULT_NODE_ENV: NodeEnv = 'development'

export const MIN_PORT = 1
export const MAX_PORT = 65_535

export interface ApiConfig {
  readonly host: string
  readonly port: number
  readonly logLevel: LogLevel
  readonly nodeEnv: NodeEnv
  /**
   * Development/test icin opsiyonel PostgreSQL baglantisi. Production'da
   * zorunludur. Development/test'te verilmezse API veritabanisiz calisir ve
   * health `ok` doner (Paket 04 uyumlulugu). Verilirse bicimi
   * @hasarbotu/database parseDatabaseUrl ile dogrulanir; gecersizse sunucu
   * BASLATILMAZ. Deger hicbir hata mesajina yazilmaz.
   */
  readonly databaseUrl?: string
  /** Sunucu-sahipli secret ve fiyat ayarlari; istemci/API cevabina asla tasinmaz. */
  readonly openAiPolicyProvider?: OpenAiPolicyProviderConfig
  /**
   * Gemini yalnız açık deployment opt-in + eksiksiz server environment config
   * ile kaydedilir. API key hiçbir DTO/log/audit yüzeyine taşınmaz.
   */
  readonly geminiPolicyProvider?: GeminiPolicyProviderConfig
}

/** Yapilandirma hatasi: alan adi + kural tasir, deger tasimaz. */
export class ConfigError extends Error {
  readonly field: string

  constructor(field: string, requirement: string) {
    super(`Invalid ${field}: ${requirement}`)
    this.name = 'ConfigError'
    this.field = field
  }
}

const INTEGER_PATTERN = /^\d+$/
const OPENAI_MODEL_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/
const OPENAI_KEY_PATTERN = /^[A-Za-z0-9_-]{20,512}$/

function parseHost(raw: string | undefined): string {
  if (raw === undefined) return DEFAULT_HOST
  const host = raw.trim()
  if (host.length === 0) throw new ConfigError('HOST', 'expected a non-empty host name or IP address.')
  return host
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT
  // Acik tam sayi bicimi: bosluk, isaret, ondalik, us ve hex reddedilir.
  if (!INTEGER_PATTERN.test(raw)) {
    throw new ConfigError('PORT', `expected an integer between ${MIN_PORT} and ${MAX_PORT}.`)
  }
  const port = Number(raw)
  if (!Number.isSafeInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new ConfigError('PORT', `expected an integer between ${MIN_PORT} and ${MAX_PORT}.`)
  }
  return port
}

function parseLogLevel(raw: string | undefined): LogLevel {
  if (raw === undefined) return DEFAULT_LOG_LEVEL
  if (!LOG_LEVELS.some((level) => level === raw)) {
    throw new ConfigError('LOG_LEVEL', `expected one of: ${LOG_LEVELS.join(', ')}.`)
  }
  return raw as LogLevel
}

function parseNodeEnv(raw: string | undefined): NodeEnv {
  if (raw === undefined) return DEFAULT_NODE_ENV
  if (!NODE_ENVS.some((env) => env === raw)) {
    throw new ConfigError('NODE_ENV', `expected one of: ${NODE_ENVS.join(', ')}.`)
  }
  return raw as NodeEnv
}

function parseOptionalDatabaseUrl(raw: string | undefined): string | undefined {
  if (raw === undefined || raw.length === 0) return undefined
  try {
    parseDatabaseUrl(raw)
  } catch {
    // Deger (sifre icerebilir) hata mesajina asla yazilmaz.
    throw new ConfigError('DATABASE_URL', 'expected a valid postgres:// connection URL.')
  }
  return raw
}

function parsePositiveInteger(field: string, raw: string | undefined, maximum: number): number {
  if (raw === undefined || !INTEGER_PATTERN.test(raw)) throw new ConfigError(field, `expected an integer between 1 and ${maximum}.`)
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new ConfigError(field, `expected an integer between 1 and ${maximum}.`)
  return value
}

function parseGeminiModel(raw: string | undefined): GeminiFreeTierModelId {
  if (raw === GEMINI_FREE_TIER_MODEL_ID || raw === GEMINI_FREE_TIER_FALLBACK_MODEL_ID) return raw
  throw new ConfigError(
    'GEMINI_POLICY_MODEL',
    `expected one of: ${GEMINI_FREE_TIER_MODEL_ID}, ${GEMINI_FREE_TIER_FALLBACK_MODEL_ID}.`,
  )
}

function parseGeminiPolicyProvider(env: Readonly<Record<string, string | undefined>>): GeminiPolicyProviderConfig | undefined {
  const enabled = env.GEMINI_POLICY_PROVIDER_ENABLED
  if (enabled === undefined || enabled === 'false') return undefined
  if (enabled !== 'true') {
    throw new ConfigError('GEMINI_POLICY_PROVIDER_ENABLED', 'expected true or false.')
  }
  const apiKey = normalizeGeminiApiKey(env.GEMINI_API_KEY)
  if (apiKey === null) {
    throw new ConfigError('GEMINI_API_KEY', 'expected a non-empty server secret within the safe length limit.')
  }
  return {
    apiKey,
    modelId: parseGeminiModel(env.GEMINI_POLICY_MODEL),
    maximumInputCharacters: 50_000,
    maximumOutputSize: 100_000,
    maximumOutputTokens: env.GEMINI_POLICY_MAX_OUTPUT_TOKENS === undefined
      ? 4_096
      : parsePositiveInteger('GEMINI_POLICY_MAX_OUTPUT_TOKENS', env.GEMINI_POLICY_MAX_OUTPUT_TOKENS, 100_000),
  }
}

function parseOpenAiPolicyProvider(env: Readonly<Record<string, string | undefined>>): OpenAiPolicyProviderConfig | undefined {
  const fields = [env.OPENAI_API_KEY, env.OPENAI_POLICY_MODEL, env.OPENAI_POLICY_INPUT_COST_MINOR_PER_MILLION, env.OPENAI_POLICY_OUTPUT_COST_MINOR_PER_MILLION, env.OPENAI_POLICY_MAX_OUTPUT_TOKENS]
  if (fields.every((value) => value === undefined || value.length === 0)) return undefined
  if (env.OPENAI_API_KEY === undefined || !OPENAI_KEY_PATTERN.test(env.OPENAI_API_KEY)) throw new ConfigError('OPENAI_API_KEY', 'expected a non-empty server secret with a valid key shape.')
  if (env.OPENAI_POLICY_MODEL === undefined || !OPENAI_MODEL_PATTERN.test(env.OPENAI_POLICY_MODEL)) throw new ConfigError('OPENAI_POLICY_MODEL', 'expected an explicit model id containing only safe identifier characters.')
  return {
    apiKey: env.OPENAI_API_KEY,
    modelId: env.OPENAI_POLICY_MODEL,
    inputCostMinorPerMillionTokens: parsePositiveInteger('OPENAI_POLICY_INPUT_COST_MINOR_PER_MILLION', env.OPENAI_POLICY_INPUT_COST_MINOR_PER_MILLION, 1_000_000_000),
    outputCostMinorPerMillionTokens: parsePositiveInteger('OPENAI_POLICY_OUTPUT_COST_MINOR_PER_MILLION', env.OPENAI_POLICY_OUTPUT_COST_MINOR_PER_MILLION, 1_000_000_000),
    maximumInputCharacters: 50_000,
    maximumOutputSize: 100_000,
    maximumOutputTokens: env.OPENAI_POLICY_MAX_OUTPUT_TOKENS === undefined
      ? 4_096
      : parsePositiveInteger('OPENAI_POLICY_MAX_OUTPUT_TOKENS', env.OPENAI_POLICY_MAX_OUTPUT_TOKENS, 100_000),
  }
}

/**
 * Ortam nesnesinden API yapilandirmasini uretir. Saf fonksiyondur: testler
 * gercek process ortamina bagimli olmadan acik nesnelerle calisir.
 */
export function parseConfig(env: Readonly<Record<string, string | undefined>>): ApiConfig {
  const nodeEnv = parseNodeEnv(env.NODE_ENV)
  const databaseUrl = parseOptionalDatabaseUrl(env.DATABASE_URL)
  if (nodeEnv === 'production' && databaseUrl === undefined) {
    throw new ConfigError('DATABASE_URL', 'required when NODE_ENV is production.')
  }
  const openAiPolicyProvider = parseOpenAiPolicyProvider(env)
  const geminiPolicyProvider = parseGeminiPolicyProvider(env)
  return {
    host: parseHost(env.HOST),
    port: parsePort(env.PORT),
    logLevel: parseLogLevel(env.LOG_LEVEL),
    nodeEnv,
    ...(databaseUrl !== undefined ? { databaseUrl } : {}),
    ...(openAiPolicyProvider !== undefined ? { openAiPolicyProvider } : {}),
    ...(geminiPolicyProvider !== undefined ? { geminiPolicyProvider } : {}),
  }
}
