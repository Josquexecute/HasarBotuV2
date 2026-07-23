/**
 * Generic, salt-okunur OOXML workbook extractor.
 *
 * Dosya yolu almaz, dosya yazmaz ve Excel/LibreOffice kullanmaz. Çağıran katmanın
 * verdiği byte dizisini açar; package/workbook relationship'leri üzerinden
 * workbook, sharedStrings ve worksheet part'larını çözer.
 */
import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'

export const OOXML_READONLY_EXTRACTOR_VERSION = 'ooxml-readonly-extractor/1.0.0' as const

interface XmlNode {
  readonly name: string
  readonly localName: string
  readonly attributes: Readonly<Record<string, string>>
  readonly children: XmlNode[]
  text: string
}

interface OoxmlRelationship {
  readonly id: string
  readonly type: string
  readonly target: string
  readonly targetMode: string | null
}

export interface OoxmlHiddenColumn {
  readonly min: number
  readonly max: number
}

export interface OoxmlDataValidation {
  readonly sqref: string
  readonly type: string | null
  readonly allowBlank: boolean
  readonly formula1: string | null
}

export interface OoxmlCell {
  readonly address: string
  readonly row: number
  readonly column: number
  readonly type: string | null
  readonly styleIndex: number | null
  readonly rawValue: string | null
  readonly value: string | null
  readonly formula: string | null
  readonly sharedStringIndex: number | null
}

export interface OoxmlWorksheet {
  readonly name: string
  readonly state: 'visible' | 'hidden' | 'veryHidden'
  readonly relationshipId: string
  readonly partName: string
  readonly dimension: string | null
  readonly mergedRanges: readonly string[]
  readonly hiddenRows: readonly number[]
  readonly hiddenColumns: readonly OoxmlHiddenColumn[]
  readonly dataValidations: readonly OoxmlDataValidation[]
  readonly cells: readonly OoxmlCell[]
}

export interface OoxmlWorkbook {
  readonly extractorVersion: typeof OOXML_READONLY_EXTRACTOR_VERSION
  readonly workbookPartName: string
  readonly sharedStringsPartName: string | null
  readonly sharedStrings: readonly string[]
  readonly sheets: readonly OoxmlWorksheet[]
}

export class OoxmlExtractorError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'OoxmlExtractorError'
  }
}

