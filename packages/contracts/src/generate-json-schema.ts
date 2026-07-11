import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildJsonSchemas } from './json-schema.js'

/**
 * Deterministik JSON Schema ciktisini `dist/json-schema/` altina yazar.
 * Yalnizca `npm run schema --workspace @hasarbotu/contracts` ile calisir.
 * Cikti `dist` altinda oldugu icin Git tarafindan ignore edilir.
 */
const outputDir = join(dirname(fileURLToPath(import.meta.url)), 'json-schema')
mkdirSync(outputDir, { recursive: true })

const schemas = buildJsonSchemas()
const written: string[] = []
for (const [name, schema] of Object.entries(schemas)) {
  const filePath = join(outputDir, `${name}.json`)
  writeFileSync(filePath, `${JSON.stringify(schema, null, 2)}\n`, 'utf8')
  written.push(`${name}.json`)
}

process.stdout.write(`JSON Schema uretildi (${written.length}): ${written.join(', ')}\n`)
