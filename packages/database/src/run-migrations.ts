import { runMigrations } from './migrate.js'
import { redactDatabaseUrl } from './config.js'

/**
 * CLI girisi: `npm run migrate:up --workspace @hasarbotu/database`.
 * Baglanti `DATABASE_URL` ortam degiskeninden okunur; deger hicbir zaman
 * loglara ham yazilmaz.
 */
const direction = process.argv[2] === 'down' ? 'down' : 'up'
const databaseUrl = process.env.DATABASE_URL

if (databaseUrl === undefined || databaseUrl.length === 0) {
  console.error('DATABASE_URL ortam degiskeni gerekli.')
  process.exitCode = 1
} else {
  try {
    const applied = await runMigrations({ databaseUrl, direction })
    console.log(
      `migration ${direction}: ${applied.length} adim uygulandi -> ${redactDatabaseUrl(databaseUrl)}`,
    )
    for (const migration of applied) console.log(`  - ${migration.name}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    console.error(`migration ${direction} basarisiz: ${message}`)
    process.exitCode = 1
  }
}
