import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type pg from 'pg'
import {
  assertTestDatabaseUrl,
  closeDatabasePool,
  createDatabasePool,
  runMigrations,
  uuidv7,
  type DatabaseConfig,
} from '@hasarbotu/database'
import {
  applyV1Import,
  applyV1Remediation,
  hashPassword,
  planV1Import,
  planV1Remediation,
} from '../src/index.js'
import { createCaseOperationsStore } from '../src/case-operations/store.js'

const TEST_URL = process.env.TEST_DATABASE_URL
const describeDb = TEST_URL === undefined || TEST_URL.length === 0 ? describe.skip : describe
const PASSWORD = 'v1-remediation-sentetik-guclu-parola'

interface SourceInput {
  readonly caseKey: string
  readonly createdAt: string
  readonly claimType?: string
  readonly claimNoticeNo?: string
  readonly claimFileNo?: string
  readonly officeFileNo?: string
  readonly closed?: boolean
  readonly responsible?: string
  readonly expert?: string
  readonly service?: string
  readonly followUpDate?: string
  readonly notes?: readonly { id: string; text: string; createdAt?: string; createdBy?: string }[]
  readonly todos?: readonly { id: string; title: string; completed: boolean; completedAt?: string; assignedTo?: string }[]
  readonly vehicle?: boolean
}

function takipJson(input: SourceInput): string {
  return JSON.stringify({
    schemaVersion: 1,
    caseIdentity: {
      caseKey: input.caseKey,
      plate: '',
      dosyaNo: input.claimFileNo ?? '',
      officeFileNo: input.officeFileNo ?? '',
      claimNoticeNo: input.claimNoticeNo ?? '',
      folderPath: '',
      monthFolder: 'Temmuz 2026',
      isClosedFolder: input.closed ?? false,
    },
    metadata: {
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      createdByComputer: 'TEST-PC',
      updatedByComputer: 'TEST-PC',
      revision: 1,
      writeId: `write-${input.caseKey}`,
    },
    assignment: {
      sorumlu: input.responsible ?? '',
      eksper: input.expert ?? '',
      raportor: 'Sentetik Raportor',
      takipTarihi: input.followUpDate ?? '',
      sonIslemTarihi: '',
      oncelik: 'Kritik',
    },
    status: {
      dosyaDurumu: input.closed ? 'Kapali' : 'Aktif',
      workflowStatus: input.closed ? 'Kapali' : 'Yeni Dosya',
      kapaliMi: input.closed ?? false,
    },
    claimType: input.claimType ?? 'trafik',
    service: { name: input.service ?? '', source: 'manual', updatedAt: input.createdAt, updatedBy: 'Sentetik' },
    portalChecklist: [{ key: 'portal', label: 'Portal kontrolu', completed: true, completedBy: 'Sentetik', completedAt: input.createdAt }],
    todos: (input.todos ?? []).map((todo) => ({
      id: todo.id,
      title: todo.title,
      completed: todo.completed,
      priority: 'Kritik',
      assignedTo: todo.assignedTo ?? '',
      dueDate: '2026-07-10',
      createdAt: input.createdAt,
      completedAt: todo.completedAt ?? '',
    })),
    notes: (input.notes ?? []).map((note) => ({
      id: note.id,
      text: note.text,
      createdAt: note.createdAt ?? input.createdAt,
      createdBy: note.createdBy ?? 'Sentetik Yazar',
    })),
    vehicleContext: input.vehicle ? {
      plate: '', chassisNo: 'TESTVIN1234567890', engineNo: 'ENGINE-RAW', make: 'Test Marka', model: 'Test Model',
      modelYear: '2024', fuelType: 'Benzin', engineDisplacement: '1600', transmission: 'Otomatik', bodyType: 'Sedan', damageDirection: 'On',
    } : undefined,
    audit: [{ at: input.createdAt, by: 'Sentetik', computer: 'TEST-PC', action: 'tracking-file-created', text: '' }],
  })
}

async function writeSource(
  root: string,
  relativeFolder: string,
  input: SourceInput | string | null,
  evidenceFiles: readonly (string | { readonly path: string; readonly content: string | Uint8Array })[] = [],
): Promise<string> {
  const folder = join(root, relativeFolder)
  await mkdir(join(folder, '_HASARBOTU'), { recursive: true })
  if (input !== null) {
    await writeFile(join(folder, '_HASARBOTU', 'takip.json'), typeof input === 'string' ? input : takipJson(input), 'utf8')
  }
  for (const evidenceFile of evidenceFiles) {
    const target = join(folder, typeof evidenceFile === 'string' ? evidenceFile : evidenceFile.path)
    await mkdir(dirname(target), { recursive: true })
    if (typeof evidenceFile === 'string') await writeFile(target, 'sentetik-ruhsat-evidence', 'utf8')
    else await writeFile(target, evidenceFile.content)
  }
  return folder
}

