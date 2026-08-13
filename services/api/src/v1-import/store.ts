import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type pg from 'pg'
import {
  decideV1FieldBackfill,
  deriveV1ClosedState,
  mapV1ClaimType,
  parseV1PlateFolderName,
  plateSearchKey,
  type V1ClaimType,
  type V1FieldBackfillDecision,
  type V1PlateFolderName,
} from '@hasarbotu/domain'
import { uuidv7 } from '@hasarbotu/database'
import { createAuditService } from '../audit/service.js'
import { parseV1TakipJson, type V1TakipJsonParseResult, type V1TakipJsonV1 } from './schema.js'

/**
 * V1 -> V2 aktarim, DB-farkinda orkestrasyon (HB-2026-198 sonrasi bulunan
 * kritik kusurun kalici duzeltmesi -- V1 sidecar verisi hicbir zaman V2'ye
 * tasinmiyordu; onceki "aktarim" yalniz dosya TURUNU okuyup atardi, geri
 * kalan her seyi sessizce atliyordu). Bu KALICI, TEST EDILEBILIR koddur --
 * `docs/DECISION_LOG.md` HB-2026-197'nin scratch script'inin aksine.
 *
 * KAPSAM (bilincli, bu paket icin belgelenmis):
 *  - Olusturulan/backfill edilen: case_type, plate, notificationFormNumber
 *    (V1 claimNoticeNo'dan), followUpDate (V1 takipTarihi'ndan, gecerliyse),
 *    responsible/expert (isim eslesmesi basariliysa), notlar (case_notes),
 *    TAMAMLANMAMIS gorevler (case_tasks).
 *  - KASITLI OLARAK bu paketin kapsaminda DEGIL (raw_snapshot'ta KAYBOLMADAN
 *    saklanir, V2'nin gercek kritik-islem modelini (AGENTS.md S7) baypas
 *    etmeden): lifecycle_status otomatik 'closed' yapilmaz (gercek kapanis
 *    File Agent klasor tasima gerektirir, bu ayri bir karar); workflow_stage
 *    ince-taneli eslenmez (V1<->V2 durum sozlugu arasinda DOGRULANMIS bir
 *    esleme yok); TAMAMLANMIS V1 gorevleri yeniden OLUSTURULMAZ (yanlis
 *    "bekliyor" gorunumu vermemek icin); vehicleContext/portalChecklist/
 *    rucu/labor/kttKusur/heavyDamage/aiHelperContext V2'de henuz birinci
 *    sinif kolonu olmadigi icin ham JSON olarak saklanir.
 *  - `dosyaNo` alani hicbir V2 kolonuna eslenmez (anlami dogrulanamadi,
 *    tahmin edilmedi) -- yalniz raw_snapshot'ta saklanir.
 */

const SIDECAR_DIR = '_HASARBOTU'
const JSON_FILENAME = 'takip.json'
const TXT_FILENAME = 'HASARBOTU_TAKIP_OZETI.txt'
const NON_CASE_DIR_NAMES = new Set(['_HASARBOTU', '_HASARBOTU_OFFICE'])
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// ---------------------------------------------------------------------------
// Kesif (dosya sistemi taramasi, tamamen salt-okunur: yalniz readdir/stat/readFile)
// ---------------------------------------------------------------------------

export interface V1DiscoveredFolder {
  readonly absolutePath: string
  /** Yapilandirilan V1 kokune gore goreli, POSIX-stili ('/'), mutlak yol DEGIL. */
  readonly relativePath: string
  readonly folderName: string
  readonly monthFolder: string
  readonly physicallyUnderKapali: boolean
  readonly parsedName: V1PlateFolderName | null
  readonly hasJson: boolean
  readonly hasTxt: boolean
}

async function listSubdirectories(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return []
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const info = await stat(path)
    return info.isFile()
  } catch {
    return false
  }
}

/**
 * V1 kok dizinini tarar: `<kok>/<yil>/<ay>/<plaka>` ve
 * `<kok>/<yil>/<ay>/KAPALI .../<plaka>` desenlerini yurur. `_HASARBOTU`/
 * `_HASARBOTU_OFFICE` (vaka-DISI, ofis/ay seviyeli sidecar'lar) acikca
 * DISLANIR -- vaka klasoru gibi yanlis siniflandirilmaz.
 */
export async function discoverV1Folders(rootPath: string): Promise<V1DiscoveredFolder[]> {
  const results: V1DiscoveredFolder[] = []
  const yearDirs = await listSubdirectories(rootPath)
  for (const year of yearDirs) {
    if (!/^\d{4}$/u.test(year)) continue
    const yearPath = join(rootPath, year)
    const monthDirs = await listSubdirectories(yearPath)
    for (const month of monthDirs) {
      if (NON_CASE_DIR_NAMES.has(month)) continue
      const monthPath = join(yearPath, month)
      const monthChildren = await listSubdirectories(monthPath)
      for (const child of monthChildren) {
        if (NON_CASE_DIR_NAMES.has(child)) continue
        const childPath = join(monthPath, child)
        if (child.toLocaleUpperCase('tr-TR').startsWith('KAPALI')) {
          const archived = await listSubdirectories(childPath)
          for (const plateFolder of archived) {
            if (NON_CASE_DIR_NAMES.has(plateFolder)) continue
             
            await pushDiscovered(results, rootPath, join(childPath, plateFolder), month, true)
          }
        } else {
           
          await pushDiscovered(results, rootPath, childPath, month, false)
        }
      }
    }
  }
  return results
}

