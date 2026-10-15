import { copyFileSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MIGRATIONS_DIR } from '@hasarbotu/database'

/** Isolate historical rollback guards from later, deliberately irreversible migrations. */
export function createHistoricalMigrationDirectory(lastMigration: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'hb-historical-migrations-'))
  for (const file of readdirSync(MIGRATIONS_DIR).filter(name => /^\d{4}_.*\.js$/.test(name) && name.slice(0, 4) <= lastMigration)) {
    copyFileSync(join(MIGRATIONS_DIR, file), join(directory, file))
  }
  return directory
}
