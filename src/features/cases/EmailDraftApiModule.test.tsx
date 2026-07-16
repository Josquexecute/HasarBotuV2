import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type {
  EmailDraftDataPort,
  EmailDraftPreviewRecord,
  EmailDraftRecord,
  EmailDraftWorkspaceRecord,
} from '../../data'
import { EmailDraftError } from '../../data'
import type { CaseRecord } from '../../types/case'
import { EmailDraftApiModule } from './EmailDraftApiModule'

const CASE_ID = '018f3f4c-89ab-7def-8123-456789abcdef'
const USER_ID = '018f3f4c-89ab-7def-8123-456789abcdea'
const DRAFT_ID = '018f3f4c-89ab-7def-8123-456789abcdeb'
const VERSION_ID = '018f3f4c-89ab-7def-8123-456789abcdec'
const HASH = 'a'.repeat(64)

const item: CaseRecord = {
  caseId: CASE_ID,
  plate: '34 ABC 41',
  officeNumber: '2026/41',
  noticeNumber: 'İHB-41',
  claimNumber: 'HSR-41',
  company: 'Sentetik Sigorta',
  type: 'Trafik',
  status: 'Açık',
  stage: 'Raporlama',
  missingDocuments: 1,
  assignee: 'Sorumlu',
  expert: 'Eksper',
  service: 'Servis',
  followUp: 'Bugün',
  followUpTone: 'today',
  lastAction: 'Bugün',
  vehicle: '—',
  insured: '—',
  estimatedDamage: 0,
  notes: [],
  version: 3,
  lifecycleStatus: 'open',
  workflowStage: 'reporting',
}

const preview: EmailDraftPreviewRecord = {
  caseId: CASE_ID,
  caseVersion: 3,
  draftType: 'preliminary_report_notice',
  templateVersion: 'email-draft-template/1.0.0',
  subject: '2026/41 · Ön Rapor Bilgilendirmesi',
  body: 'Merhaba.\n\nÖn rapor hazırlanmıştır.\n\nİyi çalışmalar.',
  sourceRule: 'preliminary_report_notice',
  recipientStatus: 'control_required',
  recipientReason: 'Alıcı kullanıcı tarafından doğrulanmalıdır.',
  missingRequirementCodes: [],
  controlRequiredRequirementCodes: [],
  attachmentOptions: [{
    resourceType: 'document_version',
    resourceId: VERSION_ID,
    documentType: 'preliminary_report',
    displayName: 'Sentetik Ön Rapor.pdf',
    mimeType: 'application/pdf',
    byteSize: 256,
    preferred: true,
    status: 'ready',
  }],
  previewHash: HASH,
  requiresHumanReview: true,
}

function buildDraft(version = 1): EmailDraftRecord {
  const current = {
    id: version === 1 ? VERSION_ID : `${VERSION_ID.slice(0, -1)}d`,
    draftVersion: version,
    previousVersionId: version === 1 ? null : VERSION_ID,
    to: ['hasar@example.test'],
    cc: [],
    subject: preview.subject,
    body: preview.body,
    attachments: [{
      resourceType: 'document_version' as const,
      resourceId: VERSION_ID,
      documentType: 'preliminary_report',
      displayName: 'Sentetik Ön Rapor.pdf',
      mimeType: 'application/pdf',
      byteSize: 256,
      status: 'ready' as const,
    }],
    templateVersion: 'email-draft-template/1.0.0' as const,
    sourceType: version === 1 ? 'deterministic_template' as const : 'manual_revision' as const,
    previewHash: HASH,
    revisionReason: version === 1 ? null : 'Kullanıcı düzeltmesi.',
    createdByUserId: USER_ID,
    createdByDisplayName: 'Eksper',
    createdAt: `2026-07-16T12:0${version}:00.000Z`,
  }
  return {
    id: DRAFT_ID,
    caseId: CASE_ID,
    draftType: 'preliminary_report_notice',
    version,
    currentVersion: current,
    versions: version === 1 ? [current] : [current, buildDraft(1).currentVersion],
    handoffs: [],
    createdByUserId: USER_ID,
    createdByDisplayName: 'Eksper',
    createdAt: '2026-07-16T12:00:00.000Z',
    updatedAt: `2026-07-16T12:0${version}:00.000Z`,
  }
}

function workspace(drafts: readonly EmailDraftRecord[]): EmailDraftWorkspaceRecord {
  return {
    caseId: CASE_ID,
    lifecycleStatus: 'open',
    drafts: [...drafts],
    permissions: { canWrite: true, canPrepareHandoff: true },
  }
}

