import { describe, expect, it } from 'vitest'
import {
  EXPERTS_REFERENCE_ROUTE,
  INSURERS_REFERENCE_ROUTE,
  SERVICES_REFERENCE_ROUTE,
  USERS_REFERENCE_ROUTE,
  expertsReferenceResponseSchema,
  insurersReferenceResponseSchema,
  servicesReferenceResponseSchema,
  usersReferenceResponseSchema,
  servicesReferenceQuerySchema,
} from '../src/index.js'

describe('Paket 18 referans sözleşmeleri', () => {
  it('sürümlü ve ayrık route sabitleri taşır', () => {
    expect([INSURERS_REFERENCE_ROUTE, SERVICES_REFERENCE_ROUTE, USERS_REFERENCE_ROUTE, EXPERTS_REFERENCE_ROUTE]).toEqual([
      '/api/v1/references/insurers',
      '/api/v1/references/services',
      '/api/v1/references/users',
      '/api/v1/references/experts',
    ])
  })

  it('yalnız güvenli seçim metadata alanlarını kabul eder', () => {
    expect(insurersReferenceResponseSchema.parse({ items: [{ id: 'ins-1', name: 'Güven Sigorta' }] }).items).toHaveLength(1)
    expect(servicesReferenceResponseSchema.safeParse({ items: [{
      id: 'srv-1', name: 'Merkez', serviceType: 'private', isActive: true,
      agreement: {
        status: 'control_required', agreementStatus: 'control_required', serviceType: 'private', operation: 'closure_documents',
        evaluationDate: null, dateSource: 'loss_date', isAuthorized: false, isInsurerAgreed: null,
        reason: 'Anlasma kaydi bulunmuyor.', ruleVersion: '2026.07.14.1', matchedAgreementIds: [], requiresHumanReview: true,
      },
    }] }).success).toBe(true)
    expect(usersReferenceResponseSchema.safeParse({ items: [{ id: 'usr-1', displayName: 'Dosya Sorumlusu' }] }).success).toBe(true)
    expect(expertsReferenceResponseSchema.safeParse({ items: [{ id: 'usr-2', displayName: 'Eksper' }] }).success).toBe(true)
    expect(usersReferenceResponseSchema.safeParse({ items: [{ id: 'usr-1', displayName: 'Kullanıcı', email: 'secret@example.test' }] }).success).toBe(false)
  })

  it('servis sorgusunu sigortaci, LocalDate ve islem ile strict dogrular', () => {
    expect(servicesReferenceQuerySchema.parse({ insurerId: 'ins-1', evaluationDate: '2026-07-14' })).toMatchObject({
      insurerId: 'ins-1', evaluationDate: '2026-07-14', dateSource: 'loss_date', operation: 'closure_documents',
    })
    expect(servicesReferenceQuerySchema.safeParse({ evaluationDate: '2026-02-30' }).success).toBe(false)
    expect(servicesReferenceQuerySchema.safeParse({ extra: true }).success).toBe(false)
  })
})
