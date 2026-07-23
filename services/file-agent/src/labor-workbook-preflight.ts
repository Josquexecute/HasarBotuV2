import { lstat, readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { strFromU8, unzipSync } from 'fflate'
import {
  LABOR_WORKBOOK_LIMITS,
  detectForbiddenOoxmlParts,
  validateZipStructure,
  verifyWorkbookSignature,
  type LaborWorkbookPreflightCode,
  type WorkbookSignatureCheck,
  type ZipEntryMeta,
} from '@hasarbotu/domain'
import {
  OoxmlExtractorError,
  extractOoxmlWorkbook,
  getOoxmlSheet,
  sha256WorkbookBytes,
} from './ooxml-readonly-extractor.js'
import {
  PathSafetyError,
  assertRealPathUnderRoot,
  resolveUnderRoot,
} from './path-resolver.js'

export const LABOR_WORKBOOK_AGENT_PREFLIGHT_VERSION =
  'labor-workbook-agent-preflight/1.0.0' as const

export const LABOR_WORKBOOK_AGENT_PREFLIGHT_CODES = [
  'WORKBOOK_PATH_UNSAFE',
  'WORKBOOK_SOURCE_MISSING',
  'WORKBOOK_SOURCE_NOT_FILE',
  'WORKBOOK_SOURCE_LINK_FORBIDDEN',
  'WORKBOOK_SOURCE_CHANGED',
  'WORKBOOK_HASH_MISMATCH',
  'WORKBOOK_SIZE_MISMATCH',
  'WORKBOOK_ZIP_INVALID',
  'WORKBOOK_ZIP64_UNSUPPORTED',
  'WORKBOOK_CONTENT_TYPES_MISSING',
  'WORKBOOK_TARGET_SHEET_MISSING',
  'WORKBOOK_TARGET_SHEET_HIDDEN',
  'WORKBOOK_SIGNATURE_MISMATCH',
] as const

export type LaborWorkbookAgentPreflightCode =
  | LaborWorkbookPreflightCode
  | (typeof LABOR_WORKBOOK_AGENT_PREFLIGHT_CODES)[number]

export interface LaborWorkbookAgentPreflightInput {
  readonly rootAbsolute: string
  readonly relativeWorkbookPath: string
  readonly expectedSha256?: string
  readonly expectedSize?: number
  readonly signature: WorkbookSignatureCheck
}

export type LaborWorkbookAgentPreflightResult =
  | {
    readonly ok: false
    readonly code: LaborWorkbookAgentPreflightCode
    readonly detail: string | null
  }
  | {
    readonly ok: true
    readonly version: typeof LABOR_WORKBOOK_AGENT_PREFLIGHT_VERSION
    readonly sha256: string
    readonly size: number
    readonly modifiedIso: string
    readonly workbookPartName: string
    readonly targetWorksheetPart: string
    readonly targetSheetName: string
    readonly entryCount: number
  }

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const MAX_EOCD_SEARCH = 65_557

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function readU16(view: DataView, offset: number): number {
  if (offset < 0 || offset + 2 > view.byteLength) throw new Error('zip_bounds')
  return view.getUint16(offset, true)
}

function readU32(view: DataView, offset: number): number {
  if (offset < 0 || offset + 4 > view.byteLength) throw new Error('zip_bounds')
  return view.getUint32(offset, true)
}

/**
 * ZIP merkezi dizinini arşivi açmadan okur. Böylece entry-count, açılmış toplam
 * boyut ve compression-ratio kapıları `unzipSync` bellek ayırmadan önce çalışır.
 * ZIP64 bilinçli olarak fail-closed reddedilir; normal `.xlsx` buna ihtiyaç duymaz.
 */
export function readZipCentralDirectory(bytes: Uint8Array): readonly ZipEntryMeta[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const searchStart = Math.max(0, bytes.byteLength - MAX_EOCD_SEARCH)
  let eocd = -1
  for (let offset = bytes.byteLength - 22; offset >= searchStart; offset -= 1) {
    if (readU32(view, offset) === EOCD_SIGNATURE) {
      eocd = offset
      break
    }
  }
  if (eocd < 0) throw new Error('zip_invalid')

  const disk = readU16(view, eocd + 4)
  const directoryDisk = readU16(view, eocd + 6)
  const entriesOnDisk = readU16(view, eocd + 8)
  const entryCount = readU16(view, eocd + 10)
  const directorySize = readU32(view, eocd + 12)
  const directoryOffset = readU32(view, eocd + 16)
  if (disk !== 0 || directoryDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new Error('zip_multidisk')
  }
  if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new Error('zip64')
  }
  if (directoryOffset + directorySize > eocd) {
    throw new Error('zip_invalid')
  }

  const decoder = new TextDecoder('utf-8', { fatal: true })
  const entries: ZipEntryMeta[] = []
  let offset = directoryOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (readU32(view, offset) !== CENTRAL_DIRECTORY_SIGNATURE) throw new Error('zip_invalid')
    const flags = readU16(view, offset + 8)
    const compressedSize = readU32(view, offset + 20)
    const uncompressedSize = readU32(view, offset + 24)
    const nameLength = readU16(view, offset + 28)
    const extraLength = readU16(view, offset + 30)
    const commentLength = readU16(view, offset + 32)
    const entryEnd = offset + 46 + nameLength + extraLength + commentLength
    if (entryEnd > directoryOffset + directorySize) throw new Error('zip_invalid')
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    entries.push({
      name,
      compressedSize,
      uncompressedSize,
      encrypted: (flags & 0x1) !== 0,
    })
    offset = entryEnd
  }
  if (offset !== directoryOffset + directorySize) throw new Error('zip_invalid')
  return entries
}