function syntheticTextPdf(text: string): Buffer {
  const content = `BT /F1 14 Tf 50 750 Td (${text.replace(/[\\()]/gu, '\\$&')}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ]
  const parts = ['%PDF-1.4\n%synthetic\n']; const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(parts.join('')))
    parts.push(`${index + 1} 0 obj\n${object}\nendobj\n`)
  }
  const xref = Buffer.byteLength(parts.join(''))
  parts.push(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return Buffer.from(parts.join(''), 'ascii')
}

function syntheticTextPng(lines: readonly string[]): Buffer {
  const canvas = createCanvas(1800, 520)
  const context = canvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#000000'
  context.font = 'bold 64px Arial'
  lines.forEach((line, index) => context.fillText(line, 60, 100 + index * 115))
  return canvas.toBuffer('image/png')
}

describeDb('V1 remediation (gercek dosya sistemi + gercek PostgreSQL)', () => {
  let config: DatabaseConfig
  let pool: pg.Pool
  let organizationId: string
  let actorUserId: string
  let responsibleUserId: string
  let omerUserId: string
  let serviceId: string
  let root: string | undefined
  let officeSequence = 20_000

  async function insertCase(plate: string, caseType: 'traffic' | 'casco' = 'traffic', notification: string | null = null): Promise<string> {
    officeSequence += 1
    const id = uuidv7()
    await pool.query(
      `INSERT INTO cases
        (id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,plate,plate_normalized,notification_form_number)
       VALUES ($1,$2,2026,$3,$4,$5,'new_notification',$6,$7,$8)`,
      [id, organizationId, officeSequence, `2026/${officeSequence}`, caseType, plate.replace(/(\d{2})([A-Z]+)(\d+)/u, '$1 $2 $3'), plate, notification],
    )
    return id
  }

  beforeAll(async () => {
    config = assertTestDatabaseUrl(TEST_URL as string)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    organizationId = uuidv7()
    actorUserId = uuidv7()
    responsibleUserId = uuidv7()
    omerUserId = uuidv7()
    serviceId = uuidv7()
    await pool.query('INSERT INTO organizations (id,code,name) VALUES ($1,$2,$3)', [organizationId, 'v1-remediation-test', 'V1 Remediation Test'])
    await pool.query(
      `INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES
       ($1,$4,'actor@test.local','Sentetik Aktor',$5),($2,$4,'responsible@test.local','Sentetik Sorumlu',$5),
       ($3,$4,'omerfaruk.isleyen@baranekspertiz.com','Ömer Faruk',$5)`,
      [actorUserId, responsibleUserId, omerUserId, organizationId, await hashPassword(PASSWORD)],
    )
    await pool.query("INSERT INTO user_roles (user_id,role_id) SELECT $1,id FROM roles WHERE code='admin'", [actorUserId])
    await pool.query("INSERT INTO user_roles (user_id,role_id) SELECT $1,id FROM roles WHERE code='expert'", [responsibleUserId])
    await pool.query(
      "INSERT INTO service_centers (id,organization_id,name,center_type,service_type) VALUES ($1,$2,'Sentetik Servis','ozel','private')",
      [serviceId, organizationId],
    )
  }, 60_000)

  afterAll(async () => {
    if (pool !== undefined) await closeDatabasePool(pool)
  })

  afterEach(async () => {
    if (root !== undefined) await rm(root, { recursive: true, force: true })
    root = undefined
  })

  it('preview blocked oge notlarini actionable saymaz; malformed/missing/ambiguous kategorilerini ayirir', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-remediation-'))
    const month = '2026/Temmuz 2026'
    await writeSource(root, `${month}/34AAA111`, {
      caseKey: 'case-a', createdAt: '2026-07-01T07:00:00Z',
      notes: [{ id: 'note-a', text: 'Actionable note' }],
    })
    await writeSource(root, `${month}/34BBB222`, {
      caseKey: 'case-b', createdAt: '2026-07-02T07:00:00Z', claimType: '',
      notes: [{ id: 'note-b1', text: 'Blocked one' }, { id: 'note-b2', text: 'Blocked two' }],
    })
    await insertCase('34CCC333')
    await insertCase('34CCC333')
    await writeSource(root, `${month}/34CCC333`, {
      caseKey: 'case-c', createdAt: '2026-07-03T07:00:00Z',
      notes: [{ id: 'note-c', text: 'Ambiguous note' }],
    })
    await writeSource(root, `${month}/34DDD444`, '{ malformed')
    await writeSource(root, `${month}/34EEE555`, null)

    const plan = await planV1Remediation(pool, organizationId, root)
    expect(plan.summary.actionable.notesToCreate).toBe(1)
    expect(plan.summary.actionable.tasksToCreate).toBe(0)
    expect(plan.summary.quarantine).toMatchObject({
      total: 3, claimTypeUnresolved: 1, ambiguousTarget: 1, genuineEvidenceConflict: 0, malformedSource: 1,
    })
    expect(plan.summary.nonBlockingLegacy.missingSidecar).toBe(1)
    expect(plan.entries.find((entry) => entry.targetState === 'missing_sidecar')?.missingSidecarClassification)
      .toMatchObject({ state: 'non_blocking_no_historical_payload', existingV2CaseCount: 0 })
    expect(plan.summary.duplicatesThatWouldBeCreated).toBe(0)
  })

  it('malformed source raw evidence olarak quarantine edilir; guvenli source apply yolunu bloke etmez', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-remediation-'))
    const month = '2026/Temmuz 2026'
    await writeSource(root, `${month}/34QAA101`, {
      caseKey: 'safe-near-malformed', createdAt: '2026-07-03T08:00:00Z',
    })
    await writeSource(root, `${month}/34QAA102`, '{ malformed-but-preserved')
    const plan = await planV1Remediation(pool, organizationId, root)
    expect(plan.summary.actionable.casesToCreate).toBe(1)
    expect(plan.summary.quarantine).toMatchObject({ total: 1, malformedSource: 1, toRecord: 1 })
    const result = await applyV1Remediation(pool, { organizationId, actorUserId, requestId: 'malformed-quarantine' }, plan)
    expect(result).toMatchObject({ casesCreated: 1, quarantinesRecorded: 1, failed: 0 })
    const stored = await pool.query<{ stable_source_identity: string | null; raw_source_text: string | null; reason: string }>(
      `SELECT stable_source_identity,raw_source_text,reason FROM v1_import_source_quarantines
        WHERE organization_id=$1 AND reason='malformed_source' ORDER BY quarantined_at DESC LIMIT 1`, [organizationId],
    )
    expect(stored.rows[0]).toMatchObject({ stable_source_identity: null, raw_source_text: '{ malformed-but-preserved', reason: 'malformed_source' })
  })

  it('ruhsat filename evidence recursive taranir; K/M cozulur, S/conflict fail-closed kalir ve provenance korunur', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-remediation-'))
    const month = '2026/Ağustos 2026'
    const kFolder = await writeSource(root, `${month}/34KAA101`, {
      caseKey: 'claim-evidence-k', createdAt: '2026-08-01T07:00:00Z', claimType: '',
    }, ['EVRAK/ALT/K_RÜHSAT.PDF'])
    await writeSource(root, `${month}/34MAA202`, {
      caseKey: 'claim-evidence-m', createdAt: '2026-08-02T07:00:00Z', claimType: '',
    }, ['EVRAK/M-Ruhsat'])
    await writeSource(root, `${month}/34SAA303`, {
      caseKey: 'claim-evidence-s', createdAt: '2026-08-03T07:00:00Z', claimType: '',
    }, ['EVRAK/S_RUHSAT.txt'])
    await writeSource(root, `${month}/34CAA404`, {
      caseKey: 'claim-evidence-km', createdAt: '2026-08-04T07:00:00Z', claimType: '',
    }, ['EVRAK/K RUHSAT.jpeg', 'EVRAK/M_RUHSAT.png'])
    await writeSource(root, `${month}/34DAA505`, {
      caseKey: 'claim-evidence-sidecar-conflict', createdAt: '2026-08-05T07:00:00Z', claimType: 'trafik',
    }, ['EVRAK/K-RUHSAT.tiff'])

    const plan = await planV1Remediation(pool, organizationId, root)
    const byFolder = new Map(plan.entries.map((entry) => [entry.folder.folderName, entry]))
    expect(byFolder.get('34KAA101')).toMatchObject({
      targetState: 'create', caseType: 'casco', caseTypeAutoResolved: true,
      claimTypeResolution: { resolutionReason: 'k_ruhsat', quarantined: false },
    })
    expect(byFolder.get('34KAA101')?.claimTypeResolution?.evidence).toEqual([
      { kind: 'k_ruhsat', sourceRelativePath: `${month}/34KAA101/EVRAK/ALT/K_RÜHSAT.PDF` },
    ])
    expect(byFolder.get('34MAA202')).toMatchObject({
      targetState: 'create', caseType: 'traffic', caseTypeAutoResolved: true,
      claimTypeResolution: { resolutionReason: 'm_ruhsat', quarantined: false },
    })
    expect(byFolder.get('34SAA303')).toMatchObject({
      targetState: 'quarantined_claim_type', caseType: null,
      quarantine: { reason: 'claim_type_unresolved' },
      claimTypeResolution: { resolutionReason: 'no_deterministic_evidence', quarantined: true },
    })
    expect(byFolder.get('34CAA404')).toMatchObject({
      targetState: 'quarantined_claim_type', blockers: ['conflicting_claim_type_evidence'],
      quarantine: { reason: 'genuine_evidence_conflict' },
      claimTypeResolution: { deterministicReason: 'conflicting_k_m_evidence', quarantined: true },
    })
    expect(byFolder.get('34DAA505')).toMatchObject({
      targetState: 'create', caseType: 'casco',
      claimTypeResolution: { deterministicReason: 'k_ruhsat', quarantined: false, sidecarConflictPreserved: true },
    })
    expect(plan.summary.actionable.casesToCreate).toBe(3)
    expect(plan.summary.autoResolved.unknownClaimTypes).toBe(2)
    expect(plan.summary.quarantine).toMatchObject({ total: 2, claimTypeUnresolved: 1, genuineEvidenceConflict: 1 })

    const result = await applyV1Remediation(pool, { organizationId, actorUserId, requestId: 'claim-evidence-apply' }, plan)
    expect(result).toMatchObject({ casesCreated: 3, claimTypeEvidenceRecorded: 3, quarantinesRecorded: 2, failed: 0 })
    const created = await pool.query<{ plate_normalized: string; case_type: string }>(
      "SELECT plate_normalized,case_type FROM cases WHERE organization_id=$1 AND plate_normalized IN ('34KAA101','34MAA202','34DAA505') ORDER BY plate_normalized",
      [organizationId],
    )
    expect(created.rows).toEqual([
      { plate_normalized: '34DAA505', case_type: 'casco' },
      { plate_normalized: '34KAA101', case_type: 'casco' },
      { plate_normalized: '34MAA202', case_type: 'traffic' },
    ].sort((left, right) => left.plate_normalized.localeCompare(right.plate_normalized)))
    const provenance = await pool.query<{ field_diffs: { claimTypeResolution?: { evidence?: unknown[] } } }>(
      "SELECT field_diffs FROM v1_import_records WHERE organization_id=$1 AND item_type='field_backfill' AND source_item_id LIKE 'field:claimTypeEvidence:%'",
      [organizationId],
    )
    expect(provenance.rows).toHaveLength(3)
    expect(provenance.rows.every((row) => (row.field_diffs.claimTypeResolution?.evidence?.length ?? 0) > 0)).toBe(true)
    const quarantineRows = await pool.query<{ reason: string }>(
      `SELECT reason FROM v1_import_source_quarantines
        WHERE organization_id=$1 AND mapping_version='v1-remediation/2.3.0'
          AND reason IN ('claim_type_unresolved','genuine_evidence_conflict') ORDER BY reason`, [organizationId],
    )
    expect(quarantineRows.rows.map((row) => row.reason)).toEqual(['claim_type_unresolved', 'genuine_evidence_conflict'])
    const quarantineAudits = await pool.query(
      "SELECT count(*)::int AS n FROM audit_events WHERE organization_id=$1 AND action='v1_remediation.quarantined'", [organizationId],
    )
    expect(quarantineAudits.rows[0].n).toBeGreaterThanOrEqual(2)

    const replay = await planV1Remediation(pool, organizationId, root)
    expect(replay.summary.actionable.casesToCreate).toBe(0)
    expect(replay.summary.quarantine).toMatchObject({ total: 2, toRecord: 0 })
    expect(replay.summary.duplicatesThatWouldBeCreated).toBe(0)
    expect(replay.entries.find((entry) => entry.folder.folderName === '34KAA101')?.needsClaimTypeEvidenceProvenance).toBe(false)
    const replayApply = await applyV1Remediation(pool, { organizationId, actorUserId, requestId: 'claim-evidence-replay' }, replay)
    expect(replayApply).toMatchObject({ casesCreated: 0, quarantinesRecorded: 0, failed: 0 })

    const movedParent = join(root, month, 'KAPALI AĞUSTOS 2026')
    await mkdir(movedParent, { recursive: true })
    await rename(kFolder, join(movedParent, '34KAA101 - YENI'))
    const moved = await planV1Remediation(pool, organizationId, root)
    const movedEntry = moved.entries.find((entry) => entry.folder.folderName === '34KAA101 - YENI')
    expect(movedEntry).toMatchObject({ caseType: 'casco', targetState: 'existing' })
    expect(movedEntry?.sourceIdentity).toBe(byFolder.get('34KAA101')?.sourceIdentity)
    expect(movedEntry?.claimTypeResolution?.evidenceFingerprint)
      .toBe(byFolder.get('34KAA101')?.claimTypeResolution?.evidenceFingerprint)
    expect(movedEntry?.claimTypeResolution?.evidence[0]?.sourceRelativePath)
      .toContain('KAPALI AĞUSTOS 2026/34KAA101 - YENI/EVRAK/ALT/K_RÜHSAT.PDF')
    expect(moved.summary.duplicatesThatWouldBeCreated).toBe(0)
  })

  it('authoritative K Ruhsat sidecar/context sinyalini ezer; genel context tek basina tur saymaz', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-remediation-'))
    await writeSource(root, '2026/Agustos 2026/34EVA101', {
      caseKey: 'corroborated-traffic', createdAt: '2026-08-05T08:00:00Z', claimType: 'trafik',
    }, ['EVRAK/K RUHSAT.jpg', 'EVRAK/M Trafik Poliçe.pdf', 'EVRAK/KTT.jpg'])
    await writeSource(root, '2026/Agustos 2026/34EVA102', {
      caseKey: 'context-only', createdAt: '2026-08-05T09:00:00Z', claimType: '',
    }, ['EVRAK/Trafik Poliçesi.txt', 'EVRAK/ZABIT.txt', 'EVRAK/BEYAN.txt'])
    const plan = await planV1Remediation(pool, organizationId, root)
    const byKey = new Map(plan.entries.map((entry) => [entry.rawSnapshot?.caseIdentity?.caseKey, entry]))
    expect(byKey.get('corroborated-traffic')).toMatchObject({
      targetState: 'create', caseType: 'casco',
      claimTypeResolution: { resolutionReason: 'k_ruhsat', sidecarConflictPreserved: true },
    })
    expect(byKey.get('context-only')).toMatchObject({
      targetState: 'quarantined_claim_type', caseType: null,
      claimTypeResolution: { resolutionReason: 'no_deterministic_evidence' },
    })
  })

  it('yerel PDF text evidence explicit Trafik/Kasko policeyi cozer; celiski ve kanitsiz source quarantine kalir', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-remediation-'))
    const month = '2026/Agustos 2026'
    const trafficPdf = syntheticTextPdf('ZORUNLU MALI SORUMLULUK SIGORTASI POLICE NO 123 SIGORTALI TEST NET PRIM 1')
    const cascoPdf = syntheticTextPdf('KARA ARACLARI KASKO SIGORTASI POLICE NO 456 SIGORTALI TEST BRUT PRIM 2')
    const genericPdf = syntheticTextPdf('POLICE NO 789 SIGORTALI TEST NET PRIM 3')
    const trafficPng = syntheticTextPng(['TRAFIK SIGORTASI', 'POLICE NO 321', 'SIGORTALI TEST', 'NET PRIM 4'])
    await writeSource(root, `${month}/34PDF101`, {
      caseKey: 'pdf-traffic', createdAt: '2026-08-07T08:00:00Z', claimType: '',
    }, [
      { path: 'EVRAK/policy.pdf', content: trafficPdf },
      { path: 'EVRAK/empty-scan.pdf', content: new Uint8Array() },
      { path: 'HASAR/unreadable.jpg', content: 'not-an-image' },
    ])
    await writeSource(root, `${month}/34PDF102`, {
      caseKey: 'pdf-casco', createdAt: '2026-08-07T09:00:00Z', claimType: '',
    }, [{ path: 'EVRAK/policy.pdf', content: cascoPdf }])
    await writeSource(root, `${month}/34PDF103`, {
      caseKey: 'pdf-conflict', createdAt: '2026-08-07T10:00:00Z', claimType: '',
    }, [{ path: 'EVRAK/traffic.pdf', content: trafficPdf }, { path: 'EVRAK/casco.pdf', content: cascoPdf }])
    await writeSource(root, `${month}/34PDF104`, {
      caseKey: 'pdf-unresolved', createdAt: '2026-08-07T11:00:00Z', claimType: '',
    }, [{ path: 'EVRAK/policy.pdf', content: genericPdf }])
    await writeSource(root, `${month}/34PDF105`, {
      caseKey: 'ocr-traffic', createdAt: '2026-08-07T12:00:00Z', claimType: '',
    }, [{ path: 'EVRAK/policy.png', content: trafficPng }])

    const plan = await planV1Remediation(pool, organizationId, root)
    const byKey = new Map(plan.entries.map((entry) => [entry.rawSnapshot?.caseIdentity?.caseKey, entry]))
    expect(byKey.get('pdf-traffic')).toMatchObject({
      targetState: 'create', caseType: 'traffic',
      claimTypeResolution: { resolutionReason: 'traffic_policy_content' },
    })
    expect(byKey.get('pdf-casco')).toMatchObject({
      targetState: 'create', caseType: 'casco',
      claimTypeResolution: { resolutionReason: 'casco_policy_content' },
    })
    expect(byKey.get('pdf-conflict')).toMatchObject({
      targetState: 'quarantined_claim_type', quarantine: { reason: 'genuine_evidence_conflict' },
    })
    expect(byKey.get('pdf-unresolved')).toMatchObject({
      targetState: 'quarantined_claim_type', quarantine: { reason: 'claim_type_unresolved' },
    })
    expect(byKey.get('ocr-traffic')).toMatchObject({
      targetState: 'create', caseType: 'traffic',
      claimTypeResolution: { resolutionReason: 'traffic_policy_content' },
    })
    expect(byKey.get('ocr-traffic')?.claimTypeResolution?.evidence[0]).toMatchObject({ extractionMethod: 'local_ocr' })
    const evidence = byKey.get('pdf-traffic')?.claimTypeResolution?.evidence[0]
    expect(evidence).toMatchObject({ kind: 'traffic_policy_content', extractionMethod: 'pdf_text' })
    expect(evidence?.sourceFileHash).toMatch(/^[0-9a-f]{64}$/u)
    expect(JSON.stringify(evidence)).not.toContain('ZORUNLU')

    const result = await applyV1Remediation(pool, { organizationId, actorUserId, requestId: 'pdf-evidence' }, plan)
    expect(result).toMatchObject({ casesCreated: 3, quarantinesRecorded: 2, failed: 0 })
    const quarantines = await pool.query<{ reason: string }>(
      'SELECT reason FROM v1_import_source_quarantines WHERE organization_id=$1 ORDER BY reason', [organizationId],
    )
    expect(quarantines.rows.map((row) => row.reason)).toEqual(expect.arrayContaining(['claim_type_unresolved', 'genuine_evidence_conflict']))
  }, 30_000)

  it('legacy responsible/expert/service degerlerini yanlis hesaba baglamadan non-blocking korur', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-remediation-'))
    await writeSource(root, '2026/Agustos 2026/34REF101', {
      caseKey: 'omer-email-identity', createdAt: '2026-08-06T08:00:00Z', responsible: 'Ömer Faruk İşleyen',
      expert: 'Baran Gürbüz', service: 'GÜNEY',
    })
    await writeSource(root, '2026/Agustos 2026/34REF102', {
      caseKey: 'unassigned-sentinel', createdAt: '2026-08-06T09:00:00Z', responsible: 'Atanmadı', expert: 'Baran Gürbüz',
    })
    await writeSource(root, '2026/Agustos 2026/34REF103', {
      caseKey: 'legacy-user', createdAt: '2026-08-06T10:00:00Z', responsible: 'Enes Özmen', expert: 'Baran Gürbüz',
    })
    const plan = await planV1Remediation(pool, organizationId, root)
    const byKey = new Map(plan.entries.map((entry) => [entry.rawSnapshot?.caseIdentity?.caseKey, entry]))
    expect(byKey.get('omer-email-identity')?.responsible).toMatchObject({
      state: 'auto_resolved', targetId: omerUserId, resolutionReason: 'exact_email_identity',
    })
    expect(byKey.get('unassigned-sentinel')?.responsible).toMatchObject({
      state: 'legacy_unassigned', targetId: null, resolutionReason: 'unassigned_sentinel',
    })
    expect(byKey.get('legacy-user')?.responsible).toMatchObject({ state: 'legacy_only', targetId: null })
    expect(byKey.get('legacy-user')?.responsible.targetId).not.toBe(omerUserId)
    expect(plan.entries.every((entry) => entry.expert.targetId !== omerUserId)).toBe(true)
    expect(plan.summary.quarantine.total).toBe(0)
    expect(plan.summary.autoResolved).toMatchObject({ users: 1, unassignedResponsible: 1, servicesPlanned: 0 })
    expect(plan.summary.nonBlockingLegacy).toMatchObject({ responsibleNames: 1, expertNames: 1, serviceNames: 1 })

    const duplicateOne = uuidv7()
    const duplicateTwo = uuidv7()
    await pool.query(
      `INSERT INTO service_centers (id,organization_id,name,center_type,service_type) VALUES
       ($1,$3,'GÜNEY','ozel','private'),($2,$3,'güney','ozel','private')`,
      [duplicateOne, duplicateTwo, organizationId],
    )
    const ambiguousService = await planV1Remediation(pool, organizationId, root)
    expect(ambiguousService.entries.find((entry) => entry.rawSnapshot?.caseIdentity?.caseKey === 'omer-email-identity')?.service)
      .toMatchObject({ state: 'ambiguous_legacy', targetId: null, matchCount: 2 })
    expect(ambiguousService.summary.autoResolved.servicesPlanned).toBe(0)
  })

  it('ilk import; raw revision, historical note/task zamanlari, completed task, events, follow-up ve first-class alanlari korur', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-remediation-'))
    await writeSource(root, '2026/Temmuz 2026/34FFF666', {
      caseKey: 'case-full', createdAt: '2026-07-04T07:00:00Z', claimNoticeNo: 'NOTICE-1', claimFileNo: 'CLAIM-1',
      responsible: 'Sentetik Sorumlu', expert: 'Sentetik Sorumlu', service: 'Sentetik Servis', followUpDate: '2026-07-20',
      notes: [{ id: 'note-full', text: 'Ham tarihsel not', createdAt: '2026-07-04T08:30:00Z', createdBy: 'V1 Yazar' }],
      todos: [
        { id: 'task-open', title: 'Acik gorev', completed: false, assignedTo: 'Sentetik Sorumlu' },
        { id: 'task-done', title: 'Tamamlanan gorev', completed: true, completedAt: '2026-07-05T09:00:00Z' },
      ],
      vehicle: true,
    })
    const plan = await planV1Remediation(pool, organizationId, root)
    expect(plan.schemaReady).toBe(true)
    expect(plan.summary.actionable).toMatchObject({
      casesToCreate: 1, notesToCreate: 1, tasksToCreate: 1, completedTasksToCreate: 1,
    })
    expect(plan.summary.safeRemediation.taskEvents).toBe(3)
    const result = await applyV1Remediation(pool, { organizationId, actorUserId, requestId: 'full-apply' }, plan)
    expect(result).toMatchObject({ failed: 0, casesCreated: 1, notesCreated: 1, tasksCreated: 1, completedTasksCreated: 1 })

    const caseRow = await pool.query(
      `SELECT id::text,notification_form_number,insurer_claim_number,responsible_user_id::text,expert_user_id::text,service_center_id::text,
              to_char(follow_up_date,'YYYY-MM-DD') AS follow_up_date,lifecycle_status
         FROM cases WHERE organization_id=$1 AND plate_normalized='34FFF666'`, [organizationId],
    )
    expect(caseRow.rows[0]).toMatchObject({
      notification_form_number: 'NOTICE-1', insurer_claim_number: 'CLAIM-1', responsible_user_id: responsibleUserId, expert_user_id: responsibleUserId,
      service_center_id: serviceId, follow_up_date: '2026-07-20', lifecycle_status: 'open',
    })
    const caseId = String(caseRow.rows[0].id)
    const note = await pool.query('SELECT body,created_at FROM case_notes WHERE case_id=$1', [caseId])
    expect(note.rows[0].body).toBe('Ham tarihsel not')
    expect((note.rows[0].created_at as Date).toISOString()).toBe('2026-07-04T08:30:00.000Z')
    const tasks = await pool.query('SELECT status,version,resolved_at FROM case_tasks WHERE case_id=$1 ORDER BY status', [caseId])
    expect(tasks.rows.map((row) => row.status)).toEqual(['completed', 'open'])
    expect(tasks.rows[0]).toMatchObject({ status: 'completed', version: 2 })
    expect((tasks.rows[0].resolved_at as Date).toISOString()).toBe('2026-07-05T09:00:00.000Z')
    const counts = await pool.query(
      `SELECT
        (SELECT count(*)::int FROM case_task_events WHERE case_id=$1) AS events,
        (SELECT count(*)::int FROM case_follow_up_history WHERE case_id=$1 AND source='v1_historical_import') AS followups,
        (SELECT count(*)::int FROM v1_import_source_revisions r WHERE r.organization_id=$2
          AND r.stable_source_identity IN (SELECT stable_source_identity FROM v1_import_records WHERE case_id=$1)) AS revisions,
        (SELECT count(*)::int FROM v1_import_item_metadata WHERE organization_id=$2 AND case_id=$1) AS metadata,
        (SELECT count(*)::int FROM case_vehicle_profiles WHERE case_id=$1) AS profiles`,
      [caseId, organizationId],
    )
    expect(counts.rows[0]).toMatchObject({ events: 3, followups: 1, revisions: 1, profiles: 1 })
    expect(counts.rows[0].metadata).toBeGreaterThanOrEqual(5)
    const taskEvents = await pool.query(
      'SELECT event_type,event_source,source_identity,source_evidence FROM case_task_events WHERE case_id=$1 ORDER BY occurred_at,event_type',
      [caseId],
    )
    expect(taskEvents.rows).toHaveLength(3)
    expect(taskEvents.rows.every((event) => event.event_source === 'v1_historical_import'
      && event.source_identity !== null && event.source_evidence?.mappingVersion === 'v1-remediation/2.3.0')).toBe(true)
    const raw = await pool.query('SELECT raw_snapshot FROM v1_import_source_revisions WHERE organization_id=$1', [organizationId])
    expect(raw.rows[0].raw_snapshot.portalChecklist).toHaveLength(1)
    expect(raw.rows[0].raw_snapshot.assignment.raportor).toBe('Sentetik Raportor')
    const apiView = await createCaseOperationsStore(pool).read(organizationId, caseId, '2026-07-16', true)
    expect(apiView?.notes[0]).toMatchObject({
      body: 'Ham tarihsel not',
      createdAt: '2026-07-04T08:30:00.000Z',
      legacySource: { historical: true, authorName: 'V1 Yazar', occurredAt: '2026-07-04T08:30:00.000Z' },
    })
    expect(apiView?.tasks.find((task) => task.status === 'completed')?.legacySource).toMatchObject({
      historical: true,
      completedAt: '2026-07-05T09:00:00.000Z',
    })
    expect(apiView?.followUpHistory[0]?.source).toBe('v1_historical_import')
  })

  it('same-source replay ve ayni metinli iki mesru note native ID ile duplicate uretmez', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-remediation-'))
    await writeSource(root, '2026/Temmuz 2026/34GGG777', {
      caseKey: 'case-duplicate-text', createdAt: '2026-07-06T07:00:00Z',
      notes: [{ id: 'note-same-1', text: 'Ayni metin' }, { id: 'note-same-2', text: 'Ayni metin' }],
    })
    const first = await planV1Remediation(pool, organizationId, root)
    await applyV1Remediation(pool, { organizationId, actorUserId, requestId: 'replay-1' }, first)
    const auditBefore = await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE organization_id=$1 AND action='v1_remediation.applied'", [organizationId])
    const second = await planV1Remediation(pool, organizationId, root)
    expect(second.summary.actionable.notesToCreate).toBe(0)
    expect(second.summary.duplicatesThatWouldBeCreated).toBe(0)
    const replay = await applyV1Remediation(pool, { organizationId, actorUserId, requestId: 'replay-2' }, second)
    expect(replay).toMatchObject({ notesCreated: 0, tasksCreated: 0, completedTasksCreated: 0, historicalClosures: 0, failed: 0 })
    const auditAfter = await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE organization_id=$1 AND action='v1_remediation.applied'", [organizationId])
    expect(auditAfter.rows[0].n).toBe(auditBefore.rows[0].n)
    const count = await pool.query(
      `SELECT count(*)::int AS n FROM case_notes n JOIN cases c ON c.id=n.case_id
        WHERE c.organization_id=$1 AND c.plate_normalized='34GGG777'`, [organizationId],
    )
    expect(count.rows[0].n).toBe(2)
  })

  it('active -> KAPALI move ve ay klasoru rename sonrasi stable identity ile replay eder, closure import eder', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-remediation-'))
    const active = await writeSource(root, '2026/Temmuz 2026/34HHH888', {
      caseKey: 'case-move', createdAt: '2026-07-07T07:00:00Z',
      notes: [{ id: 'note-move', text: 'Tasinan not' }],
    })
    const first = await planV1Remediation(pool, organizationId, root)
    await applyV1Remediation(pool, { organizationId, actorUserId, requestId: 'move-1' }, first)

    const closed = join(root, '2026', 'Temmuz 2026', 'KAPALI TEMMUZ 2026', '34HHH888')
    await mkdir(dirname(closed), { recursive: true })
    await rename(active, closed)
    const moved = await planV1Remediation(pool, organizationId, root)
    expect(moved.summary.actionable.notesToCreate).toBe(0)
    expect(moved.summary.actionable.closuresToImport).toBe(1)
    expect(moved.summary.duplicatesThatWouldBeCreated).toBe(0)
    await applyV1Remediation(pool, { organizationId, actorUserId, requestId: 'move-2' }, moved)
    const closedCase = await pool.query("SELECT lifecycle_status,closed_at FROM cases WHERE organization_id=$1 AND plate_normalized='34HHH888'", [organizationId])
    expect(closedCase.rows[0]).toMatchObject({ lifecycle_status: 'closed', closed_at: null })
    const history = await pool.query("SELECT history_source,operation_type,source_occurred_at FROM case_lifecycle_history WHERE case_id=(SELECT id FROM cases WHERE organization_id=$1 AND plate_normalized='34HHH888')", [organizationId])
    expect(history.rows[0]).toMatchObject({ history_source: 'v1_historical_import', operation_type: 'historical_close', source_occurred_at: null })

    await writeFile(join(closed, '_HASARBOTU', 'takip.json'), takipJson({
      caseKey: 'case-move', createdAt: '2026-07-07T07:00:00Z', closed: true, claimNoticeNo: 'NOTICE-CLOSED',
      notes: [{ id: 'note-move', text: 'Tasinan not' }],
    }), 'utf8')
    const closedBackfill = await planV1Remediation(pool, organizationId, root)
    expect(closedBackfill.summary.actionable.otherFieldMappings).toBeGreaterThanOrEqual(1)
    await applyV1Remediation(pool, { organizationId, actorUserId, requestId: 'move-closed-backfill' }, closedBackfill)
    const closedField = await pool.query("SELECT notification_form_number FROM cases WHERE organization_id=$1 AND plate_normalized='34HHH888'", [organizationId])
    expect(closedField.rows[0].notification_form_number).toBe('NOTICE-CLOSED')

    await rename(join(root, '2026', 'Temmuz 2026'), join(root, '2026', 'Temmuz Arsiv'))
    const renamed = await planV1Remediation(pool, organizationId, root)
    expect(renamed.summary.actionable.notesToCreate).toBe(0)
    expect(renamed.summary.actionable.closuresToImport).toBe(0)
    expect(renamed.summary.duplicatesThatWouldBeCreated).toBe(0)
  })

  it('ayni plaka iki gercek case ve farkli source identity ile iki ayri case olusturur', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-remediation-'))
    await writeSource(root, '2026/Mayis 2026/34III999', { caseKey: 'case-i-1', createdAt: '2026-05-01T07:00:00Z', claimType: 'trafik' })
    await writeSource(root, '2026/Mayis 2026/34III999 - 2', { caseKey: 'case-i-2', createdAt: '2026-05-02T07:00:00Z', claimType: 'kasko' })
    const plan = await planV1Remediation(pool, organizationId, root)
    expect(plan.summary.actionable.casesToCreate).toBe(2)
    await applyV1Remediation(pool, { organizationId, actorUserId, requestId: 'same-plate' }, plan)
    const cases = await pool.query("SELECT case_type FROM cases WHERE organization_id=$1 AND plate_normalized='34III999' ORDER BY case_type", [organizationId])
    expect(cases.rows.map((row) => row.case_type)).toEqual(['casco', 'traffic'])
  })

  it('unknown type unique existing case ile auto-resolve olur; gercek unknown/ambiguous source quarantine kalir; exact notice hedefi cozer', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-remediation-'))
    const uniqueId = await insertCase('34JJJ000', 'casco')
    await writeSource(root, '2026/Haziran 2026/34JJJ000', {
      caseKey: 'unknown-unique', createdAt: '2026-06-01T07:00:00Z', claimType: '', notes: [{ id: 'note-unknown-resolved', text: 'Resolved' }],
    })
    await writeSource(root, '2026/Haziran 2026/34KKK111', { caseKey: 'unknown-true', createdAt: '2026-06-02T07:00:00Z', claimType: '' })
    await insertCase('34LLL222', 'traffic', 'NOTICE-A')
    const exactTarget = await insertCase('34LLL222', 'traffic', 'NOTICE-B')
    await writeSource(root, '2026/Haziran 2026/34LLL222', {
      caseKey: 'ambiguous-exact', createdAt: '2026-06-03T07:00:00Z', claimNoticeNo: 'NOTICE-B', notes: [{ id: 'note-exact', text: 'Exact' }],
    })
    await insertCase('34MMM333')
    await insertCase('34MMM333')
    await writeSource(root, '2026/Haziran 2026/34MMM333', { caseKey: 'ambiguous-true', createdAt: '2026-06-04T07:00:00Z' })

    const plan = await planV1Remediation(pool, organizationId, root)
    const byIdentity = new Map(plan.entries.map((entry) => [entry.rawSnapshot?.caseIdentity?.caseKey, entry]))
    expect(byIdentity.get('unknown-unique')).toMatchObject({ targetCaseId: uniqueId, caseType: 'casco', caseTypeAutoResolved: true })
    expect(byIdentity.get('unknown-true')?.targetState).toBe('quarantined_claim_type')
    expect(byIdentity.get('ambiguous-exact')).toMatchObject({ targetCaseId: exactTarget, targetState: 'existing' })
    expect(byIdentity.get('ambiguous-true')?.targetState).toBe('quarantined_target')
    expect(plan.summary.autoResolved.unknownClaimTypes).toBeGreaterThanOrEqual(1)
    expect(plan.summary.autoResolved.ambiguousCases).toBeGreaterThanOrEqual(1)
  })

  it('ambiguous source yalniz kendisini quarantine eder ve explicit reconciliation append-only resolution uretir', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-remediation-'))
    const chosenCaseId = await insertCase('34QRN101')
    await insertCase('34QRN101')
    await writeSource(root, '2026/Haziran 2026/34QRN101', {
      caseKey: 'quarantine-reconcile', createdAt: '2026-06-09T07:00:00Z',
      notes: [{ id: 'quarantine-note', text: 'Yalniz secilen case icin' }],
    })
    const quarantined = await planV1Remediation(pool, organizationId, root)
    const source = quarantined.entries[0]!
    expect(source).toMatchObject({ targetState: 'quarantined_target', quarantine: { reason: 'ambiguous_target' } })
    expect(quarantined.summary.actionable.notesToCreate).toBe(0)
    await applyV1Remediation(pool, { organizationId, actorUserId, requestId: 'quarantine-first' }, quarantined)
    const beforeResolution = await pool.query(
      `SELECT count(*)::int AS quarantines,
              (SELECT count(*)::int FROM case_notes WHERE organization_id=$1 AND case_id=$2) AS notes
         FROM v1_import_source_quarantines WHERE organization_id=$1 AND stable_source_identity=$3`,
      [organizationId, chosenCaseId, source.sourceIdentity],
    )
    expect(beforeResolution.rows[0]).toMatchObject({ quarantines: 1, notes: 0 })

    const options = {
      resolutions: {
        schemaVersion: 'hasarbotu-v1-resolution/1.0.0' as const,
        cases: { [source.sourceIdentity!]: chosenCaseId },
      },
    }
    const resolvedPlan = await planV1Remediation(pool, organizationId, root, options)
    expect(resolvedPlan.entries[0]).toMatchObject({ targetState: 'existing', targetCaseId: chosenCaseId })
    expect(resolvedPlan.entries[0]?.quarantineResolutionIds).toHaveLength(1)
    const applied = await applyV1Remediation(
      pool, { organizationId, actorUserId, requestId: 'quarantine-resolved' }, resolvedPlan, options,
    )
    expect(applied).toMatchObject({ notesCreated: 1, quarantineResolutionsRecorded: 1, failed: 0 })
    const status = await pool.query<{ resolved: boolean; resolution_kind: string }>(
      `SELECT resolved,resolution_kind FROM v1_import_quarantine_status
        WHERE organization_id=$1 AND quarantine_identity=$2`,
      [organizationId, source.quarantine?.quarantineIdentity],
    )
    expect(status.rows).toEqual([{ resolved: true, resolution_kind: 'explicit_reconciliation' }])
  })

  it('exact identifier ile baglanan kardes source sonrasi tek kalan candidate bire-bir eliminasyonla cozulur', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-remediation-'))
    const exact = await insertCase('34SIB101', 'traffic', 'NOTICE-SIBLING')
    const remaining = await insertCase('34SIB101', 'traffic')
    await writeSource(root, '2026/Haziran 2026/34SIB101', {
      caseKey: 'sibling-exact', createdAt: '2026-06-10T08:00:00Z', claimNoticeNo: 'NOTICE-SIBLING',
    })
    await writeSource(root, '2026/Haziran 2026/34SIB101 - 2', {
      caseKey: 'sibling-remaining', createdAt: '2026-06-11T08:00:00Z',
    })
    const plan = await planV1Remediation(pool, organizationId, root)
    const byKey = new Map(plan.entries.map((entry) => [entry.rawSnapshot?.caseIdentity?.caseKey, entry]))
    expect(byKey.get('sibling-exact')?.targetCaseId).toBe(exact)
    expect(byKey.get('sibling-remaining')).toMatchObject({ targetCaseId: remaining, targetState: 'existing' })
    expect(byKey.get('sibling-remaining')?.evidence).toContainEqual({
      code: 'sibling_source_candidate_elimination', verifiableValue: remaining,
    })
  })

  it('kanitlanmis eski import ay bloklari ambiguous targeti cozer; ayni ayda iki aday fail-closed kalir', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-remediation-'))
    const occurredAt = '2026-08-10T14:28:06.000Z'
    const insertHistoricalCase = async (plate: string, sequence: number): Promise<string> => {
      const id = uuidv7()
      await pool.query(
        `INSERT INTO cases
          (id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,plate,plate_normalized,created_at,updated_at)
         VALUES ($1,$2,2026,$3,$4,'traffic','new_notification',$5,$6,$7,$7)`,
        [id, organizationId, sequence, `2026/${sequence}`, plate.replace(/(\d{2})([A-Z]+)(\d+)/u, '$1 $2 $3'), plate, occurredAt],
      )
      await pool.query(
        `INSERT INTO audit_events (id,organization_id,actor_user_id,action,resource_type,resource_id,request_id,occurred_at,details)
         VALUES ($1,$2,$3,'case.created','case',$4,$5,$6,'{}'::jsonb)`,
        [uuidv7(), organizationId, actorUserId, id, uuidv7(), occurredAt],
      )
      return id
    }
    const mayAnchors = [41_000, 41_001, 41_003, 41_004, 41_005, 41_006]
    const juneAnchors = [41_010, 41_011, 41_013, 41_014, 41_015, 41_016]
    for (const [index, sequence] of mayAnchors.entries()) {
      const plate = `34L${String.fromCharCode(65 + index)}A${100 + index}`
      await insertHistoricalCase(plate, sequence)
      await writeSource(root, `2026/Mayis 2026/${plate}`, { caseKey: `anchor-may-${index}`, createdAt: `2026-05-${10 + index}T08:00:00Z` })
    }
    for (const [index, sequence] of juneAnchors.entries()) {
      const plate = `34L${String.fromCharCode(65 + index)}B${200 + index}`
      await insertHistoricalCase(plate, sequence)
      await writeSource(root, `2026/Haziran 2026/${plate}`, { caseKey: `anchor-june-${index}`, createdAt: `2026-06-${10 + index}T08:00:00Z` })
    }
    const mayTarget = await insertHistoricalCase('34LZZ999', 41_002)
    const juneTarget = await insertHistoricalCase('34LZZ999', 41_012)
    await writeSource(root, '2026/Mayis 2026/34LZZ999', { caseKey: 'lineage-may', createdAt: '2026-05-20T08:00:00Z' })
    await writeSource(root, '2026/Haziran 2026/34LZZ999', { caseKey: 'lineage-june', createdAt: '2026-06-20T08:00:00Z' })

    const plan = await planV1Remediation(pool, organizationId, root)
    const byKey = new Map(plan.entries.map((entry) => [entry.rawSnapshot?.caseIdentity?.caseKey, entry]))
    expect(byKey.get('lineage-may')).toMatchObject({ targetCaseId: mayTarget, targetState: 'existing' })
    expect(byKey.get('lineage-june')).toMatchObject({ targetCaseId: juneTarget, targetState: 'existing' })
    expect(byKey.get('lineage-may')?.evidence.some((item) => item.code === 'initial_import_month_lineage')).toBe(true)

    const sameMonthLeft = await insertHistoricalCase('34LYY888', 41_007)
    const sameMonthRight = await insertHistoricalCase('34LYY888', 41_008)
    await writeSource(root, '2026/Mayis 2026/34LYY888', { caseKey: 'same-month-left', createdAt: '2026-05-21T08:00:00Z' })
    await writeSource(root, '2026/Mayis 2026/34LYY888 - 2', { caseKey: 'same-month-right', createdAt: '2026-05-22T08:00:00Z' })
    const failClosed = await planV1Remediation(pool, organizationId, root)
    expect([sameMonthLeft, sameMonthRight]).toHaveLength(2)
    expect(failClosed.entries.filter((entry) => entry.rawSnapshot?.caseIdentity?.caseKey?.startsWith('same-month-'))
      .every((entry) => entry.targetState === 'quarantined_target')).toBe(true)
  })

  it('source preview sonrasi degisirse TOCTOU fail-closed olur ve mutation yapmaz', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-remediation-'))
    const folder = await writeSource(root, '2026/Agustos 2026/34NNN444', {
      caseKey: 'case-toctou', createdAt: '2026-08-01T07:00:00Z', notes: [{ id: 'note-before', text: 'Once' }],
    })
    const plan = await planV1Remediation(pool, organizationId, root)
    const current = JSON.parse(await readFile(join(folder, '_HASARBOTU', 'takip.json'), 'utf8')) as Record<string, unknown>
    current.notes = [{ id: 'note-after', text: 'Sonra', createdAt: '2026-08-01T08:00:00Z', createdBy: 'Sentetik' }]
    await writeFile(join(folder, '_HASARBOTU', 'takip.json'), JSON.stringify(current), 'utf8')
    await expect(applyV1Remediation(pool, { organizationId, actorUserId, requestId: 'toctou' }, plan))
      .rejects.toThrow('v1_remediation_plan_stale')
    const count = await pool.query("SELECT count(*)::int AS n FROM cases WHERE organization_id=$1 AND plate_normalized='34NNN444'", [organizationId])
    expect(count.rows[0].n).toBe(0)
  })

  it('ruhsat evidence dosya adi preview sonrasi degisirse TOCTOU fail-closed olur', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-remediation-'))
    const folder = await writeSource(root, '2026/Agustos 2026/34RNA445', {
      caseKey: 'case-ruhsat-toctou', createdAt: '2026-08-01T08:00:00Z', claimType: '',
    }, ['EVRAK/M RUHSAT.jpg'])
    const plan = await planV1Remediation(pool, organizationId, root)
    await rename(join(folder, 'EVRAK', 'M RUHSAT.jpg'), join(folder, 'EVRAK', 'S RUHSAT.txt'))
    await expect(applyV1Remediation(pool, { organizationId, actorUserId, requestId: 'ruhsat-toctou' }, plan))
      .rejects.toThrow('v1_remediation_plan_stale')
    const count = await pool.query("SELECT count(*)::int AS n FROM cases WHERE organization_id=$1 AND plate_normalized='34RNA445'", [organizationId])
    expect(count.rows[0].n).toBe(0)
  })

  it('claim document icerigi preview sonrasi degisirse file hash TOCTOU fail-closed olur', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-remediation-'))
    const folder = await writeSource(root, '2026/Agustos 2026/34DOC446', {
      caseKey: 'case-document-toctou', createdAt: '2026-08-01T09:00:00Z', claimType: '',
    }, [{
      path: 'EVRAK/policy.pdf',
      content: syntheticTextPdf('ZORUNLU MALI SORUMLULUK SIGORTASI POLICE NO 1 SIGORTALI TEST NET PRIM 1'),
    }])
    const plan = await planV1Remediation(pool, organizationId, root)
    await writeFile(
      join(folder, 'EVRAK', 'policy.pdf'),
      syntheticTextPdf('KARA ARACLARI KASKO SIGORTASI POLICE NO 2 SIGORTALI TEST BRUT PRIM 2'),
    )
    await expect(applyV1Remediation(pool, { organizationId, actorUserId, requestId: 'document-toctou' }, plan))
      .rejects.toThrow('v1_remediation_plan_stale')
    const count = await pool.query("SELECT count(*)::int AS n FROM cases WHERE organization_id=$1 AND plate_normalized='34DOC446'", [organizationId])
    expect(count.rows[0].n).toBe(0)
  })

  it('kismi-production fixture: moved legacy 0046 note/task provenance ile reconcile olur, duplicate sifir kalir', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-remediation-'))
    const caseId = await insertCase('34OOO555')
    const noteId = uuidv7()
    const taskId = uuidv7()
    await pool.query(
      "INSERT INTO case_notes (id,organization_id,case_id,note_type,body,created_by_user_id) VALUES ($1,$2,$3,'internal',$4,$5)",
      [noteId, organizationId, caseId, '[V1 kaynak: V1 Yazar, 2026-07-01T07:00:00Z] Legacy note', actorUserId],
    )
    await pool.query(
      `INSERT INTO case_tasks (id,organization_id,case_id,title,priority,due_date,created_by_user_id)
       VALUES ($1,$2,$3,'Legacy task','normal','2026-07-10',$4)`, [taskId, organizationId, caseId, actorUserId],
    )
    const oldPath = '2026/Temmuz 2026/34OOO555'
    for (const [itemType, sourceItemId, targetType, targetId] of [
      ['note', 'note-legacy', 'case_note', noteId],
      ['task', 'task-legacy', 'case_task', taskId],
    ] as const) {
      await pool.query(
        `INSERT INTO v1_import_records
          (id,organization_id,case_id,source_relative_path,source_file_kind,source_file_hash,source_schema_version,
           item_type,source_item_id,target_type,target_id,status,imported_by_user_id)
         VALUES ($1,$2,$3,$4,'takip_json',$5,1,$6,$7,$8,$9,'created',$10)`,
        [uuidv7(), organizationId, caseId, oldPath, 'a'.repeat(64), itemType, sourceItemId, targetType, targetId, actorUserId],
      )
    }
    await writeSource(root, '2026/Temmuz 2026/KAPALI TEMMUZ 2026/34OOO555', {
      caseKey: 'case-partial', createdAt: '2026-07-01T06:00:00Z', closed: true,
      notes: [{ id: 'note-legacy', text: 'Legacy note', createdAt: '2026-07-01T07:00:00Z', createdBy: 'V1 Yazar' }],
      todos: [{ id: 'task-legacy', title: 'Legacy task', completed: false }],
    })
    const plan = await planV1Remediation(pool, organizationId, root)
    expect(plan.summary.safeRemediation.moveRenameReconciliations).toBe(2)
    expect(plan.summary.actionable.notesToCreate).toBe(0)
    expect(plan.summary.actionable.tasksToCreate).toBe(0)
    expect(plan.summary.duplicatesThatWouldBeCreated).toBe(0)
    await applyV1Remediation(pool, { organizationId, actorUserId, requestId: 'partial' }, plan)
    const counts = await pool.query(
      `SELECT
        (SELECT count(*)::int FROM case_notes WHERE case_id=$1) AS notes,
        (SELECT count(*)::int FROM case_tasks WHERE case_id=$1) AS tasks,
        (SELECT count(*)::int FROM v1_import_record_reconciliations WHERE organization_id=$2) AS reconciled,
        (SELECT count(*)::int FROM case_task_events WHERE task_id=$3) AS events`,
      [caseId, organizationId, taskId],
    )
    expect(counts.rows[0]).toMatchObject({ notes: 1, tasks: 1, reconciled: 2, events: 1 })
  })

  it('legacy path writer guvenlik sinirinda fail-closed; preview DB yazmaz', async () => {
    root = await mkdtemp(join(tmpdir(), 'hb-v1-remediation-'))
    await writeSource(root, '2026/Agustos 2026/34PPP666', { caseKey: 'legacy-disabled', createdAt: '2026-08-02T07:00:00Z' })
    const before = await pool.query('SELECT count(*)::int AS n FROM v1_import_records WHERE organization_id=$1', [organizationId])
    const legacyPlan = await planV1Import(pool, organizationId, root)
    await expect(applyV1Import(pool, { organizationId, actorUserId, requestId: 'legacy-disabled' }, legacyPlan))
      .rejects.toThrow('v1_legacy_apply_disabled_use_remediation')
    await planV1Remediation(pool, organizationId, root)
    const after = await pool.query('SELECT count(*)::int AS n FROM v1_import_records WHERE organization_id=$1', [organizationId])
    expect(after.rows[0].n).toBe(before.rows[0].n)
  })
})
