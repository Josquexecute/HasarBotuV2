import { describe, expect, it } from 'vitest'
import {
  laborSheetCreateRequestSchema,
  laborSheetItemSchema,
  laborSheetReviseRequestSchema,
  laborSheetWorkspaceResponseSchema,
} from '../src/index.js'

const caseId = '019f5dd6-b191-7380-afe2-95580597762f'
const userId = '019f5dd6-b191-7380-afe2-95580597770a'
const versionId = '019f5dd6-b191-7380-afe2-955805977222'

const item = {
  description: 'Ön tampon kaplama',
  action: 'Değişim',
  partAmountMinor: 18_400_00,
  laborAmountMinor: 2_200_00,
}

/** Paket 56 kanıt alanları varsayılan olarak null'dır; eski istemci değişmez. */
const evidenceDefaults = { partCode: null, partCodeSource: null, damageRegion: null }
const itemWithEvidence = { ...item, ...evidenceDefaults }

describe('labor sheet contracts', () => {
  it('create komutunu strict doğrular ve fazla anahtarı reddeder', () => {
    expect(laborSheetCreateRequestSchema.parse({
      expectedCaseVersion: 1,
      items: [item],
      confirmed: true,
    })).toEqual({
      expectedCaseVersion: 1,
      items: [itemWithEvidence],
      laborAiSuggestionRunId: null,
      confirmed: true,
    })

    expect(() => laborSheetCreateRequestSchema.parse({
      expectedCaseVersion: 1,
      items: [item],
      confirmed: true,
      extra: 'x',
    })).toThrow()
  })

  it('confirmed=true zorunludur ve en az bir kalem ister', () => {
    expect(() => laborSheetCreateRequestSchema.parse({ expectedCaseVersion: 1, items: [item], confirmed: false })).toThrow()
    expect(() => laborSheetCreateRequestSchema.parse({ expectedCaseVersion: 1, items: [], confirmed: true })).toThrow()
  })

  it('negatif, ondalık veya fazla büyük tutarı reddeder', () => {
    expect(() => laborSheetItemSchema.parse({ ...item, ordinal: 1, partAmountMinor: -1 })).toThrow()
    expect(() => laborSheetItemSchema.parse({ ...item, ordinal: 1, laborAmountMinor: 1.5 })).toThrow()
    expect(() => laborSheetItemSchema.parse({ ...item, ordinal: 1, partAmountMinor: 100_000_000_00 + 1 })).toThrow()
  })

  it('revise komutu zorunlu gerekçe ve beklenen sürüm ister', () => {
    expect(laborSheetReviseRequestSchema.parse({
      expectedVersion: 2,
      items: [item],
      reason: 'Parça bedeli güncellendi',
      confirmed: true,
    }).reason).toBe('Parça bedeli güncellendi')
    expect(() => laborSheetReviseRequestSchema.parse({
      expectedVersion: 2,
      items: [item],
      reason: '   ',
      confirmed: true,
    })).toThrow()
  })

  it('workspace yanıtında föy null olabilir (henüz oluşturulmamış)', () => {
    const empty = laborSheetWorkspaceResponseSchema.parse({
      caseId,
      caseVersion: 3,
      lifecycleStatus: 'open',
      sheet: null,
      permissions: { canWrite: true },
    })
    expect(empty.sheet).toBeNull()

    const withSheet = laborSheetWorkspaceResponseSchema.parse({
      caseId,
      caseVersion: 3,
      lifecycleStatus: 'open',
      sheet: {
        id: versionId,
        caseId,
        version: 1,
        currentVersion: {
          id: versionId,
          sheetVersion: 1,
          previousVersionId: null,
          items: [{ ...itemWithEvidence, ordinal: 1 }],
          totals: { partTotalMinor: 18_400_00, laborTotalMinor: 2_200_00, grandTotalMinor: 20_600_00 },
          schemaVersion: 'labor-sheet/1.0.0',
          currency: 'TRY',
          sourceType: 'user_entered',
          laborAiSuggestionRunId: null,
          revisionReason: null,
          createdByUserId: userId,
          createdByDisplayName: 'P43 Yetkili',
          createdAt: '2026-07-17T09:00:00.000Z',
        },
        versions: [{
          id: versionId,
          sheetVersion: 1,
          previousVersionId: null,
          items: [{ ...itemWithEvidence, ordinal: 1 }],
          totals: { partTotalMinor: 18_400_00, laborTotalMinor: 2_200_00, grandTotalMinor: 20_600_00 },
          schemaVersion: 'labor-sheet/1.0.0',
          currency: 'TRY',
          sourceType: 'user_entered',
          laborAiSuggestionRunId: null,
          revisionReason: null,
          createdByUserId: userId,
          createdByDisplayName: 'P43 Yetkili',
          createdAt: '2026-07-17T09:00:00.000Z',
        }],
        createdByUserId: userId,
        createdByDisplayName: 'P43 Yetkili',
        createdAt: '2026-07-17T09:00:00.000Z',
        updatedAt: '2026-07-17T09:00:00.000Z',
      },
      permissions: { canWrite: false },
    })
    expect(withSheet.sheet?.currentVersion.totals.grandTotalMinor).toBe(20_600_00)
  })
})
