import { describe, expect, it } from 'vitest'
import {
  DASHBOARD_PRIORITY_VERSION,
  compareDashboardItems,
  daysBetweenLocalDates,
  evaluateDashboardPriority,
  type DashboardPriorityInput,
} from '../src/index.js'

const base: DashboardPriorityInput = {
  caseId: 'case-1',
  officeCaseNumber: '2026/1',
  updatedAt: '2026-07-15T09:00:00.000Z',
  followUpDate: null,
  responsibleUserId: 'user-1',
  missingDocumentCount: 0,
  controlRequiredDocumentCount: 0,
  pendingHumanApprovalCount: 0,
  manualRecoveryCount: 0,
  failedOperationCount: 0,
  blockedOperationCount: 0,
  openTaskCount: 0,
  overdueTaskCount: 0,
  dueTodayTaskCount: 0,
  upcomingTaskCount: 0,
}

describe('dashboard öncelik motoru', () => {
  it('sürümü sabittir ve LocalDate farkını timezone kullanmadan hesaplar', () => {
    expect(DASHBOARD_PRIORITY_VERSION).toBe('dashboard-priority/1.1.0')
    expect(daysBetweenLocalDates('2026-07-16', '2026-07-15')).toBe(-1)
    expect(daysBetweenLocalDates('2026-07-16', '2026-07-23')).toBe(7)
  })

  it('geciken ve yaklaşan görevleri takip tarihinden ayrı, sürümlü sinyal olarak taşır', () => {
    expect(evaluateDashboardPriority({
      ...base,
      openTaskCount: 2,
      overdueTaskCount: 1,
      dueTodayTaskCount: 1,
    }, '2026-07-16')).toMatchObject({
      priority: 'critical',
      primaryAttention: 'overdue_task',
      attentionCodes: ['overdue_task', 'task_due_today'],
    })
    expect(evaluateDashboardPriority({
      ...base,
      openTaskCount: 1,
      upcomingTaskCount: 1,
    }, '2026-07-16').primaryAttention).toBe('upcoming_task')
  })

  it('manuel recovery ve gecikmiş takibi diğer sinyallerin önünde tutar', () => {
    const result = evaluateDashboardPriority({
      ...base,
      followUpDate: '2026-07-15',
      missingDocumentCount: 3,
      pendingHumanApprovalCount: 1,
      manualRecoveryCount: 1,
    }, '2026-07-16')

    expect(result).toMatchObject({
      priority: 'critical',
      primaryAttention: 'manual_recovery',
      requiresAction: true,
    })
    expect(result.attentionCodes).toEqual([
      'manual_recovery',
      'overdue_follow_up',
      'human_approval',
      'missing_documents',
    ])
  })

  it('onay, eksik, kontrol, bugün ve yaklaşan takibi sürümlü sırayla sınıflandırır', () => {
    expect(evaluateDashboardPriority({ ...base, pendingHumanApprovalCount: 1 }, '2026-07-16').priority).toBe('high')
    expect(evaluateDashboardPriority({ ...base, missingDocumentCount: 1 }, '2026-07-16').priority).toBe('high')
    expect(evaluateDashboardPriority({ ...base, controlRequiredDocumentCount: 1 }, '2026-07-16').priority).toBe('medium')
    expect(evaluateDashboardPriority({ ...base, followUpDate: '2026-07-16' }, '2026-07-16').primaryAttention).toBe('follow_up_today')
    expect(evaluateDashboardPriority({ ...base, followUpDate: '2026-07-23' }, '2026-07-16').primaryAttention).toBe('upcoming_follow_up')
    expect(evaluateDashboardPriority({ ...base, followUpDate: '2026-07-24' }, '2026-07-16').requiresAction).toBe(false)
  })

  it('aynı girdide aynı sonucu ve kararlı bağlayıcı sıralamayı üretir', () => {
    const first = evaluateDashboardPriority({ ...base, missingDocumentCount: 2 }, '2026-07-16')
    const second = evaluateDashboardPriority({ ...base, missingDocumentCount: 2 }, '2026-07-16')
    expect(first).toEqual(second)

    const items = [
      { caseId: 'case-b', priorityScore: 650, followUpDate: null, updatedAt: '2026-07-15T10:00:00.000Z' },
      { caseId: 'case-a', priorityScore: 650, followUpDate: null, updatedAt: '2026-07-15T10:00:00.000Z' },
      { caseId: 'case-c', priorityScore: 850, followUpDate: '2026-07-15', updatedAt: '2026-07-16T10:00:00.000Z' },
    ]
    expect([...items].sort(compareDashboardItems).map((item) => item.caseId)).toEqual([
      'case-c',
      'case-a',
      'case-b',
    ])
  })
})
