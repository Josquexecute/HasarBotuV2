import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pathToFileURL } from 'node:url'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { assertTestDatabaseUrl, createDatabasePool, runMigrations, uuidv7 } from '@hasarbotu/database'
import { valueLossCalculatorRequestSchema, valueLossCalculatorSavedResponseSchema } from '@hasarbotu/contracts'
import { buildApp, hashPassword } from '../src/index.js'
import { realMarketValueLossRuleSnapshot } from '../src/traffic-value-loss/rule-source.js'

const testUrl = process.env.TEST_DATABASE_URL
describe.skipIf(!testUrl)('case estimate PostgreSQL persistence', () => {
  let pool: pg.Pool, app: FastifyInstance, organizationId: string, caseId: string, otherCaseId: string, foreignCaseId: string
  let cookie: string, readerCookie: string
  const part = realMarketValueLossRuleSnapshot.partRules.find(part => part.vehicleGroupCode === 'A' && part.coefficients.replacement !== null)!
  const input = valueLossCalculatorRequestSchema.parse({ accidentDate: '2026-10-01', vehicleType: 'OTOMOBİL', calculationBasis: 'reference', modelYear: 2024, usageValue: 50000, marketValueMinor: 100_000_000, damageAmountMinor: 10_000_000, previousDamageCount: 0, commercialOrRental: false, vehicleCondition: 'normal', postRepairMarketValueMinor: null, faultRateBasisPoints: 10000, parts: [], partSelections: [{ entryId: 'part-1', stableRuleId: part.stableId, partName: part.sourceLabel, position: '', quantity: 1, material: 'unspecified', operation: 'replacement', paintMode: null, newPartPriceMinor: null, repairLaborMinor: null, partPriceAvailability: 'unavailable', priorPartState: 'none', treatment: 'standard' }] })
  const url = (id = caseId) => `/api/v1/cases/${id}/traffic-value-loss/calculate`
  beforeAll(async () => {
    const config = assertTestDatabaseUrl(testUrl!)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    organizationId = uuidv7()
    const foreign = uuidv7(), password = 'Synthetic-Estimate-2026!'
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'estimate','Synthetic'),($2,'estimate-foreign','Synthetic foreign')", [organizationId, foreign])
    const passwordHash = await hashPassword(password)
    for (const role of ['expert', 'read_only']) {
      const user = uuidv7()
      await pool.query('INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,$4,$5)', [user, organizationId, `${role}@estimate.test`, role, passwordHash])
      await pool.query('INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code=$2', [user, role])
    }
    caseId = uuidv7(); otherCaseId = uuidv7(); foreignCaseId = uuidv7()
    for (const [index, id] of [caseId, otherCaseId, foreignCaseId].entries()) await pool.query("INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,workflow_stage,plate,plate_normalized) VALUES($1,$2,2026,$3,$4,'traffic','open','new_notification','34 TEST 1','34TEST1')", [id, id === foreignCaseId ? foreign : organizationId, index + 1, `2026/${index + 1}`])
    app = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false } })
    for (const role of ['expert', 'read_only']) {
      const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: `${role}@estimate.test`, password } })
      expect(response.statusCode).toBe(200)
      const value = String(response.headers['set-cookie']).split(';')[0]!
      if (role === 'expert') cookie = value
      else readerCookie = value
    }
  }, 90000)
  afterAll(async () => { await app?.close(); await pool?.end() })
  it('keeps legacy strict response shapes and returns details only to clients opting in', async () => {
    const compatibilityCaseId = uuidv7()
    await pool.query("INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,workflow_stage,plate,plate_normalized) VALUES($1,$2,2026,99,'2026/99','traffic','open','new_notification','34 TEST 99','34TEST99')", [compatibilityCaseId, organizationId])
    const legacy = await app.inject({ method: 'POST', url: url(compatibilityCaseId), headers: { cookie }, payload: input })
    expect(Object.keys(legacy.json()).sort()).toEqual(['amountMinor', 'calculationMethod', 'issues', 'ruleVersion'])
    const detailed = await app.inject({ method: 'POST', url: url(compatibilityCaseId) + '?details=1', headers: { cookie }, payload: input })
    expect(detailed.json().breakdown.grossAmountMinor).toBe(legacy.json().amountMinor)
    const oldRead = await app.inject({ url: url(compatibilityCaseId), headers: { cookie } })
    expect(oldRead.json().calculation.result.breakdown).toBeUndefined()
    const newRead = await app.inject({ url: url(compatibilityCaseId) + '?details=1', headers: { cookie } })
    expect(newRead.json().calculation.result.breakdown).toEqual(detailed.json().breakdown)
  })
  it('saves the server-computed amount and inputs, survives a new app instance, and isolates cases', async () => {
    const saved = await app.inject({ method: 'POST', url: url(), headers: { cookie }, payload: input })
    expect(saved.statusCode).toBe(200)
    expect(saved.json().amountMinor).toBeGreaterThan(0)
    await app.close()
    app = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false } })
    const restored = await app.inject({ url: url(), headers: { cookie } })
    expect(restored.statusCode).toBe(200)
    expect(valueLossCalculatorSavedResponseSchema.parse(restored.json()).calculation).toMatchObject({ input, result: saved.json() })
    expect((await app.inject({ url: url(otherCaseId), headers: { cookie } })).json()).toEqual({ calculation: null })
    expect((await pool.query("SELECT details FROM audit_events WHERE resource_id=$1 AND action='case.value_loss_calculated'", [caseId])).rows).toHaveLength(1)
    expect((await pool.query('SELECT id FROM traffic_value_loss_assessments WHERE case_id=$1', [caseId])).rowCount).toBe(0)
  })
  it('preserves the last valid saved amount after an incomplete calculation', async () => {
    const prior = (await app.inject({ url: url(), headers: { cookie } })).json()
    const response = await app.inject({ method: 'POST', url: url(), headers: { cookie }, payload: { ...input, previousDamageCount: null } })
    expect(response.statusCode).toBe(200)
    expect(response.json().amountMinor).toBeNull()
    expect((await app.inject({ url: url(), headers: { cookie } })).json()).toEqual(prior)
  })
  it('keeps the saved estimate when the V2 base threshold requires review', async () => {
    const prior = (await app.inject({ url: url() + '?details=1', headers: { cookie } })).json()
    for (const previousDamageCount of [5, 109, 110]) {
      const pending = await app.inject({
        method: 'POST', url: url() + '?details=1', headers: { cookie },
        payload: { ...input, workbookVersion: 2, previousDamageCount, partSelections: [] },
      })
      expect(pending.statusCode).toBe(200)
      expect(pending.json()).toMatchObject({ amountMinor: null, issues: [{ field: 'previousDamageCount', message: expect.stringContaining('3.27') }] })
      expect((await app.inject({ url: url() + '?details=1', headers: { cookie } })).json()).toEqual(prior)
    }
  })
  it('keeps the full V2 input and result without exposing the new schema to the rollback API', async () => {
    const original = (await app.inject({ url: url() + '?details=1', headers: { cookie } })).json().calculation
    const post = (payload: typeof input) => app.inject({ method: 'POST', url: url() + '?details=1', headers: { cookie }, payload })
    const v2 = { ...input, workbookVersion: 2 as const, faultRateBasisPoints: null }
    const excluded = await post({ ...v2, partSelections: [{ ...input.partSelections![0], priorPartState: 'previously_repaired_welded' }] })
    expect(excluded.json()).toMatchObject({ amountMinor: null, issues: [expect.objectContaining({ field: 'partSelections' })] })
    const newResult = await post(v2)
    expect(newResult.statusCode).toBe(200)
    expect(newResult.json()).toMatchObject({ amountMinor: 5_700_000, breakdown: { faultRateBasisPoints: null } })
    const stored = async (table: 'case_value_loss_calculations' | 'case_value_loss_calculation_history') =>
      (await pool.query(`SELECT input,result,result_breakdown,updated_at FROM ${table} WHERE organization_id=$1 AND case_id=$2 ORDER BY updated_at`, [organizationId, caseId])).rows
    const legacyRows = await stored('case_value_loss_calculations')
    expect(legacyRows).toHaveLength(1)
    expect(legacyRows[0].input).toEqual(original.input)
    expect({ ...legacyRows[0].result, breakdown: legacyRows[0].result_breakdown }).toEqual(original.result)
    expect(legacyRows[0].updated_at.toISOString()).toBe(original.savedAt)
    expect(await stored('case_value_loss_calculation_history')).toMatchObject([{ input: v2, result_breakdown: newResult.json().breakdown }])
    expect((await app.inject({ url: url() + '?details=1', headers: { cookie } })).json().calculation.result).toEqual(newResult.json())
    const legacyRead = (await app.inject({ url: url(), headers: { cookie } })).json().calculation
    expect(legacyRead.input).toEqual(original.input)
    expect(legacyRead.result.ruleVersion).toBe(original.result.ruleVersion)
    const legacyUpdate = { ...input, marketValueMinor: 120_000_000 }
    const baselinePath = process.env.VALUE_LOSS_V2_ROLLBACK_BASELINE_API
    let oldSave
    if (baselinePath) {
      const previous = await import(pathToFileURL(baselinePath).href) as { buildApp: typeof buildApp }
      const baseline = previous.buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false } })
      try {
        const restoredLegacy = await baseline.inject({ url: url() + '?details=1', headers: { cookie } })
        expect(restoredLegacy.statusCode).toBe(200)
        expect(restoredLegacy.json()).toEqual({ calculation: original })
        oldSave = await baseline.inject({ method: 'POST', url: url() + '?details=1', headers: { cookie }, payload: legacyUpdate })
      } finally {
        await baseline.close()
      }
    } else {
      oldSave = await post(legacyUpdate)
    }
    expect(oldSave.statusCode).toBe(200)
    const archive = await stored('case_value_loss_calculation_history')
    expect(archive.map(row => row.input)).toEqual([original.input, v2])
    expect((await app.inject({ url: url() + '?details=1', headers: { cookie } })).json().calculation.result).toEqual(oldSave.json())
  })
  it('blocks current heavy damage and foreign plates from stored case facts', async () => {
    const post = () => app.inject({ method: 'POST', url: url(otherCaseId), headers: { cookie }, payload: { ...input, workbookVersion: 2 } })
    await pool.query("UPDATE cases SET workflow_stage='total_loss' WHERE id=$1", [otherCaseId])
    expect((await post()).json()).toMatchObject({ amountMinor: null, issues: [{ field: 'vehicleCondition', message: expect.stringContaining('ağır') }] })
    await pool.query("UPDATE cases SET workflow_stage='new_notification',plate='B AB 1234',plate_normalized='BAB1234' WHERE id=$1", [otherCaseId])
    expect((await post()).json()).toMatchObject({ amountMinor: null, issues: [{ field: 'vehicleCondition', message: expect.stringContaining('Yabancı') }] })
    expect((await app.inject({ url: url(otherCaseId), headers: { cookie } })).json()).toEqual({ calculation: null })
  })
  it('requires authentication, prevents cross-tenant reads/writes and permits readers to view only', async () => {
    expect((await app.inject({ url: url() })).statusCode).toBe(401)
    expect((await app.inject({ url: url(foreignCaseId), headers: { cookie } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: url(foreignCaseId), headers: { cookie }, payload: input })).statusCode).toBe(404)
    expect((await app.inject({ url: url(), headers: { cookie: readerCookie } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: url(), headers: { cookie: readerCookie }, payload: input })).statusCode).toBe(403)
  })
})
