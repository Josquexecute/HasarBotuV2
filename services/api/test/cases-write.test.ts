import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  CASES_ROUTE,
  DASHBOARD_ROUTE,
  DASHBOARD_STAGE_SET_HEADER,
  DASHBOARD_STAGE_SET_VERSION,
  IDEMPOTENCY_KEY_HEADER,
  caseDetailResponseSchema,
} from '@hasarbotu/contracts'
import {
  assertTestDatabaseUrl,
  closeDatabasePool,
  createDatabasePool,
  runMigrations,
  uuidv7,
  type DatabaseConfig,
} from '@hasarbotu/database'
import { buildApp, hashPassword } from '../src/index.js'

const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe

const PASSWORD = 'cok-guclu-parola-42'
const EMAIL = 'yazici@office.example'
const YEAR = new Date().getFullYear()

describeDb('Cases yazma uclari (gercek veritabani)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let cookie: string
  let orgId: string
  let userId: string
  let serviceId: string
  let expertId: string
  let insurerId: string
  let inactiveServiceId: string

  function createPayload(plate: string): Record<string, unknown> {
    return { caseType: 'casco', plate, notificationFormNumber: `F-${YEAR}-${plate.slice(-3)}` }
  }

  async function createCase(plate: string, key?: string): Promise<{ status: number; body: { case?: { id: string; officeCaseNumber: string; version: number } } & Record<string, unknown> }> {
    const response = await app.inject({
      method: 'POST',
      url: CASES_ROUTE,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: key ?? uuidv7() },
      payload: createPayload(plate),
    })
    return { status: response.statusCode, body: response.json() }
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    orgId = uuidv7()
    userId = uuidv7()
    serviceId = uuidv7()
    expertId = uuidv7()
    insurerId = uuidv7()
    inactiveServiceId = uuidv7()
    await pool.query('INSERT INTO organizations (id, code, name) VALUES ($1, $2, $3)', [orgId, 'hasarbotu-office', 'HasarBotu Ofis'])
    await pool.query(
      'INSERT INTO users (id, organization_id, email, display_name, password_hash) VALUES ($1, $2, $3, $4, $5)',
      [userId, orgId, EMAIL, 'Yazici', await hashPassword(PASSWORD)],
    )
    await pool.query("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code='case_manager'", [userId])
    await pool.query(
      'INSERT INTO service_centers (id, organization_id, name, center_type, service_type) VALUES ($1, $2, $3, $4, $5)',
      [serviceId, orgId, 'Merkez Servis', 'ozel', 'private'],
    )
    await pool.query(
      'INSERT INTO users (id, organization_id, email, display_name, password_hash) VALUES ($1, $2, $3, $4, $5)',
      [expertId, orgId, 'eksper@office.example', 'Gerçek Eksper', await hashPassword(PASSWORD)],
    )
    await pool.query("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code='expert'", [expertId])
    await pool.query('INSERT INTO insurers (id, organization_id, name) VALUES ($1, $2, $3)', [insurerId, orgId, 'Güven Sigorta'])
    await pool.query(
      `INSERT INTO insurer_service_agreements
       (id,organization_id,insurer_id,service_center_id,agreement_status,effective_from,effective_to,supported_operations,
        source_reference,human_approved,approved_by_user_id,approved_at)
       VALUES ($1,$2,$3,$4,'active','2026-01-01','2026-12-31',ARRAY['closure_documents'],'sentetik-case-write',true,$5,now())`,
      [uuidv7(), orgId, insurerId, serviceId, userId],
    )
    await pool.query(
      'INSERT INTO service_centers (id, organization_id, name, center_type, service_type, is_active) VALUES ($1, $2, $3, $4, $5, false)',
      [inactiveServiceId, orgId, 'Pasif Servis', 'ozel', 'private'],
    )

    app = buildApp({
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 1000, windowMs: 60_000 } },
    })
    const login = await app.inject({ method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email: EMAIL, password: PASSWORD } })
    const setCookie = login.headers['set-cookie']
    cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0] as string
  }, 60_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('olusturma: 201, sirali ofis numarasi, sema uyumu, audit kaydi', async () => {
    const first = await createCase('34 AAA 111')
    expect(first.status).toBe(201)
    expect(caseDetailResponseSchema.safeParse(first.body).success).toBe(true)
    expect(first.body.case?.officeCaseNumber).toBe(`${YEAR}/1`)
    expect(first.body.case?.version).toBe(1)

    const second = await createCase('34 AAA 222')
    expect(second.body.case?.officeCaseNumber).toBe(`${YEAR}/2`)

    const audit = await pool.query(
      "SELECT count(*)::int AS n FROM audit_events WHERE action = 'case.created' AND actor_user_id = $1",
      [userId],
    )
    expect((audit.rows[0] as { n: number }).n).toBe(2)
  })

  it('eksper ve LocalDate alanlarını create/read/update/audit akışında taşır', async () => {
    const created = await app.inject({
      method: 'POST',
      url: CASES_ROUTE,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        caseType: 'traffic', plate: '34 P 180', responsibleUserId: userId, expertUserId: expertId,
        insurerId, serviceId, lossDate: '2026-07-10', notificationDate: '2026-07-11', followUpDate: '2026-07-20',
      },
    })
    expect(created.statusCode).toBe(201)
    const createdCase = caseDetailResponseSchema.parse(created.json()).case
    expect(createdCase).toMatchObject({
      expertUserId: expertId, lossDate: '2026-07-10', notificationDate: '2026-07-11',
      serviceProfile: { id: serviceId, serviceType: 'private', agreement: { status: 'eligible', agreementStatus: 'agreed' } },
    })

    const updated = await app.inject({
      method: 'PATCH', url: `${CASES_ROUTE}/${createdCase.id}`, headers: { cookie },
      payload: { expectedVersion: 1, lossDate: '2026-07-12', notificationDate: '2026-07-13' },
    })
    expect(updated.statusCode).toBe(200)
    expect(caseDetailResponseSchema.parse(updated.json()).case).toMatchObject({ version: 2, lossDate: '2026-07-12', notificationDate: '2026-07-13' })
    const audits = await pool.query("SELECT action,details FROM audit_events WHERE resource_id=$1 ORDER BY occurred_at", [createdCase.id])
    expect(audits.rows).toEqual([
      expect.objectContaining({ action: 'case.created', details: expect.objectContaining({ assignedReferenceFields: ['responsibleUserId', 'expertUserId', 'serviceId', 'insurerId'], dateFieldsPresent: ['followUpDate', 'lossDate', 'notificationDate'], serviceEligibility: expect.objectContaining({ status: 'eligible', agreementStatus: 'agreed' }) }) }),
      expect.objectContaining({ action: 'case.updated', details: expect.objectContaining({ changedFields: ['lossDate', 'notificationDate'], fromVersion: 1, toVersion: 2, serviceEligibility: expect.objectContaining({ status: 'eligible', agreementStatus: 'agreed' }) }) }),
    ])
  })

  it('pasif referansı, expert rolü olmayan kullanıcıyı ve ters tarih sırasını alan bazlı reddeder', async () => {
    const attempts = [
      { field: 'serviceId', plate: '34 Z 181', payload: { serviceId: inactiveServiceId } },
      { field: 'expertUserId', plate: '34 Z 182', payload: { expertUserId: userId } },
      { field: 'notificationDate', plate: '34 Z 183', payload: { lossDate: '2026-07-14', notificationDate: '2026-07-13' } },
    ]
    for (const attempt of attempts) {
      const response = await app.inject({
        method: 'POST', url: CASES_ROUTE,
        headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
        payload: { caseType: 'casco', plate: attempt.plate, ...attempt.payload },
      })
      expect(response.statusCode).toBe(400)
      expect(response.json().error.fieldErrors[0].path).toBe(attempt.field)
    }
  })

  it('idempotent tekrar: ayni anahtar + ayni govde ayni yaniti dondurur, kopya olusturmaz', async () => {
    const key = uuidv7()
    const first = await createCase('34 BBB 333', key)
    const before = await pool.query('SELECT count(*)::int AS n FROM cases')
    const replay = await createCase('34 BBB 333', key)
    const after = await pool.query('SELECT count(*)::int AS n FROM cases')

    expect(replay.status).toBe(201)
    expect(replay.body.case?.id).toBe(first.body.case?.id)
    expect((after.rows[0] as { n: number }).n).toBe((before.rows[0] as { n: number }).n)
  })

  it('ayni anahtar farkli govde 409 idempotency_conflict doner', async () => {
    const key = uuidv7()
    await createCase('34 CCC 444', key)
    const conflict = await app.inject({
      method: 'POST',
      url: CASES_ROUTE,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: key },
      payload: createPayload('34 CCC 555'),
    })
    expect(conflict.statusCode).toBe(409)
    expect((conflict.json() as { error: { code: string } }).error.code).toBe('idempotency_conflict')
  })

  it('Idempotency-Key basligi zorunludur', async () => {
    const response = await app.inject({
      method: 'POST',
      url: CASES_ROUTE,
      headers: { cookie },
      payload: createPayload('34 DDD 666'),
    })
    expect(response.statusCode).toBe(400)
    const body = response.json() as { error: { fieldErrors: { path: string }[] } }
    expect(body.error.fieldErrors[0]?.path).toBe(IDEMPOTENCY_KEY_HEADER)
  })

  it('es zamanli olusturmalar benzersiz ve ardisik ofis numaralari alir', async () => {
    const startCount = await pool.query('SELECT count(*)::int AS n FROM cases WHERE organization_id = $1', [orgId])
    const plates = ['06 EEE 100', '06 EEE 200', '06 EEE 300', '06 EEE 400', '06 EEE 500']
    const results = await Promise.all(plates.map((plate) => createCase(plate)))
    const numbers = results.map((r) => r.body.case?.officeCaseNumber).sort()
    expect(new Set(numbers).size).toBe(5)
    const total = await pool.query('SELECT count(*)::int AS n FROM cases WHERE organization_id = $1', [orgId])
    expect((total.rows[0] as { n: number }).n).toBe((startCount.rows[0] as { n: number }).n + 5)
    const max = await pool.query('SELECT last_sequence FROM office_counters WHERE organization_id = $1 AND office_year = $2', [orgId, YEAR])
    expect((max.rows[0] as { last_sequence: number }).last_sequence).toBe((total.rows[0] as { n: number }).n)
  })

  it('gecersiz referans 400 doner ve ofis numarasi TUKETILMEZ (transaction rollback)', async () => {
    const counterBefore = await pool.query(
      'SELECT last_sequence FROM office_counters WHERE organization_id = $1 AND office_year = $2',
      [orgId, YEAR],
    )
    const response = await app.inject({
      method: 'POST',
      url: CASES_ROUTE,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { ...createPayload('34 FFF 777'), serviceId: uuidv7() },
    })
    expect(response.statusCode).toBe(400)
    const body = response.json() as { error: { fieldErrors: { path: string; code: string }[] } }
    expect(body.error.fieldErrors[0]).toMatchObject({ path: 'serviceId', code: 'unknown_reference' })

    const counterAfter = await pool.query(
      'SELECT last_sequence FROM office_counters WHERE organization_id = $1 AND office_year = $2',
      [orgId, YEAR],
    )
    expect(counterAfter.rows[0]).toEqual(counterBefore.rows[0])

    const next = await createCase('34 FFF 888')
    expect(next.status).toBe(201)
  })

  it('guncelleme: surum artar, alan temizlenebilir, audit degisen alan adlarini tasir', async () => {
    const created = await createCase('34 GGG 999')
    const caseId = created.body.case?.id as string

    const update = await app.inject({
      method: 'PATCH',
      url: `${CASES_ROUTE}/${caseId}`,
      headers: { cookie },
      payload: { expectedVersion: 1, workflowStage: 'reporting', insurerClaimNumber: 'CLAIM', serviceId },
    })
    expect(update.statusCode).toBe(200)
    const updated = update.json() as { case: { version: number; stage: string; followUpDate: string } }
    expect(caseDetailResponseSchema.safeParse(updated).success).toBe(true)
    expect(updated.case).toMatchObject({ version: 2, stage: 'under_repair', insurerClaimNumber: 'CLAIM' })

    const clear = await app.inject({
      method: 'PATCH',
      url: `${CASES_ROUTE}/${caseId}`,
      headers: { cookie },
      payload: { expectedVersion: 2, insurerClaimNumber: null },
    })
    expect((clear.json() as { case: { followUpDate: string | null; version: number } }).case).toMatchObject({
      insurerClaimNumber: null,
      version: 3,
    })

    const audit = await pool.query(
      "SELECT details FROM audit_events WHERE action = 'case.updated' AND resource_id = $1 ORDER BY occurred_at",
      [caseId],
    )
    expect((audit.rows[0] as { details: { changedFields: string[] } }).details.changedFields).toEqual(
      expect.arrayContaining(['workflowStage', 'insurerClaimNumber', 'serviceId']),
    )
  })

  it('bayat surum 409 version_conflict doner ve veri EZILMEZ', async () => {
    const created = await createCase('34 HHH 111')
    const caseId = created.body.case?.id as string
    await app.inject({
      method: 'PATCH',
      url: `${CASES_ROUTE}/${caseId}`,
      headers: { cookie },
      payload: { expectedVersion: 1, workflowStage: 'reporting' },
    })

    const stale = await app.inject({
      method: 'PATCH',
      url: `${CASES_ROUTE}/${caseId}`,
      headers: { cookie },
      payload: { expectedVersion: 1, workflowStage: 'under_repair' },
    })
    expect(stale.statusCode).toBe(409)
    expect((stale.json() as { error: { code: string } }).error.code).toBe('version_conflict')

    const row = await pool.query('SELECT workflow_stage, version FROM cases WHERE id = $1', [caseId])
    expect(row.rows[0]).toMatchObject({ workflow_stage: 'under_repair', version: 2 })
  })

  it('kapali dosyada PATCH 409 case_closed doner, alanlar EZILMEZ, audit yazilmaz', async () => {
    const created = await createCase('34 LLL 444')
    const caseId = created.body.case?.id as string
    await pool.query(
      "UPDATE cases SET lifecycle_status='closed',workflow_stage='closed' WHERE id=$1",
      [caseId],
    )

    const attempt = await app.inject({
      method: 'PATCH',
      url: `${CASES_ROUTE}/${caseId}`,
      headers: { cookie },
      payload: { expectedVersion: 1, responsibleUserId: userId, followUpDate: '2026-09-01' },
    })
    expect(attempt.statusCode).toBe(409)
    expect((attempt.json() as { error: { code: string } }).error.code).toBe('conflict')

    // Diger tum modullerle (case-operations/labor/pert/email-drafts) ayni
    // fail-closed sozlesme: alanlar EZILMEZ, surum ilerlemez.
    const row = await pool.query(
      'SELECT responsible_user_id, follow_up_date, version FROM cases WHERE id = $1',
      [caseId],
    )
    expect(row.rows[0]).toMatchObject({ responsible_user_id: null, version: 1 })
    expect(row.rows[0].follow_up_date).not.toBeNull()

    const auditCount = await pool.query(
      "SELECT count(*)::int AS n FROM audit_events WHERE action = 'case.updated' AND resource_id = $1",
      [caseId],
    )
    expect(auditCount.rows[0].n).toBe(0)
  })

  it('corrects an assigned case type with version locking and an audit of the previous classification',async () => {
    const created = await createCase('34 ABC 997')
    const id = created.body.case?.id as string
    const changed = await app.inject({ method: 'PATCH',url: `${CASES_ROUTE}/${id}`,headers: { cookie },payload: { expectedVersion: 1,caseType: 'traffic' } })
    expect(changed.statusCode,changed.payload).toBe(200)
    expect(changed.json().case).toMatchObject({ caseType: 'traffic',version: 2,status: 'open' })
    const stale = await app.inject({ method: 'PATCH',url: `${CASES_ROUTE}/${id}`,headers: { cookie },payload: { expectedVersion: 1,caseType: 'traffic' } })
    expect(stale.statusCode).toBe(409)
    expect((await pool.query("SELECT details FROM audit_events WHERE resource_id=$1 AND action='case.updated'",[id])).rows[0].details).toMatchObject({ previousCaseType: 'casco',caseType: 'traffic',assignmentKind: 'user_correction',fromVersion: 1,toVersion: 2 })
    const rules = await app.inject({ url: `${CASES_ROUTE}/${id}/document-requirements`,headers: { cookie } })
    expect(rules.statusCode,rules.payload).toBe(200)
    expect(JSON.stringify(rules.json())).toContain('traffic')
  })

  it('Kapanışa Hazır kayıt, güncelleme, filtre ve panoda korunur; dosyayı kapatmaz', async () => {
    const created = await app.inject({
      method: 'POST', url: CASES_ROUTE, headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { ...createPayload('34 HZR 901'), workflowStage: 'ready_to_close' },
    })
    expect(created.statusCode).toBe(201)
    const caseId = created.json().case.id as string
    expect(created.json().case).toMatchObject({ stage: 'ready_to_close', status: 'open' })
    for (const [expectedVersion, workflowStage] of [[1, 'under_repair'], [2, 'ready_to_close']] as const) {
      const updated = await app.inject({
        method: 'PATCH', url: `${CASES_ROUTE}/${caseId}`, headers: { cookie },
        payload: { expectedVersion, workflowStage },
      })
      expect(updated.statusCode).toBe(200)
      expect(updated.json().case).toMatchObject({ stage: workflowStage, status: 'open', version: expectedVersion + 1 })
    }
    expect((await pool.query('SELECT workflow_stage,lifecycle_status FROM cases WHERE id=$1', [caseId])).rows[0])
      .toEqual({ workflow_stage: 'ready_to_close', lifecycle_status: 'open' })
    const detail = await app.inject({ method: 'GET', url: `${CASES_ROUTE}/${caseId}`, headers: { cookie } })
    expect(detail.json().case).toMatchObject({ stage: 'ready_to_close', status: 'open' })
    for (const stage of ['ready_to_close', 'under_repair']) {
      const list = await app.inject({ method: 'GET', url: `${CASES_ROUTE}?stage=${stage}`, headers: { cookie } })
      expect(list.statusCode).toBe(200)
      const ids = list.json().items.map((item: { id: string }) => item.id)
      if (stage === 'ready_to_close') expect(ids).toContain(caseId)
      else expect(ids).not.toContain(caseId)
    }
    const dashboard = await app.inject({ method: 'GET', url: DASHBOARD_ROUTE, headers: { cookie, [DASHBOARD_STAGE_SET_HEADER]: DASHBOARD_STAGE_SET_VERSION } })
    expect(dashboard.statusCode).toBe(200)
    expect(dashboard.json().items).toEqual(expect.arrayContaining([expect.objectContaining({ caseId, stage: 'ready_to_close' })]))
    expect(dashboard.json().stageCounts).toContainEqual({ stage: 'ready_to_close', count: 1 })
    const legacy = await app.inject({ method: 'GET', url: DASHBOARD_ROUTE, headers: { cookie } })
    expect(legacy.statusCode).toBe(200)
    expect(legacy.headers.vary).toBe(DASHBOARD_STAGE_SET_HEADER)
    expect(legacy.json().stageCounts).toHaveLength(6)
    expect(legacy.json().stageCounts.some((item: { stage: string }) => item.stage === 'ready_to_close')).toBe(false)
    expect(legacy.json().items).toEqual(expect.arrayContaining([expect.objectContaining({ caseId, stage: 'under_repair' })]))
    const repairCount = dashboard.json().stageCounts.find((item: { stage: string }) => item.stage === 'under_repair').count as number
    expect(legacy.json().stageCounts).toContainEqual({ stage: 'under_repair', count: repairCount + 1 })
    expect((await pool.query('SELECT workflow_stage FROM cases WHERE id=$1', [caseId])).rows[0].workflow_stage).toBe('ready_to_close')
  })

  it.each(['casco', 'traffic'])('persists editable %s service contacts through create, reload, sheet and replacement', async caseType => {
    const contact = { name: 'Manual Repair', phone: '0212 555 01 01', address: 'Synthetic Street 10' }
    const created = await app.inject({ method: 'POST', url: CASES_ROUTE, headers: { cookie, 'idempotency-key': uuidv7() }, payload: { caseType, plate: '34 TST 432', serviceDetails: contact } })
    expect(created.statusCode, created.payload).toBe(201)
    const item = created.json().case
    expect(item.serviceId).toBeNull()
    expect(item.serviceDetails).toEqual(contact)
    const read = () => app.inject({ url: `${CASES_ROUTE}/${item.id}?includeServiceDetails=true`, headers: { cookie } })
    expect((await read()).json().case.serviceDetails).toEqual(contact)
    const legacy = await app.inject({ url: `${CASES_ROUTE}/${item.id}`, headers: { cookie } })
    expect(legacy.json().case).not.toHaveProperty('serviceDetails')
    const sheetUrl = `${CASES_ROUTE}/${item.id}/notice-sheet`
    const sheetHeaders = { cookie, 'x-hasarbotu-notice-sheet-fields': '2' }
    expect((await app.inject({ url: sheetUrl, headers: sheetHeaders })).json().defaults.fields).toMatchObject({ serviceName: contact.name, servicePhone: contact.phone, serviceAddress: contact.address })
    const saved = await app.inject({ method: 'PUT', url: sheetUrl, headers: sheetHeaders, payload: { expectedVersion: null, confirmed: true, overrides: { fields: { servicePhone: '0212 555 99 99' }, documents: {} } } })
    expect(saved.statusCode, saved.payload).toBe(200)
    const edit = await app.inject({ method: 'PATCH', url: `${CASES_ROUTE}/${item.id}`, headers: { cookie }, payload: { expectedVersion: 1, serviceDetails: { name: contact.name, address: 'Corrected Address' } } })
    expect(edit.statusCode, edit.payload).toBe(200)
    expect((await read()).json().case.serviceDetails).toEqual({ ...contact, address: 'Corrected Address' })
    expect((await app.inject({ url: sheetUrl, headers: sheetHeaders })).json().overrides.fields.servicePhone).toBe('0212 555 99 99')
    const replace = await app.inject({ method: 'PATCH', url: `${CASES_ROUTE}/${item.id}`, headers: { cookie }, payload: { expectedVersion: 2, serviceDetails: { name: 'Different Repair' } } })
    expect(replace.statusCode, replace.payload).toBe(200)
    expect((await read()).json().case.serviceDetails).toEqual({ name: 'Different Repair', phone: null, address: null })
    const changedSheet = (await app.inject({ url: sheetUrl, headers: sheetHeaders })).json()
    expect(changedSheet.defaults.fields).toMatchObject({ serviceName: 'Different Repair', servicePhone: '', serviceAddress: '' })
    expect(changedSheet.overrides.fields).not.toHaveProperty('servicePhone')
    expect(changedSheet.version).toBeGreaterThan(saved.json().version)
  })

  it('copies registered phone, permits corrections, and rejects a mismatched service identity', async () => {
    await pool.query('UPDATE service_centers SET phone=$2 WHERE id=$1', [serviceId, '0216 555 22 22'])
    const references = await app.inject({ url: '/api/v1/references/services?includeContacts=true', headers: { cookie } })
    expect(references.json().items).toContainEqual(expect.objectContaining({ id: serviceId, phone: '0216 555 22 22' }))
    const legacyReferences = await app.inject({ url: '/api/v1/references/services', headers: { cookie } })
    expect(legacyReferences.json().items.find((row: { id: string }) => row.id === serviceId)).not.toHaveProperty('phone')
    const created = await app.inject({ method: 'POST', url: CASES_ROUTE, headers: { cookie, 'idempotency-key': uuidv7() }, payload: { caseType: 'casco', plate: '34 TST 433', serviceId, serviceDetails: { name: 'Merkez Servis' } } })
    expect(created.statusCode, created.payload).toBe(201)
    expect(created.json().case.serviceDetails).toEqual({ name: 'Merkez Servis', phone: '0216 555 22 22', address: null })
    const bad = await app.inject({ method: 'POST', url: CASES_ROUTE, headers: { cookie, 'idempotency-key': uuidv7() }, payload: { caseType: 'casco', plate: '34 TST 434', serviceId, serviceDetails: { name: 'Another Repair' } } })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error.fieldErrors).toContainEqual(expect.objectContaining({ code: 'service_identity_mismatch' }))
    const id = created.json().case.id
    const edit = await app.inject({ method: 'PATCH', url: `${CASES_ROUTE}/${id}`, headers: { cookie }, payload: { expectedVersion: 1, serviceDetails: { name: 'Merkez Servis', phone: null, address: 'New Address' } } })
    expect(edit.statusCode, edit.payload).toBe(200)
    expect(edit.json().case.serviceDetails).toEqual({ name: 'Merkez Servis', phone: null, address: 'New Address' })
    const sheet = await app.inject({ url: `${CASES_ROUTE}/${id}/notice-sheet`, headers: { cookie, 'x-hasarbotu-notice-sheet-fields': '2' } })
    expect(sheet.json().defaults.fields).toMatchObject({ servicePhone: '', serviceAddress: 'New Address' })
    await pool.query('UPDATE service_centers SET is_active=false WHERE id=$1', [serviceId])
    try {
      const correction = await app.inject({ method: 'PATCH', url: `${CASES_ROUTE}/${id}`, headers: { cookie }, payload: { expectedVersion: 2, serviceDetails: { name: 'Merkez Servis', phone: '0212 555 44 44' } } })
      expect(correction.statusCode, correction.payload).toBe(200)
      expect(correction.json().case).toMatchObject({ serviceId, serviceDetails: { name: 'Merkez Servis', phone: '0212 555 44 44', address: 'New Address' } })
    } finally { await pool.query('UPDATE service_centers SET is_active=true WHERE id=$1', [serviceId]) }
  })

  it('sinirlar: bos guncelleme 400; baska org dosyasi 404; oturumsuz 401; plaka degistirilemez (strict)', async () => {
    const created = await createCase('34 JJJ 222')
    const caseId = created.body.case?.id as string

    const empty = await app.inject({
      method: 'PATCH',
      url: `${CASES_ROUTE}/${caseId}`,
      headers: { cookie },
      payload: { expectedVersion: 1 },
    })
    expect(empty.statusCode).toBe(400)

    const immutable = await app.inject({
      method: 'PATCH',
      url: `${CASES_ROUTE}/${caseId}`,
      headers: { cookie },
      payload: { expectedVersion: 1, plate: '99 ZZZ 999' },
    })
    expect(immutable.statusCode).toBe(400)

    const otherOrg = uuidv7()
    await pool.query('INSERT INTO organizations (id, code, name) VALUES ($1, $2, $3)', [otherOrg, 'baska', 'Baska'])
    const foreign = uuidv7()
    await pool.query(
      `INSERT INTO cases (id, organization_id, office_year, office_sequence, office_number, case_type, workflow_stage, plate, plate_normalized)
       VALUES ($1, $2, $3, 1, $4, 'traffic', 'reporting', '35 K 1', '35K1')`,
      [foreign, otherOrg, YEAR, `${YEAR}/1`],
    )
    const cross = await app.inject({
      method: 'PATCH',
      url: `${CASES_ROUTE}/${foreign}`,
      headers: { cookie },
      payload: { expectedVersion: 1, workflowStage: 'reporting' },
    })
    expect(cross.statusCode).toBe(404)

    const anonymous = await app.inject({
      method: 'POST',
      url: CASES_ROUTE,
      headers: { [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: createPayload('34 KKK 333'),
    })
    expect(anonymous.statusCode).toBe(401)
  })
})
