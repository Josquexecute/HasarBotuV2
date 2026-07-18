import { describe, expect, it } from 'vitest'
import {
  pertAssessmentCreateRequestSchema,
  pertAssessmentReviseRequestSchema,
  pertAssessmentWorkspaceResponseSchema,
} from '../src/index.js'

const caseId = '019f5dd6-b191-7380-afe2-95580597762f'
const userId = '019f5dd6-b191-7380-afe2-95580597770a'
const versionId = '019f5dd6-b191-7380-afe2-955805977401'

const version = {
  id: versionId,
  assessmentVersion: 1,
  previousVersionId: null,
  workflowStatus: 'under_review',
  estimatedDamageMinor: 4_800_000_00,
  marketValueMinor: 6_250_000_00,
  damageRatioPercent: 77,
  structuralNote: 'Ön panel ölçümü bekleniyor.',
  expertOpinion: null,
  expertRationale: null,
  centerDecision: null,
  centerNote: null,
  schemaVersion: 'pert-assessment/1.0.0',
  currency: 'TRY',
  sourceType: 'user_entered',
  revisionReason: null,
  createdByUserId: userId,
  createdByDisplayName: 'P45 Eksper',
  createdAt: '2026-07-18T09:00:00.000Z',
}

describe('pert assessment contracts', () => {
  it('create komutu strict doğrulanır; boş alanlar null default alır', () => {
    const parsed = pertAssessmentCreateRequestSchema.parse({
      workflowStatus: 'under_review',
      expectedCaseVersion: 3,
      confirmed: true,
    })
    expect(parsed.estimatedDamageMinor).toBeNull()
    expect(parsed.expertOpinion).toBeNull()
    expect(() => pertAssessmentCreateRequestSchema.parse({
      workflowStatus: 'under_review',
      expectedCaseVersion: 3,
      confirmed: false,
    })).toThrow()
    expect(() => pertAssessmentCreateRequestSchema.parse({
      workflowStatus: 'unknown_status',
      expectedCaseVersion: 3,
      confirmed: true,
    })).toThrow()
    expect(() => pertAssessmentCreateRequestSchema.parse({
      workflowStatus: 'under_review',
      estimatedDamageMinor: -1,
      expectedCaseVersion: 3,
      confirmed: true,
    })).toThrow()
  })

  it('revise komutu zorunlu gerekçe ister', () => {
    expect(pertAssessmentReviseRequestSchema.parse({
      workflowStatus: 'pert_candidate',
      expectedVersion: 1,
      reason: 'Rayiç güncellendi',
      confirmed: true,
    }).reason).toBe('Rayiç güncellendi')
    expect(() => pertAssessmentReviseRequestSchema.parse({
      workflowStatus: 'pert_candidate',
      expectedVersion: 1,
      reason: '   ',
      confirmed: true,
    })).toThrow()
  })

  it('workspace yanıtında değerlendirme null olabilir; dolu halde strict parse edilir', () => {
    const empty = pertAssessmentWorkspaceResponseSchema.parse({
      caseId,
      caseVersion: 3,
      lifecycleStatus: 'open',
      assessment: null,
      permissions: { canWrite: true },
    })
    expect(empty.assessment).toBeNull()

    const full = pertAssessmentWorkspaceResponseSchema.parse({
      caseId,
      caseVersion: 3,
      lifecycleStatus: 'open',
      assessment: {
        id: versionId,
        caseId,
        version: 1,
        currentVersion: version,
        versions: [version],
        createdByUserId: userId,
        createdByDisplayName: 'P45 Eksper',
        createdAt: '2026-07-18T09:00:00.000Z',
        updatedAt: '2026-07-18T09:00:00.000Z',
      },
      permissions: { canWrite: false },
    })
    expect(full.assessment?.currentVersion.damageRatioPercent).toBe(77)
  })
})
