import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PolicyAiCandidatesModule } from './PolicyAiCandidatesModule'

const CASE = '019f7000-0000-7000-8000-000000000026'
const CASE_TWO = '019f7000-0000-7000-8000-000000000126'
const RUN = '019f7000-0000-7000-8000-000000000027'
const RUN_TWO = '019f7000-0000-7000-8000-000000000127'
const BUNDLE = '019f7000-0000-7000-8000-000000000028'
const DOCUMENT = '019f7000-0000-7000-8000-000000000029'
const VERSION = '019f7000-0000-7000-8000-000000000030'
const EXTRACTION = '019f7000-0000-7000-8000-000000000031'
const PAGE = '019f7000-0000-7000-8000-000000000032'
const SEGMENT = '019f7000-0000-7000-8000-000000000033'
const ANCHOR = 'a'.repeat(64)

const budget = { enabled: true, providerAvailable: true, providerAllowed: true, estimatedCostMinor: 1, currentMonthCostMinor: 0, monthlyBudgetMinor: 100, perRequestBudgetMinor: 10, allowed: true, reasonCode: null }
const localPrivacy = { externalProvider: false, policyVersion: 'policy-ai-pii/local-only', outboundPayloadHash: null, outboundInputCharacters: 64, redactedValueCount: 0, redactedCategories: [], retentionMode: 'local_only', pricingVersion: 'deterministic-cost/1.0.0' }
const source = { sourceAnchorId: ANCHOR, sourceType: 'ocr', documentId: DOCUMENT, documentVersionId: VERSION, extractionId: EXTRACTION, sourceItemId: SEGMENT, pageNumber: 4, boundedExcerpt: 'Koşullu muafiyet %10 ve anlaşmasız servis.', textHash: 'c'.repeat(64), sourceQuality: 'low', warnings: ['OCR_HUMAN_REVIEW_REQUIRED'], historicalSelected: false }

function summary(status = 'planned', caseId = CASE, id = RUN, hash = 'b'.repeat(64)) {
  return { id, caseId, status, providerId: 'deterministic-success', providerVersion: 'deterministic/1.0.0', modelId: 'local-fixture-v1', promptTemplateVersion: 'policy-ai-extraction/1.0.0', outputSchemaVersion: 'policy-ai-candidates/1.0.0', sourceBundleHash: hash, sourceBundleId: BUNDLE, candidateCount: status === 'review_required' ? 2 : 0, conflictCount: status === 'review_required' ? 1 : 0, controlRequiredCount: status === 'review_required' ? 2 : 0, inputCharacters: 64, estimatedCostMinor: 1, actualCostMinor: status === 'review_required' ? 1 : null, safeErrorCode: null, version: status === 'planned' ? 1 : 4, createdAt: '2026-07-15T08:00:00.000Z', startedAt: status === 'planned' ? null : '2026-07-15T08:01:00.000Z', completedAt: status === 'planned' ? null : '2026-07-15T08:01:01.000Z', privacy: localPrivacy }
}

function detail(status = 'planned', caseId = CASE, id = RUN, hash = 'b'.repeat(64)) {
  return { run: { ...summary(status, caseId, id, hash), budget, bundle: { id: BUNDLE, sourceBundleHash: hash, bundleSchemaVersion: 'policy-ai-source-bundle/1.0.0', documentVersionIds: [VERSION], inputCharacters: 64, sourceCount: 1, completeness: 'control_required', missingPages: [], ocrRequiredPages: [4], qualityWarnings: ['OCR_HUMAN_REVIEW_REQUIRED'], createdAt: '2026-07-15T08:00:00.000Z', items: [source] } } }
}

