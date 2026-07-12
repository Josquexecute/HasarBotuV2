import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runner } from 'node-pg-migrate'
import { parseDatabaseUrl } from './config.js'

/** Paketle birlikte tasinan kanonik migration dizini. */
export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

/** node-pg-migrate durum tablosu; schema_migrations sorumlulugunu tasir. */
export const MIGRATIONS_TABLE = 'pgmigrations'

export interface RunMigrationsOptions {
  readonly databaseUrl: string
  readonly direction?: 'up' | 'down'
  readonly count?: number
  /** Varsayilan: paketin migrations dizini. Testler farkli dizin enjekte edebilir. */
  readonly dir?: string
  readonly quiet?: boolean
}

export interface AppliedMigration {
  readonly name: string
}

/**
 * Sürümlü migration kosucusu (node-pg-migrate programatik API).
 *
 * - Her migration kendi transaction'inda kosar; hata durumunda o adim geri alinir.
 * - Ayni migration ikinci kez uygulanmaz (pgmigrations tablosu).
 * - `down` varsayilan olarak yalnizca SON adimi geri alir; uretimde veri kayipli
 *   down yerine onaylı ileri duzeltme planı esastir (INFRASTRUCTURE_IMPLEMENTATION_PLAN Paket 05).
 */
export async function runMigrations(options: RunMigrationsOptions): Promise<readonly AppliedMigration[]> {
  // URL burada yalnizca dogrulama icin parse edilir; hata mesaji degeri tasimaz.
  parseDatabaseUrl(options.databaseUrl)
  const direction = options.direction ?? 'up'

  const applied = await runner({
    databaseUrl: options.databaseUrl,
    dir: options.dir ?? MIGRATIONS_DIR,
    direction,
    migrationsTable: MIGRATIONS_TABLE,
    count: options.count ?? (direction === 'down' ? 1 : Infinity),
    ...(options.quiet === true ? { log: () => undefined } : {}),
  })

  return applied.map((migration) => ({ name: migration.name }))
}
