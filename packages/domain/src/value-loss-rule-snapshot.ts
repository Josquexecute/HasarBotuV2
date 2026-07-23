/**
 * Paket 66 / Commit #1 — 01.07.2026 Değer Kaybı kaynak snapshot şeması.
 *
 * Bu modül hesap motoru değildir. Workbook'tan çıkarılan salt-okunur görünümü,
 * açık ürün kararı overlay'iyle birleştirip denetlenebilir ve deterministik bir
 * referans snapshot üretir. Persistence, API, UI veya fiziksel Excel yazımı yoktur.
 */
import { sha256Text } from './pdf-text-extraction.js'

export const VALUE_LOSS_SNAPSHOT_IDENTITY = 'real-market-analysis/2026-07-01/1.0.0' as const
export const VALUE_LOSS_SNAPSHOT_SCHEMA_VERSION = 'value-loss-rule-snapshot/1.0.0' as const
export const VALUE_LOSS_MANIFEST_SCHEMA_VERSION = 'value-loss-rule-manifest/1.0.0' as const
export const VALUE_LOSS_PRODUCT_DECISION_SCHEMA_VERSION = 'value-loss-product-decisions/1.0.0' as const
export const VALUE_LOSS_SOURCE_WORKBOOK_SHA256 =
  '81d3ae870cd5569b13371ec8b4de081a9a4e3e15098f7454f5d0cdcd3708c424' as const
export const VALUE_LOSS_SOURCE_WORKBOOK_FILE_NAME =
  'Yeni Dönem Değer Kaybı Hesaplama Modülü 01.07.2026 V_1.xlsx' as const
export const VALUE_LOSS_EFFECTIVE_DATE = '2026-07-01' as const

export const VALUE_LOSS_GROUP_CODE_SEQUENCE = [
  'A', 'A', 'B', 'B', 'C', 'C', 'C', 'D', 'D', 'D', 'Ç', 'E', 'F', 'Ç',
] as const

export const VALUE_LOSS_REQUIRED_ANOMALIES = [
  'source_vehicle_name_column_incomplete',
  'orphan_shared_strings_not_vehicle_mapping_source',
  'source_validation_adjustment_list_f12',
  'source_validation_adjustment_list_z2',
  'source_cached_name_error',
  'source_cached_div0_error',
  'source_age_table_reverse_order',
  'source_row_27_residual_79',
  'source_hidden_sheet',
  'source_unused_insurer_list',
  'source_unused_market_value_coefficient_table',
  'source_year_c13_formula_error',
  'source_scratch_cells_m18_m19',
  'source_unwired_j11',
  'source_later_additions_dormant',
] as const

export type ValueLossMappingProvenance = 'source_workbook' | 'product_decision'
export type ValueLossVehicleGroupCode = 'A' | 'B' | 'C' | 'Ç' | 'D' | 'E' | 'F'
export type ValueLossPartOperation = 'replacement' | 'repair' | 'paint'

export interface ValueLossWorkbookCellView {
  readonly address: string
  readonly row: number
  readonly column: number
  readonly type: string | null
  readonly value: string | null
  readonly rawValue: string | null
  readonly formula: string | null
  readonly sharedStringIndex: number | null
}

export interface ValueLossWorkbookSheetView {
  readonly name: string
  readonly state: 'visible' | 'hidden' | 'veryHidden'
  readonly relationshipId: string
  readonly partName: string
  readonly dimension: string | null
  readonly mergedRanges: readonly string[]
  readonly hiddenRows: readonly number[]
  readonly hiddenColumns: readonly { readonly min: number; readonly max: number }[]
  readonly dataValidations: readonly {
    readonly sqref: string
    readonly type: string | null
    readonly allowBlank: boolean
    readonly formula1: string | null
  }[]
  readonly cells: readonly ValueLossWorkbookCellView[]
}

export interface ValueLossWorkbookView {
  readonly extractorVersion: string
  readonly sheets: readonly ValueLossWorkbookSheetView[]
}

export interface ValueLossProductDecision {
  readonly decisionId: string
  readonly ordinal: number
  readonly vehicleType: string
  readonly vehicleGroupCode: ValueLossVehicleGroupCode
  readonly provenance: 'product_decision'
}

export interface ValueLossProductDecisionOverlay {
  readonly schemaVersion: typeof VALUE_LOSS_PRODUCT_DECISION_SCHEMA_VERSION
  readonly snapshotIdentity: typeof VALUE_LOSS_SNAPSHOT_IDENTITY
  readonly decisionRecordId: 'package66-split-provenance/1.0.0'
  readonly decisionDate: '2026-07-23'
  readonly basis: 'product_owner_approved_split_provenance'
  readonly decisions: readonly ValueLossProductDecision[]
}

export interface ValueLossVehicleMapping {
  readonly ordinal: number
  readonly vehicleType: string
  readonly normalizedVehicleType: string
  readonly vehicleGroupCode: ValueLossVehicleGroupCode
  readonly provenance: ValueLossMappingProvenance
  readonly sourceNameCell: string | null
  readonly sourceCodeCell: string | null
  readonly decisionId: string | null
}

export interface ValueLossPartRule {
  readonly stableId: string
  readonly vehicleGroupCode: ValueLossVehicleGroupCode
  readonly sourceTable: string
  readonly sourceRow: number
  readonly sourceLabel: string
  readonly normalizedLabel: string
  readonly operationCapabilities: readonly ValueLossPartOperation[]
  readonly coefficients: {
    readonly replacement: string | null
    readonly repair: {
      readonly light: string
      readonly medium: string
      readonly heavy: string
    } | null
    readonly paint: {
      readonly full: string
      readonly local: string
    } | null
  }
}

