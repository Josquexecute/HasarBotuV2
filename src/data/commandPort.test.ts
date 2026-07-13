import { describe, expect, it, vi } from 'vitest'
import {
  CaseCommandError,
  createHttpCaseCommandAdapter,
  createMockCaseCommandAdapter,
  type CaseCommandErrorKind,
} from './commandPort'

const CASE_DTO = {
  id: 'case-1',
  caseType: 'casco' as const,
  officeCaseNumber: '2026/1',
  notificationFormNumber: 'F-1',
  insurerClaimNumber: null,
  plate: '34 SMK 909',
  status: 'open' as const,
  stage: 'new_notification',
  followUpDate: null,
  updatedAt: '2026-07-13T09:00:00.000Z',
  version: 1,
}

function respond(status: number, body?: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch
}

describe('HttpCaseCommandAdapter createCase', () => {
  it('201 -> CaseRecord; zorunlu Idempotency-Key basligini gonderir', async () => {
    const fetchImpl = respond(201, { case: CASE_DTO })
    const adapter = createHttpCaseCommandAdapter({
      baseUrl: 'http://api.test',
      fetchImpl,
      idempotencyKeyFactory: () => 'fixed-key-123',
    })
    const record = await adapter.createCase({ caseType: 'casco', plate: '34 SMK 909' })
    expect(record).toMatchObject({ caseId: 'case-1', plate: '34 SMK 909', type: 'Kasko', officeNumber: '2026/1' })
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://api.test/api/v1/cases',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({ 'idempotency-key': 'fixed-key-123' }),
      }),
    )
  })

  it.each([
    [401, undefined, 'unauthorized'],
    [409, { error: { code: 'idempotency_conflict' } }, 'idempotency_conflict'],
    [400, { error: { code: 'validation_error', fieldErrors: [{ code: 'unknown_reference' }] } }, 'unknown_reference'],
    [400, { error: { code: 'validation_error', fieldErrors: [{ code: 'invalid' }] } }, 'validation'],
    [503, undefined, 'unavailable'],
  ] as [number, unknown, CaseCommandErrorKind][])('HTTP %s -> %s', async (status, body, kind) => {
    const adapter = createHttpCaseCommandAdapter({ fetchImpl: respond(status, body) })
    await expect(adapter.createCase({ caseType: 'traffic', plate: '34 AAA 111' })).rejects.toMatchObject({
      name: 'CaseCommandError',
      kind,
    })
  })

  it('ag hatasi -> unavailable', async () => {
    const netFail = vi.fn().mockRejectedValue(new TypeError('down')) as unknown as typeof fetch
    await expect(
      createHttpCaseCommandAdapter({ fetchImpl: netFail }).createCase({ caseType: 'casco', plate: '34 A 1' }),
    ).rejects.toBeInstanceOf(CaseCommandError)
  })
})

describe('HttpCaseCommandAdapter updateCase', () => {
  it('200 -> CaseRecord; PATCH ve expectedVersion govdesi', async () => {
    const fetchImpl = respond(200, { case: { ...CASE_DTO, version: 2 } })
    const adapter = createHttpCaseCommandAdapter({ baseUrl: 'http://api.test', fetchImpl })
    const record = await adapter.updateCase('case-1', { expectedVersion: 1, notificationFormNumber: 'F-2' })
    expect(record.caseId).toBe('case-1')
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://api.test/api/v1/cases/case-1',
      expect.objectContaining({
        method: 'PATCH',
        credentials: 'include',
        body: JSON.stringify({ expectedVersion: 1, notificationFormNumber: 'F-2' }),
      }),
    )
  })

  it.each([
    [401, undefined, 'unauthorized'],
    [404, undefined, 'not_found'],
    [409, { error: { code: 'version_conflict' } }, 'version_conflict'],
  ] as [number, unknown, CaseCommandErrorKind][])('HTTP %s -> %s', async (status, body, kind) => {
    const adapter = createHttpCaseCommandAdapter({ fetchImpl: respond(status, body) })
    await expect(adapter.updateCase('case-1', { expectedVersion: 1 })).rejects.toMatchObject({ kind })
  })
})

describe('MockCaseCommandAdapter', () => {
  it('demo modda gercek yazma yapmaz: her komut reddedilir', async () => {
    const adapter = createMockCaseCommandAdapter()
    await expect(adapter.createCase({ caseType: 'casco', plate: '34 A 1' })).rejects.toBeInstanceOf(CaseCommandError)
    await expect(adapter.updateCase('case-1', { expectedVersion: 1 })).rejects.toBeInstanceOf(CaseCommandError)
  })
})
