import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas, loadImage, PDFDocument } from '@napi-rs/canvas'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AGENTS_ROUTE,
  AUTH_LOGIN_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  pdfTextExtractionResponseSchema,
  policyAnalysisResponseSchema,
  policyOcrElementsResponseSchema,
  policyOcrPagesResponseSchema,
  policyOcrRunResponseSchema,
  policyOcrSourceReferenceResponseSchema,
} from '@hasarbotu/contracts'
import {
  assertTestDatabaseUrl,
  closeDatabasePool,
  createDatabasePool,
  runMigrations,
  uuidv7,
  type DatabaseConfig,
} from '@hasarbotu/database'
import { createAgentApiClient, runOnce, type AgentConfig } from '@hasarbotu/file-agent'
import { buildApp, hashPassword } from '../src/index.js'

const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'p25-sentetik-guclu-parola-42'
type PolicyOcrSourceReference = ReturnType<typeof policyOcrSourceReferenceResponseSchema.parse>['sourceReference']

async function syntheticScannedPdf(): Promise<Buffer> {
  const canvas = createCanvas(1_500, 2_100)
  const context = canvas.getContext('2d')
  context.fillStyle = 'white'
  context.fillRect(0, 0, 1_500, 2_100)
  context.fillStyle = 'black'
  context.font = 'bold 72px Arial'
  context.fillText('KASKO POLİÇESİ CAM TEMİNATI', 80, 180)
  context.font = '48px Arial'
  context.fillText('Muafiyet kontrol gerektirir', 80, 300)

  const image = await loadImage(canvas.toBuffer('image/png'))
  const pdf = new PDFDocument({ rasterDPI: 144 })
  const page = pdf.beginPage(750, 1_050)
  ;(page as unknown as { drawImage: (...args: unknown[]) => void }).drawImage(image, 0, 0, 750, 1_050)
  pdf.endPage()
  return pdf.close()
}

