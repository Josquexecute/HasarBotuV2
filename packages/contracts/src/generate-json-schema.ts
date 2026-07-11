import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildJsonSchemas } from './json-schema.js'

/**
 * Deterministik JSON Schema ciktisini yazar.
 *
 * Varsayilan hedef `dist/json-schema/` (Git tarafindan ignore edilir).
 * `--out <dizin>` ile hedef degistirilebilir; golden fixture guncellemesi
 * bu yolla `npm run schema:fixtures` uzerinden ACIK olarak yapilir.
 * Normal test kosusu fixture'lari asla sessizce guncellemez.
 */
const args = process.argv.slice(2)
const outFlagIndex = args.indexOf('--out')
const outputDir =
  outFlagIndex !== -1 && args[outFlagIndex + 1] !== undefined
    ? resolve(process.cwd(), args[outFlagIndex + 1] as string)
    : join(dirname(fileURLToPath(import.meta.url)), 'json-schema')

mkdirSync(outputDir, { recursive: true })

const schemas = buildJsonSchemas()
const written: string[] = []
for (const [name, schema] of Object.entries(schemas)) {
  const filePath = join(outputDir, `${name}.json`)
  writeFileSync(filePath, `${JSON.stringify(schema, null, 2)}\n`, 'utf8')
  written.push(`${name}.json`)
}

process.stdout.write(`JSON Schema uretildi (${written.length}) -> ${outputDir}: ${written.join(', ')}\n`)