async function pushDiscovered(
  results: V1DiscoveredFolder[],
  rootPath: string,
  absolutePath: string,
  monthFolder: string,
  physicallyUnderKapali: boolean,
): Promise<void> {
  const folderName = absolutePath.split(/[\\/]/u).pop() ?? ''
  const sidecarDir = join(absolutePath, SIDECAR_DIR)
  const hasJson = await fileExists(join(sidecarDir, JSON_FILENAME))
  const hasTxt = await fileExists(join(sidecarDir, TXT_FILENAME))
  results.push({
    absolutePath,
    relativePath: relative(rootPath, absolutePath).split('\\').join('/'),
    folderName,
    monthFolder,
    physicallyUnderKapali,
    parsedName: parseV1PlateFolderName(folderName),
    hasJson,
    hasTxt,
  })
}

// ---------------------------------------------------------------------------
// Sidecar okuma (salt-okunur: yalniz readFile)
// ---------------------------------------------------------------------------

export interface V1SidecarReadResult {
  readonly jsonRaw: string | null
  readonly jsonHash: string | null
  readonly jsonParse: V1TakipJsonParseResult | null
  readonly txtRaw: string | null
  readonly txtHash: string | null
}

function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

export async function readV1Sidecar(folder: V1DiscoveredFolder): Promise<V1SidecarReadResult> {
  const sidecarDir = join(folder.absolutePath, SIDECAR_DIR)
  let jsonRaw: string | null = null
  let jsonHash: string | null = null
  let jsonParse: V1TakipJsonParseResult | null = null
  if (folder.hasJson) {
    jsonRaw = await readFile(join(sidecarDir, JSON_FILENAME), 'utf8')
    jsonHash = sha256Hex(jsonRaw)
    jsonParse = parseV1TakipJson(jsonRaw)
  }
  let txtRaw: string | null = null
  let txtHash: string | null = null
  if (folder.hasTxt) {
    txtRaw = await readFile(join(sidecarDir, TXT_FILENAME), 'utf8')
    txtHash = sha256Hex(txtRaw)
  }
  return { jsonRaw, jsonHash, jsonParse, txtRaw, txtHash }
}

// ---------------------------------------------------------------------------
// Plan turleri
// ---------------------------------------------------------------------------

export type V1ImportAction =
  | 'create_case'
  | 'backfill_existing'
  | 'up_to_date'
  | 'skipped_closed_case'
  | 'conflict_ambiguous_plate'
  | 'conflict_field_values'
  | 'unknown_claim_type'
  | 'unparseable_folder_name'
  | 'missing_sidecar'
  | 'malformed_or_unsupported_json'

export interface V1FieldBackfillPlanItem {
  readonly field: 'notificationFormNumber' | 'followUpDate' | 'responsibleUserId' | 'expertUserId'
  readonly decision: V1FieldBackfillDecision
}

export interface V1NamedAssignment {
  readonly sourceName: string
  readonly resolvedUserId: string | null
  readonly matchCount: number
}

export interface V1NotePlanItem {
  readonly sourceNoteId: string
  readonly alreadyImported: boolean
  readonly text: string
  readonly createdBy: string
  readonly createdAt: string
}

export interface V1TaskPlanItem {
  readonly sourceTodoId: string
  readonly alreadyImported: boolean
  readonly title: string
  readonly priority: 'low' | 'normal' | 'high'
  readonly assignedUserId: string | null
  readonly assignedSourceName: string
  readonly dueDate: string
}

export interface V1ImportPlanEntry {
  readonly folder: V1DiscoveredFolder
  readonly action: V1ImportAction
  readonly reasons: readonly string[]
  readonly claimType: V1ClaimType | null
  readonly closed: boolean | null
  readonly closedConflicting: boolean
  readonly matchedCaseId: string | null
  readonly matchedCaseCandidateCount: number
  readonly plateSearchKey: string | null
  readonly fieldBackfills: readonly V1FieldBackfillPlanItem[]
  readonly responsibleAssignment: V1NamedAssignment | null
  readonly expertAssignment: V1NamedAssignment | null
  readonly notes: readonly V1NotePlanItem[]
  readonly tasks: readonly V1TaskPlanItem[]
  readonly jsonHash: string | null
  readonly txtHash: string | null
  readonly schemaVersion: number | null
  readonly writeId: string | null
  readonly revision: number | null
  readonly rawSnapshot: V1TakipJsonV1 | null
  readonly followUpDateCandidate: string | null
}

