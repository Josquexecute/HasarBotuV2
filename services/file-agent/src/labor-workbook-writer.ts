import {
  constants as fsConstants,
  copyFile,
  open,
  readFile,
  rename,
  stat,
  unlink,
} from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, extname, join } from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { WorkbookSignatureCheck } from '@hasarbotu/domain'
import {
  extractOoxmlWorkbook,
  getOoxmlSheet,
  sha256WorkbookBytes,
} from './ooxml-readonly-extractor.js'
import {
  preflightLaborWorkbook,
  type LaborWorkbookAgentPreflightCode,
} from './labor-workbook-preflight.js'
import {
  assertRealPathUnderRoot,
  resolveUnderRoot,
} from './path-resolver.js'

export const LABOR_WORKBOOK_WRITE_VERSION = 'labor-workbook-write/1.0.0' as const
export const LABOR_WORKBOOK_WRITE_PLAN_VERSION = 'labor-workbook-write-plan/2.0.0' as const
export const LABOR_WORKBOOK_ALLOWED_WRITE_COLUMN = 'D' as const

const MAX_EXCEL_ROW = 1_048_576
const MAX_CELL_VALUE_LENGTH = 240

export const LABOR_WORKBOOK_WRITE_CODES = [
  'WORKBOOK_WRITE_CELL_INVALID',
  'WORKBOOK_WRITE_COLUMN_FORBIDDEN',
  'WORKBOOK_WRITE_ROW_FORBIDDEN',
  'WORKBOOK_WRITE_DUPLICATE_CELL',
  'WORKBOOK_WRITE_VALUE_INVALID',
  'WORKBOOK_WRITE_SIGNATURE_CELL_FORBIDDEN',
  'WORKBOOK_WRITE_CELL_FORMULA',
  'WORKBOOK_WRITE_NO_CHANGES',
  'WORKBOOK_WRITE_PLAN_STALE',
  'WORKBOOK_WRITE_APPROVAL_REQUIRED',
  'WORKBOOK_WRITE_APPROVAL_MISMATCH',
  'WORKBOOK_WRITE_LOCKED',
  'WORKBOOK_WRITE_AUDIT_FAILED',
  'WORKBOOK_WRITE_BACKUP_FAILED',
  'WORKBOOK_WRITE_TEMP_FAILED',
  'WORKBOOK_WRITE_VERIFICATION_FAILED',
  'WORKBOOK_WRITE_SOURCE_CHANGED',
  'WORKBOOK_WRITE_REPLACE_FAILED',
  'WORKBOOK_WRITE_ROLLBACK_FAILED',
] as const

export type LaborWorkbookWriteCode =
  | LaborWorkbookAgentPreflightCode
  | (typeof LABOR_WORKBOOK_WRITE_CODES)[number]

export interface LaborWorkbookRequestedChange {
  readonly cell: string
  /**
   * D sütunundaki parça kodu/metin. Formül çalıştırılmaz; değer inline string
   * olarak yazılır ve sharedStrings tablosuna dokunulmaz.
   */
  readonly newValue: string
}

export interface LaborWorkbookWritePreviewInput {
  readonly rootAbsolute: string
  readonly relativeWorkbookPath: string
  readonly expectedSha256?: string
  readonly expectedSize?: number
  readonly signature: WorkbookSignatureCheck
  readonly changes: readonly LaborWorkbookRequestedChange[]
  readonly now?: () => Date
}

export interface LaborWorkbookPreviewChange {
  readonly cell: string
  readonly previousValue: string | null
  readonly newValue: string
}

export type LaborWorkbookWritePreviewResult =
  | {
    readonly ok: false
    readonly code: LaborWorkbookWriteCode
    readonly detail: string | null
  }
  | {
    readonly ok: true
    readonly version: typeof LABOR_WORKBOOK_WRITE_PLAN_VERSION
    readonly planHash: string
    readonly createdAt: string
    readonly relativeWorkbookPath: string
    readonly sourceSha256: string
    readonly sourceSize: number
    readonly sourceModifiedIso: string
    readonly targetSheetName: string
    readonly targetWorksheetPart: string
    readonly changes: readonly LaborWorkbookPreviewChange[]
  }

