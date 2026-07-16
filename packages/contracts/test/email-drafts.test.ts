import { describe, expect, it } from 'vitest'
import {
  emailDraftCreateRequestSchema,
  emailDraftHandoffResponseSchema,
  emailDraftPreviewRequestSchema,
  emailDraftPreviewResponseSchema,
} from '../src/index.js'

const id = '019f5dd6-b191-7380-afe2-95580597762f'
const hash = 'a'.repeat(64)

describe('email draft contracts', () => {
  it('preview ve create komutlarını strict doğrular', () => {
    expect(emailDraftPreviewRequestSchema.parse({
      draftType: 'missing_document_request',
    })).toEqual({
      draftType: 'missing_document_request',
      instruction: null,
    })
    expect(emailDraftCreateRequestSchema.parse({
      expectedCaseVersion: 2,
      draftType: 'missing_document_request',
      previewHash: hash,
      to: ['hasar@example.test'],
      subject: 'Eksik evrak',
      body: 'Merhaba.',
      confirmed: true,
    })).toMatchObject({
      instruction: null,
      cc: [],
      attachments: [],
      confirmed: true,
    })
    expect(() => emailDraftCreateRequestSchema.parse({
      expectedCaseVersion: 2,
      draftType: 'missing_document_request',
      previewHash: hash,
      to: [],
      subject: 'Eksik evrak',
      body: 'Merhaba.',
      confirmed: true,
    })).toThrow()
  })

  it('preview alıcıyı tahmin etmez ve yalnız doğrulanmış ek seçenekleri taşır', () => {
    const parsed = emailDraftPreviewResponseSchema.parse({
      caseId: id,
      caseVersion: 2,
      draftType: 'preliminary_report_notice',
      templateVersion: 'email-draft-template/1.0.0',
      subject: 'Ön rapor',
      body: 'Merhaba.',
      sourceRule: 'preliminary_report_notice',
      recipientStatus: 'control_required',
      recipientReason: 'Alıcı kullanıcı tarafından doğrulanmalıdır.',
      missingRequirementCodes: [],
      controlRequiredRequirementCodes: [],
      attachmentOptions: [{
        resourceType: 'document_version',
        resourceId: id,
        documentType: 'preliminary_report',
        displayName: 'Ön Rapor.pdf',
        mimeType: 'application/pdf',
        byteSize: 120,
        preferred: true,
        status: 'ready',
      }],
      previewHash: hash,
      requiresHumanReview: true,
    })
    expect(parsed.recipientStatus).toBe('control_required')
    expect(parsed.attachmentOptions[0]?.preferred).toBe(true)
  })

  it('handoff yanıtını gönderilmiş olarak işaretleyemez', () => {
    const version = {
      id,
      draftVersion: 1,
      previousVersionId: null,
      to: ['hasar@example.test'],
      cc: [],
      subject: 'Dosya',
      body: 'Merhaba.',
      attachments: [],
      templateVersion: 'email-draft-template/1.0.0',
      sourceType: 'deterministic_template',
      previewHash: hash,
      revisionReason: null,
      createdByUserId: id,
      createdByDisplayName: 'Eksper',
      createdAt: '2026-07-16T12:00:00.000Z',
    }
    const draft = {
      id,
      caseId: id,
      draftType: 'case_status_update',
      version: 1,
      currentVersion: version,
      versions: [version],
      handoffs: [{
        id,
        draftVersionId: id,
        provider: 'gmail_web',
        preparedByUserId: id,
        preparedByDisplayName: 'Eksper',
        preparedAt: '2026-07-16T12:01:00.000Z',
      }],
      createdByUserId: id,
      createdByDisplayName: 'Eksper',
      createdAt: '2026-07-16T12:00:00.000Z',
      updatedAt: '2026-07-16T12:00:00.000Z',
    }
    expect(emailDraftHandoffResponseSchema.parse({
      draft,
      handoff: draft.handoffs[0],
      compose: {
        to: version.to,
        cc: version.cc,
        subject: version.subject,
        body: version.body,
        attachments: [],
      },
      deliveryStatus: 'not_sent',
    }).deliveryStatus).toBe('not_sent')
  })
})
