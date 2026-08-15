import { describe, expect, it, vi } from 'vitest'
import { createHttpV1ImportQuarantineAdapter } from './v1ImportQuarantinePort'

function response(status: number, body?: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch
}

const item = {
  id: '11111111-1111-4111-8111-111111111111', sourceToken: '0123456789abcdef',
  sourceRelativePath: '2026/Mayis/SENTETIK-Q-1', reason: 'ambiguous_target', reasonCode: 'ambiguous_target',
  status: 'unresolved', mappingVersion: 'v1-remediation/2.3.0',
  evidenceSummary: { detectedCaseType: null, resolutionReason: null, sidecarConflictPreserved: false, evidenceCount: 0, evidenceKinds: [] },
  candidateCount: 0, candidateTargets: [], createdAt: '2026-08-15T10:00:00Z', resolution: null,
}

describe('V1 quarantine HTTP adapter', () => {
  it('admin read projectionunu parse eder ve queryyi deterministik kurar', async () => {
    const fetchImpl = response(200, { items: [item], pageInfo: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 } })
    const page = await createHttpV1ImportQuarantineAdapter({ fetchImpl }).list({ page: 1, pageSize: 100, status: 'unresolved' })
    expect(page.totalItems).toBe(1)
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/v1/v1-import/quarantines?page=1&pageSize=100&status=unresolved',
      { credentials: 'include', headers: { accept: 'application/json' } },
    )
  })

  it('401/403 ayirir; raw/ekstra alanli yaniti fail-closed reddeder', async () => {
    await expect(createHttpV1ImportQuarantineAdapter({ fetchImpl: response(401) }).list({ page: 1, pageSize: 25 }))
      .rejects.toMatchObject({ kind: 'unauthorized' })
    await expect(createHttpV1ImportQuarantineAdapter({ fetchImpl: response(403) }).list({ page: 1, pageSize: 25 }))
      .rejects.toMatchObject({ kind: 'forbidden' })
    await expect(createHttpV1ImportQuarantineAdapter({
      fetchImpl: response(200, {
        items: [{ ...item, rawSnapshot: { hidden: true } }],
        pageInfo: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
      }),
    }).list({ page: 1, pageSize: 25 })).rejects.toMatchObject({ kind: 'unavailable' })
  })
})
