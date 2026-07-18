import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  assertTestDatabaseUrl,
  closeDatabasePool,
  createDatabasePool,
  runMigrations,
  uuidv7,
} from '../packages/database/dist/index.js'
import { createOperationalAlertStore } from '../services/api/dist/index.js'

/**
 * Paket 51 — operasyonel uyarı ucu performans ölçümü.
 *
 * Üretim koduna enstrümantasyon eklenmez: `pool.query` sarmalanarak SQL sorgu
 * sayısı ve süreleri ölçülür. Kural değerlendirme süresi, toplam süreden SQL
 * süresi çıkarılarak bulunur (uçtaki iş SQL + saf kural değerlendirmesidir).
 *
 * Kullanım:
 *   node scripts/package51-alert-performance.mjs [--sizes 100,1000,5000] [--runs 5]
 *   node scripts/package51-alert-performance.mjs --json out.json
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL
if (DATABASE_URL === undefined) throw new Error('TEST_DATABASE_URL_REQUIRED')
const databaseConfig = assertTestDatabaseUrl(DATABASE_URL)

function argValue(name, fallback) {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : process.argv[index + 1]
}

const SIZES = String(argValue('--sizes', '100,1000,5000')).split(',').map((value) => Number(value.trim()))
const RUNS = Number(argValue('--runs', '5'))
const JSON_OUT = argValue('--json', null)
const AS_OF_DATE = '2026-07-18'
const EVALUATED_AT = '2026-07-18T09:00:00.000Z'

/** Trafik dosyası zorunlu evrak kümesi; eksiltilerek eksik evrak üretilir. */
const TRAFFIC_DOCUMENTS = [
  'victim_traffic_policy',
  'insured_traffic_policy',
  'sbm_heavy_damage_result',
  'victim_registration',
  'insured_registration',
  'victim_driver_license',
  'insured_driver_license',
  'accident_report',
]

const pool = createDatabasePool({ config: databaseConfig })

/** `pool.query` sarmalayıcısı: sorgu sayısı ve süreleri toplanır. */
function instrument(target) {
  const calls = []
  const proxy = {
    query: async (...args) => {
      const started = process.hrtime.bigint()
      try {
        return await target.query(...args)
      } finally {
        const durationMs = Number(process.hrtime.bigint() - started) / 1e6
        const text = typeof args[0] === 'string' ? args[0] : String(args[0]?.text ?? '')
        calls.push({ durationMs, sql: text.replace(/\s+/gu, ' ').trim().slice(0, 90) })
      }
    },
  }
  return { proxy, calls, reset: () => calls.splice(0, calls.length) }
}

function percentile(values, fraction) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))
  return sorted[index]
}

function round(value) {
  return Math.round(value * 100) / 100
}

async function resetSchema() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await runMigrations({ databaseUrl: databaseConfig.url, quiet: true })
}

/**
 * Gerçekçi karışık dağılım. Modulo ile deterministik:
 * - görev: %35 süresi geçmiş, %20 gelecekte, %10 tamamlanmış geciken, %35 görevsiz
 * - takip: %25 geçmiş, %25 gelecek, %50 yok
 * - evrak: %40 tam, %35 bir eksik, %25 iki eksik
 */
async function seedVolume(organizationId, userId, caseCount) {
  await pool.query(
    `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
        workflow_stage,plate,plate_normalized,responsible_user_id,follow_up_date,notification_date,version)
     SELECT gen_random_uuid(),$1,2026,seq,'2026/'||seq,'traffic','open','reporting',
            '34 PF '||seq,'34PF'||seq,$2,
            CASE seq % 4
              WHEN 0 THEN DATE '2026-07-10'
              WHEN 1 THEN DATE '2026-08-05'
              ELSE NULL
            END,
            DATE '2026-07-01',1
       FROM generate_series(1,$3) AS seq`,
    [organizationId, userId, caseCount],
  )

  await pool.query(
    `INSERT INTO case_tasks
       (id,organization_id,case_id,title,priority,status,assigned_user_id,due_date,created_by_user_id,
        resolution_note,resolved_by_user_id,resolved_at,version)
     SELECT gen_random_uuid(),$1,c.id,
            'Sentetik görev '||c.office_sequence,
            (ARRAY['low','normal','high'])[1 + (c.office_sequence % 3)],
            CASE WHEN c.office_sequence % 20 < 2 THEN 'completed' ELSE 'open' END,
            $2,
            CASE WHEN c.office_sequence % 20 < 11 THEN DATE '2026-07-12' ELSE DATE '2026-07-25' END,
            $2,
            CASE WHEN c.office_sequence % 20 < 2 THEN 'Sentetik çözüm' ELSE NULL END,
            CASE WHEN c.office_sequence % 20 < 2 THEN $2::uuid ELSE NULL END,
            CASE WHEN c.office_sequence % 20 < 2 THEN TIMESTAMPTZ '2026-07-13T09:00:00Z' ELSE NULL END,
            1
       FROM cases c
      WHERE c.organization_id=$1 AND c.office_sequence % 20 < 13`,
    [organizationId, userId],
  )

  // Evrak: her dosya için tam küme, sonra eksiklik dağılımına göre satır elenir.
  await pool.query(
    `INSERT INTO documents (id,organization_id,case_id,document_type,current_version_number,status)
     SELECT gen_random_uuid(),$1,c.id,t.document_type,1,'ready'
       FROM cases c
       CROSS JOIN unnest($2::text[]) WITH ORDINALITY AS t(document_type,position)
      WHERE c.organization_id=$1
        AND NOT (c.office_sequence % 20 >= 8 AND t.position = 1)
        AND NOT (c.office_sequence % 20 >= 15 AND t.position = 8)`,
    [organizationId, TRAFFIC_DOCUMENTS],
  )

  await pool.query(
    `INSERT INTO document_versions
       (id,organization_id,document_id,case_id,version_number,original_file_name,display_name,
        extension,mime_type,byte_size,content_hash,storage_root_key,relative_path,source_type,
        status,hash_verified,size_verified,verified_at,registered_by_user_id)
     SELECT gen_random_uuid(),$1,d.id,d.case_id,1,d.document_type||'.pdf',d.document_type||'.pdf',
            'pdf','application/pdf',128,repeat('a',64),'synthetic-root',
            'synthetic/'||d.case_id||'/'||d.document_type||'.pdf','manual',
            'ready',true,true,TIMESTAMPTZ '2026-07-10T08:00:00Z',$2
       FROM documents d
      WHERE d.organization_id=$1 AND d.current_version_id IS NULL`,
    [organizationId, userId],
  )

  await pool.query(
    `UPDATE documents d
        SET current_version_id=v.id
       FROM document_versions v
      WHERE v.document_id=d.id AND d.organization_id=$1 AND d.current_version_id IS NULL`,
    [organizationId],
  )
}