export interface ValueLossRuleSnapshot {
  readonly schemaVersion: typeof VALUE_LOSS_SNAPSHOT_SCHEMA_VERSION
  readonly identity: typeof VALUE_LOSS_SNAPSHOT_IDENTITY
  readonly effectiveDate: typeof VALUE_LOSS_EFFECTIVE_DATE
  readonly source: {
    readonly workbookFileName: typeof VALUE_LOSS_SOURCE_WORKBOOK_FILE_NAME
    readonly workbookSha256: typeof VALUE_LOSS_SOURCE_WORKBOOK_SHA256
    readonly extractorVersion: string
  }
  readonly sheets: readonly {
    readonly name: string
    readonly state: 'visible' | 'hidden' | 'veryHidden'
    readonly relationshipId: string
    readonly partName: string
    readonly dimension: string | null
    readonly mergedRangeCount: number
    readonly hiddenRows: readonly number[]
    readonly hiddenColumns: readonly { readonly min: number; readonly max: number }[]
  }[]
  readonly vehicleGroupCodeSequence: readonly {
    readonly ordinal: number
    readonly sourceCell: string
    readonly code: ValueLossVehicleGroupCode
    readonly provenance: 'source_workbook'
  }[]
  readonly vehicleMappings: readonly ValueLossVehicleMapping[]
  readonly ageCoefficients: readonly {
    readonly minAge: number
    readonly maxAge: number | null
    readonly coefficient: string
    readonly sourceRow: number
    readonly sourceRange: 'Tablolar!B19:C26'
  }[]
  readonly usageCoefficientTables: readonly {
    readonly tableId: 'mileage' | 'working_hours'
    readonly sourceRange: string
    readonly vehicleGroupCode: ValueLossVehicleGroupCode
    readonly bands: readonly {
      readonly min: number
      readonly max: number | null
      readonly coefficient: string
      readonly sourceHeaderCell: string
      readonly sourceValueCell: string
    }[]
  }[]
  readonly generalModifiers: readonly {
    readonly code: string
    readonly sourceLabel: string
    readonly coefficient: string
    readonly sourceRow: number
  }[]
  readonly partTables: readonly {
    readonly tableId: string
    readonly sourceRange: string
    readonly vehicleGroupCodes: readonly ValueLossVehicleGroupCode[]
    readonly sourceRowCount: number
    readonly emittedRuleCount: number
  }[]
  readonly partRules: readonly ValueLossPartRule[]
  readonly applicationPrinciples: readonly {
    readonly sourceCell: string
    readonly text: string
  }[]
  readonly dataValidations: readonly {
    readonly sourceCell: 'Hesaplama!F12' | 'Tablolar!Z2'
    readonly type: 'list'
    readonly formula: '"-10,-5,0,5,10"'
  }[]
  readonly cachedFormulaErrors: readonly {
    readonly sourceCell: 'Hesaplama!M18' | 'Hesaplama!M19'
    readonly cachedError: '#NAME?' | '#DIV/0!'
    readonly formula: string
  }[]
  readonly sections: readonly {
    readonly sectionId: string
    readonly classification: 'dormant' | 'excluded'
    readonly sourceRange: string
    readonly reasonCode: string
  }[]
  readonly anomalies: readonly {
    readonly code: (typeof VALUE_LOSS_REQUIRED_ANOMALIES)[number]
    readonly provenance: 'source_workbook'
    readonly evidenceRefs: readonly string[]
  }[]
}

interface PartTableSpec {
  readonly tableId: string
  readonly sourceRange: string
  readonly startRow: number
  readonly endRow: number
  readonly vehicleGroupCodes: readonly ValueLossVehicleGroupCode[]
}

export const VALUE_LOSS_ACTIVE_PART_TABLE_SPECS: readonly PartTableSpec[] = [
  { tableId: 'group-a', sourceRange: 'Tablolar!B34:L67', startRow: 34, endRow: 67, vehicleGroupCodes: ['A'] },
  { tableId: 'group-b', sourceRange: 'Tablolar!B70:L116', startRow: 70, endRow: 116, vehicleGroupCodes: ['B'] },
  { tableId: 'group-c-cedilla', sourceRange: 'Tablolar!B119:L150', startRow: 119, endRow: 150, vehicleGroupCodes: ['C', 'Ç'] },
  { tableId: 'group-d', sourceRange: 'Tablolar!B155:L186', startRow: 155, endRow: 186, vehicleGroupCodes: ['D'] },
  { tableId: 'group-e', sourceRange: 'Tablolar!B192:L223', startRow: 192, endRow: 223, vehicleGroupCodes: ['E'] },
  { tableId: 'group-f', sourceRange: 'Tablolar!B228:L259', startRow: 228, endRow: 259, vehicleGroupCodes: ['F'] },
] as const

const FIXED_SECTIONS: ValueLossRuleSnapshot['sections'] = [
  {
    sectionId: 'unused-market-value-coefficients',
    classification: 'dormant',
    sourceRange: 'Tablolar!E2:R9',
    reasonCode: 'dormant_unused_market_value_coefficient_table',
  },
  {
    sectionId: 'later-additions',
    classification: 'dormant',
    sourceRange: 'Tablolar!B264:L295',
    reasonCode: 'dormant_later_additions_not_globally_active',
  },
  {
    sectionId: 'hidden-sheet1',
    classification: 'dormant',
    sourceRange: 'Sheet1!C3:J11',
    reasonCode: 'dormant_hidden_scratch_sheet',
  },
  {
    sectionId: 'insurer-list',
    classification: 'excluded',
    sourceRange: 'Tablolar!B299:B350',
    reasonCode: 'excluded_unused_insurer_list',
  },
  {
    sectionId: 'placeholder-part-rows',
    classification: 'excluded',
    sourceRange: 'Tablolar!B34:L259',
    reasonCode: 'excluded_blank_zero_placeholder_rows',
  },
  {
    sectionId: 'row-27-residual',
    classification: 'excluded',
    sourceRange: 'Tablolar!27:27',
    reasonCode: 'excluded_source_row_27_residual_79',
  },
] as const

