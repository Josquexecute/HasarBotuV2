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

/**
 * Ortam nesnesinden API yapilandirmasini uretir. Saf fonksiyondur: testler
 * gercek process ortamina bagimli olmadan acik nesnelerle calisir.
 */
export function parseConfig(env: Readonly<Record<string, string | undefined>>): ApiConfig {
  return {
    host: parseHost(env.HOST),
    port: parsePort(env.PORT),
    logLevel: parseLogLevel(env.LOG_LEVEL),
    nodeEnv: parseNodeEnv(env.NODE_ENV),
  }
}
