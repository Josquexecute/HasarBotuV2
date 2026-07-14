import { describe, expect, it, vi } from 'vitest'
import { createHttpReferenceDataAdapter, ReferenceDataError } from './referenceHttpAdapter'

function fetchSequence(statuses: readonly { status: number; body?: unknown }[]): typeof fetch {
  const mock = vi.fn()
  for (const item of statuses) {
    mock.mockResolvedValueOnce({
      ok: item.status >= 200 && item.status < 300,
      status: item.status,
      json: async () => item.body,
    })
  }
  return mock as unknown as typeof fetch
}

describe('Paket 18 referans HttpApiAdapter', () => {
  it('dört gerçek endpoint sonucunu tek çalışma alanında birleştirir', async () => {
    const fetchImpl = fetchSequence([
      { status: 200, body: { items: [{ id: 'ins-1', name: 'Sigorta' }] } },
      { status: 200, body: { items: [{ id: 'srv-1', name: 'Servis', centerType: 'ozel' }] } },
      { status: 200, body: { items: [{ id: 'usr-1', displayName: 'Sorumlu' }] } },
      { status: 200, body: { items: [{ id: 'exp-1', displayName: 'Eksper' }] } },
    ])
    const result = await createHttpReferenceDataAdapter({ baseUrl: 'http://api.test', fetchImpl }).getCaseReferences()
    expect(result).toEqual({
      insurers: [{ id: 'ins-1', name: 'Sigorta' }],
      services: [{ id: 'srv-1', name: 'Servis', centerType: 'ozel' }],
      users: [{ id: 'usr-1', displayName: 'Sorumlu' }],
      experts: [{ id: 'exp-1', displayName: 'Eksper' }],
    })
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  it('401 ve ağ/5xx durumlarında mock fallback üretmez', async () => {
    await expect(createHttpReferenceDataAdapter({ fetchImpl: fetchSequence([{ status: 401 }, { status: 200, body: { items: [] } }, { status: 200, body: { items: [] } }, { status: 200, body: { items: [] } }]) }).getCaseReferences()).rejects.toMatchObject({ kind: 'unauthorized' })
    const network = vi.fn().mockRejectedValue(new TypeError('offline')) as unknown as typeof fetch
    await expect(createHttpReferenceDataAdapter({ fetchImpl: network }).getCaseReferences()).rejects.toBeInstanceOf(ReferenceDataError)
  })

  it('contract dışı hassas/ek alan taşıyan cevabı DataPort sınırında reddeder', async () => {
    const fetchImpl = fetchSequence([
      { status: 200, body: { items: [{ id: 'ins-1', name: 'Sigorta', secret: 'sızmamalı' }] } },
      { status: 200, body: { items: [] } },
      { status: 200, body: { items: [] } },
      { status: 200, body: { items: [] } },
    ])
    await expect(createHttpReferenceDataAdapter({ fetchImpl }).getCaseReferences()).rejects.toMatchObject({ kind: 'unavailable' })
  })
})