const REQUIRED_SHEET_STATES = [
  ['Hesaplama', 'visible'],
  ['Sheet1', 'hidden'],
  ['Uygulama Esasları', 'visible'],
  ['Tablolar', 'visible'],
] as const

function asVehicleGroupCode(value: string): ValueLossVehicleGroupCode {
  if (value === 'A' || value === 'B' || value === 'C' || value === 'Ç'
    || value === 'D' || value === 'E' || value === 'F') return value
  throw new Error(`VALUE_LOSS_VEHICLE_GROUP_INVALID:${value}`)
}

export function normalizeValueLossText(value: string): string {
  return value.normalize('NFC').replace(/\s+/gu, ' ').trim()
}

export function normalizeValueLossLabel(value: string): string {
  return normalizeValueLossText(value)
    .replaceAll('I', 'ı')
    .replaceAll('İ', 'i')
    .toLowerCase()
    .normalize('NFC')
}

function stableToken(value: string): string {
  return encodeURIComponent(value).replaceAll('%20', '-')
}

export function buildValueLossPartStableId(input: {
  readonly vehicleGroupCode: ValueLossVehicleGroupCode
  readonly sourceTable: string
  readonly sourceRow: number
  readonly normalizedLabel: string
  readonly operationCapabilities: readonly ValueLossPartOperation[]
}): string {
  const operations = [...input.operationCapabilities].sort().join('+')
  return [
    'value-loss-part',
    `vehicle-group=${stableToken(input.vehicleGroupCode)}`,
    `source-table=${stableToken(input.sourceTable)}`,
    `source-row=${input.sourceRow}`,
    `label=${stableToken(input.normalizedLabel)}`,
    `operations=${stableToken(operations)}`,
  ].join('|')
}

function sheet(workbook: ValueLossWorkbookView, name: string): ValueLossWorkbookSheetView {
  const result = workbook.sheets.find((candidate) => candidate.name === name)
  if (result === undefined) throw new Error(`VALUE_LOSS_SOURCE_SHEET_MISSING:${name}`)
  return result
}

function cell(source: ValueLossWorkbookSheetView, address: string): ValueLossWorkbookCellView {
  const result = source.cells.find((candidate) => candidate.address === address)
  if (result === undefined) throw new Error(`VALUE_LOSS_SOURCE_CELL_MISSING:${source.name}!${address}`)
  return result
}

function requiredCellValue(source: ValueLossWorkbookSheetView, address: string): string {
  const value = cell(source, address).value
  if (value === null) throw new Error(`VALUE_LOSS_SOURCE_VALUE_MISSING:${source.name}!${address}`)
  return normalizeValueLossText(value)
}

function columnName(column: number): string {
  let value = column
  let result = ''
  while (value > 0) {
    value -= 1
    result = String.fromCharCode(65 + (value % 26)) + result
    value = Math.floor(value / 26)
  }
  return result
}

function positiveDecimal(value: string | null): boolean {
  if (value === null || value.trim() === '') return false
  const number = Number(value)
  return Number.isFinite(number) && number > 0
}

function decimalValue(source: ValueLossWorkbookSheetView, address: string): string {
  const value = cell(source, address).value
  if (value === null || !Number.isFinite(Number(value))) {
    throw new Error(`VALUE_LOSS_DECIMAL_INVALID:${source.name}!${address}`)
  }
  return value
}

function optionalDecimal(source: ValueLossWorkbookSheetView, address: string): string {
  const value = source.cells.find((candidate) => candidate.address === address)?.value
  return value !== null && value !== undefined && Number.isFinite(Number(value)) ? value : '0'
}

function placeholderLabel(value: string | null): boolean {
  if (value === null) return true
  const normalized = normalizeValueLossLabel(value)
  return normalized.length === 0 || normalized === '0' || normalized.startsWith('sigorta şirket')
}

function buildPartRuleBase(
  tablesSheet: ValueLossWorkbookSheetView,
  spec: PartTableSpec,
  row: number,
): Omit<ValueLossPartRule, 'stableId' | 'vehicleGroupCode'> | null {
  const sourceLabelValue = tablesSheet.cells.find((candidate) => candidate.address === `B${row}`)?.value ?? null
  if (placeholderLabel(sourceLabelValue)) return null
  const sourceLabel = normalizeValueLossText(sourceLabelValue as string)
  const normalizedLabel = normalizeValueLossLabel(sourceLabel)
  const replacement = optionalDecimal(tablesSheet, `C${row}`)
  const repairValues = {
    light: optionalDecimal(tablesSheet, `F${row}`),
    medium: optionalDecimal(tablesSheet, `G${row}`),
    heavy: optionalDecimal(tablesSheet, `H${row}`),
  }
  const paintValues = {
    full: optionalDecimal(tablesSheet, `K${row}`),
    local: optionalDecimal(tablesSheet, `L${row}`),
  }
  const operationCapabilities: ValueLossPartOperation[] = []
  if (positiveDecimal(replacement)) operationCapabilities.push('replacement')
  if (Object.values(repairValues).some(positiveDecimal)) operationCapabilities.push('repair')
  if (Object.values(paintValues).some(positiveDecimal)) operationCapabilities.push('paint')
  if (operationCapabilities.length === 0) {
    throw new Error(`VALUE_LOSS_ACTIVE_PART_WITHOUT_CAPABILITY:${spec.tableId}:${row}`)
  }
  return {
    sourceTable: spec.tableId,
    sourceRow: row,
    sourceLabel,
    normalizedLabel,
    operationCapabilities,
    coefficients: {
      replacement: operationCapabilities.includes('replacement') ? replacement : null,
      repair: operationCapabilities.includes('repair') ? repairValues : null,
      paint: operationCapabilities.includes('paint') ? paintValues : null,
    },
  }
}

