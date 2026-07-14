import { describe, expect, it } from 'vitest'
import {
  caseDetailParamsSchema,
  caseDetailResponseSchema,
  caseListItemSchema,
  caseListResponseSchema,
} from '../src/index.js'

const validItem = {
  id: 'case-2026-184',
  caseType: 'casco',
  officeCaseNumber: '2026/184',
  notificationFormNumber: null,
  insurerClaimNumber: null,
  plate: '34 MPA 764',
  status: 'open',
  stage: 'inspection_pending',
  responsibleUserId: 'usr-2',
  expertUserId: 'usr-expert',
  serviceId: null,
  insurerId: null,
  followUpDate: '2026-07-14',
  lossDate: '2026-07-10',
  notificationDate: '2026-07-11',
  lastInterventionAt: null,
  createdAt: '2026-07-11T08:00:00Z',
  updatedAt: '2026-07-11T09:00:00Z',
  version: 1,
}

describe('Cases DTO sozlesmeleri', () => {
  it('gecerli liste ogesini kabul eder; opsiyonel iliskiler null olabilir', () => {
    expect(caseListItemSchema.safeParse(validItem).success).toBe(true)
  })

  it('opsiyonel iliski alani eksikse reddedilir (null zorunlu, undefined degil)', () => {
    const { serviceId: _omit, ...withoutService } = validItem
    void _omit
    expect(caseListItemSchema.safeParse(withoutService).success).toBe(false)
  })

  it('strict: bilinmeyen alan reddedilir', () => {
    expect(caseListItemSchema.safeParse({ ...validItem, followUpTone: 'late' }).success).toBe(false)
  })

  it('kontrolsuz coercion yoktur: string version reddedilir', () => {
    expect(caseListItemSchema.safeParse({ ...validItem, version: '1' }).success).toBe(false)
  })

  it('gecersiz cekirdek alan reddedilir', () => {
    expect(caseListItemSchema.safeParse({ ...validItem, caseType: 'Trafik' }).success).toBe(false)
    expect(caseListItemSchema.safeParse({ ...validItem, officeCaseNumber: '2026-184' }).success).toBe(false)
  })

  it('followUpDate yalniz LocalDate kabul eder; tarih-saat reddedilir', () => {
    expect(caseListItemSchema.safeParse({ ...validItem, followUpDate: '2026-07-11T11:30:00Z' }).success).toBe(false)
    expect(caseListItemSchema.safeParse({ ...validItem, followUpDate: '2026-02-30' }).success).toBe(false)
  })

  it('id guvenli olmayan yol karakterlerini reddeder', () => {
    expect(caseListItemSchema.safeParse({ ...validItem, id: '../../etc/passwd' }).success).toBe(false)
    expect(caseListItemSchema.safeParse({ ...validItem, id: 'a'.repeat(129) }).success).toBe(false)
    expect(caseDetailParamsSchema.safeParse({ caseId: 'case..1' }).success).toBe(false)
    expect(caseDetailParamsSchema.safeParse({ caseId: 'case/1' }).success).toBe(false)
  })

  it('referans numaralari slash destekler ama backslash/kontrol reddeder', () => {
    expect(caseListItemSchema.safeParse({ ...validItem, notificationFormNumber: '11/18882475' }).success).toBe(true)
    const withBackslash = `A${String.fromCharCode(92)}B`
    expect(caseListItemSchema.safeParse({ ...validItem, insurerClaimNumber: withBackslash }).success).toBe(false)
    expect(caseListItemSchema.safeParse({ ...validItem, insurerClaimNumber: '---' }).success).toBe(false)
  })

  it('liste yaniti ogeler + pageInfo tasir', () => {
    const response = {
      items: [validItem],
      pageInfo: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
    }
    expect(caseListResponseSchema.safeParse(response).success).toBe(true)
    expect(caseListResponseSchema.safeParse({ items: [validItem] }).success).toBe(false)
  })

  it('detay param ve detay yaniti dogrular', () => {
    expect(caseDetailParamsSchema.safeParse({ caseId: 'case-2026-184' }).success).toBe(true)
    expect(caseDetailParamsSchema.safeParse({ caseId: '' }).success).toBe(false)
    expect(caseDetailResponseSchema.safeParse({ case: validItem }).success).toBe(true)
    expect(caseDetailResponseSchema.safeParse({ case: validItem, extra: 1 }).success).toBe(false)
  })
})
