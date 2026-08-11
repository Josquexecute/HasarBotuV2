import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
import { applyV1Import, hashPassword, planV1Import } from '../src/index.js'

/**
 * V1 -> V2 aktarim gercek Postgres E2E testleri (HB-2026-198 kritik kusur
 * duzeltmesi). Gercek dosya sistemine (`mkdtemp` ile izole gecici dizin)
 * ve gercek Postgres'e karsi calisir -- hicbir mock/stub DB katmani yoktur.
 */
const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe

const PASSWORD = 'v1-import-sentetik-guclu-parola-198'

function takipJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    caseIdentity: { caseKey: '', plate: '', dosyaNo: '', officeFileNo: '', claimNoticeNo: '34/876', folderPath: '', monthFolder: 'Temmuz 2026', isClosedFolder: false },
    metadata: { createdAt: '2026-07-01T10:00:00.000Z', updatedAt: '2026-07-02T10:00:00.000Z', createdByComputer: 'TEST-PC', updatedByComputer: 'TEST-PC', revision: 3, writeId: 'write-1' },
    assignment: { sorumlu: 'Sentetik Sorumlu', eksper: 'Sentetik Eksper', raportor: '', takipTarihi: '2026-07-10', sonIslemTarihi: '2026-07-02', oncelik: 'Kritik' },
    status: { dosyaDurumu: 'İncelemede', workflowStatus: 'Yeni Dosya', kapaliMi: false },
    claimType: 'trafik',
    service: { name: '', source: 'manual', updatedAt: '', updatedBy: '' },
    portalChecklist: [],
    todos: [
      { id: 'todo-1', title: 'PARÇA DAĞIT', completed: false, priority: 'Kritik', assignedTo: 'Sentetik Sorumlu', dueDate: '2026-07-05', createdAt: '2026-07-01T10:00:00.000Z' },
      { id: 'todo-2', title: 'TAMAMLANMIŞ İŞ', completed: true, priority: 'Normal', assignedTo: '', dueDate: '2026-07-01', createdAt: '2026-07-01T10:00:00.000Z' },
    ],
    notes: [{ id: 'note-1', createdAt: '2026-07-01T11:00:00.000Z', createdBy: 'Sentetik Sorumlu', text: 'V1 test notu' }],
    rucu: { varMi: false, potansiyel: false, durum: 'Yok', not: '' },
    labor: { parcaListesiIstendi: false, parcaKodlariIstendi: false, parcaIscilikGirildi: false, not: '' },
    kttKusur: { helperOnly: true, finalDecisionWarning: '', not: '' },
    heavyDamage: { enabled: false, helperOnly: true, finalDecisionWarning: '', not: '' },
    vehicleContext: {},
    audit: [],
    ...overrides,
  })
}

function takipOzetiTxt(): string {
  return 'HASARBOTU TAKİP ÖZETİ\n=====================\nPlaka: TEST\n\nUYARI: Ana kaynak _HASARBOTU/takip.json dosyasıdır. Bu TXT yalnızca okunabilir özettir.\n'
}

async function writeSidecar(folderPath: string, jsonContent: string | null, txtContent: string | null): Promise<void> {
  const sidecarDir = join(folderPath, '_HASARBOTU')
  await mkdir(sidecarDir, { recursive: true })
  if (jsonContent !== null) await writeFile(join(sidecarDir, 'takip.json'), jsonContent, 'utf8')
  if (txtContent !== null) await writeFile(join(sidecarDir, 'HASARBOTU_TAKIP_OZETI.txt'), txtContent, 'utf8')
}