function buildPartRules(tablesSheet: ValueLossWorkbookSheetView): {
  readonly rules: readonly ValueLossPartRule[]
  readonly tables: ValueLossRuleSnapshot['partTables']
} {
  const rules: ValueLossPartRule[] = []
  const tables: ValueLossRuleSnapshot['partTables'][number][] = []
  for (const spec of VALUE_LOSS_ACTIVE_PART_TABLE_SPECS) {
    const bases: Omit<ValueLossPartRule, 'stableId' | 'vehicleGroupCode'>[] = []
    for (let row = spec.startRow; row <= spec.endRow; row += 1) {
      const base = buildPartRuleBase(tablesSheet, spec, row)
      if (base !== null) bases.push(base)
    }
    for (const vehicleGroupCode of spec.vehicleGroupCodes) {
      for (const base of bases) {
        const stableId = buildValueLossPartStableId({
          vehicleGroupCode,
          sourceTable: base.sourceTable,
          sourceRow: base.sourceRow,
          normalizedLabel: base.normalizedLabel,
          operationCapabilities: base.operationCapabilities,
        })
        rules.push({ ...base, vehicleGroupCode, stableId })
      }
    }
    tables.push({
      tableId: spec.tableId,
      sourceRange: spec.sourceRange,
      vehicleGroupCodes: [...spec.vehicleGroupCodes],
      sourceRowCount: bases.length,
      emittedRuleCount: bases.length * spec.vehicleGroupCodes.length,
    })
  }
  return { rules, tables }
}

function parseAgeLabel(value: string): { readonly minAge: number; readonly maxAge: number | null } {
  const normalized = normalizeValueLossLabel(value)
  const range = /^([0-9]+)-([0-9]+)$/.exec(normalized)
  if (range?.[1] !== undefined && range[2] !== undefined) {
    return { minAge: Number(range[1]), maxAge: Number(range[2]) }
  }
  const open = /^([0-9]+)\s+üstü$/.exec(normalized)
  if (open?.[1] !== undefined) return { minAge: Number(open[1]), maxAge: null }
  throw new Error(`VALUE_LOSS_AGE_LABEL_INVALID:${value}`)
}

function buildAgeCoefficients(tablesSheet: ValueLossWorkbookSheetView): ValueLossRuleSnapshot['ageCoefficients'] {
  const coefficients = []
  for (let row = 19; row <= 26; row += 1) {
    const band = parseAgeLabel(requiredCellValue(tablesSheet, `B${row}`))
    coefficients.push({
      ...band,
      coefficient: decimalValue(tablesSheet, `C${row}`),
      sourceRow: row,
      sourceRange: 'Tablolar!B19:C26' as const,
    })
  }
  return coefficients.sort((left, right) => left.minAge - right.minAge)
}

function parseUsageBand(value: string): { readonly min: number; readonly max: number | null } {
  const normalized = normalizeValueLossLabel(value)
  const range = /^([0-9]+)-([0-9]+)$/.exec(normalized)
  if (range?.[1] !== undefined && range[2] !== undefined) {
    return { min: Number(range[1]), max: Number(range[2]) }
  }
  const open = /^([0-9]+)\s+üzeri$/.exec(normalized)
  if (open?.[1] !== undefined) return { min: Number(open[1]), max: null }
  throw new Error(`VALUE_LOSS_USAGE_LABEL_INVALID:${value}`)
}

function usageBands(
  tablesSheet: ValueLossWorkbookSheetView,
  headerRow: number,
  valueRow: number,
  startColumn: number,
  endColumn: number,
): ValueLossRuleSnapshot['usageCoefficientTables'][number]['bands'] {
  const result = []
  for (let column = startColumn; column <= endColumn; column += 1) {
    const name = columnName(column)
    const sourceHeaderCell = `${name}${headerRow}`
    const sourceValueCell = `${name}${valueRow}`
    result.push({
      ...parseUsageBand(requiredCellValue(tablesSheet, sourceHeaderCell)),
      coefficient: decimalValue(tablesSheet, sourceValueCell),
      sourceHeaderCell: `Tablolar!${sourceHeaderCell}`,
      sourceValueCell: `Tablolar!${sourceValueCell}`,
    })
  }
  return result
}

function buildUsageTables(
  tablesSheet: ValueLossWorkbookSheetView,
): ValueLossRuleSnapshot['usageCoefficientTables'] {
  const result: ValueLossRuleSnapshot['usageCoefficientTables'][number][] = []
  for (let row = 13; row <= 18; row += 1) {
    const vehicleGroupCode = asVehicleGroupCode(requiredCellValue(tablesSheet, `E${row}`))
    result.push({
      tableId: 'mileage',
      sourceRange: `Tablolar!E12:O${row}`,
      vehicleGroupCode,
      bands: usageBands(tablesSheet, 12, row, 6, 15),
    })
  }
  result.push({
    tableId: 'working_hours',
    sourceRange: 'Tablolar!E19:L20',
    vehicleGroupCode: asVehicleGroupCode(requiredCellValue(tablesSheet, 'E20')),
    bands: usageBands(tablesSheet, 19, 20, 6, 12),
  })
  return result
}