export interface V1ImportPlanSummary {
  readonly totalFoldersDiscovered: number
  readonly withJson: number
  readonly withTxt: number
  readonly withNeitherSidecar: number
  readonly unparseableFolderName: number
  readonly malformedOrUnsupportedJson: number
  readonly unknownClaimType: number
  readonly toCreate: number
  readonly toBackfill: number
  readonly upToDate: number
  readonly skippedClosedCase: number
  readonly conflicts: number
  readonly notesToImport: number
  readonly tasksToImport: number
}

export interface V1ImportPlan {
  readonly organizationId: string
  readonly rootPath: string
  readonly generatedAt: string
  readonly summary: V1ImportPlanSummary
  readonly entries: readonly V1ImportPlanEntry[]
}

interface ExistingCaseRow {
  readonly id: string
  readonly version: number
  readonly caseType: string
  readonly lifecycleStatus: string
  readonly responsibleUserId: string | null
  readonly expertUserId: string | null
  readonly notificationFormNumber: string | null
  readonly followUpDate: string | null
}

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase('tr-TR').replace(/\s+/gu, ' ')
}

function resolveUserByName(
  usersByNormalizedName: ReadonlyMap<string, readonly string[]>,
  rawName: string,
): V1NamedAssignment | null {
  const trimmed = rawName.trim()
  if (trimmed.length === 0) return null
  const candidates = usersByNormalizedName.get(normalizeName(trimmed)) ?? []
  return {
    sourceName: trimmed,
    resolvedUserId: candidates.length === 1 ? candidates[0] : null,
    matchCount: candidates.length,
  }
}

/**
 * V1'in ayri "kapali mi" sinyallerini domain fonksiyonuna aktarir. TXT
 * yalniz JSON'un turetilmis bir gorunumudur (TXT'nin kendi son satiri:
 * "Ana kaynak _HASARBOTU/takip.json dosyasidir" -- V1'in KENDI beyani,
 * tahmin edilmedi) -- bu yuzden kapanis kararinda TXT'ye hic basvurulmaz.
 */
function closedSignalsFromParsedJson(
  data: V1TakipJsonV1 | null,
  physicallyUnderKapali: boolean,
): { closed: boolean | null; conflicting: boolean } {
  if (data === null) return { closed: null, conflicting: false }
  const result = deriveV1ClosedState({
    physicallyUnderKapali,
    isClosedFolderFlag: data.caseIdentity?.isClosedFolder ?? null,
    kapaliMi: data.status?.kapaliMi ?? null,
  })
  return { closed: result.closed, conflicting: result.conflicting }
}

function mapPriority(rawOncelik: string): 'low' | 'normal' | 'high' {
  const normalized = rawOncelik.trim().toLocaleLowerCase('tr-TR')
  if (normalized === 'kritik' || normalized === 'yuksek' || normalized === 'yüksek') return 'high'
  if (normalized === 'dusuk' || normalized === 'düşük') return 'low'
  return 'normal'
}

/**
 * Salt-okunur onizleme/plan uretimi. Hicbir DB yazma, hicbir dosya yazma
 * YOKTUR -- yalniz gercek DB'den (cases/users/v1_import_records) OKUR ve
 * V1 kaynagindan OKUR.
 */
