import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type pg from 'pg'
import {
  assertTestDatabaseUrl,
  checkDatabaseHealth,
  closeDatabasePool,
  createDatabasePool,
  runMigrations,
  uuidv7,
  type DatabaseConfig,
} from '../src/index.js'

/**
 * Gercek PostgreSQL entegrasyon testleri.
 *
 * TEST_DATABASE_URL yoksa bu blok ACIKCA atlanir (basarili sayilmaz, atlanmis
 * raporlanir). URL verildiginde veritabani adi `_test` ile bitmek zorundadir;
 * uretim veritabanina karsi kosma girisimi assertTestDatabaseUrl ile durur.
 */
const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe

describeDb('PostgreSQL entegrasyonu (gercek veritabani)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool

  async function resetDatabase(): Promise<void> {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await resetDatabase()
  })

  afterAll(async () => {
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('bos veritabanina ileri migration deterministik uygulanir', async () => {
    const applied = await runMigrations({ databaseUrl: config.url, quiet: true })
    expect(applied.map((m) => m.name)).toEqual([
      '0001_organizations',
      '0002_users_roles_sessions',
      '0003_cases_read_model',
      '0004_case_write_support',
      '0005_audit_append_only',
      '0006_storage_location',
      '0007_document_metadata',
      '0008_file_agent_jobs',
      '0009_document_requirement_rules',
      '0010_case_reference_enrichment',
      '0011_case_workspace_provisioning',
      '0012_case_file_operations',
      '0013_case_close_reopen_lifecycle',
      '0014_service_agreements',
    ])

    const tables = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    )
    expect(tables.rows.map((r: { table_name: string }) => r.table_name)).toEqual([
      'agents',
      'audit_events',
      'case_file_operations',
      'case_lifecycle_history',
      'case_lifecycle_operations',
      'case_location_history',
      'case_locations',
      'case_workspace_provisionings',
      'cases',
      'document_rule_evaluation_items',
      'document_rule_evaluations',
      'document_rule_sets',
      'document_rule_versions',
      'document_versions',
      'documents',
      'idempotency_keys',
      'insurer_service_agreements',
      'insurers',
      'jobs',
      'office_counters',
      'organizations',
      'pgmigrations',
      'photos',
      'roles',
      'service_centers',
      'sessions',
      'storage_roots',
      'user_roles',
      'users',
    ])
    const roles = await pool.query('SELECT count(*)::int AS n FROM roles')
    expect((roles.rows[0] as { n: number }).n).toBe(6)
  })

  it('ayni migration ikinci kez uygulanmaz (tekrar guvenligi)', async () => {
    const applied = await runMigrations({ databaseUrl: config.url, quiet: true })
    expect(applied).toEqual([])
  })

  it('0014 geri alinabilir, eski servis profilini donusturur ve yeniden ileri uygulanabilir', async () => {
    const rolledBack = await runMigrations({ databaseUrl: config.url, direction: 'down', count: 1, quiet: true })
    expect(rolledBack.map((migration) => migration.name)).toEqual(['0014_service_agreements'])
    const removed = await pool.query(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'insurer_service_agreements'",
    )
    expect((removed.rows[0] as { n: number }).n).toBe(0)
    const organizationId = uuidv7()
    const serviceId = uuidv7()
    await pool.query('INSERT INTO organizations (id,code,name) VALUES ($1,$2,$3)', [organizationId, 'p22-backfill', 'P22 Backfill'])
    await pool.query("INSERT INTO service_centers (id,organization_id,name,center_type) VALUES ($1,$2,'Eski Servis','ozel')", [serviceId, organizationId])
    const reapplied = await runMigrations({ databaseUrl: config.url, quiet: true })
    expect(reapplied.map((migration) => migration.name)).toEqual(['0014_service_agreements'])
    const profile = await pool.query('SELECT service_type FROM service_centers WHERE id=$1', [serviceId])
    expect(profile.rows).toEqual([{ service_type: 'private' }])
    const silentAgreements = await pool.query('SELECT count(*)::int AS n FROM insurer_service_agreements WHERE service_center_id=$1', [serviceId])
    expect(silentAgreements.rows).toEqual([{ n: 0 }])
  })

  it('0014 tenant, tarih, operasyon ve insan onayi kisitlarini zorlar', async () => {
    const orgA = uuidv7(); const orgB = uuidv7(); const insurerA = uuidv7(); const insurerB = uuidv7()
    const serviceA = uuidv7(); const userA = uuidv7()
    await pool.query('INSERT INTO organizations (id,code,name) VALUES ($1,$2,$3),($4,$5,$6)',
      [orgA, 'p22-a', 'P22 A', orgB, 'p22-b', 'P22 B'])
    await pool.query('INSERT INTO insurers (id,organization_id,name) VALUES ($1,$2,$3),($4,$5,$6)',
      [insurerA, orgA, 'Sigorta A', insurerB, orgB, 'Sigorta B'])
    await pool.query("INSERT INTO service_centers (id,organization_id,name,center_type,service_type) VALUES ($1,$2,'Servis A','ozel','private')", [serviceA, orgA])
    await pool.query("INSERT INTO users (id,organization_id,email,password_hash,display_name) VALUES ($1,$2,'p22-a@test.local','x','Onaylayan')", [userA, orgA])
    const insert = (overrides: { insurerId?: string; from?: string; to?: string | null; operations?: string[]; approved?: boolean } = {}) => pool.query(
      `INSERT INTO insurer_service_agreements
       (id,organization_id,insurer_id,service_center_id,agreement_status,effective_from,effective_to,supported_operations,
        source_reference,human_approved,approved_by_user_id,approved_at)
       VALUES ($1,$2,$3,$4,'active',$5,$6,$7,'sentetik-test',$8,$9,CASE WHEN $8 THEN now() ELSE NULL END)`,
      [uuidv7(), orgA, overrides.insurerId ?? insurerA, serviceA, overrides.from ?? '2026-01-01',
        overrides.to ?? '2026-12-31', overrides.operations ?? ['closure_documents'], overrides.approved ?? true,
        (overrides.approved ?? true) ? userA : null],
    )
    await insert()
    await expect(insert({ insurerId: insurerB })).rejects.toMatchObject({ code: '23503', constraint: 'insurer_service_agreements_insurer_tenant_fk' })
    await expect(insert({ from: '2026-12-31', to: '2026-01-01' })).rejects.toMatchObject({ code: '23514' })
    await expect(insert({ operations: ['delete_files'] })).rejects.toMatchObject({ code: '23514' })
    await expect(pool.query(
      `INSERT INTO insurer_service_agreements
       (id,organization_id,insurer_id,service_center_id,agreement_status,effective_from,supported_operations,source_reference,human_approved)
       VALUES ($1,$2,$3,$4,'active','2027-01-01',ARRAY['closure_documents'],'onaysiz-yanlis',true)`,
      [uuidv7(), orgA, insurerA, serviceA],
    )).rejects.toMatchObject({ code: '23514', constraint: 'insurer_service_agreements_approval_consistent' })
  })

  it('0013 lifecycle tutarliligi, tek aktif operasyon, guvenli yol ve append-only gecmisi zorlar', async () => {
    const organizationId = uuidv7()
    const userId = uuidv7()
    const caseId = uuidv7()
    const locationId = uuidv7()
    await pool.query('INSERT INTO organizations (id,code,name) VALUES ($1,$2,$3)', [organizationId, 'p21-db', 'P21 DB'])
    await pool.query("INSERT INTO users (id,organization_id,email,password_hash,display_name) VALUES ($1,$2,'p21@test.local','x','P21')", [userId, organizationId])
    await pool.query(
      `INSERT INTO cases (id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,plate,plate_normalized,notification_date)
       VALUES ($1,$2,2026,21,'2026/21','traffic','ready_to_close','34 DB 121','34DB121','2026-07-14')`,
      [caseId, organizationId],
    )
    await pool.query("INSERT INTO storage_roots (id,organization_id,root_key,label) VALUES ($1,$2,'test-root','Test')", [uuidv7(), organizationId])
    await pool.query(
      `INSERT INTO case_locations (id,organization_id,case_id,storage_root_key,relative_path,verification_status,source)
       VALUES ($1,$2,$3,'test-root','2026/Temmuz 2026/34DB121','verified','system')`,
      [locationId, organizationId, caseId],
    )
    const operationId = uuidv7()
    const insert = (id: string, destination: string, hash: string) => pool.query(
      `INSERT INTO case_lifecycle_operations
       (id,organization_id,case_id,operation_type,expected_case_version,expected_location_id,expected_location_version,
        source_storage_root_key,source_relative_path,destination_storage_root_key,destination_relative_path,closure_mode,
        requirement_snapshot,previous_lifecycle_status,target_lifecycle_status,previous_workflow_stage,target_workflow_stage,
        status,idempotency_key_hash,request_hash,created_by_user_id)
       VALUES ($1,$2,$3,'close',1,$4,1,'test-root','2026/Temmuz 2026/34DB121','test-root',$5,'normal','{}','open','closed','ready_to_close','closed','approval_required',$6,$7,$8)`,
      [id, organizationId, caseId, locationId, destination, hash, 'b'.repeat(64), userId],
    )
    await insert(operationId, '2026/Temmuz 2026/KAPALI TEMMUZ 2026/34DB121', 'a'.repeat(64))
    await expect(insert(uuidv7(), '2026/Temmuz 2026/KAPALI TEMMUZ 2026/BASKA', 'c'.repeat(64)))
      .rejects.toMatchObject({ code: '23505', constraint: 'case_lifecycle_operations_one_active_case' })
    await pool.query("UPDATE case_lifecycle_operations SET status='cancelled' WHERE id=$1", [operationId])
    await expect(insert(uuidv7(), '../disari', 'd'.repeat(64)))
      .rejects.toMatchObject({ code: '23514', constraint: 'case_lifecycle_operations_destination_path_safe' })
    await expect(pool.query("UPDATE cases SET lifecycle_status='closed' WHERE id=$1", [caseId]))
      .rejects.toMatchObject({ code: '23514', constraint: 'cases_lifecycle_stage_consistent' })

    const historyId = uuidv7()
    await pool.query(
      `INSERT INTO case_lifecycle_history
       (id,organization_id,case_id,lifecycle_operation_id,operation_type,previous_lifecycle_status,lifecycle_status,
        previous_workflow_stage,workflow_stage,source_storage_root_key,source_relative_path,storage_root_key,relative_path)
       VALUES ($1,$2,$3,$4,'close','open','closed','ready_to_close','closed','test-root','2026/Temmuz 2026/34DB121',
       'test-root','2026/Temmuz 2026/KAPALI TEMMUZ 2026/34DB121')`,
      [historyId, organizationId, caseId, operationId],
    )
    await expect(pool.query("UPDATE case_lifecycle_history SET workflow_stage='reporting' WHERE id=$1", [historyId]))
      .rejects.toMatchObject({ code: '23001' })
    await expect(pool.query('DELETE FROM case_lifecycle_history WHERE id=$1', [historyId]))
      .rejects.toMatchObject({ code: '23001' })
  })

  it('0012 güvenli yol, tek aktif vaka, hedef rezervasyonu ve idempotency kısıtlarını uygular', async () => {
    const organizationId = uuidv7()
    const userId = uuidv7()
    const firstCaseId = uuidv7()
    const secondCaseId = uuidv7()
    const firstLocationId = uuidv7()
    const secondLocationId = uuidv7()
    const rootId = uuidv7()
    await pool.query('INSERT INTO organizations (id, code, name) VALUES ($1,$2,$3)', [organizationId, 'p20-db', 'P20 DB'])
    await pool.query(
      "INSERT INTO users (id,organization_id,email,password_hash,display_name) VALUES ($1,$2,'p20@test.local','x','P20')",
      [userId, organizationId],
    )
    await pool.query(
      `INSERT INTO cases (id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,plate,plate_normalized,notification_date)
       VALUES ($1,$3,2026,20,'2026/20','traffic','new_notification','34 DB 020','34DB020','2026-07-14'),
              ($2,$3,2026,21,'2026/21','traffic','new_notification','34 DB 021','34DB021','2026-07-14')`,
      [firstCaseId, secondCaseId, organizationId],
    )
    await pool.query("INSERT INTO storage_roots (id,organization_id,root_key,label) VALUES ($1,$2,'test-root','Test')", [rootId, organizationId])
    await pool.query(
      `INSERT INTO case_locations (id,organization_id,case_id,storage_root_key,relative_path,verification_status,source)
       VALUES ($1,$3,$4,'test-root','2026/Temmuz 2026/34DB020','verified','system'),
              ($2,$3,$5,'test-root','2026/Temmuz 2026/34DB021','verified','system')`,
      [firstLocationId, secondLocationId, organizationId, firstCaseId, secondCaseId],
    )

    const insertOperation = async (overrides: {
      id?: string
      caseId?: string
      locationId?: string
      destination?: string
      idempotencyHash?: string
    } = {}): Promise<void> => {
      await pool.query(
        `INSERT INTO case_file_operations
         (id,organization_id,case_id,operation_type,source_storage_root_key,source_relative_path,
          destination_storage_root_key,destination_relative_path,expected_location_id,expected_location_version,
          strategy,idempotency_key_hash,request_hash,created_by_user_id)
         VALUES ($1,$2,$3,'rename_case_workspace','test-root','2026/Temmuz 2026/34DB020',
                 'test-root',$4,$5,1,'atomic_rename',$6,$7,$8)`,
        [
          overrides.id ?? uuidv7(),
          organizationId,
          overrides.caseId ?? firstCaseId,
          overrides.destination ?? '2026/Temmuz 2026/34DB020-YENI',
          overrides.locationId ?? firstLocationId,
          overrides.idempotencyHash ?? 'a'.repeat(64),
          'b'.repeat(64),
          userId,
        ],
      )
    }

    await insertOperation()
    await expect(insertOperation({ idempotencyHash: 'c'.repeat(64), destination: '2026/Temmuz 2026/BASKA' }))
      .rejects.toMatchObject({ code: '23505', constraint: 'case_file_operations_one_active_case' })
    await expect(insertOperation({
      caseId: secondCaseId,
      locationId: secondLocationId,
      idempotencyHash: 'd'.repeat(64),
    })).rejects.toMatchObject({ code: '23505', constraint: 'case_file_operations_destination_reservation' })
    await expect(insertOperation({
      caseId: secondCaseId,
      locationId: secondLocationId,
      destination: '../disari',
      idempotencyHash: 'e'.repeat(64),
    })).rejects.toMatchObject({ code: '23514', constraint: 'case_file_operations_destination_path_safe' })

    await expect(pool.query(
      "UPDATE case_locations SET relative_path='2026/temmuz 2026/34db020' WHERE id=$1",
      [secondLocationId],
    )).rejects.toMatchObject({ code: '23505', constraint: 'case_locations_path_ci_unique' })

    await expect(pool.query(
      `INSERT INTO jobs (id,organization_id,type,target_type,target_id,target_version,payload)
       VALUES ($1,$2,'rename_case_workspace','file_operation',$3,1,$4::jsonb)`,
      [uuidv7(), organizationId, uuidv7(), JSON.stringify({
        kind: 'file_operation',
        source: { storageRootKey: 'test-root', relativePath: '../disari' },
        destination: { storageRootKey: 'test-root', relativePath: '2026/hedef' },
      })],
    )).rejects.toMatchObject({ code: '23514', constraint: 'jobs_payload_no_absolute_path' })
  })

  it('0011 göreli yol, tek vaka rezervasyonu ve tek aktif iş kısıtlarını uygular', async () => {
    const organizationId = uuidv7()
    const userId = uuidv7()
    const caseId = uuidv7()
    const rootId = uuidv7()
    await pool.query('INSERT INTO organizations (id, code, name) VALUES ($1,$2,$3)', [organizationId, 'p19-db', 'P19 DB'])
    await pool.query("INSERT INTO users (id,organization_id,email,password_hash,display_name) VALUES ($1,$2,'p19@test.local','x','P19')", [userId, organizationId])
    await pool.query(
      `INSERT INTO cases (id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,plate,plate_normalized,notification_date)
       VALUES ($1,$2,2026,19,'2026/19','traffic','new_notification','34 DB 019','34DB019','2026-07-14')`,
      [caseId, organizationId],
    )
    await pool.query("INSERT INTO storage_roots (id,organization_id,root_key,label) VALUES ($1,$2,'test-root','Test')", [rootId, organizationId])
    const planId = uuidv7()
    await pool.query(
      `INSERT INTO case_workspace_provisionings
       (id,organization_id,case_id,storage_root_key,relative_path,created_by_user_id)
       VALUES ($1,$2,$3,'test-root','2026/Temmuz 2026/34DB019',$4)`,
      [planId, organizationId, caseId, userId],
    )
    await expect(pool.query(
      `INSERT INTO case_workspace_provisionings
       (id,organization_id,case_id,storage_root_key,relative_path)
       VALUES ($1,$2,$3,'test-root','../kaçış')`,
      [uuidv7(), organizationId, caseId],
    )).rejects.toMatchObject({ code: '23514', constraint: 'case_workspace_provisionings_relative_path_safe' })

    const payload = JSON.stringify({ storageRootKey: 'test-root', relativePath: '2026/Temmuz 2026/34DB019', kind: 'workspace', requiredSubdirectories: ['EVRAK','HASAR','OLAY YERİ','ONARIM','DEĞER KAYBI'] })
    await pool.query(
      `INSERT INTO jobs (id,organization_id,type,target_type,target_id,payload)
       VALUES ($1,$2,'provision_case_workspace','workspace_provisioning',$3,$4::jsonb)`,
      [uuidv7(), organizationId, planId, payload],
    )
    await expect(pool.query(
      `INSERT INTO jobs (id,organization_id,type,target_type,target_id,payload)
       VALUES ($1,$2,'provision_case_workspace','workspace_provisioning',$3,$4::jsonb)`,
      [uuidv7(), organizationId, planId, payload],
    )).rejects.toMatchObject({ code: '23505', constraint: 'jobs_one_active_workspace_job' })
  })

  it('0010 mevcut kayıtları korur, aktif varsayılanları ve tarih kısıtını uygular', async () => {
    const organizationId = uuidv7()
    const caseId = uuidv7()
    const insurerId = uuidv7()
    const serviceId = uuidv7()
    await pool.query('INSERT INTO organizations (id, code, name) VALUES ($1,$2,$3)', [organizationId, 'p18-db', 'P18 DB'])
    await pool.query('INSERT INTO insurers (id, organization_id, name) VALUES ($1,$2,$3)', [insurerId, organizationId, 'Aktif Sigorta'])
    await pool.query("INSERT INTO service_centers (id, organization_id, name, center_type, service_type) VALUES ($1,$2,$3,'ozel','private')", [serviceId, organizationId, 'Aktif Servis'])
    await pool.query(
      `INSERT INTO cases (id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,plate,plate_normalized)
       VALUES ($1,$2,2026,18,'2026/18','traffic','new_notification','34 PK 018','34PK018')`,
      [caseId, organizationId],
    )
    const defaults = await pool.query('SELECT is_active FROM insurers WHERE id=$1 UNION ALL SELECT is_active FROM service_centers WHERE id=$2', [insurerId, serviceId])
    expect(defaults.rows).toEqual([{ is_active: true }, { is_active: true }])
    await expect(pool.query("UPDATE cases SET loss_date='2026-07-14', notification_date='2026-07-13' WHERE id=$1", [caseId])).rejects.toMatchObject({ code: '23514' })
    await pool.query("UPDATE cases SET loss_date='2026-07-13', notification_date='2026-07-14' WHERE id=$1", [caseId])
  })

  it('0009 kural sürümü ve rücu kısıtlarını veritabanında zorlar', async () => {
    const organizationId = uuidv7()
    const caseId = uuidv7()
    await pool.query('INSERT INTO organizations (id, code, name) VALUES ($1,$2,$3)', [organizationId, 'p15-db', 'P15 DB'])
    await pool.query(
      `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,plate,plate_normalized)
       VALUES ($1,$2,2026,1,'2026/1','traffic','new_notification','34 DB 015','34DB015')`,
      [caseId, organizationId],
    )
    await expect(pool.query("UPDATE cases SET recourse_status='invalid' WHERE id=$1", [caseId])).rejects.toMatchObject({ code: '23514' })
    await expect(pool.query(
      `INSERT INTO document_rule_versions
       (id,rule_set_id,version,effective_from,effective_to,conditions,requirements,source_reference,status)
       VALUES ($1,(SELECT id FROM document_rule_sets WHERE case_type='traffic'),'invalid-range','2026-07-15','2026-07-14','{}','{}','test','active')`,
      [uuidv7()],
    )).rejects.toMatchObject({ code: '23514' })
  })

  it('uygulanmis migrationdan ONCE gelen kosulmamis migration reddedilir (surum uyusmazligi)', async () => {
    // DB'de 0001 uygulanmis durumda; diskte yalnizca daha once siralanan ve
    // kosulmamis 0000 var. checkOrder korumasi calismayi reddetmelidir.
    const mismatchDir = mkdtempSync(join(tmpdir(), 'hasarbotu-mig-mismatch-'))
    try {
      writeFileSync(
        join(mismatchDir, '0000_precedes.js'),
        [
          'export const shorthands = undefined',
          'export function up() {}',
          'export function down() {}',
          '',
        ].join('\n'),
      )
      await expect(
        runMigrations({ databaseUrl: config.url, dir: mismatchDir, quiet: true }),
      ).rejects.toThrow(/preceding|order|not run/i)
    } finally {
      rmSync(mismatchDir, { recursive: true, force: true })
    }
  })

  it('hatali migration transaction ile geri alinir; yarim iz kalmaz', async () => {
    const badDir = mkdtempSync(join(tmpdir(), 'hasarbotu-mig-bad-'))
    try {
      writeFileSync(
        join(badDir, '0001_organizations.js'),
        [
          'export const shorthands = undefined',
          'export function up(pgm) {',
          "  pgm.createTable('rollback_probe', { id: { type: 'integer' } })",
          "  pgm.sql('SELECT * FROM tablo_yok_hata_uret')",
          '}',
          'export function down() {}',
          '',
        ].join('\n'),
      )
      // Not: dosya adi kasten uygulanmis 0001 ile ayni; node-pg-migrate bunu
      // uygulanmis sayar. Temiz dogrulama icin once semayi sifirliyoruz.
      await resetDatabase()
      await expect(
        runMigrations({ databaseUrl: config.url, dir: badDir, quiet: true }),
      ).rejects.toThrow()

      const probe = await pool.query(
        "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'rollback_probe'",
      )
      expect((probe.rows[0] as { n: number }).n).toBe(0)
      const recorded = await pool.query(
        "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'pgmigrations'",
      )
      // pgmigrations tablosu olusmus olabilir; icinde kayit OLMAMALI.
      if ((recorded.rows[0] as { n: number }).n === 1) {
        const rows = await pool.query('SELECT count(*)::int AS n FROM pgmigrations')
        expect((rows.rows[0] as { n: number }).n).toBe(0)
      }
    } finally {
      rmSync(badDir, { recursive: true, force: true })
    }
  })

  it('organizations kisitlari calisir: uuidv7 PK, unique code, surum ve bicim kontrolleri', async () => {
    await resetDatabase()
    await runMigrations({ databaseUrl: config.url, quiet: true })

    const id = uuidv7()
    await pool.query('INSERT INTO organizations (id, code, name) VALUES ($1, $2, $3)', [
      id,
      'baran-global',
      'Baran Global Sigorta Ekspertiz',
    ])
    const row = await pool.query('SELECT id, code, version FROM organizations WHERE id = $1', [id])
    expect(row.rows[0]).toMatchObject({ id, code: 'baran-global', version: 1 })

    await expect(
      pool.query('INSERT INTO organizations (id, code, name) VALUES ($1, $2, $3)', [
        uuidv7(),
        'baran-global',
        'Mukerrer Kod',
      ]),
    ).rejects.toMatchObject({ code: '23505' })

    await expect(
      pool.query('INSERT INTO organizations (id, code, name, version) VALUES ($1, $2, $3, 0)', [
        uuidv7(),
        'sifir-surum',
        'Gecersiz Surum',
      ]),
    ).rejects.toMatchObject({ code: '23514' })

    await expect(
      pool.query('INSERT INTO organizations (id, code, name) VALUES ($1, $2, $3)', [
        uuidv7(),
        'BUYUK-HARF',
        'Gecersiz Kod Bicimi',
      ]),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('saglik kontrolu gercek havuzda ok doner; ulasan olmayan portta degraded nedeni verir', async () => {
    const healthy = await checkDatabaseHealth(pool)
    expect(healthy).toEqual({ ok: true })

    const badPool = createDatabasePool({
      config: { ...config, port: 1, url: config.url },
      connectionTimeoutMillis: 500,
    })
    const unhealthy = await checkDatabaseHealth(badPool, 800)
    expect(unhealthy.ok).toBe(false)
    await closeDatabasePool(badPool).catch(() => undefined)
  })
})
