import { afterAll, describe, expect, it } from 'vitest'
import { pathToFileURL } from 'node:url'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { assertTestDatabaseUrl, createDatabasePool, runMigrations, uuidv7 } from '@hasarbotu/database'
import { buildApp, hashPassword } from '../src/index.js'
import { calculateValueLoss } from '../src/traffic-value-loss/calculator.js'
import { realMarketValueLossRuleSnapshot } from '../src/traffic-value-loss/rule-source.js'
import { valueLossCalculatorRequestSchema, valueLossCalculatorResponseSchema, valueLossCalculatorSavedResponseSchema, type ValueLossCalculatorRequest, type ValueLossCalculatorResponse } from '@hasarbotu/contracts'

const testUrl = process.env.TEST_DATABASE_URL
const baselinePath = process.env.VALUE_LOSS_ROLLBACK_BASELINE_API

// Opt-in: uses an actual old API bundle and a restored, disposable database; never resets its schema.
describe.skipIf(!testUrl || !baselinePath)('real API forward / rollback / forward compatibility', () => {
  let pool: pg.Pool, app: FastifyInstance | undefined
  afterAll(async () => { await app?.close(); await pool?.end() })

  it('preserves old records, new breakdowns and legacy writes across both API versions', async () => {
    const config = assertTestDatabaseUrl(testUrl!)
    expect(['127.0.0.1', 'localhost']).toContain(new URL(config.url).hostname)
    pool = createDatabasePool({ config })
    expect((await pool.query("SELECT 1 FROM pgmigrations WHERE name='0078_value_loss_calculation_breakdown'")).rowCount, 'Use a fresh pre-0078 database clone').toBe(0)
    const baseline = await import(pathToFileURL(baselinePath!).href) as { buildApp: typeof buildApp }
    const organizationId = uuidv7(), userId = uuidv7()
    const [oldCase, newCase, editedCase, migratedCase] = Array.from({ length: 4 }, () => uuidv7()) as [string, string, string, string]
    const email = `rollback-${organizationId}@example.test`, password = 'Synthetic-Rollback-2026!'
    await pool.query('INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)', [organizationId, `rollback-${organizationId}`, 'Synthetic rollback acceptance'])
    await pool.query('INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,$4,$5)', [userId, organizationId, email, 'Synthetic expert', await hashPassword(password)])
    await pool.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code='expert'", [userId])
    for (const [index, id] of [oldCase, newCase, editedCase, migratedCase].entries()) {
      await pool.query("INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,workflow_stage,plate,plate_normalized) VALUES($1,$2,2026,$3,$4,'traffic','open','new_notification','34 TEST 1','34TEST1')", [id, organizationId, index + 1, `2026/${index + 1}`])
    }
    const part = realMarketValueLossRuleSnapshot.partRules.find(rule => rule.vehicleGroupCode === 'A' && rule.coefficients.replacement !== null)!
    const input = valueLossCalculatorRequestSchema.parse({ accidentDate: '2026-10-01', vehicleType: 'OTOMOBİL', calculationBasis: 'reference', modelYear: 2024, usageValue: 50000, marketValueMinor: 100_000_000, damageAmountMinor: 10_000_000, previousDamageCount: 0, commercialOrRental: false, vehicleCondition: 'normal', postRepairMarketValueMinor: null, faultRateBasisPoints: 10000, parts: [], partSelections: [{ entryId: 'part-1', stableRuleId: part.stableId, partName: part.sourceLabel, position: '', quantity: 1, material: 'unspecified', operation: 'replacement', paintMode: null, newPartPriceMinor: null, repairLaborMinor: null, partPriceAvailability: 'unavailable', priorPartState: 'none', treatment: 'standard' }] })
    let origin: string, cookie: string
    const start = async (factory: typeof buildApp) => {
      await app?.close()
      app = factory({ loggerEnabled: false, auth: { pool, cookieSecure: false } })
      origin = await app.listen({ host: '127.0.0.1', port: 0 })
      const login = await fetch(origin + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })
      expect(login.status).toBe(200)
      cookie = login.headers.get('set-cookie')!.split(';')[0]!
      await login.arrayBuffer()
    }
    async function request(id: string, payload: ValueLossCalculatorRequest, details?: boolean): Promise<ValueLossCalculatorResponse>
    async function request(id: string, payload?: undefined, details?: boolean): Promise<ReturnType<typeof valueLossCalculatorSavedResponseSchema.parse>>
    async function request(id: string, payload?: ValueLossCalculatorRequest, details = false) {
      const response = await fetch(origin + `/api/v1/cases/${id}/traffic-value-loss/calculate${details ? '?details=1' : ''}`, { method: payload ? 'POST' : 'GET', headers: { cookie, ...(payload ? { 'content-type': 'application/json' } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}) })
      const body = await response.json()
      expect(response.status, JSON.stringify(body)).toBe(200)
      return payload ? valueLossCalculatorResponseSchema.parse(body) : valueLossCalculatorSavedResponseSchema.parse(body)
    }
    const rows = async () => (await pool.query('SELECT * FROM case_value_loss_calculations WHERE organization_id=$1 ORDER BY case_id', [organizationId])).rows

    await start(baseline.buildApp)
    const oldResult = await request(oldCase, input)
    const oldSaved = await request(oldCase)
    const fullResult = calculateValueLoss(input)
    expect(fullResult.breakdown).toBeDefined()
    // A record written by the previously prepared candidate, before the compatibility migration.
    await pool.query('INSERT INTO case_value_loss_calculations(organization_id,case_id,input,result,updated_by_user_id) VALUES($1,$2,$3,$4,$5)', [organizationId, migratedCase, input, fullResult, userId])
    const migratedBefore = (await rows()).find(row => row.case_id === migratedCase)!
    await app!.close(); app = undefined
    await runMigrations({ databaseUrl: config.url, quiet: true })
    await start(buildApp)
    expect(await request(oldCase)).toEqual(oldSaved)
    const newResult = await request(newCase, input, true)
    expect(newResult).toEqual(fullResult)
    await request(editedCase, input, true)
    const newSaved = await request(newCase, undefined, true)
    const migratedSaved = await request(migratedCase, undefined, true)
    expect(migratedSaved.calculation!.result).toEqual(fullResult)
    expect(migratedSaved.calculation!.savedAt).toBe(migratedBefore.updated_at.toISOString())
    const beforeRollback = await rows()

    await start(baseline.buildApp)
    expect(await request(oldCase)).toEqual(oldSaved)
    for (const id of [newCase, editedCase, migratedCase]) {
      const saved = await request(id)
      expect(saved.calculation!.result).toEqual({ amountMinor: fullResult.amountMinor, ruleVersion: fullResult.ruleVersion, calculationMethod: fullResult.calculationMethod, issues: fullResult.issues })
    }
    expect(await rows()).toEqual(beforeRollback)
    const editedResult = await request(editedCase, { ...input, marketValueMinor: 120_000_000 })
    expect((await request(editedCase)).calculation!.result).toEqual(editedResult)
    expect(oldResult.amountMinor).toBeGreaterThan(0)

    await app!.close(); app = undefined
    expect(await runMigrations({ databaseUrl: config.url, quiet: true })).toEqual([])
    await start(buildApp)
    expect(await request(newCase, undefined, true)).toEqual(newSaved)
    expect(await request(migratedCase, undefined, true)).toEqual(migratedSaved)
    expect((await request(editedCase, undefined, true)).calculation!.result).toEqual(editedResult)
    const editedRow = (await rows()).find(row => row.case_id === editedCase)!
    expect(editedRow.result_breakdown).toEqual(fullResult.breakdown)
    expect(editedRow.result_breakdown_updated_at).not.toEqual(editedRow.updated_at)
    expect((await pool.query("SELECT count(*)::int AS count FROM audit_events WHERE organization_id=$1 AND action='case.value_loss_calculated'", [organizationId])).rows[0].count).toBe(4)
  }, 90000)
})