export async function planV1Import(
  pool: pg.Pool,
  organizationId: string,
  rootPath: string,
): Promise<V1ImportPlan> {
  const [folders, usersResult, casesResult, existingRecordsResult] = await Promise.all([
    discoverV1Folders(rootPath),
    pool.query<{ id: string; display_name: string }>(
      'SELECT id::text,display_name FROM users WHERE organization_id=$1 AND status=$2',
      [organizationId, 'active'],
    ),
    pool.query(
      `SELECT id::text,version,case_type,lifecycle_status,responsible_user_id::text,expert_user_id::text,
              notification_form_number,to_char(follow_up_date,'YYYY-MM-DD') AS follow_up_date,plate_normalized
         FROM cases WHERE organization_id=$1`,
      [organizationId],
    ),
    pool.query<{ source_relative_path: string; item_type: string; source_item_id: string }>(
      'SELECT source_relative_path,item_type,source_item_id FROM v1_import_records WHERE organization_id=$1',
      [organizationId],
    ),
  ])

  const usersByNormalizedName = new Map<string, string[]>()
  for (const row of usersResult.rows) {
    const key = normalizeName(row.display_name)
    const list = usersByNormalizedName.get(key) ?? []
    list.push(row.id)
    usersByNormalizedName.set(key, list)
  }

  const casesByPlateKey = new Map<string, ExistingCaseRow[]>()
  for (const row of casesResult.rows as Array<Record<string, unknown>>) {
    const key = String(row.plate_normalized)
    const list = casesByPlateKey.get(key) ?? []
    list.push({
      id: String(row.id),
      version: Number(row.version),
      caseType: String(row.case_type),
      lifecycleStatus: String(row.lifecycle_status),
      responsibleUserId: row.responsible_user_id === null ? null : String(row.responsible_user_id),
      expertUserId: row.expert_user_id === null ? null : String(row.expert_user_id),
      notificationFormNumber: row.notification_form_number === null ? null : String(row.notification_form_number),
      followUpDate: row.follow_up_date === null ? null : String(row.follow_up_date),
    })
    casesByPlateKey.set(key, list)
  }

  const importedKeys = new Set(
    existingRecordsResult.rows.map((row) => `${row.source_relative_path} ${row.item_type} ${row.source_item_id}`),
  )
  const isAlreadyImported = (relativePath: string, itemType: string, sourceItemId: string): boolean =>
    importedKeys.has(`${relativePath} ${itemType} ${sourceItemId}`)

  const entries: V1ImportPlanEntry[] = []
  for (const folder of folders) {
     
    entries.push(await planFolderEntry(folder, usersByNormalizedName, casesByPlateKey, isAlreadyImported))
  }

  const summary: V1ImportPlanSummary = {
    totalFoldersDiscovered: folders.length,
    withJson: folders.filter((f) => f.hasJson).length,
    withTxt: folders.filter((f) => f.hasTxt).length,
    withNeitherSidecar: folders.filter((f) => !f.hasJson && !f.hasTxt).length,
    unparseableFolderName: entries.filter((e) => e.action === 'unparseable_folder_name').length,
    malformedOrUnsupportedJson: entries.filter((e) => e.action === 'malformed_or_unsupported_json').length,
    unknownClaimType: entries.filter((e) => e.action === 'unknown_claim_type').length,
    toCreate: entries.filter((e) => e.action === 'create_case').length,
    toBackfill: entries.filter((e) => e.action === 'backfill_existing').length,
    upToDate: entries.filter((e) => e.action === 'up_to_date').length,
    skippedClosedCase: entries.filter((e) => e.action === 'skipped_closed_case').length,
    conflicts: entries.filter((e) => e.action === 'conflict_ambiguous_plate' || e.action === 'conflict_field_values').length,
    notesToImport: entries
      .filter((entry) => entry.action === 'create_case' || entry.action === 'backfill_existing')
      .reduce((sum, entry) => sum + entry.notes.filter((note) => !note.alreadyImported).length, 0),
    tasksToImport: entries
      .filter((entry) => entry.action === 'create_case' || entry.action === 'backfill_existing')
      .reduce((sum, entry) => sum + entry.tasks.filter((task) => !task.alreadyImported).length, 0),
  }

  return { organizationId, rootPath, generatedAt: new Date().toISOString(), summary, entries }
}

