import {
  LABOR_ALLOCATION_CATEGORIES,
  type LaborAllocationCategory,
} from './labor-allocation-categories.js'
import { normalizeBaselineMatchText } from './labor-baseline.js'
import { sha256Text } from './pdf-text-extraction.js'

export const LABOR_WORKBOOK_APPLY_RULE_VERSION =
  'labor-workbook-apply/1.0.0' as const

export const LABOR_WORKBOOK_APPLY_CONFLICT_CODES = [
  'application_not_approved',
  'revision_stale',
  'approved_value_missing',
  'category_provenance_missing',
  'category_total_conflict',
  'line_control_required',
  'part_code_missing',
  'part_code_source_missing',
  'operation_type_missing',
  'source_row_reference_missing',
  'source_row_reference_duplicate',
  'source_row_out_of_range',
] as const

export type LaborWorkbookApplyConflictCode =
  (typeof LABOR_WORKBOOK_APPLY_CONFLICT_CODES)[number]

export type LaborWorkbookApprovalStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'superseded'

export interface LaborWorkbookApprovedCategoryAmount {
  readonly category: LaborAllocationCategory
  readonly amountMinor: number
}

export interface LaborWorkbookApprovedLine {
  readonly lineOrdinal: number
  readonly description: string
  readonly operationType: string
  readonly partCode: string | null
  readonly partCodeSource: 'user_entered' | 'dictionary_suggested' | null
  readonly damageRegion: string | null
  readonly proposedLaborAmountMinor: number
  readonly finalLaborAmountMinor: number
  readonly proposedCategoryAmounts:
    readonly LaborWorkbookApprovedCategoryAmount[] | null
  readonly finalCategoryAmounts:
    readonly LaborWorkbookApprovedCategoryAmount[] | null
  readonly manuallyModified: boolean
  readonly controlRequired: boolean
}

export interface LaborWorkbookSourceRowSelection {
  readonly lineOrdinal: number
  readonly rowNumber: number
}

export interface LaborWorkbookApplySnapshotInput {
  readonly organizationId: string
  readonly caseId: string
  readonly applicationId: string
  readonly revisionId: string
  readonly revisionVersion: number
  readonly currentRevisionId: string
  readonly currentRevisionVersion: number
  readonly approvalStatus: LaborWorkbookApprovalStatus
  readonly lines: readonly LaborWorkbookApprovedLine[]
  readonly sourceRows: readonly LaborWorkbookSourceRowSelection[]
}

export interface LaborWorkbookApplyRowSnapshot {
  readonly lineOrdinal: number
  readonly rowNumber: number | null
  readonly cell: string | null
  readonly partCode: string | null
  readonly partName: string
  readonly operationType: string
  readonly damageRegion: string | null
  readonly proposedLaborAmountMinor: number
  readonly finalLaborAmountMinor: number
  readonly newValue: string | null
  readonly valueSource: 'approved_final'
  readonly manuallyModified: boolean
  readonly matchConfidence: 'exact_source_row' | 'control_required'
  readonly conflictCodes: readonly LaborWorkbookApplyConflictCode[]
}

export interface LaborWorkbookApplySnapshot {
  readonly ruleVersion: typeof LABOR_WORKBOOK_APPLY_RULE_VERSION
  readonly snapshotHash: string
  readonly organizationId: string
  readonly caseId: string
  readonly applicationId: string
  readonly revisionId: string
  readonly revisionVersion: number
  readonly rows: readonly LaborWorkbookApplyRowSnapshot[]
  readonly changedValueTotalMinor: number
  readonly controlRequiredCount: number
  readonly canPreview: boolean
}

function sha256Canonical(value: unknown): string {
  return sha256Text(JSON.stringify(value))
}

function categoryTotal(
  amounts: readonly LaborWorkbookApprovedCategoryAmount[] | null,
): number | null {
  if (amounts === null || amounts.length !== LABOR_ALLOCATION_CATEGORIES.length) {
    return null
  }
  const byCategory = new Map<LaborAllocationCategory, number>()
  for (const amount of amounts) {
    if (byCategory.has(amount.category)
      || !Number.isSafeInteger(amount.amountMinor)
      || amount.amountMinor < 0) {
      return null
    }
    byCategory.set(amount.category, amount.amountMinor)
  }
  if (!LABOR_ALLOCATION_CATEGORIES.every((category) => byCategory.has(category))) {
    return null
  }
  return [...byCategory.values()].reduce((sum, amount) => sum + amount, 0)
}

/**
 * Para float'a çevrilmez. Minor-unit değer Excel'e deterministik `123.45`
 * metni olarak gider; yerel ayraç veya binary float yuvarlaması kullanılmaz.
 */
export function formatLaborWorkbookMinorValue(amountMinor: number): string | null {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) return null
  const whole = Math.floor(amountMinor / 100)
  const fraction = String(amountMinor % 100).padStart(2, '0')
  return `${whole}.${fraction}`
}

/** Workbook'taki eski D değerini float kullanmadan minor-unit'e çevirir. */
export function parseLaborWorkbookMinorValue(value: string | null): number | null {
  if (value === null || value.trim() === '') return 0
  const match = /^([0-9]{1,13})(?:[.,]([0-9]{1,2}))?$/.exec(value.trim())
  if (match === null) return null
  const whole = Number(match[1])
  const fraction = Number((match[2] ?? '').padEnd(2, '0'))
  const minor = whole * 100 + fraction
  return Number.isSafeInteger(minor) ? minor : null
}