function buildVehicleMappings(
  tablesSheet: ValueLossWorkbookSheetView,
  overlay: ValueLossProductDecisionOverlay,
): {
  readonly codeSequence: ValueLossRuleSnapshot['vehicleGroupCodeSequence']
  readonly mappings: ValueLossRuleSnapshot['vehicleMappings']
} {
  const codeSequence = VALUE_LOSS_GROUP_CODE_SEQUENCE.map((_, index) => {
    const ordinal = index + 1
    const sourceCell = `C${index + 3}`
    return {
      ordinal,
      sourceCell: `Tablolar!${sourceCell}`,
      code: asVehicleGroupCode(requiredCellValue(tablesSheet, sourceCell)),
      provenance: 'source_workbook' as const,
    }
  })

  const sourceMappings: ValueLossVehicleMapping[] = [4, 5, 6].map((row) => {
    const vehicleType = requiredCellValue(tablesSheet, `B${row}`)
    return {
      ordinal: row - 2,
      vehicleType,
      normalizedVehicleType: normalizeValueLossLabel(vehicleType),
      vehicleGroupCode: asVehicleGroupCode(requiredCellValue(tablesSheet, `C${row}`)),
      provenance: 'source_workbook',
      sourceNameCell: `Tablolar!B${row}`,
      sourceCodeCell: `Tablolar!C${row}`,
      decisionId: null,
    }
  })
  const productMappings: ValueLossVehicleMapping[] = overlay.decisions.map((decision) => ({
    ordinal: decision.ordinal,
    vehicleType: normalizeValueLossText(decision.vehicleType),
    normalizedVehicleType: normalizeValueLossLabel(decision.vehicleType),
    vehicleGroupCode: decision.vehicleGroupCode,
    provenance: decision.provenance,
    sourceNameCell: null,
    sourceCodeCell: null,
    decisionId: decision.decisionId,
  }))
  const mappings = [...sourceMappings, ...productMappings].sort((left, right) => left.ordinal - right.ordinal)

  for (const mapping of mappings) {
    const sequence = codeSequence[mapping.ordinal - 1]
    if (sequence?.code !== mapping.vehicleGroupCode) {
      throw new Error(`VALUE_LOSS_MAPPING_CODE_SEQUENCE_MISMATCH:${mapping.ordinal}`)
    }
  }
  return { codeSequence, mappings }
}

function buildApplicationPrinciples(
  principlesSheet: ValueLossWorkbookSheetView,
): ValueLossRuleSnapshot['applicationPrinciples'] {
  return principlesSheet.cells
    .filter((candidate) => candidate.column === 2 && candidate.value !== null)
    .sort((left, right) => left.row - right.row)
    .map((candidate) => ({
      sourceCell: `Uygulama Esasları!${candidate.address}`,
      text: normalizeValueLossText(candidate.value as string),
    }))
    .filter((item) => item.text.length > 0)
}

function assertForensicFacts(workbook: ValueLossWorkbookView): void {
  for (const [name, state] of REQUIRED_SHEET_STATES) {
    if (sheet(workbook, name).state !== state) throw new Error(`VALUE_LOSS_SHEET_STATE_MISMATCH:${name}`)
  }
  const calculation = sheet(workbook, 'Hesaplama')
  const tables = sheet(workbook, 'Tablolar')
  const f12 = calculation.dataValidations.find((validation) => validation.sqref.split(/\s+/u).includes('F12'))
  const z2 = tables.dataValidations.find((validation) => validation.sqref.split(/\s+/u).includes('Z2'))
  if (f12?.type !== 'list' || f12.formula1 !== '"-10,-5,0,5,10"') {
    throw new Error('VALUE_LOSS_F12_VALIDATION_MISMATCH')
  }
  if (z2?.type !== 'list' || z2.formula1 !== '"-10,-5,0,5,10"') {
    throw new Error('VALUE_LOSS_Z2_VALIDATION_MISMATCH')
  }
  if (requiredCellValue(calculation, 'M18') !== '#NAME?') throw new Error('VALUE_LOSS_M18_ERROR_MISSING')
  if (requiredCellValue(calculation, 'M19') !== '#DIV/0!') throw new Error('VALUE_LOSS_M19_ERROR_MISSING')
  const yearC13Cells = ['C64', 'K64'].filter((address) => cell(calculation, address).formula?.includes('YEAR(C13)'))
  if (yearC13Cells.length !== 2) throw new Error('VALUE_LOSS_YEAR_C13_ANOMALY_MISSING')
  if (cell(calculation, 'J11').value !== null) throw new Error('VALUE_LOSS_J11_EXPECTED_EMPTY')
  if (!calculation.cells.some((candidate) => candidate.formula?.includes('J11'))) {
    throw new Error('VALUE_LOSS_J11_REFERENCE_MISSING')
  }
  const sourceAgeRows = Array.from({ length: 8 }, (_, index) =>
    parseAgeLabel(requiredCellValue(tables, `B${index + 19}`)).minAge)
  if (!sourceAgeRows.every((value, index) => index === 0 || value < (sourceAgeRows[index - 1] as number))) {
    throw new Error('VALUE_LOSS_AGE_SOURCE_NOT_REVERSED')
  }
}

function validateOverlay(overlay: ValueLossProductDecisionOverlay): void {
  if (overlay.schemaVersion !== VALUE_LOSS_PRODUCT_DECISION_SCHEMA_VERSION
    || overlay.snapshotIdentity !== VALUE_LOSS_SNAPSHOT_IDENTITY
    || overlay.decisionRecordId !== 'package66-split-provenance/1.0.0'
    || overlay.decisionDate !== '2026-07-23'
    || overlay.basis !== 'product_owner_approved_split_provenance') {
    throw new Error('VALUE_LOSS_PRODUCT_DECISION_IDENTITY_INVALID')
  }
  if (overlay.decisions.length !== 11) throw new Error('VALUE_LOSS_PRODUCT_DECISION_COUNT_INVALID')
  const ordinals = new Set<number>()
  for (const decision of overlay.decisions) {
    if (decision.provenance !== 'product_decision') {
      throw new Error(`VALUE_LOSS_PRODUCT_DECISION_PROVENANCE_INVALID:${decision.decisionId}`)
    }
    if (ordinals.has(decision.ordinal)) throw new Error(`VALUE_LOSS_PRODUCT_DECISION_DUPLICATE:${decision.ordinal}`)
    ordinals.add(decision.ordinal)
  }
}

