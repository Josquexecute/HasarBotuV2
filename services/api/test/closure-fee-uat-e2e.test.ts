import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AGENTS_ROUTE,
  AUTH_LOGIN_ROUTE,
  CASES_ROUTE,
  CASE_FEE_ROUTE,
  CASE_FEE_CANDIDATES_ROUTE,
  CASE_SUMMARY_REPORT_ROUTE,
  FEE_APPROVE_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  caseLifecycleOperationResponseSchema,
  caseSummaryReportResponseSchema,
  closureFeeResponseSchema,
  caseClosureFeeResponseSchema,
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

/**
 * UAT-tarzı uçtan uca doğrulama: gerçek anonim bir Kasko dosyasında Kapanış
 * ve Ücret zincirinin TAMAMI (kapanış -> nihai rapor ücret çıkarımı ->
 * kullanıcı onayı -> aylık rapora yansıma -> yeniden açma) TEK case
 * üzerinde, sentetik SQL ile onaylı sürüm enjekte etmeden, yalnız gerçek
 * command API'leriyle sürülür.
 *
 * Kapanma ücreti YALNIZ zaten `closed` olan case için oluşturulabilir
 * (HB-2026-045 madde 1); bu yüzden gerçek sıra "kapanış -> ücret" şeklindedir
 * (kullanıcı isteğindeki metinsel sıralama adımların TAMAMINI kapsar, ama
 * gerçek sistem kısıtı yalnız bu sırayla ilerlemeye izin verir). Kasko case
 * seçildi çünkü Trafik değer kaybı kapanış gereksinimi Kasko'da otomatik
 * `not_applicable` olur (HB-2026-046 madde 3) ve bu senaryonun odağı olan
 * Kapanış+Ücret zincirini gereksiz bir değer kaybı alt-zinciriyle
 * (ayrıca `traffic-value-loss-closure-e2e.test.ts` ile zaten kanıtlanmış)
 * karıştırmaz.
 *
 * Mevcut `case-lifecycle.test.ts` ve `closure-fees-reports.test.ts` bu
 * parçaları ayrı ayrı doğruluyordu; hiçbiri onaylı bir ücretin GERÇEK
 * `yeniden açma`dan sonra ne olduğunu (aylık toplamdan düşüp düşmediğini,
 * kaydın kendisinin bozulup bozulmadığını) tek akışta göstermiyordu.
 */

const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'uat-fee-sentetik-guclu-parola-39'
const ROOT_KEY = 'uat-fee-root'
const BASE_READY_DOCUMENT_TYPES = [
  'casco_policy', 'sbm_heavy_damage_result', 'casco_vehicle_registration', 'casco_driver_license', 'ktt',
  'preliminary_report',
] as const