function decodeXml(value: string): string {
  return value.replace(
    /&(?:#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g,
    (entity) => {
      if (entity === '&amp;') return '&'
      if (entity === '&lt;') return '<'
      if (entity === '&gt;') return '>'
      if (entity === '&quot;') return '"'
      if (entity === '&apos;') return '\''
      const radix = entity.startsWith('&#x') ? 16 : 10
      const digits = entity.slice(radix === 16 ? 3 : 2, -1)
      const point = Number.parseInt(digits, radix)
      if (!Number.isFinite(point) || point < 0 || point > 0x10ffff) {
        throw new OoxmlExtractorError('OOXML_XML_ENTITY_INVALID', 'Geçersiz XML karakter varlığı')
      }
      return String.fromCodePoint(point)
    },
  )
}

function parseAttributes(source: string): Readonly<Record<string, string>> {
  const attributes: Record<string, string> = {}
  const pattern = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  for (const match of source.matchAll(pattern)) {
    const name = match[1]
    if (name === undefined) continue
    attributes[name] = decodeXml(match[2] ?? match[3] ?? '')
  }
  return attributes
}

function parseXml(xml: string): XmlNode {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new OoxmlExtractorError('OOXML_XML_DTD_FORBIDDEN', 'DTD ve harici entity yasaktır')
  }
  const documentNode: XmlNode = {
    name: '#document',
    localName: '#document',
    attributes: {},
    children: [],
    text: '',
  }
  const stack: XmlNode[] = [documentNode]
  const tokens = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\/?[^>]+>|[^<]+/g

  for (const match of xml.matchAll(tokens)) {
    const token = match[0]
    if (token === undefined || token.length === 0) continue
    const current = stack.at(-1)
    if (current === undefined) {
      throw new OoxmlExtractorError('OOXML_XML_STACK_INVALID', 'XML düğüm yığını geçersiz')
    }
    if (token.startsWith('<?') || token.startsWith('<!--')) continue
    if (token.startsWith('<![CDATA[')) {
      current.text += token.slice(9, -3)
      continue
    }
    if (token.startsWith('<!')) {
      throw new OoxmlExtractorError('OOXML_XML_DECLARATION_UNSUPPORTED', 'Desteklenmeyen XML bildirimi')
    }
    if (!token.startsWith('<')) {
      current.text += decodeXml(token)
      continue
    }
    if (token.startsWith('</')) {
      const closingName = token.slice(2, -1).trim()
      const closed = stack.pop()
      if (closed === undefined || closed.name !== closingName || stack.length === 0) {
        throw new OoxmlExtractorError('OOXML_XML_NOT_WELL_FORMED', 'XML kapanış etiketi eşleşmiyor')
      }
      continue
    }

    const selfClosing = token.endsWith('/>')
    const body = token.slice(1, selfClosing ? -2 : -1).trim()
    const nameMatch = /^([^\s/>]+)/.exec(body)
    const name = nameMatch?.[1]
    if (name === undefined) {
      throw new OoxmlExtractorError('OOXML_XML_NOT_WELL_FORMED', 'XML açılış etiketi geçersiz')
    }
    const node: XmlNode = {
      name,
      localName: name.includes(':') ? (name.split(':').at(-1) as string) : name,
      attributes: parseAttributes(body.slice(name.length)),
      children: [],
      text: '',
    }
    current.children.push(node)
    if (!selfClosing) stack.push(node)
  }

  if (stack.length !== 1 || documentNode.children.length !== 1) {
    throw new OoxmlExtractorError('OOXML_XML_NOT_WELL_FORMED', 'XML belge yapısı geçersiz')
  }
  return documentNode.children[0] as XmlNode
}

function attribute(node: XmlNode, name: string): string | null {
  const exact = node.attributes[name]
  if (exact !== undefined) return exact
  if (name.includes(':')) return null
  for (const [key, value] of Object.entries(node.attributes)) {
    if (key.split(':').at(-1) === name) return value
  }
  return null
}

function directChildren(node: XmlNode, localName: string): readonly XmlNode[] {
  return node.children.filter((child) => child.localName === localName)
}

function firstDirectChild(node: XmlNode, localName: string): XmlNode | null {
  return directChildren(node, localName)[0] ?? null
}

function descendants(node: XmlNode, localName: string): XmlNode[] {
  const found: XmlNode[] = []
  const visit = (candidate: XmlNode): void => {
    if (candidate.localName === localName) found.push(candidate)
    for (const child of candidate.children) visit(child)
  }
  visit(node)
  return found
}

function descendantText(node: XmlNode, localName: string): string {
  return descendants(node, localName).map((item) => item.text).join('')
}

function parseRelationships(xml: string): readonly OoxmlRelationship[] {
  const root = parseXml(xml)
  return descendants(root, 'Relationship').map((node) => ({
    id: attribute(node, 'Id') ?? '',
    type: attribute(node, 'Type') ?? '',
    target: attribute(node, 'Target') ?? '',
    targetMode: attribute(node, 'TargetMode'),
  }))
}

function relationshipPartName(sourcePart: string): string {
  return posix.join(posix.dirname(sourcePart), '_rels', `${posix.basename(sourcePart)}.rels`)
}