export function buildValueLossRuleSnapshot(input: {
  readonly workbook: ValueLossWorkbookView
  readonly productDecisions: ValueLossProductDecisionOverlay
  readonly workbookSha256: string
  readonly workbookFileName: string
}): ValueLossRuleSnapshot {
  if (input.workbookSha256.toLowerCase() !== VALUE_LOSS_SOURCE_WORKBOOK_SHA256) {
    throw new Error('VALUE_LOSS_SOURCE_HASH_MISMATCH')
  }
  if (input.workbookFileName !== VALUE_LOSS_SOURCE_WORKBOOK_FILE_NAME) {
    throw new Error('VALUE_LOSS_SOURCE_FILE_NAME_MISMATCH')
  }
  validateOverlay(input.productDecisions)
  assertForensicFacts(input.workbook)

  const tablesSheet = sheet(input.workbook, 'Tablolar')
  const calculationSheet = sheet(input.workbook, 'Hesaplama')
  const principlesSheet = sheet(input.workbook, 'Uygulama Esasları')
  const { codeSequence, mappings } = buildVehicleMappings(tablesSheet, input.productDecisions)
  const { rules, tables } = buildPartRules(tablesSheet)

  const snapshot: ValueLossRuleSnapshot = {
    schemaVersion: VALUE_LOSS_SNAPSHOT_SCHEMA_VERSION,
    identity: VALUE_LOSS_SNAPSHOT_IDENTITY,
    effectiveDate: VALUE_LOSS_EFFECTIVE_DATE,
    source: {
      workbookFileName: VALUE_LOSS_SOURCE_WORKBOOK_FILE_NAME,
      workbookSha256: VALUE_LOSS_SOURCE_WORKBOOK_SHA256,
      extractorVersion: input.workbook.extractorVersion,
    },
    sheets: input.workbook.sheets.map((sourceSheet) => ({
      name: sourceSheet.name,
      state: sourceSheet.state,
      relationshipId: sourceSheet.relationshipId,
      partName: sourceSheet.partName,
      dimension: sourceSheet.dimension,
      mergedRangeCount: sourceSheet.mergedRanges.length,
      hiddenRows: [...sourceSheet.hiddenRows],
      hiddenColumns: sourceSheet.hiddenColumns.map((column) => ({ ...column })),
    })),
    vehicleGroupCodeSequence: codeSequence,
    vehicleMappings: mappings,
    ageCoefficients: buildAgeCoefficients(tablesSheet),
    usageCoefficientTables: buildUsageTables(tablesSheet),
    generalModifiers: [24, 25, 26].map((row) => ({
      code: requiredCellValue(tablesSheet, `E${row}`).split('-')[0] as string,
      sourceLabel: requiredCellValue(tablesSheet, `E${row}`),
      coefficient: decimalValue(tablesSheet, `F${row}`),
      sourceRow: row,
    })),
    partTables: tables,
    partRules: rules,
    applicationPrinciples: buildApplicationPrinciples(principlesSheet),
    dataValidations: [
      { sourceCell: 'Hesaplama!F12', type: 'list', formula: '"-10,-5,0,5,10"' },
      { sourceCell: 'Tablolar!Z2', type: 'list', formula: '"-10,-5,0,5,10"' },
    ],
    cachedFormulaErrors: [
      {
        sourceCell: 'Hesaplama!M18',
        cachedError: '#NAME?',
        formula: cell(calculationSheet, 'M18').formula ?? '',
      },
      {
        sourceCell: 'Hesaplama!M19',
        cachedError: '#DIV/0!',
        formula: cell(calculationSheet, 'M19').formula ?? '',
      },
    ],
    sections: FIXED_SECTIONS.map((section) => ({ ...section })),
    anomalies: [
      { code: 'source_vehicle_name_column_incomplete', provenance: 'source_workbook', evidenceRefs: ['Tablolar!C3:C16', 'Tablolar!B4:C6'] },
      { code: 'orphan_shared_strings_not_vehicle_mapping_source', provenance: 'source_workbook', evidenceRefs: ['xl/sharedStrings.xml'] },
      { code: 'source_validation_adjustment_list_f12', provenance: 'source_workbook', evidenceRefs: ['Hesaplama!F12'] },
      { code: 'source_validation_adjustment_list_z2', provenance: 'source_workbook', evidenceRefs: ['Tablolar!Z2'] },
      { code: 'source_cached_name_error', provenance: 'source_workbook', evidenceRefs: ['Hesaplama!M18'] },
      { code: 'source_cached_div0_error', provenance: 'source_workbook', evidenceRefs: ['Hesaplama!M19'] },
      { code: 'source_age_table_reverse_order', provenance: 'source_workbook', evidenceRefs: ['Tablolar!B19:C26'] },
      { code: 'source_row_27_residual_79', provenance: 'source_workbook', evidenceRefs: ['Tablolar!27:27', 'shared-string-index:79'] },
      { code: 'source_hidden_sheet', provenance: 'source_workbook', evidenceRefs: ['Sheet1!C3:J11'] },
      { code: 'source_unused_insurer_list', provenance: 'source_workbook', evidenceRefs: ['Tablolar!B299:B350'] },
      { code: 'source_unused_market_value_coefficient_table', provenance: 'source_workbook', evidenceRefs: ['Tablolar!E2:R9'] },
      { code: 'source_year_c13_formula_error', provenance: 'source_workbook', evidenceRefs: ['Hesaplama!C64', 'Hesaplama!K64'] },
      { code: 'source_scratch_cells_m18_m19', provenance: 'source_workbook', evidenceRefs: ['Hesaplama!M18:M19'] },
      { code: 'source_unwired_j11', provenance: 'source_workbook', evidenceRefs: ['Hesaplama!J11', 'Hesaplama!H1'] },
      { code: 'source_later_additions_dormant', provenance: 'source_workbook', evidenceRefs: ['Tablolar!B264:L295'] },
    ],
  }
  const validation = validateValueLossRuleSnapshot(snapshot)
  if (!validation.ok) throw new Error(`VALUE_LOSS_SNAPSHOT_INVALID:${validation.errors.join(',')}`)
  return snapshot
}

