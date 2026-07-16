import { describe, expect, it } from 'vitest'
import {
  CASE_CLOSE_PLAN_ROUTE,
  CASE_REOPEN_PLAN_ROUTE,
  closePlanRequestSchema,
  reopenPlanRequestSchema,
  trafficValueLossClosureSummarySchema,
} from '../src/index.js'

describe('case lifecycle contracts', () => {
  it('surumlu tenant case route sabitlerini tasir', () => {
    expect(CASE_CLOSE_PLAN_ROUTE).toBe('/api/v1/cases/:caseId/lifecycle/close/plan')
    expect(CASE_REOPEN_PLAN_ROUTE).toBe('/api/v1/cases/:caseId/lifecycle/reopen/plan')
  })

  it('eksiklerle close gerekcesiz reddedilir; normal close kabul edilir', () => {
    expect(closePlanRequestSchema.safeParse({ expectedCaseVersion: 1, expectedLocationVersion: 1, closeMode: 'normal' }).success).toBe(true)
    expect(closePlanRequestSchema.safeParse({ expectedCaseVersion: 1, expectedLocationVersion: 1, closeMode: 'with_missing_requirements' }).success).toBe(false)
  })

  it('reopen closed workflow hedefini reddeder ve gerekce ister', () => {
    expect(reopenPlanRequestSchema.safeParse({ expectedCaseVersion: 2, expectedLocationVersion: 2, reason: 'Yeniden inceleme', targetWorkflowStage: 'reporting' }).success).toBe(true)
    expect(reopenPlanRequestSchema.safeParse({ expectedCaseVersion: 2, expectedLocationVersion: 2, reason: 'Yeniden inceleme', targetWorkflowStage: 'closed' }).success).toBe(false)
  })

  it('değer kaybı kapanış özetini strict ve sürümlü doğrular', () => {
    expect(trafficValueLossClosureSummarySchema.parse({
      status: 'control_required',
      reason: 'Nihai rapor bulunamadı.',
      ruleVersion: 'traffic-value-loss-closure/1.0.0',
      requiresHumanReview: true,
      assessmentId: null,
      assessmentVersionId: null,
      assessmentVersion: null,
      assessmentStatus: null,
      humanApprovalStatus: null,
      calculationRuleVersion: null,
      resultCode: null,
      amountMinor: null,
      reportId: null,
      reportGeneratedAt: null,
    }).status).toBe('control_required')
  })
})
