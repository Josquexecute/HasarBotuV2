import { describe, expect, it } from 'vitest'
import { evaluateServiceEligibility, type InsurerServiceAgreementFact } from '../src/index.js'

const active: InsurerServiceAgreementFact = {
  id: '00000000-0000-4000-8000-000000000001',
  insurerId: 'insurer-a',
  status: 'active',
  effectiveFrom: '2026-01-01',
  effectiveTo: '2026-12-31',
  supportedOperations: ['closure_documents'],
  humanApproved: true,
}

function evaluate(overrides: Partial<Parameters<typeof evaluateServiceEligibility>[0]> = {}) {
  return evaluateServiceEligibility({
    serviceType: 'private',
    insurerId: 'insurer-a',
    evaluationDate: '2026-07-14',
    dateSource: 'loss_date',
    operation: 'closure_documents',
    agreements: [active],
    ...overrides,
  })
}

describe('sigortaciya ozel servis uygunlugu', () => {
  it('ayni servisi sigortaci, tarih ve islem kapsaminda deterministik degerlendirir', () => {
    expect(evaluate()).toMatchObject({ status: 'eligible', agreementStatus: 'agreed', isInsurerAgreed: true })
    expect(evaluate({ insurerId: 'insurer-b' })).toMatchObject({ status: 'control_required', isInsurerAgreed: null })
    expect(evaluate()).toEqual(evaluate())
  })

  it('tarih disindaki veya acikca pasif anlasmayi uygun saymaz', () => {
    expect(evaluate({ evaluationDate: '2027-01-01' })).toMatchObject({ status: 'not_eligible', agreementStatus: 'not_agreed' })
    expect(evaluate({ agreements: [{ ...active, status: 'inactive' }] })).toMatchObject({ status: 'not_eligible' })
  })

  it('insan onayi ve tarih yoksa kontrol gerektirir', () => {
    expect(evaluate({ agreements: [{ ...active, humanApproved: false }] })).toMatchObject({ status: 'control_required' })
    expect(evaluate({ evaluationDate: null })).toMatchObject({ status: 'control_required' })
  })

  it('yetkili servisi uygun sayar ama sigortaci anlasmasi olarak etiketlemez', () => {
    expect(evaluate({ serviceType: 'authorized', agreements: [] })).toMatchObject({
      status: 'eligible', agreementStatus: 'control_required', isAuthorized: true, isInsurerAgreed: null,
    })
  })
})