/**
 * Yalnız kullanıcı onaylı, current ve conflict içermeyen immutable revision
 * snapshot'ından D hücresi plan kaynağı üretir. Eşleme fuzzy değildir:
 * kullanıcının seçtiği workbook satırı exact source-row referansıdır; gerçek
 * satır hash'i File Agent preview'ında eklenir.
 */
export function buildLaborWorkbookApplySnapshot(
  input: LaborWorkbookApplySnapshotInput,
): LaborWorkbookApplySnapshot {
  const selections = new Map<number, LaborWorkbookSourceRowSelection>()
  const duplicateOrdinals = new Set<number>()
  const duplicateRows = new Set<number>()
  const seenRows = new Set<number>()
  for (const selection of input.sourceRows) {
    if (selections.has(selection.lineOrdinal)) duplicateOrdinals.add(selection.lineOrdinal)
    selections.set(selection.lineOrdinal, selection)
    if (seenRows.has(selection.rowNumber)) duplicateRows.add(selection.rowNumber)
    seenRows.add(selection.rowNumber)
  }

  const revisionApproved = input.approvalStatus === 'approved'
  const revisionCurrent = input.revisionId === input.currentRevisionId
    && input.revisionVersion === input.currentRevisionVersion

  const rows = [...input.lines]
    .sort((left, right) => left.lineOrdinal - right.lineOrdinal)
    .map((line): LaborWorkbookApplyRowSnapshot => {
      const conflicts: LaborWorkbookApplyConflictCode[] = []
      const selection = selections.get(line.lineOrdinal)
      if (!revisionApproved) conflicts.push('application_not_approved')
      if (!revisionCurrent) conflicts.push('revision_stale')
      if (!Number.isSafeInteger(line.finalLaborAmountMinor)
        || line.finalLaborAmountMinor < 0) {
        conflicts.push('approved_value_missing')
      }
      const finalCategoryTotal = categoryTotal(line.finalCategoryAmounts)
      if (finalCategoryTotal === null) {
        conflicts.push('category_provenance_missing')
      } else if (finalCategoryTotal !== line.finalLaborAmountMinor) {
        conflicts.push('category_total_conflict')
      }
      if (line.controlRequired) conflicts.push('line_control_required')
      if (line.partCode === null || normalizeBaselineMatchText(line.partCode) === '') {
        conflicts.push('part_code_missing')
      }
      if (line.partCodeSource === null) conflicts.push('part_code_source_missing')
      if (normalizeBaselineMatchText(line.operationType) === '') {
        conflicts.push('operation_type_missing')
      }
      if (selection === undefined || duplicateOrdinals.has(line.lineOrdinal)) {
        conflicts.push('source_row_reference_missing')
      } else {
        if (selection.rowNumber < 2 || selection.rowNumber > 1_048_576) {
          conflicts.push('source_row_out_of_range')
        }
        if (duplicateRows.has(selection.rowNumber)) {
          conflicts.push('source_row_reference_duplicate')
        }
      }
      const newValue = formatLaborWorkbookMinorValue(line.finalLaborAmountMinor)
      if (newValue === null && !conflicts.includes('approved_value_missing')) {
        conflicts.push('approved_value_missing')
      }
      return {
        lineOrdinal: line.lineOrdinal,
        rowNumber: selection?.rowNumber ?? null,
        cell: selection === undefined ? null : `D${selection.rowNumber}`,
        partCode: line.partCode,
        partName: line.description,
        operationType: line.operationType,
        damageRegion: line.damageRegion,
        proposedLaborAmountMinor: line.proposedLaborAmountMinor,
        finalLaborAmountMinor: line.finalLaborAmountMinor,
        newValue,
        valueSource: 'approved_final',
        manuallyModified: line.manuallyModified,
        matchConfidence: conflicts.length === 0
          ? 'exact_source_row'
          : 'control_required',
        conflictCodes: [...new Set(conflicts)],
      }
    })

  const canonical = {
    ruleVersion: LABOR_WORKBOOK_APPLY_RULE_VERSION,
    organizationId: input.organizationId,
    caseId: input.caseId,
    applicationId: input.applicationId,
    revisionId: input.revisionId,
    revisionVersion: input.revisionVersion,
    approvalStatus: input.approvalStatus,
    rows,
  }
  return {
    ruleVersion: LABOR_WORKBOOK_APPLY_RULE_VERSION,
    snapshotHash: sha256Canonical(canonical),
    organizationId: input.organizationId,
    caseId: input.caseId,
    applicationId: input.applicationId,
    revisionId: input.revisionId,
    revisionVersion: input.revisionVersion,
    rows,
    changedValueTotalMinor: rows.reduce(
      (sum, row) => sum + (Number.isSafeInteger(row.finalLaborAmountMinor)
        ? row.finalLaborAmountMinor
        : 0),
      0,
    ),
    controlRequiredCount: rows.filter(
      (row) => row.matchConfidence === 'control_required',
    ).length,
    canPreview: rows.length > 0
      && rows.every((row) => row.matchConfidence === 'exact_source_row'),
  }
}
