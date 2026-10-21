import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { noticeSheetResponseSchema } from '@hasarbotu/contracts'
import { assertTestDatabaseUrl, closeDatabasePool, createDatabasePool, runMigrations, uuidv7 } from '@hasarbotu/database'
import { buildApp, hashPassword } from '../src/index.js'
import { createCaseVehicleOwnersStore } from '../src/case-vehicle-owners/store.js'
import { createCaseVehicleProfileStore } from '../src/case-vehicle-profile/store.js'

const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL ? describe : describe.skip
const password = 'Notice-test-strong-password-2026'

describeDb('İhbar föyü gerçek API / PostgreSQL', () => {
  let pool: pg.Pool
  let app: FastifyInstance
  let organizationId: string
  let foreignOrganizationId: string
  let userId: string
  let cookie: string
  let readerCookie: string
  let trafficCase: string
  let sequence = 7000

  async function newCase(caseType: 'traffic' | 'casco' | null = 'traffic', options: { closed?: boolean; foreign?: boolean; archived?: boolean } = {}) {
    const id = uuidv7()
    const ordinal = ++sequence
    await pool.query(`INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,case_type,
      lifecycle_status,workflow_stage,plate,plate_normalized,notification_date,loss_date,closed_at,is_archived)
      VALUES($1,$2,2026,$3,$4,$5,$6,$7,'34 TEST 123','34TEST123','2026-10-16','2026-10-15',$8,$9)`,
    [id, options.foreign ? foreignOrganizationId : organizationId, ordinal, `2026/${ordinal}`, caseType,
      options.closed ? 'closed' : 'open', options.closed ? 'closed' : 'new_notification', options.closed ? '2026-10-16T10:00:00Z' : null, options.archived ?? false])
    return id
  }
  const endpoint = (id: string) => `/api/v1/cases/${id}/notice-sheet`
  const input = (fields = {}) => ({ expectedVersion: null, overrides: { fields, documents: {} }, confirmed: true })
  const sheetHeaders = () => ({ cookie, 'x-hasarbotu-notice-sheet-fields': '2' })
  async function addSource(id: string, rawText: string, serviceName: string, revised = false) {
    const sourceId = uuidv7()
    await pool.query(`INSERT INTO eksist_sources(id,organization_id,case_id,request_reference,input_kind,display_name,mime_type,source_hash,raw_text,extraction_method,extracted_fields,reviewed_fields,created_by_user_id)
      VALUES($1::uuid,$2,$3,$1::uuid::text,'text','Synthetic','text/plain',$4,$5,'text','{}',$6::jsonb,$7)`,
    [sourceId, organizationId, id, createHash('sha256').update(rawText).digest('hex'), rawText, JSON.stringify({ automatic: { serviceName, serviceRevised: revised } }), userId])
    return sourceId
  }
  async function assignService(id: string, name: string, phone: string | null) {
    const serviceId = uuidv7()
    await pool.query("INSERT INTO service_centers(id,organization_id,name,center_type,service_type,phone) VALUES($1,$2,$3,'ozel','private', $4)", [serviceId, organizationId, name, phone])
    await pool.query('UPDATE cases SET service_center_id=$2 WHERE id=$1', [id, serviceId])
    return serviceId
  }
  async function login(email: string) {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } })
    expect(response.statusCode).toBe(200)
    return String(response.headers['set-cookie']).split(';')[0]!
  }

  beforeAll(async () => {
    const config = assertTestDatabaseUrl(TEST_URL!)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    organizationId = uuidv7()
    foreignOrganizationId = uuidv7()
    userId = uuidv7()
    const readerId = uuidv7()
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'notice-sheet-main','Örnek Ekspertiz'),($2,'notice-sheet-foreign','Diğer Ofis')", [organizationId, foreignOrganizationId])
    await pool.query(`INSERT INTO users(id,organization_id,email,display_name,password_hash)
      VALUES($1,$3,'notice-secretary@example.test','Sekreter Örnek',$4),($2,$3,'notice-reader@example.test','Okuyucu Örnek',$4)`,
    [userId, readerId, organizationId, await hashPassword(password)])
    await pool.query(`INSERT INTO user_roles(user_id,role_id) SELECT $1::uuid,id FROM roles WHERE code='secretary'
      UNION ALL SELECT $2::uuid,id FROM roles WHERE code='read_only'`, [userId, readerId])
    trafficCase = await newCase()
    const rawText = 'Sigortalı Ad/Ünvan: Sigortalı\nSigortalı Soyad: Örnek\nPoliçe Vadesi: 01.01.2026 - 01.01.2027\nSBM Eksper Rapor No: R-123\nMarka: Test\nAraç Tipi: Sedan\nModel Yılı: 2024\nEksper Atama Tarihi: 16.10.2026'
    await pool.query(`INSERT INTO eksist_sources(id,organization_id,case_id,request_reference,input_kind,display_name,mime_type,
      source_hash,raw_text,extraction_method,extracted_fields,reviewed_fields,created_by_user_id)
      VALUES($1,$2,$3,'notice-reference','text','Sentetik Eksist','text/plain',$4,$5,'text','{}',$6::jsonb,$7)`,
    [uuidv7(), organizationId, trafficCase, 'a'.repeat(64), rawText, JSON.stringify({ automatic: { insurerName: 'Örnek Sigorta', expertName: 'Örnek Eksper' } }), userId])
    await createCaseVehicleOwnersStore(pool).save({ organizationId, userId }, trafficCase, { owners: [{ name: 'Mağdur Örnek', phone: null }], expectedSetVersion: null })
    await createCaseVehicleProfileStore(pool).save({ organizationId, userId }, trafficCase, {
      expectedVersion: null, reason: null, fields: { brand: 'Güncel Marka', model: 'Model', modelYear: 2025, variant: null,
        vehicleClass: 'passenger_car', chassisPrefix: null, engineCode: null, evidenceSource: 'user_statement', evidenceReference: null },
    })
    app = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false, loginRateLimit: { limit: 100, windowMs: 60_000 } } })
    cookie = await login('notice-secretary@example.test')
    readerCookie = await login('notice-reader@example.test')
  }, 90_000)
  afterAll(async () => {
    if (app) await app.close()
    if (pool) await closeDatabasePool(pool)
  })

  it('requires authentication and isolates foreign and archived cases', async () => {
    expect((await app.inject({ url: endpoint(trafficCase) })).statusCode).toBe(401)
    for (const id of [await newCase('traffic', { foreign: true }), await newCase('traffic', { archived: true })]) {
      expect((await app.inject({ url: endpoint(id), headers: { cookie, 'x-hasarbotu-notice-sheet-fields': '2' } })).statusCode).toBe(404)
      expect((await app.inject({ method: 'PUT', url: endpoint(id), headers: { cookie, 'x-hasarbotu-notice-sheet-fields': '2' }, payload: input() })).statusCode).toBe(404)
    }
  })
  it('combines current case, Eksist, owner and vehicle facts without inventing decisions', async () => {
    const response = await app.inject({ url: endpoint(trafficCase), headers: { cookie, 'x-hasarbotu-notice-sheet-fields': '2' } })
    expect(response.statusCode).toBe(200)
    const sheet = noticeSheetResponseSchema.parse(response.json())
    expect(sheet).toMatchObject({ caseType: 'traffic', plate: '34 TEST 123', insurerName: 'Örnek Sigorta', version: null, permissions: { canEdit: true } })
    expect(sheet.defaults.fields).toMatchObject({ insuredName: 'Sigortalı Örnek', victimName: 'Mağdur Örnek', victimPlate: '34 TEST 123',
      insuredPlate: '', vehicleDescription: 'Güncel Marka · Model · 2025', reportNumber: 'R-123', inspectionDate: '', victimHeavyDamage: '', victimPreviousClaims: '' })
  })
  it('saves secretary edits, reloads them and audits without copying personal data', async () => {
    const id = await newCase('casco')
    const response = await app.inject({ method: 'PUT', url: endpoint(id), headers: { cookie, 'x-hasarbotu-notice-sheet-fields': '2' }, payload: input({ recourse: 'İnceleniyor', insuredPlate: '06 WRONG 99', insuredName: 'Kayıtlı Örnek' }) })
    expect(response.statusCode).toBe(200)
    const reloaded = noticeSheetResponseSchema.parse((await app.inject({ url: endpoint(id), headers: { cookie, 'x-hasarbotu-notice-sheet-fields': '2' } })).json())
    expect(reloaded.version).toBe(1)
    expect(reloaded.overrides.fields).toEqual({ recourse: 'İnceleniyor', insuredName: 'Kayıtlı Örnek', insuredPlate: '06 WRONG 99' })
    expect(reloaded.defaults.fields.insuredPlate).toBe('34 TEST 123')
    const events = await pool.query("SELECT details FROM audit_events WHERE action='notice_sheet.saved' AND resource_id=$1", [id])
    expect(events.rows).toHaveLength(1)
    expect(JSON.stringify(events.rows)).not.toContain('Kayıtlı Örnek')
  })
  it('serializes concurrent first saves and rejects a stale version', async () => {
    const id = await newCase()
    const responses = await Promise.all(['Birinci', 'İkinci'].map(note => app.inject({ method: 'PUT', url: endpoint(id), headers: { cookie, 'x-hasarbotu-notice-sheet-fields': '2' }, payload: input({ inspectionNotes: note }) })))
    expect(responses.map(response => response.statusCode).sort()).toEqual([200, 409])
    expect((await pool.query('SELECT version FROM case_notice_sheets WHERE case_id=$1', [id])).rows).toEqual([{ version: 1 }])
  })
  it.each(['first save', 'revision'])('rolls back a notice sheet %s if audit persistence fails and allows the unchanged command to recover', async kind => {
    const id = await newCase()
    const save = (payload: object) => app.inject({ method: 'PUT', url: endpoint(id), headers: { cookie, 'x-hasarbotu-notice-sheet-fields': '2' }, payload })
    if (kind === 'revision') expect((await save(input({ inspectionNotes: 'Original reviewed note' }))).statusCode).toBe(200)
    const before = (await app.inject({ url: endpoint(id), headers: { cookie, 'x-hasarbotu-notice-sheet-fields': '2' } })).json()
    const payload = { ...input({ inspectionNotes: 'Recovered reviewed note' }), expectedVersion: before.version }
    await pool.query(`CREATE FUNCTION reject_notice_sheet_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='notice_sheet.saved' THEN RAISE EXCEPTION 'synthetic_audit_failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_notice_sheet_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_notice_sheet_audit()`)
    try {
      expect((await save(payload)).statusCode).toBe(500)
      expect((await app.inject({ url: endpoint(id), headers: { cookie, 'x-hasarbotu-notice-sheet-fields': '2' } })).json()).toEqual(before)
      expect((await pool.query("SELECT 1 FROM audit_events WHERE resource_id=$1 AND action='notice_sheet.saved'", [id])).rowCount).toBe(kind === 'revision' ? 1 : 0)
    } finally {
      await pool.query('DROP TRIGGER reject_notice_sheet_audit ON audit_events; DROP FUNCTION reject_notice_sheet_audit()')
    }
    const recovered = await save(payload)
    expect(recovered.statusCode).toBe(200)
    expect(recovered.json().version).toBe((before.version ?? 0) + 1)
    expect(recovered.json().overrides.fields.inspectionNotes).toBe('Recovered reviewed note')
    expect((await save(payload)).statusCode).toBe(409)
  })
  it('uses the reviewed service when it has no directory reference and preserves sheet-only revisions', async () => {
    const id = await newCase()
    await pool.query(`INSERT INTO eksist_sources(id,organization_id,case_id,request_reference,input_kind,display_name,mime_type,source_hash,raw_text,extraction_method,extracted_fields,reviewed_fields,created_by_user_id)
      VALUES($1::uuid,$2,$3,$1::uuid::text,'text','Synthetic','text/plain',$4,$5,'text','{}',$6::jsonb,$7)`,
    [uuidv7(), organizationId, id, 'b'.repeat(64), 'Tamirhane Ad / Ünvan: Eski Servis\nTelefon: 0111 111 11 11\nAçık Adres: Eski adres', JSON.stringify({ automatic: { serviceName: 'Revize Servis', serviceRevised: true } }), userId])
    const sheet = noticeSheetResponseSchema.parse((await app.inject({ url: endpoint(id), headers: { cookie, 'x-hasarbotu-notice-sheet-fields': '2' } })).json())
    expect(sheet.defaults.fields).toMatchObject({ serviceName: 'Revize Servis', servicePhone: '', serviceAddress: '' })
    const response = await app.inject({ method: 'PUT', url: endpoint(id), headers: { cookie, 'x-hasarbotu-notice-sheet-fields': '2' }, payload: input({ servicePhone: '0222 222 22 22', serviceAddress: 'Yeni açık adres', insurerName: 'Föye özel şirket', plate: '06 TEST 99' }) })
    expect(response.statusCode).toBe(200)
    const saved = noticeSheetResponseSchema.parse((await app.inject({ url: endpoint(id), headers: { cookie, 'x-hasarbotu-notice-sheet-fields': '2' } })).json())
    expect(saved.overrides.fields).toMatchObject({ servicePhone: '0222 222 22 22', serviceAddress: 'Yeni açık adres', insurerName: 'Föye özel şirket', plate: '06 TEST 99' })
    expect((await pool.query('SELECT plate FROM cases WHERE id=$1',[id])).rows[0].plate).toBe('34 TEST 123')
  })
  it.each(['traffic', 'casco'] as const)('loads assigned %s contacts, saves handwritten changes and reloads them', async type => {
    const id = await newCase(type)
    const name = `Assigned ${id}`
    await assignService(id, name, '0333 333 33 33')
    await addSource(id, `Atama Yapan İletişim Bilgileri\nTelefon: 0111 111 11 11\nAçık Adres: Atayan adresi\nTamirhane Yeri Bilgileri\nTamirhane Ad / Ünvan: ${name}\nTelefon: 0222 222 22 22\nAçık Adres: Doğrulanmış servis adresi\nEksper Bilgileri`, name)
    const read = () => app.inject({ url: endpoint(id), headers: sheetHeaders() })
    expect((await read()).json().defaults.fields).toMatchObject({ serviceName: name, servicePhone: '0333 333 33 33', serviceAddress: 'Doğrulanmış servis adresi' })
    const fields = { servicePhone: '0444 444 44 44', serviceAddress: 'Elle düzeltilen adres', inspectionNotes: 'Korunacak not' }
    expect((await app.inject({ method: 'PUT', url: endpoint(id), headers: sheetHeaders(), payload: input(fields) })).statusCode).toBe(200)
    expect((await read()).json().overrides.fields).toEqual(fields)
  })
  it('uses only a matching named inspection location for a revised casco service', async () => {
    const id = await newCase('casco')
    await addSource(id, 'Atama Yapan İletişim Bilgileri\nTelefon: 0111 111 11 11\nEkspertiz Yeri Bilgileri\nEkspertiz Yeri Ad/Ünvan: Revize Servis\nTelefon: 0222 222 22 22\nAçık Adres: Güncel adres\nTamirhane Yeri Bilgileri\nTamirhane Ad / Ünvan: Eski Servis\nTelefon: 0333 333 33 33\nAçık Adres: Eski adres\nEksper Bilgileri', 'Revize Servis', true)
    const sheet = (await app.inject({ url: endpoint(id), headers: sheetHeaders() })).json()
    expect(sheet.defaults.fields).toMatchObject({ serviceName: 'Revize Servis', servicePhone: '0222 222 22 22', serviceAddress: 'Güncel adres' })
  })
  it('keeps old handwritten contacts stored but does not attach them to a replacement directory service', async () => {
    const id = await newCase('casco')
    await assignService(id, `Original ${id}`, '0111 111 11 11')
    const fields = { servicePhone: '0222 222 22 22', serviceAddress: 'Elle girilmiş önceki servis adresi', inspectionNotes: 'Kalıcı not' }
    expect((await app.inject({ method: 'PUT', url: endpoint(id), headers: sheetHeaders(), payload: input(fields) })).statusCode).toBe(200)
    const before = (await app.inject({ url: endpoint(id), headers: sheetHeaders() })).json()
    await assignService(id, `Replacement ${id}`, '0333 333 33 33')
    const after = (await app.inject({ url: endpoint(id), headers: sheetHeaders() })).json()
    expect(after.defaults.fields).toMatchObject({ servicePhone: '0333 333 33 33', serviceAddress: '' })
    expect(after.overrides.fields).toEqual({ inspectionNotes: 'Kalıcı not' })
    expect(after.version).toBe(before.version + 1)
    expect((await pool.query('SELECT overrides FROM case_notice_sheets WHERE case_id=$1', [id])).rows[0].overrides.fields).toEqual(fields)
    expect((await app.inject({ method: 'PUT', url: endpoint(id), headers: sheetHeaders(), payload: { ...input(fields), expectedVersion: before.version } })).statusCode).toBe(409)
  })
  it('invalidates an open editor and masks old contacts after a reviewed source service change', async () => {
    const id = await newCase('casco')
    const sourceId = await addSource(id, 'Tamirhane Ad / Ünvan: İlk Servis\nTelefon: 0111 111 11 11', 'İlk Servis')
    const fields = { serviceName: 'Föye özel ad', servicePhone: '0222 222 22 22', serviceAddress: 'Önceki adres', inspectionNotes: 'Kalıcı not' }
    await app.inject({ method: 'PUT', url: endpoint(id), headers: sheetHeaders(), payload: input(fields) })
    await pool.query("UPDATE eksist_sources SET reviewed_fields=jsonb_set(reviewed_fields,'{automatic,serviceName}',to_jsonb('İkinci Servis'::text)) WHERE id=$1", [sourceId])
    const sheet = (await app.inject({ url: endpoint(id), headers: sheetHeaders() })).json()
    expect(sheet.defaults.fields).toMatchObject({ serviceName: 'İkinci Servis', servicePhone: '', serviceAddress: '' })
    expect(sheet.overrides.fields).toEqual({ inspectionNotes: 'Kalıcı not' })
    expect(sheet.version).toBe(2)
  })
  it('keeps same-plate claims separate and refreshes automatic facts after saving', async () => {
    const first = await newCase(), second = await newCase()
    expect((await app.inject({ method: 'PUT', url: endpoint(first), headers: { cookie, 'x-hasarbotu-notice-sheet-fields': '2' }, payload: input({ inspectionNotes: 'Yalnız ilk dosyanın notu' }) })).statusCode).toBe(200)
    await pool.query("UPDATE cases SET notification_date='2026-10-17' WHERE id=$1", [first])
    const saved = (await app.inject({ url: endpoint(first), headers: { cookie, 'x-hasarbotu-notice-sheet-fields': '2' } })).json()
    const separate = (await app.inject({ url: endpoint(second), headers: { cookie, 'x-hasarbotu-notice-sheet-fields': '2' } })).json()
    expect(saved).toMatchObject({ notificationDate: '2026-10-17', overrides: { fields: { inspectionNotes: 'Yalnız ilk dosyanın notu' } } })
    expect(separate).toMatchObject({ version: null, overrides: { fields: {}, documents: {} } })
  })
  it('keeps read-only and closed records printable while refusing writes', async () => {
    const id = await newCase('traffic', { closed: true })
    const closed = await app.inject({ url: endpoint(id), headers: { cookie, 'x-hasarbotu-notice-sheet-fields': '2' } })
    expect(closed.statusCode).toBe(200)
    expect(closed.json()).toMatchObject({ closureDate: '2026-10-16', permissions: { canEdit: false } })
    expect((await app.inject({ method: 'PUT', url: endpoint(id), headers: { cookie, 'x-hasarbotu-notice-sheet-fields': '2' }, payload: input() })).statusCode).toBe(409)
    const reader = await app.inject({ url: endpoint(trafficCase), headers: { cookie: readerCookie } })
    expect(reader.statusCode).toBe(200)
    expect(reader.json().permissions.canEdit).toBe(false)
    expect((await app.inject({ method: 'PUT', url: endpoint(trafficCase), headers: { cookie: readerCookie }, payload: input() })).statusCode).toBe(403)
  })
  it('preserves long automatic source facts for review instead of truncating or rejecting the sheet', async () => {
    const id = await newCase()
    const longName = 'Uzun Sigortalı Ünvanı '.repeat(25).trim()
    await pool.query(`INSERT INTO eksist_sources(id,organization_id,case_id,request_reference,input_kind,display_name,mime_type,
      source_hash,raw_text,extraction_method,extracted_fields,created_by_user_id)
      VALUES($1,$2,$3,'long-notice-source','text','Sentetik uzun kaynak','text/plain',$4,$5,'text','{}',$6)`,
    [uuidv7(), organizationId, id, 'e'.repeat(64), `Sigortalı Ad/Ünvan: ${longName}`, userId])
    const response = await app.inject({ url: endpoint(id), headers: { cookie, 'x-hasarbotu-notice-sheet-fields': '2' } })
    expect(response.statusCode).toBe(200)
    expect(response.json().defaults.fields.insuredName).toBe(longName)
  })
  it('rejects unclassified, unconfirmed and malformed writes', async () => {
    const id = await newCase(null)
    expect((await app.inject({ method: 'PUT', url: endpoint(id), headers: { cookie, 'x-hasarbotu-notice-sheet-fields': '2' }, payload: input() })).statusCode).toBe(409)
    for (const payload of [{ ...input(), confirmed: false }, input({ inspectionDate: '2026-02-30' }), input({ unexpected: 'value' })]) {
      expect((await app.inject({ method: 'PUT', url: endpoint(trafficCase), headers: { cookie, 'x-hasarbotu-notice-sheet-fields': '2' }, payload })).statusCode).toBe(400)
    }
  })
  it('marks only physically verified current document versions', async () => {
    const id = await newCase()
    const documentId = uuidv7()
    const versionId = uuidv7()
    await pool.query(`INSERT INTO documents(id,organization_id,case_id,document_type,status) VALUES($1,$3,$4,'ktt','ready'),($2,$3,$4,'statement','ready')`, [documentId, uuidv7(), organizationId, id])
    await pool.query(`INSERT INTO document_versions(id,organization_id,document_id,case_id,version_number,original_file_name,display_name,
      mime_type,byte_size,content_hash,storage_root_key,relative_path,source_type,status,hash_verified,size_verified,verified_at)
      VALUES($1,$2,$3,$4,1,'sentetik.pdf','Sentetik tutanak','application/pdf',20,$5,'notice-test','sentetik.pdf','manual','ready',true,true,now())`,
    [versionId, organizationId, documentId, id, 'b'.repeat(64)])
    await pool.query('UPDATE documents SET current_version_id=$2,current_version_number=1 WHERE id=$1', [documentId, versionId])
    const response = await app.inject({ url: endpoint(id), headers: { cookie, 'x-hasarbotu-notice-sheet-fields': '2' } })
    expect(response.statusCode).toBe(200)
    expect(response.json().defaults.documents).toMatchObject({ accidentReport: true, statement: false, damagePhotos: false })
  })
  it('reads one latest SBM source consistently for case details and notice defaults', async () => {
    const id = await newCase('casco')
    const olderSource = await addSource(id, 'Tamirhane Yeri Bilgileri\nTamirhane Ad / Ünvan: Older Repair\nTelefon: 0212 555 10 10\nAçık Adres: Older Street', 'Older Repair')
    const latestSource = await addSource(id, 'Tamirhane Yeri Bilgileri\nTamirhane Ad / Ünvan: Latest Repair\nTelefon: 0216 555 20 20\nAçık Adres: Latest Street', 'Latest Repair')
    const automatic = { sourceId: latestSource, assignmentDate: '2026-10-16', assignmentDateText: '16.10.2026', insurerName: 'Synthetic Insurer', expertName: 'Synthetic Expert', expertLicenseNumber: '', corporateExpertLicenseNumber: '', serviceName: 'Latest Repair', serviceRevised: false, vehicleFields: {} }
    await pool.query('UPDATE eksist_sources SET reviewed_fields=$2::jsonb WHERE id=$1', [latestSource, JSON.stringify({ automatic })])
    const detail = await app.inject({ url: `/api/v1/cases/${id}?includeServiceDetails=true&includeEksist=true`, headers: { cookie } })
    expect(detail.statusCode).toBe(200)
    expect(detail.json().case.serviceDetails).toEqual({ name: 'Latest Repair', phone: '0216 555 20 20', address: 'Latest Street' })
    expect(detail.json().case.eksist.sourceId).toBe(latestSource)
    const sheet = await app.inject({ url: endpoint(id), headers: sheetHeaders() })
    expect(sheet.json().defaults.fields).toMatchObject({ serviceName: 'Latest Repair', servicePhone: '0216 555 20 20', serviceAddress: 'Latest Street' })
    const revised = await app.inject({ method: 'PATCH', url: `/api/v1/cases/${id}`, headers: { cookie }, payload: { expectedVersion: 1, serviceRevision: { name: 'Manual Replacement' }, serviceDetails: { name: 'Manual Replacement', phone: '0212 555 30 30', address: 'Manual Street' } } })
    expect(revised.statusCode, revised.payload).toBe(200)
    expect(revised.json().case.serviceDetails).toEqual({ name: 'Manual Replacement', phone: '0212 555 30 30', address: 'Manual Street' })
    const older = (await pool.query("SELECT reviewed_fields->'automatic' AS automatic FROM eksist_sources WHERE id=$1", [olderSource])).rows[0].automatic
    expect(older.serviceName).toBe('Older Repair')
  })
  it('keeps older clients compatible and preserves newer header revisions during legacy saves', async () => {
    const id = await newCase()
    const modern = { cookie,'x-hasarbotu-notice-sheet-fields': '2' }
    expect((await app.inject({ method: 'PUT',url: endpoint(id),headers: modern,payload: input({ insurerName: 'Föye özel şirket',plate: '06 TEST 99',servicePhone: '0222 222 22 22' }) })).statusCode).toBe(200)
    const legacy = await app.inject({ url: endpoint(id),headers: { cookie } })
    expect(legacy.statusCode).toBe(200)
    expect(legacy.headers.vary).toBe('x-hasarbotu-notice-sheet-fields')
    expect(legacy.json().defaults.fields).not.toHaveProperty('insurerName')
    expect(legacy.json().overrides.fields).toEqual({ servicePhone: '0222 222 22 22' })
    const saved = await app.inject({ method: 'PUT',url: endpoint(id),headers: { cookie },payload: { ...input({ recourse: 'Eski istemcinin notu' }),expectedVersion: 1 } })
    expect(saved.statusCode).toBe(200)
    expect(saved.json().overrides.fields).toEqual({ recourse: 'Eski istemcinin notu' })
    const updated = (await app.inject({ url: endpoint(id),headers: modern })).json()
    expect(updated.overrides.fields).toEqual({ insurerName: 'Föye özel şirket',plate: '06 TEST 99',recourse: 'Eski istemcinin notu' })
  })
})
