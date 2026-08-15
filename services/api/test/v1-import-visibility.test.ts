import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  CASES_ROUTE,
  V1_IMPORT_QUARANTINES_ROUTE,
  caseDetailResponseSchema,
  caseDetailWithLegacyReferencesResponseSchema,
  v1ImportQuarantinesResponseSchema,
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
const PASSWORD = 'v1-visibility-sentetik-guclu-parola'

describeDb('V1 aktarim gorunurlugu (gercek PostgreSQL)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let organizationId: string
  let actorUserId: string
  let mappedUserId: string
  let adminCookie: string
  let readOnlyCookie: string
  let mappedCaseId: string
  let legacyCaseId: string
  let unassignedCaseId: string
  let foreignCaseId: string

  async function seedUser(email: string, displayName: string, role: 'admin' | 'read_only'): Promise<string> {
    const id = uuidv7()
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash)
       VALUES ($1,$2,$3,$4,$5)`,
      [id, organizationId, email, displayName, await hashPassword(PASSWORD)],
    )
    await pool.query(
      'INSERT INTO user_roles (user_id,role_id) SELECT $1,id FROM roles WHERE code=$2',
      [id, role],
    )
    return id
  }

  async function login(email: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: AUTH_LOGIN_ROUTE,
      payload: { email, password: PASSWORD },
    })
    expect(response.statusCode).toBe(200)
    return String(response.headers['set-cookie']).split(';')[0] as string
  }

  async function seedCase(sequence: number, responsibleUserId: string | null): Promise<string> {
    const id = uuidv7()
    await pool.query(
      `INSERT INTO cases
        (id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,
         plate,plate_normalized,responsible_user_id)
       VALUES ($1,$2,2026,$3,$4,'traffic','reporting',$5,$6,$7)`,
      [id, organizationId, sequence, `2026/${sequence}`, `34 TEST ${sequence}`, `34TEST${sequence}`, responsibleUserId],
    )
    return id
  }

  async function seedSource(input: {
    caseId: string
    ordinal: number
    responsible: string
    expert: string
    service: string
    rawMarker: string
  }): Promise<void> {
    const sourceId = uuidv7()
    const revisionId = uuidv7()
    const recordId = uuidv7()
    const stableSourceIdentity = input.ordinal.toString(16).padStart(64, '0')
    const sourceHash = (input.ordinal + 100).toString(16).padStart(64, '0')
    const stableItemIdentity = (input.ordinal + 200).toString(16).padStart(64, '0')
    const relativePath = `2026/Temmuz/SENTETIK-${input.ordinal}`
    await pool.query(
      `INSERT INTO v1_import_sources
        (id,organization_id,stable_source_identity,identity_kind,identity_version,created_by_user_id)
       VALUES ($1,$2,$3,'case_key_created_at','v1-source-identity/1.0.0',$4)`,
      [sourceId, organizationId, stableSourceIdentity, actorUserId],
    )
    await pool.query(
      `INSERT INTO v1_import_source_revisions
        (id,organization_id,stable_source_identity,source_file_hash,source_schema_version,mapping_version,
         raw_snapshot,discovered_at,recorded_by_user_id)
       VALUES ($1,$2,$3,$4,1,'v1-remediation/2.3.0',$5::jsonb,now(),$6)`,
      [revisionId, organizationId, stableSourceIdentity, sourceHash, JSON.stringify({
        assignment: { sorumlu: input.responsible, eksper: input.expert },
        service: { name: input.service },
        privateRawPayload: input.rawMarker,
      }), actorUserId],
    )
    await pool.query(
      `INSERT INTO v1_import_records
        (id,organization_id,case_id,source_relative_path,source_file_kind,source_file_hash,
         source_schema_version,item_type,source_item_id,target_type,target_id,status,imported_by_user_id,
         stable_source_identity,stable_item_identity,source_revision_id)
       VALUES ($1,$2,$3,$4,'takip_json',$5,1,'case','case','case',$3,'created',$6,$7,$8,$9)`,
      [recordId, organizationId, input.caseId, relativePath, sourceHash, actorUserId,
        stableSourceIdentity, stableItemIdentity, revisionId],
    )
  }

  async function seedQuarantine(
    ordinal: number,
    candidateCaseIds: readonly string[],
    tenant: { readonly organizationId: string; readonly actorUserId: string } = { organizationId, actorUserId },
  ): Promise<void> {
    const stableSourceIdentity = (ordinal + 500).toString(16).padStart(64, '0')
    const sourceHash = (ordinal + 600).toString(16).padStart(64, '0')
    const sourceId = uuidv7()
    const revisionId = uuidv7()
    await pool.query(
      `INSERT INTO v1_import_sources
        (id,organization_id,stable_source_identity,identity_kind,identity_version,created_by_user_id)
       VALUES ($1,$2,$3,'case_key_created_at','v1-source-identity/1.0.0',$4)`,
      [sourceId, tenant.organizationId, stableSourceIdentity, tenant.actorUserId],
    )
    await pool.query(
      `INSERT INTO v1_import_source_revisions
        (id,organization_id,stable_source_identity,source_file_hash,source_schema_version,mapping_version,
         raw_snapshot,discovered_at,recorded_by_user_id)
       VALUES ($1,$2,$3,$4,1,'v1-remediation/2.3.0',$5::jsonb,now(),$6)`,
      [revisionId, tenant.organizationId, stableSourceIdentity, sourceHash,
        JSON.stringify({ privateRawPayload: `RAW_QUARANTINE_MARKER_${ordinal}` }), tenant.actorUserId],
    )
    await pool.query(
      `INSERT INTO v1_import_source_quarantines
        (id,organization_id,quarantine_identity,stable_source_identity,source_revision_id,source_path_token,
         source_relative_path,source_file_hash,mapping_version,reason,reason_code,evidence,quarantined_at,
         quarantined_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'v1-remediation/2.3.0','ambiguous_target',$9,$10::jsonb,
               $11::timestamptz,$12)`,
      [uuidv7(), tenant.organizationId, (ordinal + 700).toString(16).padStart(64, '0'), stableSourceIdentity,
        revisionId, (ordinal + 800).toString(16).padStart(16, '0'), `2026/Mayis/SENTETIK-Q-${ordinal}`,
        sourceHash, ordinal <= 3 ? 'case_type_conflict' : 'ambiguous_target', JSON.stringify({
          candidateCaseIds,
          privateRawPayload: `RAW_EVIDENCE_MARKER_${ordinal}`,
          claimTypeResolution: {
            caseType: 'casco',
            resolutionReason: 'document_evidence',
            sidecarConflictPreserved: ordinal === 1,
            evidence: [{ kind: 'k_ruhsat', sourceRelativePath: `SENTETIK-${ordinal}/K Ruhsat.pdf` }],
          },
        }), `2026-08-15T10:00:0${ordinal}Z`, tenant.actorUserId],
    )
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    organizationId = uuidv7()
    await pool.query(
      "INSERT INTO organizations (id,code,name) VALUES ($1,'v1-visibility-test','V1 Visibility Test')",
      [organizationId],
    )
    actorUserId = await seedUser('v1-admin@test.local', 'V1 Admin', 'admin')
    await seedUser('v1-readonly@test.local', 'V1 Read Only', 'read_only')
    mappedUserId = uuidv7()
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash)
       VALUES ($1,$2,'omerfaruk.isleyen@baranekspertiz.com','Ömer Faruk',$3)`,
      [mappedUserId, organizationId, await hashPassword(PASSWORD)],
    )

    mappedCaseId = await seedCase(9101, mappedUserId)
    legacyCaseId = await seedCase(9102, null)
    unassignedCaseId = await seedCase(9103, null)
    await seedSource({
      caseId: mappedCaseId,
      ordinal: 1,
      responsible: 'Ömer Faruk İşleyen',
      expert: '',
      service: '',
      rawMarker: 'RAW_CASE_MARKER_MAPPED',
    })
    await seedSource({
      caseId: legacyCaseId,
      ordinal: 2,
      responsible: 'Enes Özmen',
      expert: 'Baran Gürbüz',
      service: 'BABİL - VEDAT',
      rawMarker: 'RAW_CASE_MARKER_LEGACY',
    })
    await seedSource({
      caseId: unassignedCaseId,
      ordinal: 3,
      responsible: 'Atanmadı',
      expert: '',
      service: '',
      rawMarker: 'RAW_CASE_MARKER_UNASSIGNED',
    })
    const foreignOrganizationId = uuidv7()
    const foreignActorId = uuidv7()
    foreignCaseId = uuidv7()
    await pool.query(
      "INSERT INTO organizations (id,code,name) VALUES ($1,'v1-visibility-foreign','V1 Visibility Foreign')",
      [foreignOrganizationId],
    )
    await pool.query(
      "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,'foreign@test.local','Foreign','x')",
      [foreignActorId, foreignOrganizationId],
    )
    await pool.query(
      `INSERT INTO cases
        (id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,plate,plate_normalized)
       VALUES ($1,$2,2026,9991,'2026/9991','traffic','reporting','35 FOREIGN 1','35FOREIGN1')`,
      [foreignCaseId, foreignOrganizationId],
    )
    for (let index = 1; index <= 5; index += 1) {
      await seedQuarantine(index, index <= 3 ? [mappedCaseId] : [mappedCaseId, legacyCaseId,
        ...(index === 5 ? [foreignCaseId] : [])])
    }
    await seedQuarantine(9, [foreignCaseId], { organizationId: foreignOrganizationId, actorUserId: foreignActorId })

    app = buildApp({
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 100, windowMs: 60_000 } },
    })
    adminCookie = await login('v1-admin@test.local')
    readOnlyCookie = await login('v1-readonly@test.local')
  }, 60_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('eski case detail sozlesmesi varsayilan olarak ayni kalir', async () => {
    const response = await app.inject({
      method: 'GET', url: `${CASES_ROUTE}/${legacyCaseId}`, headers: { cookie: adminCookie },
    })
    expect(response.statusCode).toBe(200)
    expect(caseDetailResponseSchema.safeParse(response.json()).success).toBe(true)
    expect(response.json()).not.toHaveProperty('case.legacyReferences')
  })

  it('mapped kullaniciyi tekrar etmez; legacy-only alanlari ve Atanmadi NULL semantigini korur', async () => {
    const mapped = await app.inject({
      method: 'GET', url: `${CASES_ROUTE}/${mappedCaseId}?includeLegacyReferences=true`, headers: { cookie: adminCookie },
    })
    const mappedBody = caseDetailWithLegacyReferencesResponseSchema.parse(mapped.json())
    expect(mappedBody.case.responsibleUserId).toBe(mappedUserId)
    expect(mappedBody.case.legacyReferences).toEqual({ responsibleNames: [], expertNames: [], serviceNames: [] })

    const legacy = await app.inject({
      method: 'GET', url: `${CASES_ROUTE}/${legacyCaseId}?includeLegacyReferences=true`, headers: { cookie: adminCookie },
    })
    const legacyBody = caseDetailWithLegacyReferencesResponseSchema.parse(legacy.json())
    expect(legacyBody.case.responsibleUserId).toBeNull()
    expect(legacyBody.case.legacyReferences).toEqual({
      responsibleNames: ['Enes Özmen'], expertNames: ['Baran Gürbüz'], serviceNames: ['BABİL - VEDAT'],
    })
    expect(JSON.stringify(legacyBody)).not.toMatch(/RAW_CASE_MARKER|raw_snapshot|privateRawPayload/i)

    const unassigned = await app.inject({
      method: 'GET', url: `${CASES_ROUTE}/${unassignedCaseId}?includeLegacyReferences=true`, headers: { cookie: adminCookie },
    })
    const unassignedBody = caseDetailWithLegacyReferencesResponseSchema.parse(unassigned.json())
    expect(unassignedBody.case.responsibleUserId).toBeNull()
    expect(unassignedBody.case.legacyReferences.responsibleNames).toEqual([])
  })

  it('quarantine reporting 401/403 uygular ve admin icin tenant-scope 5 kaydi deterministik sayfalar', async () => {
    expect((await app.inject({ method: 'GET', url: V1_IMPORT_QUARANTINES_ROUTE })).statusCode).toBe(401)
    expect((await app.inject({
      method: 'GET', url: V1_IMPORT_QUARANTINES_ROUTE, headers: { cookie: readOnlyCookie },
    })).statusCode).toBe(403)

    const first = await app.inject({
      method: 'GET', url: `${V1_IMPORT_QUARANTINES_ROUTE}?page=1&pageSize=2`, headers: { cookie: adminCookie },
    })
    expect(first.statusCode).toBe(200)
    const firstBody = v1ImportQuarantinesResponseSchema.parse(first.json())
    expect(firstBody.pageInfo).toMatchObject({ page: 1, pageSize: 2, totalItems: 5, totalPages: 3 })
    expect(firstBody.items.map((item) => item.sourceRelativePath)).toEqual([
      '2026/Mayis/SENTETIK-Q-5', '2026/Mayis/SENTETIK-Q-4',
    ])
    expect(firstBody.items.every((item) => item.status === 'unresolved')).toBe(true)
    expect(JSON.stringify(firstBody)).not.toContain(foreignCaseId)

    const second = await app.inject({
      method: 'GET', url: `${V1_IMPORT_QUARANTINES_ROUTE}?page=2&pageSize=2&status=unresolved&reason=ambiguous_target`,
      headers: { cookie: adminCookie },
    })
    const secondBody = v1ImportQuarantinesResponseSchema.parse(second.json())
    expect(secondBody.items.map((item) => item.sourceRelativePath)).toEqual([
      '2026/Mayis/SENTETIK-Q-3', '2026/Mayis/SENTETIK-Q-2',
    ])
  })

  it('quarantine raw kaynak verisini sizdirmaz ve mutation yuzeyi acmaz', async () => {
    const before = await pool.query<{ total: number }>(
      'SELECT count(*)::int AS total FROM v1_import_source_quarantines WHERE organization_id=$1',
      [organizationId],
    )
    const response = await app.inject({
      method: 'GET', url: V1_IMPORT_QUARANTINES_ROUTE, headers: { cookie: adminCookie },
    })
    const serialized = response.body
    expect(serialized).not.toMatch(/RAW_(CASE|QUARANTINE|EVIDENCE)_MARKER|raw_snapshot|raw_source_text|privateRawPayload|source_file_hash/i)

    const mutation = await app.inject({
      method: 'POST', url: V1_IMPORT_QUARANTINES_ROUTE, headers: { cookie: adminCookie }, payload: {},
    })
    expect(mutation.statusCode).toBe(404)
    const after = await pool.query<{ total: number }>(
      'SELECT count(*)::int AS total FROM v1_import_source_quarantines WHERE organization_id=$1',
      [organizationId],
    )
    expect(after.rows[0]?.total).toBe(before.rows[0]?.total)
  })
})
