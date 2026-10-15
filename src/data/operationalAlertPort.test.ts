import { describe, expect, it, vi } from 'vitest'
import {
  DASHBOARD_ALERT_PREVIEW_LIMIT,
  countOperationalAlertsByType,
  createHttpOperationalAlertAdapter,
  type OperationalAlertRecord,
} from './operationalAlertPort'

const CASE_ID = '11111111-1111-4111-8111-111111111111'

it('opts in to the full count and retains the exact case filter', async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ schemaVersion: 'operational-alert/1.0.0',totalCount: 245,evaluatedAt: '2026-10-15T00:00:00.000Z',alerts: [] }))
  const adapter = createHttpOperationalAlertAdapter({ fetchImpl })
  expect((await adapter.list()).totalCount).toBe(245)
  expect(fetchImpl.mock.calls[0]?.[0]).toBe('/api/v1/operational-alerts?includeTotal=true&unreadOnly=true')
  await adapter.list([CASE_ID])
  expect(fetchImpl.mock.calls[1]?.[0]).toBe(`/api/v1/operational-alerts?includeTotal=true&caseIds=${CASE_ID}`)
})
it('acknowledges all alerts on the server and reports failures', async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(new Response(null, { status: 401 }))
  const adapter = createHttpOperationalAlertAdapter({ fetchImpl })
  await adapter.markAllRead!()
  expect(fetchImpl).toHaveBeenCalledWith('/api/v1/operational-alerts/read-all', expect.objectContaining({ method: 'POST', credentials: 'include' }))
  await expect(adapter.markAllRead!()).rejects.toMatchObject({ kind: 'unauthorized' })
})

function alert(overrides: Partial<OperationalAlertRecord> = {}): OperationalAlertRecord {
  return {
    dedupeKey: `overdue_task:${CASE_ID}:task-1`,
    type: 'overdue_task',
    severity: 'high',
    caseId: CASE_ID,
    plate: '34 P 4951',
    officeNumber: '2026/4951',
    summary: 'Süresi geçmiş görev: Servisten onay al',
    sourceDate: '2026-07-12',
    caseDetailPath: `/dosyalar/${CASE_ID}`,
    ...overrides,
  }
}

describe('countOperationalAlertsByType', () => {
  it('üç uyarı türünü ayrı ayrı sayar', () => {
    expect(countOperationalAlertsByType([
      alert({ dedupeKey: 'a', type: 'overdue_task' }),
      alert({ dedupeKey: 'b', type: 'overdue_task' }),
      alert({ dedupeKey: 'c', type: 'overdue_follow_up' }),
      alert({ dedupeKey: 'd', type: 'missing_required_document' }),
    ])).toEqual({
      overdue_task: 2,
      overdue_follow_up: 1,
      missing_required_document: 1,
    })
  })

  it('boş listede bütün türler sıfırdır', () => {
    expect(countOperationalAlertsByType([])).toEqual({
      overdue_task: 0,
      overdue_follow_up: 0,
      missing_required_document: 0,
    })
  })

  it('tür sayılarının toplamı liste uzunluğuna eşittir', () => {
    const alerts = [
      alert({ dedupeKey: 'a' }),
      alert({ dedupeKey: 'b', type: 'overdue_follow_up' }),
      alert({ dedupeKey: 'c', type: 'missing_required_document' }),
    ]
    const counts = countOperationalAlertsByType(alerts)
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0)
    expect(total).toBe(alerts.length)
  })

  it('pano önizleme sınırı ayrıntılı liste render etmeyi engelleyecek kadar küçüktür', () => {
    expect(DASHBOARD_ALERT_PREVIEW_LIMIT).toBe(3)
  })
})