export interface LaborWorkbookWriteApproval {
  readonly confirmed: true
  readonly planHash: string
  readonly approvedByUserId: string
  readonly approvedAt: string
}

export type LaborWorkbookWriteAuditEvent =
  | {
    readonly phase: 'started'
    readonly version: typeof LABOR_WORKBOOK_WRITE_VERSION
    readonly planHash: string
    readonly relativeWorkbookPath: string
    readonly targetSheetName: string
    readonly cells: readonly string[]
    readonly approvedByUserId: string
    readonly approvedAt: string
    readonly startSha256: string
    readonly resultSha256: null
    readonly backupFileName: null
    readonly errorCode: null
    readonly occurredAt: string
  }
  | {
    readonly phase: 'completed'
    readonly version: typeof LABOR_WORKBOOK_WRITE_VERSION
    readonly planHash: string
    readonly relativeWorkbookPath: string
    readonly targetSheetName: string
    readonly cells: readonly string[]
    readonly approvedByUserId: string
    readonly approvedAt: string
    readonly startSha256: string
    readonly resultSha256: string
    readonly backupFileName: string
    readonly errorCode: null
    readonly occurredAt: string
  }
  | {
    readonly phase: 'failed'
    readonly version: typeof LABOR_WORKBOOK_WRITE_VERSION
    readonly planHash: string
    readonly relativeWorkbookPath: string
    readonly targetSheetName: string
    readonly cells: readonly string[]
    readonly approvedByUserId: string
    readonly approvedAt: string
    readonly startSha256: string
    readonly resultSha256: string | null
    readonly backupFileName: string | null
    readonly errorCode: LaborWorkbookWriteCode
    readonly occurredAt: string
  }

export interface LaborWorkbookWriterHooks {
  readonly recordAudit: (event: LaborWorkbookWriteAuditEvent) => Promise<void>
  readonly beforeAtomicReplace?: () => Promise<void>
  readonly afterAtomicReplace?: () => Promise<void>
}

export interface LaborWorkbookWriteApplyInput extends LaborWorkbookWritePreviewInput {
  readonly preview: Extract<LaborWorkbookWritePreviewResult, { readonly ok: true }>
  readonly approval: LaborWorkbookWriteApproval
  readonly hooks: LaborWorkbookWriterHooks
}

export type LaborWorkbookWriteApplyResult =
  | {
    readonly ok: false
    readonly code: LaborWorkbookWriteCode
    readonly detail: string | null
    readonly sourcePreserved: boolean
    readonly startSha256: string | null
    readonly resultSha256: string | null
    readonly backupFileName: string | null
  }
  | {
    readonly ok: true
    readonly version: typeof LABOR_WORKBOOK_WRITE_VERSION
    readonly planHash: string
    readonly relativeWorkbookPath: string
    readonly targetSheetName: string
    readonly cells: readonly string[]
    readonly startSha256: string
    readonly resultSha256: string
    readonly backupFileName: string
  }

interface ValidatedChange {
  readonly cell: string
  readonly row: number
  readonly newValue: string
}

interface PatchedArchive {
  readonly bytes: Uint8Array
  readonly expectedSheetBytes: Uint8Array
}

