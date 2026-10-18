import { copyFileSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MIGRATIONS_DIR } from '@hasarbotu/database'

/** Isolate historical rollback guards from later, deliberately irreversible migrations. */
export function createHistoricalMigrationDirectory(lastMigration: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'hb-historical-migrations-'))
  for (const file of readdirSync(MIGRATIONS_DIR).filter(name => /^\d{4}_.*\.js$/.test(name) && name.slice(0, 4) <= lastMigration)) {
    copyFileSync(join(MIGRATIONS_DIR, file), join(directory, file))
  }
  if (lastMigration < '0063') {
    // Endpoint rollback tests use today's authentication with historical business
    // schemas. Keep their original last migration and rollback guards intact.
    const base = JSON.stringify(pathToFileURL(join(MIGRATIONS_DIR, '0002_users_roles_sessions.js')).href)
    const sessions = JSON.stringify(pathToFileURL(join(MIGRATIONS_DIR, '0063_persistent_sessions.js')).href)
    writeFileSync(join(directory, '0002_users_roles_sessions.js'), `import { up as baseUp } from ${base}\nimport { up as sessionsUp } from ${sessions}\nexport { down, shorthands } from ${base}\nexport function up(pgm) { baseUp(pgm); sessionsUp(pgm) }\n`)
  }
  return directory
}