async function planFolderEntry(
  folder: V1DiscoveredFolder,
  usersByNormalizedName: ReadonlyMap<string, string[]>,
  casesByPlateKey: ReadonlyMap<string, ExistingCaseRow[]>,
  isAlreadyImported: (relativePath: string, itemType: string, sourceItemId: string) => boolean,
): Promise<V1ImportPlanEntry> {
  const empty = {
    fieldBackfills: [] as V1FieldBackfillPlanItem[],
    notes: [] as V1NotePlanItem[],
    tasks: [] as V1TaskPlanItem[],
  }

  if (folder.parsedName === null) {
    return {
      folder, action: 'unparseable_folder_name', reasons: [`klasor adi plaka olarak ayristirilamadi: "${folder.folderName}"`],
      claimType: null, closed: null, closedConflicting: false, matchedCaseId: null, matchedCaseCandidateCount: 0,
      plateSearchKey: null, ...empty, responsibleAssignment: null, expertAssignment: null,
      jsonHash: null, txtHash: null, schemaVersion: null, writeId: null, revision: null, rawSnapshot: null, followUpDateCandidate: null,
    }
  }

  const searchKey = plateSearchKey(folder.parsedName.plate)

  if (!folder.hasJson) {
    return {
      folder, action: 'missing_sidecar', reasons: ['_HASARBOTU/takip.json yok (yalniz TXT olsa bile JSON olmadan guvenle islenmez)'],
      claimType: null, closed: null, closedConflicting: false, matchedCaseId: null, matchedCaseCandidateCount: 0,
      plateSearchKey: searchKey, ...empty, responsibleAssignment: null, expertAssignment: null,
      jsonHash: null, txtHash: null, schemaVersion: null, writeId: null, revision: null, rawSnapshot: null, followUpDateCandidate: null,
    }
  }

  const sidecar = await readV1Sidecar(folder)
  const parse = sidecar.jsonParse
  if (parse === null || !parse.ok) {
    const reason = parse === null ? 'takip.json okunamadi' : `takip.json ayristirilamadi: ${parse.reason}`
    return {
      folder, action: 'malformed_or_unsupported_json', reasons: [reason],
      claimType: null, closed: null, closedConflicting: false, matchedCaseId: null, matchedCaseCandidateCount: 0,
      plateSearchKey: searchKey, ...empty, responsibleAssignment: null, expertAssignment: null,
      jsonHash: sidecar.jsonHash, txtHash: sidecar.txtHash, schemaVersion: null, writeId: null, revision: null, rawSnapshot: null, followUpDateCandidate: null,
    }
  }

  const data = parse.data
  const claimType = mapV1ClaimType(data.claimType)
  const closedSignals = closedSignalsFromParsedJson(data, folder.physicallyUnderKapali)
  const candidates = casesByPlateKey.get(searchKey) ?? []
  const responsibleAssignment = resolveUserByName(usersByNormalizedName, data.assignment?.sorumlu ?? '')
  const expertAssignment = resolveUserByName(usersByNormalizedName, data.assignment?.eksper ?? '')

  const notes: V1NotePlanItem[] = data.notes.map((note) => ({
    sourceNoteId: note.id,
    alreadyImported: isAlreadyImported(folder.relativePath, 'note', note.id),
    text: note.text,
    createdBy: note.createdBy,
    createdAt: note.createdAt,
  }))
  const followUpFallback = ISO_DATE_PATTERN.test(data.assignment?.takipTarihi ?? '')
    ? (data.assignment?.takipTarihi ?? '')
    : (ISO_DATE_PATTERN.test(data.assignment?.sonIslemTarihi ?? '') ? (data.assignment?.sonIslemTarihi ?? '') : null)
  // Yalniz TAMAMLANMAMIS V1 gorevleri gercek gorev olarak ice aktarilir --
  // tamamlanmislari yeniden 'open' olarak yaratmak yanlis "bekliyor" izlenimi
  // verir (bkz. dosya basi kapsam notu). due_date NOT NULL: V1'in kendi
  // tarihi yoksa takipTarihi/sonIslemTarihi/bugune duser.
  const tasks: V1TaskPlanItem[] = data.todos
    .filter((todo) => !todo.completed)
    .map((todo) => {
      const assignee = resolveUserByName(usersByNormalizedName, todo.assignedTo)
      const dueDate = ISO_DATE_PATTERN.test(todo.dueDate) ? todo.dueDate : (followUpFallback ?? new Date().toISOString().slice(0, 10))
      return {
        sourceTodoId: todo.id,
        alreadyImported: isAlreadyImported(folder.relativePath, 'task', todo.id),
        title: todo.title,
        priority: mapPriority(todo.priority),
        assignedUserId: assignee?.resolvedUserId ?? null,
        assignedSourceName: todo.assignedTo,
        dueDate,
      }
    })

  const base = {
    folder, claimType, closed: closedSignals.closed, closedConflicting: closedSignals.conflicting,
    plateSearchKey: searchKey, notes, tasks, responsibleAssignment, expertAssignment,
    jsonHash: sidecar.jsonHash, txtHash: sidecar.txtHash, schemaVersion: parse.schemaVersion,
    writeId: data.metadata?.writeId ?? null, revision: data.metadata?.revision ?? null, rawSnapshot: data,
    // 'create_case' yolunda `fieldBackfills` BOS kalir (backfill kavrami
    // yalniz VAROLAN bir case icin anlamlidir) -- yeni case olustururken
    // takipTarihi'ni dogrudan buradan okumak icin AYRICA saklanir.
    followUpDateCandidate: followUpFallback,
  }

  if (claimType === 'unknown') {
    return {
      ...base, action: 'unknown_claim_type', reasons: ['V1 claimType bilinmiyor/bos -- tur tahmin edilmedi'],
      matchedCaseId: null, matchedCaseCandidateCount: candidates.length, fieldBackfills: [],
    }
  }

  if (candidates.length === 0) {
    return {
      ...base, action: 'create_case', reasons: ['V2de bu plaka ile eslesen dosya yok, yeni olusturulacak'],
      matchedCaseId: null, matchedCaseCandidateCount: 0, fieldBackfills: [],
    }
  }
  if (candidates.length > 1) {
    return {
      ...base, action: 'conflict_ambiguous_plate',
      reasons: [`V2de ayni plakada ${candidates.length} dosya var -- hangisinin bu V1 klasorune karsilik geldigi belirsiz, TAHMIN edilmedi`],
      matchedCaseId: null, matchedCaseCandidateCount: candidates.length, fieldBackfills: [],
    }
  }

  const matched = candidates[0]
  // Kapali dosya diger TUM modullerle (case-operations/labor/pert/
  // email-drafts/cases PATCH -- HB-2026-198) ayni fail-closed sozlesmeye
  // tabidir: v1-import da kapali bir V2 dosyasina yeni alan/not/gorev
  // YAZAMAZ. V1'in kendi verisi hicbir zaman kaybolmaz (rawSnapshot hala
  // provenance'a yazilabilir, bkz. applyV1Import), ama uygulama YOKTUR.
  if (matched.lifecycleStatus === 'closed') {
    return {
      ...base, action: 'skipped_closed_case',
      reasons: ['V2deki eslesen dosya kapali -- diger tum modullerle ayni sekilde yeni yazma reddedilir'],
      matchedCaseId: matched.id, matchedCaseCandidateCount: 1, fieldBackfills: [],
    }
  }
  const backfills: V1FieldBackfillPlanItem[] = [
    { field: 'notificationFormNumber', decision: decideV1FieldBackfill(matched.notificationFormNumber, data.caseIdentity?.claimNoticeNo ?? '') },
    { field: 'followUpDate', decision: decideV1FieldBackfill(matched.followUpDate, followUpFallback) },
    {
      field: 'responsibleUserId',
      decision: matched.responsibleUserId !== null
        ? { kind: 'already_matches' }
        : (responsibleAssignment?.resolvedUserId !== null && responsibleAssignment?.resolvedUserId !== undefined
          ? { kind: 'safe_backfill', value: responsibleAssignment.resolvedUserId }
          : { kind: 'no_source_value' }),
    },
    {
      field: 'expertUserId',
      decision: matched.expertUserId !== null
        ? { kind: 'already_matches' }
        : (expertAssignment?.resolvedUserId !== null && expertAssignment?.resolvedUserId !== undefined
          ? { kind: 'safe_backfill', value: expertAssignment.resolvedUserId }
          : { kind: 'no_source_value' }),
    },
  ]
  const hasConflict = backfills.some((b) => b.decision.kind === 'conflict')
  const hasBackfill = backfills.some((b) => b.decision.kind === 'safe_backfill')
  const hasNewNotesOrTasks = notes.some((n) => !n.alreadyImported) || tasks.some((t) => !t.alreadyImported)

  if (hasConflict) {
    return {
      ...base, action: 'conflict_field_values', reasons: ['V2de kullanicinin sonradan girdigi bir deger V1 degerinden farkli -- kor ezilmez'],
      matchedCaseId: matched.id, matchedCaseCandidateCount: 1, fieldBackfills: backfills,
    }
  }
  if (hasBackfill || hasNewNotesOrTasks) {
    return {
      ...base, action: 'backfill_existing', reasons: ['mevcut V2 dosyasina guvenli alan/not/gorev backfill uygulanacak'],
      matchedCaseId: matched.id, matchedCaseCandidateCount: 1, fieldBackfills: backfills,
    }
  }
  return {
    ...base, action: 'up_to_date', reasons: ['V2 zaten V1 ile tutarli, yapilacak bir sey yok'],
    matchedCaseId: matched.id, matchedCaseCandidateCount: 1, fieldBackfills: backfills,
  }
}