describeDb('Kapanış ve Ücret uçtan uca UAT: kapanış -> nihai rapor ücret çıkarımı -> onay -> aylık rapor -> yeniden açma (gerçek PostgreSQL)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let root: string
  let organizationId: string
  let managerUserId: string
  let accountingUserId: string
  let adminUserId: string
  let managerCookie: string
  let accountingCookie: string
  let adminCookie: string
  let agentConfig: AgentConfig
  let agentClient: ReturnType<typeof createAgentApiClient>

  const injectFetch = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const response = await app.inject({
      method: (init?.method ?? 'GET') as 'GET' | 'POST',
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      ...(init?.body !== undefined && init.body !== null ? { payload: String(init.body) } : {}),
    })
    return {
      ok: response.statusCode >= 200 && response.statusCode < 300,
      status: response.statusCode,
      json: async () => response.json(),
      headers: { get: () => null },
    } as unknown as Response
  }) as unknown as typeof fetch

  async function login(email: string): Promise<string> {
    const response = await app.inject({
      method: 'POST', url: AUTH_LOGIN_ROUTE, payload: { email, password: PASSWORD },
    })
    expect(response.statusCode).toBe(200)
    return String(response.headers['set-cookie']).split(';')[0] as string
  }

  async function seedReadyDocument(caseId: string, documentType: string): Promise<string> {
    const documentId = uuidv7()
    const versionId = uuidv7()
    await pool.query(
      "INSERT INTO documents (id,organization_id,case_id,document_type,status) VALUES ($1,$2,$3,$4,'ready')",
      [documentId, organizationId, caseId, documentType],
    )
    await pool.query(
      `INSERT INTO document_versions
       (id,organization_id,document_id,case_id,version_number,original_file_name,display_name,mime_type,byte_size,
        content_hash,storage_root_key,relative_path,source_type,status,hash_verified,size_verified,verified_at)
       VALUES ($1,$2,$3,$4,1,$5,$5,'application/pdf',10,$6,$7,$8,'imported','ready',true,true,$9)`,
      [versionId, organizationId, documentId, caseId, `${documentType}.pdf`, uuidv7().replaceAll('-', '').padEnd(64, '0'),
        ROOT_KEY, `2026/Temmuz 2026/METADATA/EVRAK/${caseId}-${documentType}.pdf`, new Date('2026-07-20T09:00:00.000Z')],
    )
    await pool.query(
      'UPDATE documents SET current_version_id=$2,current_version_number=1 WHERE id=$1',
      [documentId, versionId],
    )
    return versionId
  }

  async function seedReadyPhoto(caseId: string): Promise<void> {
    await pool.query(
      `INSERT INTO photos
       (id,organization_id,case_id,original_file_name,display_name,mime_type,byte_size,content_hash,storage_root_key,
        relative_path,source_type,status,hash_verified,size_verified,verified_at)
       VALUES ($1,$2,$3,'onarim.jpg','Onarım','image/jpeg',10,$4,$5,$6,'imported','ready',true,true,$7)`,
      [uuidv7(), organizationId, caseId, uuidv7().replaceAll('-', '').padEnd(64, '0'), ROOT_KEY,
        `2026/Temmuz 2026/METADATA/ONARIM/${caseId}-onarim.jpg`, new Date('2026-07-20T09:00:00.000Z')],
    )
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    organizationId = uuidv7()
    managerUserId = uuidv7()
    accountingUserId = uuidv7()
    adminUserId = uuidv7()
    await pool.query(
      "INSERT INTO organizations (id,code,name) VALUES ($1,'uat-fee-main','UAT Kapanış ve Ücret')",
      [organizationId],
    )
    const passwordHash = await hashPassword(PASSWORD)
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash)
       VALUES ($1,$2,'uat-fee-manager@test.local','UAT Sorumlu',$3),
              ($4,$2,'uat-fee-accounting@test.local','UAT Muhasebe',$3),
              ($5,$2,'uat-fee-admin@test.local','UAT Yönetici',$3)`,
      [managerUserId, organizationId, passwordHash, accountingUserId, adminUserId],
    )
    await pool.query(
      `INSERT INTO user_roles (user_id,role_id)
       SELECT $1::uuid,id FROM roles WHERE code='case_manager'
       UNION ALL SELECT $2::uuid,id FROM roles WHERE code='accounting'
       UNION ALL SELECT $3::uuid,id FROM roles WHERE code='admin'`,
      [managerUserId, accountingUserId, adminUserId],
    )
    await pool.query(
      `INSERT INTO storage_roots (id,organization_id,root_key,label)
       VALUES ($1,$2,$3,'UAT Kapanış Kök')`,
      [uuidv7(), organizationId, ROOT_KEY],
    )

    app = buildApp({
      loggerEnabled: false,
      auth: {
        pool,
        cookieSecure: false,
        loginRateLimit: { limit: 500, windowMs: 60_000 },
      },
    })
    await app.ready()
    managerCookie = await login('uat-fee-manager@test.local')
    accountingCookie = await login('uat-fee-accounting@test.local')
    adminCookie = await login('uat-fee-admin@test.local')

    const registered = await app.inject({
      method: 'POST', url: AGENTS_ROUTE, headers: { cookie: adminCookie },
      payload: { name: 'UAT Closure Fee Agent' },
    })
    expect(registered.statusCode).toBe(201)
    const agent = registered.json() as { agent: { id: string }; secret: string }
    root = await mkdtemp(join(tmpdir(), 'hb-uat-fee-'))
    agentConfig = {
      apiBaseUrl: '', agentId: agent.agent.id, agentSecret: agent.secret,
      roots: { [ROOT_KEY]: root }, leaseSeconds: 120, pollIntervalMs: 1000,
      freshnessGate: undefined,
    }
    agentClient = createAgentApiClient({
      baseUrl: '', agentId: agent.agent.id, secret: agent.secret, fetchImpl: injectFetch,
    })
  }, 60_000)

  afterAll(async () => {
    if (app !== undefined) await app.close()
    if (pool !== undefined) await closeDatabasePool(pool)
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  })

  it('gerçek kapanış, nihai rapor ücret çıkarımı, onay, aylık rapor yansıması ve yeniden açmayı tek akışta doğrular', async () => {
    // 1) Gerçek Kasko case oluşturma (sentetik SQL enjeksiyonu değil).
    const plate = '34 UAT 3901'
    const caseCreated = await app.inject({
      method: 'POST', url: CASES_ROUTE,
      headers: { cookie: adminCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        caseType: 'casco', plate, workflowStage: 'ready_to_close',
        notificationDate: '2026-07-20', responsibleUserId: managerUserId,
      },
    })
    expect(caseCreated.statusCode, caseCreated.payload).toBe(201)
    const createdCase = (caseCreated.json() as { case: { id: string } }).case
    const caseId = createdCase.id

    // Rücu durumu ve fiziksel konum, Kapanış+Ücret zincirinin parçası değil
    // (ayrı modüller); ön koşul olarak sade biçimde hazırlanır.
    await pool.query("UPDATE cases SET recourse_status='not_confirmed' WHERE id=$1", [caseId])
    const openPath = `2026/Temmuz 2026/${plate.replaceAll(' ', '')}`
    await pool.query(
      `INSERT INTO case_locations
         (id,organization_id,case_id,storage_root_key,relative_path,verification_status,source)
       VALUES ($1,$2,$3,$4,$5,'verified','system')`,
      [uuidv7(), organizationId, caseId, ROOT_KEY, openPath],
    )
    const absolute = join(root, ...openPath.split('/'))
    for (const directory of ['EVRAK', 'HASAR', 'OLAY YERİ', 'ONARIM', 'DEĞER KAYBI']) {
      await mkdir(join(absolute, directory), { recursive: true })
    }
    await writeFile(join(absolute, 'EVRAK', 'sentetik.txt'), 'uat-kapanis-ucret', 'utf8')

    // Kapanış için gerçek doğrulanmış (ready) kanıt: belge/fotoğraf ready
    // doğrulaması PERT ve İşçilik UAT'larında gerçek File Agent döngüsüyle
    // ayrıca kanıtlandı; burada tekrar sürülmeden hazır kabul edilir.
    for (const type of BASE_READY_DOCUMENT_TYPES) await seedReadyDocument(caseId, type)
    const expertReportVersionId = await seedReadyDocument(caseId, 'expert_report')
    await seedReadyPhoto(caseId)

    // 2) Gerçek kapanış: plan -> onay -> gerçek File Agent taşıması.
    const closePlan = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/lifecycle/close/plan`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedCaseVersion: 1, expectedLocationVersion: 1, closeMode: 'normal' },
    })
    expect(closePlan.statusCode, closePlan.payload).toBe(201)
    const closeOp = caseLifecycleOperationResponseSchema.parse(closePlan.json()).operation
    expect(closeOp).toMatchObject({ operationType: 'close', status: 'approval_required', blockers: [] })
    expect(closeOp.requirementSummary.missingCount).toBe(0)
    expect(closeOp.requirementSummary.controlRequiredCount).toBe(0)
    expect(closeOp.requirementSummary.valueLossSummary?.status).toBe('not_applicable')

    const closeApproved = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/lifecycle/close/${closeOp.id}/approve`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedVersion: closeOp.version, approved: true },
    })
    expect(closeApproved.statusCode, closeApproved.payload).toBe(202)
    expect((await runOnce(agentClient, agentConfig)).kind).toBe('reported')

    const closedRow = await pool.query(
      'SELECT lifecycle_status,version,closed_at FROM cases WHERE id=$1', [caseId],
    )
    expect(closedRow.rows[0]).toMatchObject({ lifecycle_status: 'closed', version: 2 })
    const closedAtFirst = (closedRow.rows[0] as { closed_at: Date }).closed_at
    expect(closedAtFirst).not.toBeNull()

    // 3) NİHAİ RAPOR ÜCRET ÇIKARIMI: case artık kapalı; kullanıcı nihai
    //    ekspertiz raporundan (verified expert_report) ücreti okuyup aday
    //    olarak girer (HB-2026-045: yalnız closed case için oluşturulabilir).
    const candidateAmountMinor = 485_000 // 4.850,00 TL
    const candidateCreated = await app.inject({
      method: 'POST', url: CASE_FEE_CANDIDATES_ROUTE.replace(':caseId', caseId),
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        expectedCaseVersion: 2, candidateAmountMinor,
        sourceDocumentVersionId: expertReportVersionId, sourcePage: 1,
      },
    })
    expect(candidateCreated.statusCode, candidateCreated.payload).toBe(201)
    const candidateFee = closureFeeResponseSchema.parse(candidateCreated.json()).fee
    expect(candidateFee.currentVersion).toMatchObject({
      status: 'control_required', candidateAmountMinor, approvedAmountMinor: null,
    })

    const period = new Date().toISOString().slice(0, 7)

    // Onaydan ÖNCE: dosya kapanmış sayılır ama aday tutar kesin toplama
    // GİRMEZ (yalnız açık onaylı/düzeltilmiş tutar sayılır).
    const beforeApproval = caseSummaryReportResponseSchema.parse((await app.inject({
      method: 'GET', url: `${CASE_SUMMARY_REPORT_ROUTE}?period=${period}`, headers: { cookie: adminCookie },
    })).json())
    expect(beforeApproval.summary).toMatchObject({
      closedCaseCount: 1, approvedFeeCount: 0, approvedFeeTotalMinor: 0,
      controlRequiredFeeCount: 1, closedCaseWithoutFeeCount: 0,
    })
    expect(beforeApproval.pendingFees.some((item) => item.caseId === caseId)).toBe(true)

    // 4) KULLANICI ONAYI: muhasebe rolündeki gerçek kullanıcı adayı onaylar.
    const approved = await app.inject({
      method: 'POST', url: FEE_APPROVE_ROUTE.replace(':feeId', candidateFee.id),
      headers: { cookie: accountingCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedVersion: candidateFee.currentVersion.feeVersion, confirmed: true },
    })
    expect(approved.statusCode, approved.payload).toBe(200)
    const approvedFee = closureFeeResponseSchema.parse(approved.json()).fee
    expect(approvedFee.currentVersion).toMatchObject({
      status: 'approved', approvedAmountMinor: candidateAmountMinor,
      approvedByUserId: accountingUserId,
    })

    // Bağımsız YENİDEN OKUMA: onay yanıtından değil ayrı bir GET'ten.
    const feeReread = caseClosureFeeResponseSchema.parse((await app.inject({
      method: 'GET', url: CASE_FEE_ROUTE.replace(':caseId', caseId), headers: { cookie: managerCookie },
    })).json())
    expect(feeReread.fee?.currentVersion.status).toBe('approved')
    expect(feeReread.fee?.currentVersion.approvedAmountMinor).toBe(candidateAmountMinor)
    // Append-only: onay yeni bir sürüm üretir (v1 control_required, v2 approved);
    // eski sürüm SİLİNMEZ/EZİLMEZ.
    expect(feeReread.fee?.history).toHaveLength(2)
    expect(feeReread.fee?.history.find((version) => version.feeVersion === 1)?.status)
      .toBe('control_required')
    expect(feeReread.fee?.history.find((version) => version.feeVersion === 2)?.status)
      .toBe('approved')

    // 5) AYLIK RAPORA YANSIMA: onaylı tutar artık kesin toplamda.
    const afterApproval = caseSummaryReportResponseSchema.parse((await app.inject({
      method: 'GET', url: `${CASE_SUMMARY_REPORT_ROUTE}?period=${period}`, headers: { cookie: adminCookie },
    })).json())
    expect(afterApproval.summary).toMatchObject({
      closedCaseCount: 1, approvedFeeCount: 1, approvedFeeTotalMinor: candidateAmountMinor,
      controlRequiredFeeCount: 0, closedCaseWithoutFeeCount: 0,
    })
    expect(afterApproval.pendingFees.some((item) => item.caseId === caseId)).toBe(false)

    // 6) YENİDEN AÇMA: gerçek plan -> onay -> gerçek File Agent taşıması.
    const reopenPlan = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/lifecycle/reopen/plan`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        expectedCaseVersion: 2, expectedLocationVersion: 2,
        reason: 'UAT: ücret onayından sonra ek kontrol için yeniden açıldı.', targetWorkflowStage: 'reporting',
      },
    })
    expect(reopenPlan.statusCode, reopenPlan.payload).toBe(201)
    const reopenOp = caseLifecycleOperationResponseSchema.parse(reopenPlan.json()).operation
    expect(reopenOp.destination.relativePath).toBe(openPath)
    const reopenApproved = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/lifecycle/reopen/${reopenOp.id}/approve`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: { expectedVersion: reopenOp.version, approved: true },
    })
    expect(reopenApproved.statusCode, reopenApproved.payload).toBe(202)
    expect((await runOnce(agentClient, agentConfig)).kind).toBe('reported')

    const reopenedRow = await pool.query(
      'SELECT lifecycle_status,version,closed_at FROM cases WHERE id=$1', [caseId],
    )
    expect(reopenedRow.rows[0]).toMatchObject({ lifecycle_status: 'open', version: 3 })
    // `closed_at` yeniden açmada SIFIRLANMAZ (append-only geçmiş; en son
    // kapanış zamanını taşımaya devam eder). Bu, ölçülen gerçek davranıştır.
    expect((reopenedRow.rows[0] as { closed_at: Date }).closed_at.toISOString())
      .toBe(closedAtFirst.toISOString())

    // Onaylı ücret KAYDI bozulmadı/silinmedi; bağımsız GET hâlâ 'approved'
    // döner -- yeniden açma ücret verisini SESSİZCE değiştirmez.
    const feeAfterReopen = caseClosureFeeResponseSchema.parse((await app.inject({
      method: 'GET', url: CASE_FEE_ROUTE.replace(':caseId', caseId), headers: { cookie: managerCookie },
    })).json())
    expect(feeAfterReopen.fee?.currentVersion).toMatchObject({
      status: 'approved', approvedAmountMinor: candidateAmountMinor,
    })

    // GERÇEK KUSUR BULUNDU VE DÜZELTİLDİ: `approved_fee_count`/
    // `approved_fee_total_minor`/`control_required_fee_count` sorgusunda
    // `c.lifecycle_status='closed'` filtresi eksikti (HB-2026-045 madde 5'in
    // diğer tüm sayaçlarında -- closedCaseWithoutFeeCount, value-loss
    // sayaçları -- bu filtre vardı). Sonuç: dosya kapatılıp ücret onaylandıktan
    // sonra yeniden açılınca `closedCaseCount` doğru şekilde 0'a düşerken
    // `approvedFeeCount`/`approvedFeeTotalMinor` YANLIŞLIKLA 1/485.000 olarak
    // kalmaya devam ediyordu (case satırı `scopedSql`'i "open + bu ay
    // oluşturuldu" dalından hâlâ karşılıyordu) -- aynı raporda "0 kapanan
    // dosya" ile "485.000 TL onaylı ücret" birlikte görünen iç tutarsız bir
    // muhasebe raporu üretiyordu. Düzeltme: üç sayaca da diğerleriyle aynı
    // `c.lifecycle_status='closed'` koşulu eklendi (services/api/src/fees/
    // store.ts). Aşağıdaki beklenti artık DÜZELTİLMİŞ davranıştır.
    const afterReopen = caseSummaryReportResponseSchema.parse((await app.inject({
      method: 'GET', url: `${CASE_SUMMARY_REPORT_ROUTE}?period=${period}`, headers: { cookie: adminCookie },
    })).json())
    expect(afterReopen.summary).toMatchObject({
      closedCaseCount: 0, approvedFeeCount: 0, approvedFeeTotalMinor: 0, controlRequiredFeeCount: 0,
    })

    // 7) Audit zinciri: kapanıştan yeniden açmaya kadar tam; ham gerekçe/
    //    mutlak yol audit'e sızmaz.
    const audit = await pool.query(
      `SELECT action,actor_user_id::text,resource_id::text
         FROM audit_events
        WHERE organization_id=$1
          AND resource_id::text = ANY($2::text[])
        ORDER BY occurred_at`,
      [organizationId, [caseId, closeOp.id, reopenOp.id, candidateFee.id]],
    )
    const actions = audit.rows.map((row) => row.action)
    expect(actions).toEqual(expect.arrayContaining([
      'case.created',
      'case_lifecycle.close_planned',
      'case_lifecycle.close_approved',
      'case_lifecycle.closed',
      'closure_fee.candidate_created',
      'closure_fee.approved',
      'case_lifecycle.reopen_planned',
      'case_lifecycle.reopen_approved',
      'case_lifecycle.reopened',
    ]))
    expect(audit.rows.every((row) => row.actor_user_id === managerUserId
      || row.actor_user_id === accountingUserId
      || row.actor_user_id === adminUserId)).toBe(true)
    const auditPayload = JSON.stringify(audit.rows)
    expect(auditPayload).not.toContain(root)
    expect(auditPayload).not.toContain('ek kontrol için yeniden açıldı')
  }, 60_000)
})
