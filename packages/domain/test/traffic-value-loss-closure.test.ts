import { describe, expect, it } from 'vitest'
import { evaluateTrafficValueLossClosure } from '../src/index.js'

const assessment = {
  assessmentId: 'assessment-1',
  assessmentVersionId: 'version-1',
  assessmentVersion: 3,
  status: 'approved' as const,
  humanApprovalStatus: 'approved' as const,
  calculationRuleVersion: '2026.07.01.1',
  resultCode: 'calculable' as const,
  amountMinor: 245_000,
}
const report = {
  reportId: 'report-1',
  assessmentVersionId: 'version-1',
  ruleVersion: '2026.07.01.1',
  generatedAt: '2026-07-16T10:00:00.000Z',
}

describe('traffic value loss closure evaluation', () => {
  it('güncel onaylı sürüm ve aynı sürüm raporunu deterministik present sayar', () => {
    const input = { caseType: 'traffic' as const, assessment, report }
    expect(evaluateTrafficValueLossClosure(input)).toMatchObject({
      status: 'present',
      assessmentVersion: 3,
      amountMinor: 245_000,
      reportId: 'report-1',
      requiresHumanReview: false,
    })
    expect(evaluateTrafficValueLossClosure(input)).toEqual(evaluateTrafficValueLossClosure(input))
  })

  it('eksik, onaysız, raporsuz veya sürümü uyuşmayan sonucu control_required yapar', () => {
    expect(evaluateTrafficValueLossClosure({
      caseType: 'traffic', assessment: null, report: null,
    }).status).toBe('control_required')
    expect(evaluateTrafficValueLossClosure({
      caseType: 'traffic',
      assessment: { ...assessment, status: 'draft', humanApprovalStatus: 'pending' },
      report: null,
    }).status).toBe('control_required')
    expect(evaluateTrafficValueLossClosure({
      caseType: 'traffic', assessment, report: null,
    }).status).toBe('control_required')
    expect(evaluateTrafficValueLossClosure({
      caseType: 'traffic', assessment: { ...assessment, amountMinor: null }, report,
    }).status).toBe('control_required')
    expect(evaluateTrafficValueLossClosure({
      caseType: 'traffic', assessment, report: { ...report, assessmentVersionId: 'version-old' },
    }).status).toBe('control_required')
  })

  it('Kasko dosyasında not_applicable döner', () => {
    expect(evaluateTrafficValueLossClosure({
      caseType: 'casco', assessment: null, report: null,
    })).toMatchObject({ status: 'not_applicable', requiresHumanReview: false })
  })
})
