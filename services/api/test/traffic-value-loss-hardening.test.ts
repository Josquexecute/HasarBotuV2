import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AUTH_LOGIN_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  localDateSchema,
  trafficValueLossClosureListResponseSchema,
  trafficValueLossPreviewResponseSchema,
  trafficValueLossReportPreviewResponseSchema,
  trafficValueLossResponseSchema,
  trafficValueLossVersionsResponseSchema,
  type TrafficValueLossAssessmentDto,
  type TrafficValueLossPreviewRequest,
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
const PASSWORD = 'p66-hardening-sentetik-parola-42'
const CONTENT_HASH = 'a'.repeat(64)

interface SeededCase {
  readonly caseId: string
  readonly documentId: string
  readonly documentVersionId: string
  readonly stableRuleId: string
  readonly lossDate: string | null
}

describeDb('Paket 66 Değer Kaybı sertleştirme (gerçek PostgreSQL)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let organizationId: string
  let otherOrganizationId: string
  let managerUserId: string
  let adminCookie: string
  let managerCookie: string
  let secretaryCookie: string
  let otherCookie: string
  let sequence = 6600

  async function seedUser(
    orgId: string,
    email: string,
    role: 'admin' | 'case_manager' | 'secretary',
  ): Promise<string> {
    const userId = uuidv7()
    await pool.query(
      'INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,$5)',
      [userId, orgId, email, email, await hashPassword(PASSWORD)],
    )
    await pool.query(
      'INSERT INTO user_roles (user_id,role_id) VALUES ($1,(SELECT id FROM roles WHERE code=$2))',
      [userId, role],
    )
    return userId
  }

  async function login(email: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: AUTH_LOGIN_ROUTE,
      payload: { email, password: PASSWORD },
    })
    expect(response.statusCode, response.payload).toBe(200)
    return String(response.headers['set-cookie']).split(';')[0] as string
  }

  async function seedCase(options: {
    readonly lossDate?: string | null
    readonly closed?: boolean
    readonly organizationId?: string
  } = {}): Promise<SeededCase> {
    sequence += 1
    const caseId = uuidv7()
    const orgId = options.organizationId ?? organizationId
    const closed = options.closed ?? false
    const responsible = orgId === organizationId ? managerUserId : null
    await pool.query(
      `INSERT INTO cases
       (id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,
        workflow_stage,plate,plate_normalized,loss_date,notification_date,responsible_user_id,closed_at)
       VALUES ($1,$2,2026,$3,$4,'traffic',$5,$6,$7,$8,$9,'2026-07-02',$10,$11)`,
      [
        caseId,
        orgId,
        sequence,
        `2026/${sequence}`,
        closed ? 'closed' : 'open',
        closed ? 'closed' : 'reporting',
        `34 Z ${sequence}`,
        `34Z${sequence}`,
        options.lossDate === undefined ? '2026-07-01' : options.lossDate,
        responsible,
        closed ? '2026-07-20T12:00:00Z' : null,
      ],
    )
    const documentId = uuidv7()
    const documentVersionId = uuidv7()
    const registeredBy = orgId === organizationId ? managerUserId : null
    await pool.query(
      `INSERT INTO documents
       (id,organization_id,case_id,document_type,current_version_number,status)
       VALUES ($1,$2,$3,'expert_report',1,'ready')`,
      [documentId, orgId, caseId],
    )
    await pool.query(
      `INSERT INTO document_versions
       (id,organization_id,document_id,case_id,version_number,original_file_name,display_name,
        extension,mime_type,byte_size,content_hash,storage_root_key,relative_path,source_type,
        status,hash_verified,size_verified,verified_at,registered_by_user_id)
       VALUES ($1,$2,$3,$4,1,'sentetik.pdf','Sentetik','pdf','application/pdf',256,$5,
               'synthetic-root',$6,'manual','ready',true,true,'2026-07-15T08:00:00Z',$7)`,
      [
        documentVersionId,
        orgId,
        documentId,
        caseId,
        CONTENT_HASH,
        `sentetik/${caseId}/rapor.pdf`,
        registeredBy,
      ],
    )
    await pool.query(
      'UPDATE documents SET current_version_id=$2 WHERE id=$1',
      [documentId, documentVersionId],
    )
    const catalog = await app.inject({
      method: 'GET',
      url: `/api/v1/cases/${caseId}/traffic-value-loss/part-catalog?vehicleGroupCode=A`,
      headers: { cookie: orgId === organizationId ? managerCookie : otherCookie },
    })
    expect(catalog.statusCode, catalog.payload).toBe(200)
    const stableRuleId = String(
      (catalog.json() as { parts: Array<{ stableRuleId: string }> }).parts[0]?.stableRuleId,
    )
    return {
      caseId,
      documentId,
      documentVersionId,
      stableRuleId,
      lossDate: options.lossDate === undefined ? '2026-07-01' : options.lossDate,
    }
  }

  function request(
    seeded: SeededCase,
    expectedVersion: number,
    overrides: Partial<TrafficValueLossPreviewRequest> = {},
  ): TrafficValueLossPreviewRequest {
    const base: TrafficValueLossPreviewRequest = {
      expectedVersion,
      evaluatedOn: localDateSchema.parse('2026-07-16'),
      heavyOrTotalDamage: false,
      vehicle: {
        make: 'Sentetik',
        model: 'Model',
        variant: null,
        modelYear: 2026,
        mileage: 50_000,
        usageType: 'hususi',
      },
      faultRateBasisPoints: null,
      preAccidentMarketValueMinor: null,
      postRepairMarketValueMinor: null,
      damageParts: [],
      evidence: [{
        evidenceKey: 'expert',
        sourceType: 'document_version',
        documentId: seeded.documentId,
        documentVersionId: seeded.documentVersionId,
        externalReference: null,
        sourceHash: CONTENT_HASH,
        observedAt: null,
        supports: [
          'vehicle_identity',
          'mileage',
          'usage_type',
          'damage_parts',
          'prior_damage',
          'heavy_damage_status',
        ],
        verificationStatus: 'verified',
        conflict: false,
        notes: null,
      }, {
        evidenceKey: 'market',
        sourceType: 'market_comparable',
        documentId: null,
        documentVersionId: null,
        externalReference: 'ref:p66-market',
        sourceHash: 'b'.repeat(64),
        observedAt: localDateSchema.parse('2026-07-10'),
        supports: ['pre_accident_market_value'],
        verificationStatus: 'verified',
        conflict: false,
        notes: null,
      }],
      comparables: Array.from({ length: 3 }, (_, index) => ({
        comparableKey: `pre-${index}`,
        side: 'pre_accident',
        amountMinor: 100_000_000 + index,
        mileage: 50_000 + index,
        observedAt: localDateSchema.parse('2026-07-10'),
        evidenceKey: 'market',
        excluded: false,
        exclusionReason: null,
      })),
      realMarket: {
        vehicleType: 'OTOMOBİL',
        vehicleGroupCode: 'A',
        usageMetric: 'mileage',
        usageValue: 50_000,
        commercialOrRental: false,
        previousDamageCount: 0,
        marketValueMinor: 100_000_000,
        damageAmountMinor: 10_000_000,
        parts: [{
          stableRuleId: seeded.stableRuleId,
          operation: 'replacement',
          paintMode: null,
          newPartPriceMinor: null,
          repairLaborMinor: null,
          partPriceAvailability: 'unavailable',
          priorPartState: 'none',
          treatment: 'standard',
        }],
        eligibilityFacts: {
          antiqueOrCollector: false,
          priorHeavyDamage: false,
          currentHeavyOrTotalDamage: false,
          foreignPlate: false,
          foreignMarketEvidenceVerified: false,
        },
        prefillProvenance: seeded.lossDate === null ? [] : [{
          field: 'accidentDate',
          source: 'case',
          sourceRevisionId: null,
          originalValue: seeded.lossDate,
          newValue: seeded.lossDate,
          overrideReason: null,
        }],
      },
      ruleOverride: null,
      confirmedPreviewHash: null,
    }
    return { ...base, ...overrides }
  }

  async function preview(
    seeded: SeededCase,
    expectedVersion: number,
    overrides: Partial<TrafficValueLossPreviewRequest> = {},
    cookie = managerCookie,
  ) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/cases/${seeded.caseId}/traffic-value-loss/preview`,
      headers: { cookie },
      payload: request(seeded, expectedVersion, overrides),
    })
  }

  async function createDraft(
    seeded: SeededCase,
    expectedVersion: number,
    overrides: Partial<TrafficValueLossPreviewRequest> = {},
    cookie = managerCookie,
  ): Promise<TrafficValueLossAssessmentDto> {
    const previewResponse = await preview(seeded, expectedVersion, overrides, cookie)
    expect(previewResponse.statusCode, previewResponse.payload).toBe(200)
    const previewBody = trafficValueLossPreviewResponseSchema.parse(previewResponse.json())
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${seeded.caseId}/traffic-value-loss/versions`,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        ...request(seeded, expectedVersion, overrides),
        confirmedPreviewHash: previewBody.previewHash,
      },
    })
    expect(created.statusCode, created.payload).toBe(201)
    return trafficValueLossResponseSchema.parse(created.json()).assessment
  }

  async function submit(
    seeded: SeededCase,
    assessment: TrafficValueLossAssessmentDto,
    cookie = managerCookie,
  ): Promise<TrafficValueLossAssessmentDto> {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${seeded.caseId}/traffic-value-loss/versions/${assessment.currentVersion.id}/submit`,
      headers: { cookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedVersion: assessment.version },
    })
    expect(response.statusCode, response.payload).toBe(200)
    return trafficValueLossResponseSchema.parse(response.json()).assessment
  }

  async function approve(
    seeded: SeededCase,
    assessment: TrafficValueLossAssessmentDto,
  ): Promise<TrafficValueLossAssessmentDto> {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${seeded.caseId}/traffic-value-loss/versions/${assessment.currentVersion.id}/approve`,
      headers: { cookie: adminCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedVersion: assessment.version, reason: 'Sentetik kanıtlar incelendi.' },
    })
    expect(response.statusCode, response.payload).toBe(200)
    return trafficValueLossResponseSchema.parse(response.json()).assessment
  }

  async function reject(
    seeded: SeededCase,
    assessment: TrafficValueLossAssessmentDto,
  ): Promise<TrafficValueLossAssessmentDto> {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${seeded.caseId}/traffic-value-loss/versions/${assessment.currentVersion.id}/reject`,
      headers: { cookie: adminCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedVersion: assessment.version, reason: 'Yeni emsal incelemesi gerekli.' },
    })
    expect(response.statusCode, response.payload).toBe(200)
    return trafficValueLossResponseSchema.parse(response.json()).assessment
  }

  async function generateReport(
    seeded: SeededCase,
    assessment: TrafficValueLossAssessmentDto,
  ): Promise<string> {
    const reportPreview = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${seeded.caseId}/traffic-value-loss/versions/${assessment.currentVersion.id}/report-preview`,
      headers: { cookie: managerCookie },
      payload: { expectedAssessmentVersion: assessment.version, reportNote: null },
    })
    expect(reportPreview.statusCode, reportPreview.payload).toBe(200)
    const previewBody = trafficValueLossReportPreviewResponseSchema.parse(reportPreview.json())
    const generated = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${seeded.caseId}/traffic-value-loss/versions/${assessment.currentVersion.id}/reports`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        expectedAssessmentVersion: assessment.version,
        reportNote: null,
        confirmed: true,
        previewHash: previewBody.previewHash,
      },
    })
    expect(generated.statusCode, generated.payload).toBe(201)
    return String((generated.json() as { report: { id: string } }).report.id)
  }

  async function closureStatus(caseId: string): Promise<{
    readonly status: string
    readonly assessmentVersionId: string | null
    readonly reportId: string | null
  }> {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/traffic-value-loss/closure-summaries',
      headers: { cookie: managerCookie },
    })
    expect(response.statusCode, response.payload).toBe(200)
    const item = trafficValueLossClosureListResponseSchema.parse(response.json()).items
      .find((candidate) => candidate.caseId === caseId)
    if (item === undefined) throw new Error('TEST_CLOSURE_SUMMARY_MISSING')
    return item.summary
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    organizationId = uuidv7()
    otherOrganizationId = uuidv7()
    await pool.query(
      "INSERT INTO organizations (id,code,name) VALUES ($1,'p66-hardening','P66 Hardening'),($2,'p66-other','P66 Other')",
      [organizationId, otherOrganizationId],
    )
    await seedUser(organizationId, 'p66-admin@test.local', 'admin')
    managerUserId = await seedUser(organizationId, 'p66-manager@test.local', 'case_manager')
    await seedUser(organizationId, 'p66-secretary@test.local', 'secretary')
    await seedUser(otherOrganizationId, 'p66-other@test.local', 'admin')
    app = buildApp({
      clock: fixedClock('2026-07-23T12:00:00.000Z'),
      loggerEnabled: false,
      auth: { pool, cookieSecure: false, loginRateLimit: { limit: 100, windowMs: 60_000 } },
    })
    adminCookie = await login('p66-admin@test.local')
    managerCookie = await login('p66-manager@test.local')
    secretaryCookie = await login('p66-secretary@test.local')
    otherCookie = await login('p66-other@test.local')
  }, 60_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  it('preview hash canonical, tenant/case bağlı ve stale/missing hash için fail-closed çalışır', async () => {
    const firstCase = await seedCase()
    const secondCase = await seedCase()
    const base = request(firstCase, 0)
    const first = trafficValueLossPreviewResponseSchema.parse((await preview(firstCase, 0)).json())
    const reordered = await preview(firstCase, 0, {
      evidence: [...base.evidence].reverse().map((item) => ({
        ...item,
        supports: [...item.supports].reverse(),
      })),
      comparables: [...base.comparables].reverse(),
      realMarket: base.realMarket === null ? null : {
        ...base.realMarket,
        parts: [...base.realMarket.parts].reverse(),
        prefillProvenance: [...base.realMarket.prefillProvenance].reverse(),
      },
    })
    expect(trafficValueLossPreviewResponseSchema.parse(reordered.json()).previewHash)
      .toBe(first.previewHash)
    const changed = await preview(firstCase, 0, {
      realMarket: base.realMarket === null ? null : {
        ...base.realMarket,
        damageAmountMinor: 10_000_001,
      },
    })
    expect(trafficValueLossPreviewResponseSchema.parse(changed.json()).previewHash)
      .not.toBe(first.previewHash)
    const evidenceChanged = await preview(firstCase, 0, {
      evidence: base.evidence.map((item) =>
        item.evidenceKey === 'market' ? { ...item, sourceHash: 'c'.repeat(64) } : item),
    })
    expect(trafficValueLossPreviewResponseSchema.parse(evidenceChanged.json()).previewHash)
      .not.toBe(first.previewHash)

    for (const confirmedPreviewHash of [null, 'f'.repeat(64)]) {
      const rejected = await app.inject({
        method: 'POST',
        url: `/api/v1/cases/${firstCase.caseId}/traffic-value-loss/versions`,
        headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
        payload: { ...base, confirmedPreviewHash },
      })
      expect(rejected.statusCode).toBe(409)
      expect(rejected.json()).toMatchObject({ error: { code: 'traffic_value_loss_preview_stale' } })
    }

    const secondPreview = trafficValueLossPreviewResponseSchema.parse(
      (await preview(secondCase, 0)).json(),
    )
    expect((await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${firstCase.caseId}/traffic-value-loss/versions`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { ...base, confirmedPreviewHash: secondPreview.previewHash },
    })).statusCode).toBe(409)
    expect((await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${firstCase.caseId}/traffic-value-loss/preview`,
      headers: { cookie: otherCookie },
      payload: base,
    })).statusCode).toBe(404)

    const override = {
      ruleIdentity: 'real-market-analysis/2026-07-01/1.0.0' as const,
      reason: 'Yönetici tarih ve kaynak sürümünü doğruladı.',
    }
    expect((await preview(firstCase, 0, { ruleOverride: override }, managerCookie)).statusCode)
      .toBe(403)
    const overridePreview = await preview(firstCase, 0, { ruleOverride: override }, adminCookie)
    expect(overridePreview.statusCode).toBe(200)
    expect(trafficValueLossPreviewResponseSchema.parse(overridePreview.json()).previewHash)
      .not.toBe(first.previewHash)
  })

  it('eksik tarih/kural/girdi/kanıt/provenance ve desteklenmeyen katalog işlemlerinde tahmin yapmaz', async () => {
    const missingDate = await seedCase({ lossDate: null })
    const missingDateResponse = await preview(missingDate, 0)
    expect(missingDateResponse.statusCode, missingDateResponse.payload).toBe(409)
    expect(missingDateResponse.json()).toMatchObject({
      error: { code: 'traffic_value_loss_rule_selection_required' },
    })

    const seeded = await seedCase()
    expect((await preview(seeded, 0, { realMarket: null })).statusCode).toBe(409)
    const base = request(seeded, 0)
    const missingEvidence = await preview(seeded, 0, {
      evidence: [base.evidence[0]!],
      comparables: [],
      realMarket: base.realMarket === null ? null : {
        ...base.realMarket,
        vehicleGroupCode: 'B',
        parts: [{ ...base.realMarket.parts[0]!, operation: 'paint', paintMode: null }],
      },
    })
    expect(missingEvidence.statusCode, missingEvidence.payload).toBe(200)
    expect(trafficValueLossPreviewResponseSchema.parse(missingEvidence.json()).evaluation)
      .toMatchObject({
        eligibility: 'control_required',
        canSubmitForApproval: false,
      })
    const invalidProvenance = await preview(seeded, 0, {
      realMarket: base.realMarket === null ? null : {
        ...base.realMarket,
        prefillProvenance: [{
          field: 'marketValueMinor',
          source: 'approved_market_value',
          sourceRevisionId: uuidv7(),
          originalValue: 1,
          newValue: 1,
          overrideReason: null,
        }],
      },
    })
    expect(invalidProvenance.statusCode).toBe(400)
    expect(invalidProvenance.json()).toMatchObject({
      error: { code: 'traffic_value_loss_source_invalid' },
    })
    const wrongHash = await preview(seeded, 0, {
      evidence: base.evidence.map((item) =>
        item.sourceType === 'document_version' ? { ...item, sourceHash: 'f'.repeat(64) } : item),
    })
    expect(wrongHash.statusCode).toBe(400)
  })

  it('revision yaşam döngüsünü, concurrent conflict ve immutable geçmişi gerçek persistence ile korur', async () => {
    const seeded = await seedCase()
    const draft = await createDraft(seeded, 0)
    const submitRequests = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/v1/cases/${seeded.caseId}/traffic-value-loss/versions/${draft.currentVersion.id}/submit`,
        headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
        payload: { expectedVersion: draft.version },
      }),
      app.inject({
        method: 'POST',
        url: `/api/v1/cases/${seeded.caseId}/traffic-value-loss/versions/${draft.currentVersion.id}/submit`,
        headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
        payload: { expectedVersion: draft.version },
      }),
    ])
    expect(submitRequests.map((item) => item.statusCode).sort()).toEqual([200, 409])
    const submitted = trafficValueLossResponseSchema.parse(
      submitRequests.find((item) => item.statusCode === 200)!.json(),
    ).assessment

    expect((await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${seeded.caseId}/traffic-value-loss/versions/${draft.currentVersion.id}/approve`,
      headers: { cookie: secretaryCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedVersion: submitted.version, reason: 'Yetkisiz.' },
    })).statusCode).toBe(403)
    const approveRequests = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/v1/cases/${seeded.caseId}/traffic-value-loss/versions/${draft.currentVersion.id}/approve`,
        headers: { cookie: adminCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
        payload: { expectedVersion: submitted.version, reason: 'Birinci eşzamanlı onay.' },
      }),
      app.inject({
        method: 'POST',
        url: `/api/v1/cases/${seeded.caseId}/traffic-value-loss/versions/${draft.currentVersion.id}/approve`,
        headers: { cookie: adminCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
        payload: { expectedVersion: submitted.version, reason: 'İkinci eşzamanlı onay.' },
      }),
    ])
    expect(approveRequests.map((item) => item.statusCode).sort()).toEqual([200, 409])
    const approved = trafficValueLossResponseSchema.parse(
      approveRequests.find((item) => item.statusCode === 200)!.json(),
    ).assessment
    await expect(pool.query(
      "UPDATE traffic_value_loss_versions SET result_code='control_required' WHERE id=$1",
      [approved.currentVersion.id],
    )).rejects.toMatchObject({ code: '23001' })
    await expect(pool.query(
      'DELETE FROM traffic_value_loss_versions WHERE id=$1',
      [approved.currentVersion.id],
    )).rejects.toMatchObject({ code: expect.stringMatching(/^(23001|23503)$/) })

    const secondDraft = await createDraft(seeded, approved.version)
    const approvedWhileDraft = await app.inject({
      method: 'GET',
      url: `/api/v1/cases/${seeded.caseId}/traffic-value-loss/current-approved`,
      headers: { cookie: managerCookie },
    })
    expect(approvedWhileDraft.json()).toMatchObject({
      version: { id: approved.currentVersion.id },
    })
    const rejected = await reject(seeded, await submit(seeded, secondDraft))
    expect(rejected.currentVersion.status).toBe('rejected')
    const thirdDraft = await createDraft(seeded, rejected.version)
    const thirdApproved = await approve(seeded, await submit(seeded, thirdDraft))
    expect((await app.inject({
      method: 'GET',
      url: `/api/v1/cases/${seeded.caseId}/traffic-value-loss/current-approved`,
      headers: { cookie: managerCookie },
    })).json()).toMatchObject({
      version: { id: thirdApproved.currentVersion.id },
    })

    const history = trafficValueLossVersionsResponseSchema.parse((await app.inject({
      method: 'GET',
      url: `/api/v1/cases/${seeded.caseId}/traffic-value-loss/versions`,
      headers: { cookie: managerCookie },
    })).json()).versions
    expect(history.map((item) => item.assessmentVersion)).toEqual([3, 2, 1])
    expect(history.map((item) => item.status)).toEqual(['approved', 'rejected', 'superseded'])
    const firstEvaluation = history[2]?.evaluation
    const approvedEvaluation = approved.currentVersion.evaluation
    expect(firstEvaluation?.ruleSetId).toBe('real-market-analysis')
    expect(approvedEvaluation.ruleSetId).toBe('real-market-analysis')
    if (firstEvaluation?.ruleSetId !== 'real-market-analysis'
      || approvedEvaluation.ruleSetId !== 'real-market-analysis') {
      throw new Error('TEST_REAL_MARKET_EVALUATION_REQUIRED')
    }
    expect(firstEvaluation.finalResultMinor).toBe(approvedEvaluation.finalResultMinor)
    expect(new Set(history.map((item) => item.revisionId)).size).toBe(3)
    expect(new Set(history.map((item) => item.calculationId))).toEqual(new Set([approved.id]))

    const otherCase = await seedCase()
    expect((await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${otherCase.caseId}/traffic-value-loss/versions/${thirdApproved.currentVersion.id}/submit`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedVersion: thirdApproved.version },
    })).statusCode).toBe(404)

    const audit = await pool.query(
      `SELECT organization_id,actor_user_id,resource_id,details
       FROM audit_events
       WHERE organization_id=$1 AND resource_id=$2
       ORDER BY occurred_at,id`,
      [organizationId, approved.id],
    )
    expect(audit.rows.length).toBeGreaterThanOrEqual(7)
    expect(audit.rows.every((row: Record<string, unknown>) =>
      row.organization_id === organizationId
      && typeof row.actor_user_id === 'string'
      && row.resource_id === approved.id
      && (row.details as { caseId?: string }).caseId === seeded.caseId,
    )).toBe(true)
    expect(JSON.stringify(audit.rows)).toContain(thirdApproved.currentVersion.id)
    await expect(pool.query(
      "UPDATE audit_events SET action='mutated' WHERE resource_id=$1",
      [approved.id],
    )).rejects.toMatchObject({ code: '23001' })
  }, 30_000)

  it('Paket 40 yalnız aktif insan onaylı revision ve aynı revision nihai raporunu okur', async () => {
    const noCalculation = await seedCase({ closed: true })
    expect((await closureStatus(noCalculation.caseId)).status).toBe('control_required')

    const draft = await createDraft(noCalculation, 0)
    expect((await closureStatus(noCalculation.caseId)).status).toBe('control_required')
    const submitted = await submit(noCalculation, draft)
    expect((await closureStatus(noCalculation.caseId)).status).toBe('control_required')
    const rejected = await reject(noCalculation, submitted)
    expect((await closureStatus(noCalculation.caseId)).status).toBe('control_required')

    const nextDraft = await createDraft(noCalculation, rejected.version)
    const approved = await approve(noCalculation, await submit(noCalculation, nextDraft))
    expect((await closureStatus(noCalculation.caseId)).status).toBe('control_required')
    const firstReportId = await generateReport(noCalculation, approved)
    expect(await closureStatus(noCalculation.caseId)).toEqual(expect.objectContaining({
      status: 'present',
      assessmentVersionId: approved.currentVersion.id,
      reportId: firstReportId,
    }))

    const newerDraft = await createDraft(noCalculation, approved.version)
    expect(await closureStatus(noCalculation.caseId)).toEqual(expect.objectContaining({
      status: 'present',
      assessmentVersionId: approved.currentVersion.id,
      reportId: firstReportId,
    }))
    const newerSubmitted = await submit(noCalculation, newerDraft)
    expect((await closureStatus(noCalculation.caseId)).assessmentVersionId)
      .toBe(approved.currentVersion.id)
    const newerRejected = await reject(noCalculation, newerSubmitted)
    expect((await closureStatus(noCalculation.caseId)).assessmentVersionId)
      .toBe(approved.currentVersion.id)

    const finalDraft = await createDraft(noCalculation, newerRejected.version, {
      realMarket: request(noCalculation, newerRejected.version).realMarket === null
        ? null
        : {
            ...request(noCalculation, newerRejected.version).realMarket!,
            damageAmountMinor: 20_000_000,
          },
    })
    const finalApproved = await approve(noCalculation, await submit(noCalculation, finalDraft))
    expect((await closureStatus(noCalculation.caseId)).status).toBe('control_required')
    const finalReportId = await generateReport(noCalculation, finalApproved)
    expect(await closureStatus(noCalculation.caseId)).toEqual(expect.objectContaining({
      status: 'present',
      assessmentVersionId: finalApproved.currentVersion.id,
      reportId: finalReportId,
    }))

    const foreign = await seedCase({ closed: true, organizationId: otherOrganizationId })
    const list = trafficValueLossClosureListResponseSchema.parse((await app.inject({
      method: 'GET',
      url: '/api/v1/traffic-value-loss/closure-summaries',
      headers: { cookie: managerCookie },
    })).json())
    expect(list.items.some((item) => item.caseId === foreign.caseId)).toBe(false)
    expect((await app.inject({
      method: 'GET',
      url: `/api/v1/cases/${noCalculation.caseId}/traffic-value-loss/current-approved`,
      headers: { cookie: otherCookie },
    })).statusCode).toBe(404)

    await expect(runMigrations({
      databaseUrl: config.url,
      direction: 'down',
      // 0044 Paket 65B en yeni migration'dır; 0043 rollback guard'ına ulaş.
      count: 2,
      quiet: true,
    })).rejects.toThrow('real market value loss revisions must be removed before rollback')
    const migrationState = await pool.query(
      `SELECT count(*)::int AS n FROM pgmigrations
       WHERE name='0043_traffic_value_loss_real_market_revision'`,
    )
    expect(migrationState.rows[0].n).toBe(1)
    expect(Number((await pool.query(
      'SELECT count(*) AS n FROM traffic_value_loss_reports WHERE id=$1',
      [finalReportId],
    )).rows[0].n)).toBe(1)
    const restored = await runMigrations({ databaseUrl: config.url, quiet: true })
    expect(restored.map((migration) => migration.name))
      .toEqual(['0044_labor_workbook_apply_runtime'])
  }, 40_000)

  it('JSONB snapshot/provenance/minor-unit değerlerini veri kaybı olmadan saklar ve rollback atomiktir', async () => {
    const seeded = await seedCase()
    const base = request(seeded, 0)
    if (base.realMarket === null) throw new Error('TEST_REAL_MARKET_REQUIRED')
    const draft = await createDraft(seeded, 0, {
      realMarket: {
        ...base.realMarket,
        marketValueMinor: 100_000_001,
        damageAmountMinor: 1,
        prefillProvenance: [{
          field: 'marketValueMinor',
          source: 'user_input',
          sourceRevisionId: null,
          originalValue: 100_000_000,
          newValue: 100_000_001,
          overrideReason: 'Bir minor-unit düzeltme.',
        }],
      },
    })
    const row = await pool.query(
      `SELECT input_snapshot,result_snapshot
       FROM traffic_value_loss_versions
       WHERE id=$1`,
      [draft.currentVersion.id],
    )
    expect(row.rows[0].input_snapshot).toEqual(draft.currentVersion.input)
    expect(row.rows[0].result_snapshot).toEqual(draft.currentVersion.evaluation)
    expect(row.rows[0].input_snapshot.realMarket.prefillProvenance[0]).toMatchObject({
      originalValue: 100_000_000,
      newValue: 100_000_001,
      overrideReason: 'Bir minor-unit düzeltme.',
    })

    const before = Number((await pool.query(
      'SELECT count(*) AS n FROM traffic_value_loss_versions WHERE case_id=$1',
      [seeded.caseId],
    )).rows[0].n)
    const stale = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${seeded.caseId}/traffic-value-loss/versions`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        ...request(seeded, 0),
        confirmedPreviewHash: 'f'.repeat(64),
      },
    })
    expect(stale.statusCode).toBe(409)
    expect(Number((await pool.query(
      'SELECT count(*) AS n FROM traffic_value_loss_versions WHERE case_id=$1',
      [seeded.caseId],
    )).rows[0].n)).toBe(before)
  })
})