// ---------------------------------------------------------------------------
// Uygulama (GERCEK DB YAZMASI -- yalniz acik onayla cagirilmalidir)
// ---------------------------------------------------------------------------

export interface V1ImportApplyOutcome {
  readonly relativePath: string
  readonly action: V1ImportAction
  readonly caseId: string | null
  readonly notesCreated: number
  readonly tasksCreated: number
  readonly fieldsBackfilled: readonly string[]
  readonly error: string | null
}

export interface V1ImportApplyResult {
  readonly casesCreated: number
  readonly casesBackfilled: number
  readonly notesCreated: number
  readonly tasksCreated: number
  readonly skipped: number
  readonly failed: number
  readonly outcomes: readonly V1ImportApplyOutcome[]
}

/**
 * Gercek DB yazmasi. Her klasor KENDI transaction'indadir (biri basarisiz
 * olursa digerleri etkilenmez, kismi ilerleme kaybolmaz -- yeniden
 * calistirmak zaten idempotent). Yazmadan hemen once ayni case/kullanici
 * durumu TAZE sorgulanir (TOCTOU'ya karsi) -- plan yalniz bir ONIZLEMEDIR,
 * yazmanin kendisi kendi guvenligini tekrar dogrular.
 */
export async function applyV1Import(
  pool: pg.Pool,
  actor: { readonly organizationId: string; readonly actorUserId: string; readonly requestId: string },
  plan: V1ImportPlan,
): Promise<V1ImportApplyResult> {
  // 0046 uygulayicisi source_relative_path tabanliydi ve klasor move/rename
  // sonrasinda duplicate uretebiliyordu. Kalici remediation runner'i bu
  // fonksiyondan AYRIDIR; eski writer fail-closed tutulur.
  throw new Error('v1_legacy_apply_disabled_use_remediation')
  /* c8 ignore start -- tarihsel uygulayici yalniz forensic referansidir. */
  const audit = createAuditService()
  const outcomes: V1ImportApplyOutcome[] = []

  for (const entry of plan.entries) {
    if (entry.action !== 'create_case' && entry.action !== 'backfill_existing') {
      outcomes.push({
        relativePath: entry.folder.relativePath, action: entry.action, caseId: entry.matchedCaseId,
        notesCreated: 0, tasksCreated: 0, fieldsBackfilled: [], error: null,
      })
      continue
    }

    const client = await pool.connect()
    try {
       
      await client.query('BEGIN')
      const outcome = await applyFolderEntry(client, audit, actor, entry)
      await client.query('COMMIT')
      outcomes.push(outcome)
    } catch {
      await client.query('ROLLBACK').catch(() => undefined)
      outcomes.push({
        relativePath: entry.folder.relativePath, action: entry.action, caseId: entry.matchedCaseId,
        notesCreated: 0, tasksCreated: 0, fieldsBackfilled: [],
        error: 'v1_legacy_apply_failed',
      })
    } finally {
      client.release()
    }
  }

  return {
    casesCreated: outcomes.filter((o) => o.action === 'create_case' && o.error === null).length,
    casesBackfilled: outcomes.filter((o) => o.action === 'backfill_existing' && o.error === null).length,
    notesCreated: outcomes.reduce((sum, o) => sum + o.notesCreated, 0),
    tasksCreated: outcomes.reduce((sum, o) => sum + o.tasksCreated, 0),
    skipped: outcomes.filter((o) => o.action !== 'create_case' && o.action !== 'backfill_existing').length,
    failed: outcomes.filter((o) => o.error !== null).length,
    outcomes,
  }
  /* c8 ignore stop */
}