describe('EmailDraftApiModule', () => {
  it('preview, açık onay, sürümlü kayıt ve Gmail not-sent handoff akışını tamamlar', async () => {
    let savedDrafts: EmailDraftRecord[] = []
    const create = vi.fn(async () => {
      const draft = buildDraft()
      savedDrafts = [draft]
      return draft
    })
    const prepareHandoff = vi.fn(async () => {
      const draft = savedDrafts[0]!
      return {
        draft,
        handoff: {
          id: USER_ID,
          draftVersionId: draft.currentVersion.id,
          provider: 'gmail_web' as const,
          preparedByUserId: USER_ID,
          preparedByDisplayName: 'Eksper',
          preparedAt: '2026-07-16T12:02:00.000Z',
        },
        compose: {
          to: draft.currentVersion.to,
          cc: draft.currentVersion.cc,
          subject: draft.currentVersion.subject,
          body: draft.currentVersion.body,
          attachments: draft.currentVersion.attachments,
        },
        deliveryStatus: 'not_sent' as const,
      }
    })
    const port: EmailDraftDataPort = {
      load: vi.fn(async () => workspace(savedDrafts)),
      preview: vi.fn(async () => preview),
      create,
      revise: vi.fn(),
      prepareHandoff,
    }
    const openExternal = vi.fn(() => ({}))
    const user = userEvent.setup()
    render(<EmailDraftApiModule item={item} source="api" onUnauthorized={vi.fn()} port={port} openExternal={openExternal} />)

    await screen.findByText('Henüz gerçek e-posta taslağı yok.')
    await user.selectOptions(screen.getByLabelText('E-posta türü'), 'preliminary_report_notice')
    await user.click(screen.getByRole('button', { name: 'Taslağı Önizle' }))
    await screen.findByText(/Alıcı otomatik tahmin edilmedi/)
    expect(screen.getByRole('checkbox', { name: /Sentetik Ön Rapor\.pdf/ })).toBeChecked()
    await user.type(screen.getByLabelText('Alıcılar'), 'hasar@example.test')
    const save = screen.getByRole('button', { name: 'Taslağı Kaydet' })
    expect(save).toBeDisabled()
    await user.click(screen.getByLabelText(/sürümlü taslak olarak kaydedilmesini/))
    await user.click(save)
    await waitFor(() => expect(create).toHaveBeenCalledWith(
      CASE_ID,
      expect.objectContaining({
        expectedCaseVersion: 3,
        to: ['hasar@example.test'],
        attachments: [{ resourceType: 'document_version', resourceId: VERSION_ID }],
        confirmed: true,
      }),
    ))
    await screen.findByText('Gönderilmedi')
    await user.click(screen.getByLabelText(/harici veri çıkışını onaylıyorum/))
    await user.click(screen.getByRole('button', { name: 'Gmail Taslağını Aç' }))
    await waitFor(() => expect(prepareHandoff).toHaveBeenCalledWith(CASE_ID, DRAFT_ID, 1))
    expect(openExternal).toHaveBeenCalledWith(expect.stringContaining('https://mail.google.com/mail/'))
    expect(await screen.findByText(/gönderim uygulama tarafından doğrulanmadı/)).toBeInTheDocument()
    expect(screen.getByText(/Gmail’de manuel ekleyin/)).toBeInTheDocument()
  })

  it('düzeltmeyi mevcut sürümü ezmeden yeni sürüm olarak gönderir', async () => {
    let savedDrafts = [buildDraft()]
    const revise = vi.fn(async () => {
      const next = buildDraft(2)
      savedDrafts = [next]
      return next
    })
    const port: EmailDraftDataPort = {
      load: vi.fn(async () => workspace(savedDrafts)),
      preview: vi.fn(),
      create: vi.fn(),
      revise,
      prepareHandoff: vi.fn(),
    }
    const user = userEvent.setup()
    render(<EmailDraftApiModule item={item} source="api" onUnauthorized={vi.fn()} port={port} />)
    await screen.findByText('Gönderilmedi')
    await user.click(screen.getByRole('button', { name: 'Yeni Sürüm Düzenle' }))
    await user.clear(screen.getByLabelText('Düzeltme gerekçesi'))
    await user.type(screen.getByLabelText('Düzeltme gerekçesi'), 'Kullanıcı düzeltmesi.')
    await user.click(screen.getByLabelText(/Önceki sürüm korunarak/))
    await user.click(screen.getByRole('button', { name: 'Yeni Sürümü Kaydet' }))
    await waitFor(() => expect(revise).toHaveBeenCalledWith(
      CASE_ID,
      DRAFT_ID,
      expect.objectContaining({ expectedVersion: 1, reason: 'Kullanıcı düzeltmesi.' }),
    ))
    expect(await screen.findByText(/Taslak sürüm 2 oluşturuldu/)).toBeInTheDocument()
  })

  it('API kesintisinde mock taslak göstermez', async () => {
    const port: EmailDraftDataPort = {
      load: vi.fn(async () => { throw new EmailDraftError('unavailable', 'offline') }),
      preview: vi.fn(),
      create: vi.fn(),
      revise: vi.fn(),
      prepareHandoff: vi.fn(),
    }
    render(<EmailDraftApiModule item={item} source="api" onUnauthorized={vi.fn()} port={port} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('mock taslak gösterilmedi')
    expect(screen.queryByText(/Bu metin yalnız UI prototipidir/)).toBeNull()
  })
})
