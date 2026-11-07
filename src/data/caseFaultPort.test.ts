import { describe, expect, it, vi } from 'vitest'
import { CaseFaultClientError, createHttpCaseFaultAdapter } from './caseFaultPort'

const record = { caseId: '019b4934-a761-7000-8000-000000000001', caseType: 'casco', insuredPercent: 25, version: 1, updatedAt: null, permissions: { canEdit: true } }
describe('fault HTTP adapter', () => {
  it('uses authenticated requests with cancellation and one authoritative percentage', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(record)))
    const port = createHttpCaseFaultAdapter({ fetchImpl })
    const signal = new AbortController().signal
    expect(await port.save(record.caseId, { insuredPercent: 25, expectedVersion: 0 }, signal)).toEqual(record)
    expect(fetchImpl).toHaveBeenCalledWith(`/api/v1/cases/${record.caseId}/fault`, expect.objectContaining({ method: 'PUT', credentials: 'include', signal, body: '{"insuredPercent":25,"expectedVersion":0}' }))
  })
  it.each([400, 401, 403, 404, 409, 500])('surfaces HTTP %s', async status => {
    const port = createHttpCaseFaultAdapter({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status })) })
    await expect(port.read(record.caseId)).rejects.toEqual(new CaseFaultClientError(status))
  })
  it('rejects malformed or inconsistent server data', async () => {
    const port = createHttpCaseFaultAdapter({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ...record, insuredPercent: 33 }))) })
    await expect(port.read(record.caseId)).rejects.toThrow()
  })
})