function failPreview(
  code: LaborWorkbookWriteCode,
  detail: string | null = null,
): LaborWorkbookWritePreviewResult {
  return { ok: false, code, detail }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function canonicalPlanHash(input: {
  readonly relativeWorkbookPath: string
  readonly sourceSha256: string
  readonly sourceSize: number
  readonly sourceModifiedIso: string
  readonly targetSheetName: string
  readonly targetWorksheetPart: string
  readonly signature: WorkbookSignatureCheck
  readonly changes: readonly LaborWorkbookPreviewChange[]
}): string {
  const signature = {
    sheetName: input.signature.sheetName,
    headers: input.signature.headers.map((item) => ({ cell: item.cell, text: item.text })),
    identityCells: input.signature.identityCells.map((item) => ({ cell: item.cell, text: item.text })),
  }
  const canonical = JSON.stringify({
    version: LABOR_WORKBOOK_WRITE_PLAN_VERSION,
    relativeWorkbookPath: input.relativeWorkbookPath,
    sourceSha256: input.sourceSha256,
    sourceSize: input.sourceSize,
    sourceModifiedIso: input.sourceModifiedIso,
    targetSheetName: input.targetSheetName,
    targetWorksheetPart: input.targetWorksheetPart,
    signature,
    changes: input.changes,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) as number
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

function validateChanges(
  changes: readonly LaborWorkbookRequestedChange[],
  signature: WorkbookSignatureCheck,
): { readonly ok: true; readonly changes: readonly ValidatedChange[] }
  | { readonly ok: false; readonly code: LaborWorkbookWriteCode; readonly detail: string | null } {
  const signatureCells = new Set([
    ...signature.headers.map((item) => item.cell),
    ...signature.identityCells.map((item) => item.cell),
  ])
  const seen = new Set<string>()
  const validated: ValidatedChange[] = []

  for (const change of changes) {
    const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(change.cell)
    if (match === null) {
      return { ok: false, code: 'WORKBOOK_WRITE_CELL_INVALID', detail: change.cell }
    }
    const column = match[1] as string
    const row = Number(match[2])
    if (column !== LABOR_WORKBOOK_ALLOWED_WRITE_COLUMN) {
      return { ok: false, code: 'WORKBOOK_WRITE_COLUMN_FORBIDDEN', detail: change.cell }
    }
    if (seen.has(change.cell)) {
      return { ok: false, code: 'WORKBOOK_WRITE_DUPLICATE_CELL', detail: change.cell }
    }
    if (signatureCells.has(change.cell)) {
      return { ok: false, code: 'WORKBOOK_WRITE_SIGNATURE_CELL_FORBIDDEN', detail: change.cell }
    }
    if (row < 2 || row > MAX_EXCEL_ROW) {
      return { ok: false, code: 'WORKBOOK_WRITE_ROW_FORBIDDEN', detail: change.cell }
    }
    if (typeof change.newValue !== 'string'
      || change.newValue.length === 0
      || change.newValue.length > MAX_CELL_VALUE_LENGTH
      || change.newValue.startsWith('=')
      || containsControlCharacter(change.newValue)) {
      return { ok: false, code: 'WORKBOOK_WRITE_VALUE_INVALID', detail: change.cell }
    }
    seen.add(change.cell)
    validated.push({ cell: change.cell, row, newValue: change.newValue })
  }

  if (validated.length === 0) {
    return { ok: false, code: 'WORKBOOK_WRITE_NO_CHANGES', detail: null }
  }
  return {
    ok: true,
    changes: [...validated].sort((left, right) => left.row - right.row),
  }
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function excelColumnIndex(column: string): number {
  let index = 0
  for (const character of column) {
    index = index * 26 + (character.charCodeAt(0) - 64)
  }
  return index
}

function patchDCells(
  sheetXml: string,
  changes: readonly ValidatedChange[],
): { readonly ok: true; readonly xml: string }
  | { readonly ok: false; readonly code: LaborWorkbookWriteCode; readonly detail: string } {
  if (!sheetXml.includes('<sheetData')) {
    return { ok: false, code: 'WORKBOOK_WRITE_VERIFICATION_FAILED', detail: 'sheetData' }
  }
  let xml = sheetXml

  for (const change of changes) {
    const rowPattern = new RegExp(`<row[^>]*\\sr="${change.row}"[^>]*(?:/>|>[\\s\\S]*?</row>)`)
    const rowMatch = rowPattern.exec(xml)
    let rowXml = rowMatch?.[0] ?? `<row r="${change.row}"></row>`
    if (rowXml.endsWith('/>')) rowXml = `${rowXml.slice(0, -2)}></row>`

    const cellPattern = new RegExp(
      `<c\\b([^>]*\\br="${change.cell}"[^>]*)>([\\s\\S]*?)</c>`
      + `|<c\\b([^>]*\\br="${change.cell}"[^>]*)/>`,
    )
    const cellMatch = cellPattern.exec(rowXml)
    const escaped = escapeXmlText(change.newValue)

    if (cellMatch === null) {
      const existingCells = [...rowXml.matchAll(/<c\b[^>]*\br="([A-Z]+)(\d+)"/g)]
      let insertAt = rowXml.lastIndexOf('</row>')
      for (const existing of existingCells) {
        const existingColumn = existing[1] as string
        if (excelColumnIndex(existingColumn) > excelColumnIndex(LABOR_WORKBOOK_ALLOWED_WRITE_COLUMN)) {
          insertAt = existing.index as number
          break
        }
      }
      rowXml = `${rowXml.slice(0, insertAt)}<c r="${change.cell}" t="inlineStr">`
        + `<is><t xml:space="preserve">${escaped}</t></is></c>${rowXml.slice(insertAt)}`
    } else {
      const attributes = cellMatch[1] ?? cellMatch[3] ?? ''
      const body = cellMatch[2] ?? ''
      if (/<f[\s>/]/u.test(body)) {
        return { ok: false, code: 'WORKBOOK_WRITE_CELL_FORMULA', detail: change.cell }
      }
      const keptAttributes = attributes
        .replace(/\sr="[^"]*"/g, '')
        .replace(/\st="[^"]*"/g, '')
      const replacement = `<c r="${change.cell}"${keptAttributes} t="inlineStr">`
        + `<is><t xml:space="preserve">${escaped}</t></is></c>`
      rowXml = rowXml.slice(0, cellMatch.index)
        + replacement
        + rowXml.slice((cellMatch.index as number) + cellMatch[0].length)
    }

    if (rowMatch === null) {
      const rows = [...xml.matchAll(/<row[^>]*\sr="(\d+)"/g)]
      let insertAt = xml.indexOf('</sheetData>')
      for (const existing of rows) {
        if (Number(existing[1]) > change.row) {
          insertAt = existing.index as number
          break
        }
      }
      xml = xml.slice(0, insertAt) + rowXml + xml.slice(insertAt)
    } else {
      xml = xml.slice(0, rowMatch.index)
        + rowXml
        + xml.slice((rowMatch.index as number) + rowMatch[0].length)
    }
  }
  return { ok: true, xml }
}

function buildPatchedArchive(
  sourceBytes: Uint8Array,
  targetWorksheetPart: string,
  changes: readonly ValidatedChange[],
): PatchedArchive | { readonly code: LaborWorkbookWriteCode; readonly detail: string | null } {
  let archive: Record<string, Uint8Array>
  try {
    archive = unzipSync(sourceBytes)
  } catch {
    return { code: 'WORKBOOK_WRITE_VERIFICATION_FAILED', detail: null }
  }
  const sheetBytes = archive[targetWorksheetPart]
  if (sheetBytes === undefined) {
    return { code: 'WORKBOOK_WRITE_VERIFICATION_FAILED', detail: null }
  }
  const patched = patchDCells(strFromU8(sheetBytes), changes)
  if (!patched.ok) return { code: patched.code, detail: patched.detail }
  const expectedSheetBytes = strToU8(patched.xml)
  archive[targetWorksheetPart] = expectedSheetBytes
  return { bytes: zipSync(archive), expectedSheetBytes }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength
    && left.every((value, index) => value === right[index])
}

function verifyArchiveScope(input: {
  readonly sourceBytes: Uint8Array
  readonly resultBytes: Uint8Array
  readonly targetWorksheetPart: string
  readonly expectedSheetBytes: Uint8Array
}): boolean {
  let source: Record<string, Uint8Array>
  let result: Record<string, Uint8Array>
  try {
    source = unzipSync(input.sourceBytes)
    result = unzipSync(input.resultBytes)
  } catch {
    return false
  }
  const sourceNames = Object.keys(source).sort()
  const resultNames = Object.keys(result).sort()
  if (JSON.stringify(sourceNames) !== JSON.stringify(resultNames)) return false

  for (const name of sourceNames) {
    const resultPart = result[name]
    if (resultPart === undefined) return false
    if (name === input.targetWorksheetPart) {
      if (!bytesEqual(resultPart, input.expectedSheetBytes)) return false
      continue
    }
    const sourcePart = source[name]
    if (sourcePart === undefined || !bytesEqual(sourcePart, resultPart)) return false
  }
  return true
}

function safeTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:.]/g, '')
}

function backupName(sourcePath: string, at: Date, planHash: string): string {
  const sourceName = basename(sourcePath)
  const extension = extname(sourceName)
  const stem = sourceName.slice(0, sourceName.length - extension.length)
  return `${stem}.${safeTimestamp(at)}.${planHash.slice(0, 12)}.bak.xlsx`
}

async function safeCurrentHash(path: string): Promise<string | null> {
  try {
    return sha256WorkbookBytes(await readFile(path))
  } catch {
    return null
  }
}

async function sourceIsPreserved(path: string, expected: Uint8Array): Promise<boolean> {
  try {
    return bytesEqual(await readFile(path), expected)
  } catch {
    return false
  }
}

async function restoreSourceFromBackup(input: {
  readonly sourcePath: string
  readonly backupPath: string
  readonly expectedSource: Uint8Array
  readonly token: string
}): Promise<boolean> {
  const recoveryPath = `${input.sourcePath}.hasarbotu-${input.token}.restore.tmp.xlsx`
  try {
    await copyFile(input.backupPath, recoveryPath, fsConstants.COPYFILE_EXCL)
    const handle = await open(recoveryPath, 'r+')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
    if (!bytesEqual(await readFile(recoveryPath), input.expectedSource)) return false
    await rename(recoveryPath, input.sourcePath)
    return await sourceIsPreserved(input.sourcePath, input.expectedSource)
  } catch {
    return false
  } finally {
    await unlink(recoveryPath).catch(() => undefined)
  }
}

export async function previewLaborWorkbookWrite(
  input: LaborWorkbookWritePreviewInput,
): Promise<LaborWorkbookWritePreviewResult> {
  const validated = validateChanges(input.changes, input.signature)
  if (!validated.ok) return failPreview(validated.code, validated.detail)

  const preflight = await preflightLaborWorkbook({
    rootAbsolute: input.rootAbsolute,
    relativeWorkbookPath: input.relativeWorkbookPath,
    ...(input.expectedSha256 === undefined ? {} : { expectedSha256: input.expectedSha256 }),
    ...(input.expectedSize === undefined ? {} : { expectedSize: input.expectedSize }),
    signature: input.signature,
  })
  if (!preflight.ok) return failPreview(preflight.code, preflight.detail)

  try {
    const candidate = resolveUnderRoot(input.rootAbsolute, input.relativeWorkbookPath)
    const safePath = await assertRealPathUnderRoot(input.rootAbsolute, candidate)
    const bytes = await readFile(safePath)
    if (sha256WorkbookBytes(bytes) !== preflight.sha256 || bytes.byteLength !== preflight.size) {
      return failPreview('WORKBOOK_WRITE_SOURCE_CHANGED')
    }
    const workbook = extractOoxmlWorkbook(bytes)
    const sheet = getOoxmlSheet(workbook, preflight.targetSheetName)
    if (sheet.partName !== preflight.targetWorksheetPart || sheet.state !== 'visible') {
      return failPreview('WORKBOOK_WRITE_SOURCE_CHANGED')
    }
    const current = new Map(sheet.cells.map((cell) => [cell.address, cell.value] as const))
    const changes = validated.changes
      .map((change): LaborWorkbookPreviewChange => ({
        cell: change.cell,
        previousValue: current.get(change.cell) ?? null,
        newValue: change.newValue,
      }))
      .filter((change) => change.previousValue !== change.newValue)
    if (changes.length === 0) return failPreview('WORKBOOK_WRITE_NO_CHANGES')

    const patch = buildPatchedArchive(
      bytes,
      preflight.targetWorksheetPart,
      validated.changes.filter((item) => changes.some((change) => change.cell === item.cell)),
    )
    if ('code' in patch) return failPreview(patch.code, patch.detail)

    const planHash = canonicalPlanHash({
      relativeWorkbookPath: input.relativeWorkbookPath,
      sourceSha256: preflight.sha256,
      sourceSize: preflight.size,
      sourceModifiedIso: preflight.modifiedIso,
      targetSheetName: preflight.targetSheetName,
      targetWorksheetPart: preflight.targetWorksheetPart,
      signature: input.signature,
      changes,
    })
    return {
      ok: true,
      version: LABOR_WORKBOOK_WRITE_PLAN_VERSION,
      planHash,
      createdAt: (input.now?.() ?? new Date()).toISOString(),
      relativeWorkbookPath: input.relativeWorkbookPath,
      sourceSha256: preflight.sha256,
      sourceSize: preflight.size,
      sourceModifiedIso: preflight.modifiedIso,
      targetSheetName: preflight.targetSheetName,
      targetWorksheetPart: preflight.targetWorksheetPart,
      changes,
    }
  } catch {
    return failPreview('WORKBOOK_WRITE_SOURCE_CHANGED')
  }
}

export async function applyLaborWorkbookWrite(
  input: LaborWorkbookWriteApplyInput,
): Promise<LaborWorkbookWriteApplyResult> {
  const now = input.now ?? (() => new Date())
  if (input.approval.confirmed !== true
    || input.approval.approvedByUserId.trim().length === 0
    || !Number.isFinite(Date.parse(input.approval.approvedAt))) {
    return {
      ok: false,
      code: 'WORKBOOK_WRITE_APPROVAL_REQUIRED',
      detail: null,
      sourcePreserved: true,
      startSha256: null,
      resultSha256: null,
      backupFileName: null,
    }
  }
  if (input.approval.planHash !== input.preview.planHash) {
    return {
      ok: false,
      code: 'WORKBOOK_WRITE_APPROVAL_MISMATCH',
      detail: null,
      sourcePreserved: true,
      startSha256: null,
      resultSha256: null,
      backupFileName: null,
    }
  }

  const initial = await previewLaborWorkbookWrite({
    ...input,
    expectedSha256: input.preview.sourceSha256,
    expectedSize: input.preview.sourceSize,
  })
  if (!initial.ok || initial.planHash !== input.preview.planHash) {
    return {
      ok: false,
      code: initial.ok ? 'WORKBOOK_WRITE_PLAN_STALE' : initial.code,
      detail: initial.ok ? null : initial.detail,
      sourcePreserved: true,
      startSha256: initial.ok ? initial.sourceSha256 : null,
      resultSha256: initial.ok ? initial.sourceSha256 : null,
      backupFileName: null,
    }
  }

  let sourcePath: string
  try {
    const candidate = resolveUnderRoot(input.rootAbsolute, input.relativeWorkbookPath)
    sourcePath = await assertRealPathUnderRoot(input.rootAbsolute, candidate)
  } catch {
    return {
      ok: false,
      code: 'WORKBOOK_PATH_UNSAFE',
      detail: null,
      sourcePreserved: true,
      startSha256: null,
      resultSha256: null,
      backupFileName: null,
    }
  }

  const token = randomUUID()
  const lockPath = `${sourcePath}.hasarbotu-write.lock`
  const temporaryPath = `${sourcePath}.hasarbotu-${token}.tmp.xlsx`
  let lockHandle: Awaited<ReturnType<typeof open>> | null = null
  let sourceBytes: Uint8Array | null = null
  let backupPath: string | null = null
  let backupFileName: string | null = null
  let replaced = false

  try {
    try {
      lockHandle = await open(lockPath, 'wx')
      await lockHandle.writeFile(`${input.preview.planHash}\n`, 'utf8')
      await lockHandle.sync()
    } catch {
      return {
        ok: false,
        code: 'WORKBOOK_WRITE_LOCKED',
        detail: null,
        sourcePreserved: true,
        startSha256: input.preview.sourceSha256,
        resultSha256: await safeCurrentHash(sourcePath),
        backupFileName: null,
      }
    }

    const underLock = await previewLaborWorkbookWrite({
      ...input,
      expectedSha256: input.preview.sourceSha256,
      expectedSize: input.preview.sourceSize,
    })
    if (!underLock.ok || underLock.planHash !== input.preview.planHash) {
      return {
        ok: false,
        code: underLock.ok ? 'WORKBOOK_WRITE_PLAN_STALE' : underLock.code,
        detail: underLock.ok ? null : underLock.detail,
        sourcePreserved: true,
        startSha256: input.preview.sourceSha256,
        resultSha256: await safeCurrentHash(sourcePath),
        backupFileName: null,
      }
    }

    sourceBytes = await readFile(sourcePath)
    if (sha256WorkbookBytes(sourceBytes) !== input.preview.sourceSha256) {
      return {
        ok: false,
        code: 'WORKBOOK_WRITE_SOURCE_CHANGED',
        detail: null,
        sourcePreserved: true,
        startSha256: input.preview.sourceSha256,
        resultSha256: sha256WorkbookBytes(sourceBytes),
        backupFileName: null,
      }
    }

    const startedEvent: LaborWorkbookWriteAuditEvent = {
      phase: 'started',
      version: LABOR_WORKBOOK_WRITE_VERSION,
      planHash: input.preview.planHash,
      relativeWorkbookPath: input.relativeWorkbookPath,
      targetSheetName: input.preview.targetSheetName,
      cells: input.preview.changes.map((change) => change.cell),
      approvedByUserId: input.approval.approvedByUserId,
      approvedAt: input.approval.approvedAt,
      startSha256: input.preview.sourceSha256,
      resultSha256: null,
      backupFileName: null,
      errorCode: null,
      occurredAt: now().toISOString(),
    }
    try {
      await input.hooks.recordAudit(startedEvent)
    } catch {
      return {
        ok: false,
        code: 'WORKBOOK_WRITE_AUDIT_FAILED',
        detail: null,
        sourcePreserved: true,
        startSha256: input.preview.sourceSha256,
        resultSha256: input.preview.sourceSha256,
        backupFileName: null,
      }
    }

    const failAfterStarted = async (
      code: LaborWorkbookWriteCode,
      detail: string | null = null,
    ): Promise<Extract<LaborWorkbookWriteApplyResult, { readonly ok: false }>> => {
      const resultSha256 = await safeCurrentHash(sourcePath)
      const sourcePreserved = await sourceIsPreserved(sourcePath, sourceBytes as Uint8Array)
      let auditRecorded = true
      await input.hooks.recordAudit({
        ...startedEvent,
        phase: 'failed',
        resultSha256,
        backupFileName,
        errorCode: code,
        occurredAt: now().toISOString(),
      }).catch(() => {
        auditRecorded = false
      })
      return {
        ok: false,
        code: auditRecorded ? code : 'WORKBOOK_WRITE_AUDIT_FAILED',
        detail: auditRecorded ? detail : code,
        sourcePreserved,
        startSha256: input.preview.sourceSha256,
        resultSha256,
        backupFileName,
      }
    }

    const directory = dirname(sourcePath)
    backupFileName = backupName(sourcePath, now(), input.preview.planHash)
    backupPath = join(directory, backupFileName)
    try {
      await copyFile(sourcePath, backupPath, fsConstants.COPYFILE_EXCL)
      const backupBytes = await readFile(backupPath)
      if (!bytesEqual(backupBytes, sourceBytes)) throw new Error('backup_mismatch')
    } catch {
      return await failAfterStarted('WORKBOOK_WRITE_BACKUP_FAILED')
    }

    const validated = validateChanges(
      input.preview.changes.map((change) => ({ cell: change.cell, newValue: change.newValue })),
      input.signature,
    )
    if (!validated.ok) {
      return await failAfterStarted(validated.code, validated.detail)
    }
    const patched = buildPatchedArchive(
      sourceBytes,
      input.preview.targetWorksheetPart,
      validated.changes,
    )
    if ('code' in patched) {
      return await failAfterStarted(patched.code, patched.detail)
    }

    let resultBytes: Uint8Array
    try {
      const tempHandle = await open(temporaryPath, 'wx')
      try {
        await tempHandle.writeFile(patched.bytes)
        await tempHandle.sync()
      } finally {
        await tempHandle.close()
      }
      resultBytes = await readFile(temporaryPath)
    } catch {
      return await failAfterStarted('WORKBOOK_WRITE_TEMP_FAILED')
    }

    const resultHash = sha256(resultBytes)
    if (!verifyArchiveScope({
      sourceBytes,
      resultBytes,
      targetWorksheetPart: input.preview.targetWorksheetPart,
      expectedSheetBytes: patched.expectedSheetBytes,
    })) {
      return await failAfterStarted('WORKBOOK_WRITE_VERIFICATION_FAILED')
    }

    const tempRelativePath =
      `${input.relativeWorkbookPath}.hasarbotu-${token}.tmp.xlsx`
    const tempPreflight = await preflightLaborWorkbook({
      rootAbsolute: input.rootAbsolute,
      relativeWorkbookPath: tempRelativePath,
      expectedSha256: resultHash,
      expectedSize: resultBytes.byteLength,
      signature: input.signature,
    })
    if (!tempPreflight.ok
      || tempPreflight.targetWorksheetPart !== input.preview.targetWorksheetPart
      || tempPreflight.targetSheetName !== input.preview.targetSheetName) {
      return await failAfterStarted('WORKBOOK_WRITE_VERIFICATION_FAILED')
    }

    const [beforeReplace, beforeReplaceStat] = await Promise.all([
      readFile(sourcePath),
      stat(sourcePath),
    ])
    if (!bytesEqual(beforeReplace, sourceBytes)
      || beforeReplaceStat.size !== input.preview.sourceSize
      || beforeReplaceStat.mtime.toISOString() !== input.preview.sourceModifiedIso) {
      return await failAfterStarted('WORKBOOK_WRITE_SOURCE_CHANGED')
    }

    try {
      await input.hooks.beforeAtomicReplace?.()
      await rename(temporaryPath, sourcePath)
      replaced = true
      await input.hooks.afterAtomicReplace?.()
      const finalBytes = await readFile(sourcePath)
      if (!bytesEqual(finalBytes, resultBytes) || sha256WorkbookBytes(finalBytes) !== resultHash) {
        throw new Error('post_replace_verification_failed')
      }
    } catch {
      if (replaced && backupPath !== null) {
        const restored = await restoreSourceFromBackup({
          sourcePath,
          backupPath,
          expectedSource: sourceBytes,
          token,
        })
        if (!restored) {
          await input.hooks.recordAudit({
            ...startedEvent,
            phase: 'failed',
            resultSha256: await safeCurrentHash(sourcePath),
            backupFileName,
            errorCode: 'WORKBOOK_WRITE_ROLLBACK_FAILED',
            occurredAt: now().toISOString(),
          }).catch(() => undefined)
          return {
            ok: false,
            code: 'WORKBOOK_WRITE_ROLLBACK_FAILED',
            detail: null,
            sourcePreserved: false,
            startSha256: input.preview.sourceSha256,
            resultSha256: await safeCurrentHash(sourcePath),
            backupFileName,
          }
        }
      }
      const code: LaborWorkbookWriteCode = replaced
        ? 'WORKBOOK_WRITE_VERIFICATION_FAILED'
        : 'WORKBOOK_WRITE_REPLACE_FAILED'
      return await failAfterStarted(code)
    }

    const completedEvent: LaborWorkbookWriteAuditEvent = {
      ...startedEvent,
      phase: 'completed',
      resultSha256: resultHash,
      backupFileName,
      errorCode: null,
      occurredAt: now().toISOString(),
    }
    try {
      await input.hooks.recordAudit(completedEvent)
    } catch {
      const restored = backupPath !== null && await restoreSourceFromBackup({
        sourcePath,
        backupPath,
        expectedSource: sourceBytes,
        token,
      })
      if (!restored) {
        return {
          ok: false,
          code: 'WORKBOOK_WRITE_ROLLBACK_FAILED',
          detail: null,
          sourcePreserved: false,
          startSha256: input.preview.sourceSha256,
          resultSha256: await safeCurrentHash(sourcePath),
          backupFileName,
        }
      }
      await input.hooks.recordAudit({
        ...startedEvent,
        phase: 'failed',
        resultSha256: input.preview.sourceSha256,
        backupFileName,
        errorCode: 'WORKBOOK_WRITE_AUDIT_FAILED',
        occurredAt: now().toISOString(),
      }).catch(() => undefined)
      return {
        ok: false,
        code: 'WORKBOOK_WRITE_AUDIT_FAILED',
        detail: null,
        sourcePreserved: true,
        startSha256: input.preview.sourceSha256,
        resultSha256: input.preview.sourceSha256,
        backupFileName,
      }
    }

    return {
      ok: true,
      version: LABOR_WORKBOOK_WRITE_VERSION,
      planHash: input.preview.planHash,
      relativeWorkbookPath: input.relativeWorkbookPath,
      targetSheetName: input.preview.targetSheetName,
      cells: input.preview.changes.map((change) => change.cell),
      startSha256: input.preview.sourceSha256,
      resultSha256: resultHash,
      backupFileName,
    }
  } finally {
    await unlink(temporaryPath).catch(() => undefined)
    if (lockHandle !== null) {
      await lockHandle.close().catch(() => undefined)
      await unlink(lockPath).catch(() => undefined)
    }
  }
}