export function resolveOoxmlRelationshipTarget(sourcePart: string, target: string): string {
  const unified = target.replaceAll('\\', '/')
  if (/^[A-Za-z]:/.test(unified) || unified.startsWith('//')) {
    throw new OoxmlExtractorError('OOXML_RELATIONSHIP_TARGET_INVALID', 'Relationship hedefi paket dışına çıkıyor')
  }
  const resolved = unified.startsWith('/')
    ? posix.normalize(unified.slice(1))
    : posix.normalize(posix.join(posix.dirname(sourcePart), unified))
  if (resolved.length === 0 || resolved === '..' || resolved.startsWith('../')) {
    throw new OoxmlExtractorError('OOXML_RELATIONSHIP_TARGET_INVALID', 'Relationship hedefi paket dışına çıkıyor')
  }
  return resolved
}

function bytesToEntries(bytes: Uint8Array): Readonly<Record<string, Uint8Array>> {
  try {
    return unzipSync(bytes)
  } catch {
    throw new OoxmlExtractorError('OOXML_ZIP_INVALID', 'OOXML ZIP paketi açılamadı')
  }
}

function entryText(entries: Readonly<Record<string, Uint8Array>>, partName: string): string {
  const bytes = entries[partName]
  if (bytes === undefined) {
    throw new OoxmlExtractorError('OOXML_PART_MISSING', `Gerekli OOXML part bulunamadı: ${partName}`)
  }
  return strFromU8(bytes)
}

function findInternalRelationship(
  relationships: readonly OoxmlRelationship[],
  typeSuffix: string,
): OoxmlRelationship | null {
  return relationships.find((relationship) =>
    relationship.targetMode !== 'External' && relationship.type.endsWith(typeSuffix),
  ) ?? null
}

function parseSharedStrings(xml: string): readonly string[] {
  const root = parseXml(xml)
  return descendants(root, 'si').map((item) => descendantText(item, 't'))
}

function columnNumber(address: string): number {
  const match = /^([A-Z]+)[1-9][0-9]*$/.exec(address)
  if (match?.[1] === undefined) {
    throw new OoxmlExtractorError('OOXML_CELL_ADDRESS_INVALID', `Geçersiz hücre adresi: ${address}`)
  }
  let result = 0
  for (const character of match[1]) result = result * 26 + character.charCodeAt(0) - 64
  return result
}

function rowNumber(address: string): number {
  const match = /^[A-Z]+([1-9][0-9]*)$/.exec(address)
  if (match?.[1] === undefined) {
    throw new OoxmlExtractorError('OOXML_CELL_ADDRESS_INVALID', `Geçersiz hücre adresi: ${address}`)
  }
  return Number.parseInt(match[1], 10)
}

function parseCell(node: XmlNode, sharedStrings: readonly string[]): OoxmlCell {
  const address = attribute(node, 'r')
  if (address === null) {
    throw new OoxmlExtractorError('OOXML_CELL_ADDRESS_MISSING', 'Hücre adresi eksik')
  }
  const type = attribute(node, 't')
  const rawValue = firstDirectChild(node, 'v')?.text ?? null
  const formula = firstDirectChild(node, 'f')?.text ?? null
  const styleRaw = attribute(node, 's')
  const styleIndex = styleRaw === null ? null : Number.parseInt(styleRaw, 10)
  let sharedStringIndex: number | null = null
  let value = rawValue

  if (type === 's' && rawValue !== null) {
    sharedStringIndex = Number.parseInt(rawValue, 10)
    value = sharedStrings[sharedStringIndex] ?? null
    if (value === null) {
      throw new OoxmlExtractorError('OOXML_SHARED_STRING_MISSING', `Shared string bulunamadı: ${rawValue}`)
    }
  } else if (type === 'inlineStr') {
    const inline = firstDirectChild(node, 'is')
    value = inline === null ? null : descendantText(inline, 't')
  }

  return {
    address,
    row: rowNumber(address),
    column: columnNumber(address),
    type,
    styleIndex: Number.isNaN(styleIndex) ? null : styleIndex,
    rawValue,
    value,
    formula,
    sharedStringIndex,
  }
}