describeDb('V1 aktarim (gercek dosya sistemi + gercek Postgres)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let organizationId: string
  let actorUserId: string
  let sorumluUserId: string
  let root: string

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    organizationId = uuidv7()
    actorUserId = uuidv7()
    sorumluUserId = uuidv7()
    await pool.query('INSERT INTO organizations (id,code,name) VALUES ($1,$2,$3)', [organizationId, 'v1-import-test', 'V1 Import Test'])
    await pool.query(
      'INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,$5)',
      [actorUserId, organizationId, 'aktor@test.local', 'Test Aktor', await hashPassword(PASSWORD)],
    )
    await pool.query("INSERT INTO user_roles (user_id,role_id) SELECT $1,id FROM roles WHERE code='admin'", [actorUserId])
    await pool.query(
      'INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,$5)',
      [sorumluUserId, organizationId, 'sorumlu@test.local', 'Sentetik Sorumlu', await hashPassword(PASSWORD)],
    )
    await pool.query("INSERT INTO user_roles (user_id,role_id) SELECT $1,id FROM roles WHERE code='case_manager'", [sorumluUserId])
  }, 60_000)

  afterAll(async () => {
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  afterEach(async () => {
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  })

  it('kesif + plan: gecerli trafik, bilinmeyen tur, malformed json, eksik sidecar, ayristirilamayan klasor adini ayri ayri siniflandirir', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-import-'))
    const y = join(root, '2026', 'Temmuz 2026')
    await mkdir(y, { recursive: true })

    await writeSidecar(join(y, '34AAA111'), takipJson(), takipOzetiTxt())
    await writeSidecar(join(y, '34BBB222'), takipJson({ claimType: 'unknown' }), null)
    await writeSidecar(join(y, '34CCC333'), '{ bozuk json', null)
    await mkdir(join(y, '34DDD444'), { recursive: true }) // sidecar yok
    await mkdir(join(y, 'DEĞER KAYBI'), { recursive: true }) // plaka-olmayan klasor

    const plan = await planV1Import(pool, organizationId, root)
    expect(plan.summary.totalFoldersDiscovered).toBe(5) // 'DEĞER KAYBI' plaka-sekli degil, discover yine de sayar ama parsedName null olur
    const byPath = new Map(plan.entries.map((e) => [e.folder.folderName, e]))
    expect(byPath.get('34AAA111')?.action).toBe('create_case')
    expect(byPath.get('34BBB222')?.action).toBe('unknown_claim_type')
    expect(byPath.get('34CCC333')?.action).toBe('malformed_or_unsupported_json')
    expect(byPath.get('34DDD444')?.action).toBe('missing_sidecar')
    expect(byPath.get('DEĞER KAYBI')?.action).toBe('unparseable_folder_name')
  })

  it('desteklenmeyen schemaVersion acikca isaretlenir, TAHMIN edilerek 1 gibi islenmez', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-import-'))
    const y = join(root, '2026', 'Ağustos 2026')
    await mkdir(y, { recursive: true })
    await writeSidecar(join(y, '34EEE555'), JSON.stringify({ schemaVersion: 2, claimType: 'trafik' }), null)

    const plan = await planV1Import(pool, organizationId, root)
    expect(plan.entries[0]?.action).toBe('malformed_or_unsupported_json')
    expect(plan.entries[0]?.reasons[0]).toContain('unsupported_schema_version')
  })

  it('apply: case + not + TAMAMLANMAMIS gorev olusturur; TAMAMLANMIS gorev yeniden olusturulmaz; sorumlu isim-eslesmesiyle atanir', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-import-'))
    const y = join(root, '2026', 'Temmuz 2026')
    await mkdir(y, { recursive: true })
    await writeSidecar(join(y, '34FFF666'), takipJson(), takipOzetiTxt())

    const plan = await planV1Import(pool, organizationId, root)
    const result = await applyV1Import(pool, { organizationId, actorUserId, requestId: 'test-1' }, plan)
    expect(result.casesCreated).toBe(1)
    expect(result.notesCreated).toBe(1)
    expect(result.tasksCreated).toBe(1) // yalniz todo-1 (completed:false); todo-2 (completed:true) OLUSTURULMAZ
    expect(result.failed).toBe(0)

    const caseRow = await pool.query(
      "SELECT case_type,plate_normalized,responsible_user_id::text,notification_form_number,lifecycle_status FROM cases WHERE organization_id=$1",
      [organizationId],
    )
    expect(caseRow.rows[0]).toMatchObject({
      case_type: 'traffic', plate_normalized: '34FFF666', responsible_user_id: sorumluUserId,
      notification_form_number: '34/876',
      // Kasitli kapsam disi: lifecycle_status otomatik 'closed' yapilmaz (bkz. store.ts dosya-basi not).
      lifecycle_status: 'open',
    })

    const noteRow = await pool.query('SELECT body FROM case_notes WHERE organization_id=$1', [organizationId])
    expect((noteRow.rows[0] as { body: string }).body).toContain('V1 test notu')
    expect((noteRow.rows[0] as { body: string }).body).toContain('Sentetik Sorumlu')

    const taskRow = await pool.query('SELECT title,priority,assigned_user_id::text,status FROM case_tasks WHERE organization_id=$1', [organizationId])
    expect(taskRow.rows[0]).toMatchObject({ title: 'PARÇA DAĞIT', priority: 'high', assigned_user_id: sorumluUserId, status: 'open' })

    const provenanceCount = await pool.query('SELECT count(*)::int AS n FROM v1_import_records WHERE organization_id=$1', [organizationId])
    expect(provenanceCount.rows[0].n).toBeGreaterThanOrEqual(3) // case + note + task (+ olasi field_backfill'ler)
  })

  it('IKINCI kez apply calistirmak duplicate case/not/gorev URETMEZ (idempotency)', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-import-'))
    const y = join(root, '2026', 'Temmuz 2026')
    await mkdir(y, { recursive: true })
    await writeSidecar(join(y, '34GGG777'), takipJson(), takipOzetiTxt())

    const plan1 = await planV1Import(pool, organizationId, root)
    const result1 = await applyV1Import(pool, { organizationId, actorUserId, requestId: 'test-2a' }, plan1)
    expect(result1.casesCreated).toBe(1)

    // Ikinci calistirma: plan artik 'up_to_date' gormeli, apply hicbir sey URETMEMELI.
    const plan2 = await planV1Import(pool, organizationId, root)
    const entry2 = plan2.entries.find((e) => e.folder.folderName === '34GGG777')
    expect(entry2?.action).toBe('up_to_date')
    expect(entry2?.notes.every((n) => n.alreadyImported)).toBe(true)
    expect(entry2?.tasks.every((t) => t.alreadyImported)).toBe(true)

    const result2 = await applyV1Import(pool, { organizationId, actorUserId, requestId: 'test-2b' }, plan2)
    expect(result2.casesCreated).toBe(0)
    expect(result2.notesCreated).toBe(0)
    expect(result2.tasksCreated).toBe(0)

    const caseCount = await pool.query("SELECT count(*)::int AS n FROM cases WHERE organization_id=$1 AND plate_normalized='34GGG777'", [organizationId])
    expect(caseCount.rows[0].n).toBe(1)
    // Not sayimi bu dosyaya (case_id) gore sinirlanir -- organization_id tek
    // basina digerdosya seviyesindeki testlerin notlarini da kapsar (yanlis pozitif).
    const noteCount = await pool.query(
      "SELECT count(*)::int AS n FROM case_notes cn JOIN cases c ON c.id=cn.case_id WHERE c.organization_id=$1 AND c.plate_normalized='34GGG777'",
      [organizationId],
    )
    expect(noteCount.rows[0].n).toBe(1)
  })

  it('mevcut V2 dosyasinda KULLANICININ SONRADAN girdigi deger varsa KOR EZILMEZ, conflict olarak isaretlenir', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-import-'))
    const y = join(root, '2026', 'Temmuz 2026')
    await mkdir(y, { recursive: true })
    await writeSidecar(join(y, '34HHH888'), takipJson(), null)

    // V2'de ONCEDEN, kullanicinin gercekten girdigi FARKLI bir notificationFormNumber olan bir case var.
    const existingCaseId = uuidv7()
    await pool.query(
      `INSERT INTO cases (id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,
         plate,plate_normalized,notification_form_number)
       VALUES ($1,$2,2026,9001,'2026/9001','traffic','reporting','34 HHH 888','34HHH888','KULLANICI-GIRDI-99')`,
      [existingCaseId, organizationId],
    )

    const plan = await planV1Import(pool, organizationId, root)
    const entry = plan.entries.find((e) => e.folder.folderName === '34HHH888')
    expect(entry?.action).toBe('conflict_field_values')
    expect(entry?.matchedCaseId).toBe(existingCaseId)

    const result = await applyV1Import(pool, { organizationId, actorUserId, requestId: 'test-3' }, plan)
    // conflict_field_values apply tarafindan atlanir -- alan EZILMEZ.
    const row = await pool.query('SELECT notification_form_number FROM cases WHERE id=$1', [existingCaseId])
    expect(row.rows[0].notification_form_number).toBe('KULLANICI-GIRDI-99')
    expect(result.casesBackfilled).toBe(0)
  })

  it('mevcut V2 dosyasinda alan BOSSA guvenle backfill edilir (kor ezme degil, BOS doldurma)', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-import-'))
    const y = join(root, '2026', 'Temmuz 2026')
    await mkdir(y, { recursive: true })
    await writeSidecar(join(y, '34III999'), takipJson(), null)

    const existingCaseId = uuidv7()
    await pool.query(
      `INSERT INTO cases (id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,plate,plate_normalized)
       VALUES ($1,$2,2026,9002,'2026/9002','traffic','reporting','34 III 999','34III999')`,
      [existingCaseId, organizationId],
    )

    const plan = await planV1Import(pool, organizationId, root)
    expect(plan.entries[0]?.action).toBe('backfill_existing')
    const result = await applyV1Import(pool, { organizationId, actorUserId, requestId: 'test-4' }, plan)
    expect(result.casesBackfilled).toBe(1)

    const row = await pool.query('SELECT notification_form_number,responsible_user_id::text FROM cases WHERE id=$1', [existingCaseId])
    expect(row.rows[0]).toMatchObject({ notification_form_number: '34/876', responsible_user_id: sorumluUserId })
  })

  it('KAPALI arsiv klasoru: fiziksel konum + status.kapaliMi kapali tespit eder, ama lifecycle_status otomatik degistirilmez (kapsam disi, belgelenmis)', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-import-'))
    const kapali = join(root, '2026', 'Temmuz 2026', 'KAPALI TEMMUZ 2026')
    await mkdir(kapali, { recursive: true })
    await writeSidecar(
      join(kapali, '34JJJ000'),
      takipJson({
        caseIdentity: { caseKey: '', plate: '', dosyaNo: '', officeFileNo: '', claimNoticeNo: '', folderPath: '', monthFolder: 'Temmuz 2026', isClosedFolder: false },
        status: { dosyaDurumu: 'Kapalı', workflowStatus: 'Kapalı', kapaliMi: true },
      }),
      null,
    )

    const plan = await planV1Import(pool, organizationId, root)
    const entry = plan.entries[0]
    expect(entry?.closed).toBe(true)
    expect(entry?.closedConflicting).toBe(true) // isClosedFolder:false vs fiziksel+kapaliMi:true

    const result = await applyV1Import(pool, { organizationId, actorUserId, requestId: 'test-5' }, plan)
    expect(result.casesCreated).toBe(1)
    const row = await pool.query("SELECT lifecycle_status FROM cases WHERE organization_id=$1 AND plate_normalized='34JJJ000'", [organizationId])
    expect(row.rows[0].lifecycle_status).toBe('open')
  })

  it('ayni plakanin AGENTS.md " - N" sonekli iki ayri V1 klasoru iki AYRI dosya olarak islenir', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-import-'))
    const y = join(root, '2026', 'Mayıs 2026')
    await mkdir(y, { recursive: true })
    await writeSidecar(join(y, '34KKK111'), takipJson(), null)
    await writeSidecar(join(y, '34KKK111 - 2'), takipJson({ claimType: 'kasko' }), null)

    const plan = await planV1Import(pool, organizationId, root)
    expect(plan.summary.toCreate).toBe(2)
    const result = await applyV1Import(pool, { organizationId, actorUserId, requestId: 'test-6' }, plan)
    expect(result.casesCreated).toBe(2)
    const rows = await pool.query("SELECT case_type FROM cases WHERE organization_id=$1 AND plate_normalized='34KKK111' ORDER BY case_type", [organizationId])
    expect(rows.rows.map((r) => (r as { case_type: string }).case_type)).toEqual(['casco', 'traffic'])
  })

  it('mevcut V2 dosyasi KAPALIYSA diger tum modullerle ayni sekilde yeni alan/not/gorev YAZILMAZ', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-import-'))
    const y = join(root, '2026', 'Haziran 2026')
    await mkdir(y, { recursive: true })
    await writeSidecar(join(y, '34LLL222'), takipJson(), null)

    const existingCaseId = uuidv7()
    await pool.query(
      `INSERT INTO cases (id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,
         lifecycle_status,plate,plate_normalized)
       VALUES ($1,$2,2026,9003,'2026/9003','traffic','closed','closed','34 LLL 222','34LLL222')`,
      [existingCaseId, organizationId],
    )

    const plan = await planV1Import(pool, organizationId, root)
    const entry = plan.entries.find((e) => e.folder.folderName === '34LLL222')
    expect(entry?.action).toBe('skipped_closed_case')
    expect(entry?.matchedCaseId).toBe(existingCaseId)

    const result = await applyV1Import(pool, { organizationId, actorUserId, requestId: 'test-7' }, plan)
    expect(result.failed).toBe(0)
    expect(result.notesCreated).toBe(0)
    expect(result.tasksCreated).toBe(0)
    expect(result.casesBackfilled).toBe(0)
    const noteCount = await pool.query('SELECT count(*)::int AS n FROM case_notes WHERE case_id=$1', [existingCaseId])
    expect(noteCount.rows[0].n).toBe(0)
  })
})
