import { describe, expect, it } from 'vitest'
import {
  CASE_WORKSPACE_APPROVE_ROUTE,
  CASE_WORKSPACE_PLAN_ROUTE,
  CASE_WORKSPACE_PLANS_ROUTE,
  jobPayloadSchema,
  workspacePlanRequestSchema,
  workspaceProvisioningResponseSchema,
} from '../src/index.js'

describe('workspace provisioning contracts', () => {
  it('route ve plan komutu tenant kapsamlı vaka yolundadır', () => {
    expect(CASE_WORKSPACE_PLANS_ROUTE).toBe('/api/v1/cases/:caseId/workspace-plans')
    expect(CASE_WORKSPACE_PLAN_ROUTE).toContain(':planId')
    expect(CASE_WORKSPACE_APPROVE_ROUTE.endsWith('/:planId/approve')).toBe(true)
    expect(workspacePlanRequestSchema.parse({ storageRootKey: 'test-root' })).toEqual({ storageRootKey: 'test-root' })
    expect(workspacePlanRequestSchema.safeParse({ storageRootKey: 'P:\\müşteri' }).success).toBe(false)
  })

  it('provisioning payload yalnız güvenli göreli metadata taşır', () => {
    const payload = jobPayloadSchema.parse({
      storageRootKey: 'test-root',
      relativePath: '2026/Temmuz 2026/34ABC123',
      kind: 'workspace',
      requiredSubdirectories: ['EVRAK', 'HASAR', 'OLAY YERİ', 'ONARIM', 'DEĞER KAYBI'],
    })
    expect(payload.kind).toBe('workspace')
    expect(JSON.stringify(payload)).not.toMatch(/[A-Za-z]:[\\/]/)
  })

  it('durum yanıtı aşamaları ve güvenli özeti doğrular', () => {
    const value = workspaceProvisioningResponseSchema.parse({
      provisioning: {
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
      },
    })
    expect(value.provisioning.relativePath).not.toContain('P:')
  })
})