function parseWorksheet(input: {
  readonly xml: string
  readonly name: string
  readonly state: OoxmlWorksheet['state']
  readonly relationshipId: string
  readonly partName: string
  readonly sharedStrings: readonly string[]
}): OoxmlWorksheet {
  const root = parseXml(input.xml)
  const sheetData = descendants(root, 'sheetData')[0]
  if (sheetData === undefined) {
    throw new OoxmlExtractorError('OOXML_SHEET_DATA_MISSING', `Sheet data bulunamadı: ${input.name}`)
  }
  const rows = directChildren(sheetData, 'row')
  const cells = rows.flatMap((row) =>
    directChildren(row, 'c').map((cell) => parseCell(cell, input.sharedStrings)),
  )
  const hiddenRows = rows
    .filter((row) => attribute(row, 'hidden') === '1')
    .map((row) => Number.parseInt(attribute(row, 'r') ?? '', 10))
    .filter((row) => Number.isSafeInteger(row))
  const hiddenColumns = descendants(root, 'cols').flatMap((columns) =>
    directChildren(columns, 'col')
      .filter((column) => attribute(column, 'hidden') === '1')
      .map((column) => ({
        min: Number.parseInt(attribute(column, 'min') ?? '', 10),
        max: Number.parseInt(attribute(column, 'max') ?? '', 10),
      }))
      .filter((column) => Number.isSafeInteger(column.min) && Number.isSafeInteger(column.max)),
  )
  const dataValidations = descendants(root, 'dataValidation').map((validation) => ({
    sqref: attribute(validation, 'sqref') ?? '',
    type: attribute(validation, 'type'),
    allowBlank: attribute(validation, 'allowBlank') === '1',
    formula1: firstDirectChild(validation, 'formula1')?.text ?? null,
  }))

  return {
    name: input.name,
    state: input.state,
    relationshipId: input.relationshipId,
    partName: input.partName,
    dimension: descendants(root, 'dimension')[0] === undefined
      ? null
      : attribute(descendants(root, 'dimension')[0] as XmlNode, 'ref'),
    mergedRanges: descendants(root, 'mergeCell')
      .map((merge) => attribute(merge, 'ref'))
      .filter((range): range is string => range !== null),
    hiddenRows,
    hiddenColumns,
    dataValidations,
    cells,
  }
}

export function sha256WorkbookBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function assertWorkbookSha256(bytes: Uint8Array, expectedSha256: string): string {
  const expected = expectedSha256.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(expected)) {
    throw new OoxmlExtractorError('WORKBOOK_EXPECTED_HASH_INVALID', 'Beklenen workbook hash geçersiz')
  }
  const actual = sha256WorkbookBytes(bytes)
  if (actual !== expected) {
    throw new OoxmlExtractorError('WORKBOOK_HASH_MISMATCH', 'Workbook SHA-256 beklenen değerle uyuşmuyor')
  }
  return actual
}

export function assertWorkbookHashUnchanged(startSha256: string, endSha256: string): void {
  if (startSha256.toLowerCase() !== endSha256.toLowerCase()) {
    throw new OoxmlExtractorError(
      'WORKBOOK_CHANGED_DURING_EXTRACTION',
      'Workbook başlangıç ve bitiş hash değerleri uyuşmuyor',
    )
  }
}

