import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import {
  AGENTS_ROUTE,
  AUTH_LOGIN_ROUTE,
  CASES_ROUTE,
  IDEMPOTENCY_KEY_HEADER,
  laborAllocationApplyResponseSchema,
  laborAllocationRunResponseSchema,
  laborExcelProfileResponseSchema,
  laborSheetResponseSchema,
  laborWorkbookApplyResponseSchema,
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
import { sha256WorkbookBytes } from '../../file-agent/src/ooxml-readonly-extractor.js'
import { waitForRunTerminal } from './helpers/labor-allocation-run.js'
import {
  buildApp,
  createDeterministicLaborAllocationProviderRegistry,
  hashPassword,
} from '../src/index.js'

/**
 * UAT-tarzı uçtan uca doğrulama: gerçek anonim bir İşçilik dosyasında
 * AI öneri -> kullanıcı düzeltmesi -> onay -> File Agent güvenli fiziksel
 * yazım -> yeniden okuma -> audit zincirini TEK case üzerinde, sentetik SQL
 * ile onaylı sürüm enjekte etmeden, yalnız gerçek command API'leri ile sürer.
 *
 * Mevcut testler (Paket 58, Paket 65B) bu adımları ayrı ayrı veya el ile
 * çağrılan yürütücü fonksiyonlarla doğruluyordu; hiçbiri gerçek File Agent
 * `runOnce` döngüsünü (`@hasarbotu/file-agent`) İşçilik workbook job'ları
 * için çalıştırmıyordu -- diğer bütün job türleri (workspace, file_operation,
 * pdf/policy OCR, value-loss kapanış taşıması) için bu döngü zaten gerçek
 * testlerde kullanılıyordu. Bu senaryo o boşluğu kapatır ve ayrıca AI'nin
 * ürettiği öneri ile kullanıcının onayladığı nihai değerin gerçekten farklı
 * olduğunu -- ve fiziksel Excel'e yazılanın AI önerisi değil kullanıcı
 * düzeltmesi olduğunu -- tek akışta kanıtlar.
 */

const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'uat-lab-sentetik-guclu-parola-65'
const ROOT_KEY = 'uat-lab-root'

const xml = (body: string): Uint8Array =>
  strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`)

/** Gerçek şablon geometrisini (başlık satırı + F-M operasyon + N formül toplamı) anımsatan sentetik, anonim iki satırlık İşçilik workbook'u. */
function workbookFixture(plate: string, officeNumber: string): Uint8Array {
  const dataRow = (row: number, part: string, initial: string) =>
    '<row r="' + String(row) + '">'
    + `<c r="A${row}" t="inlineStr"><is><t>${part}</t></is></c>`
    + `<c r="D${row}" t="inlineStr"><is><t>${initial}</t></is></c>`
    + `<c r="H${row}"><v>1${row}</v></c><c r="I${row}"><v>2${row}</v></c>`
    + `<c r="J${row}"><v>3${row}</v></c><c r="K${row}"><v>4${row}</v></c>`
    + `<c r="L${row}"><v>5${row}</v></c><c r="M${row}"><v>6${row}</v></c>`
    + `<c r="N${row}"><f>SUM(H${row}:M${row})</f><v>0</v></c>`
    + '</row>'
  return zipSync({
    '[Content_Types].xml': xml(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    ),
    '_rels/.rels': xml(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="book" '
      + 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
      + 'Target="xl/workbook.xml"/></Relationships>',
    ),
    'xl/workbook.xml': xml(
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
      + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<sheets><sheet name="İşçilik" sheetId="1" r:id="sheet"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': xml(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="sheet" '
      + 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
      + 'Target="worksheets/labor.xml"/></Relationships>',
    ),
    'xl/worksheets/labor.xml': xml(
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<sheetData><row r="1">'
      + '<c r="A1" t="inlineStr"><is><t>Parça</t></is></c>'
      + `<c r="B1" t="inlineStr"><is><t>${plate}</t></is></c>`
      + `<c r="C1" t="inlineStr"><is><t>${officeNumber}</t></is></c>`
      + '<c r="D1" t="inlineStr"><is><t>İşçilik</t></is></c>'
      + '</row>'
      + dataRow(2, 'Ön tampon', '100.00')
      + dataRow(3, 'Sol arka çamurluk', '50.00')
      + '</sheetData></worksheet>',
    ),
    'docProps/core.xml': xml('<coreProperties><title>Sentetik UAT İşçilik</title></coreProperties>'),
  })
}

describeDb('İşçilik uçtan uca UAT: AI öneri -> kullanıcı düzeltmesi -> onay -> File Agent fiziksel yazım -> yeniden okuma -> audit (gerçek PostgreSQL)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let app: FastifyInstance
  let root: string
  let organizationId: string
  let managerUserId: string
  let adminUserId: string
  let managerCookie: string
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

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })

    organizationId = uuidv7()
    managerUserId = uuidv7()
    adminUserId = uuidv7()
    await pool.query(
      "INSERT INTO organizations (id,code,name) VALUES ($1,'uat-lab-main','UAT İşçilik')",
      [organizationId],
    )
    const passwordHash = await hashPassword(PASSWORD)
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash)
       VALUES ($1,$2,'uat-lab-manager@test.local','UAT Sorumlu',$3),
              ($4,$2,'uat-lab-admin@test.local','UAT Yönetici',$3)`,
      [managerUserId, organizationId, passwordHash, adminUserId],
    )
    await pool.query(
      `INSERT INTO user_roles (user_id,role_id)
       SELECT $1::uuid,id FROM roles WHERE code='case_manager'
       UNION ALL SELECT $2::uuid,id FROM roles WHERE code='admin'`,
      [managerUserId, adminUserId],
    )
    await pool.query(
      `INSERT INTO storage_roots (id,organization_id,root_key,label,is_active)
       VALUES ($1,$2,$3,'UAT İşçilik Kök',true)`,
      [uuidv7(), organizationId, ROOT_KEY],
    )
    await pool.query(
      `INSERT INTO ai_provider_policies
         (id,organization_id,labor_allocation_enabled,labor_allocation_allowed_provider_ids,
          monthly_budget_minor,per_request_budget_minor)
       VALUES ($1,$2,true,ARRAY['deterministic-success']::text[],100000000,100000000)`,
      [uuidv7(), organizationId],
    )

    app = buildApp({
      loggerEnabled: false,
      auth: {
        pool,
        cookieSecure: false,
        loginRateLimit: { limit: 500, windowMs: 60_000 },
      },
      laborAllocationProviders: createDeterministicLaborAllocationProviderRegistry(),
      laborAllocationProviderId: 'deterministic-success',
    })
    await app.ready()
    managerCookie = await login('uat-lab-manager@test.local')
    adminCookie = await login('uat-lab-admin@test.local')

    const registered = await app.inject({
      method: 'POST', url: AGENTS_ROUTE, headers: { cookie: adminCookie },
      payload: { name: 'UAT Labor Agent' },
    })
    expect(registered.statusCode).toBe(201)
    const agent = registered.json() as { agent: { id: string }; secret: string }
    root = await mkdtemp(join(tmpdir(), 'hb-uat-lab-'))
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

  it('gerçek case, AI öneri, kullanıcı düzeltmesi, onay, File Agent yazımı ve audit zincirini tek akışta doğrular', async () => {
    // 1) Gerçek case oluşturma (sentetik SQL enjeksiyonu değil).
    const plate = '34 UAT 6501'
    const caseCreated = await app.inject({
      method: 'POST', url: CASES_ROUTE,
      headers: { cookie: adminCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        caseType: 'traffic', plate, workflowStage: 'reporting',
        notificationDate: '2026-07-24', responsibleUserId: managerUserId,
      },
    })
    expect(caseCreated.statusCode, caseCreated.payload).toBe(201)
    const createdCase = (caseCreated.json() as {
      case: { id: string; officeCaseNumber: string; version: number }
    }).case
    const caseId = createdCase.id
    const officeNumber = createdCase.officeCaseNumber

    // Fiziksel konum ataması ayrı test edilen bir modüldür (Paket 12/HB-2026-018);
    // bu UAT yalnız gerçek doğrulanmış bir konumu ÖN KOŞUL olarak varsayar.
    const caseRelative = '2026/34UAT6501'
    await pool.query(
      `INSERT INTO case_locations
         (id,organization_id,case_id,storage_root_key,relative_path,verification_status,source)
       VALUES ($1,$2,$3,$4,$5,'verified','system')`,
      [uuidv7(), organizationId, caseId, ROOT_KEY, caseRelative],
    )
    const workbookRelative = 'EVRAK/ISCILIK.xlsx'
    const workbookDirectory = join(root, ...caseRelative.split('/'), 'EVRAK')
    await mkdir(workbookDirectory, { recursive: true })
    const workbookPath = join(workbookDirectory, 'ISCILIK.xlsx')
    const sourceBytes = workbookFixture(plate, officeNumber)
    await writeFile(workbookPath, sourceBytes)

    // 2) Gerçek anonim iki kalemli İşçilik föyü.
    const sheetCreated = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/labor-sheet`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        expectedCaseVersion: 1,
        confirmed: true,
        items: [
          {
            description: 'Ön tampon', action: 'Onarım', partAmountMinor: 0,
            laborAmountMinor: 1_000_000, partCode: 'PRC-501',
            partCodeSource: 'user_entered', damageRegion: 'Ön',
          },
          {
            description: 'Sol arka çamurluk', action: 'Değişim', partAmountMinor: 700_000,
            laborAmountMinor: 200_000, partCode: 'PRC-502',
            partCodeSource: 'user_entered', damageRegion: 'Arka',
          },
        ],
      },
    })
    expect(sheetCreated.statusCode, sheetCreated.payload).toBe(201)
    const sheet = laborSheetResponseSchema.parse(sheetCreated.json()).sheet

    // 3) Gerçek AI önerisi üretilir; ÖNERİLEN değerler daha sonra karşılaştırma
    //    için saklanır.
    const analyzed = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/labor-allocation-ai/analyze`,
      headers: { cookie: managerCookie },
      payload: {
        expectedSheetVersion: sheet.version,
        damageDescription: 'Ön sağ darbe, arka sol çamurluk sıyrık.',
        confirmedEgress: false,
      },
    })
    const settled = await waitForRunTerminal(app, managerCookie, caseId, analyzed)
    const run = laborAllocationRunResponseSchema.parse(settled.json()).run
    expect(run.status).toBe('review_required')
    const suggestedLine1 = run.suggestion?.lines.find((line) => line.lineOrdinal === 1)
    const suggestedLine2 = run.suggestion?.lines.find((line) => line.lineOrdinal === 2)
    expect(suggestedLine1).toBeDefined()
    expect(suggestedLine2).toBeDefined()

    // 4) Onay: 1. satırda kullanıcı hem TUTARI hem KATEGORİ dağılımını
    //    düzeltir (AI önerisinden iki eksende de farklıdır); 2. satırda tutar
    //    AI önerisiyle AYNI kalır ama kategori dağılımı düzeltilir (yalnız
    //    kategori ekseninde düzeltme). Deterministik AI harness'i kasıtlı
    //    düşük güvenle çalışır (`controlRequired: true`); bir satır gerçekten
    //    düzeltilmeden fiziksel yazıma geçemez (HB-2026-086 madde 3) -- bu
    //    yüzden "hiç dokunmadan onayla" senaryosu üretim kuralına aykırı
    //    olurdu ve burada modellenmez.
    const correctedLine1CategoryAmounts = [
      { category: 'bodywork', amountMinor: 500_000 },
      { category: 'mechanical', amountMinor: 0 },
      { category: 'electrical', amountMinor: 0 },
      { category: 'upholstery_lock', amountMinor: 0 },
      { category: 'glass', amountMinor: 0 },
      { category: 'calibration', amountMinor: 0 },
      { category: 'repair', amountMinor: 400_000 },
      { category: 'paint', amountMinor: 0 },
    ]
    const correctedLine2CategoryAmounts = [
      { category: 'bodywork', amountMinor: 150_000 },
      { category: 'mechanical', amountMinor: 50_000 },
      { category: 'electrical', amountMinor: 0 },
      { category: 'upholstery_lock', amountMinor: 0 },
      { category: 'glass', amountMinor: 0 },
      { category: 'calibration', amountMinor: 0 },
      { category: 'repair', amountMinor: 0 },
      { category: 'paint', amountMinor: 0 },
    ]
    const applied = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/labor-allocation-ai/${run.id}/apply`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        expectedSheetVersion: sheet.version,
        reason: 'UAT: 1. kalemde tutar+kategori, 2. kalemde yalnız kategori eksper tarafından düzeltildi.',
        confirmed: true,
        lines: [
          {
            lineOrdinal: 1, description: 'Ön tampon', action: 'Onarım',
            partAmountMinor: 0, laborAmountMinor: 900_000,
            categoryAmounts: correctedLine1CategoryAmounts,
          },
          {
            lineOrdinal: 2, description: 'Sol arka çamurluk', action: 'Değişim',
            partAmountMinor: 700_000, laborAmountMinor: 200_000,
            categoryAmounts: correctedLine2CategoryAmounts,
          },
        ],
      },
    })
    expect(applied.statusCode, applied.payload).toBe(200)
    const application = laborAllocationApplyResponseSchema.parse(applied.json()).application
    expect(application.status).toBe('completed')

    const appliedLine1 = application.lines.find((line) => line.lineOrdinal === 1)
    const appliedLine2 = application.lines.find((line) => line.lineOrdinal === 2)
    expect(appliedLine1?.modified).toBe(true)
    // AI önerisi ile kullanıcının onayladığı nihai değer GERÇEKTEN farklıdır.
    expect(appliedLine1?.suggestedLaborAmountMinor).toBe(1_000_000)
    expect(appliedLine1?.appliedLaborAmountMinor).toBe(900_000)
    expect(appliedLine1?.suggestedLaborAmountMinor).not.toBe(appliedLine1?.appliedLaborAmountMinor)
    // 2. kalemde TUTAR AI önerisiyle aynıdır (yalnız kategori dağılımı
    // düzeltildi); bu, düzeltmenin tek boyutlu (yalnız kategori) olabildiğini
    // kanıtlar.
    expect(appliedLine2?.modified).toBe(false)
    expect(appliedLine2?.suggestedLaborAmountMinor).toBe(appliedLine2?.appliedLaborAmountMinor)

    // Kategori düzeyinde de aynı ayrım kalıcılığa yansır (yalnız persistence'ta
    // taşınır, API yanıtında yoktur).
    const persistedLines = await pool.query(
      `SELECT line_ordinal,proposed_category_amounts,applied_category_amounts,category_modified
         FROM labor_allocation_applied_lines
        WHERE organization_id=$1 AND application_id=$2
        ORDER BY line_ordinal`,
      [organizationId, application.id],
    )
    const persistedLine1 = persistedLines.rows.find((row) => row.line_ordinal === 1)
    const persistedLine2 = persistedLines.rows.find((row) => row.line_ordinal === 2)
    expect(persistedLine1.category_modified).toBe(true)
    expect(persistedLine1.proposed_category_amounts).not.toEqual(persistedLine1.applied_category_amounts)
    expect(persistedLine1.applied_category_amounts).toEqual({
      bodywork: 500_000, mechanical: 0, electrical: 0, upholstery_lock: 0,
      glass: 0, calibration: 0, repair: 400_000, paint: 0,
    })
    // 2. kalem: AI TÜMÜNÜ bodywork'e koymuştu (deterministik harness kuralı);
    // kullanıcı mechanical payını ayırarak kategori dağılımını düzeltti.
    expect(persistedLine2.category_modified).toBe(true)
    expect(persistedLine2.proposed_category_amounts).toEqual({
      bodywork: 200_000, mechanical: 0, electrical: 0, upholstery_lock: 0,
      glass: 0, calibration: 0, repair: 0, paint: 0,
    })
    expect(persistedLine2.applied_category_amounts).toEqual({
      bodywork: 150_000, mechanical: 50_000, electrical: 0, upholstery_lock: 0,
      glass: 0, calibration: 0, repair: 0, paint: 0,
    })
    expect(persistedLine2.proposed_category_amounts).not.toEqual(persistedLine2.applied_category_amounts)

    // 5) Gerçek Excel profili (admin) ve gerçek preview isteği.
    const profileResponse = await app.inject({
      method: 'POST', url: '/api/v1/labor-excel-profiles',
      headers: { cookie: adminCookie },
      payload: {
        fields: {
          name: 'UAT İşçilik Profili', insurerId: null, targetSheet: 'İşçilik',
          identityChecks: { plate: true, officeNumber: true },
          columns: [{ key: 'ISCILIK', label: 'İşçilik' }],
          mapping: {
            bodywork: 'ISCILIK', mechanical: 'ISCILIK', electrical: 'ISCILIK',
            upholstery_lock: 'ISCILIK', glass: 'ISCILIK', calibration: 'ISCILIK',
            repair: 'ISCILIK', paint: 'ISCILIK',
          },
        },
        expectedVersion: null, reason: null, confirmed: true,
      },
    })
    expect(profileResponse.statusCode, profileResponse.payload).toBe(201)
    const profile = laborExcelProfileResponseSchema.parse(profileResponse.json()).profile
    expect(profile.writable).toBe(true)

    const previewRequest = {
      applicationId: application.id,
      profileId: profile.id,
      workbookRelativePath: workbookRelative,
      expectedSourceSha256: sha256WorkbookBytes(sourceBytes),
      headers: [
        { cell: 'A1', text: 'Parça' },
        { cell: 'D1', text: 'İşçilik' },
      ],
      identityCellReferences: { plateCell: 'B1', officeNumberCell: 'C1' },
      sourceRows: [
        { lineOrdinal: 1, rowNumber: 2 },
        { lineOrdinal: 2, rowNumber: 3 },
      ],
    }
    const queued = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/labor-workbook-applies/preview`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: previewRequest,
    })
    expect(queued.statusCode, queued.payload).toBe(202)
    const pending = laborWorkbookApplyResponseSchema.parse(queued.json()).operation
    expect(pending.status).toBe('preview_pending')

    // 6) GERÇEK File Agent döngüsü (`runOnce`) preview job'ını işler -- bu,
    //    diğer bütün job türleri için zaten kullanılan production yürütme
    //    yolunun aynısıdır; bu senaryodan önce hiçbir test İşçilik workbook
    //    job'larını bu döngü üzerinden çalıştırmıyordu.
    const previewRun = await runOnce(agentClient, agentConfig)
    expect(previewRun.kind).toBe('reported')
    if (previewRun.kind === 'reported') expect(previewRun.outcome).toBe('verified')

    const readyResponse = await app.inject({
      method: 'GET', url: `/api/v1/cases/${caseId}/labor-workbook-applies/${pending.id}`,
      headers: { cookie: managerCookie },
    })
    const ready = laborWorkbookApplyResponseSchema.parse(readyResponse.json()).operation
    expect(ready.status).toBe('preview_ready')
    const row1 = ready.rows.find((row) => row.cell === 'D2')
    const row2 = ready.rows.find((row) => row.cell === 'D3')
    // Plan, AI'nin ÖNERDİĞİ (10000.00) değil kullanıcının ONAYLADIĞI (9000.00)
    // değeri taşır.
    expect(row1).toMatchObject({ previousValue: '100.00', newValue: '9000.00' })
    expect(row2).toMatchObject({ previousValue: '50.00', newValue: '2000.00' })

    // 7) Gerçek açık onay (case_manager: APPROVE_ROLES kapsamında).
    const approved = await app.inject({
      method: 'POST', url: `/api/v1/cases/${caseId}/labor-workbook-applies/${pending.id}/approve`,
      headers: { cookie: managerCookie, [IDEMPOTENCY_KEY_HEADER]: uuidv7() },
      payload: {
        expectedVersion: ready.version, planHash: ready.planHash,
        approvedRevisionSnapshotHash: ready.approvedRevisionSnapshotHash, confirmed: true,
      },
    })
    expect(approved.statusCode, approved.payload).toBe(202)

    // 8) GERÇEK File Agent döngüsü apply job'ını işler: backup, atomik yazım,
    //    ikinci preflight, audit -- hepsi gerçek dosya sisteminde.
    const applyRun = await runOnce(agentClient, agentConfig)
    expect(applyRun.kind).toBe('reported')
    if (applyRun.kind === 'reported') expect(applyRun.outcome).toBe('verified')

    // 9) Bağımsız YENİDEN OKUMA: önceki adımlarda kullanılan bellek arabelleği
    //    DEĞİL, diske gerçekten yazılan dosya sıfırdan okunur.
    const completedResponse = await app.inject({
      method: 'GET', url: `/api/v1/cases/${caseId}/labor-workbook-applies/${pending.id}`,
      headers: { cookie: managerCookie },
    })
    const completed = laborWorkbookApplyResponseSchema.parse(completedResponse.json()).operation
    expect(completed.status).toBe('completed')
    expect(completed.sourceWorkbookHash).toBe(sha256WorkbookBytes(sourceBytes))
    expect(completed.resultWorkbookHash).not.toBe(completed.sourceWorkbookHash)

    const files = await readdir(workbookDirectory)
    expect(files).toHaveLength(2)
    const backupPath = join(workbookDirectory, completed.backupReference as string)
    expect(await readFile(backupPath)).toEqual(Buffer.from(sourceBytes))

    const resultBytes = await readFile(workbookPath)
    const resultArchive = unzipSync(resultBytes)
    const sourceArchive = unzipSync(sourceBytes)
    const afterSheet = strFromU8(resultArchive['xl/worksheets/labor.xml'] as Uint8Array)
    const beforeSheet = strFromU8(sourceArchive['xl/worksheets/labor.xml'] as Uint8Array)
    // Diskteki gerçek değer kullanıcının düzelttiği tutardır (AI'nin önerisi
    // olan 10000.00 DEĞİL); ikinci satır AI önerisi olduğu gibi 2000.00 yazar.
    expect(afterSheet).toMatch(/<c[^>]*r="D2"[\s\S]*?<t[^>]*>9000[.]00<\/t>/u)
    expect(afterSheet).toMatch(/<c[^>]*r="D3"[\s\S]*?<t[^>]*>2000[.]00<\/t>/u)
    expect(afterSheet).not.toMatch(/<t[^>]*>10000[.]00<\/t>/u)
    for (const cell of ['H2', 'I2', 'J2', 'K2', 'L2', 'M2', 'N2', 'H3', 'I3', 'J3', 'K3', 'L3', 'M3', 'N3']) {
      const pattern = new RegExp(`<c[^>]*r="${cell}"[\\s\\S]*?</c>`)
      expect(pattern.exec(afterSheet)?.[0]).toBe(pattern.exec(beforeSheet)?.[0])
    }
    expect(resultArchive['docProps/core.xml']).toEqual(sourceArchive['docProps/core.xml'])

    // 10) Audit zinciri: dosya oluşturmadan fiziksel yazıma kadar TÜM adımlar
    //     kayıtlıdır ve mutlak yol / hücre değeri / ham açıklama sızmaz.
    const audit = await pool.query(
      `SELECT action,actor_user_id::text,resource_id::text
         FROM audit_events
        WHERE organization_id=$1
          AND resource_id::text = ANY($2::text[])
        ORDER BY occurred_at`,
      [organizationId, [caseId, sheet.id, application.id, pending.id]],
    )
    const actions = audit.rows.map((row) => row.action)
    expect(actions).toEqual(expect.arrayContaining([
      'case.created',
      'labor_sheet.created',
      'labor_allocation.applied',
      'labor_workbook.preview_queued',
      'labor_workbook.preview_ready',
      'labor_workbook.apply_approved',
      'labor_workbook.apply_claimed',
      'labor_workbook.apply_completed',
    ]))
    // `labor_workbook.preview_ready` File Agent'ın kendi doğrulamasıdır (kullanıcı
    // eylemi değildir) ve actor_user_id NULL taşır; diğer tüm olaylar gerçek
    // kullanıcı kimliğine bağlıdır.
    expect(audit.rows.every((row) => row.actor_user_id === managerUserId
      || row.actor_user_id === adminUserId
      || (row.actor_user_id === null && row.action === 'labor_workbook.preview_ready'))).toBe(true)
    const auditPayload = JSON.stringify(audit.rows)
    expect(auditPayload).not.toContain(root)
    expect(auditPayload).not.toContain('9000.00')
    expect(auditPayload).not.toContain('2000.00')
    expect(auditPayload).not.toContain('Ön tampon')
  }, 60_000)
})
