import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { EmailAiDataPort, EmailAiPlanRecord, EmailAiRunRecord } from '../../data/emailAiPort'
import type { EmailDraftDataPort, EmailDraftPreviewRecord, EmailDraftRecord, EmailDraftWorkspaceRecord } from '../../data/emailDraftPort'
import { EmailDraftError } from '../../data/emailDraftPort'
import type { CaseRecord } from '../../types/case'
import { EmailDraftApiModule } from './EmailDraftApiModule'

const CASE_ID = '018f3f4c-89ab-7def-8123-456789abcdef'
const USER_ID = '018f3f4c-89ab-7def-8123-456789abcdea'
const DRAFT_ID = '018f3f4c-89ab-7def-8123-456789abcdeb'
const VERSION_ID = '018f3f4c-89ab-7def-8123-456789abcdec'
const DRAFT_A_ID = '018f3f4c-89ab-7def-8123-456789abcdd1'
const DRAFT_B_ID = '018f3f4c-89ab-7def-8123-456789abcdd2'
const HASH = 'a'.repeat(64)

const aiPlan: EmailAiPlanRecord = {
  caseId: CASE_ID,
  caseVersion: 3,
  draftType: 'preliminary_report_notice',
  providerId: 'gemini-generate-content',
  providerVersion: 'gemini-generate-content/1.0.0',
  modelId: 'gemini-2.5-flash',
  promptTemplateVersion: 'email-ai-draft/1.0.0',
  outputSchemaVersion: 'email-ai-suggestion/1.0.0',
  basePreview: {
    subject: '2026/41 · Ön Rapor Bilgilendirmesi',
    body: 'Merhaba.\n\nÖn rapor hazırlanmıştır.\n\nİyi çalışmalar.',
    previewHash: HASH,
  },
  planHash: 'b'.repeat(64),
  privacy: {
    externalProvider: true,
    policyVersion: 'email-ai-pii-redaction/1.0.0',
    outboundPayloadHash: 'c'.repeat(64),
    outboundInputCharacters: 220,
    redactedValueCount: 2,
    redactedCategories: ['email', 'name'],
    retentionMode: 'free_tier_product_improvement',
    warnings: ['user-instruction:PROMPT_INJECTION'],
  },
  budget: {
    enabled: true,
    providerAvailable: true,
    providerAllowed: true,
    estimatedCostMinor: 0,
    currentMonthCostMinor: 0,
    monthlyBudgetMinor: 100,
    perRequestBudgetMinor: 10,
    allowed: true,
    reasonCode: null,
  },
  canStart: true,
  requiresExplicitEgressConfirmation: true,
  requiresHumanReview: true,
}

const aiRun: EmailAiRunRecord = {
  id: USER_ID,
  caseId: CASE_ID,
  draftType: 'preliminary_report_notice',
  status: 'review_required',
  providerId: 'gemini-generate-content',
  providerVersion: 'gemini-generate-content/1.0.0',
  modelId: 'gemini-2.5-flash',
  promptTemplateVersion: 'email-ai-draft/1.0.0',
  outputSchemaVersion: 'email-ai-suggestion/1.0.0',
  basePreviewHash: HASH,
  planHash: 'b'.repeat(64),
  version: 2,
  privacy: aiPlan.privacy,
  budget: aiPlan.budget,
  suggestion: {
    schemaVersion: 'email-ai-suggestion/1.0.0',
    subject: '2026/41 · 34 ABC 41 · Kontrollü Ön Rapor',
    body: 'Merhaba.\n\nÖn rapor kontrollü biçimde hazırlanmıştır.',
    reasoning: 'Metin sadeleştirildi.',
    warnings: ['Alıcı kullanıcı tarafından doğrulanmalıdır.'],
    confidence: 0.84,
    requiresHumanReview: true,
  },
  safeErrorCode: null,
  createdAt: '2026-07-16T12:00:00.000Z',
  startedAt: '2026-07-16T12:00:00.000Z',
  completedAt: '2026-07-16T12:00:01.000Z',
}

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
    emailAiSuggestionRunId: null,
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

