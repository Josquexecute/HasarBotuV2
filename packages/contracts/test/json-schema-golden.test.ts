import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildJsonSchemas, type JsonSchemaName } from '../src/index.js'

/**
 * Golden JSON Schema regresyon testi.
 *
 * Uretilen semalar `test/fixtures/json-schema` altindaki commit edilmis canonical
 * fixture'larla karsilastirilir. Zod surumu veya sema tanimi degisip cikti
 * degisirse bu test KIRILIR; sessiz sozlesme kaymasi yayilamaz.
 *
 * Fixture guncellemesi yalnizca acik komutla yapilir:
 *   npm run schema:fixtures --workspace @hasarbotu/contracts
 * Normal test kosusu fixture'lari asla yeniden yazmaz.
 */
const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'json-schema')

const EXPECTED_NAMES: readonly JsonSchemaName[] = [
  'audit-events-query',
  'audit-events-response',
  'auth-login-request',
  'auth-session-response',
  'case-create-request',
  'case-detail-params',
  'case-detail-response',
  'case-update-request',
  'cases-list-response',
  'cases-query',
  'failure-envelope',
  'health-response',
]

describe('golden JSON Schema fixtures', () => {
  it('fixture seti hedef sema adlariyla birebir eslesir', () => {
    const files = readdirSync(FIXTURE_DIR).sort()
    expect(files).toEqual(EXPECTED_NAMES.map((name) => `${name}.json`))
  })

  it.each(EXPECTED_NAMES)('%s uretimi golden fixture ile ayni', (name) => {
    const generated = buildJsonSchemas()[name]
    const fixtureRaw = readFileSync(join(FIXTURE_DIR, `${name}.json`), 'utf8')
    // Semantik karsilastirma: Windows checkout'ta CRLF farki bayt esitligini
    // bozabilir; JSON.parse sonrasi derin esitlik sozlesme kaymasini yakalar.
    expect(JSON.parse(fixtureRaw)).toEqual(generated)
  })

  it('runtime-only kurallar semada x-hasarbotu-runtime-validation ile isaretlidir', () => {
    const detail = buildJsonSchemas()['case-detail-response']
    const serialized = JSON.stringify(detail)
    expect(serialized).toContain('x-hasarbotu-runtime-validation')
    expect(serialized).toContain('calendar-date-validity')
    expect(serialized).toContain('plate-number-canonical-form')
  })
})
