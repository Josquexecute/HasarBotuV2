import { createHash } from 'node:crypto'
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
      '0015_casco_policy_analysis',
      '0016_policy_pdf_text_extraction',
      '0017_policy_ocr_pipeline',
      '0018_policy_ai_orchestration',
      '0019_policy_ai_candidate_review',
      '0020_real_policy_ai_provider',
      '0021_policy_ai_provider_recovery',
      '0022_traffic_value_loss_core',
      '0023_traffic_value_loss_reports',
      '0024_case_notes_tasks',
      '0025_closure_fees_reports',
    ])

    const tables = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    )
    expect(tables.rows.map((r: { table_name: string }) => r.table_name)).toEqual([
      'agents',
      'ai_candidate_conflicts',
      'ai_candidate_promotion_conflicts',
      'ai_candidate_promotion_items',
      'ai_candidate_promotions',
      'ai_candidate_reviews',
      'ai_candidate_source_links',
      'ai_extraction_candidates',
      'ai_extraction_runs',
      'ai_provider_call_receipts',
      'ai_provider_policies',
      'ai_source_bundle_items',
      'ai_source_bundles',
      'ai_usage_ledger',
      'audit_events',
      'case_file_operations',
      'case_follow_up_history',
      'case_lifecycle_history',
      'case_lifecycle_operations',
      'case_location_history',
      'case_locations',
      'case_notes',
      'case_task_events',
      'case_tasks',
      'case_workspace_provisionings',
      'cases',
      'document_ocr_blocks',
      'document_ocr_lines',
      'document_ocr_pages',
      'document_ocr_runs',
      'document_ocr_words',
      'document_rule_evaluation_items',
      'document_rule_evaluations',
      'document_rule_sets',
      'document_rule_versions',
      'document_text_extraction_pages',
      'document_text_extraction_segments',
      'document_text_extractions',
      'document_versions',
      'documents',
      'fee_record_versions',
      'fee_records',
      'idempotency_keys',
      'insurer_service_agreements',
      'insurers',
      'jobs',
      'office_counters',
      'organizations',
      'pgmigrations',
      'photos',
      'policy_analyses',
      'policy_analysis_ai_facts',
      'policy_analysis_versions',
      'policy_conflicts',
      'policy_coverages',
      'policy_deductibles',
      'policy_evidence_links',
      'policy_exclusions',
      'policy_part_rules',
      'policy_replacement_vehicle_rules',
      'policy_required_documents',
      'policy_scenario_evaluations',
      'policy_scenario_rules',
      'policy_service_rules',
      'policy_source_references',
      'roles',
      'service_centers',
      'sessions',
      'storage_roots',
      'traffic_value_loss_approval_events',
      'traffic_value_loss_assessments',
      'traffic_value_loss_comparables',
      'traffic_value_loss_evidence',
      'traffic_value_loss_reports',
      'traffic_value_loss_versions',
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

  it('0025 geri alınabilir ve yeniden ileri uygulanabilir', async () => {
    const rolledBack = await runMigrations({ databaseUrl: config.url, direction: 'down', count: 1, quiet: true })
    expect(rolledBack.map((migration) => migration.name)).toEqual(['0025_closure_fees_reports'])
    const removed = await pool.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name='fee_records'")
    expect(removed.rows).toEqual([{ n: 0 }])
    const reapplied = await runMigrations({ databaseUrl: config.url, quiet: true })
    expect(reapplied.map((migration) => migration.name)).toEqual(['0025_closure_fees_reports'])
  })

  it('0024 geri alınabilir ve 0025 ile yeniden ileri uygulanabilir', async () => {
    const rolledBack = await runMigrations({ databaseUrl: config.url, direction: 'down', count: 2, quiet: true })
    expect(rolledBack.map((migration) => migration.name)).toEqual(['0025_closure_fees_reports', '0024_case_notes_tasks'])
    const removed = await pool.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name='case_tasks'")
    expect(removed.rows).toEqual([{ n: 0 }])
    const reapplied = await runMigrations({ databaseUrl: config.url, quiet: true })
    expect(reapplied.map((migration) => migration.name)).toEqual(['0024_case_notes_tasks', '0025_closure_fees_reports'])
  })

  it('0023 geri alınabilir ve 0024 ile yeniden ileri uygulanabilir', async () => {
    const rolledBack = await runMigrations({ databaseUrl: config.url, direction: 'down', count: 3, quiet: true })
    expect(rolledBack.map((migration) => migration.name)).toEqual(['0025_closure_fees_reports', '0024_case_notes_tasks', '0023_traffic_value_loss_reports'])
    const removed = await pool.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name='traffic_value_loss_reports'")
    expect(removed.rows).toEqual([{ n: 0 }])
    const reapplied = await runMigrations({ databaseUrl: config.url, quiet: true })
    expect(reapplied.map((migration) => migration.name)).toEqual(['0023_traffic_value_loss_reports', '0024_case_notes_tasks', '0025_closure_fees_reports'])
  })

  it('0022 geri alınabilir ve 0023/0024 ile yeniden ileri uygulanabilir', async () => {
    const rolledBack = await runMigrations({ databaseUrl: config.url, direction: 'down', count: 4, quiet: true })
    expect(rolledBack.map((migration) => migration.name)).toEqual(['0025_closure_fees_reports', '0024_case_notes_tasks', '0023_traffic_value_loss_reports', '0022_traffic_value_loss_core'])
    const removed = await pool.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name='traffic_value_loss_assessments'")
    expect(removed.rows).toEqual([{ n: 0 }])
    const reapplied = await runMigrations({ databaseUrl: config.url, quiet: true })
    expect(reapplied.map((migration) => migration.name)).toEqual(['0022_traffic_value_loss_core', '0023_traffic_value_loss_reports', '0024_case_notes_tasks', '0025_closure_fees_reports'])
  })

  it('0021 geri alınabilir ve sonraki migrationlarla yeniden ileri uygulanabilir', async () => {
    const rolledBack = await runMigrations({ databaseUrl: config.url, direction: 'down', count: 5, quiet: true })
    expect(rolledBack.map((migration) => migration.name)).toEqual(['0025_closure_fees_reports', '0024_case_notes_tasks', '0023_traffic_value_loss_reports', '0022_traffic_value_loss_core', '0021_policy_ai_provider_recovery'])
    const removed = await pool.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name='ai_provider_call_receipts'")
    expect(removed.rows).toEqual([{ n: 0 }])
    const reapplied = await runMigrations({ databaseUrl: config.url, quiet: true })
    expect(reapplied.map((migration) => migration.name)).toEqual(['0021_policy_ai_provider_recovery', '0022_traffic_value_loss_core', '0023_traffic_value_loss_reports', '0024_case_notes_tasks', '0025_closure_fees_reports'])
  })

  it('0020 geri alınabilir ve sonraki migrationlarla yeniden ileri uygulanabilir', async () => {
    const rolledBack = await runMigrations({ databaseUrl: config.url, direction: 'down', count: 6, quiet: true })
    expect(rolledBack.map((migration) => migration.name)).toEqual(['0025_closure_fees_reports', '0024_case_notes_tasks', '0023_traffic_value_loss_reports', '0022_traffic_value_loss_core', '0021_policy_ai_provider_recovery', '0020_real_policy_ai_provider'])
    const removed = await pool.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='ai_extraction_runs' AND column_name='external_provider'")
    expect(removed.rows).toEqual([{ n: 0 }])
    const reapplied = await runMigrations({ databaseUrl: config.url, quiet: true })
    expect(reapplied.map((migration) => migration.name)).toEqual(['0020_real_policy_ai_provider', '0021_policy_ai_provider_recovery', '0022_traffic_value_loss_core', '0023_traffic_value_loss_reports', '0024_case_notes_tasks', '0025_closure_fees_reports'])
  })

  it('0019 geri alınabilir ve sonraki migrationlarla yeniden uygulanabilir', async () => {
    const rolledBack = await runMigrations({ databaseUrl: config.url, direction: 'down', count: 7, quiet: true })
    expect(rolledBack.map((migration) => migration.name)).toEqual(['0025_closure_fees_reports', '0024_case_notes_tasks', '0023_traffic_value_loss_reports', '0022_traffic_value_loss_core', '0021_policy_ai_provider_recovery', '0020_real_policy_ai_provider', '0019_policy_ai_candidate_review'])
    const removed = await pool.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'ai_candidate_reviews'")
    expect(removed.rows).toEqual([{ n: 0 }])
    const reapplied = await runMigrations({ databaseUrl: config.url, quiet: true })
    expect(reapplied.map((migration) => migration.name)).toEqual(['0019_policy_ai_candidate_review', '0020_real_policy_ai_provider', '0021_policy_ai_provider_recovery', '0022_traffic_value_loss_core', '0023_traffic_value_loss_reports', '0024_case_notes_tasks', '0025_closure_fees_reports'])
  })

  it('0018 geri alınabilir ve sonraki migrationlarla yeniden uygulanabilir', async () => {
    const rolledBack = await runMigrations({ databaseUrl: config.url, direction: 'down', count: 8, quiet: true })
    expect(rolledBack.map((migration) => migration.name)).toEqual(['0025_closure_fees_reports', '0024_case_notes_tasks', '0023_traffic_value_loss_reports', '0022_traffic_value_loss_core', '0021_policy_ai_provider_recovery', '0020_real_policy_ai_provider', '0019_policy_ai_candidate_review', '0018_policy_ai_orchestration'])
    const removed = await pool.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'ai_extraction_runs'")
    expect(removed.rows).toEqual([{ n: 0 }])
    const reapplied = await runMigrations({ databaseUrl: config.url, quiet: true })
    expect(reapplied.map((migration) => migration.name)).toEqual(['0018_policy_ai_orchestration', '0019_policy_ai_candidate_review', '0020_real_policy_ai_provider', '0021_policy_ai_provider_recovery', '0022_traffic_value_loss_core', '0023_traffic_value_loss_reports', '0024_case_notes_tasks', '0025_closure_fees_reports'])
  })

  it('0017 geri alınabilir ve sonraki migrationlarla yeniden uygulanabilir', async () => {
    const rolledBack = await runMigrations({ databaseUrl: config.url, direction: 'down', count: 9, quiet: true })
    expect(rolledBack.map((migration) => migration.name)).toEqual(['0025_closure_fees_reports', '0024_case_notes_tasks', '0023_traffic_value_loss_reports', '0022_traffic_value_loss_core', '0021_policy_ai_provider_recovery', '0020_real_policy_ai_provider', '0019_policy_ai_candidate_review', '0018_policy_ai_orchestration', '0017_policy_ocr_pipeline'])
    const removed = await pool.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'document_ocr_runs'")
    expect(removed.rows).toEqual([{ n: 0 }])
    const reapplied = await runMigrations({ databaseUrl: config.url, quiet: true })
    expect(reapplied.map((migration) => migration.name)).toEqual(['0017_policy_ocr_pipeline', '0018_policy_ai_orchestration', '0019_policy_ai_candidate_review', '0020_real_policy_ai_provider', '0021_policy_ai_provider_recovery', '0022_traffic_value_loss_core', '0023_traffic_value_loss_reports', '0024_case_notes_tasks', '0025_closure_fees_reports'])
  })

  it('0015 geri alınabilir ve sonraki migrationlarla yeniden ileri uygulanabilir', async () => {
    const rolledBack = await runMigrations({ databaseUrl: config.url, direction: 'down', count: 11, quiet: true })
    expect(rolledBack.map((migration) => migration.name)).toEqual(['0025_closure_fees_reports', '0024_case_notes_tasks', '0023_traffic_value_loss_reports', '0022_traffic_value_loss_core', '0021_policy_ai_provider_recovery', '0020_real_policy_ai_provider', '0019_policy_ai_candidate_review', '0018_policy_ai_orchestration', '0017_policy_ocr_pipeline', '0016_policy_pdf_text_extraction', '0015_casco_policy_analysis'])
    const removed = await pool.query(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'policy_analyses'",
    )
    expect(removed.rows).toEqual([{ n: 0 }])
    const reapplied = await runMigrations({ databaseUrl: config.url, quiet: true })
    expect(reapplied.map((migration) => migration.name)).toEqual(['0015_casco_policy_analysis', '0016_policy_pdf_text_extraction', '0017_policy_ocr_pipeline', '0018_policy_ai_orchestration', '0019_policy_ai_candidate_review', '0020_real_policy_ai_provider', '0021_policy_ai_provider_recovery', '0022_traffic_value_loss_core', '0023_traffic_value_loss_reports', '0024_case_notes_tasks', '0025_closure_fees_reports'])
  })

  it('0014 geri alinabilir, eski servis profilini donusturur ve yeniden ileri uygulanabilir', async () => {
    const rolledBack = await runMigrations({ databaseUrl: config.url, direction: 'down', count: 12, quiet: true })
    expect(rolledBack.map((migration) => migration.name)).toEqual(['0025_closure_fees_reports', '0024_case_notes_tasks', '0023_traffic_value_loss_reports', '0022_traffic_value_loss_core', '0021_policy_ai_provider_recovery', '0020_real_policy_ai_provider', '0019_policy_ai_candidate_review', '0018_policy_ai_orchestration', '0017_policy_ocr_pipeline', '0016_policy_pdf_text_extraction', '0015_casco_policy_analysis', '0014_service_agreements'])
    const removed = await pool.query(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'insurer_service_agreements'",
    )
    expect((removed.rows[0] as { n: number }).n).toBe(0)
    const organizationId = uuidv7()
    const serviceId = uuidv7()
    await pool.query('INSERT INTO organizations (id,code,name) VALUES ($1,$2,$3)', [organizationId, 'p22-backfill', 'P22 Backfill'])
    await pool.query("INSERT INTO service_centers (id,organization_id,name,center_type) VALUES ($1,$2,'Eski Servis','ozel')", [serviceId, organizationId])
    const reapplied = await runMigrations({ databaseUrl: config.url, quiet: true })
    expect(reapplied.map((migration) => migration.name)).toEqual(['0014_service_agreements', '0015_casco_policy_analysis', '0016_policy_pdf_text_extraction', '0017_policy_ocr_pipeline', '0018_policy_ai_orchestration', '0019_policy_ai_candidate_review', '0020_real_policy_ai_provider', '0021_policy_ai_provider_recovery', '0022_traffic_value_loss_core', '0023_traffic_value_loss_reports', '0024_case_notes_tasks', '0025_closure_fees_reports'])
    const profile = await pool.query('SELECT service_type FROM service_centers WHERE id=$1', [serviceId])
    expect(profile.rows).toEqual([{ service_type: 'private' }])
    const silentAgreements = await pool.query('SELECT count(*)::int AS n FROM insurer_service_agreements WHERE service_center_id=$1', [serviceId])
    expect(silentAgreements.rows).toEqual([{ n: 0 }])
  })

  it('0025 tenant, minor-unit, kaynak FK ve append-only ücret sürümünü zorlar', async () => {
    const organizationId = uuidv7()
    const foreignOrganizationId = uuidv7()
    const userId = uuidv7()
    const foreignUserId = uuidv7()
    const caseId = uuidv7()
    const documentId = uuidv7()
    const documentVersionId = uuidv7()
    const feeId = uuidv7()
    const feeVersionId = uuidv7()
    await pool.query(
      `INSERT INTO organizations (id,code,name)
       VALUES ($1,'p39-db','P39 DB'),($2,'p39-db-foreign','P39 DB Foreign')`,
      [organizationId, foreignOrganizationId],
    )
    await pool.query(
      `INSERT INTO users (id,organization_id,email,password_hash,display_name)
       VALUES ($1,$3,'p39-db@test.local','x','P39 DB'),
              ($2,$4,'p39-db-foreign@test.local','x','P39 DB Foreign')`,
      [userId, foreignUserId, organizationId, foreignOrganizationId],
    )
    await pool.query(
      `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
        workflow_stage,plate,plate_normalized,closed_at)
       VALUES ($1,$2,2026,3901,'2026/3901','traffic','closed','closed','34 DB 391','34DB391',now())`,
      [caseId, organizationId],
    )
    await pool.query(
      `INSERT INTO storage_roots (id,organization_id,root_key,label)
       VALUES ($1,$2,'synthetic-root','Sentetik Root')`,
      [uuidv7(), organizationId],
    )
    await pool.query(
      `INSERT INTO documents
       (id,organization_id,case_id,document_type,current_version_number,status)
       VALUES ($1,$2,$3,'expert_report',1,'ready')`,
      [documentId, organizationId, caseId],
    )
    await pool.query(
      `INSERT INTO document_versions
       (id,organization_id,document_id,case_id,version_number,original_file_name,display_name,
        extension,mime_type,byte_size,content_hash,storage_root_key,relative_path,source_type,
        status,hash_verified,size_verified,verified_at,registered_by_user_id)
       VALUES ($1,$2,$3,$4,1,'sentetik-nihai.pdf','Sentetik Nihai','pdf','application/pdf',128,
               $5,'synthetic-root','sentetik/nihai.pdf','manual','ready',true,true,now(),$6)`,
      [documentVersionId, organizationId, documentId, caseId, 'a'.repeat(64), userId],
    )
    await pool.query('UPDATE documents SET current_version_id=$2 WHERE id=$1', [documentId, documentVersionId])
    await pool.query(
      `INSERT INTO fee_records (id,organization_id,case_id) VALUES ($1,$2,$3)`,
      [feeId, organizationId, caseId],
    )
    await pool.query(
      `INSERT INTO fee_record_versions
       (id,organization_id,case_id,fee_record_id,fee_version,status,candidate_amount_minor,
        source_document_version_id,source_page,rule_version,created_by_user_id)
       VALUES ($1,$2,$3,$4,1,'control_required',485000,$5,12,'closure-fee/1.0.0',$6)`,
      [feeVersionId, organizationId, caseId, feeId, documentVersionId, userId],
    )
    await pool.query('UPDATE fee_records SET current_version_id=$2 WHERE id=$1', [feeId, feeVersionId])

    await expect(pool.query(
      `INSERT INTO fee_records (id,organization_id,case_id) VALUES ($1,$2,$3)`,
      [uuidv7(), organizationId, caseId],
    )).rejects.toMatchObject({ code: '23505', constraint: 'fee_records_case_unique' })
    await expect(pool.query(
      `INSERT INTO fee_record_versions
       (id,organization_id,case_id,fee_record_id,fee_version,status,candidate_amount_minor,
        source_document_version_id,source_page,rule_version,created_by_user_id)
       VALUES ($1,$2,$3,$4,2,'control_required',0,$5,12,'closure-fee/1.0.0',$6)`,
      [uuidv7(), organizationId, caseId, feeId, documentVersionId, userId],
    )).rejects.toMatchObject({ code: '23514', constraint: 'fee_record_versions_amount_valid' })
    await expect(pool.query(
      'UPDATE fee_record_versions SET source_page=13 WHERE id=$1',
      [feeVersionId],
    )).rejects.toMatchObject({ code: '23001' })
    await expect(pool.query(
      'DELETE FROM fee_record_versions WHERE id=$1',
      [feeVersionId],
    )).rejects.toMatchObject({ code: '23001' })
    await expect(pool.query(
      `INSERT INTO fee_record_versions
       (id,organization_id,case_id,fee_record_id,fee_version,status,candidate_amount_minor,
        source_document_version_id,source_page,rule_version,created_by_user_id)
       VALUES ($1,$2,$3,$4,2,'control_required',485000,$5,12,'closure-fee/1.0.0',$6)`,
      [uuidv7(), organizationId, caseId, feeId, documentVersionId, foreignUserId],
    )).rejects.toMatchObject({ code: '23503', constraint: 'fee_record_versions_creator_fk' })
  })

  it('0024 tenant, append-only geçmiş ve görev geçiş constraintlerini zorlar', async () => {
    const organizationId = uuidv7()
    const foreignOrganizationId = uuidv7()
    const userId = uuidv7()
    const foreignUserId = uuidv7()
    const caseId = uuidv7()
    const noteId = uuidv7()
    const taskId = uuidv7()
    const followUpId = uuidv7()
    await pool.query(
      `INSERT INTO organizations (id,code,name)
       VALUES ($1,'p37-db-main','P37 DB'),($2,'p37-db-foreign','P37 DB Foreign')`,
      [organizationId, foreignOrganizationId],
    )
    await pool.query(
      `INSERT INTO users (id,organization_id,email,password_hash,display_name)
       VALUES ($1,$3,'p37-db@test.local','x','P37 DB'),
              ($2,$4,'p37-db-foreign@test.local','x','P37 DB Foreign')`,
      [userId, foreignUserId, organizationId, foreignOrganizationId],
    )
    await pool.query(
      `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,plate,plate_normalized,follow_up_date)
       VALUES ($1,$2,2026,3701,'2026/3701','traffic','new_notification','34 DB 371','34DB371','2026-07-18')`,
      [caseId, organizationId],
    )
    await pool.query(
      `INSERT INTO case_notes (id,organization_id,case_id,note_type,subject,body,created_by_user_id)
       VALUES ($1,$2,$3,'internal','Sentetik','Sentetik not.',$4)`,
      [noteId, organizationId, caseId, userId],
    )
    await pool.query(
      `INSERT INTO case_tasks
       (id,organization_id,case_id,title,priority,assigned_user_id,due_date,created_by_user_id)
       VALUES ($1,$2,$3,'Sentetik görev','normal',$4,'2026-07-16',$4)`,
      [taskId, organizationId, caseId, userId],
    )
    await pool.query(
      `INSERT INTO case_task_events
       (id,organization_id,case_id,task_id,event_type,task_version,actor_user_id)
       VALUES ($1,$2,$3,$4,'created',1,$5)`,
      [uuidv7(), organizationId, caseId, taskId, userId],
    )
    await pool.query(
      `INSERT INTO case_follow_up_history
       (id,organization_id,case_id,previous_follow_up_date,new_follow_up_date,source,case_version,actor_user_id)
       VALUES ($1,$2,$3,NULL,'2026-07-18','case_create',1,$4)`,
      [followUpId, organizationId, caseId, userId],
    )
    await expect(pool.query("UPDATE case_notes SET body='değiştir' WHERE id=$1", [noteId]))
      .rejects.toMatchObject({ code: '23001' })
    await expect(pool.query('DELETE FROM case_follow_up_history WHERE id=$1', [followUpId]))
      .rejects.toMatchObject({ code: '23001' })
    await expect(pool.query(
      "UPDATE case_tasks SET status='completed',resolution_note='Sonuç',resolved_by_user_id=$2,resolved_at=now(),version=3 WHERE id=$1",
      [taskId, userId],
    )).rejects.toMatchObject({ code: '23514' })
    await pool.query(
      "UPDATE case_tasks SET status='completed',resolution_note='Sonuç',resolved_by_user_id=$2,resolved_at=now(),version=2 WHERE id=$1",
      [taskId, userId],
    )
    await expect(pool.query(
      "UPDATE case_tasks SET status='cancelled',resolution_note='İptal',version=3 WHERE id=$1",
      [taskId],
    )).rejects.toMatchObject({ code: '23514' })
    await expect(pool.query(
      `INSERT INTO case_tasks
       (id,organization_id,case_id,title,priority,assigned_user_id,due_date,created_by_user_id)
       VALUES ($1,$2,$3,'Yabancı atama','normal',$4,'2026-07-16',$5)`,
      [uuidv7(), organizationId, caseId, foreignUserId, userId],
    )).rejects.toMatchObject({ code: '23503', constraint: 'case_tasks_assignee_fk' })
  })

  it('0023 yalnız onaylı kaynaktan tek, yolsuz ve append-only nihai rapor snapshotı kabul eder', async () => {
    const organizationId = uuidv7()
    const userId = uuidv7()
    const caseId = uuidv7()
    const assessmentId = uuidv7()
    const approvedVersionId = uuidv7()
    const draftVersionId = uuidv7()
    const supersededVersionId = uuidv7()
    await pool.query(
      "INSERT INTO organizations (id,code,name) VALUES ($1,'p34-db','P34 DB')",
      [organizationId],
    )
    await pool.query(
      "INSERT INTO users (id,organization_id,email,password_hash,display_name) VALUES ($1,$2,'p34@test.local','x','P34')",
      [userId, organizationId],
    )
    await pool.query(
      `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,plate,plate_normalized,loss_date,notification_date)
       VALUES ($1,$2,2026,34,'2026/34','traffic','reporting','34 DB 034','34DB034','2026-07-02','2026-07-03')`,
      [caseId, organizationId],
    )
    await pool.query(
      'INSERT INTO traffic_value_loss_assessments (id,organization_id,case_id,created_by_user_id) VALUES ($1,$2,$3,$4)',
      [assessmentId, organizationId, caseId, userId],
    )
    const insertVersion = (id: string, number: number, status: 'approved' | 'draft' | 'superseded') => pool.query(
      `INSERT INTO traffic_value_loss_versions
       (id,organization_id,case_id,assessment_id,assessment_version,status,rule_set_id,rule_version,effective_from,
        evaluated_on,input_snapshot,result_snapshot,result_code,human_approval_status,approved_by_user_id,approved_at,is_active,created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,'traffic-value-loss-market-difference','2026.07.01.1','2026-07-01',
        '2026-07-16','{}','{}','calculable',$7,$8,$9,$10,$11)`,
      [
        id, organizationId, caseId, assessmentId, number, status,
        status === 'approved' || status === 'superseded' ? 'approved' : 'pending',
        status === 'approved' || status === 'superseded' ? userId : null,
        status === 'approved' || status === 'superseded' ? new Date('2026-07-16T09:00:00Z') : null,
        status === 'approved',
        userId,
      ],
    )
    await insertVersion(approvedVersionId, 1, 'approved')
    await insertVersion(draftVersionId, 2, 'draft')
    await insertVersion(supersededVersionId, 3, 'superseded')
    await pool.query(
      'UPDATE traffic_value_loss_assessments SET current_version_id=$1,version=2 WHERE id=$2',
      [draftVersionId, assessmentId],
    )
    const content = {
      schemaVersion: 'traffic-value-loss-final-report/1.0.0',
      templateVersion: 'traffic-value-loss-final-report-tr/1.0.0',
      caseReference: { caseId, caseType: 'traffic' },
      assessment: { assessmentId, versionId: approvedVersionId, assessmentVersion: 1 },
      rule: { ruleVersion: '2026.07.01.1' },
    }
    const reportId = uuidv7()
    await pool.query(
      `INSERT INTO traffic_value_loss_reports
       (id,organization_id,case_id,assessment_id,assessment_version_id,assessment_version,
        schema_version,template_version,rule_version,content_snapshot,content_hash,pdf_hash,pdf_byte_size,generated_by_user_id)
       VALUES ($1,$2,$3,$4,$5,1,'traffic-value-loss-final-report/1.0.0','traffic-value-loss-final-report-tr/1.0.0',
        '2026.07.01.1',$6::jsonb,$7,$8,100,$9)`,
      [reportId, organizationId, caseId, assessmentId, approvedVersionId, JSON.stringify(content), 'a'.repeat(64), 'b'.repeat(64), userId],
    )
    await expect(pool.query(
      `INSERT INTO traffic_value_loss_reports
       (id,organization_id,case_id,assessment_id,assessment_version_id,assessment_version,
        schema_version,template_version,rule_version,content_snapshot,content_hash,pdf_hash,pdf_byte_size,generated_by_user_id)
       VALUES ($1,$2,$3,$4,$5,1,'traffic-value-loss-final-report/1.0.0','traffic-value-loss-final-report-tr/1.0.0',
        '2026.07.01.1',$6::jsonb,$7,$8,100,$9)`,
      [uuidv7(), organizationId, caseId, assessmentId, approvedVersionId, JSON.stringify(content), 'c'.repeat(64), 'd'.repeat(64), userId],
    )).rejects.toMatchObject({ code: '23505', constraint: 'traffic_value_loss_reports_version_unique' })
    await expect(pool.query(
      `INSERT INTO traffic_value_loss_reports
       (id,organization_id,case_id,assessment_id,assessment_version_id,assessment_version,
        schema_version,template_version,rule_version,content_snapshot,content_hash,pdf_hash,pdf_byte_size,generated_by_user_id)
       VALUES ($1,$2,$3,$4,$5,2,'traffic-value-loss-final-report/1.0.0','traffic-value-loss-final-report-tr/1.0.0',
        '2026.07.01.1',$6::jsonb,$7,$8,100,$9)`,
      [uuidv7(), organizationId, caseId, assessmentId, draftVersionId, JSON.stringify({
        ...content,
        assessment: { assessmentId, versionId: draftVersionId, assessmentVersion: 2 },
      }), 'e'.repeat(64), 'f'.repeat(64), userId],
    )).rejects.toMatchObject({ code: '23514' })
    await expect(pool.query(
      `INSERT INTO traffic_value_loss_reports
       (id,organization_id,case_id,assessment_id,assessment_version_id,assessment_version,
        schema_version,template_version,rule_version,content_snapshot,content_hash,pdf_hash,pdf_byte_size,generated_by_user_id)
       VALUES ($1,$2,$3,$4,$5,3,'traffic-value-loss-final-report/1.0.0','traffic-value-loss-final-report-tr/1.0.0',
        '2026.07.01.1',$6::jsonb,$7,$8,100,$9)`,
      [uuidv7(), organizationId, caseId, assessmentId, supersededVersionId, JSON.stringify({
        ...content,
        reportNote: 'P:\\musteri',
        assessment: { assessmentId, versionId: supersededVersionId, assessmentVersion: 3 },
      }), '1'.repeat(64), '2'.repeat(64), userId],
    )).rejects.toMatchObject({ code: '23514', constraint: 'traffic_value_loss_reports_no_absolute_path' })
    await expect(pool.query(
      "UPDATE traffic_value_loss_reports SET content_snapshot=jsonb_set(content_snapshot,'{reportNote}',to_jsonb('P:\\\\musteri'::text)) WHERE id=$1",
      [reportId],
    )).rejects.toMatchObject({ code: '23001' })
    await expect(pool.query('DELETE FROM traffic_value_loss_reports WHERE id=$1', [reportId]))
      .rejects.toMatchObject({ code: '23001' })
  })

  it('0015 Kasko kaynagi, tenant, evidence, approval ve immutable surum kisitlarini zorlar', async () => {
    const organizationId = uuidv7(); const foreignOrganizationId = uuidv7(); const userId = uuidv7()
    const cascoCaseId = uuidv7(); const trafficCaseId = uuidv7(); const sourceDocumentId = uuidv7()
    const sourceVersionId = uuidv7(); const pendingDocumentId = uuidv7(); const pendingVersionId = uuidv7()
    await pool.query('INSERT INTO organizations (id,code,name) VALUES ($1,$2,$3),($4,$5,$6)',
      [organizationId, 'p23-a', 'P23 A', foreignOrganizationId, 'p23-b', 'P23 B'])
    await pool.query("INSERT INTO users (id,organization_id,email,password_hash,display_name) VALUES ($1,$2,'p23@test.local','x','P23')", [userId, organizationId])
    await pool.query(
      `INSERT INTO cases (id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,plate,plate_normalized,notification_date)
       VALUES ($1,$3,2026,2301,'2026/2301','casco','new_notification','34 P 2301','34P2301','2026-07-14'),
              ($2,$3,2026,2302,'2026/2302','traffic','new_notification','34 P 2302','34P2302','2026-07-14')`,
      [cascoCaseId, trafficCaseId, organizationId],
    )
    await pool.query(
      `INSERT INTO documents (id,organization_id,case_id,document_type,status)
       VALUES ($1,$3,$4,'casco_policy','ready'),($2,$3,$4,'endorsement','pending')`,
      [sourceDocumentId, pendingDocumentId, organizationId, cascoCaseId],
    )
    await pool.query(
      `INSERT INTO document_versions
       (id,organization_id,document_id,case_id,version_number,original_file_name,display_name,mime_type,byte_size,content_hash,
        storage_root_key,relative_path,source_type,status,hash_verified,size_verified,verified_at)
       VALUES ($1,$3,$4,$5,1,'sentetik-police.pdf','Sentetik Poliçe','application/pdf',10,$6,'test-root','sentetik/police.pdf','manual','ready',true,true,now()),
              ($2,$3,$7,$5,1,'sentetik-zeyil.pdf','Sentetik Zeyil','application/pdf',10,$8,'test-root','sentetik/zeyil.pdf','manual','pending',false,false,NULL)`,
      [sourceVersionId, pendingVersionId, organizationId, sourceDocumentId, cascoCaseId, 'a'.repeat(64), pendingDocumentId, 'b'.repeat(64)],
    )
    await pool.query('UPDATE documents SET current_version_id=$1,current_version_number=1 WHERE id=$2', [sourceVersionId, sourceDocumentId])
    await pool.query('UPDATE documents SET current_version_id=$1,current_version_number=1 WHERE id=$2', [pendingVersionId, pendingDocumentId])

    const analysisId = uuidv7(); const versionId = uuidv7()
    await pool.query(
      `INSERT INTO policy_analyses
       (id,organization_id,case_id,source_document_id,source_document_version_id,created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [analysisId, organizationId, cascoCaseId, sourceDocumentId, sourceVersionId, userId],
    )
    await expect(pool.query(
      `INSERT INTO policy_analyses (id,organization_id,case_id,source_document_id,source_document_version_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [uuidv7(), organizationId, trafficCaseId, sourceDocumentId, sourceVersionId],
    )).rejects.toMatchObject({ code: '23514' })
    await pool.query(
      `INSERT INTO policy_analysis_versions
       (id,organization_id,case_id,analysis_id,source_document_id,source_document_version_id,analysis_version,analysis_status,source_completeness,created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,1,'draft','complete',$7)`,
      [versionId, organizationId, cascoCaseId, analysisId, sourceDocumentId, sourceVersionId, userId],
    )
    await pool.query('UPDATE policy_analyses SET current_version_id=$1 WHERE id=$2', [versionId, analysisId])

    const sourceReferenceId = uuidv7()
    await pool.query(
      `INSERT INTO policy_source_references
       (id,organization_id,case_id,analysis_version_id,document_id,document_version_id,page_number,section_heading,
        clause_identifier,raw_excerpt,excerpt_hash,source_type,confidence)
       VALUES ($1,$2,$3,$4,$5,$6,2,'Muafiyetler','M-1','Sentetik koşullu muafiyet maddesi',$7,'special_conditions',0.98)`,
      [sourceReferenceId, organizationId, cascoCaseId, versionId, sourceDocumentId, sourceVersionId, 'c'.repeat(64)],
    )
    await expect(pool.query(
      `INSERT INTO policy_source_references
       (id,organization_id,case_id,analysis_version_id,document_id,document_version_id,page_number,section_heading,
        clause_identifier,raw_excerpt,excerpt_hash,source_type,confidence)
       VALUES ($1,$2,$3,$4,$5,$6,1,'Zeyil','Z-1','Doğrulanmamış sentetik kaynak',$7,'endorsement',0.5)`,
      [uuidv7(), organizationId, cascoCaseId, versionId, pendingDocumentId, pendingVersionId, 'd'.repeat(64)],
    )).rejects.toMatchObject({ code: '23514' })
    await expect(pool.query('UPDATE policy_source_references SET page_number=3 WHERE id=$1', [sourceReferenceId]))
      .rejects.toMatchObject({ code: '23001' })

    await pool.query(
      `UPDATE policy_analysis_versions SET analysis_status='approved',human_approval_status='approved',approved_by_user_id=$1,approved_at=now(),is_active=true
       WHERE id=$2`, [userId, versionId],
    )
    await expect(pool.query("UPDATE policy_analysis_versions SET product_name='Değiştirilemez' WHERE id=$1", [versionId]))
      .rejects.toMatchObject({ code: '23001' })
    await expect(pool.query(
      `INSERT INTO policy_coverages
       (id,organization_id,case_id,analysis_version_id,code,canonical_type,original_heading,original_wording,inclusion,confidence)
       VALUES ($1,$2,$3,$4,'COLLISION','collision','Çarpışma','Sentetik madde','included',1)`,
      [uuidv7(), organizationId, cascoCaseId, versionId],
    )).rejects.toMatchObject({ code: '23001' })
  })

  it('0016 tenant, exact parser, append-only sayfa/segment ve terminal sürüm kısıtlarını zorlar', async () => {
    const organizationId = uuidv7(); const otherOrganizationId = uuidv7(); const caseId = uuidv7()
    const documentId = uuidv7(); const documentVersionId = uuidv7(); const extractionId = uuidv7(); const pageId = uuidv7()
    await pool.query('INSERT INTO organizations (id,code,name) VALUES ($1,$2,$3),($4,$5,$6)', [organizationId, 'p24-db', 'P24 DB', otherOrganizationId, 'p24-other', 'P24 Other'])
    await pool.query(`INSERT INTO cases (id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,plate,plate_normalized,notification_date)
      VALUES ($1,$2,2026,2401,'2026/2401','casco','new_notification','34 P 2401','34P2401','2026-07-14')`, [caseId, organizationId])
    await pool.query("INSERT INTO documents (id,organization_id,case_id,document_type,status) VALUES ($1,$2,$3,'casco_policy','ready')", [documentId, organizationId, caseId])
    await pool.query(`INSERT INTO document_versions
      (id,organization_id,document_id,case_id,version_number,original_file_name,display_name,mime_type,byte_size,content_hash,storage_root_key,relative_path,source_type,status,hash_verified,size_verified,verified_at)
      VALUES ($1,$2,$3,$4,1,'sentetik.pdf','Sentetik PDF','application/pdf',100,$5,'test-root','EVRAK/sentetik.pdf','manual','ready',true,true,now())`, [documentVersionId, organizationId, documentId, caseId, 'a'.repeat(64)])
    await pool.query('UPDATE documents SET current_version_id=$1,current_version_number=1 WHERE id=$2', [documentVersionId, documentId])
    const insertExtraction = (id: string, org = organizationId, parserVersion = '6.1.200', extractionVersion = 1) => pool.query(`INSERT INTO document_text_extractions
      (id,organization_id,case_id,document_id,document_version_id,extraction_version,parser_name,parser_version,normalization_version,offset_unit,source_hash,source_size)
      VALUES ($1,$2,$3,$4,$5,$6,'pdfjs-dist',$7,'pdf-text-normalization/1.0.0','unicode_code_point',$8,100)`, [id, org, caseId, documentId, documentVersionId, extractionVersion, parserVersion, 'a'.repeat(64)])
    await insertExtraction(extractionId)
    await expect(insertExtraction(uuidv7())).rejects.toMatchObject({ code: '23505', constraint: 'document_text_extractions_identity_unique' })
    await expect(insertExtraction(uuidv7(), organizationId, 'latest')).rejects.toMatchObject({ code: '23514', constraint: 'document_text_extractions_engine_valid' })
    await expect(insertExtraction(uuidv7(), otherOrganizationId, '6.1.200', 2)).rejects.toMatchObject({ code: '23503' })

    const normalized = 'POLİÇE 🚗'
    await pool.query(`INSERT INTO document_text_extraction_pages
      (id,organization_id,case_id,extraction_id,page_number,status,raw_text,normalized_text,raw_text_hash,normalized_text_hash,raw_character_count,normalized_character_count,segment_count)
      VALUES ($1,$2,$3,$4,1,'text',$5,$5,$6,$6,char_length($5),char_length($5),1)`, [pageId, organizationId, caseId, extractionId, normalized, 'b'.repeat(64)])
    await pool.query(`INSERT INTO document_text_extraction_segments
      (id,organization_id,case_id,extraction_id,page_id,page_number,segment_index,segment_type,start_offset,end_offset,segment_text,text_hash)
      VALUES ($1,$2,$3,$4,$5,1,0,'title',0,char_length($6),$6,$7)`, [uuidv7(), organizationId, caseId, extractionId, pageId, normalized, 'c'.repeat(64)])
    await expect(pool.query("UPDATE document_text_extraction_pages SET normalized_text='değişti' WHERE id=$1", [pageId])).rejects.toMatchObject({ code: '23001' })
    await pool.query(`UPDATE document_text_extractions SET status='ready',page_count=1,text_page_count=1,segment_count=1,raw_character_count=char_length($2),normalized_character_count=char_length($2),output_hash=$3,completed_at=now(),version=2 WHERE id=$1`, [extractionId, normalized, 'd'.repeat(64)])
    await expect(pool.query("UPDATE document_text_extractions SET status='stale' WHERE id=$1", [extractionId])).rejects.toMatchObject({ code: '23001' })
  })

  it('0017 tenant, sabit OCR motoru, append-only geometri ve terminal sürüm kısıtlarını zorlar', async () => {
    const organizationId=uuidv7(),otherOrganizationId=uuidv7(),caseId=uuidv7(),documentId=uuidv7(),documentVersionId=uuidv7(),extractionId=uuidv7(),textPageId=uuidv7(),runId=uuidv7(),ocrPageId=uuidv7(),blockId=uuidv7(),lineId=uuidv7(),wordId=uuidv7()
    await pool.query('INSERT INTO organizations(id,code,name)VALUES($1,$2,$3),($4,$5,$6)',[organizationId,'p25-db','P25 DB',otherOrganizationId,'p25-other','P25 Other'])
    await pool.query(`INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,plate,plate_normalized,notification_date)VALUES($1,$2,2026,2501,'2026/2501','casco','new_notification','34 P 2501','34P2501','2026-07-15')`,[caseId,organizationId])
    await pool.query("INSERT INTO documents(id,organization_id,case_id,document_type,status)VALUES($1,$2,$3,'casco_policy','ready')",[documentId,organizationId,caseId])
    await pool.query(`INSERT INTO document_versions(id,organization_id,document_id,case_id,version_number,original_file_name,display_name,mime_type,byte_size,content_hash,storage_root_key,relative_path,source_type,status,hash_verified,size_verified,verified_at)VALUES($1,$2,$3,$4,1,'sentetik.pdf','Sentetik OCR PDF','application/pdf',100,$5,'test-root','EVRAK/sentetik.pdf','manual','ready',true,true,now())`,[documentVersionId,organizationId,documentId,caseId,'a'.repeat(64)])
    await pool.query('UPDATE documents SET current_version_id=$1,current_version_number=1 WHERE id=$2',[documentVersionId,documentId])
    await pool.query(`INSERT INTO document_text_extractions(id,organization_id,case_id,document_id,document_version_id,extraction_version,status,parser_name,parser_version,normalization_version,offset_unit,source_hash,source_size,output_hash,completed_at)VALUES($1,$2,$3,$4,$5,1,'ocr_required','pdfjs-dist','6.1.200','pdf-text-normalization/1.0.0','unicode_code_point',$6,100,$7,now())`,[extractionId,organizationId,caseId,documentId,documentVersionId,'a'.repeat(64),'b'.repeat(64)])
    await pool.query(`INSERT INTO document_text_extraction_pages(id,organization_id,case_id,extraction_id,page_number,status,raw_text,normalized_text,raw_text_hash,normalized_text_hash,raw_character_count,normalized_character_count,segment_count)VALUES($1,$2,$3,$4,1,'image_only','','',$5,$5,0,0,0)`,[textPageId,organizationId,caseId,extractionId,'e'.repeat(64)])
    const insertRun=(id:string,org=organizationId,engineVersion='7.0.0',version=1)=>pool.query(`INSERT INTO document_ocr_runs(id,organization_id,case_id,document_id,document_version_id,text_extraction_id,ocr_version,engine_name,engine_version,language_data_version,language_data_hash,language_mode,render_profile,render_profile_version,preprocessing_version,preprocessing_config,quality_version,normalization_version,locator_version,offset_unit,source_hash,source_size,eligible_page_count,selected_page_numbers)VALUES($1,$2,$3,$4,$5,$6,$7,'tesseract.js',$8,'tessdata-4.0.0-full/1.0.0',$9,'tur+eng','standard','policy-ocr-render-standard/1.0.0','policy-ocr-preprocessing/1.0.0','{}','policy-ocr-quality/1.0.0','policy-ocr-normalization/1.0.0','policy-ocr-locator/1.0.0','unicode_code_point',$10,100,1,ARRAY[1])`,[id,org,caseId,documentId,documentVersionId,extractionId,version,engineVersion,'c'.repeat(64),'a'.repeat(64)])
    await insertRun(runId)
    await pool.query(`INSERT INTO document_ocr_pages(id,organization_id,case_id,ocr_run_id,text_page_id,page_number,status,language_mode,image_width,image_height,render_dpi,rotation_degrees,deskew_degrees,threshold_value,raw_ocr_text,raw_text_hash,normalized_text,normalized_text_hash,normalized_character_count,mean_confidence,minimum_confidence,quality_status,reading_order_quality,composite_status,quality_reason_code,requires_human_review,block_count,line_count,word_count,low_confidence_word_count,unreadable_region_count,processing_duration_ms)VALUES($1,$2,$3,$4,$5,1,'accepted_candidate','tur+eng',100,100,300,0,0,127,'CAM',$6,'CAM',$6,3,90,85,'high','reliable','ocr_only','quality_good',false,1,1,1,0,0,10)`,[ocrPageId,organizationId,caseId,runId,textPageId,'d'.repeat(64)])
    const columns='id,organization_id,case_id,ocr_run_id,page_id,page_number,element_index,reading_order,start_offset,end_offset,element_text,text_hash,confidence,bbox_x,bbox_y,bbox_width,bbox_height'
    await pool.query(`INSERT INTO document_ocr_blocks(${columns})VALUES($1,$2,$3,$4,$5,1,0,0,0,3,'CAM',$6,90,0,0,30,10)`,[blockId,organizationId,caseId,runId,ocrPageId,'f'.repeat(64)])
    await pool.query(`INSERT INTO document_ocr_lines(${columns},block_id)VALUES($1,$2,$3,$4,$5,1,1,1,0,3,'CAM',$6,90,0,0,30,10,$7)`,[lineId,organizationId,caseId,runId,ocrPageId,'f'.repeat(64),blockId])
    await pool.query(`INSERT INTO document_ocr_words(${columns},block_id,line_id)VALUES($1,$2,$3,$4,$5,1,2,2,0,3,'CAM',$6,90,0,0,30,10,$7,$8)`,[wordId,organizationId,caseId,runId,ocrPageId,'f'.repeat(64),blockId,lineId])
    await expect(pool.query(`INSERT INTO document_ocr_words(${columns},block_id,line_id)VALUES($1,$2,$3,$4,$5,1,3,3,0,3,'CAM',$6,90,90,0,20,10,$7,$8)`,[uuidv7(),organizationId,caseId,runId,ocrPageId,'f'.repeat(64),blockId,lineId])).rejects.toMatchObject({code:'23514'})
    await expect(pool.query("UPDATE document_ocr_pages SET normalized_text='DEĞİŞTİ' WHERE id=$1",[ocrPageId])).rejects.toMatchObject({code:'23001'})
    await pool.query(`UPDATE document_ocr_runs SET status='ready',processed_page_count=1,ready_page_count=1,block_count=1,line_count=1,word_count=1,normalized_character_count=3,mean_confidence=90,output_hash=$2,completed_at=now(),version=2 WHERE id=$1`,[runId,'1'.repeat(64)])
    await expect(pool.query("UPDATE document_ocr_runs SET status='stale' WHERE id=$1",[runId])).rejects.toMatchObject({code:'23001'})
    await expect(insertRun(uuidv7(),organizationId,'latest',2)).rejects.toMatchObject({code:'23514',constraint:'document_ocr_runs_engine_valid'})
    await expect(insertRun(uuidv7(),otherOrganizationId,'7.0.0',2)).rejects.toMatchObject({code:'23503'})
    await expect(insertRun(uuidv7(),organizationId,'7.0.0',2)).rejects.toMatchObject({code:'23505',constraint:'document_ocr_runs_exact_identity_unique'})
    await expect(insertRun(uuidv7(),organizationId,'7.0.0',1)).rejects.toMatchObject({code:'23505',constraint:'document_ocr_runs_version_unique'})
  })

  it('0018 AI bundle/run/candidate tenant zinciri, immutable links ve safe integer sinirlarini zorlar', async () => {
    const sourceResult=await pool.query(`SELECT r.organization_id,r.case_id,r.document_id,r.document_version_id,r.id extraction_id,l.id source_item_id,l.page_number,l.element_text source_text,l.text_hash
      FROM document_ocr_runs r JOIN document_ocr_lines l ON l.ocr_run_id=r.id JOIN organizations o ON o.id=r.organization_id
      WHERE o.code='p25-db' AND r.status='ready' LIMIT 1`)
    const source=sourceResult.rows[0] as {organization_id:string;case_id:string;document_id:string;document_version_id:string;extraction_id:string;source_item_id:string;page_number:number;source_text:string;text_hash:string}
    expect(source).toBeDefined()
    const otherOrganizationId=String((await pool.query("SELECT id FROM organizations WHERE code='p25-other'")).rows[0].id),userId=uuidv7(),bundleId=uuidv7(),bundleHash='2'.repeat(64),anchorId='1'.repeat(64),runId=uuidv7()
    await pool.query("INSERT INTO users(id,organization_id,email,password_hash,display_name)VALUES($1,$2,'p26-db@test.local','x','P26 DB')",[userId,source.organization_id])
    await pool.query("INSERT INTO ai_source_bundles(id,organization_id,case_id,source_bundle_hash,bundle_schema_version,status,input_characters,source_count,created_by_user_id)VALUES($1,$2,$3,$4,'policy-ai-source-bundle/1.0.0','building',$5,1,$6)",[bundleId,source.organization_id,source.case_id,bundleHash,source.source_text.length,userId])
    await pool.query("INSERT INTO ai_source_bundle_items(source_anchor_id,bundle_id,organization_id,case_id,source_type,document_id,document_version_id,extraction_id,source_item_id,page_number,source_text,text_hash,source_quality,ordinal)VALUES($1,$2,$3,$4,'ocr',$5,$6,$7,$8,$9,$10,$11,'high',0)",[anchorId,bundleId,source.organization_id,source.case_id,source.document_id,source.document_version_id,source.extraction_id,source.source_item_id,source.page_number,source.source_text,source.text_hash])
    await pool.query("UPDATE ai_source_bundles SET status='ready',completed_at=now() WHERE id=$1",[bundleId])
    const insertRun=(id:string,hash=bundleHash,estimate:bigint|number=1)=>pool.query("INSERT INTO ai_extraction_runs(id,organization_id,case_id,source_bundle_id,source_bundle_hash,provider_id,provider_version,model_id,prompt_template_version,output_schema_version,input_characters,estimated_cost_minor,created_by_user_id)VALUES($1,$2,$3,$4,$5,'deterministic-success','deterministic/1.0.0','local-fixture-v1','policy-ai-extraction/1.0.0','policy-ai-candidates/1.0.0',$6,$7,$8)",[id,source.organization_id,source.case_id,bundleId,hash,source.source_text.length,estimate,userId])
    await insertRun(runId)
    await expect(insertRun(uuidv7(),'f'.repeat(64))).rejects.toMatchObject({code:'23503',constraint:'ai_extraction_runs_bundle_fk'})
    await expect(pool.query('UPDATE ai_extraction_runs SET estimated_cost_minor=$1 WHERE id=$2',[9007199254740992n,runId])).rejects.toMatchObject({code:'23514',constraint:'ai_extraction_runs_valid'})

    const insertCandidate=async(candidateId:string)=>{const client=await pool.connect();try{await client.query('BEGIN');await client.query("INSERT INTO ai_extraction_candidates(organization_id,case_id,run_id,candidate_id,category,canonical_field,normalized_value,original_value,provider_confidence,source_quality,validation_status,conflict_status,human_review_status,provider_id,provider_version,model_id,prompt_template_version,output_schema_version)VALUES($1,$2,$3,$4,'special_condition','special.test','\"CAM\"','CAM',0.8,'high','validated','none','pending','deterministic-success','deterministic/1.0.0','local-fixture-v1','policy-ai-extraction/1.0.0','policy-ai-candidates/1.0.0')",[source.organization_id,source.case_id,runId,candidateId]);await client.query('INSERT INTO ai_candidate_source_links(organization_id,case_id,run_id,candidate_id,bundle_id,source_anchor_id)VALUES($1,$2,$3,$4,$5,$6)',[source.organization_id,source.case_id,runId,candidateId,bundleId,anchorId]);await client.query('COMMIT')}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}}
    await insertCandidate('candidate-1');await insertCandidate('candidate-2')
    await expect(pool.query("DELETE FROM ai_candidate_source_links WHERE run_id=$1 AND candidate_id='candidate-1'",[runId])).rejects.toMatchObject({code:'23001'})

    const secondBundleId=uuidv7(),secondAnchor='3'.repeat(64),secondHash='4'.repeat(64)
    await pool.query("INSERT INTO ai_source_bundles(id,organization_id,case_id,source_bundle_hash,bundle_schema_version,status,input_characters,source_count,created_by_user_id)VALUES($1,$2,$3,$4,'policy-ai-source-bundle/1.0.0','building',$5,1,$6)",[secondBundleId,source.organization_id,source.case_id,secondHash,source.source_text.length,userId])
    await pool.query("INSERT INTO ai_source_bundle_items(source_anchor_id,bundle_id,organization_id,case_id,source_type,document_id,document_version_id,extraction_id,source_item_id,page_number,source_text,text_hash,source_quality,ordinal)VALUES($1,$2,$3,$4,'ocr',$5,$6,$7,$8,$9,$10,$11,'high',0)",[secondAnchor,secondBundleId,source.organization_id,source.case_id,source.document_id,source.document_version_id,source.extraction_id,source.source_item_id,source.page_number,source.source_text,source.text_hash])
    await pool.query("UPDATE ai_source_bundles SET status='ready',completed_at=now() WHERE id=$1",[secondBundleId])
    await expect(pool.query("INSERT INTO ai_candidate_source_links(organization_id,case_id,run_id,candidate_id,bundle_id,source_anchor_id)VALUES($1,$2,$3,'candidate-1',$4,$5)",[source.organization_id,source.case_id,runId,secondBundleId,secondAnchor])).rejects.toMatchObject({code:'23503',constraint:'ai_candidate_source_links_run_bundle_fk'})
    await expect(pool.query("INSERT INTO ai_candidate_conflicts(id,organization_id,case_id,run_id,left_candidate_id,right_candidate_id,status,reason)VALUES($1,$2,$3,$4,'candidate-1','candidate-2','conflict_detected','TENANT_MISMATCH')",[uuidv7(),otherOrganizationId,source.case_id,runId])).rejects.toMatchObject({code:'23503'})
    const conflictId=uuidv7();await pool.query("INSERT INTO ai_candidate_conflicts(id,organization_id,case_id,run_id,left_candidate_id,right_candidate_id,status,reason)VALUES($1,$2,$3,$4,'candidate-1','candidate-2','conflict_detected','SAFE_CONFLICT')",[conflictId,source.organization_id,source.case_id,runId]);await expect(pool.query("UPDATE ai_candidate_conflicts SET reason='CHANGED' WHERE id=$1",[conflictId])).rejects.toMatchObject({code:'23001'})
    await expect(pool.query("INSERT INTO ai_usage_ledger(id,organization_id,case_id,run_id,provider_id,model_id,request_hash,input_characters,estimated_cost_minor,actual_cost_minor,status,started_at)VALUES($1,$2,$3,$4,'deterministic-success','local-fixture-v1',$5,1,1,$6,'failed',now())",[uuidv7(),source.organization_id,source.case_id,runId,'5'.repeat(64),9007199254740992n])).rejects.toMatchObject({code:'23514',constraint:'ai_usage_ledger_valid'})
  })

  it('0020 real provider privacy, provider allow-list ve token muhasebesi kisitlarini zorlar', async () => {
    const selected=await pool.query(`SELECT b.organization_id,b.case_id,b.id bundle_id,b.source_bundle_hash,b.input_characters,u.id user_id
      FROM ai_source_bundles b JOIN users u ON u.organization_id=b.organization_id AND u.email='p26-db@test.local'
      WHERE b.status='ready' ORDER BY b.created_at LIMIT 1`)
    const row=selected.rows[0] as {organization_id:string;case_id:string;bundle_id:string;source_bundle_hash:string;input_characters:number;user_id:string}
    const runId=uuidv7(),privacyHash='6'.repeat(64)
    await pool.query(`INSERT INTO ai_extraction_runs(id,organization_id,case_id,source_bundle_id,source_bundle_hash,provider_id,provider_version,model_id,prompt_template_version,output_schema_version,input_characters,estimated_cost_minor,created_by_user_id,external_provider,privacy_policy_version,outbound_payload_hash,outbound_input_characters,redacted_value_count,redacted_categories,provider_retention_mode,pricing_version)
      VALUES($1,$2,$3,$4,$5,'openai-responses','openai-responses/1.0.0','gpt-5-mini-pinned','policy-ai-extraction/1.0.0','policy-ai-candidates/1.0.0',$6,2,$7,true,'policy-ai-pii-redaction/1.0.0',$8,$6,2,ARRAY['email','name'],'store_false','configured-token-pricing/1.0.0')`,[runId,row.organization_id,row.case_id,row.bundle_id,row.source_bundle_hash,row.input_characters,row.user_id,privacyHash])
    await expect(pool.query("UPDATE ai_extraction_runs SET outbound_payload_hash=$1 WHERE id=$2",['7'.repeat(64),runId])).rejects.toMatchObject({code:'23001'})
    await expect(pool.query("INSERT INTO ai_usage_ledger(id,organization_id,case_id,run_id,provider_id,model_id,request_hash,input_characters,input_tokens,output_tokens,estimated_cost_minor,status,pricing_version,started_at) VALUES($1,$2,$3,$4,'openai-responses','gpt-5-mini-pinned',$5,1,10,NULL,1,'failed','configured-token-pricing/1.0.0',now())",[uuidv7(),row.organization_id,row.case_id,runId,'8'.repeat(64)])).rejects.toMatchObject({code:'23514',constraint:'ai_usage_token_accounting_valid'})
    await pool.query("INSERT INTO ai_provider_policies(id,organization_id,allowed_provider_ids) VALUES($1,$2,ARRAY['openai-responses'])",[uuidv7(),row.organization_id])
    await pool.query("UPDATE ai_provider_policies SET allowed_provider_ids=ARRAY['openai-responses','gemini-generate-content'] WHERE organization_id=$1",[row.organization_id])
    await expect(pool.query("UPDATE ai_provider_policies SET allowed_provider_ids=ARRAY['unknown-provider'] WHERE organization_id=$1",[row.organization_id])).rejects.toMatchObject({code:'23514',constraint:'ai_provider_policies_provider_valid'})
  })

  it('0021 provider receipt kimligi, kanonik sonuc ve terminal durumunu degistirilemez tutar', async () => {
    const selected=await pool.query(`SELECT r.organization_id,r.case_id,r.source_bundle_id,r.source_bundle_hash,r.input_characters,u.id user_id
      FROM ai_extraction_runs r JOIN users u ON u.organization_id=r.organization_id AND u.email='p26-db@test.local'
      WHERE r.provider_id='openai-responses' ORDER BY r.created_at DESC LIMIT 1`)
    const row=selected.rows[0] as {organization_id:string;case_id:string;source_bundle_id:string;source_bundle_hash:string;input_characters:number;user_id:string}
    const runId=uuidv7(),privacyHash='d'.repeat(64)
    await pool.query(`INSERT INTO ai_extraction_runs(id,organization_id,case_id,source_bundle_id,source_bundle_hash,provider_id,provider_version,model_id,prompt_template_version,output_schema_version,input_characters,estimated_cost_minor,created_by_user_id,external_provider,privacy_policy_version,outbound_payload_hash,outbound_input_characters,redacted_value_count,redacted_categories,provider_retention_mode,pricing_version)
      VALUES($1,$2,$3,$4,$5,'gemini-generate-content','gemini-generate-content/1.0.0','gemini-3.5-flash','policy-ai-extraction/1.0.0','policy-ai-candidates/1.0.0',$6,0,$7,true,'policy-ai-pii-redaction/1.0.0',$8,$6,2,ARRAY['email','name'],'free_tier_product_improvement','gemini-free-tier/2026-07-15')`,[runId,row.organization_id,row.case_id,row.source_bundle_id,row.source_bundle_hash,row.input_characters,row.user_id,privacyHash])
    await expect(pool.query("UPDATE ai_extraction_runs SET provider_retention_mode='store_false' WHERE id=$1",[runId])).rejects.toMatchObject({code:'23001'})
    const receiptId=uuidv7(),requestHash='9'.repeat(64),idempotencyHash='a'.repeat(64),clientRequestId='b'.repeat(64)
    await pool.query(`INSERT INTO ai_provider_call_receipts
      (id,organization_id,case_id,run_id,request_hash,idempotency_request_hash,client_request_id,provider_id,provider_version,model_id,input_characters,estimated_cost_minor,pricing_version,created_by_user_id,request_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,'gemini-generate-content','gemini-generate-content/1.0.0','gemini-3.5-flash',$8,0,'gemini-free-tier/2026-07-15',$9,$10)`,[receiptId,row.organization_id,row.case_id,runId,requestHash,idempotencyHash,clientRequestId,row.input_characters,row.user_id,uuidv7()])
    await expect(pool.query('UPDATE ai_provider_call_receipts SET request_hash=$1 WHERE id=$2',['c'.repeat(64),receiptId])).rejects.toMatchObject({code:'23001'})
    const output={schemaVersion:'policy-ai-candidates/1.0.0',candidates:[]},outputHash=createHash('sha256').update(JSON.stringify(output)).digest('hex')
    await pool.query("UPDATE ai_provider_call_receipts SET status='response_recorded',result_kind='success',provider_response_id='resp_test',provider_request_id='req_test',canonical_output=$1::jsonb,canonical_output_hash=$2,output_characters=$3,input_tokens=10,output_tokens=2,actual_cost_minor=0,response_received_at=now(),version=version+1 WHERE id=$4",[JSON.stringify(output),outputHash,JSON.stringify(output).length,receiptId])
    await expect(pool.query("UPDATE ai_provider_call_receipts SET canonical_output='{}'::jsonb WHERE id=$1",[receiptId])).rejects.toMatchObject({code:'23001'})
    await pool.query("UPDATE ai_provider_call_receipts SET status='finalized',finalized_at=now(),version=version+1 WHERE id=$1",[receiptId])
    await expect(pool.query('DELETE FROM ai_provider_call_receipts WHERE id=$1',[receiptId])).rejects.toMatchObject({code:'23001'})
    const otherOrganizationId=String((await pool.query("SELECT id FROM organizations WHERE code='p25-other'")).rows[0].id)
    await expect(pool.query(`INSERT INTO ai_provider_call_receipts
      (id,organization_id,case_id,run_id,request_hash,idempotency_request_hash,client_request_id,provider_id,provider_version,model_id,input_characters,estimated_cost_minor,pricing_version,created_by_user_id,request_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,'gemini-generate-content','gemini-generate-content/1.0.0','gemini-3.5-flash',1,0,'gemini-free-tier/2026-07-15',$8,$9)`,[uuidv7(),otherOrganizationId,row.case_id,runId,'1'.repeat(64),'2'.repeat(64),'3'.repeat(64),row.user_id,uuidv7()])).rejects.toMatchObject({code:'23503'})
  })

  it('0019 review version, tenant, provider fact ve append-only kisitlarini zorlar', async () => {
    const selected=await pool.query(`SELECT c.organization_id,c.case_id,c.run_id,c.candidate_id,u.id user_id,
      array_agg(l.source_anchor_id ORDER BY l.source_anchor_id) anchors
      FROM ai_extraction_candidates c JOIN ai_candidate_source_links l ON l.run_id=c.run_id AND l.candidate_id=c.candidate_id
      JOIN users u ON u.organization_id=c.organization_id AND u.email='p26-db@test.local'
      WHERE c.candidate_id='candidate-1' GROUP BY c.organization_id,c.case_id,c.run_id,c.candidate_id,u.id LIMIT 1`)
    const row=selected.rows[0] as {organization_id:string;case_id:string;run_id:string;candidate_id:string;user_id:string;anchors:string[]}
    const insert=(id:string,version:number,action:string,normalizedValue:unknown,originalValue:string,anchors=row.anchors,reason:string|null=null)=>pool.query(
      `INSERT INTO ai_candidate_reviews
       (id,organization_id,case_id,run_id,candidate_id,review_version,schema_version,action,normalized_value,
        original_value,conditions,exceptions,source_anchor_ids,reason,evidence_status,reviewed_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,'policy-ai-human-review/1.0.0',$7,$8::jsonb,$9,'[]','[]',$10,$11,'validated',$12)`,
      [id,row.organization_id,row.case_id,row.run_id,row.candidate_id,version,action,JSON.stringify(normalizedValue),originalValue,anchors,reason,row.user_id])
    const reviewId=uuidv7();await insert(reviewId,1,'accepted','CAM','CAM')
    await expect(insert(uuidv7(),2,'accepted','DEGISTI','CAM')).rejects.toMatchObject({code:'23514'})
    await expect(insert(uuidv7(),2,'control_required','CAM','CAM',['f'.repeat(64)],'Kontrol')).rejects.toMatchObject({code:'23514'})
    await insert(uuidv7(),2,'control_required','CAM','CAM',row.anchors,'Kontrol')
    await expect(pool.query("UPDATE ai_candidate_reviews SET reason='degisti' WHERE id=$1",[reviewId])).rejects.toMatchObject({code:'23001'})
    const otherOrganizationId=String((await pool.query("SELECT id FROM organizations WHERE code='p25-other'")).rows[0].id)
    await expect(pool.query(`INSERT INTO ai_candidate_reviews
      (id,organization_id,case_id,run_id,candidate_id,review_version,schema_version,action,normalized_value,original_value,conditions,exceptions,source_anchor_ids,evidence_status,reviewed_by_user_id)
      VALUES ($1,$2,$3,$4,$5,3,'policy-ai-human-review/1.0.0','accepted','"CAM"','CAM','[]','[]',$6,'validated',$7)`,
      [uuidv7(),otherOrganizationId,row.case_id,row.run_id,row.candidate_id,row.anchors,row.user_id])).rejects.toMatchObject({code:'23503'})
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
