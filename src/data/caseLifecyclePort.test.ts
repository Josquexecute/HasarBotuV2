import { describe, expect, it, vi } from 'vitest'
import { LifecycleCommandError, createHttpCaseLifecycleCommandAdapter } from './caseLifecyclePort'

const operation = {
  id: 'operation-1', caseId: 'case-1', operationType: 'close', status: 'approval_required', version: 1,
  source: { storageRootKey: 'test-root', relativePath: '2026/Temmuz 2026/34ABC123' },
  destination: { storageRootKey: 'test-root', relativePath: '2026/Temmuz 2026/KAPALI TEMMUZ 2026/34ABC123' },
  closeMode: 'normal', reason: null, targetWorkflowStage: 'closed',
  requirementSummary: { documentRuleVersion: '2026.07.14.1', closureRuleVersion: '2026.07.14.1', missingCount: 0,
    controlRequiredCount: 0, requirements: [] },
  blockers: [], warnings: [], linkedFileOperation: null, failureReasonCode: null, canApprove: true, canCancel: true,
} as const

describe('HttpCaseLifecycleCommandAdapter', () => {
  it('konum surumunu okur, close plan ve approve isteklerinde kararlı idempotency header taşır', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ location: { version: 3, relativePath: '2026/Temmuz 2026/34ABC123' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ operation }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ operation: { ...operation, status: 'queued', version: 2, canApprove: false } }), { status: 202 }))
    const adapter = createHttpCaseLifecycleCommandAdapter({ fetchImpl, idempotencyKeyFactory: () => 'stable-key' })
    expect(await adapter.readLocationVersion('case-1')).toBe(3)
    const planned = await adapter.planClose('case-1', { expectedCaseVersion: 2, expectedLocationVersion: 3, closeMode: 'normal' })
    await adapter.approve('case-1', planned)
    expect((fetchImpl.mock.calls[1]?.[1]?.headers as Record<string, string>)['idempotency-key']).toBe('stable-key')
    expect((fetchImpl.mock.calls[2]?.[1]?.headers as Record<string, string>)['idempotency-key']).toBe('stable-key')
  })

  it('403 ve ağ hatasını güvenli verir; mutlak response yolunu reddeder ve mock fallback yapmaz', async () => {
    const forbidden = createHttpCaseLifecycleCommandAdapter({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 403 })) })
    await expect(forbidden.readLocationVersion('case-1')).rejects.toMatchObject({ kind: 'forbidden' })
    const network = createHttpCaseLifecycleCommandAdapter({ fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new Error('secret P:\\müşteri')) })
    await expect(network.readLocationVersion('case-1')).rejects.toEqual(new LifecycleCommandError('unavailable', 'lifecycle endpoint unreachable'))
    const unsafe = createHttpCaseLifecycleCommandAdapter({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ operation: {
      ...operation, destination: { storageRootKey: 'test-root', relativePath: 'P:\\müşteri' },
    } }), { status: 201 })), idempotencyKeyFactory: () => 'key' })
    await expect(unsafe.planClose('case-1', { expectedCaseVersion: 1, expectedLocationVersion: 1, closeMode: 'normal' }))
      .rejects.toMatchObject({ kind: 'unavailable' })
  })
})