const candidate = { candidateId: 'deductible-10', category: 'deductible', canonicalField: 'deductible.conditional', normalizedValue: { percentage: 10 }, originalValue: '%10', conditions: ['anlaşmasız servis'], exceptions: [], sourceAnchorIds: [ANCHOR], providerConfidence: .86, sourceQuality: 'low', validationStatus: 'control_required', conflictStatus: 'control_required', humanReviewStatus: 'control_required', providerId: 'deterministic-success', providerVersion: 'deterministic/1.0.0', modelId: 'local-fixture-v1', promptTemplateVersion: 'policy-ai-extraction/1.0.0', outputSchemaVersion: 'policy-ai-candidates/1.0.0', review: null }
const generalCandidate = { ...candidate, candidateId: 'deductible-general', canonicalField: 'deductible.general', normalizedValue: { none: true }, originalValue: 'Muafiyetsiz', conditions: [], conflictStatus: 'conflict_detected' }
const conflict = { id: BUNDLE, leftCandidateId: 'deductible-general', rightCandidateId: 'deductible-10', status: 'control_required', reason: 'GENERAL_NO_DEDUCTIBLE_DOES_NOT_OVERRIDE_CONDITIONAL' }
const preview = { schemaVersion:'policy-ai-promotion/1.0.0',runId:RUN,runVersion:4,reviewSetHash:'d'.repeat(64),totalCandidateCount:2,acceptedCount:0,editedCount:0,rejectedCount:0,controlRequiredCount:0,pendingCount:2,promotableCount:0,sourceCount:0,conflictCount:1,preservedConflictCount:1,canPromote:false,blockers:['AI_REVIEW_PENDING','AI_NO_APPROVED_CANDIDATE'],warnings:['AI_CANDIDATE_CONFLICTS_PRESERVED'],targetAnalysisId:null,targetAnalysisVersion:null,nextAnalysisVersion:1 }
const response = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

afterEach(() => vi.restoreAllMocks())

