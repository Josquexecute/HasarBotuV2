import { describe, expect, it } from 'vitest'
import {
  LABOR_ALLOCATION_CATEGORIES,
  buildLaborWorkbookApplySnapshot,
  formatLaborWorkbookMinorValue,
  type LaborWorkbookApplySnapshotInput,
} from '../src/index.js'

const categories = (total: number) => LABOR_ALLOCATION_CATEGORIES.map(
  (category, index) => ({ category, amountMinor: index === 0 ? total : 0 }),
)

function input(
  overrides: Partial<LaborWorkbookApplySnapshotInput> = {},
): LaborWorkbookApplySnapshotInput {
  return {
    organizationId: '00000000-0000-7000-8000-000000000001',
    caseId: '00000000-0000-7000-8000-000000000002',
    applicationId: '00000000-0000-7000-8000-000000000003',
    revisionId: '00000000-0000-7000-8000-000000000004',
    revisionVersion: 2,
    currentRevisionId: '00000000-0000-7000-8000-000000000004',
    currentRevisionVersion: 2,
    approvalStatus: 'approved',
    lines: [{
      lineOrdinal: 1,
      description: 'Ön tampon',
      operationType: 'Değişim',
      partCode: 'TMP-01',
      partCodeSource: 'user_entered',
      damageRegion: 'Ön',
      proposedLaborAmountMinor: 100_00,
      finalLaborAmountMinor: 125_50,
      proposedCategoryAmounts: categories(100_00),
      finalCategoryAmounts: categories(125_50),
      manuallyModified: true,
      controlRequired: false,
    }],
    sourceRows: [{ lineOrdinal: 1, rowNumber: 7 }],
    ...overrides,
  }
}

describe('Paket 65B runtime — onaylı revision workbook snapshotı', () => {
  it('immutable source-row reference ile yalnız final kullanıcı değerini üretir', () => {
    const result = buildLaborWorkbookApplySnapshot(input())
    expect(result).toMatchObject({
      canPreview: true,
      controlRequiredCount: 0,
      changedValueTotalMinor: 125_50,
      rows: [{
        cell: 'D7',
        newValue: '125.50',
        proposedLaborAmountMinor: 100_00,
        finalLaborAmountMinor: 125_50,
        manuallyModified: true,
        valueSource: 'approved_final',
        matchConfidence: 'exact_source_row',
      }],
    })
  })

  it.each(['draft', 'submitted', 'rejected', 'superseded'] as const)(
    '%s revision apply edilemez',
    (approvalStatus) => {
      const result = buildLaborWorkbookApplySnapshot(input({ approvalStatus }))
      expect(result.canPreview).toBe(false)
      expect(result.rows[0]?.conflictCodes).toContain('application_not_approved')
    },
  )

  it('approval sonrası revision değişirse stale olur', () => {
    const result = buildLaborWorkbookApplySnapshot(input({
      currentRevisionId: '00000000-0000-7000-8000-000000000099',
      currentRevisionVersion: 3,
    }))
    expect(result.canPreview).toBe(false)
    expect(result.rows[0]?.conflictCodes).toContain('revision_stale')
  })

  it('kategori toplam conflict, provenance eksikliği ve control-required satırı bloklar', () => {
    const base = input().lines[0]!
    for (const line of [
      { ...base, finalCategoryAmounts: categories(124_00) },
      { ...base, finalCategoryAmounts: null },
      { ...base, controlRequired: true },
    ]) {
      const result = buildLaborWorkbookApplySnapshot(input({ lines: [line] }))
      expect(result.canPreview).toBe(false)
      expect(result.controlRequiredCount).toBe(1)
    }
  })

  it('part code ve operation type kanıtı eksikse fail-closed davranır', () => {
    const base = input().lines[0]!
    const result = buildLaborWorkbookApplySnapshot(input({
      lines: [{ ...base, partCode: null, partCodeSource: null, operationType: ' ' }],
    }))
    expect(result.rows[0]?.conflictCodes).toEqual(expect.arrayContaining([
      'part_code_missing',
      'part_code_source_missing',
      'operation_type_missing',
    ]))
  })

  it('aynı satıra iki kalem, eksik referans ve sınır dışı satır yazmaz', () => {
    const base = input().lines[0]!
    const second = { ...base, lineOrdinal: 2, partCode: 'TMP-02' }
    const duplicate = buildLaborWorkbookApplySnapshot(input({
      lines: [base, second],
      sourceRows: [
        { lineOrdinal: 1, rowNumber: 7 },
        { lineOrdinal: 2, rowNumber: 7 },
      ],
    }))
    expect(duplicate.canPreview).toBe(false)
    expect(duplicate.rows.every((row) => (
      row.conflictCodes.includes('source_row_reference_duplicate')
    ))).toBe(true)

    const missing = buildLaborWorkbookApplySnapshot(input({ sourceRows: [] }))
    expect(missing.rows[0]?.conflictCodes).toContain('source_row_reference_missing')

    const invalid = buildLaborWorkbookApplySnapshot(input({
      sourceRows: [{ lineOrdinal: 1, rowNumber: 1 }],
    }))
    expect(invalid.rows[0]?.conflictCodes).toContain('source_row_out_of_range')
  })

  it('snapshot hash deterministiktir ve final değer değişirse değişir', () => {
    const first = buildLaborWorkbookApplySnapshot(input())
    const replay = buildLaborWorkbookApplySnapshot(input())
    expect(replay.snapshotHash).toBe(first.snapshotHash)
    const base = input().lines[0]!
    const changed = buildLaborWorkbookApplySnapshot(input({
      lines: [{
        ...base,
        finalLaborAmountMinor: 126_00,
        finalCategoryAmounts: categories(126_00),
      }],
    }))
    expect(changed.snapshotHash).not.toBe(first.snapshotHash)
  })

  it('minor-unit değeri float kullanmadan biçimlendirir', () => {
    expect(formatLaborWorkbookMinorValue(0)).toBe('0.00')
    expect(formatLaborWorkbookMinorValue(1)).toBe('0.01')
    expect(formatLaborWorkbookMinorValue(12_345_67)).toBe('12345.67')
    expect(formatLaborWorkbookMinorValue(Number.MAX_SAFE_INTEGER + 1)).toBeNull()
  })
})
