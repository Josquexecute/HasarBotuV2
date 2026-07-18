import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  pertAssessmentResponseSchema,
  pertAssessmentWorkspaceResponseSchema,
} from '@hasarbotu/contracts'
import {
  assertTestDatabaseUrl,
  closeDatabasePool,
  createDatabasePool,
  runMigrations,
  uuidv7,
  type DatabaseConfig,
} from '@hasarbotu/database'
import { buildApp, fixedClock, hashPassword } from '../src/index.js'

const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'p45-sentetik-guclu-parola-45'

describeDb('Paket 45 PERT değerlendirme çekirdeği gerçek API', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let organizationId: string
  let foreignOrganizationId: string
  let expertUserId: string
  let caseId: string
  let closedCaseId: string
  let foreignCaseId: string
  let expertCookie: string
  let secretaryCookie: string

  const assessmentUrl = (targetCaseId = caseId) => `/api/v1/cases/${targetCaseId}/pert-assessment`
  const versionsUrl = (targetCaseId = caseId) => `${assessmentUrl(targetCaseId)}/versions`

  async function login(email: string): Promise<string> {
    const response = await app.inject({ method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email, password: PASSWORD } })
    expect(response.statusCode).toBe(200)
    return String(response.headers['set-cookie']).split(';')[0] as string
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    organizationId = uuidv7()
    foreignOrganizationId = uuidv7()
    expertUserId = uuidv7()
    const secretaryUserId = uuidv7()
    const foreignUserId = uuidv7()
    caseId = uuidv7()
    closedCaseId = uuidv7()
    foreignCaseId = uuidv7()
    const passwordHash = await hashPassword(PASSWORD)
    await pool.query(
      `INSERT INTO organizations (id,code,name)
       VALUES ($1,'p45-main','P45 Sentetik'),($2,'p45-foreign','P45 Yabancı')`,
      [organizationId, foreignOrganizationId],
    )
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash)
       VALUES ($1,$4,'p45-expert@test.local','P45 Eksper',$6),
              ($2,$4,'p45-secretary@test.local','P45 Sekreter',$6),
              ($3,$5,'p45-foreign@test.local','P45 Yabancı',$6)`,
      [expertUserId, secretaryUserId, foreignUserId, organizationId, foreignOrganizationId, passwordHash],
    )
    await pool.query(
      `INSERT INTO user_roles (user_id,role_id)
       SELECT $1::uuid,id FROM roles WHERE code='expert'
       UNION ALL SELECT $2::uuid,id FROM roles WHERE code='secretary'`,
      [expertUserId, secretaryUserId],
    )
    await pool.query(
      `INSERT INTO cases
         (id,organization_id,office_year,office_sequence,office_number,case_type,
          lifecycle_status,workflow_stage,plate,plate_normalized,responsible_user_id,notification_date,version)
       VALUES
       ($1,$4,2026,4501,'2026/4501','casco','open','damage_assessment','34 P 4501','34P4501',$5,'2026-07-18',3),
       ($2,$4,2026,4502,'2026/4502','casco','closed','closed','34 P 4502','34P4502',$5,'2026-07-18',1),
       ($3,$6,2026,4503,'2026/4503','casco','open','reporting','35 P 4503','35P4503',$7,'2026-07-18',1)`,
      [caseId, closedCaseId, foreignCaseId, organizationId, expertUserId, foreignOrganizationId, foreignUserId],
    )

    app = buildApp({
      clock: fixedClock('2026-07-18T10:30:00.000Z'),
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 100, windowMs: 60_000 } },
    })
    expertCookie = await login('p45-expert@test.local')
    secretaryCookie = await login('p45-secretary@test.local')
  }, 90_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('401, tenant 404, sekreterlik yazma reddi ve boş değerlendirme sınırlarını uygular', async () => {
    expect((await app.inject({ method: 'GET', url: assessmentUrl() })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: assessmentUrl(foreignCaseId), headers: { cookie: expertCookie } })).statusCode).toBe(404)
    const secretary = await app.inject({ method: 'GET', url: assessmentUrl(), headers: { cookie: secretaryCookie } })
    expect(secretary.statusCode).toBe(200)
    const workspace = pertAssessmentWorkspaceResponseSchema.parse(secretary.json())
    expect(workspace.assessment).toBeNull()
    expect(workspace.permissions.canWrite).toBe(false)
    const write = await app.inject({
      method: 'POST', url: assessmentUrl(),
      headers: { cookie: secretaryCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { workflowStatus: 'under_review', expectedCaseVersion: 3, confirmed: true },
    })
    expect(write.statusCode).toBe(403)
  })

  it('değerlendirmeyi oluşturur, oranı türetir ve idempotent replay yapar', async () => {
    const key = uuidv7()
    const payload = {
      workflowStatus: 'under_review',
      estimatedDamageMinor: 4_800_000_00,
      marketValueMinor: 6_250_000_00,
      structuralNote: 'Ön panel ölçümü bekleniyor.',
      expectedCaseVersion: 3,
      confirmed: true,
    }
    const created = await app.inject({
      method: 'POST', url: assessmentUrl(),
      headers: { cookie: expertCookie, [IDEMPOTENCY_KEY_HEADER]: key },
      payload,
    })
    expect(created.statusCode).toBe(201)
    const assessment = pertAssessmentResponseSchema.parse(created.json()).assessment
    expect(assessment.version).toBe(1)
    expect(assessment.currentVersion.workflowStatus).toBe('under_review')
    expect(assessment.currentVersion.damageRatioPercent).toBe(77)
    expect(assessment.currentVersion.expertOpinion).toBeNull()

    const replay = await app.inject({
      method: 'POST', url: assessmentUrl(),
      headers: { cookie: expertCookie, [IDEMPOTENCY_KEY_HEADER]: key },
      payload,
    })
    expect(replay.statusCode).toBe(201)
    expect(pertAssessmentResponseSchema.parse(replay.json()).assessment.id).toBe(assessment.id)
    expect((await pool.query('SELECT count(*)::int AS n FROM pert_assessments WHERE case_id=$1', [caseId])).rows).toEqual([{ n: 1 }])

    const duplicate = await app.inject({
      method: 'POST', url: assessmentUrl(),
      headers: { cookie: expertCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload,
    })
    expect(duplicate.statusCode).toBe(409)
  })

  it('kanaat gerekçesiz veya tutarsız merkez kararıyla kaydedilemez', async () => {
    const noRationale = await app.inject({
      method: 'POST', url: versionsUrl(),
      headers: { cookie: expertCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        workflowStatus: 'expert_opinion_issued',
        expertOpinion: 'pert',
        expectedVersion: 1,
        reason: 'Kanaat girişi',
        confirmed: true,
      },
    })
    expect(noRationale.statusCode).toBe(400)
    expect(noRationale.json().error.fieldErrors[0].code).toBe('expert_rationale_required')

    const mismatch = await app.inject({
      method: 'POST', url: versionsUrl(),
      headers: { cookie: expertCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        workflowStatus: 'repair_decided',
        expertOpinion: 'pert',
        expertRationale: 'Oran yüksek.',
        centerDecision: 'pert',
        expectedVersion: 1,
        reason: 'Karar girişi',
        confirmed: true,
      },
    })
    expect(mismatch.statusCode).toBe(400)
    expect(mismatch.json().error.fieldErrors[0].code).toBe('center_decision_mismatch')
  })

  it('kanaat ve merkez kararı ayrı sürümlerle ilerler; eski sürümler immutable kalır', async () => {
    const opinion = await app.inject({
      method: 'POST', url: versionsUrl(),
      headers: { cookie: expertCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        workflowStatus: 'center_decision_pending',
        estimatedDamageMinor: 4_800_000_00,
        marketValueMinor: 6_250_000_00,
        expertOpinion: 'pert',
        expertRationale: 'Hasar/rayiç oranı yüksek; yapısal hasar mevcut.',
        expectedVersion: 1,
        reason: 'Eksper kanaati verildi',
        confirmed: true,
      },
    })
    expect(opinion.statusCode).toBe(200)
    const afterOpinion = pertAssessmentResponseSchema.parse(opinion.json()).assessment
    expect(afterOpinion.version).toBe(2)
    expect(afterOpinion.currentVersion.expertOpinion).toBe('pert')
    expect(afterOpinion.currentVersion.centerDecision).toBeNull()

    const decision = await app.inject({
      method: 'POST', url: versionsUrl(),
      headers: { cookie: expertCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        workflowStatus: 'pert_decided',
        estimatedDamageMinor: 4_800_000_00,
        marketValueMinor: 6_250_000_00,
        expertOpinion: 'pert',
        expertRationale: 'Hasar/rayiç oranı yüksek; yapısal hasar mevcut.',
        centerDecision: 'pert',
        centerNote: 'Merkez PERT kararını iletti.',
        expectedVersion: 2,
        reason: 'Merkez kararı kaydedildi',
        confirmed: true,
      },
    })
    expect(decision.statusCode).toBe(200)
    const decided = pertAssessmentResponseSchema.parse(decision.json()).assessment
    expect(decided.version).toBe(3)
    expect(decided.currentVersion.workflowStatus).toBe('pert_decided')
    expect(decided.versions).toHaveLength(3)
    expect(decided.versions.find((version) => version.assessmentVersion === 1)?.expertOpinion).toBeNull()

    const stale = await app.inject({
      method: 'POST', url: versionsUrl(),
      headers: { cookie: expertCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        workflowStatus: 'under_review',
        expectedVersion: 1,
        reason: 'Bayat sürüm',
        confirmed: true,
      },
    })
    expect(stale.statusCode).toBe(409)
  })

  it('kapalı case değerlendirmesi salt okunurdur', async () => {
    const response = await app.inject({
      method: 'POST', url: assessmentUrl(closedCaseId),
      headers: { cookie: expertCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { workflowStatus: 'under_review', expectedCaseVersion: 1, confirmed: true },
    })
    expect(response.statusCode).toBe(409)
  })

  it('audit yalnız güvenli kod/oran metadata taşır; serbest metin sızdırmaz', async () => {
    const audits = (await pool.query(
      "SELECT action,details FROM audit_events WHERE organization_id=$1 AND action LIKE 'pert_assessment.%' ORDER BY occurred_at",
      [organizationId],
    )).rows as { action: string; details: Record<string, unknown> }[]
    expect(audits.map((row) => row.action)).toEqual([
      'pert_assessment.created',
      'pert_assessment.revised',
      'pert_assessment.revised',
    ])
    const text = JSON.stringify(audits)
    expect(text).not.toMatch(/Ön panel|ölçümü bekleniyor|yapısal hasar mevcut|Merkez PERT kararını/)
    expect(audits[0].details).toMatchObject({ workflowStatus: 'under_review', damageRatioPercent: 77, hasStructuralNote: true })
    expect(audits[2].details).toMatchObject({ workflowStatus: 'pert_decided', expertOpinion: 'pert', centerDecision: 'pert' })
  })
})