type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }

function canonicalize(value: JsonValue): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number'
    || typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const object = value as { readonly [key: string]: JsonValue }
  return `{${Object.keys(object).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalize(object[key] as JsonValue)}`).join(',')}}`
}

export function canonicalValueLossJson(value: unknown): string {
  return canonicalize(value as JsonValue)
}

export function hashValueLossRuleSnapshot(snapshot: ValueLossRuleSnapshot): string {
  return sha256Text(canonicalValueLossJson(snapshot))
}

export interface ValueLossSnapshotValidation {
  readonly ok: boolean
  readonly errors: readonly string[]
}

function sourceRowAllowed(rule: ValueLossPartRule): boolean {
  const spec = VALUE_LOSS_ACTIVE_PART_TABLE_SPECS.find((candidate) => candidate.tableId === rule.sourceTable)
  return spec !== undefined
    && spec.vehicleGroupCodes.includes(rule.vehicleGroupCode)
    && rule.sourceRow >= spec.startRow
    && rule.sourceRow <= spec.endRow
}

export function validateValueLossRuleSnapshot(snapshot: ValueLossRuleSnapshot): ValueLossSnapshotValidation {
  const errors: string[] = []
  if (snapshot.schemaVersion !== VALUE_LOSS_SNAPSHOT_SCHEMA_VERSION) errors.push('schema_version')
  if (snapshot.identity !== VALUE_LOSS_SNAPSHOT_IDENTITY) errors.push('identity')
  if (snapshot.effectiveDate !== VALUE_LOSS_EFFECTIVE_DATE) errors.push('effective_date')
  if (snapshot.source.workbookSha256 !== VALUE_LOSS_SOURCE_WORKBOOK_SHA256) errors.push('workbook_hash')
  if (/[\\/]|^[A-Za-z]:/.test(snapshot.source.workbookFileName)) errors.push('source_path_leak')
  if (snapshot.vehicleGroupCodeSequence.map((item) => item.code).join(',')
    !== VALUE_LOSS_GROUP_CODE_SEQUENCE.join(',')) errors.push('group_code_sequence')

  const sourceMappings = snapshot.vehicleMappings.filter((mapping) => mapping.provenance === 'source_workbook')
  const productMappings = snapshot.vehicleMappings.filter((mapping) => mapping.provenance === 'product_decision')
  if (sourceMappings.length !== 3) errors.push('source_mapping_count')
  if (productMappings.length !== 11) errors.push('product_mapping_count')
  if (snapshot.vehicleMappings.length !== 14) errors.push('mapping_count')
  for (const mapping of productMappings) {
    if (mapping.decisionId === null || mapping.sourceNameCell !== null || mapping.sourceCodeCell !== null) {
      errors.push(`product_mapping_provenance:${mapping.ordinal}`)
    }
  }
  for (const mapping of sourceMappings) {
    if (mapping.decisionId !== null || mapping.sourceNameCell === null || mapping.sourceCodeCell === null) {
      errors.push(`source_mapping_provenance:${mapping.ordinal}`)
    }
  }

  const anomalyCodes = new Set(snapshot.anomalies.map((anomaly) => anomaly.code))
  for (const required of VALUE_LOSS_REQUIRED_ANOMALIES) {
    if (!anomalyCodes.has(required)) errors.push(`missing_anomaly:${required}`)
  }
  if (snapshot.anomalies.some((anomaly) => anomaly.provenance !== 'source_workbook')) {
    errors.push('anomaly_provenance')
  }

  const expectedTableCounts = [32, 46, 28, 13, 7, 4]
  if (snapshot.partTables.length !== expectedTableCounts.length) errors.push('active_table_count')
  snapshot.partTables.forEach((table, index) => {
    if (table.sourceRowCount !== expectedTableCounts[index]) errors.push(`active_table_rows:${table.tableId}`)
  })
  const ids = new Set<string>()
  for (const rule of snapshot.partRules) {
    if (ids.has(rule.stableId)) errors.push(`duplicate_stable_id:${rule.stableId}`)
    ids.add(rule.stableId)
    if (!sourceRowAllowed(rule)) errors.push(`part_rule_source:${rule.stableId}`)
    if (placeholderLabel(rule.sourceLabel)) errors.push(`part_rule_placeholder:${rule.stableId}`)
    const expectedId = buildValueLossPartStableId(rule)
    if (expectedId !== rule.stableId) errors.push(`stable_id_components:${rule.stableId}`)
  }
  if (snapshot.partRules.some((rule) => rule.sourceRow === 27 || rule.sourceRow >= 299)) {
    errors.push('excluded_row_leak')
  }

  const sectionKey = (section: ValueLossRuleSnapshot['sections'][number]): string =>
    `${section.sectionId}:${section.classification}:${section.sourceRange}:${section.reasonCode}`
  const expectedSections = new Set(FIXED_SECTIONS.map(sectionKey))
  if (snapshot.sections.some((section) => !expectedSections.has(sectionKey(section)))
    || snapshot.sections.length !== FIXED_SECTIONS.length) errors.push('section_classification')

  for (let index = 1; index < snapshot.ageCoefficients.length; index += 1) {
    if ((snapshot.ageCoefficients[index - 1]?.minAge ?? 0) >= (snapshot.ageCoefficients[index]?.minAge ?? 0)) {
      errors.push('age_normalization_order')
      break
    }
  }
  if (canonicalValueLossJson(snapshot).includes('generatedAt')
    || canonicalValueLossJson(snapshot).includes('timestamp')) errors.push('dynamic_timestamp')
  return { ok: errors.length === 0, errors }
}

export interface ValueLossRuleManifest {
  readonly schemaVersion: typeof VALUE_LOSS_MANIFEST_SCHEMA_VERSION
  readonly identity: typeof VALUE_LOSS_SNAPSHOT_IDENTITY
  readonly effectiveDate: typeof VALUE_LOSS_EFFECTIVE_DATE
  readonly sourceWorkbook: {
    readonly fileName: typeof VALUE_LOSS_SOURCE_WORKBOOK_FILE_NAME
    readonly sha256: typeof VALUE_LOSS_SOURCE_WORKBOOK_SHA256
  }
  readonly extractorVersion: string
  readonly sheetList: readonly {
    readonly name: string
    readonly state: 'visible' | 'hidden' | 'veryHidden'
    readonly partName: string
  }[]
  readonly extractedRanges: readonly string[]
  readonly activeRanges: readonly string[]
  readonly dormantRanges: readonly string[]
  readonly excludedRanges: readonly string[]
  readonly anomalyCodes: readonly string[]
  readonly mappingCounts: {
    readonly sourceWorkbook: 3
    readonly productDecision: 11
  }
  readonly normalizedSnapshotSha256: string
}

export function buildValueLossRuleManifest(
  snapshot: ValueLossRuleSnapshot,
  normalizedSnapshotSha256: string,
): ValueLossRuleManifest {
  return {
    schemaVersion: VALUE_LOSS_MANIFEST_SCHEMA_VERSION,
    identity: VALUE_LOSS_SNAPSHOT_IDENTITY,
    effectiveDate: VALUE_LOSS_EFFECTIVE_DATE,
    sourceWorkbook: {
      fileName: VALUE_LOSS_SOURCE_WORKBOOK_FILE_NAME,
      sha256: VALUE_LOSS_SOURCE_WORKBOOK_SHA256,
    },
    extractorVersion: snapshot.source.extractorVersion,
    sheetList: snapshot.sheets.map((sourceSheet) => ({
      name: sourceSheet.name,
      state: sourceSheet.state,
      partName: sourceSheet.partName,
    })),
    extractedRanges: [
      'Tablolar!C3:C16',
      'Tablolar!B4:C6',
      'Tablolar!B19:C26',
      'Tablolar!E12:O20',
      'Tablolar!E24:F26',
      ...snapshot.partTables.map((table) => table.sourceRange),
      'Uygulama Esasları!B1:B132',
    ],
    activeRanges: snapshot.partTables.map((table) => table.sourceRange),
    dormantRanges: snapshot.sections
      .filter((section) => section.classification === 'dormant')
      .map((section) => section.sourceRange),
    excludedRanges: snapshot.sections
      .filter((section) => section.classification === 'excluded')
      .map((section) => section.sourceRange),
    anomalyCodes: snapshot.anomalies.map((anomaly) => anomaly.code),
    mappingCounts: { sourceWorkbook: 3, productDecision: 11 },
    normalizedSnapshotSha256,
  }
}

export const VALUE_LOSS_RULE_SNAPSHOT_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://hasarbotu.local/schemas/value-loss-rule-snapshot-1.0.0.json',
  title: 'HasarBotu Paket 66 Değer Kaybı Kaynak Snapshot',
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion', 'identity', 'effectiveDate', 'source', 'sheets',
    'vehicleGroupCodeSequence', 'vehicleMappings', 'ageCoefficients',
    'usageCoefficientTables', 'generalModifiers', 'partTables', 'partRules',
    'applicationPrinciples', 'dataValidations', 'cachedFormulaErrors',
    'sections', 'anomalies',
  ],
  properties: {
    schemaVersion: { const: VALUE_LOSS_SNAPSHOT_SCHEMA_VERSION },
    identity: { const: VALUE_LOSS_SNAPSHOT_IDENTITY },
    effectiveDate: { const: VALUE_LOSS_EFFECTIVE_DATE },
    source: {
      type: 'object',
      additionalProperties: false,
      required: ['workbookFileName', 'workbookSha256', 'extractorVersion'],
      properties: {
        workbookFileName: { const: VALUE_LOSS_SOURCE_WORKBOOK_FILE_NAME },
        workbookSha256: { const: VALUE_LOSS_SOURCE_WORKBOOK_SHA256 },
        extractorVersion: { type: 'string', minLength: 1 },
      },
    },
    sheets: { type: 'array', minItems: 4, items: { type: 'object' } },
    vehicleGroupCodeSequence: { type: 'array', minItems: 14, maxItems: 14, items: { type: 'object' } },
    vehicleMappings: { type: 'array', minItems: 14, maxItems: 14, items: { type: 'object' } },
    ageCoefficients: { type: 'array', minItems: 8, maxItems: 8, items: { type: 'object' } },
    usageCoefficientTables: { type: 'array', minItems: 7, maxItems: 7, items: { type: 'object' } },
    generalModifiers: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'object' } },
    partTables: { type: 'array', minItems: 6, maxItems: 6, items: { type: 'object' } },
    partRules: { type: 'array', minItems: 1, items: { type: 'object' } },
    applicationPrinciples: { type: 'array', minItems: 1, items: { type: 'object' } },
    dataValidations: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'object' } },
    cachedFormulaErrors: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'object' } },
    sections: { type: 'array', minItems: 6, maxItems: 6, items: { type: 'object' } },
    anomalies: { type: 'array', minItems: VALUE_LOSS_REQUIRED_ANOMALIES.length, items: { type: 'object' } },
  },
} as const
