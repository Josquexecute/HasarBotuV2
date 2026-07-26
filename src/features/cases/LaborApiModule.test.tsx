import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { LaborAiDataPort, LaborAiPlanRecord, LaborAiRunRecord } from '../../data/laborAiPort'
import type { LaborDictionaryDataPort } from '../../data/laborDictionaryPort'
import type { LaborDataPort, LaborSheetRecord, LaborSheetWorkspaceRecord } from '../../data/laborPort'
import type { CaseRecord } from '../../types/case'
import { LaborApiModule } from './LaborApiModule'

const CASE_ID = '018f3f4c-89ab-7def-8123-456789abcdef'
const USER_ID = '018f3f4c-89ab-7def-8123-456789abcdea'
const SHEET_ID = '018f3f4c-89ab-7def-8123-456789abcdeb'
const VERSION_ID = '018f3f4c-89ab-7def-8123-456789abcdec'

const item: CaseRecord = {
  caseId: CASE_ID,
  plate: '34 ABC 43',
  officeNumber: '2026/43',
  noticeNumber: 'İHB-43',
  claimNumber: 'HSR-43',
  company: 'Sentetik Sigorta',
  type: 'Trafik',
  status: 'Açık',
  stage: 'Raporlama',
  missingDocuments: 0,
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

const sheet: LaborSheetRecord = {
  id: SHEET_ID,
  caseId: CASE_ID,
  version: 1,
  currentVersion: {
    id: VERSION_ID,
    sheetVersion: 1,
    previousVersionId: null,
    // Paket 56 öncesi sürümler kanıt alanlarını null olarak okur.
    items: [{ ordinal: 1, description: 'Ön tampon kaplama', action: 'Değişim', partAmountMinor: 18_400_00, laborAmountMinor: 2_200_00, partCode: null, partCodeSource: null, damageRegion: null }],
    totals: { partTotalMinor: 18_400_00, laborTotalMinor: 2_200_00, grandTotalMinor: 20_600_00 },
    schemaVersion: 'labor-sheet/1.0.0',
    currency: 'TRY',
    sourceType: 'user_entered',
    laborAiSuggestionRunId: null,
    revisionReason: null,
    createdByUserId: USER_ID,
    createdByDisplayName: 'P43 Yetkili',
    createdAt: '2026-07-17T09:00:00.000Z',
  },
  versions: [{
    id: VERSION_ID,
    sheetVersion: 1,
    previousVersionId: null,
    // Paket 56 öncesi sürümler kanıt alanlarını null olarak okur.
    items: [{ ordinal: 1, description: 'Ön tampon kaplama', action: 'Değişim', partAmountMinor: 18_400_00, laborAmountMinor: 2_200_00, partCode: null, partCodeSource: null, damageRegion: null }],
    totals: { partTotalMinor: 18_400_00, laborTotalMinor: 2_200_00, grandTotalMinor: 20_600_00 },
    schemaVersion: 'labor-sheet/1.0.0',
    currency: 'TRY',
    sourceType: 'user_entered',
    laborAiSuggestionRunId: null,
    revisionReason: null,
    createdByUserId: USER_ID,
    createdByDisplayName: 'P43 Yetkili',
    createdAt: '2026-07-17T09:00:00.000Z',
  }],
  createdByUserId: USER_ID,
  createdByDisplayName: 'P43 Yetkili',
  createdAt: '2026-07-17T09:00:00.000Z',
  updatedAt: '2026-07-17T09:00:00.000Z',
}

function makePort(workspace: LaborSheetWorkspaceRecord): LaborDataPort {
  return {
    load: vi.fn().mockResolvedValue(workspace),
    create: vi.fn().mockResolvedValue(sheet),
    revise: vi.fn().mockResolvedValue(sheet),
  }
}

const AI_RUN_ID = '018f3f4c-89ab-7def-8123-456789abcdee'

const aiPlan: LaborAiPlanRecord = {
  caseId: CASE_ID,
  caseVersion: 3,
  baseSheetVersion: null,
  providerId: 'gemini-generate-content',
  providerVersion: 'gemini-labor/1.0.0',
  modelId: 'gemini-fixture',
  promptTemplateVersion: 'labor-ai-draft/1.0.0',
  outputSchemaVersion: 'labor-ai-suggestion/1.0.0',
  planHash: 'b'.repeat(64),
  privacy: {
    externalProvider: true,
    policyVersion: 'labor-ai-pii-redaction/1.0.0',
    outboundPayloadHash: 'c'.repeat(64),
    outboundInputCharacters: 180,
    redactedValueCount: 2,
    redactedCategories: ['email', 'name'],
    retentionMode: 'free_tier_product_improvement',
    warnings: ['damage-description:PROMPT_INJECTION'],
  },
  budget: {
    enabled: true,
    providerAvailable: true,
    providerAllowed: true,
    estimatedCostMinor: 5,
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

const aiRun: LaborAiRunRecord = {
  id: AI_RUN_ID,
  caseId: CASE_ID,
  status: 'review_required',
  providerId: 'gemini-generate-content',
  providerVersion: 'gemini-labor/1.0.0',
  modelId: 'gemini-fixture',
  promptTemplateVersion: 'labor-ai-draft/1.0.0',
  outputSchemaVersion: 'labor-ai-suggestion/1.0.0',
  baseSheetVersion: null,
  planHash: 'b'.repeat(64),
  version: 2,
  privacy: aiPlan.privacy,
  budget: aiPlan.budget,
  suggestion: {
    schemaVersion: 'labor-ai-suggestion/1.0.0',
    items: [
      { description: 'Ön tampon kaplama', action: 'Değişim', partAmountMinor: 18_400_00, laborAmountMinor: 2_200_00 },
      { description: 'Sol ön çamurluk', action: 'Onarım + boya', partAmountMinor: 0, laborAmountMinor: 6_750_00 },
    ],
    reasoning: 'Tarif edilen hasar bölgesine göre standart dağılım önerildi.',
    warnings: ['Tutarlar eksper tarafından doğrulanmalıdır.'],
    confidence: 0.86,
    requiresHumanReview: true,
  },
  safeErrorCode: null,
  createdAt: '2026-07-17T12:00:00.000Z',
  startedAt: '2026-07-17T12:00:00.000Z',
  completedAt: '2026-07-17T12:00:01.000Z',
}

function makeDictionaryPort(): LaborDictionaryDataPort {
  return {
    list: vi.fn().mockResolvedValue({
      schemaVersion: 'labor-dictionary/1.0.0',
      items: [{
        description: 'Ön tampon kaplama',
        action: 'Değişim',
        usageCount: 4,
        lastPartAmountMinor: 18_400_00,
        lastLaborAmountMinor: 2_200_00,
        lastUsedAt: '2026-07-18T09:00:00.000Z',
      }],
    }),
  }
}

function makeAiPort(): LaborAiDataPort {
  return {
    list: vi.fn().mockResolvedValue({ caseId: CASE_ID, items: [], permissions: { canStart: true } }),
    plan: vi.fn().mockResolvedValue(aiPlan),
    start: vi.fn().mockResolvedValue(aiRun),
  }
}

const emptyWorkspace = (canWrite: boolean): LaborSheetWorkspaceRecord => ({
  caseId: CASE_ID,
  caseVersion: 3,
  lifecycleStatus: canWrite ? 'open' : 'closed',
  sheet: null,
  permissions: { canWrite },
})

describe('LaborApiModule', () => {
  it('boş föyde kullanıcı kalemleri girip açık onayla oluşturur', async () => {
    const port = makePort(emptyWorkspace(true))
    render(<LaborApiModule item={item} source="api" onUnauthorized={vi.fn()} port={port} />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'İşçilik Föyü Oluştur' }))
    await user.type(screen.getByLabelText('Kalem 1'), 'Ön tampon')
    await user.type(screen.getByLabelText('İşlem 1'), 'Değişim')
    await user.type(screen.getByLabelText('Parça tutarı 1'), '18400')
    await user.type(screen.getByLabelText('İşçilik tutarı 1'), '2200')

    // Onay verilmeden kayıt engellenir
    expect(screen.getByRole('button', { name: /Föyü Kaydet/ })).toBeDisabled()
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /Föyü Kaydet/ }))

    await waitFor(() => expect(port.create).toHaveBeenCalledWith(CASE_ID, {
      expectedCaseVersion: 3,
      items: [{
        description: 'Ön tampon',
        action: 'Değişim',
        partAmountMinor: 18_400_00,
        laborAmountMinor: 2_200_00,
        // Kanıt alanları boş bırakıldığında null gider; zorunlu değildir.
        partCode: null,
        partCodeSource: null,
        damageRegion: null,
      }],
      laborAiSuggestionRunId: null,
      confirmed: true,
    }))
  })

  it('parça kodu ve hasar bölgesi kanıt alanlarını kullanıcı girdisi olarak gönderir', async () => {
    const port = makePort(emptyWorkspace(true))
    render(<LaborApiModule item={item} source="api" onUnauthorized={vi.fn()} port={port} />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'İşçilik Föyü Oluştur' }))
    await user.type(screen.getByLabelText('Kalem 1'), 'Ön tampon')
    await user.type(screen.getByLabelText('İşlem 1'), 'Değişim')
    await user.type(screen.getByLabelText('Parça tutarı 1'), '18400')
    await user.type(screen.getByLabelText('İşçilik tutarı 1'), '2200')
    await user.type(screen.getByLabelText('Parça kodu 1'), 'TMP-0142')
    await user.type(screen.getByLabelText('Hasar bölgesi 1'), 'Ön orta')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /Föyü Kaydet/ }))

    // Kullanıcının yazdığı kod her zaman `user_entered` kaynağıyla işaretlenir;
    // sözlük önerisiyle karışmaz.
    await waitFor(() => expect(port.create).toHaveBeenCalledWith(CASE_ID, expect.objectContaining({
      items: [expect.objectContaining({
        partCode: 'TMP-0142',
        partCodeSource: 'user_entered',
        damageRegion: 'Ön orta',
      })],
    })))
  })

  it('AI önerisi uygulanınca kullanıcı kanıt alanlarını ezmez', async () => {
    const port = makePort(emptyWorkspace(true))
    const ai = makeAiPort()
    render(<LaborApiModule item={item} source="api" onUnauthorized={vi.fn()} port={port} aiPort={ai} />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'İşçilik Föyü Oluştur' }))
    await user.type(screen.getByLabelText('Parça kodu 1'), 'TMP-0142')
    await user.type(screen.getByLabelText('Hasar bölgesi 1'), 'Ön orta')
    await user.type(screen.getByLabelText('Hasar tarifi (AI için)'), 'Ön tampon hasarlı.')
    await user.click(screen.getByRole('button', { name: /Gizlilik ve Bütçe Planını Göster/ }))
    await user.click(await screen.findByLabelText(/harici AI sağlayıcısına gönderilmesini onaylıyorum/))
    await user.click(screen.getByRole('button', { name: /AI Önerisini Oluştur/ }))
    await screen.findByText(/İnsan incelemesi gerekli — güven/)
    await user.click(screen.getByRole('button', { name: 'Öneriyi Düzenleme Alanlarına Uygula' }))

    // AI kanıt alanı üretmez; kullanıcının girdiği değerler korunur.
    expect(screen.getByLabelText('Parça kodu 1')).toHaveValue('TMP-0142')
    expect(screen.getByLabelText('Hasar bölgesi 1')).toHaveValue('Ön orta')
    expect(screen.getByLabelText('Parça kodu 2')).toHaveValue('')
  })

  it('her iki tutarı boş satırı istemci tarafında reddeder', async () => {
    const port = makePort(emptyWorkspace(true))
    render(<LaborApiModule item={item} source="api" onUnauthorized={vi.fn()} port={port} />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'İşçilik Föyü Oluştur' }))
    await user.type(screen.getByLabelText('Kalem 1'), 'Boş kalem')
    await user.type(screen.getByLabelText('İşlem 1'), 'Ölçüm')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /Föyü Kaydet/ }))
    expect(await screen.findByText(/en az biri girilmelidir/)).toBeInTheDocument()
    expect(port.create).not.toHaveBeenCalled()
  })

  it('mevcut föyü ve toplamları gösterir', async () => {
    const port = makePort({ ...emptyWorkspace(true), sheet })
    render(<LaborApiModule item={item} source="api" onUnauthorized={vi.fn()} port={port} />)
    expect(await screen.findByText('Ön tampon kaplama')).toBeInTheDocument()
    expect(screen.getAllByText('Sürüm 1').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Föyü Düzenle' })).toBeInTheDocument()
  })

  it('AI önerisi egress onayıyla üretilir, yalnız editöre uygulanır ve save onayını sıfırlar', async () => {
    const port = makePort(emptyWorkspace(true))
    const ai = makeAiPort()
    render(<LaborApiModule item={item} source="api" onUnauthorized={vi.fn()} port={port} aiPort={ai} />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'İşçilik Föyü Oluştur' }))
    await user.type(screen.getByLabelText('Hasar tarifi (AI için)'), 'Ön tampon hasarlı.')
    await user.click(screen.getByRole('button', { name: /Gizlilik ve Bütçe Planını Göster/ }))
    expect(await screen.findByText(/2 değer redakte edildi/)).toBeInTheDocument()
    expect(screen.getByText(/güvenilmeyen yönlendirme tespit edildi/)).toBeInTheDocument()

    // Egress onayı olmadan başlatma engellenir; provider çağrılmaz.
    await user.click(screen.getByRole('button', { name: /AI Önerisini Oluştur/ }))
    expect(await screen.findByText(/açıkça onaylayın/)).toBeInTheDocument()
    expect(ai.start).not.toHaveBeenCalled()

    await user.click(screen.getByLabelText(/harici AI sağlayıcısına gönderilmesini onaylıyorum/))
    await user.click(screen.getByRole('button', { name: /AI Önerisini Oluştur/ }))
    expect(await screen.findByText(/İnsan incelemesi gerekli — güven/)).toBeInTheDocument()
    expect(ai.start).toHaveBeenCalledWith(CASE_ID, expect.objectContaining({
      providerId: 'gemini-generate-content',
      planHash: 'b'.repeat(64),
      confirmed: true,
    }))

    // Kayıt onayını ver, öneriyi uygula: onay sıfırlanır ve kayıt otomatik yapılmaz.
    await user.click(screen.getByLabelText(/sürümlü olarak kaydedilmesini onaylıyorum/))
    await user.click(screen.getByRole('button', { name: 'Öneriyi Düzenleme Alanlarına Uygula' }))
    expect(screen.getByLabelText('Kalem 1')).toHaveValue('Ön tampon kaplama')
    expect(screen.getByLabelText('İşlem 2')).toHaveValue('Onarım + boya')
    expect(screen.getByLabelText(/sürümlü olarak kaydedilmesini onaylıyorum/)).not.toBeChecked()
    expect(port.create).not.toHaveBeenCalled()

    // Açık onaydan sonra kayıt provenance run kimliğini taşır.
    await user.click(screen.getByLabelText(/sürümlü olarak kaydedilmesini onaylıyorum/))
    await user.click(screen.getByRole('button', { name: /Föyü Kaydet/ }))
    await waitFor(() => expect(port.create).toHaveBeenCalledWith(CASE_ID, expect.objectContaining({
      laborAiSuggestionRunId: AI_RUN_ID,
      confirmed: true,
    })))
  })

  it('sözlük önerisi seçilince boş alanları doldurur; kullanıcı değerini ezmez ve otomatik kaydetmez', async () => {
    const port = makePort(emptyWorkspace(true))
    const dictionaryPort = makeDictionaryPort()
    render(<LaborApiModule item={item} source="api" onUnauthorized={vi.fn()} port={port} dictionaryPort={dictionaryPort} />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'İşçilik Föyü Oluştur' }))
    expect(await screen.findByText(/1 kalem önerisi/)).toBeInTheDocument()

    // Boş satırda seçim: işlem ve son tutarlar önerilir.
    await user.type(screen.getByLabelText('Kalem 1'), 'Ön tampon kaplama')
    await waitFor(() => expect(screen.getByLabelText('İşlem 1')).toHaveValue('Değişim'))
    expect(screen.getByLabelText('Parça tutarı 1')).toHaveValue('18400')
    expect(screen.getByLabelText('İşçilik tutarı 1')).toHaveValue('2200')
    expect(port.create).not.toHaveBeenCalled()

    // Kullanıcının yazdığı işlem korunur.
    await user.click(screen.getByRole('button', { name: /Satır ekle/ }))
    await user.type(screen.getByLabelText('İşlem 2'), 'Onarım')
    await user.type(screen.getByLabelText('Kalem 2'), 'Ön tampon kaplama')
    expect(screen.getByLabelText('İşlem 2')).toHaveValue('Onarım')
  })

  it('salt-okunur/kapalı dosyada düzenleme sunmaz', async () => {
    const port = makePort({ ...emptyWorkspace(false), sheet })
    render(<LaborApiModule item={item} source="api" onUnauthorized={vi.fn()} port={port} />)
    await screen.findByText('Ön tampon kaplama')
    expect(screen.queryByRole('button', { name: 'Föyü Düzenle' })).not.toBeInTheDocument()
    expect(screen.getByText(/salt okunurdur/)).toBeInTheDocument()
  })
})
