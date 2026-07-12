/**
 * Veritabani baglanti yapilandirma siniri.
 *
 * DATABASE_URL acik parser ile islenir. Hata mesajlari HICBIR ZAMAN URL'in
 * kendisini veya sifreyi tasimaz; yalnizca alan adi ve kural yazilir.
 */

export const DEFAULT_POSTGRES_PORT = 5432

export interface DatabaseConfig {
  readonly host: string
  readonly port: number
  readonly database: string
  readonly user: string
  readonly password: string
  /** Orijinal baglanti URL'i; loglara yazilacaksa redactDatabaseUrl kullanilir. */
  readonly url: string
}

/** Yapilandirma hatasi: alan adi + kural tasir; URL/sifre degeri tasimaz. */
export class DatabaseConfigError extends Error {
  readonly field: string

  constructor(field: string, requirement: string) {
    super(`Invalid ${field}: ${requirement}`)
    this.name = 'DatabaseConfigError'
    this.field = field
  }
}

/**
 * `postgres://user:pass@host:port/dbname` bicimini acik kurallarla dogrular.
 * Sorgu parametreleri (ör. sslmode) bu pakette bilinçli olarak desteklenmez;
 * ihtiyac dogarsa ayri kararla eklenir.
 */
export function parseDatabaseUrl(value: string): DatabaseConfig {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new DatabaseConfigError('DATABASE_URL', 'expected a valid URL.')
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new DatabaseConfigError('DATABASE_URL', 'expected postgres:// or postgresql:// scheme.')
  }
  if (parsed.hostname.length === 0) {
    throw new DatabaseConfigError('DATABASE_URL', 'expected a non-empty host.')
  }
  let port = DEFAULT_POSTGRES_PORT
  if (parsed.port.length > 0) {
    port = Number(parsed.port)
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
      throw new DatabaseConfigError('DATABASE_URL', 'expected port between 1 and 65535.')
    }
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  if (database.length === 0 || database.includes('/')) {
    throw new DatabaseConfigError('DATABASE_URL', 'expected a single non-empty database name.')
  }
  if (parsed.username.length === 0) {
    throw new DatabaseConfigError('DATABASE_URL', 'expected a non-empty user name.')
  }

  return {
    host: parsed.hostname,
    port,
    database,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    url: value,
  }
}

/** Loglanabilir bicim: sifre her zaman maskelenir. */
export function redactDatabaseUrl(value: string): string {
  try {
    const parsed = new URL(value)
    const auth =
      parsed.username.length > 0
        ? `${parsed.username}${parsed.password.length > 0 ? ':[redacted]' : ''}@`
        : ''
    // URL.toString() koseli parantezleri yuzde-kodladigi icin metin elle kurulur.
    return `${parsed.protocol}//${auth}${parsed.host}${parsed.pathname}`
  } catch {
    return '[invalid-database-url]'
  }
}

/**
 * Test guvenlik kapisi: entegrasyon testleri ve test migration komutlari yalnizca
 * adi `_test` ile biten veritabanina baglanabilir. Uretim veritabaninin testte
 * yanlislikla kullanilmasini onler.
 */
export function assertTestDatabaseUrl(value: string): DatabaseConfig {
  const config = parseDatabaseUrl(value)
  if (!config.database.endsWith('_test')) {
    throw new DatabaseConfigError(
      'TEST_DATABASE_URL',
      'test database name must end with _test; refusing to run tests against it.',
    )
  }
  return config
}
