import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
  it('requires authentication, prevents cross-tenant reads/writes and permits readers to view only', async () => {
    expect((await app.inject({ url: url() })).statusCode).toBe(401)
    expect((await app.inject({ url: url(foreignCaseId), headers: { cookie } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: url(foreignCaseId), headers: { cookie }, payload: input })).statusCode).toBe(404)
    expect((await app.inject({ url: url(), headers: { cookie: readerCookie } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: url(), headers: { cookie: readerCookie }, payload: input })).statusCode).toBe(403)
  })
})
