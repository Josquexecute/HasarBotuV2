import { describe, expect, it } from 'vitest'
import {
  v1ImportQuarantineSchema,
  v1ImportQuarantinesQuerySchema,
  v1ImportQuarantinesResponseSchema,
} from '../src/index.js'

const item = {
  id: '11111111-1111-4111-8111-111111111111',
  sourceToken: '0123456789abcdef',
  sourceRelativePath: '2026/Mayis/SENTETIK-Q-1',
  reason: 'ambiguous_target',
  reasonCode: 'case_type_conflict',
  status: 'unresolved',
  mappingVersion: 'v1-remediation/2.3.0',
  evidenceSummary: {
    detectedCaseType: 'casco',
    resolutionReason: 'document_evidence',
    sidecarConflictPreserved: true,
    evidenceCount: 1,
    evidenceKinds: ['k_ruhsat'],
  },
  candidateCount: 1,
  candidateTargets: [{
    caseId: '22222222-2222-4222-8222-222222222222',
    caseType: 'traffic',
    officeCaseNumber: '2026/901',
    lifecycleStatus: 'open',
    createdAt: '2026-08-15T10:00:00Z',
  }],
  createdAt: '2026-08-15T10:05:00Z',
  resolution: null,
} as const

describe('V1 import quarantine reporting sozlesmesi', () => {
  it('sayfalama/filtre query degerlerini sinirlar', () => {
    expect(v1ImportQuarantinesQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 })
    expect(v1ImportQuarantinesQuerySchema.safeParse({ reason: 'ambiguous_target', status: 'unresolved', page: 2, pageSize: 5 }).success).toBe(true)
    expect(v1ImportQuarantinesQuerySchema.safeParse({ page: '1' }).success).toBe(false)
    expect(v1ImportQuarantinesQuerySchema.safeParse({ reason: 'unknown_reason' }).success).toBe(false)
  })

  it('yalniz guvenli projection alanlarini kabul eder ve raw payloadi reddeder', () => {
    expect(v1ImportQuarantineSchema.safeParse(item).success).toBe(true)
    expect(v1ImportQuarantineSchema.safeParse({ ...item, rawSnapshot: { secret: true } }).success).toBe(false)
    expect(v1ImportQuarantineSchema.safeParse({ ...item, sourceToken: 'not-a-token' }).success).toBe(false)
    expect(v1ImportQuarantinesResponseSchema.safeParse({
      items: [item], pageInfo: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
    }).success).toBe(true)
  })
})
