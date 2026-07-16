import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildMockDashboard,
  createHttpDashboardAdapter,
  DashboardError,
  DATA_SOURCE_STORAGE_KEY,
  useDashboard,
} from './index'

const stageCounts = [
  'new_notification',
  'vehicle_or_service_pending',
  'inspection_pending',
  'damage_assessment',
  'parts_and_labor',
  'repair_approval_pending',
  'under_repair',
  'reporting',
  'closing_documents',
  'ready_to_close',
].map((stage) => ({ stage, count: stage === 'inspection_pending' ? 1 : 0 }))

const response = {
  asOfDate: '2026-07-16',
  evaluatedAt: '2026-07-16T10:30:00.000Z',
  priorityVersion: 'dashboard-priority/1.1.0',
  summary: {
    openCaseCount: 1,
    overdueFollowUpCount: 1,
    dueTodayCount: 0,
    upcomingFollowUpCount: 0,
    openTaskCount: 1,
    overdueTaskCaseCount: 1,
    taskDueTodayCaseCount: 0,
    upcomingTaskCaseCount: 0,
    missingDocumentCaseCount: 1,
    controlRequiredDocumentCaseCount: 0,
    pendingHumanApprovalCaseCount: 1,
    actionRequiredCaseCount: 1,
    criticalCaseCount: 1,
  },
  stageCounts,
  items: [{
    caseId: '019f7000-0000-7000-8000-000000000001',
    caseType: 'casco',
    officeCaseNumber: '2026/1',
    plate: '34 PNO 001',
    stage: 'inspection_pending',
    responsibleUserId: '019f7000-0000-7000-8000-000000000002',
    responsibleUserName: 'Pano Sorumlusu',
    insurerName: 'Sentetik Sigorta',
    serviceName: 'Sentetik Servis',
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
    openTaskCount: 1,
    overdueTaskCount: 1,
    dueTodayTaskCount: 0,
    upcomingTaskCount: 0,
    priority: 'critical',
    priorityScore: 871,
    primaryAttention: 'overdue_task',
    attentionCodes: ['overdue_task', 'overdue_follow_up', 'human_approval', 'missing_documents'],
    requiresAction: true,
  }],
}

function fetchResponse(status: number, body?: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch
}

afterEach(() => {
  window.localStorage.removeItem(DATA_SOURCE_STORAGE_KEY)
  vi.restoreAllMocks()
})

describe('dashboard data port', () => {
  it('gerçek API cevabını güvenli UI modeline dönüştürür', async () => {
    const dashboard = await createHttpDashboardAdapter({
      fetchImpl: fetchResponse(200, response),
    }).loadDashboard()

    expect(dashboard.items[0]).toMatchObject({
      type: 'Kasko',
      stage: 'Ekspertiz Bekliyor',
      followUpLabel: 'Gecikmiş · 15 Tem',
      followUpTone: 'late',
      priority: 'critical',
      responsibleUserName: 'Pano Sorumlusu',
    })
  })

  it('401, ağ ve bozuk response durumunda mock fallback yapmaz', async () => {
    await expect(
      createHttpDashboardAdapter({ fetchImpl: fetchResponse(401) }).loadDashboard(),
    ).rejects.toMatchObject({ kind: 'unauthorized' })
    await expect(
      createHttpDashboardAdapter({
        fetchImpl: vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch,
      }).loadDashboard(),
    ).rejects.toBeInstanceOf(DashboardError)
    await expect(
      createHttpDashboardAdapter({
        fetchImpl: fetchResponse(200, { ...response, items: [{ ...response.items[0], absolutePath: 'P:\\x' }] }),
      }).loadDashboard(),
    ).rejects.toMatchObject({ kind: 'unavailable' })
  })

  it('mock pano kabul edilmiş mock kayıtlarını ağ çağrısı olmadan kullanır', () => {
    const dashboard = buildMockDashboard()
    expect(dashboard.items).toHaveLength(12)
    expect(dashboard.items.some((item) => item.missingDocumentCount > 0)).toBe(true)
    expect(dashboard.items.some((item) => item.pendingHumanApprovalCount > 0)).toBe(true)
  })

  it('api hook gerçek boş cevabı korur ve başarısızlıkta mock göstermez', async () => {
    window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'api')
    const emptyResponse = {
      ...response,
      summary: Object.fromEntries(Object.keys(response.summary).map((key) => [key, 0])),
      stageCounts: stageCounts.map((item) => ({ ...item, count: 0 })),
      items: [],
    }
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(fetchResponse(200, emptyResponse) as never)
    const { result } = renderHook(() => useDashboard())
    await waitFor(() => expect(result.current.status).toBe('ok'))
    expect(result.current.dashboard?.items).toEqual([])
    expect(result.current.source).toBe('api')
    fetchSpy.mockRestore()

    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchResponse(503) as never)
    const failed = renderHook(() => useDashboard())
    await waitFor(() => expect(failed.result.current.status).toBe('unavailable'))
    expect(failed.result.current.dashboard).toBeNull()
  })
})
