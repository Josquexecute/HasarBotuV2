import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  CASE_DETAIL_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  caseNoteResponseSchema,
  caseOperationsResponseSchema,
  caseTaskResponseSchema,
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
const PASSWORD = 'p37-sentetik-guclu-parola-42'

describeDb('Paket 37 case not, görev ve takip geçmişi gerçek API', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let organizationId: string
  let foreignOrganizationId: string
  let managerUserId: string
  let activeAssigneeId: string
  let inactiveAssigneeId: string
  let foreignUserId: string
  let caseId: string
  let closedCaseId: string
  let foreignCaseId: string
  let managerCookie: string
  let readOnlyCookie: string

  const operationsUrl = (targetCaseId = caseId) => `/api/v1/cases/${targetCaseId}/operations`
  const notesUrl = (targetCaseId = caseId) => `/api/v1/cases/${targetCaseId}/notes`
  const tasksUrl = (targetCaseId = caseId) => `/api/v1/cases/${targetCaseId}/tasks`

  async function login(email: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: AUTH_LOGIN_ROUTE,
      payload: { email, password: PASSWORD },
    })
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
    managerUserId = uuidv7()
    activeAssigneeId = uuidv7()
    inactiveAssigneeId = uuidv7()
    const readOnlyUserId = uuidv7()
    foreignUserId = uuidv7()
    caseId = uuidv7()
    closedCaseId = uuidv7()
    foreignCaseId = uuidv7()
    const passwordHash = await hashPassword(PASSWORD)

    await pool.query(
      `INSERT INTO organizations (id,code,name)
       VALUES ($1,'p37-main','P37 Sentetik'),($2,'p37-foreign','P37 Yabancı')`,
      [organizationId, foreignOrganizationId],
    )
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash,status)
       VALUES
       ($1,$6,'p37-manager@test.local','P37 Dosya Sorumlusu',$8,'active'),
       ($2,$6,'p37-assignee@test.local','P37 Görevli',$8,'active'),
       ($3,$6,'p37-inactive@test.local','P37 Pasif',$8,'disabled'),
       ($4,$6,'p37-readonly@test.local','P37 Salt Okunur',$8,'active'),
       ($5,$7,'p37-foreign@test.local','P37 Yabancı',$8,'active')`,
      [
        managerUserId,
        activeAssigneeId,
        inactiveAssigneeId,
        readOnlyUserId,
        foreignUserId,
        organizationId,
        foreignOrganizationId,
        passwordHash,
      ],
    )
    await pool.query(
      `INSERT INTO user_roles (user_id,role_id)
       SELECT $1::uuid,id FROM roles WHERE code='case_manager'
       UNION ALL SELECT $2::uuid,id FROM roles WHERE code='read_only'`,
      [managerUserId, readOnlyUserId],
    )
    await pool.query(
      `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
        workflow_stage,plate,plate_normalized,responsible_user_id,follow_up_date)
       VALUES
       ($1,$4,2026,3701,'2026/3701','traffic','open','inspection_pending','34 P 3701','34P3701',$5,'2026-07-18'),
       ($2,$4,2026,3702,'2026/3702','casco','closed','closed','34 P 3702','34P3702',$5,NULL),
       ($3,$6,2026,3703,'2026/3703','traffic','open','new_notification','35 P 3703','35P3703',NULL,NULL)`,
      [caseId, closedCaseId, foreignCaseId, organizationId, managerUserId, foreignOrganizationId],
    )
    await pool.query(
      `INSERT INTO case_follow_up_history
       (id,organization_id,case_id,previous_follow_up_date,new_follow_up_date,source,case_version,actor_user_id)
       VALUES ($1,$2,$3,NULL,'2026-07-18','case_create',1,$4)`,
      [uuidv7(), organizationId, caseId, managerUserId],
    )

    app = buildApp({
      clock: fixedClock('2026-07-16T10:30:00.000Z'),
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 100, windowMs: 60_000 } },
    })
    managerCookie = await login('p37-manager@test.local')
    readOnlyCookie = await login('p37-readonly@test.local')
  }, 90_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('401, tenant 404, salt-okunur görüntüleme ve rol 403 sınırlarını uygular', async () => {
    expect((await app.inject({ method: 'GET', url: operationsUrl() })).statusCode).toBe(401)
    expect((await app.inject({
      method: 'GET',
      url: operationsUrl(foreignCaseId),
      headers: { cookie: managerCookie },
    })).statusCode).toBe(404)
    const readOnly = await app.inject({
      method: 'GET',
      url: operationsUrl(),
      headers: { cookie: readOnlyCookie },
    })
    expect(readOnly.statusCode).toBe(200)
    expect(caseOperationsResponseSchema.parse(readOnly.json()).permissions.canWrite).toBe(false)
    expect((await app.inject({
      method: 'POST',
      url: notesUrl(),
      headers: { cookie: readOnlyCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { noteType: 'internal', body: 'Yetkisiz sentetik not.' },
    })).statusCode).toBe(403)
  })

  it('append-only notu idempotent oluşturur ve içeriği audit detayına kopyalamaz', async () => {
    const key = uuidv7()
    const payload = {
      noteType: 'contact',
      subject: 'Sentetik servis görüşmesi',
      body: 'Yalnız test için sentetik ve kişisel veri içermeyen görüşme notu.',
    }
    const first = await app.inject({
      method: 'POST',
      url: notesUrl(),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: key },
      payload,
    })
    const replay = await app.inject({
      method: 'POST',
      url: notesUrl(),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: key },
      payload,
    })
    expect(first.statusCode).toBe(201)
    expect(replay.statusCode).toBe(201)
    expect(replay.json()).toEqual(first.json())
    expect(caseNoteResponseSchema.parse(first.json()).note.subject).toBe(payload.subject)
    const conflict = await app.inject({
      method: 'POST',
      url: notesUrl(),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: key },
      payload: { ...payload, body: 'Farklı gövde.' },
    })
    expect(conflict.statusCode).toBe(409)
    expect((await pool.query('SELECT count(*)::int AS n FROM case_notes WHERE case_id=$1', [caseId])).rows).toEqual([{ n: 1 }])
    const audit = await pool.query(
      "SELECT details::text FROM audit_events WHERE action='case_note.created' AND resource_id=$1",
      [caseNoteResponseSchema.parse(first.json()).note.id],
    )
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0]?.details).not.toContain(payload.body)
    expect(audit.rows[0]?.details).not.toContain(payload.subject)

    // A lost commit response followed by a service restart must preserve both the note and replay identity.
    await app.close()
    app = buildApp({
      clock: fixedClock('2026-07-16T10:30:00.000Z'),
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 100, windowMs: 60_000 } },
    })
    const afterRestart = await app.inject({ method: 'GET', url: operationsUrl(), headers: { cookie: managerCookie } })
    expect(afterRestart.statusCode).toBe(200)
    expect(caseOperationsResponseSchema.parse(afterRestart.json()).notes).toContainEqual(caseNoteResponseSchema.parse(first.json()).note)
    const restartedReplay = await app.inject({ method: 'POST', url: notesUrl(), headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: key }, payload })
    expect(restartedReplay.statusCode).toBe(201)
    expect(restartedReplay.json()).toEqual(first.json())
    expect((await pool.query('SELECT count(*)::int AS n FROM case_notes WHERE case_id=$1', [caseId])).rows).toEqual([{ n: 1 }])
  })

  it('görev oluşturma, aktif tenant referansı, stale locking, zorunlu sonuç ve replay uygular', async () => {
    const inactive = await app.inject({
      method: 'POST',
      url: tasksUrl(),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        title: 'Pasif kullanıcı görevi',
        priority: 'normal',
        assignedUserId: inactiveAssigneeId,
        dueDate: '2026-07-16',
      },
    })
    expect(inactive.statusCode).toBe(400)
    const foreign = await app.inject({
      method: 'POST',
      url: tasksUrl(),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        title: 'Yabancı kullanıcı görevi',
        priority: 'normal',
        assignedUserId: foreignUserId,
        dueDate: '2026-07-16',
      },
    })
    expect(foreign.statusCode).toBe(400)

    const created = await app.inject({
      method: 'POST',
      url: tasksUrl(),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        title: 'Sentetik servis formunu al',
        priority: 'high',
        assignedUserId: activeAssigneeId,
        dueDate: '2026-07-15',
      },
    })
    expect(created.statusCode).toBe(201)
    const task = caseTaskResponseSchema.parse(created.json()).task
    expect(task).toMatchObject({ status: 'open', dueStatus: 'overdue', version: 1 })

    const blank = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/tasks/${task.id}/complete`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedVersion: 1, resultNote: ' ' },
    })
    expect(blank.statusCode).toBe(400)
    const stale = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/tasks/${task.id}/complete`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedVersion: 2, resultNote: 'Sentetik sonuç.' },
    })
    expect(stale.statusCode).toBe(409)

    const completionKey = uuidv7()
    const completionPayload = { expectedVersion: 1, resultNote: 'Sentetik görev sonucu kaydedildi.' }
    const completed = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/tasks/${task.id}/complete`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: completionKey },
      payload: completionPayload,
    })
    const replay = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/tasks/${task.id}/complete`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: completionKey },
      payload: completionPayload,
    })
    expect(completed.statusCode).toBe(200)
    expect(replay.json()).toEqual(completed.json())
    expect(caseTaskResponseSchema.parse(completed.json()).task).toMatchObject({
      status: 'completed',
      version: 2,
      resolutionNote: completionPayload.resultNote,
    })
    expect((await pool.query('SELECT count(*)::int AS n FROM case_task_events WHERE task_id=$1', [task.id])).rows).toEqual([{ n: 2 }])
    const audit = await pool.query(
      "SELECT details::text FROM audit_events WHERE action='case_task.completed' AND resource_id=$1",
      [task.id],
    )
    expect(audit.rows[0]?.details).not.toContain(completionPayload.resultNote)

    const cancellable = await app.inject({
      method: 'POST',
      url: tasksUrl(),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        title: 'İptal edilecek sentetik görev',
        priority: 'low',
        assignedUserId: null,
        dueDate: '2026-07-20',
      },
    })
    const cancellableTask = caseTaskResponseSchema.parse(cancellable.json()).task
    const cancelled = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/tasks/${cancellableTask.id}/cancel`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedVersion: 1, reason: 'Sentetik görev artık uygulanmayacak.' },
    })
    expect(caseTaskResponseSchema.parse(cancelled.json()).task).toMatchObject({
      status: 'cancelled',
      version: 2,
    })
  })

  it('takip tarihinin manuel değişmesini reddeder ve geçmişi korur', async () => {
    const updated = await app.inject({
      method: 'PATCH',
      url: CASE_DETAIL_ROUTE.replace(':caseId', caseId),
      headers: { cookie: managerCookie },
      payload: { expectedVersion: 1, followUpDate: '2026-07-22' },
    })
    expect(updated.statusCode).toBe(400)
    const workspace = await app.inject({
      method: 'GET',
      url: operationsUrl(),
      headers: { cookie: managerCookie },
    })
    const body = caseOperationsResponseSchema.parse(workspace.json())
    expect(body.followUpHistory.map((item) => item.newFollowUpDate)).toEqual(['2026-07-18'])
    expect(body.followUpHistory[0]).toMatchObject({
      previousFollowUpDate: null,
      source: 'case_create',
      caseVersion: 1,
    })
    const audit = await pool.query(
      "SELECT count(*)::int AS n FROM audit_events WHERE action='case.follow_up_changed' AND resource_id=$1",
      [caseId],
    )
    expect(audit.rows).toEqual([{ n: 0 }])
  })

  it('kapalı dosyada yazmayı conflict ile durdurur ve response/audit sızıntısı üretmez', async () => {
    const response = await app.inject({
      method: 'POST',
      url: notesUrl(closedCaseId),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { noteType: 'internal', body: 'Kapalı dosyada yazılmamalı.' },
    })
    expect(response.statusCode).toBe(409)
    const allAudit = JSON.stringify((await pool.query(
      "SELECT action,details FROM audit_events WHERE organization_id=$1 AND action LIKE 'case_%'",
      [organizationId],
    )).rows)
    expect(allAudit).not.toMatch(/[A-Z]:\\|password|secret|stack|SELECT |INSERT /i)
  })
})