function fail(
  code: LaborWorkbookAgentPreflightCode,
  detail: string | null = null,
): LaborWorkbookAgentPreflightResult {
  return { ok: false, code, detail }
}

function safeErrorCode(error: unknown): LaborWorkbookAgentPreflightCode {
  if (error instanceof PathSafetyError) return 'WORKBOOK_PATH_UNSAFE'
  if (error instanceof OoxmlExtractorError) {
    if (error.code === 'OOXML_SHEET_MISSING') return 'WORKBOOK_TARGET_SHEET_MISSING'
    return 'WORKBOOK_ZIP_INVALID'
  }
  if (error instanceof Error && error.message === 'zip64') return 'WORKBOOK_ZIP64_UNSUPPORTED'
  return 'WORKBOOK_ZIP_INVALID'
}

/**
 * Salt-okunur File Agent preflight.
 *
 * Mutlak root yalnız Agent process'indedir ve sonuçta dönmez. Dosya iki kez
 * okunup hash'lenir; inceleme sırasında değişirse hiçbir plan kaynağı üretilmez.
 * Worksheet part adı tahmin edilmez, OOXML relationship zincirinden çözülür.
 */
export async function preflightLaborWorkbook(
  input: LaborWorkbookAgentPreflightInput,
): Promise<LaborWorkbookAgentPreflightResult> {
  let candidate: string
  try {
    candidate = resolveUnderRoot(input.rootAbsolute, input.relativeWorkbookPath)
  } catch (error) {
    return fail(safeErrorCode(error))
  }

  try {
    const linkStat = await lstat(candidate)
    if (linkStat.isSymbolicLink()) return fail('WORKBOOK_SOURCE_LINK_FORBIDDEN')
    if (!linkStat.isFile()) return fail('WORKBOOK_SOURCE_NOT_FILE')
    if (linkStat.size > LABOR_WORKBOOK_LIMITS.maxCompressedBytes) {
      return fail('WORKBOOK_COMPRESSED_TOO_LARGE')
    }
    const safePath = await assertRealPathUnderRoot(input.rootAbsolute, candidate)

    const firstBytes = await readFile(safePath)
    const firstHash = sha256WorkbookBytes(firstBytes)
    if (input.expectedSize !== undefined && firstBytes.byteLength !== input.expectedSize) {
      return fail('WORKBOOK_SIZE_MISMATCH')
    }
    if (input.expectedSha256 !== undefined
      && firstHash !== input.expectedSha256.trim().toLowerCase()) {
      return fail('WORKBOOK_HASH_MISMATCH')
    }

    let zipEntries: readonly ZipEntryMeta[]
    try {
      zipEntries = readZipCentralDirectory(firstBytes)
    } catch (error) {
      return fail(safeErrorCode(error))
    }
    const structure = validateZipStructure(zipEntries)
    if (!structure.ok) return fail(structure.codes[0] as LaborWorkbookPreflightCode)

    let archive: Readonly<Record<string, Uint8Array>>
    try {
      archive = unzipSync(firstBytes)
    } catch {
      return fail('WORKBOOK_ZIP_INVALID')
    }
    const contentTypes = archive['[Content_Types].xml']
    if (contentTypes === undefined) return fail('WORKBOOK_CONTENT_TYPES_MISSING')
    const forbidden = detectForbiddenOoxmlParts({
      entryNames: Object.keys(archive),
      contentTypesXml: strFromU8(contentTypes),
      relationshipXmls: Object.entries(archive)
        .filter(([name]) => name.toLocaleLowerCase('tr').endsWith('.rels'))
        .map(([, value]) => strFromU8(value)),
    })
    if (forbidden.length > 0) return fail(forbidden[0] as LaborWorkbookPreflightCode)

    const workbook = extractOoxmlWorkbook(firstBytes)
    let sheet
    try {
      sheet = getOoxmlSheet(workbook, input.signature.sheetName)
    } catch {
      return fail('WORKBOOK_TARGET_SHEET_MISSING')
    }
    if (sheet.state !== 'visible') return fail('WORKBOOK_TARGET_SHEET_HIDDEN')

    const cells = new Map(sheet.cells.flatMap((cell) =>
      cell.value === null ? [] : [[cell.address, cell.value] as const],
    ))
    const signature = verifyWorkbookSignature(input.signature, cells)
    if (!signature.verified) {
      return fail('WORKBOOK_SIGNATURE_MISMATCH', signature.detail)
    }

    const secondBytes = await readFile(safePath)
    const secondHash = sha256(secondBytes)
    if (firstHash !== secondHash || firstBytes.byteLength !== secondBytes.byteLength) {
      return fail('WORKBOOK_SOURCE_CHANGED')
    }
    const endStat = await stat(safePath)
    if (!endStat.isFile() || endStat.size !== firstBytes.byteLength) {
      return fail('WORKBOOK_SOURCE_CHANGED')
    }

    return {
      ok: true,
      version: LABOR_WORKBOOK_AGENT_PREFLIGHT_VERSION,
      sha256: firstHash,
      size: firstBytes.byteLength,
      modifiedIso: endStat.mtime.toISOString(),
      workbookPartName: workbook.workbookPartName,
      targetWorksheetPart: sheet.partName,
      targetSheetName: sheet.name,
      entryCount: zipEntries.length,
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return fail('WORKBOOK_SOURCE_MISSING')
    }
    return fail(safeErrorCode(error))
  }
}