describeDb('yerel poliçe OCR API + gerçek File Agent (gerçek PostgreSQL)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let baseUrl: string
  let root: string
  let organizationId: string
  let otherOrganizationId: string
  let caseId: string
  let trafficCaseId: string
  let documentId: string
  let documentVersionId: string
  let trafficDocumentId: string
  let trafficVersionId: string
  let extractionId: string
  let ocrRunId: string
  let adminCookie: string
  let managerCookie: string
  let secretaryCookie: string
  let otherCookie: string
  let client: ReturnType<typeof createAgentApiClient>
  let agentConfig: AgentConfig
  let sourceReference: PolicyOcrSourceReference
  let ocrChunkFailure: { readonly status: number; readonly body: unknown } | undefined

  async function seedUser(orgId: string, email: string, role: 'admin' | 'case_manager' | 'secretary') {
    const id = uuidv7()
    await pool.query(
      'INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,$5)',
      [id, orgId, email, email, await hashPassword(PASSWORD)],
    )
    await pool.query(
      'INSERT INTO user_roles (user_id,role_id) VALUES ($1,(SELECT id FROM roles WHERE code=$2))',
      [id, role],
    )
    return id
  }

  async function login(email: string) {
    const response = await app.inject({
      method: 'POST',
      url: AUTH_LOGIN_ROUTE,
      payload: { email, password: PASSWORD },
    })
    expect(response.statusCode).toBe(200)
    return String(response.headers['set-cookie']).split(';')[0] as string
  }

  async function seedPolicy(targetCaseId: string, relativePath: string, pdf: Buffer) {
    const docId = uuidv7()
    const versionId = uuidv7()
    const hash = createHash('sha256').update(pdf).digest('hex')
    await pool.query(
      "INSERT INTO documents (id,organization_id,case_id,document_type,status) VALUES ($1,$2,$3,'casco_policy','ready')",
      [docId, organizationId, targetCaseId],
    )
    await pool.query(
      `INSERT INTO document_versions
        (id,organization_id,document_id,case_id,version_number,original_file_name,display_name,mime_type,extension,byte_size,content_hash,storage_root_key,relative_path,source_type,status,hash_verified,size_verified,verified_at)
       VALUES ($1,$2,$3,$4,1,'sentetik-taranmis-police.pdf','Sentetik Taranmış Kasko Poliçesi','application/pdf','pdf',$5,$6,'test-root',$7,'manual','ready',true,true,now())`,
      [versionId, organizationId, docId, targetCaseId, pdf.length, hash, relativePath],
    )
    await pool.query(
      'UPDATE documents SET current_version_id=$1,current_version_number=1 WHERE id=$2',
      [versionId, docId],
    )
    return { docId, versionId }
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    organizationId = uuidv7()
    otherOrganizationId = uuidv7()
    await pool.query(
      'INSERT INTO organizations (id,code,name) VALUES ($1,$2,$3),($4,$5,$6)',
      [organizationId, 'p25-main', 'P25 Main', otherOrganizationId, 'p25-other', 'P25 Other'],
    )
    await seedUser(organizationId, 'p25-admin@test.local', 'admin')
    await seedUser(organizationId, 'p25-manager@test.local', 'case_manager')
    await seedUser(organizationId, 'p25-secretary@test.local', 'secretary')
    await seedUser(otherOrganizationId, 'p25-other@test.local', 'admin')
    await pool.query(
      "INSERT INTO storage_roots (id,organization_id,root_key,label) VALUES ($1,$2,'test-root','Sentetik Root')",
      [uuidv7(), organizationId],
    )

    caseId = uuidv7()
    trafficCaseId = uuidv7()
    await pool.query(
      `INSERT INTO cases
        (id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,plate,plate_normalized,notification_date)
       VALUES
        ($1,$3,2026,2501,'2026/2501','casco','new_notification','34 P 2501','34P2501','2026-07-15'),
        ($2,$3,2026,2502,'2026/2502','traffic','new_notification','34 P 2502','34P2502','2026-07-15')`,
      [caseId, trafficCaseId, organizationId],
    )

    const pdf = await syntheticScannedPdf()
    root = await mkdtemp(join(tmpdir(), 'hb-p25-api-'))
    await mkdir(join(root, 'EVRAK'))
    await writeFile(join(root, 'EVRAK', 'policy.pdf'), pdf)
    await writeFile(join(root, 'EVRAK', 'traffic-policy.pdf'), pdf)
    ;({ docId: documentId, versionId: documentVersionId } = await seedPolicy(caseId, 'EVRAK/policy.pdf', pdf))
    ;({ docId: trafficDocumentId, versionId: trafficVersionId } = await seedPolicy(trafficCaseId, 'EVRAK/traffic-policy.pdf', pdf))

    app = buildApp({
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 1_000, windowMs: 60_000 } },
    })
    adminCookie = await login('p25-admin@test.local')
    managerCookie = await login('p25-manager@test.local')
    secretaryCookie = await login('p25-secretary@test.local')
    otherCookie = await login('p25-other@test.local')

    const registered = await app.inject({
      method: 'POST',
      url: AGENTS_ROUTE,
      headers: { cookie: adminCookie },
      payload: { name: 'P25 Yerel OCR Agent' },
    })
    expect(registered.statusCode).toBe(201)
    const agent = registered.json() as { agent: { id: string }; secret: string }

    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.addresses()[0]!
    baseUrl = `http://127.0.0.1:${address.port}`
    agentConfig = {
      apiBaseUrl: baseUrl,
      agentId: agent.agent.id,
      agentSecret: agent.secret,
      roots: { 'test-root': root },
      leaseSeconds: 120,
      pollIntervalMs: 1_000,
      freshnessGate: undefined,
    }
    const inspectedFetch: typeof fetch = async (input, init) => {
      const response = await fetch(input, init)
      if (!response.ok && String(input).includes('/ocr-chunks')) {
        ocrChunkFailure = { status: response.status, body: await response.clone().json() }
      }
      return response
    }
    client = createAgentApiClient({
      baseUrl,
      agentId: agent.agent.id,
      secret: agent.secret,
      fetchImpl: inspectedFetch,
    })
  }, 60_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  }, 10_000)

  it('Package 24 image-only kaynağını üretir; 401/403, Kasko uygunluğu ve idempotency sınırlarını uygular', async () => {
    const extractionRoute = `/api/v1/cases/${caseId}/documents/${documentId}/versions/${documentVersionId}/text-extractions`
    const extractionResponse = await app.inject({
      method: 'POST',
      url: extractionRoute,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {},
    })
    expect(extractionResponse.statusCode, extractionResponse.payload).toBe(201)
    extractionId = pdfTextExtractionResponseSchema.parse(extractionResponse.json()).extraction.id
    const extractionResult = await runOnce(client, agentConfig)
    expect(extractionResult.kind).toBe('reported')
    if (extractionResult.kind === 'reported') expect(extractionResult.reported.status).toBe('succeeded')

    const extractionDetail = await app.inject({
      method: 'GET',
      url: `/api/v1/cases/${caseId}/text-extractions/${extractionId}`,
      headers: { cookie: adminCookie },
    })
    const extraction = pdfTextExtractionResponseSchema.parse(extractionDetail.json()).extraction
    expect(extraction).toMatchObject({ status: 'ocr_required', pageCount: 1, imageOnlyPageCount: 1 })

    const route = `/api/v1/cases/${caseId}/documents/${documentId}/versions/${documentVersionId}/ocr-runs`
    const payload = { textExtractionId: extractionId, languageMode: 'tur+eng' }
    expect((await app.inject({
      method: 'POST',
      url: route,
      headers: { [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload,
    })).statusCode).toBe(401)
    expect((await app.inject({
      method: 'POST',
      url: route,
      headers: { cookie: secretaryCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload,
    })).statusCode).toBe(403)

    const trafficRoute = `/api/v1/cases/${trafficCaseId}/documents/${trafficDocumentId}/versions/${trafficVersionId}/ocr-runs`
    const traffic = await app.inject({
      method: 'POST',
      url: trafficRoute,
      headers: { cookie: adminCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload,
    })
    expect(traffic.statusCode).toBe(404)

    const key = uuidv7()
    const first = await app.inject({
      method: 'POST',
      url: route,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: key },
      payload,
    })
    expect(first.statusCode, first.payload).toBe(201)
    const created = policyOcrRunResponseSchema.parse(first.json())
    expect(created.ocrRun).toMatchObject({ status: 'queued', engineVersion: '7.0.0', languageMode: 'tur+eng', renderProfile: 'standard', renderProfileVersion: 'policy-ocr-render-standard/1.0.0', locatorVersion: 'policy-ocr-locator/1.0.0' })
    ocrRunId = created.ocrRun.id

    const replay = await app.inject({
      method: 'POST',
      url: route,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: key },
      payload,
    })
    expect(replay.statusCode).toBe(201)
    expect(replay.json()).toEqual(first.json())
    expect((await pool.query(
      'SELECT count(*)::int AS n FROM document_ocr_runs WHERE document_version_id=$1',
      [documentVersionId],
    )).rows).toEqual([{ n: 1 }])
  }, 60_000)

  it('canlı API üzerinden claim→yerel OCR→chunk→server doğrulama→finalize çalışır', async () => {
    const result = await runOnce(client, agentConfig)
    expect(result, JSON.stringify(ocrChunkFailure)).toMatchObject({ kind: 'reported', outcome: 'verified' })
    if (result.kind === 'reported') {
      expect(result.reported.status, JSON.stringify(ocrChunkFailure)).toBe('succeeded')
    }

    const detailResponse = await fetch(`${baseUrl}/api/v1/cases/${caseId}/ocr-runs/${ocrRunId}`, {
      headers: { cookie: adminCookie },
    })
    expect(detailResponse.status).toBe(200)
    const detail = policyOcrRunResponseSchema.parse(await detailResponse.json())
    expect(detail.ocrRun).toMatchObject({
      status: 'ready',
      engineName: 'tesseract.js',
      engineVersion: '7.0.0',
      languageDataVersion: 'tessdata-4.0.0-full/1.0.0',
      renderProfileVersion: 'policy-ocr-render-standard/1.0.0',
      locatorVersion: 'policy-ocr-locator/1.0.0',
      eligiblePageCount: 1,
      processedPageCount: 1,
      readyPageCount: 1,
    })
    expect(detail.ocrRun.blockCount).toBeGreaterThan(0)
    expect(detail.ocrRun.lineCount).toBeGreaterThan(0)
    expect(detail.ocrRun.wordCount).toBeGreaterThan(0)

    const pagesResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/cases/${caseId}/ocr-runs/${ocrRunId}/pages?page=1&pageSize=20`,
      headers: { cookie: adminCookie },
    })
    expect(pagesResponse.statusCode, pagesResponse.payload).toBe(200)
    const pages = policyOcrPagesResponseSchema.parse(pagesResponse.json())
    expect(pages.items[0]).toMatchObject({ pageNumber: 1, status: 'accepted_candidate', qualityStatus: 'high', readingOrderQuality: 'reliable', compositeStatus: 'ocr_only' })
    expect(pages.items[0]?.rawOcrText.length).toBeGreaterThan(0)
    expect(pages.items[0]?.normalizedText).toMatch(/KASKO POL[İI][ÇC]ES[İI]/)

    const elementsResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/cases/${caseId}/ocr-runs/${ocrRunId}/elements?page=1&pageSize=100&type=line`,
      headers: { cookie: adminCookie },
    })
    expect(elementsResponse.statusCode, elementsResponse.payload).toBe(200)
    const elements = policyOcrElementsResponseSchema.parse(elementsResponse.json())
    const line = elements.items.find((item) => item.text.includes('KASKO'))
    expect(line).toBeDefined()
    expect(line?.bbox.width).toBeGreaterThan(0)

    const referenceResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/ocr-runs/${ocrRunId}/source-reference`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        sourceKey: 'OCR_S1',
        pageId: line!.pageId,
        blockId: line!.parentId,
        lineId: line!.id,
        wordId: null,
        startOffset: line!.startOffset,
        endOffset: line!.endOffset,
        sectionHeading: 'Kasko Poliçesi',
        clauseIdentifier: 'OCR-1',
        sourceType: 'policy',
        confidence: 0.95,
      },
    })
    expect(referenceResponse.statusCode, referenceResponse.payload).toBe(201)
    sourceReference = policyOcrSourceReferenceResponseSchema.parse(referenceResponse.json()).sourceReference
    expect(sourceReference).toMatchObject({
      documentId,
      documentVersionId,
      pageNumber: 1,
      extractionLocator: null,
      ocrLocator: {
        ocrRunId,
        pageId: line!.pageId,
        blockId: line!.parentId,
        lineId: line!.id,
        wordId: null,
        startOffset: line!.startOffset,
        endOffset: line!.endOffset,
        engineVersion: '7.0.0',
        languageDataVersion: 'tessdata-4.0.0-full/1.0.0',
        locatorVersion: 'policy-ocr-locator/1.0.0',
        qualityStatus: 'high',
        readingOrderQuality: 'reliable',
        bbox: line!.bbox,
      },
    })
  }, 60_000)

  it('OCR kanıtını policy analysis sürümüne bağlar; tenant ve sızıntı sınırlarını korur', async () => {
    const analysisPayload = {
      sourceDocumentId: documentId,
      sourceDocumentVersionId: documentVersionId,
      insurerId: null,
      policyNumber: null,
      endorsementNumber: null,
      productName: 'Sentetik OCR Poliçesi',
      productType: null,
      insurerFormat: 'local-ocr-v1',
      policyStartDate: null,
      policyEndDate: null,
      issueDate: null,
      insuredVehicleReference: null,
      sourceCompleteness: 'complete',
      initialStatus: 'draft',
      sourceReferences: [sourceReference],
      coverages: [{
        code: 'COLLISION',
        canonicalType: 'collision',
        originalHeading: 'Çarpışma',
        originalWording: 'Sentetik OCR kanıtına bağlı teminat.',
        inclusion: 'included',
        limit: null,
        conditions: [],
        exceptions: [],
        requiredDocuments: [],
        sourceKeys: ['OCR_S1'],
        confidence: 0.95,
      }],
      deductibles: [],
      serviceRules: [],
      partRules: [],
      replacementVehicleRules: [],
      exclusions: [],
      requiredDocuments: [],
      scenarioRules: [],
      conflicts: [],
    }
    const analysisResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/policy-analyses`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: analysisPayload,
    })
    expect(analysisResponse.statusCode, analysisResponse.payload).toBe(201)
    const analysis = policyAnalysisResponseSchema.parse(analysisResponse.json())
    expect(analysis.analysis.currentVersion.sourceReferences[0]?.ocrLocator).toMatchObject({ ocrRunId })

    expect((await app.inject({
      method: 'GET',
      url: `/api/v1/cases/${caseId}/ocr-runs/${ocrRunId}`,
      headers: { cookie: otherCookie },
    })).statusCode).toBe(404)

    const audit = await pool.query(
      "SELECT action,details::text AS details FROM audit_events WHERE resource_type='document_ocr_run' AND resource_id=$1 ORDER BY occurred_at",
      [ocrRunId],
    )
    const serialized = JSON.stringify({ analysis, audit: audit.rows })
    expect(serialized).not.toContain(root)
    expect(serialized).not.toMatch(/[A-Z]:\\|password|secret|traineddata/i)
    expect(JSON.stringify(audit.rows)).not.toContain(sourceReference.rawExcerpt)
  })
})