async function measure(caseCount) {
  await resetSchema()
  const organizationId = uuidv7()
  const userId = uuidv7()
  await pool.query(
    "INSERT INTO organizations (id,code,name) VALUES ($1,'p51-perf','P51 Performans Sentetik')",
    [organizationId],
  )
  await pool.query(
    `INSERT INTO users (id,organization_id,email,display_name,password_hash,status)
     VALUES ($1,$2,'p51-perf@test.local','P51 Ölçüm',repeat('x',60),'active')`,
    [userId, organizationId],
  )
  await seedVolume(organizationId, userId, caseCount)
  await pool.query('ANALYZE')

  const rowCounts = await pool.query(
    `SELECT (SELECT count(*) FROM cases WHERE organization_id=$1) AS cases,
            (SELECT count(*) FROM case_tasks WHERE organization_id=$1) AS tasks,
            (SELECT count(*) FROM documents WHERE organization_id=$1) AS documents`,
    [organizationId],
  )

  const { proxy, calls, reset } = instrument(pool)
  const store = createOperationalAlertStore(proxy)
  const runs = []

  for (let index = 0; index < RUNS; index += 1) {
    reset()
    const started = process.hrtime.bigint()
    const response = await store.list(organizationId, AS_OF_DATE, EVALUATED_AT)
    const totalMs = Number(process.hrtime.bigint() - started) / 1e6
    const sqlMs = calls.reduce((sum, call) => sum + call.durationMs, 0)
    runs.push({
      totalMs: round(totalMs),
      sqlMs: round(sqlMs),
      ruleEvaluationMs: round(totalMs - sqlMs),
      queryCount: calls.length,
      queries: calls.map((call) => ({ durationMs: round(call.durationMs), sql: call.sql })),
      alertCount: response.alerts.length,
      totalCount: response.totalCount,
    })
  }

  const cold = runs[0]
  const warm = runs.slice(1)
  const warmTotals = warm.map((run) => run.totalMs)
  const warmSql = warm.map((run) => run.sqlMs)
  const warmRule = warm.map((run) => run.ruleEvaluationMs)

  return {
    caseCount,
    rows: {
      cases: Number(rowCounts.rows[0].cases),
      tasks: Number(rowCounts.rows[0].tasks),
      documents: Number(rowCounts.rows[0].documents),
    },
    alertCount: cold.alertCount,
    totalCount: cold.totalCount,
    queryCount: cold.queryCount,
    cold: {
      totalMs: cold.totalMs,
      sqlMs: cold.sqlMs,
      ruleEvaluationMs: cold.ruleEvaluationMs,
      queries: cold.queries,
    },
    warm: {
      runs: warm.length,
      medianTotalMs: round(percentile(warmTotals, 0.5)),
      minTotalMs: round(Math.min(...warmTotals)),
      maxTotalMs: round(Math.max(...warmTotals)),
      medianSqlMs: round(percentile(warmSql, 0.5)),
      medianRuleEvaluationMs: round(percentile(warmRule, 0.5)),
    },
    queryCountStable: runs.every((run) => run.queryCount === cold.queryCount),
  }
}

try {
  const results = []
  for (const size of SIZES) {
    process.stderr.write(`ölçülüyor: ${size} açık dosya...\n`)
    results.push(await measure(size))
  }

  const report = {
    measuredAt: new Date().toISOString(),
    runsPerSize: RUNS,
    asOfDate: AS_OF_DATE,
    results,
  }
  if (JSON_OUT !== null) writeFileSync(resolve(JSON_OUT), `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  for (const result of results) {
    console.log(JSON.stringify({
      caseCount: result.caseCount,
      rows: result.rows,
      alertCount: result.alertCount,
      queryCount: result.queryCount,
      queryCountStable: result.queryCountStable,
      coldTotalMs: result.cold.totalMs,
      coldSqlMs: result.cold.sqlMs,
      coldRuleMs: result.cold.ruleEvaluationMs,
      warmMedianTotalMs: result.warm.medianTotalMs,
      warmMedianSqlMs: result.warm.medianSqlMs,
      warmMedianRuleMs: result.warm.medianRuleEvaluationMs,
    }))
  }
} finally {
  await closeDatabasePool(pool)
}
