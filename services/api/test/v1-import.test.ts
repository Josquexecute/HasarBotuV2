import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type pg from 'pg'
import {
  assertTestDatabaseUrl,
  closeDatabasePool,
  createDatabasePool,
  runMigrations,
  uuidv7,
  type DatabaseConfig,
} from '@hasarbotu/database'
import {
  applyV1Import,
  applyV1Remediation,
  hashPassword,
  planV1Import,
  planV1Remediation,
} from '../src/index.js'
import { createCaseOperationsStore } from '../src/case-operations/store.js'

const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'v1-remediation-sentetik-guclu-parola'

interface SourceInput {
  readonly caseKey: string
  readonly createdAt: string
  readonly claimType?: string
  readonly claimNoticeNo?: string
  readonly claimFileNo?: string
  readonly officeFileNo?: string
  readonly closed?: boolean
  readonly responsible?: string
  readonly expert?: string
  readonly service?: string
  readonly followUpDate?: string
  readonly notes?: readonly { id: string; text: string; createdAt?: string; createdBy?: string }[]
  readonly todos?: readonly { id: string; title: string; completed: boolean; completedAt?: string; assignedTo?: string }[]
  readonly vehicle?: boolean
}

function takipJson(input: SourceInput): string {
  return JSON.stringify({
    schemaVersion: 1,
    caseIdentity: {
      caseKey: input.caseKey,
      plate: '',
      dosyaNo: input.claimFileNo ?? '',
      officeFileNo: input.officeFileNo ?? '',
      claimNoticeNo: input.claimNoticeNo ?? '',
      folderPath: '',
      monthFolder: 'Temmuz 2026',
      isClosedFolder: input.closed ?? false,
    },
    metadata: {
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      createdByComputer: 'TEST-PC',
      updatedByComputer: 'TEST-PC',
      revision: 1,
      writeId: `write-${input.caseKey}`,
    },
    assignment: {
      sorumlu: input.responsible ?? '',
      eksper: input.expert ?? '',
      raportor: 'Sentetik Raportor',
      takipTarihi: input.followUpDate ?? '',
      sonIslemTarihi: '',
      oncelik: 'Kritik',
    },
    status: {
      dosyaDurumu: input.closed ? 'Kapali' : 'Aktif',
      workflowStatus: input.closed ? 'Kapali' : 'Yeni Dosya',
      kapaliMi: input.closed ?? false,
    },
    claimType: input.claimType ?? 'trafik',
    service: { name: input.service ?? '', source: 'manual', updatedAt: input.createdAt, updatedBy: 'Sentetik' },
    portalChecklist: [{ key: 'portal', label: 'Portal kontrolu', completed: true, completedBy: 'Sentetik', completedAt: input.createdAt }],
    todos: (input.todos ?? []).map((todo) => ({
      id: todo.id,
      title: todo.title,
      completed: todo.completed,
      priority: 'Kritik',
      assignedTo: todo.assignedTo ?? '',
      dueDate: '2026-07-10',
      createdAt: input.createdAt,
      completedAt: todo.completedAt ?? '',
    })),
    notes: (input.notes ?? []).map((note) => ({
      id: note.id,
      text: note.text,
      createdAt: note.createdAt ?? input.createdAt,
      createdBy: note.createdBy ?? 'Sentetik Yazar',
    })),
    vehicleContext: input.vehicle ? {
      plate: '', chassisNo: 'TESTVIN1234567890', engineNo: 'ENGINE-RAW', make: 'Test Marka', model: 'Test Model',
      modelYear: '2024', fuelType: 'Benzin', engineDisplacement: '1600', transmission: 'Otomatik', bodyType: 'Sedan', damageDirection: 'On',
    } : undefined,
    audit: [{ at: input.createdAt, by: 'Sentetik', computer: 'TEST-PC', action: 'tracking-file-created', text: '' }],
  })
}

