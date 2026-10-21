import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type pg from 'pg'
import { assertTestDatabaseUrl, closeDatabasePool, createDatabasePool, MIGRATIONS_DIR, runMigrations, uuidv7 } from '../src/index.js'

const url = process.env.TEST_DATABASE_URL
const describeDb = url ? describe : describe.skip

describeDb('PDF parser identity migration (real PostgreSQL)', () => {
  let pool: pg.Pool
  let directory: string
  let organizationId: string
  let caseId: string
  let documentId: string
  let documentVersionId: string
  const migrate = (direction: 'up' | 'down' = 'up') => runMigrations({ databaseUrl: url!, dir: directory, direction, count: 1, quiet: true })

  async function insertSnapshot(parserVersion: string, extractionVersion: number) {
    const id = uuidv7()
    await pool.query(`INSERT INTO document_text_extractions
      (id,organization_id,case_id,document_id,document_version_id,extraction_version,status,
       parser_name,parser_version,normalization_version,offset_unit,source_hash,source_size,output_hash,completed_at)
      VALUES ($1,$2,$3,$4,$5,$6,'ready','pdfjs-dist',$7,'pdf-text-normalization/1.0.0',
              'unicode_code_point',$8,100,$9,now())`,
    [id, organizationId, caseId, documentId, documentVersionId, extractionVersion, parserVersion, 'a'.repeat(64), 'b'.repeat(64)])
    return id
  }

  beforeAll(async () => {
    pool = createDatabasePool({ config: assertTestDatabaseUrl(url!) })
    directory = mkdtempSync(join(tmpdir(), 'hb-pdf-parser-migrations-'))
    for (const file of readdirSync(MIGRATIONS_DIR).filter(name => /^\d{4}_.*\.js$/.test(name) && name.slice(0, 4) <= '0067')) {
      copyFileSync(join(MIGRATIONS_DIR, file), join(directory, file))
    }
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: url!, dir: directory, count: 66, quiet: true })
    organizationId = uuidv7(); caseId = uuidv7(); documentId = uuidv7(); documentVersionId = uuidv7()
    await pool.query('INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)', [organizationId, 'pdf-parser-migration', 'Synthetic parser migration'])
    await pool.query(`INSERT INTO cases
      (id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,plate,plate_normalized,notification_date)
      VALUES ($1,$2,2026,6701,'2026/6701','casco','new_notification','34 PDF 67','34PDF67','2026-10-20')`, [caseId, organizationId])
    await pool.query("INSERT INTO documents(id,organization_id,case_id,document_type,status) VALUES($1,$2,$3,'casco_policy','ready')", [documentId, organizationId, caseId])
    await pool.query(`INSERT INTO document_versions
      (id,organization_id,document_id,case_id,version_number,original_file_name,display_name,mime_type,byte_size,content_hash,storage_root_key,relative_path,source_type,status,hash_verified,size_verified,verified_at)
      VALUES ($1,$2,$3,$4,1,'synthetic.pdf','Synthetic PDF','application/pdf',100,$5,'test-root','EVRAK/synthetic.pdf','manual','ready',true,true,now())`,
    [documentVersionId, organizationId, documentId, caseId, 'a'.repeat(64)])
    await pool.query('UPDATE documents SET current_version_id=$1,current_version_number=1 WHERE id=$2', [documentVersionId, documentId])
    await insertSnapshot('6.1.200', 1)
    await insertSnapshot('6.2.108', 2)
  }, 60_000)

  afterAll(async () => {
    if (pool) await closeDatabasePool(pool)
    if (directory) rmSync(directory, { recursive: true, force: true })
  })

  it('preserves both historical snapshots through upgrade and rollback without new evidence', async () => {
    const before = (await pool.query('SELECT * FROM document_text_extractions ORDER BY extraction_version')).rows
    await expect(insertSnapshot('6.4.299', 3)).rejects.toMatchObject({ code: '23514', constraint: 'document_text_extractions_engine_valid' })
    expect((await migrate()).map(migration => migration.name)).toEqual(['0067_pdf_parser_version'])
    expect((await pool.query('SELECT * FROM document_text_extractions ORDER BY extraction_version')).rows).toEqual(before)
    expect((await migrate('down')).map(migration => migration.name)).toEqual(['0067_pdf_parser_version'])
    expect((await pool.query('SELECT * FROM document_text_extractions ORDER BY extraction_version')).rows).toEqual(before)
    await expect(insertSnapshot('6.4.299', 3)).rejects.toMatchObject({ code: '23514', constraint: 'document_text_extractions_engine_valid' })
    expect((await migrate()).map(migration => migration.name)).toEqual(['0067_pdf_parser_version'])
  })

  it('accepts current evidence, rejects unknown engines and rolls back a destructive downgrade atomically', async () => {
    const id = await insertSnapshot('6.4.299', 3)
    await expect(insertSnapshot('latest', 4)).rejects.toMatchObject({ code: '23514', constraint: 'document_text_extractions_engine_valid' })
    const before = (await pool.query('SELECT * FROM document_text_extractions ORDER BY extraction_version')).rows
    await expect(migrate('down')).rejects.toThrow('pdf_parser_version_downgrade_would_lose_data')
    expect((await pool.query('SELECT * FROM document_text_extractions ORDER BY extraction_version')).rows).toEqual(before)
    expect((await pool.query('SELECT name FROM pgmigrations ORDER BY id DESC LIMIT 1')).rows[0].name).toBe('0067_pdf_parser_version')
    await expect(pool.query("UPDATE document_text_extractions SET parser_version='6.2.108' WHERE id=$1", [id])).rejects.toMatchObject({ code: '23001' })
    expect(await migrate()).toEqual([])
  })
})
