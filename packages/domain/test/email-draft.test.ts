import { describe, expect, it } from 'vitest'
import {
  EMAIL_DRAFT_TEMPLATE_VERSION,
  buildEmailDraftTemplate,
  buildGmailComposeUrl,
  validateEmailRecipients,
} from '../src/index.js'

describe('email draft domain', () => {
  it('aynı girdide deterministik eksik evrak taslağı üretir', () => {
    const input = {
      draftType: 'missing_document_request' as const,
      officeNumber: '2026/41',
      plate: '34 PK 041',
      caseType: 'traffic' as const,
      missingRequirementCodes: ['traffic_victim_policy', 'ktt'],
      instruction: 'KTT özellikle kontrol edilsin.',
    }
    const first = buildEmailDraftTemplate(input)
    const second = buildEmailDraftTemplate(input)
    expect(first).toEqual(second)
    expect(first.templateVersion).toBe(EMAIL_DRAFT_TEMPLATE_VERSION)
    expect(first.subject).toContain('Eksik Evrak Talebi')
    expect(first.body).toContain('- Kaza Tespit Tutanağı')
    expect(first.body).toContain('Ek kullanıcı notu')
    expect(first.requiresHumanReview).toBe(true)
  })

  it('kullanıcı talimatını sınırlar ve otomatik kesin karar üretmez', () => {
    const result = buildEmailDraftTemplate({
      draftType: 'pert_evaluation_notice',
      officeNumber: '2026/42',
      plate: '06 PK 042',
      caseType: 'casco',
    })
    expect(result.body).toContain('kesin karar değildir')
    expect(result.suggestedDocumentTypes).toContain('sbm_heavy_damage_result')
  })

  it('alıcıları normalize eder, tekrar ve geçersiz adresi reddeder', () => {
    expect(validateEmailRecipients([' Hasar@Example.Test '], ['EKSPER@example.test'])).toEqual({
      valid: true,
      normalizedTo: ['hasar@example.test'],
      normalizedCc: ['eksper@example.test'],
      reasonCode: 'ok',
    })
    expect(validateEmailRecipients([], [])).toMatchObject({ valid: false, reasonCode: 'to_required' })
    expect(validateEmailRecipients(['x'], [])).toMatchObject({ valid: false, reasonCode: 'invalid_address' })
    expect(validateEmailRecipients(['a@example.test'], ['A@example.test'])).toMatchObject({
      valid: false,
      reasonCode: 'duplicate_address',
    })
  })

  it('Gmail compose URL değerlerini güvenli URL parametreleriyle üretir', () => {
    const value = buildGmailComposeUrl({
      to: ['hasar@example.test'],
      cc: ['eksper@example.test'],
      subject: '2026/41 · Dosya',
      body: 'Merhaba,\n\nKontrol.',
    })
    expect(value).toMatch(/^https:\/\/mail\.google\.com\/mail\/\?/)
    expect(value).toContain('to=hasar%40example.test')
    expect(value).toContain('cc=eksper%40example.test')
    expect(value).toContain(`su=${encodeURIComponent('2026/41 · Dosya')}`)
    expect(value).toContain(`body=${encodeURIComponent('Merhaba,\n\nKontrol.')}`)
  })
})