async function recordProvenance(
  client: pg.PoolClient,
  actor: { readonly organizationId: string; readonly actorUserId: string },
  entry: V1ImportPlanEntry,
  itemType: 'case' | 'field_backfill' | 'note' | 'task',
  sourceItemId: string,
  targetType: 'case' | 'case_note' | 'case_task' | 'none',
  targetId: string | null,
  status: 'created' | 'backfilled',
  caseId: string | null,
  fieldDiffs: unknown,
): Promise<void> {
  await client.query(
    `INSERT INTO v1_import_records
       (id,organization_id,case_id,source_relative_path,source_file_kind,source_file_hash,source_schema_version,
        source_write_id,source_revision,item_type,source_item_id,target_type,target_id,status,field_diffs,
        raw_snapshot,imported_by_user_id)
     VALUES ($1,$2,$3,$4,'takip_json',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (organization_id,source_relative_path,item_type,source_item_id) DO NOTHING`,
    [
      uuidv7(), actor.organizationId, caseId, entry.folder.relativePath, entry.jsonHash, entry.schemaVersion,
      entry.writeId, entry.revision, itemType, sourceItemId, targetType, targetId, status,
      fieldDiffs === undefined ? null : JSON.stringify(fieldDiffs),
      itemType === 'case' ? JSON.stringify(entry.rawSnapshot) : null,
      actor.actorUserId,
    ],
  )
}

