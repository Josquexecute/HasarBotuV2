import { describe, expect, it } from 'vitest'
import {
  DASHBOARD_ROUTE,
  dashboardResponseSchema,
} from '../src/index.js'

const response = {
  asOfDate: '2026-07-16',
  evaluatedAt: '2026-07-16T09:00:00.000Z',
  priorityVersion: 'dashboard-priority/1.0.0',
  summary: {
    openCaseCount: 1,
    overdueFollowUpCount: 1,
    dueTodayCount: 0,
    upcomingFollowUpCount: 0,
    missingDocumentCaseCount: 1,
    controlRequiredDocumentCaseCount: 0,
    pendingHumanApprovalCaseCount: 1,
    actionRequiredCaseCount: 1,
    criticalCaseCount: 1,
  },
  stageCounts: [
    { stage: 'new_notification', count: 0 },
    { stage: 'vehicle_or_service_pending', count: 0 },
    { stage: 'inspection_pending', count: 1 },
    { stage: 'damage_assessment', count: 0 },
    { stage: 'parts_and_labor', count: 0 },
    { stage: 'repair_approval_pending', count: 0 },
    { stage: 'under_repair', count: 0 },
    { stage: 'reporting', count: 0 },
    { stage: 'closing_documents', count: 0 },
    { stage: 'ready_to_close', count: 0 },
  ],
  items: [{
    caseId: '019f7000-0000-7000-8000-000000000001',
    caseType: 'casco',
    officeCaseNumber: '2026/1',
    plate: '34 ABC 123',
    stage: 'inspection_pending',
    responsibleUserId: null,
    responsibleUserName: null,
    insurerName: 'Sentetik Sigorta',
    serviceName: null,
    followUpDate: '2026-07-15',
    updatedAt: '2026-07-15T09:00:00.000Z',
    version: 1,
    missingDocumentCount: 2,
    controlRequiredDocumentCount: 0,
    documentRuleVersion: '2026.07.14.1',
    pendingHumanApprovalCount: 1,
    pendingHumanApprovalKinds: ['policy_analysis'],
    manualRecoveryCount: 0,
    failedOperationCount: 0,
    blockedOperationCount: 0,
    priority: 'critical',
    priorityScore: 871,
    primaryAttention: 'overdue_follow_up',
    attentionCodes: ['overdue_follow_up', 'human_approval', 'missing_documents', 'unassigned'],
    requiresAction: true,
  }],
}

describe('dashboard contracts', () => {
  it('route ve gerçek dashboard cevabı strict doğrulanır', () => {
    expect(DASHBOARD_ROUTE).toBe('/api/v1/dashboard')
    expect(dashboardResponseSchema.parse(response)).toEqual(response)
  })

  it('unknown alan, duplicate sinyal ve mutlak yol reddedilir', () => {
    expect(dashboardResponseSchema.safeParse({ ...response, absolutePath: 'P:\\x' }).success).toBe(false)
    expect(dashboardResponseSchema.safeParse({
      ...response,
      items: [{
        ...response.items[0],
        attentionCodes: ['missing_documents', 'missing_documents'],
      }],
    }).success).toBe(false)
    expect(JSON.stringify(response)).not.toMatch(/[A-Z]:\\|secret|documentContent/i)
  })
})
