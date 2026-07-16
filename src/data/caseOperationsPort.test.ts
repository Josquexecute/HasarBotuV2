import { describe, expect, it, vi } from 'vitest'
import {
  CaseOperationsError,
  createHttpCaseOperationsAdapter,
} from './caseOperationsPort'

const CASE_ID = '019f7000-0000-7000-8000-000000000001'
const USER_ID = '019f7000-0000-7000-8000-000000000002'
const TASK_ID = '019f7000-0000-7000-8000-000000000003'

const note = {
  id: CASE_ID,
  noteType: 'internal',
  subject: null,
  body: 'Sentetik not.',
  createdByUserId: USER_ID,
  createdByDisplayName: 'Sentetik Kullanıcı',
  createdAt: '2026-07-16T10:00:00.000Z',
}
const task = {
  id: TASK_ID,
  title: 'Sentetik görev',
  priority: 'normal',
  status: 'open',
  assignedUserId: USER_ID,
  assignedUserDisplayName: 'Sentetik Kullanıcı',
  dueDate: '2026-07-16',
  dueStatus: 'today',
  resolutionNote: null,
  resolvedByUserId: null,
  resolvedByDisplayName: null,
  resolvedAt: null,
  version: 1,
  createdByUserId: USER_ID,
  createdByDisplayName: 'Sentetik Kullanıcı',
  createdAt: '2026-07-16T10:00:00.000Z',
  updatedAt: '2026-07-16T10:00:00.000Z',
}
const workspace = {
  caseId: CASE_ID,
  asOfDate: '2026-07-16',
  notes: [note],
  tasks: [task],
  followUpHistory: [],
  permissions: { canWrite: true, canCompleteTasks: true },
}

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('case operations HTTP adapter', () => {
  it('gerçek workspace cevabını ve idempotent komutları güvenli map eder', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(200, workspace))
      .mockResolvedValueOnce(response(201, { note }))
      .mockResolvedValueOnce(response(201, { task }))
      .mockResolvedValueOnce(response(200, { task: { ...task, status: 'completed', resolutionNote: 'Tamamlandı.', resolvedByUserId: USER_ID, resolvedByDisplayName: 'Sentetik Kullanıcı', resolvedAt: '2026-07-16T11:00:00.000Z', version: 2 } }))
    const adapter = createHttpCaseOperationsAdapter({
      fetchImpl,
      idempotencyKeyFactory: () => '019f7000-0000-7000-8000-000000000099',
    })
    expect((await adapter.load(CASE_ID)).tasks[0]?.dueStatus).toBe('today')
    await adapter.createNote(CASE_ID, { noteType: 'internal', subject: null, body: 'Sentetik not.' })
    await adapter.createTask(CASE_ID, { title: 'Sentetik görev', priority: 'normal', assignedUserId: USER_ID, dueDate: '2026-07-16' })
    await adapter.completeTask(CASE_ID, TASK_ID, 1, 'Tamamlandı.')
    for (const call of fetchImpl.mock.calls.slice(1)) {
      expect((call[1]?.headers as Record<string, string>)['idempotency-key']).toBe('019f7000-0000-7000-8000-000000000099')
    }
  })

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [400, 'validation'],
    [409, 'conflict'],
    [503, 'unavailable'],
  ] as const)('HTTP %s durumunu %s olarak verir ve mock fallback yapmaz', async (status, kind) => {
    const adapter = createHttpCaseOperationsAdapter({ fetchImpl: vi.fn().mockResolvedValue(response(status, {})) })
    await expect(adapter.load(CASE_ID)).rejects.toMatchObject({ kind })
  })

  it('ağ ve unknown alan cevabını fail-closed reddeder; kullanıcı not metnini bozmaz', async () => {
    await expect(createHttpCaseOperationsAdapter({
      fetchImpl: vi.fn().mockRejectedValue(new Error('network')),
    }).load(CASE_ID)).rejects.toBeInstanceOf(CaseOperationsError)
    await expect(createHttpCaseOperationsAdapter({
      fetchImpl: vi.fn().mockResolvedValue(response(200, { ...workspace, mockFallback: true })),
    }).load(CASE_ID)).rejects.toMatchObject({ kind: 'unavailable' })
    await expect(createHttpCaseOperationsAdapter({
      fetchImpl: vi.fn().mockResolvedValue(response(200, { ...workspace, notes: [{ ...note, body: 'P:\\müşteri' }] })),
    }).load(CASE_ID)).resolves.toMatchObject({
      notes: [{ body: 'P:\\müşteri' }],
    })
  })
})