describe('AI alan adayları görünümü', () => {
  it('açık onay sonrası start çalıştırır; bundle, conflict, anchor ve doğru OCR uyarısını gösterir', async () => {
    let started = false
    vi.spyOn(globalThis, 'fetch').mockImplementation(vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/documents?')) return response(200, { items: [] })
      if (init?.method === 'POST' && url.endsWith('/start')) { started = true; return response(200, detail('review_required')) }
      if (url.includes('/candidates?')) return response(200, { items: [generalCandidate, candidate], conflicts: [conflict], pageInfo: { page: 1, pageSize: 100, totalItems: 2, totalPages: 1 } })
      if (url.endsWith('/promotion-preview')) return response(200,{preview})
      if (url.endsWith(`/policy-ai-extractions/${RUN}`)) return response(200, detail(started ? 'review_required' : 'planned'))
      if (url.endsWith('/policy-ai-extractions')) return response(200, { items: [summary(started ? 'review_required' : 'planned')] })
      return response(404, {})
    }) as never)
    const user = userEvent.setup()
    render(<PolicyAiCandidatesModule caseId={CASE} source="api" />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'AI Alan Adayları' })).toBeInTheDocument())
    expect(screen.getByText('b'.repeat(64))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Aday Üretimini Başlat/ })).toBeDisabled()
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /Aday Üretimini Başlat/ }))
    await waitFor(() => expect(screen.getByText('deductible.conditional')).toBeInTheDocument())
    expect(screen.getAllByText(/Sayfa 4/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/Düşük OCR kalitesi/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/Genel muafiyetsiz ifade koşullu muafiyeti/)).toBeInTheDocument()
    expect(screen.getByText(/İnsan kararı append-only/)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('P:\\')
  })

  it('provider kapalı durumunu mock fallback olmadan gösterir', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/documents?')) return response(200, { items: [] })
      if (url.endsWith(`/policy-ai-extractions/${RUN}`)) return response(200, { run: { ...detail('provider_disabled').run, safeErrorCode: 'AI_PROVIDER_DISABLED', budget: { ...budget, enabled: false, allowed: false, reasonCode: 'AI_PROVIDER_DISABLED' } } })
      return response(200, { items: [summary('provider_disabled')] })
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock as never)
    render(<PolicyAiCandidatesModule caseId={CASE} source="api" />)
    await waitFor(() => expect(screen.getByText(/Provider çağrısı yapılmadı/)).toBeInTheDocument())
    expect(screen.queryByText('Mock yanıt')).not.toBeInTheDocument()
  })

  it('gerçek dış sağlayıcı planında PII minimizasyonu, retention ve açık gönderim onayını gösterir', async () => {
    const externalPrivacy = { externalProvider: true, policyVersion: 'policy-ai-pii-redaction/1.0.0', outboundPayloadHash: 'e'.repeat(64), outboundInputCharacters: 48, redactedValueCount: 3, redactedCategories: ['email', 'name', 'phone'], retentionMode: 'store_false', pricingVersion: 'configured-token-pricing/1.0.0' }
    const planned = detail('planned').run
    const external = { run: { ...planned, providerId: 'openai-responses', providerVersion: 'openai-responses/1.0.0', modelId: 'gpt-5-mini-pinned', privacy: externalPrivacy, bundle: { ...planned.bundle, items: [{ ...source, boundedExcerpt: 'A'.repeat(4_000) }] } } }
    vi.spyOn(globalThis, 'fetch').mockImplementation(vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/documents?')) return response(200, { items: [] })
      if (url.endsWith(`/policy-ai-extractions/${RUN}`)) return response(200, external)
      return response(200, { items: [{ ...summary(), providerId: 'openai-responses', privacy: externalPrivacy }] })
    }) as never)
    render(<PolicyAiCandidatesModule caseId={CASE} source="api" />)
    expect(await screen.findByText('Dış sağlayıcı veri sınırı')).toBeInTheDocument()
    expect(screen.getByText(/3 hassas değer maskelendi/)).toBeInTheDocument()
    expect(screen.getByText(/store: false/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Maskelenmiş kaynak parçalarının dış AI sağlayıcısına/)).toBeInTheDocument()
    expect(screen.queryByText('Bağlantı kurulamadı')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('sk-')
  })

  it('Gemini ücretsiz katmanını sentetik veri sınırı ve ürün geliştirme uyarısıyla gösterir', async () => {
    const externalPrivacy = { externalProvider: true, policyVersion: 'policy-ai-pii-redaction/1.0.0', outboundPayloadHash: 'f'.repeat(64), outboundInputCharacters: 48, redactedValueCount: 3, redactedCategories: ['email', 'name', 'phone'], retentionMode: 'free_tier_product_improvement', pricingVersion: 'gemini-free-tier/2026-07-15' }
    const planned = detail('planned').run
    const external = { run: { ...planned, providerId: 'gemini-generate-content', providerVersion: 'gemini-generate-content/1.0.0', modelId: 'gemini-3.5-flash', privacy: externalPrivacy } }
    vi.spyOn(globalThis, 'fetch').mockImplementation(vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/documents?')) return response(200, { items: [] })
      if (url.endsWith(`/policy-ai-extractions/${RUN}`)) return response(200, external)
      return response(200, { items: [{ ...summary(), providerId: 'gemini-generate-content', privacy: externalPrivacy }] })
    }) as never)
    render(<PolicyAiCandidatesModule caseId={CASE} source="api" />)
    expect(await screen.findByText('Dış sağlayıcı veri sınırı')).toBeInTheDocument()
    expect(screen.getByText(/ürün geliştirme amacıyla kullanılabilir/)).toBeInTheDocument()
    expect(screen.getByText(/gerçek müşteri verisi gönderilmez/)).toBeInTheDocument()
  })

  it('kontrol, kabul ve düzenleme kararlarından sonra açık onayla Paket 23 taslağına aktarır',async()=>{
    const reviews=new Map<string,Record<string,unknown>>()
    const items=[generalCandidate,candidate]
    const currentPreview=()=>{const values=[...reviews.values()],accepted=values.filter(value=>value.action==='accepted').length,edited=values.filter(value=>value.action==='edited').length,pending=2-values.length;return{...preview,acceptedCount:accepted,editedCount:edited,pendingCount:pending,promotableCount:accepted+edited,sourceCount:accepted+edited,canPromote:pending===0&&accepted+edited>0,blockers:pending===0?[]:['AI_REVIEW_PENDING']}}
    vi.spyOn(globalThis,'fetch').mockImplementation(vi.fn(async(input:string|URL|Request,init?:RequestInit)=>{
      const url=String(input)
      if(url.includes('/documents?'))return response(200,{items:[]})
      if(init?.method==='POST'&&url.endsWith('/review')){const body=JSON.parse(String(init.body)) as Record<string,unknown>,candidateId=url.split('/').at(-2)!,base=items.find(item=>item.candidateId===candidateId)!,existing=reviews.get(candidateId),review={schemaVersion:'policy-ai-human-review/1.0.0',runId:RUN,candidateId,reviewVersion:Number(existing?.reviewVersion??0)+1,action:body.action,normalizedValue:body.action==='edited'?body.normalizedValue:base.normalizedValue,originalValue:body.action==='edited'?body.originalValue:base.originalValue,conditions:body.action==='edited'?body.conditions:base.conditions,exceptions:body.action==='edited'?body.exceptions:base.exceptions,sourceAnchorIds:base.sourceAnchorIds,reason:body.reason??null,evidenceStatus:'control_required',reviewedByUserId:DOCUMENT,reviewedAt:'2026-07-15T09:00:00.000Z'};reviews.set(candidateId,review);return response(200,{review})}
      if(init?.method==='POST'&&url.endsWith('/promote'))return response(201,{promotion:{id:BUNDLE,schemaVersion:'policy-ai-promotion/1.0.0',runId:RUN,reviewSetHash:'d'.repeat(64),analysisId:DOCUMENT,analysisVersionId:VERSION,analysisVersion:1,promotedCandidateCount:2,preservedConflictCount:1,promotedByUserId:DOCUMENT,promotedAt:'2026-07-15T09:01:00.000Z'}})
      if(url.includes('/candidates?'))return response(200,{items:items.map(item=>({...item,review:reviews.get(item.candidateId)??null})),conflicts:[conflict],pageInfo:{page:1,pageSize:100,totalItems:2,totalPages:1}})
      if(url.endsWith('/promotion-preview'))return response(200,{preview:currentPreview()})
      if(url.endsWith(`/policy-ai-extractions/${RUN}`))return response(200,detail('review_required'))
      if(url.endsWith('/policy-ai-extractions'))return response(200,{items:[summary('review_required')]})
      return response(404,{})
    }) as never)
    const user=userEvent.setup();render(<PolicyAiCandidatesModule caseId={CASE} source="api"/>);await screen.findByText('deductible.conditional')
    await user.click(screen.getAllByRole('button',{name:'Kontrol Gerektirir'})[0]!);await user.type(screen.getByLabelText('Gerekçe'),'İkinci uzman görmeli');await user.click(screen.getByRole('button',{name:'Kararı Kaydet'}));await waitFor(()=>expect(reviews.get('deductible-general')?.action).toBe('control_required'))
    await user.click(screen.getAllByRole('button',{name:'Kabul Et'})[0]!);await waitFor(()=>expect(reviews.get('deductible-general')?.action).toBe('accepted'))
    await user.click(screen.getAllByRole('button',{name:'Düzenle'})[1]!);await user.type(screen.getByLabelText('Gerekçe'),'Koşul uzman tarafından açıklandı');await user.click(screen.getByRole('button',{name:'Kararı Kaydet'}));await waitFor(()=>expect(reviews.get('deductible-10')?.action).toBe('edited'))
    const promotionCheckbox=screen.getByLabelText(/yeni, onaysız Paket 23 taslak sürümüne/);expect(promotionCheckbox).toBeEnabled();await user.click(promotionCheckbox);await user.click(screen.getByRole('button',{name:'Yeni Taslak Sürüm Oluştur'}));await waitFor(()=>expect(screen.getByText('Taslak analiz sürümü oluşturuldu')).toBeInTheDocument());expect(screen.getByText(/2 aday ve 1 çelişki/)).toBeInTheDocument()
  })

  it('ağ hatasında mock fallback yapmaz; mock mod provider çağırmaz', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network'))
    const { unmount } = render(<PolicyAiCandidatesModule caseId={CASE} source="api" />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Bağlantı kurulamadı'))
    unmount()
    fetchSpy.mockClear()
    render(<PolicyAiCandidatesModule caseId={CASE} source="mock" />)
    expect(screen.getByText(/Mock modda provider çağrısı yapılmaz/)).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('onayı case ve bundle kimliğine bağlar; case değişiminde temizler', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/documents?')) return response(200, { items: [] })
      const second = url.includes(CASE_TWO)
      const runId = second ? RUN_TWO : RUN
      const hash = second ? 'd'.repeat(64) : 'b'.repeat(64)
      if (url.endsWith(`/policy-ai-extractions/${runId}`)) return response(200, detail('planned', second ? CASE_TWO : CASE, runId, hash))
      return response(200, { items: [summary('planned', second ? CASE_TWO : CASE, runId, hash)] })
    }) as never)
    const user = userEvent.setup()
    const view = render(<PolicyAiCandidatesModule caseId={CASE} source="api" />)
    const checkbox = await screen.findByRole('checkbox')
    await user.click(checkbox)
    expect(checkbox).toBeChecked()
    view.rerender(<PolicyAiCandidatesModule caseId={CASE_TWO} source="api" />)
    await waitFor(() => expect(screen.getByText('d'.repeat(64))).toBeInTheDocument())
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })

  it('verified PDF kaynağını planlar, source preview gösterir ve plan/start için ayrı idempotency key kullanır', async () => {
    let planned = false
    let started = false
    let planKey: string | null = null
    let startKey: string | null = null
    const extraction = { id: EXTRACTION, documentId: DOCUMENT, documentVersionId: VERSION, extractionVersion: 3, status: 'ready', parserName: 'pdfjs-dist', parserVersion: '6.1.200', normalizationVersion: 'pdf-text-normalization/1.0.0', offsetUnit: 'unicode_code_point', pageCount: 2, textPageCount: 1, imageOnlyPageCount: 1, emptyPageCount: 0, failedPageCount: 0, segmentCount: 1, rawCharacterCount: 40, normalizedCharacterCount: 40, outputHash: 'e'.repeat(64), failureCode: null, version: 2, createdAt: '2026-07-15T08:00:00.000Z', startedAt: null, completedAt: '2026-07-15T08:00:01.000Z' }
    const page = { id: PAGE, extractionId: EXTRACTION, pageNumber: 1, status: 'text', rawText: 'Kasko teminat metni', normalizedText: 'Kasko teminat metni', rawTextHash: 'e'.repeat(64), normalizedTextHash: 'e'.repeat(64), segmentCount: 1 }
    const imagePage = { ...page, id: RUN_TWO, pageNumber: 2, status: 'image_only', rawText: '', normalizedText: '', segmentCount: 0 }
    const segment = { id: SEGMENT, extractionId: EXTRACTION, pageId: PAGE, pageNumber: 1, segmentIndex: 0, type: 'clause', startOffset: 0, endOffset: 20, text: 'Kasko teminat metni', textHash: 'e'.repeat(64) }
    vi.spyOn(globalThis, 'fetch').mockImplementation(vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/documents?')) return response(200, { items: [{ id: DOCUMENT, documentType: 'casco_policy' }] })
      if (url.includes(`/api/v1/documents/${DOCUMENT}`)) return response(200, { document: { versions: [{ id: VERSION, versionNumber: 2, displayName: 'Sentetik Kasko Poliçesi.pdf', byteSize: 2048, mimeType: 'application/pdf', extension: 'pdf', status: 'ready', hashVerified: true, sizeVerified: true, verifiedAt: '2026-07-15T08:00:00.000Z' }] } })
      if (url.includes('/text-extractions') && url.endsWith('/text-extractions')) return response(200, { items: [extraction] })
      if (url.includes('/ocr-runs')) return response(200, { items: [] })
      if (url.includes('/segments?')) return response(200, { items: [segment] })
      if (url.includes('/pages?')) return response(200, { items: [page, imagePage] })
      if (init?.method === 'POST' && url.endsWith('/plan')) { planKey = new Headers(init.headers).get('Idempotency-Key'); planned = true; return response(201, detail('planned')) }
      if (init?.method === 'POST' && url.endsWith('/start')) { startKey = new Headers(init.headers).get('Idempotency-Key'); started = true; return response(200, detail('review_required')) }
      if (url.includes('/candidates?')) return response(200, { items: [generalCandidate, candidate], conflicts: [conflict], pageInfo: { page: 1, pageSize: 100, totalItems: 2, totalPages: 1 } })
      if (url.endsWith('/promotion-preview')) return response(200,{preview})
      if (url.endsWith(`/policy-ai-extractions/${RUN}`)) return response(200, detail(started ? 'review_required' : 'planned'))
      if (url.endsWith('/policy-ai-extractions')) return response(200, { items: planned ? [summary(started ? 'review_required' : 'planned')] : [] })
      return response(404, {})
    }) as never)
    const user = userEvent.setup()
    render(<PolicyAiCandidatesModule caseId={CASE} source="api" />)
    expect(await screen.findByText('Sentetik Kasko Poliçesi.pdf · belge sürümü 2')).toBeInTheDocument()
    expect(screen.getByText('OCR/kontrol gereken sayfalar: 2')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Extraction Planı Oluştur' }))
    const startButton = await screen.findByRole('button', { name: 'Aday Üretimini Başlat' })
    await user.click(screen.getByRole('checkbox'))
    await user.click(startButton)
    await waitFor(() => expect(screen.getByText('deductible.conditional')).toBeInTheDocument())
    expect(planKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(startKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(startKey).not.toBe(planKey)
  })

  it('malformed run/bundle response için fail-closed unavailable gösterir', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/documents?')) return response(200, { items: [] })
      if (url.endsWith(`/policy-ai-extractions/${RUN}`)) return response(200, { run: { ...detail().run, sourceBundleHash: 'd'.repeat(64) } })
      return response(200, { items: [summary()] })
    }) as never)
    render(<PolicyAiCandidatesModule caseId={CASE} source="api" />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Bağlantı kurulamadı'))
    expect(screen.queryByText(/AI adayları nihai karar değildir/)).not.toBeInTheDocument()
  })
})