async function writeSource(root: string, relativeFolder: string, input: SourceInput | string | null): Promise<string> {
  const folder = join(root, relativeFolder)
  await mkdir(join(folder, '_HASARBOTU'), { recursive: true })
  if (input !== null) {
    await writeFile(join(folder, '_HASARBOTU', 'takip.json'), typeof input === 'string' ? input : takipJson(input), 'utf8')
  }
  return folder
}

describeDb('V1 remediation (gercek dosya sistemi + gercek PostgreSQL)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let organizationId: string
  let actorUserId: string
  let responsibleUserId: string
  let serviceId: string
  let root: string | undefined
  let officeSequence = 20_000

  async function insertCase(plate: string, caseType: 'traffic' | 'casco' = 'traffic', notification: string | null = null): Promise<string> {
    officeSequence += 1
    const id = uuidv7()
    await pool.query(
      `INSERT INTO cases
        (id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,plate,plate_normalized,notification_form_number)
       VALUES ($1,$2,2026,$3,$4,$5,'new_notification',$6,$7,$8)`,
      [id, organizationId, officeSequence, `2026/${officeSequence}`, caseType, plate.replace(/(\d{2})([A-Z]+)(\d+)/u, '$1 $2 $3'), plate, notification],
    )
    return id
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    organizationId = uuidv7()
    actorUserId = uuidv7()
    responsibleUserId = uuidv7()
    serviceId = uuidv7()
    await pool.query('INSERT INTO organizations (id,code,name) VALUES ($1,$2,$3)', [organizationId, 'v1-remediation-test', 'V1 Remediation Test'])
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES
       ($1,$3,'actor@test.local','Sentetik Aktor',$4),($2,$3,'responsible@test.local','Sentetik Sorumlu',$4)`,
      [actorUserId, responsibleUserId, organizationId, await hashPassword(PASSWORD)],
    )
    await pool.query("INSERT INTO user_roles (user_id,role_id) SELECT $1,id FROM roles WHERE code='admin'", [actorUserId])
    await pool.query(
      "INSERT INTO service_centers (id,organization_id,name,center_type,service_type) VALUES ($1,$2,'Sentetik Servis','ozel','private')",
      [serviceId, organizationId],
    )
  }, 60_000)

  afterAll(async () => {
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  afterEach(async () => {
    if (root !== undefined) await rm(root, { recursive: true, force: true })
    root = undefined
  })

  it('preview blocked oge notlarini actionable saymaz; malformed/missing/ambiguous kategorilerini ayirir', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-remediation-'))
    const month = '2026/Temmuz 2026'
    await writeSource(root, `${month}/34AAA111`, {
      caseKey: 'case-a', createdAt: '2026-07-01T07:00:00Z',
      notes: [{ id: 'note-a', text: 'Actionable note' }, { id: 'note-empty', text: '' }],
      todos: [{ id: 'task-empty', title: '', completed: false }],
    })
    await writeSource(root, `${month}/34BBB222`, {
      caseKey: 'case-b', createdAt: '2026-07-02T07:00:00Z', claimType: '',
      notes: [{ id: 'note-b1', text: 'Blocked one' }, { id: 'note-b2', text: 'Blocked two' }],
    })
    await insertCase('34CCC333')
    await insertCase('34CCC333')
    await writeSource(root, `${month}/34CCC333`, {
      caseKey: 'case-c', createdAt: '2026-07-03T07:00:00Z',
      notes: [{ id: 'note-c', text: 'Ambiguous note' }],
    })
    await writeSource(root, `${month}/34DDD444`, '{ malformed')
    await writeSource(root, `${month}/34EEE555`, null)

    const plan = await planV1Remediation(pool, organizationId, root)
    expect(plan.summary.actionable.notesToCreate).toBe(1)
    expect(plan.summary.actionable.tasksToCreate).toBe(0)
    expect(plan.summary.blocked.unknownClaimType).toBe(1)
    expect(plan.summary.blocked.ambiguousCase).toBe(1)
    expect(plan.summary.blocked.malformed).toBe(1)
    expect(plan.summary.blocked.missingSidecar).toBe(1)
    expect(plan.summary.blocked.other).toBe(1)
    expect(plan.summary.duplicatesThatWouldBeCreated).toBe(0)
  })

  it('ilk import; raw revision, historical note/task zamanlari, completed task, events, follow-up ve first-class alanlari korur', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-remediation-'))
    await writeSource(root, '2026/Temmuz 2026/34FFF666', {
      caseKey: 'case-full', createdAt: '2026-07-04T07:00:00Z', claimNoticeNo: 'NOTICE-1', claimFileNo: 'CLAIM-1',
      responsible: 'Sentetik Sorumlu', expert: 'Sentetik Sorumlu', service: 'Sentetik Servis', followUpDate: '2026-07-20',
      notes: [{ id: 'note-full', text: 'Ham tarihsel not', createdAt: '2026-07-04T08:30:00Z', createdBy: 'V1 Yazar' }],
      todos: [
        { id: 'task-open', title: 'Acik gorev', completed: false, assignedTo: 'Sentetik Sorumlu' },
        { id: 'task-done', title: 'Tamamlanan gorev', completed: true, completedAt: '2026-07-05T09:00:00Z' },
      ],
      vehicle: true,
    })
    const plan = await planV1Remediation(pool, organizationId, root)
    expect(plan.schemaReady).toBe(true)
    expect(plan.summary.actionable).toMatchObject({
      casesToCreate: 1, notesToCreate: 1, tasksToCreate: 1, completedTasksToCreate: 1,
    })
    expect(plan.summary.safeRemediation.taskEvents).toBe(3)
    const result = await applyV1Remediation(pool, { organizationId, actorUserId, requestId: 'full-apply' }, plan)
    expect(result).toMatchObject({ failed: 0, casesCreated: 1, notesCreated: 1, tasksCreated: 1, completedTasksCreated: 1 })

    const caseRow = await pool.query(
      `SELECT id::text,notification_form_number,insurer_claim_number,responsible_user_id::text,expert_user_id::text,service_center_id::text,
              to_char(follow_up_date,'YYYY-MM-DD') AS follow_up_date,lifecycle_status
         FROM cases WHERE organization_id=$1 AND plate_normalized='34FFF666'`, [organizationId],
    )
    expect(caseRow.rows[0]).toMatchObject({
      notification_form_number: 'NOTICE-1', insurer_claim_number: 'CLAIM-1', responsible_user_id: responsibleUserId, expert_user_id: responsibleUserId,
      service_center_id: serviceId, follow_up_date: '2026-07-20', lifecycle_status: 'open',
    })
    const caseId = String(caseRow.rows[0].id)
    const note = await pool.query('SELECT body,created_at FROM case_notes WHERE case_id=$1', [caseId])
    expect(note.rows[0].body).toBe('Ham tarihsel not')
    expect((note.rows[0].created_at as Date).toISOString()).toBe('2026-07-04T08:30:00.000Z')
    const tasks = await pool.query('SELECT status,version,resolved_at FROM case_tasks WHERE case_id=$1 ORDER BY status', [caseId])
    expect(tasks.rows.map((row) => row.status)).toEqual(['completed', 'open'])
    expect(tasks.rows[0]).toMatchObject({ status: 'completed', version: 2 })
    expect((tasks.rows[0].resolved_at as Date).toISOString()).toBe('2026-07-05T09:00:00.000Z')
    const counts = await pool.query(
      `SELECT
        (SELECT count(*)::int FROM case_task_events WHERE case_id=$1) AS events,
        (SELECT count(*)::int FROM case_follow_up_history WHERE case_id=$1 AND source='v1_historical_import') AS followups,
        (SELECT count(*)::int FROM v1_import_source_revisions WHERE organization_id=$2) AS revisions,
        (SELECT count(*)::int FROM v1_import_item_metadata WHERE organization_id=$2) AS metadata,
        (SELECT count(*)::int FROM case_vehicle_profiles WHERE case_id=$1) AS profiles`,
      [caseId, organizationId],
    )
    expect(counts.rows[0]).toMatchObject({ events: 3, followups: 1, revisions: 1, profiles: 1 })
    expect(counts.rows[0].metadata).toBeGreaterThanOrEqual(5)
    const taskEvents = await pool.query(
      'SELECT event_type,event_source,source_identity,source_evidence FROM case_task_events WHERE case_id=$1 ORDER BY occurred_at,event_type',
      [caseId],
    )
    expect(taskEvents.rows).toHaveLength(3)
    expect(taskEvents.rows.every((event) => event.event_source === 'v1_historical_import'
      && event.source_identity !== null && event.source_evidence?.mappingVersion === 'v1-remediation/2.0.0')).toBe(true)
    const raw = await pool.query('SELECT raw_snapshot FROM v1_import_source_revisions WHERE organization_id=$1', [organizationId])
    expect(raw.rows[0].raw_snapshot.portalChecklist).toHaveLength(1)
    expect(raw.rows[0].raw_snapshot.assignment.raportor).toBe('Sentetik Raportor')
    const apiView = await createCaseOperationsStore(pool).read(organizationId, caseId, '2026-07-16', true)
    expect(apiView?.notes[0]).toMatchObject({
      body: 'Ham tarihsel not',
      createdAt: '2026-07-04T08:30:00.000Z',
      legacySource: { historical: true, authorName: 'V1 Yazar', occurredAt: '2026-07-04T08:30:00.000Z' },
    })
    expect(apiView?.tasks.find((task) => task.status === 'completed')?.legacySource).toMatchObject({
      historical: true,
      completedAt: '2026-07-05T09:00:00.000Z',
    })
    expect(apiView?.followUpHistory[0]?.source).toBe('v1_historical_import')
  })

  it('same-source replay ve ayni metinli iki mesru note native ID ile duplicate uretmez', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-remediation-'))
    await writeSource(root, '2026/Temmuz 2026/34GGG777', {
      caseKey: 'case-duplicate-text', createdAt: '2026-07-06T07:00:00Z',
      notes: [{ id: 'note-same-1', text: 'Ayni metin' }, { id: 'note-same-2', text: 'Ayni metin' }],
    })
    const first = await planV1Remediation(pool, organizationId, root)
    await applyV1Remediation(pool, { organizationId, actorUserId, requestId: 'replay-1' }, first)
    const auditBefore = await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE organization_id=$1 AND action='v1_remediation.applied'", [organizationId])
    const second = await planV1Remediation(pool, organizationId, root)
    expect(second.summary.actionable.notesToCreate).toBe(0)
    expect(second.summary.duplicatesThatWouldBeCreated).toBe(0)
    const replay = await applyV1Remediation(pool, { organizationId, actorUserId, requestId: 'replay-2' }, second)
    expect(replay).toMatchObject({ notesCreated: 0, tasksCreated: 0, completedTasksCreated: 0, historicalClosures: 0, failed: 0 })
    const auditAfter = await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE organization_id=$1 AND action='v1_remediation.applied'", [organizationId])
    expect(auditAfter.rows[0].n).toBe(auditBefore.rows[0].n)
    const count = await pool.query(
      `SELECT count(*)::int AS n FROM case_notes n JOIN cases c ON c.id=n.case_id
        WHERE c.organization_id=$1 AND c.plate_normalized='34GGG777'`, [organizationId],
    )
    expect(count.rows[0].n).toBe(2)
  })

  it('active -> KAPALI move ve ay klasoru rename sonrasi stable identity ile replay eder, closure import eder', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-remediation-'))
    const active = await writeSource(root, '2026/Temmuz 2026/34HHH888', {
      caseKey: 'case-move', createdAt: '2026-07-07T07:00:00Z',
      notes: [{ id: 'note-move', text: 'Tasinan not' }],
    })
    const first = await planV1Remediation(pool, organizationId, root)
    await applyV1Remediation(pool, { organizationId, actorUserId, requestId: 'move-1' }, first)

    const closed = join(root, '2026', 'Temmuz 2026', 'KAPALI TEMMUZ 2026', '34HHH888')
    await mkdir(dirname(closed), { recursive: true })
    await rename(active, closed)
    const moved = await planV1Remediation(pool, organizationId, root)
    expect(moved.summary.actionable.notesToCreate).toBe(0)
    expect(moved.summary.actionable.closuresToImport).toBe(1)
    expect(moved.summary.duplicatesThatWouldBeCreated).toBe(0)
    await applyV1Remediation(pool, { organizationId, actorUserId, requestId: 'move-2' }, moved)
    const closedCase = await pool.query("SELECT lifecycle_status,closed_at FROM cases WHERE organization_id=$1 AND plate_normalized='34HHH888'", [organizationId])
    expect(closedCase.rows[0]).toMatchObject({ lifecycle_status: 'closed', closed_at: null })
    const history = await pool.query("SELECT history_source,operation_type,source_occurred_at FROM case_lifecycle_history WHERE case_id=(SELECT id FROM cases WHERE organization_id=$1 AND plate_normalized='34HHH888')", [organizationId])
    expect(history.rows[0]).toMatchObject({ history_source: 'v1_historical_import', operation_type: 'historical_close', source_occurred_at: null })

    await writeFile(join(closed, '_HASARBOTU', 'takip.json'), takipJson({
      caseKey: 'case-move', createdAt: '2026-07-07T07:00:00Z', closed: true, claimNoticeNo: 'NOTICE-CLOSED',
      notes: [{ id: 'note-move', text: 'Tasinan not' }],
    }), 'utf8')
    const closedBackfill = await planV1Remediation(pool, organizationId, root)
    expect(closedBackfill.summary.actionable.otherFieldMappings).toBeGreaterThanOrEqual(1)
    await applyV1Remediation(pool, { organizationId, actorUserId, requestId: 'move-closed-backfill' }, closedBackfill)
    const closedField = await pool.query("SELECT notification_form_number FROM cases WHERE organization_id=$1 AND plate_normalized='34HHH888'", [organizationId])
    expect(closedField.rows[0].notification_form_number).toBe('NOTICE-CLOSED')

    await rename(join(root, '2026', 'Temmuz 2026'), join(root, '2026', 'Temmuz Arsiv'))
    const renamed = await planV1Remediation(pool, organizationId, root)
    expect(renamed.summary.actionable.notesToCreate).toBe(0)
    expect(renamed.summary.actionable.closuresToImport).toBe(0)
    expect(renamed.summary.duplicatesThatWouldBeCreated).toBe(0)
  })

  it('ayni plaka iki gercek case ve farkli source identity ile iki ayri case olusturur', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-remediation-'))
    await writeSource(root, '2026/Mayis 2026/34III999', { caseKey: 'case-i-1', createdAt: '2026-05-01T07:00:00Z', claimType: 'trafik' })
    await writeSource(root, '2026/Mayis 2026/34III999 - 2', { caseKey: 'case-i-2', createdAt: '2026-05-02T07:00:00Z', claimType: 'kasko' })
    const plan = await planV1Remediation(pool, organizationId, root)
    expect(plan.summary.actionable.casesToCreate).toBe(2)
    await applyV1Remediation(pool, { organizationId, actorUserId, requestId: 'same-plate' }, plan)
    const cases = await pool.query("SELECT case_type FROM cases WHERE organization_id=$1 AND plate_normalized='34III999' ORDER BY case_type", [organizationId])
    expect(cases.rows.map((row) => row.case_type)).toEqual(['casco', 'traffic'])
  })

  it('unknown type unique existing case ile auto-resolve olur; gercek unknown ve gercek ambiguous human kalir; exact notice ambiguous hedefi cozer', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-remediation-'))
    const uniqueId = await insertCase('34JJJ000', 'casco')
    await writeSource(root, '2026/Haziran 2026/34JJJ000', {
      caseKey: 'unknown-unique', createdAt: '2026-06-01T07:00:00Z', claimType: '', notes: [{ id: 'note-unknown-resolved', text: 'Resolved' }],
    })
    await writeSource(root, '2026/Haziran 2026/34KKK111', { caseKey: 'unknown-true', createdAt: '2026-06-02T07:00:00Z', claimType: '' })
    await insertCase('34LLL222', 'traffic', 'NOTICE-A')
    const exactTarget = await insertCase('34LLL222', 'traffic', 'NOTICE-B')
    await writeSource(root, '2026/Haziran 2026/34LLL222', {
      caseKey: 'ambiguous-exact', createdAt: '2026-06-03T07:00:00Z', claimNoticeNo: 'NOTICE-B', notes: [{ id: 'note-exact', text: 'Exact' }],
    })
    await insertCase('34MMM333')
    await insertCase('34MMM333')
    await writeSource(root, '2026/Haziran 2026/34MMM333', { caseKey: 'ambiguous-true', createdAt: '2026-06-04T07:00:00Z' })

    const plan = await planV1Remediation(pool, organizationId, root)
    const byIdentity = new Map(plan.entries.map((entry) => [entry.rawSnapshot?.caseIdentity?.caseKey, entry]))
    expect(byIdentity.get('unknown-unique')).toMatchObject({ targetCaseId: uniqueId, caseType: 'casco', caseTypeAutoResolved: true })
    expect(byIdentity.get('unknown-true')?.targetState).toBe('human_claim_type')
    expect(byIdentity.get('ambiguous-exact')).toMatchObject({ targetCaseId: exactTarget, targetState: 'existing' })
    expect(byIdentity.get('ambiguous-true')?.targetState).toBe('human_ambiguous')
    expect(plan.summary.autoResolved.unknownClaimTypes).toBeGreaterThanOrEqual(1)
    expect(plan.summary.autoResolved.ambiguousCases).toBeGreaterThanOrEqual(1)
  })

  it('source preview sonrasi degisirse TOCTOU fail-closed olur ve mutation yapmaz', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-remediation-'))
    const folder = await writeSource(root, '2026/Agustos 2026/34NNN444', {
      caseKey: 'case-toctou', createdAt: '2026-08-01T07:00:00Z', notes: [{ id: 'note-before', text: 'Once' }],
    })
    const plan = await planV1Remediation(pool, organizationId, root)
    const current = JSON.parse(await readFile(join(folder, '_HASARBOTU', 'takip.json'), 'utf8')) as Record<string, unknown>
    current.notes = [{ id: 'note-after', text: 'Sonra', createdAt: '2026-08-01T08:00:00Z', createdBy: 'Sentetik' }]
    await writeFile(join(folder, '_HASARBOTU', 'takip.json'), JSON.stringify(current), 'utf8')
    await expect(applyV1Remediation(pool, { organizationId, actorUserId, requestId: 'toctou' }, plan))
      .rejects.toThrow('v1_remediation_plan_stale')
    const count = await pool.query("SELECT count(*)::int AS n FROM cases WHERE organization_id=$1 AND plate_normalized='34NNN444'", [organizationId])
    expect(count.rows[0].n).toBe(0)
  })

  it('kismi-production fixture: moved legacy 0046 note/task provenance ile reconcile olur, duplicate sifir kalir', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-remediation-'))
    const caseId = await insertCase('34OOO555')
    const noteId = uuidv7()
    const taskId = uuidv7()
    await pool.query(
      "INSERT INTO case_notes (id,organization_id,case_id,note_type,body,created_by_user_id) VALUES ($1,$2,$3,'internal',$4,$5)",
      [noteId, organizationId, caseId, '[V1 kaynak: V1 Yazar, 2026-07-01T07:00:00Z] Legacy note', actorUserId],
    )
    await pool.query(
      `INSERT INTO case_tasks (id,organization_id,case_id,title,priority,due_date,created_by_user_id)
       VALUES ($1,$2,$3,'Legacy task','normal','2026-07-10',$4)`, [taskId, organizationId, caseId, actorUserId],
    )
    const oldPath = '2026/Temmuz 2026/34OOO555'
    for (const [itemType, sourceItemId, targetType, targetId] of [
      ['note', 'note-legacy', 'case_note', noteId],
      ['task', 'task-legacy', 'case_task', taskId],
    ] as const) {
      await pool.query(
        `INSERT INTO v1_import_records
          (id,organization_id,case_id,source_relative_path,source_file_kind,source_file_hash,source_schema_version,
           item_type,source_item_id,target_type,target_id,status,imported_by_user_id)
         VALUES ($1,$2,$3,$4,'takip_json',$5,1,$6,$7,$8,$9,'created',$10)`,
        [uuidv7(), organizationId, caseId, oldPath, 'a'.repeat(64), itemType, sourceItemId, targetType, targetId, actorUserId],
      )
    }
    await writeSource(root, '2026/Temmuz 2026/KAPALI TEMMUZ 2026/34OOO555', {
      caseKey: 'case-partial', createdAt: '2026-07-01T06:00:00Z', closed: true,
      notes: [{ id: 'note-legacy', text: 'Legacy note', createdAt: '2026-07-01T07:00:00Z', createdBy: 'V1 Yazar' }],
      todos: [{ id: 'task-legacy', title: 'Legacy task', completed: false }],
    })
    const plan = await planV1Remediation(pool, organizationId, root)
    expect(plan.summary.safeRemediation.moveRenameReconciliations).toBe(2)
    expect(plan.summary.actionable.notesToCreate).toBe(0)
    expect(plan.summary.actionable.tasksToCreate).toBe(0)
    expect(plan.summary.duplicatesThatWouldBeCreated).toBe(0)
    await applyV1Remediation(pool, { organizationId, actorUserId, requestId: 'partial' }, plan)
    const counts = await pool.query(
      `SELECT
        (SELECT count(*)::int FROM case_notes WHERE case_id=$1) AS notes,
        (SELECT count(*)::int FROM case_tasks WHERE case_id=$1) AS tasks,
        (SELECT count(*)::int FROM v1_import_record_reconciliations WHERE organization_id=$2) AS reconciled,
        (SELECT count(*)::int FROM case_task_events WHERE task_id=$3) AS events`,
      [caseId, organizationId, taskId],
    )
    expect(counts.rows[0]).toMatchObject({ notes: 1, tasks: 1, reconciled: 2, events: 1 })
  })

  it('legacy path writer guvenlik sinirinda fail-closed; preview DB yazmaz', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-remediation-'))
    await writeSource(root, '2026/Agustos 2026/34PPP666', { caseKey: 'legacy-disabled', createdAt: '2026-08-02T07:00:00Z' })
    const before = await pool.query('SELECT count(*)::int AS n FROM v1_import_records WHERE organization_id=$1', [organizationId])
    const legacyPlan = await planV1Import(pool, organizationId, root)
    await expect(applyV1Import(pool, { organizationId, actorUserId, requestId: 'legacy-disabled' }, legacyPlan))
      .rejects.toThrow('v1_legacy_apply_disabled_use_remediation')
    await planV1Remediation(pool, organizationId, root)
    const after = await pool.query('SELECT count(*)::int AS n FROM v1_import_records WHERE organization_id=$1', [organizationId])
    expect(after.rows[0].n).toBe(before.rows[0].n)
  })
})