export function extractOoxmlWorkbook(bytes: Uint8Array): OoxmlWorkbook {
  const entries = bytesToEntries(bytes)
  const rootRelationships = parseRelationships(entryText(entries, '_rels/.rels'))
  const workbookRelationship = findInternalRelationship(rootRelationships, '/officeDocument')
  if (workbookRelationship === null) {
    throw new OoxmlExtractorError('OOXML_WORKBOOK_RELATIONSHIP_MISSING', 'Workbook relationship bulunamadı')
  }
  const workbookPartName = resolveOoxmlRelationshipTarget('', workbookRelationship.target)
  const workbookRoot = parseXml(entryText(entries, workbookPartName))
  const workbookRelationships = parseRelationships(
    entryText(entries, relationshipPartName(workbookPartName)),
  )
  const sharedStringsRelationship = findInternalRelationship(workbookRelationships, '/sharedStrings')
  const sharedStringsPartName = sharedStringsRelationship === null
    ? null
    : resolveOoxmlRelationshipTarget(workbookPartName, sharedStringsRelationship.target)
  const sharedStrings = sharedStringsPartName === null
    ? []
    : parseSharedStrings(entryText(entries, sharedStringsPartName))

  const relationshipsById = new Map(
    workbookRelationships
      .filter((relationship) => relationship.targetMode !== 'External')
      .map((relationship) => [relationship.id, relationship]),
  )
  const sheets = descendants(workbookRoot, 'sheets').flatMap((sheetsNode) =>
    directChildren(sheetsNode, 'sheet').map((sheetNode) => {
      const relationshipId = attribute(sheetNode, 'r:id') ?? attribute(sheetNode, 'id')
      const name = attribute(sheetNode, 'name')
      if (relationshipId === null || name === null) {
        throw new OoxmlExtractorError('OOXML_SHEET_IDENTITY_MISSING', 'Sheet adı veya relationship kimliği eksik')
      }
      const relationship = relationshipsById.get(relationshipId)
      if (relationship === undefined || !relationship.type.endsWith('/worksheet')) {
        throw new OoxmlExtractorError('OOXML_SHEET_RELATIONSHIP_INVALID', `Worksheet relationship geçersiz: ${relationshipId}`)
      }
      const stateRaw = attribute(sheetNode, 'state') ?? 'visible'
      if (stateRaw !== 'visible' && stateRaw !== 'hidden' && stateRaw !== 'veryHidden') {
        throw new OoxmlExtractorError('OOXML_SHEET_STATE_INVALID', `Sheet state geçersiz: ${stateRaw}`)
      }
      const partName = resolveOoxmlRelationshipTarget(workbookPartName, relationship.target)
      return parseWorksheet({
        xml: entryText(entries, partName),
        name,
        state: stateRaw,
        relationshipId,
        partName,
        sharedStrings,
      })
    }),
  )

  return {
    extractorVersion: OOXML_READONLY_EXTRACTOR_VERSION,
    workbookPartName,
    sharedStringsPartName,
    sharedStrings,
    sheets,
  }
}

function cellCoordinates(address: string): { readonly row: number; readonly column: number } {
  return { row: rowNumber(address), column: columnNumber(address) }
}

function rangeContains(range: string, address: string): boolean {
  const [startAddress, endAddress = startAddress] = range.split(':')
  if (startAddress === undefined || endAddress === undefined) return false
  const start = cellCoordinates(startAddress)
  const end = cellCoordinates(endAddress)
  const target = cellCoordinates(address)
  return target.row >= start.row && target.row <= end.row
    && target.column >= start.column && target.column <= end.column
}

export function getOoxmlCell(
  sheet: OoxmlWorksheet,
  address: string,
  resolveMerged = true,
): OoxmlCell | null {
  const direct = sheet.cells.find((cell) => cell.address === address)
  if (direct !== undefined || !resolveMerged) return direct ?? null
  const mergedRange = sheet.mergedRanges.find((range) => rangeContains(range, address))
  if (mergedRange === undefined) return null
  const topLeft = mergedRange.split(':')[0]
  return sheet.cells.find((cell) => cell.address === topLeft) ?? null
}

export function getOoxmlSheet(workbook: OoxmlWorkbook, name: string): OoxmlWorksheet {
  const sheet = workbook.sheets.find((candidate) => candidate.name === name)
  if (sheet === undefined) {
    throw new OoxmlExtractorError('OOXML_SHEET_MISSING', `Sheet bulunamadı: ${name}`)
  }
  return sheet
}
