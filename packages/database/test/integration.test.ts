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
    ])

    const tables = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    )
    expect(tables.rows.map((r: { table_name: string }) => r.table_name)).toEqual([
      'agents',
      'audit_events',
      'case_location_history',
      'case_locations',
      'cases',
      'document_rule_evaluation_items',
      'document_rule_evaluations',
      'document_rule_sets',
      'document_rule_versions',
      'document_versions',
      'documents',
      'idempotency_keys',
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

  it('0009 geri alinabilir ve yeniden ileri uygulanabilir', async () => {
    const rolledBack = await runMigrations({ databaseUrl: config.url, direction: 'down', count: 1, quiet: true })
    expect(rolledBack.map((migration) => migration.name)).toEqual(['0009_document_requirement_rules'])
    const removed = await pool.query(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'document_rule_versions'",
    )
    expect((removed.rows[0] as { n: number }).n).toBe(0)
    const reapplied = await runMigrations({ databaseUrl: config.url, quiet: true })
    expect(reapplied.map((migration) => migration.name)).toEqual(['0009_document_requirement_rules'])
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
