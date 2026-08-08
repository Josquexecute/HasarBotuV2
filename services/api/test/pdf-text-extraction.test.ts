import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AGENTS_ROUTE,
  AUTH_LOGIN_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  pdfTextExtractionResponseSchema,
  pdfTextPagesResponseSchema,
  pdfTextSegmentsResponseSchema,
  pdfTextSourceReferenceResponseSchema,
  policyAnalysisResponseSchema,
} from '@hasarbotu/contracts'
import { assertTestDatabaseUrl, closeDatabasePool, createDatabasePool, runMigrations, uuidv7, type DatabaseConfig } from '@hasarbotu/database'
import { createAgentApiClient, runOnce, type AgentConfig } from '@hasarbotu/file-agent'
import { buildApp, hashPassword } from '../src/index.js'

const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'p24-sentetik-guclu-parola-42'

function syntheticTextPdf(text: string): Buffer {
  const content = `BT /F1 14 Tf 50 750 Td (${text.replace(/[\\()]/g, '\\$&')}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ]
  const parts = ['%PDF-1.4\n%synthetic\n']; const offsets = [0]
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(parts.join(''))); parts.push(`${index + 1} 0 obj\n${object}\nendobj\n`) }
  const xref = Buffer.byteLength(parts.join(''))
  parts.push(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return Buffer.from(parts.join(''), 'ascii')
}

describeDb('Kasko PDF metin çıkarımı API + gerçek File Agent (gerçek PostgreSQL)', () => {
  let config: DatabaseConfig; let pool: pg.Pool; let app: FastifyInstance; let baseUrl: string; let root: string
  let organizationId: string; let otherOrganizationId: string; let caseId: string; let trafficCaseId: string
  let documentId: string; let documentVersionId: string; let trafficDocumentId: string; let trafficVersionId: string
  let adminCookie: string; let managerCookie: string; let secretaryCookie: string; let otherCookie: string
  let client: ReturnType<typeof createAgentApiClient>; let agentConfig: AgentConfig

  async function seedUser(orgId: string, email: string, role: 'admin' | 'case_manager' | 'secretary') {
    const id = uuidv7(); await pool.query('INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,$5)', [id, orgId, email, email, await hashPassword(PASSWORD)])
    await pool.query('INSERT INTO user_roles (user_id,role_id) VALUES ($1,(SELECT id FROM roles WHERE code=$2))', [id, role]); return id
  }
  async function login(email: string) { const response = await app.inject({ method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email, password: PASSWORD } }); expect(response.statusCode).toBe(200); return String(response.headers['set-cookie']).split(';')[0] as string }
  async function seedPolicy(targetCaseId: string, orgId: string, relativePath: string, pdf: Buffer) {
    const docId = uuidv7(), versionId = uuidv7(), hash = createHash('sha256').update(pdf).digest('hex')
    await pool.query("INSERT INTO documents (id,organization_id,case_id,document_type,status) VALUES ($1,$2,$3,'casco_policy','ready')", [docId, orgId, targetCaseId])
    await pool.query(`INSERT INTO document_versions
      (id,organization_id,document_id,case_id,version_number,original_file_name,display_name,mime_type,extension,byte_size,content_hash,storage_root_key,relative_path,source_type,status,hash_verified,size_verified,verified_at)
      VALUES ($1,$2,$3,$4,1,'sentetik-police.pdf','Sentetik Kasko Poliçesi','application/pdf','pdf',$5,$6,'test-root',$7,'manual','ready',true,true,now())`, [versionId, orgId, docId, targetCaseId, pdf.length, hash, relativePath])
    await pool.query('UPDATE documents SET current_version_id=$1,current_version_number=1 WHERE id=$2', [versionId, docId]); return { docId, versionId }
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string); pool = createDatabasePool({ config }); await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); await runMigrations({ databaseUrl: config.url, quiet: true })
    organizationId = uuidv7(); otherOrganizationId = uuidv7(); await pool.query('INSERT INTO organizations (id,code,name) VALUES ($1,$2,$3),($4,$5,$6)', [organizationId, 'p24-main', 'P24 Main', otherOrganizationId, 'p24-other', 'P24 Other'])
    await seedUser(organizationId, 'p24-admin@test.local', 'admin'); await seedUser(organizationId, 'p24-manager@test.local', 'case_manager'); await seedUser(organizationId, 'p24-secretary@test.local', 'secretary'); await seedUser(otherOrganizationId, 'p24-other@test.local', 'admin')
    await pool.query("INSERT INTO storage_roots (id,organization_id,root_key,label) VALUES ($1,$2,'test-root','Sentetik Root')", [uuidv7(), organizationId])
    caseId = uuidv7(); trafficCaseId = uuidv7(); await pool.query(`INSERT INTO cases
      (id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,plate,plate_normalized,notification_date)
      VALUES ($1,$3,2026,2401,'2026/2401','casco','new_notification','34 P 2401','34P2401','2026-07-14'),($2,$3,2026,2402,'2026/2402','traffic','new_notification','34 P 2402','34P2402','2026-07-14')`, [caseId, trafficCaseId, organizationId])
    const pdf = syntheticTextPdf('KASKO POLICE OZEL SART'); root = await mkdtemp(join(tmpdir(), 'hb-p24-api-')); await mkdir(join(root, 'EVRAK')); await writeFile(join(root, 'EVRAK', 'policy.pdf'), pdf)
    ;({ docId: documentId, versionId: documentVersionId } = await seedPolicy(caseId, organizationId, 'EVRAK/policy.pdf', pdf)); ({ docId: trafficDocumentId, versionId: trafficVersionId } = await seedPolicy(trafficCaseId, organizationId, 'EVRAK/traffic-policy.pdf', pdf))
    app = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false, loginRateLimit: { limit: 1000, windowMs: 60_000 } } }); adminCookie = await login('p24-admin@test.local'); managerCookie = await login('p24-manager@test.local'); secretaryCookie = await login('p24-secretary@test.local'); otherCookie = await login('p24-other@test.local')
    const registered = await app.inject({ method: 'POST', url: AGENTS_ROUTE, headers: { cookie: adminCookie }, payload: { name: 'P24 Extraction Agent' } }); expect(registered.statusCode).toBe(201); const agent = registered.json() as { agent: { id: string }; secret: string }
    await app.listen({ host: '127.0.0.1', port: 0 }); const address = app.addresses()[0]!; baseUrl = `http://127.0.0.1:${address.port}`
    agentConfig = { apiBaseUrl: baseUrl, agentId: agent.agent.id, agentSecret: agent.secret, roots: { 'test-root': root }, leaseSeconds: 120, pollIntervalMs: 1000, freshnessGate: undefined }; client = createAgentApiClient({ baseUrl, agentId: agent.agent.id, secret: agent.secret })
  }, 60_000)

  afterAll(async () => { if (app !== undefined) await app.close(); if (pool !== undefined) await closeDatabasePool(pool); if (root !== undefined) await rm(root, { recursive: true, force: true }) })

  it('401/403, Kasko kaynağı, idempotency ve Traffic reddini uygular', async () => {
    const route = `/api/v1/cases/${caseId}/documents/${documentId}/versions/${documentVersionId}/text-extractions`
    expect((await app.inject({ method: 'POST', url: route, headers: { [IDEMPOTENCY_KEY_HEADER]: uuidv7() }, payload: {} })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: route, headers: { cookie: secretaryCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() }, payload: {} })).statusCode).toBe(403)
    const traffic = await app.inject({ method: 'POST', url: `/api/v1/cases/${trafficCaseId}/documents/${trafficDocumentId}/versions/${trafficVersionId}/text-extractions`, headers: { cookie: adminCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() }, payload: {} }); expect(traffic.statusCode).toBe(400)
    const key = uuidv7(); const first = await app.inject({ method: 'POST', url: route, headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: key }, payload: {} }); expect(first.statusCode, first.payload).toBe(201); const created = pdfTextExtractionResponseSchema.parse(first.json()); expect(created.extraction.status).toBe('queued')
    const replay = await app.inject({ method: 'POST', url: route, headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: key }, payload: {} }); expect(replay.statusCode).toBe(201); expect(replay.json()).toEqual(first.json())
    expect((await pool.query('SELECT count(*)::int AS n FROM document_text_extractions WHERE document_version_id=$1', [documentVersionId])).rows).toEqual([{ n: 1 }])
  })

  it('canlı API üzerinden claim→izole parse→chunk→verify→finalize çalışır', async () => {
    const result = await runOnce(client, agentConfig); expect(result.kind).toBe('reported'); if (result.kind === 'reported') expect(result.reported.status).toBe('succeeded')
    const row = await pool.query('SELECT id FROM document_text_extractions WHERE document_version_id=$1', [documentVersionId]); const extractionId = (row.rows[0] as { id: string }).id
    const detailResponse = await fetch(`${baseUrl}/api/v1/cases/${caseId}/text-extractions/${extractionId}`, { headers: { cookie: adminCookie } }); expect(detailResponse.status).toBe(200); const detail = pdfTextExtractionResponseSchema.parse(await detailResponse.json()); expect(detail.extraction).toMatchObject({ status: 'ready', parserVersion: '6.1.200', normalizationVersion: 'pdf-text-normalization/1.0.0', pageCount: 1, textPageCount: 1, segmentCount: 1 })
    const pages = pdfTextPagesResponseSchema.parse((await app.inject({ method: 'GET', url: `/api/v1/cases/${caseId}/text-extractions/${extractionId}/pages?page=1&pageSize=20`, headers: { cookie: adminCookie } })).json()); expect(pages.items[0]).toMatchObject({ pageNumber: 1, status: 'text', normalizedText: 'KASKO POLICE OZEL SART' })
    const segments = pdfTextSegmentsResponseSchema.parse((await app.inject({ method: 'GET', url: `/api/v1/cases/${caseId}/text-extractions/${extractionId}/segments?page=1&pageSize=20`, headers: { cookie: adminCookie } })).json()); expect(segments.items).toHaveLength(1)
    const segment = segments.items[0]!; const referenceResponse = await app.inject({ method: 'POST', url: `/api/v1/cases/${caseId}/text-extractions/${extractionId}/source-reference`, headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() }, payload: { sourceKey: 'PDF_S1', pageId: segment.pageId, segmentId: segment.id, startOffset: segment.startOffset, endOffset: segment.endOffset, sectionHeading: 'Özel Şartlar', clauseIdentifier: 'PDF-1', sourceType: 'policy', confidence: 1 } }); expect(referenceResponse.statusCode, referenceResponse.payload).toBe(200)
    const reference = pdfTextSourceReferenceResponseSchema.parse(referenceResponse.json()).sourceReference; expect(reference).toMatchObject({ documentId, documentVersionId, pageNumber: 1, rawExcerpt: 'KASKO POLICE OZEL SART', extractionLocator: { extractionId, pageId: segment.pageId, segmentId: segment.id, startOffset: 0 } })

    const analysisPayload = { sourceDocumentId: documentId, sourceDocumentVersionId: documentVersionId, insurerId: null, policyNumber: null, endorsementNumber: null, productName: 'Sentetik', productType: null, insurerFormat: 'pdf-text-v1', policyStartDate: null, policyEndDate: null, issueDate: null, insuredVehicleReference: null, sourceCompleteness: 'complete', initialStatus: 'draft', sourceReferences: [reference], coverages: [{ code: 'COLLISION', canonicalType: 'collision', originalHeading: 'Çarpışma', originalWording: 'Sentetik kanıt metni.', inclusion: 'included', limit: null, conditions: [], exceptions: [], requiredDocuments: [], sourceKeys: ['PDF_S1'], confidence: 1 }], deductibles: [], serviceRules: [], partRules: [], replacementVehicleRules: [], exclusions: [], requiredDocuments: [], scenarioRules: [], conflicts: [] }
    const analysisResponse = await app.inject({ method: 'POST', url: `/api/v1/cases/${caseId}/policy-analyses`, headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() }, payload: analysisPayload }); expect(analysisResponse.statusCode, analysisResponse.payload).toBe(201); const analysis = policyAnalysisResponseSchema.parse(analysisResponse.json()); expect(analysis.analysis.currentVersion.sourceReferences[0]?.extractionLocator).toMatchObject({ extractionId, pageId: segment.pageId, segmentId: segment.id })

    expect((await app.inject({ method: 'GET', url: `/api/v1/cases/${caseId}/text-extractions/${extractionId}`, headers: { cookie: otherCookie } })).statusCode).toBe(404)
    const audit = await pool.query("SELECT action,details::text AS details FROM audit_events WHERE resource_type='document_text_extraction' AND resource_id=$1", [extractionId]); const serialized = JSON.stringify({ detail, reference, audit: audit.rows }); expect(serialized).not.toContain(root); expect(serialized).not.toMatch(/[A-Z]:\\|password|secret/i); expect(JSON.stringify(audit.rows)).not.toContain('KASKO POLICE OZEL SART')
  }, 60_000)
})
