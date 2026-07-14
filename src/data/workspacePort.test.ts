import { describe, expect, it, vi } from 'vitest'
import { WorkspaceCommandError, createHttpWorkspaceCommandAdapter } from './workspacePort'

const provisioning = {
  id: 'plan-1',
  caseId: 'case-1',
  storageRootKey: 'test-root',
  relativePath: '2026/Temmuz 2026/34ABC123',
  status: 'planned',
  requiredSubdirectories: ['EVRAK', 'HASAR', 'OLAY YERİ', 'ONARIM', 'DEĞER KAYBI'],
  lastErrorCode: null,
  canApprove: true,
  canRetry: false,
  approvedAt: null,
  readyAt: null,
  createdAt: '2026-07-14T09:00:00.000Z',
  updatedAt: '2026-07-14T09:00:00.000Z',
} as const

describe('HttpWorkspaceCommandAdapter', () => {
  it('yalnız aktif kökleri döner ve plan/onayda kararlı idempotency header taşır', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [
        { rootKey: 'test-root', label: 'Test', isActive: true },
        { rootKey: 'old-root', label: 'Pasif', isActive: false },
      ] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ provisioning }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ provisioning }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ provisioning: { ...provisioning, status: 'queued', canApprove: false } }), { status: 202 }))
    const adapter = createHttpWorkspaceCommandAdapter({ fetchImpl, idempotencyKeyFactory: () => 'stable-key' })
    expect(await adapter.listActiveRoots()).toEqual([{ rootKey: 'test-root', label: 'Test' }])
    expect(await adapter.readCurrentPlan('case-1')).toEqual(provisioning)
    await adapter.createPlan('case-1', 'test-root')
    await adapter.approvePlan('case-1', 'plan-1')
    expect((fetchImpl.mock.calls[2]?.[1]?.headers as Record<string, string>)['idempotency-key']).toBe('stable-key')
    expect((fetchImpl.mock.calls[3]?.[1]?.headers as Record<string, string>)['idempotency-key']).toBe('stable-key')
  })

  it('5xx/ağ hatasında mock fallback yapmaz ve güvenli unavailable hatası verir', async () => {
    const serverError = createHttpWorkspaceCommandAdapter({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 500 })) })
    await expect(serverError.listActiveRoots()).rejects.toMatchObject({ name: 'WorkspaceCommandError', kind: 'unavailable' })
    const networkError = createHttpWorkspaceCommandAdapter({ fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new Error('secret SQL P:\\müşteri')) })
    await expect(networkError.listActiveRoots()).rejects.toEqual(new WorkspaceCommandError('unavailable', 'workspace endpoint unreachable'))
  })

  it('mutlak veya traversal yol içeren API yanıtını UI sınırında reddeder', async () => {
    const adapter = createHttpWorkspaceCommandAdapter({
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ provisioning: { ...provisioning, relativePath: 'P:\\müşteri' } }), { status: 201 })),
      idempotencyKeyFactory: () => 'key',
    })
    await expect(adapter.createPlan('case-1', 'test-root')).rejects.toMatchObject({ kind: 'unavailable' })
  })
})