function makeDraft(id: string, subject: string): EmailDraftRecord {
  const current = {
    id: `${id}-v1`,
    draftVersion: 1,
    previousVersionId: null,
    to: ['hasar@example.test'],
    cc: [],
    subject,
    body: 'Merhaba.\n\nİyi çalışmalar.',
    attachments: [],
    templateVersion: 'email-draft-template/1.0.0' as const,
    sourceType: 'deterministic_template' as const,
    emailAiSuggestionRunId: null,
    previewHash: HASH,
    revisionReason: null,
    createdByUserId: USER_ID,
    createdByDisplayName: 'Eksper',
    createdAt: '2026-07-16T12:00:00.000Z',
  }
  return {
    id,
    caseId: CASE_ID,
    draftType: 'preliminary_report_notice',
    version: 1,
    currentVersion: current,
    versions: [current],
    handoffs: [],
    createdByUserId: USER_ID,
    createdByDisplayName: 'Eksper',
    createdAt: '2026-07-16T12:00:00.000Z',
    updatedAt: '2026-07-16T12:00:00.000Z',
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
  it('AI plan, açık egress onayı, öneri inceleme ve yalnız yerel uygulama akışını tamamlar', async () => {
    const create = vi.fn(async () => {
      const draft = buildDraft()
      const currentVersion = {
        ...draft.currentVersion,
        sourceType: 'ai_assisted' as const,
        emailAiSuggestionRunId: USER_ID,
        subject: aiRun.suggestion!.subject,
        body: aiRun.suggestion!.body,
      }
      return { ...draft, currentVersion, versions: [currentVersion] }
    })
    const port: EmailDraftDataPort = {
      load: vi.fn(async () => workspace([])),
      preview: vi.fn(async () => preview),
      create,
      revise: vi.fn(),
      prepareHandoff: vi.fn(),
    }
    const aiPort: EmailAiDataPort = {
      list: vi.fn(),
      plan: vi.fn(async () => aiPlan),
      start: vi.fn(async () => aiRun),
    }
    const user = userEvent.setup()
    render(<EmailDraftApiModule item={item} source="api" onUnauthorized={vi.fn()} port={port} aiPort={aiPort} />)
    await screen.findByText('Henüz gerçek e-posta taslağı yok.')
    await user.selectOptions(screen.getByLabelText('E-posta türü'), 'preliminary_report_notice')
    await user.click(screen.getByRole('button', { name: 'Taslağı Önizle' }))
    await user.click(screen.getByRole('button', { name: 'Gizlilik ve Bütçe Planını Göster' }))
    await screen.findByText(/2 değer/)
    expect(screen.getByText(/güvenilmeyen yönlendirme/)).toBeInTheDocument()
    const egress = screen.getByLabelText(/PII ile minimize edilen içerik özetinin/)
    expect(screen.getByRole('button', { name: 'AI Önerisini Oluştur' })).toBeDisabled()
    await user.click(egress)
    await user.click(screen.getByRole('button', { name: 'AI Önerisini Oluştur' }))
    await screen.findByText('İnsan incelemesi gerekli')
    expect(screen.getByText('Güven %84')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Öneriyi Düzenleme Alanlarına Uygula' }))
    expect(screen.getByLabelText('Konu')).toHaveValue(aiRun.suggestion?.subject)
    expect(screen.getByLabelText('Mesaj')).toHaveValue(aiRun.suggestion?.body)
    expect(screen.getByLabelText(/sürümlü taslak olarak kaydedilmesini/)).not.toBeChecked()
    expect(create).not.toHaveBeenCalled()
    expect(await screen.findByText(/Taslak henüz kaydedilmedi/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Alıcılar'), 'hasar@example.test')
    await user.click(screen.getByLabelText(/sürümlü taslak olarak kaydedilmesini/))
    await user.click(screen.getByRole('button', { name: 'Taslağı Kaydet' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith(
      CASE_ID,
      expect.objectContaining({
        emailAiSuggestionRunId: USER_ID,
        subject: aiRun.suggestion?.subject,
        body: aiRun.suggestion?.body,
      }),
    ))
  })

  it('provider kapalı planını görünür yapar ve AI çağrısı başlatmaz', async () => {
    const port: EmailDraftDataPort = {
      load: vi.fn(async () => workspace([])),
      preview: vi.fn(async () => preview),
      create: vi.fn(),
      revise: vi.fn(),
      prepareHandoff: vi.fn(),
    }
    const start = vi.fn()
    const aiPort: EmailAiDataPort = {
      list: vi.fn(),
      plan: vi.fn(async () => ({
        ...aiPlan,
        providerVersion: null,
        modelId: null,
        canStart: false,
        budget: {
          ...aiPlan.budget,
          enabled: false,
          providerAvailable: false,
          providerAllowed: false,
          allowed: false,
          reasonCode: 'AI_PROVIDER_NOT_CONFIGURED' as const,
        },
      })),
      start,
    }
    const user = userEvent.setup()
    render(<EmailDraftApiModule item={item} source="api" onUnauthorized={vi.fn()} port={port} aiPort={aiPort} />)
    await screen.findByText('Henüz gerçek e-posta taslağı yok.')
    await user.click(screen.getByRole('button', { name: 'Taslağı Önizle' }))
    await user.click(screen.getByRole('button', { name: 'Gizlilik ve Bütçe Planını Göster' }))
    expect(await screen.findByText('AI sağlayıcısı sunucuda yapılandırılmamıştır.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'AI Önerisini Oluştur' })).toBeNull()
    expect(start).not.toHaveBeenCalled()
  })

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

  it('açık taslak seçimi, ilgisiz bir yeniden yüklemede ilk taslağa mutabakatla geri dönmez', async () => {
    // Regresyon: seçim `explicitDraftId !== '' ? explicitDraftId : drafts[0].id`
    // olarak render sırasında türetilir (bkz. HB-2026-096 madde 3). Kullanıcı
    // ikinci taslağı açıkça seçtikten sonra taslak listesiyle İLGİSİZ bir
    // mutasyon (Gmail handoff) `workspace.reload()` tetikler; aynı iki taslak
    // taze nesnelerle yeniden gelse bile açık seçim ilk taslağa dönmemelidir.
    let loadCalls = 0
    const draftA = makeDraft(DRAFT_A_ID, 'Taslak A Konu')
    const draftB = makeDraft(DRAFT_B_ID, 'Taslak B Konu')
    const port: EmailDraftDataPort = {
      load: vi.fn(async () => { loadCalls += 1; return workspace([draftA, draftB]) }),
      preview: vi.fn(),
      create: vi.fn(),
      revise: vi.fn(),
      prepareHandoff: vi.fn(async () => ({
        draft: draftB,
        handoff: {
          id: USER_ID,
          draftVersionId: draftB.currentVersion.id,
          provider: 'gmail_web' as const,
          preparedByUserId: USER_ID,
          preparedByDisplayName: 'Eksper',
          preparedAt: '2026-07-16T12:02:00.000Z',
        },
        compose: {
          to: draftB.currentVersion.to,
          cc: draftB.currentVersion.cc,
          subject: draftB.currentVersion.subject,
          body: draftB.currentVersion.body,
          attachments: draftB.currentVersion.attachments,
        },
        deliveryStatus: 'not_sent' as const,
      })),
    }
    const openExternal = vi.fn(() => ({}))
    const user = userEvent.setup()
    render(<EmailDraftApiModule item={item} source="api" onUnauthorized={vi.fn()} port={port} openExternal={openExternal} />)

    expect(await screen.findByRole('heading', { name: 'Taslak A Konu' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Taslak B Konu/ }))
    expect(await screen.findByRole('heading', { name: 'Taslak B Konu' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Taslak A Konu' })).not.toBeInTheDocument()

    const loadCallsBeforeHandoff = loadCalls
    await user.click(screen.getByLabelText(/harici veri çıkışını onaylıyorum/))
    await user.click(screen.getByRole('button', { name: 'Gmail Taslağını Aç' }))
    await waitFor(() => expect(loadCalls).toBeGreaterThan(loadCallsBeforeHandoff))

    expect(await screen.findByRole('heading', { name: 'Taslak B Konu' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Taslak A Konu' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Taslak B Konu/ })).toHaveClass('is-active')
  })
})