async function applyFolderEntry(
  client: pg.PoolClient,
  audit: ReturnType<typeof createAuditService>,
  actor: { readonly organizationId: string; readonly actorUserId: string; readonly requestId: string },
  entry: V1ImportPlanEntry,
): Promise<V1ImportApplyOutcome> {
  let caseId = entry.matchedCaseId
  const fieldsBackfilled: string[] = []

  if (entry.action === 'create_case') {
    // TOCTOU + idempotency koruma: plate_normalized DEGIL, bu TAM V1
    // klasoru (source_relative_path) daha once case'e donusturulmus mu diye
    // bakilir. Ayni plakanin AGENTS.md " - N" sonekli AYRI V1 klasorleri
    // (orn. 34KKK111, 34KKK111 - 2) tasarim geregi AYRI case'lerdir (bkz.
    // "Plaka benzersiz kimlik degildir") -- plate bazli kontrol, ayni apply
    // kosusunda once islenen kardes klasoru yanlislikla "cakisma" sayardi.
    const fresh = await client.query(
      `SELECT target_id FROM v1_import_records
       WHERE organization_id=$1 AND source_relative_path=$2 AND item_type='case'`,
      [actor.organizationId, entry.folder.relativePath],
    )
    if (fresh.rows.length > 0) {
      // Bu klasor icin case daha once (baska bir apply kosusunda) olusturulmus.
      return {
        relativePath: entry.folder.relativePath, action: entry.action,
        caseId: (fresh.rows[0] as { target_id: string | null }).target_id,
        notesCreated: 0, tasksCreated: 0, fieldsBackfilled: [], error: 'stale_plan_case_now_exists',
      }
    }
    const newCaseId = uuidv7()
    const year = new Date().getFullYear()
    const counter = await client.query(
      `INSERT INTO office_counters (organization_id, office_year, last_sequence)
       VALUES ($1, $2, 1)
       ON CONFLICT (organization_id, office_year) DO UPDATE SET last_sequence = office_counters.last_sequence + 1
       RETURNING last_sequence`,
      [actor.organizationId, year],
    )
    const sequence = Number((counter.rows[0] as { last_sequence: number }).last_sequence)
    const notificationFormNumber = entry.rawSnapshot?.caseIdentity?.claimNoticeNo ?? ''
    await client.query(
      `INSERT INTO cases (id, organization_id, office_year, office_sequence, office_number,
         case_type, workflow_stage, notification_form_number, plate, plate_normalized,
         responsible_user_id, expert_user_id, follow_up_date)
       VALUES ($1,$2,$3,$4,$5,$6,'new_notification',$7,$8,$9,$10,$11,$12)`,
      [
        newCaseId, actor.organizationId, year, sequence, `${year}/${sequence}`,
        entry.claimType, notificationFormNumber.trim().length > 0 ? notificationFormNumber.trim() : null,
        entry.folder.parsedName?.plate, entry.plateSearchKey,
        entry.responsibleAssignment?.resolvedUserId ?? null, entry.expertAssignment?.resolvedUserId ?? null,
        entry.followUpDateCandidate,
      ],
    )
    await audit.record(client, {
      organizationId: actor.organizationId, actorUserId: actor.actorUserId, requestId: actor.requestId,
      action: 'case.created', entityType: 'case', entityId: newCaseId,
      details: { source: 'v1_import', sourceRelativePath: entry.folder.relativePath, officeCaseNumber: `${year}/${sequence}`, caseType: entry.claimType },
    })
    await recordProvenance(client, actor, entry, 'case', 'case', 'case', newCaseId, 'created', newCaseId, null)
    caseId = newCaseId
  } else if (entry.action === 'backfill_existing' && caseId !== null) {
    for (const item of entry.fieldBackfills) {
      if (item.decision.kind !== 'safe_backfill') continue
      const column = item.field === 'notificationFormNumber' ? 'notification_form_number'
        : item.field === 'followUpDate' ? 'follow_up_date'
          : item.field === 'responsibleUserId' ? 'responsible_user_id' : 'expert_user_id'
       
      const updated = await client.query(
        `UPDATE cases SET ${column}=$3, version=version+1, updated_at=now()
           WHERE organization_id=$1 AND id=$2 AND ${column} IS NULL
         RETURNING id`,
        [actor.organizationId, caseId, item.decision.value],
      )
      if (updated.rows.length > 0) {
        fieldsBackfilled.push(item.field)
         
        await recordProvenance(client, actor, entry, 'field_backfill', `field:${item.field}`, 'case', caseId, 'backfilled', caseId, item.decision)
      }
    }
    if (fieldsBackfilled.length > 0) {
      await audit.record(client, {
        organizationId: actor.organizationId, actorUserId: actor.actorUserId, requestId: actor.requestId,
        action: 'case.updated', entityType: 'case', entityId: caseId,
        details: { source: 'v1_import', sourceRelativePath: entry.folder.relativePath, changedFields: fieldsBackfilled },
      })
    }
  }

  let notesCreated = 0
  let tasksCreated = 0
  if (caseId !== null) {
    for (const note of entry.notes) {
      if (note.alreadyImported) continue
      const noteId = uuidv7()
      const attributedBody = `[V1 kaynak: ${note.createdBy || 'bilinmiyor'}, ${note.createdAt || 'tarih yok'}] ${note.text}`.slice(0, 5000)
       
      await client.query(
        `INSERT INTO case_notes (id,organization_id,case_id,note_type,body,created_by_user_id)
         VALUES ($1,$2,$3,'internal',$4,$5)`,
        [noteId, actor.organizationId, caseId, attributedBody, actor.actorUserId],
      )
       
      await recordProvenance(client, actor, entry, 'note', note.sourceNoteId, 'case_note', noteId, 'created', caseId, null)
      notesCreated += 1
    }
    for (const task of entry.tasks) {
      if (task.alreadyImported) continue
      const taskId = uuidv7()
       
      await client.query(
        `INSERT INTO case_tasks (id,organization_id,case_id,title,priority,assigned_user_id,due_date,created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [taskId, actor.organizationId, caseId, task.title.slice(0, 300), task.priority, task.assignedUserId, task.dueDate, actor.actorUserId],
      )
       
      await recordProvenance(
        client, actor, entry, 'task', task.sourceTodoId, 'case_task', taskId, 'created', caseId,
        task.assignedUserId === null ? { unmatchedAssignee: task.assignedSourceName } : null,
      )
      tasksCreated += 1
    }
    if (notesCreated > 0 || tasksCreated > 0) {
      await audit.record(client, {
        organizationId: actor.organizationId, actorUserId: actor.actorUserId, requestId: actor.requestId,
        action: 'case.updated', entityType: 'case', entityId: caseId,
        details: { source: 'v1_import', sourceRelativePath: entry.folder.relativePath, notesCreated, tasksCreated },
      })
    }
  }

  return {
    relativePath: entry.folder.relativePath, action: entry.action, caseId,
    notesCreated, tasksCreated, fieldsBackfilled, error: null,
  }
}
