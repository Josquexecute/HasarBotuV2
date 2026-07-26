import { useMemo, useRef, useState, type FormEvent } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  History,
  LoaderCircle,
  Mail,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { EmailAiError, createHttpEmailAiAdapter, type EmailAiDataPort, type EmailAiPlanRecord, type EmailAiRunRecord } from '../../data/emailAiPort'
import { EmailDraftError, buildGmailWebComposeUrl, type EmailDraftAttachmentInput, type EmailDraftDataPort, type EmailDraftRecord, type EmailDraftTypeRecord } from '../../data/emailDraftPort'
import type { DataSourceKind } from '../../data/ports'
import { useEmailDrafts } from '../../data/useEmailDrafts'
import type { CaseRecord } from '../../types/case'

interface Props {
  readonly item: CaseRecord
  readonly source: DataSourceKind
  readonly onUnauthorized: () => void
  readonly port?: EmailDraftDataPort
  readonly aiPort?: EmailAiDataPort
  readonly openExternal?: (url: string) => unknown
}

const DRAFT_TYPE_LABELS: Readonly<Record<EmailDraftTypeRecord, string>> = {
  repair_approval_request: 'Onarım onayı talebi',
  missing_document_request: 'Eksik evrak talebi',
  preliminary_report_notice: 'Ön rapor bilgilendirmesi',
  service_change_notice: 'Servis değişikliği',
  deductible_service_part_notice: 'Muafiyet / servis / parça koşulu',
  portal_deductible_note: 'Portal muafiyet notu',
  closure_documents_request: 'Kapanış evrakları talebi',
  case_status_update: 'Dosya durumu',
  recourse_documents_request: 'Rücu evrakı',
  pert_evaluation_notice: 'PERT değerlendirmesi',
  custom_instruction: 'Serbest talimat',
}

function splitAddresses(value: string): string[] {
  return value.split(/[,;\n]+/).map((item) => item.trim()).filter((item) => item.length > 0)
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Istanbul',
  }).format(new Date(value))
}

function safeMessage(error: unknown): string {
  if (error instanceof EmailAiError) {
    if (error.kind === 'unauthorized') return 'Oturum süresi doldu. Yeniden giriş yapın.'
    if (error.kind === 'forbidden') return 'AI e-posta önerisi için yetkiniz bulunmuyor.'
    if (error.kind === 'not_found') return 'Dosya veya AI önerisi organizasyon kapsamınızda bulunamadı.'
    if (error.kind === 'validation') return 'AI öneri planı doğrulanamadı.'
    if (error.kind === 'conflict') return 'Dosya veya önizleme değişti. Yeniden önizleyip planlayın.'
    return 'AI sağlayıcısına ulaşılamadı; mock öneri gösterilmedi.'
  }
  if (error instanceof EmailDraftError) {
    if (error.kind === 'unauthorized') return 'Oturum süresi doldu. Yeniden giriş yapın.'
    if (error.kind === 'forbidden') return 'Bu işlem için yetkiniz bulunmuyor.'
    if (error.kind === 'not_found') return 'Dosya veya e-posta taslağı bulunamadı.'
    if (error.kind === 'validation') return 'Alıcıları, metni ve doğrulanmış ekleri kontrol edin.'
    if (error.kind === 'conflict') return 'Dosya veya taslak değişti. Güncel veriyi yükleyip yeniden önizleyin.'
    return 'E-posta servisine ulaşılamadı; mock taslak gösterilmedi.'
  }
  return 'İşlem güvenli biçimde tamamlanamadı.'
}

function attachmentKey(input: EmailDraftAttachmentInput): string {
  return `${input.resourceType}:${input.resourceId}`
}

export function EmailDraftApiModule({
  item,
  source,
  onUnauthorized,
  port,
  aiPort,
  openExternal,
}: Props) {
  const workspace = useEmailDrafts(item.caseId, source, true, port)
  const resolvedAiPort = useMemo(() => aiPort ?? createHttpEmailAiAdapter(), [aiPort])
  const busyRef = useRef(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [draftType, setDraftType] = useState<EmailDraftTypeRecord>('missing_document_request')
  const [instruction, setInstruction] = useState('')
  const [preview, setPreview] = useState<Awaited<ReturnType<EmailDraftDataPort['preview']>> | null>(null)
  const [toText, setToText] = useState('')
  const [ccText, setCcText] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [selectedAttachments, setSelectedAttachments] = useState<Set<string>>(new Set())
  const [createConfirmed, setCreateConfirmed] = useState(false)
  // Acik secim bos oldugu surece ilk taslak secili sayilir; bu turetme efektte
  // yazilmaz, RENDER sirasinda hesaplanir. Kullanici veya bir mutasyon acik
  // secim yaptiginda o secim gecerlidir.
  const [explicitDraftId, setSelectedDraftId] = useState('')
  const [editing, setEditing] = useState(false)
  const [revisionReason, setRevisionReason] = useState('')
  const [revisionConfirmed, setRevisionConfirmed] = useState(false)
  const [handoffConfirmed, setHandoffConfirmed] = useState(false)
  const [lastComposeUrl, setLastComposeUrl] = useState('')
  const [aiPlan, setAiPlan] = useState<EmailAiPlanRecord | null>(null)
  const [aiRun, setAiRun] = useState<EmailAiRunRecord | null>(null)
  const [aiEgressConfirmed, setAiEgressConfirmed] = useState(false)
  const [appliedAiRunId, setAppliedAiRunId] = useState<string | null>(null)

  const selectedDraftId = explicitDraftId !== '' ? explicitDraftId : (workspace.data?.drafts[0]?.id ?? '')

  const selectedDraft = useMemo(
    () => workspace.data?.drafts.find((draft) => draft.id === selectedDraftId) ?? null,
    [selectedDraftId, workspace.data],
  )

  const run = async (label: string, operation: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(label)
    setError('')
    setNotice('')
    try {
      await operation()
    } catch (caught) {
      setError(safeMessage(caught))
      if (
        (caught instanceof EmailDraftError || caught instanceof EmailAiError)
        && caught.kind === 'unauthorized'
      ) onUnauthorized()
    } finally {
      busyRef.current = false
      setBusy('')
    }
  }

  const requestPreview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (draftType === 'custom_instruction' && instruction.trim().length === 0) {
      setError('Serbest talimat metni zorunludur.')
      return
    }
    void run('preview', async () => {
      const next = await workspace.port.preview(item.caseId, {
        draftType,
        instruction: instruction.trim() === '' ? null : instruction.trim(),
      })
      setPreview(next)
      setSubject(next.subject)
      setBody(next.body)
      setToText('')
      setCcText('')
      setSelectedAttachments(new Set(
        next.attachmentOptions.filter((attachment) => attachment.preferred).map((attachment) => (
          attachmentKey({ resourceType: attachment.resourceType, resourceId: attachment.resourceId })
        )),
      ))
      setCreateConfirmed(false)
      setAiPlan(null)
      setAiRun(null)
      setAiEgressConfirmed(false)
      setAppliedAiRunId(null)
      setNotice('Taslak önizlemesi hazırlandı. Alıcı, içerik ve ekleri kullanıcı olarak kontrol edin.')
    })
  }

  const requestAiPlan = () => {
    if (preview === null) return
    void run('ai-plan', async () => {
      const next = await resolvedAiPort.plan(item.caseId, {
        draftType: preview.draftType,
        instruction: instruction.trim() === '' ? null : instruction.trim(),
        providerId: 'gemini-generate-content',
      })
      setAiPlan(next)
      setAiRun(null)
      setAiEgressConfirmed(false)
      setNotice(next.canStart
        ? 'AI öneri planı hazırlandı. PII minimizasyonu, bütçe ve veri çıkışını kontrol edin.'
        : 'AI çağrısı yapılmadı. Sağlayıcı ve bütçe durumu aşağıda gösteriliyor.')
    })
  }

  const startAiSuggestion = () => {
    if (aiPlan === null) return
    if (aiPlan.requiresExplicitEgressConfirmation && !aiEgressConfirmed) {
      setError('Minimize edilmiş verinin harici sağlayıcıya çıkışını açıkça onaylayın.')
      return
    }
    void run('ai-start', async () => {
      const next = await resolvedAiPort.start(item.caseId, {
        expectedCaseVersion: aiPlan.caseVersion,
        expectedPreviewHash: aiPlan.basePreview.previewHash,
        planHash: aiPlan.planHash,
        draftType: aiPlan.draftType,
        instruction: instruction.trim() === '' ? null : instruction.trim(),
        providerId: aiPlan.providerId,
        confirmed: true,
      })
      setAiRun(next)
      setAiEgressConfirmed(false)
      setNotice(next.status === 'review_required'
        ? 'AI metin önerisi hazırlandı. Uygulamadan önce kaynak taslakla karşılaştırın.'
        : 'AI çağrısı güvenli bir kesinleşmemiş durumla tamamlandı; taslak değiştirilmedi.')
    })
  }

  const applyAiSuggestion = () => {
    if (aiRun?.status !== 'review_required' || aiRun.suggestion === null) return
    setSubject(aiRun.suggestion.subject)
    setBody(aiRun.suggestion.body)
    setAppliedAiRunId(aiRun.id)
    setCreateConfirmed(false)
    setNotice('AI önerisi yalnız düzenleme alanlarına uygulandı. Taslak henüz kaydedilmedi; alıcı, konu, metin ve ekleri yeniden kontrol edin.')
  }

  const toggleAttachment = (key: string) => {
    setSelectedAttachments((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const selectedAttachmentInputs = (): EmailDraftAttachmentInput[] => {
    if (preview === null) return []
    return preview.attachmentOptions
      .filter((attachment) => selectedAttachments.has(`${attachment.resourceType}:${attachment.resourceId}`))
      .map((attachment) => ({
        resourceType: attachment.resourceType,
        resourceId: attachment.resourceId,
      }))
  }

  const saveDraft = () => {
    if (preview === null) return
    const to = splitAddresses(toText)
    if (to.length === 0 || subject.trim().length === 0 || body.trim().length === 0) {
      setError('En az bir alıcı, konu ve mesaj zorunludur.')
      return
    }
    if (!createConfirmed) {
      setError('Taslak içeriğini ve alıcıları kontrol ettiğinizi açıkça onaylayın.')
      return
    }
    void run('create', async () => {
      const created = await workspace.port.create(item.caseId, {
        expectedCaseVersion: preview.caseVersion,
        draftType: preview.draftType,
        instruction: instruction.trim() === '' ? null : instruction.trim(),
        previewHash: preview.previewHash,
        to,
        cc: splitAddresses(ccText),
        subject: subject.trim(),
        body: body.trim(),
        emailAiSuggestionRunId: appliedAiRunId,
        attachments: selectedAttachmentInputs(),
        confirmed: true,
      })
      setSelectedDraftId(created.id)
      setPreview(null)
      setCreateConfirmed(false)
      setNotice('E-posta taslağı sürümlü olarak kaydedildi; henüz gönderilmedi.')
      workspace.reload()
    })
  }

  const beginRevision = (draft: EmailDraftRecord) => {
    setEditing(true)
    setToText(draft.currentVersion.to.join(', '))
    setCcText(draft.currentVersion.cc.join(', '))
    setSubject(draft.currentVersion.subject)
    setBody(draft.currentVersion.body)
    setRevisionReason('')
    setRevisionConfirmed(false)
  }

  const saveRevision = () => {
    if (selectedDraft === null) return
    const to = splitAddresses(toText)
    if (to.length === 0 || subject.trim().length === 0 || body.trim().length === 0 || revisionReason.trim().length === 0) {
      setError('Alıcı, konu, mesaj ve düzeltme gerekçesi zorunludur.')
      return
    }
    if (!revisionConfirmed) {
      setError('Yeni sürümü oluşturmayı açıkça onaylayın.')
      return
    }
    void run('revise', async () => {
      const revised = await workspace.port.revise(item.caseId, selectedDraft.id, {
        expectedVersion: selectedDraft.version,
        to,
        cc: splitAddresses(ccText),
        subject: subject.trim(),
        body: body.trim(),
        attachments: selectedDraft.currentVersion.attachments.map((attachment) => ({
          resourceType: attachment.resourceType,
          resourceId: attachment.resourceId,
        })),
        reason: revisionReason.trim(),
        confirmed: true,
      })
      setSelectedDraftId(revised.id)
      setEditing(false)
      setNotice(`Taslak sürüm ${revised.version} oluşturuldu; önceki sürüm korundu.`)
      workspace.reload()
    })
  }

  const prepareHandoff = () => {
    if (selectedDraft === null || !handoffConfirmed) {
      setError('Gmail’e aktarım öncesi içerik ve veri çıkışını açıkça onaylayın.')
      return
    }
    void run('handoff', async () => {
      const result = await workspace.port.prepareHandoff(
        item.caseId,
        selectedDraft.id,
        selectedDraft.version,
      )
      const url = buildGmailWebComposeUrl(result.compose)
      setLastComposeUrl(url)
      const opener = openExternal ?? ((target: string) => window.open(target, '_blank', 'noopener,noreferrer'))
      const opened = opener(url)
      setHandoffConfirmed(false)
      setNotice(opened === null
        ? 'Gmail açılır penceresi engellendi. Aşağıdaki güvenli bağlantıyı kullanın; gönderim yapılmadı.'
        : 'Gmail oluşturma ekranı açıldı. Ekleri Gmail’de manuel ekleyin; gönderim uygulama tarafından doğrulanmadı.')
      workspace.reload()
    })
  }

  if (workspace.status === 'loading' && workspace.data === null) {
    return <div className="email-draft-state" role="status"><LoaderCircle className="spin" size={20} />E-posta taslakları yükleniyor…</div>
  }
  if (workspace.status !== 'ok' || workspace.data === null) {
    const message = workspace.status === 'unauthorized'
      ? 'Gerçek e-posta taslakları için oturum gereklidir.'
      : workspace.status === 'forbidden'
        ? 'E-posta taslaklarını görüntüleme yetkiniz yok.'
        : workspace.status === 'not_found'
          ? 'Dosya bulunamadı veya organizasyon kapsamınızda değil.'
          : 'E-posta API’sine ulaşılamadı; mock taslak gösterilmedi.'
    return <div className="email-draft-state" role="alert"><AlertTriangle size={20} /><span>{message}</span><button className="button button--secondary" type="button" onClick={workspace.reload}><RefreshCw size={15} /> Yeniden dene</button></div>
  }

  const canWrite = workspace.data.permissions.canWrite && item.lifecycleStatus !== 'closed'
  return (
    <div className="email-draft-workspace">
      {(error || notice) && <div className={`case-form-alert ${error ? 'case-form-alert--error' : 'case-form-alert--success'}`} role={error ? 'alert' : 'status'}>{error ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}<span>{error || notice}</span></div>}
      {!canWrite && <div className="case-form-note"><span>{item.lifecycleStatus === 'closed' ? 'Kapalı dosyanın e-posta geçmişi salt okunurdur.' : 'Rolünüz e-posta taslağı oluşturma veya Gmail handoff izni vermiyor.'}</span></div>}

      <div className="email-draft-workspace__grid">
        <section className="info-panel email-draft-composer">
          <header><div><span className="eyebrow">Kullanıcı kontrollü taslak</span><h2>E-posta Hazırla</h2></div><Mail size={17} /></header>
          {canWrite && (
            <form className="email-draft-form" onSubmit={requestPreview}>
              <label><span>E-posta türü</span><select value={draftType} onChange={(event) => setDraftType(event.target.value as EmailDraftTypeRecord)}>{Object.entries(DRAFT_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label><span>{draftType === 'custom_instruction' ? 'Serbest talimat' : 'Ek kullanıcı notu'}</span><textarea rows={3} maxLength={2000} value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Taslağa eklenecek kontrollü not…" /></label>
              <button className="button button--primary" type="submit" disabled={busy !== ''}>{busy === 'preview' ? <LoaderCircle className="spin" size={15} /> : <Mail size={15} />} Taslağı Önizle</button>
            </form>
          )}

          {preview !== null && (
            <div className="email-draft-preview">
              <div className="assistant-note"><AlertTriangle size={15} /><span>Alıcı otomatik tahmin edilmedi. Taslak nihai karar değildir ve kullanıcı kontrolü olmadan Gmail’e aktarılmaz.</span></div>
              <section className="email-ai-panel" aria-label="AI e-posta metin önerisi">
                <header><div><span className="eyebrow">Kanıtlı ve kullanıcı kontrollü</span><h3>AI Metin Önerisi</h3></div><Sparkles size={17} /></header>
                <p>AI yalnız konu ve mesaj için öneri üretir; alıcı seçmez, taslağı kaydetmez ve e-posta göndermez.</p>
                <button className="button button--secondary" type="button" disabled={busy !== ''} onClick={requestAiPlan}>{busy === 'ai-plan' ? <LoaderCircle className="spin" size={15} /> : <ShieldCheck size={15} />} Gizlilik ve Bütçe Planını Göster</button>
                {aiPlan !== null && (
                  <div className="email-ai-plan">
                    <dl>
                      <div><dt>Sağlayıcı</dt><dd>{aiPlan.budget.providerAvailable ? `${aiPlan.providerId} · ${aiPlan.modelId}` : 'Yapılandırılmamış'}</dd></div>
                      <div><dt>PII minimizasyonu</dt><dd>{aiPlan.privacy.redactedValueCount} değer · {aiPlan.privacy.redactedCategories.join(', ') || 'PII bulunmadı'}</dd></div>
                      <div><dt>Retention</dt><dd>{aiPlan.privacy.retentionMode}</dd></div>
                      <div><dt>Bütçe</dt><dd>{aiPlan.budget.estimatedCostMinor} minor unit · aylık {aiPlan.budget.currentMonthCostMinor}/{aiPlan.budget.monthlyBudgetMinor}</dd></div>
                    </dl>
                    {aiPlan.privacy.warnings.length > 0 && <div className="assistant-note"><AlertTriangle size={15} /><span>Belge/talimat içinde güvenilmeyen yönlendirme tespit edildi; sistem talimatını değiştiremez.</span></div>}
                    {!aiPlan.canStart && <div className="email-ai-blocked" role="status">{aiPlan.budget.reasonCode === 'AI_BUDGET_EXCEEDED' ? 'Bütçe limiti nedeniyle çağrı yapılmadı.' : aiPlan.budget.reasonCode === 'AI_PROVIDER_NOT_CONFIGURED' ? 'AI sağlayıcısı sunucuda yapılandırılmamıştır.' : 'AI sağlayıcısı organizasyon için kapalıdır.'}</div>}
                    {aiPlan.canStart && (
                      <>
                        <label className="email-draft-confirm"><input type="checkbox" checked={aiEgressConfirmed} onChange={(event) => setAiEgressConfirmed(event.target.checked)} /><span>PII ile minimize edilen içerik özetinin {aiPlan.providerId} sağlayıcısına gönderilmesini ve belirtilen retention davranışını onaylıyorum.</span></label>
                        <button className="button button--primary" type="button" disabled={busy !== '' || !aiEgressConfirmed} onClick={startAiSuggestion}>{busy === 'ai-start' ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />} AI Önerisini Oluştur</button>
                      </>
                    )}
                  </div>
                )}
                {aiRun !== null && aiRun.status !== 'review_required' && <div className="email-ai-blocked" role="status">{aiRun.status === 'outcome_unknown' ? 'Sağlayıcı çağrısının sonucu kesinleştirilemedi. Otomatik tekrar yapılmadı ve taslak değiştirilmedi.' : aiRun.status === 'failed' ? `AI çıktısı güvenli doğrulamadan geçmedi (${aiRun.safeErrorCode ?? 'AI_PROVIDER_FAILURE'}).` : aiRun.status === 'budget_blocked' ? 'Bütçe limiti nedeniyle çağrı yapılmadı.' : 'AI sağlayıcısı kapalı olduğu için çağrı yapılmadı.'}</div>}
                {aiRun?.status === 'review_required' && aiRun.suggestion !== null && (
                  <article className="email-ai-suggestion">
                    <header><strong>İnsan incelemesi gerekli</strong><span>Güven %{Math.round(aiRun.suggestion.confidence * 100)}</span></header>
                    <h4>{aiRun.suggestion.subject}</h4>
                    <pre>{aiRun.suggestion.body}</pre>
                    <p><strong>Gerekçe:</strong> {aiRun.suggestion.reasoning}</p>
                    {aiRun.suggestion.warnings.length > 0 && <ul>{aiRun.suggestion.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
                    <button className="button button--secondary" type="button" onClick={applyAiSuggestion}>Öneriyi Düzenleme Alanlarına Uygula</button>
                  </article>
                )}
              </section>
              <div className="email-draft-form__row">
                <label><span>Alıcılar</span><input type="text" value={toText} onChange={(event) => setToText(event.target.value)} placeholder="hasar@sigorta.example" /></label>
                <label><span>Bilgi (CC)</span><input type="text" value={ccText} onChange={(event) => setCcText(event.target.value)} placeholder="eksper@example.test" /></label>
              </div>
              <label><span>Konu</span><input type="text" maxLength={240} value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
              <label><span>Mesaj</span><textarea rows={12} maxLength={20000} value={body} onChange={(event) => setBody(event.target.value)} /></label>
              <fieldset className="email-draft-attachments">
                <legend>Doğrulanmış ek önerileri</legend>
                {preview.attachmentOptions.length === 0 && <p>Bu taslak için kullanılabilir doğrulanmış ek bulunmuyor.</p>}
                {preview.attachmentOptions.map((attachment) => {
                  const key = `${attachment.resourceType}:${attachment.resourceId}`
                  return <label key={key}><input type="checkbox" checked={selectedAttachments.has(key)} onChange={() => toggleAttachment(key)} /><span><strong>{attachment.displayName}</strong><small>{attachment.documentType ?? 'Fotoğraf'} · {attachment.mimeType}{attachment.preferred ? ' · Önerilen' : ''}</small></span></label>
                })}
              </fieldset>
              <label className="email-draft-confirm"><input type="checkbox" checked={createConfirmed} onChange={(event) => setCreateConfirmed(event.target.checked)} /><span>Alıcıları, konu/metni ve seçilen ekleri kontrol ettim; sürümlü taslak olarak kaydedilmesini onaylıyorum.</span></label>
              <button className="button button--primary" type="button" disabled={busy !== '' || !createConfirmed} onClick={saveDraft}>{busy === 'create' ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />} Taslağı Kaydet</button>
            </div>
          )}
        </section>

        <aside className="info-panel email-draft-list">
          <header><h2>Taslak Geçmişi</h2><History size={17} /></header>
          {workspace.data.drafts.length === 0 && <p className="email-draft-empty">Henüz gerçek e-posta taslağı yok.</p>}
          {workspace.data.drafts.map((draft) => <button type="button" className={draft.id === selectedDraftId ? 'is-active' : ''} key={draft.id} onClick={() => { setSelectedDraftId(draft.id); setEditing(false); setLastComposeUrl('') }}><span>{DRAFT_TYPE_LABELS[draft.draftType]}</span><strong>{draft.currentVersion.subject}</strong><small>Sürüm {draft.version} · {formatDateTime(draft.updatedAt)} · {draft.handoffs.length} Gmail handoff</small></button>)}
        </aside>
      </div>

      {selectedDraft !== null && (
        <section className="info-panel email-draft-detail">
          <header><div><span className="eyebrow">Kayıtlı taslak · sürüm {selectedDraft.version}</span><h2>{selectedDraft.currentVersion.subject}</h2></div><span className="status-pill status-pill--review">Gönderilmedi</span></header>
          {!editing ? (
            <>
              <dl className="email-draft-meta"><div><dt>Alıcı</dt><dd>{selectedDraft.currentVersion.to.join(', ')}</dd></div><div><dt>CC</dt><dd>{selectedDraft.currentVersion.cc.join(', ') || '—'}</dd></div><div><dt>Kaynak</dt><dd>{selectedDraft.currentVersion.sourceType === 'deterministic_template' ? 'Sürümlü şablon' : selectedDraft.currentVersion.sourceType === 'ai_assisted' ? 'AI destekli · insan kontrollü' : 'Kullanıcı düzeltmesi'}</dd></div><div><dt>Şablon</dt><dd>{selectedDraft.currentVersion.templateVersion}</dd></div></dl>
              <pre className="email-draft-body">{selectedDraft.currentVersion.body}</pre>
              <div className="email-draft-selected-attachments"><strong>Ek olarak önerilen metadata</strong>{selectedDraft.currentVersion.attachments.length === 0 ? <span>Ek seçilmedi.</span> : <ul>{selectedDraft.currentVersion.attachments.map((attachment) => <li key={`${attachment.resourceType}:${attachment.resourceId}`}><FileCheck2 size={14} />{attachment.displayName} · {attachment.mimeType}</li>)}</ul>}<small>Dosya yolu aktarılmaz. Gmail URL ek dosya ekleyemez; kullanıcı ekleri Gmail ekranında manuel seçer.</small></div>
              {canWrite && <div className="email-draft-actions"><button className="button button--secondary" type="button" onClick={() => beginRevision(selectedDraft)}>Yeni Sürüm Düzenle</button></div>}
            </>
          ) : (
            <div className="email-draft-preview">
              <div className="email-draft-form__row"><label><span>Alıcılar</span><input value={toText} onChange={(event) => setToText(event.target.value)} /></label><label><span>CC</span><input value={ccText} onChange={(event) => setCcText(event.target.value)} /></label></div>
              <label><span>Konu</span><input maxLength={240} value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
              <label><span>Mesaj</span><textarea rows={10} maxLength={20000} value={body} onChange={(event) => setBody(event.target.value)} /></label>
              <label><span>Düzeltme gerekçesi</span><input maxLength={500} value={revisionReason} onChange={(event) => setRevisionReason(event.target.value)} /></label>
              <label className="email-draft-confirm"><input type="checkbox" checked={revisionConfirmed} onChange={(event) => setRevisionConfirmed(event.target.checked)} /><span>Önceki sürüm korunarak yeni sürüm oluşturulmasını onaylıyorum.</span></label>
              <div className="email-draft-actions"><button className="button button--secondary" type="button" onClick={() => setEditing(false)}>Vazgeç</button><button className="button button--primary" type="button" disabled={busy !== '' || !revisionConfirmed} onClick={saveRevision}>{busy === 'revise' ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />} Yeni Sürümü Kaydet</button></div>
            </div>
          )}

          {canWrite && !editing && (
            <div className="email-draft-handoff">
              <div className="assistant-note"><AlertTriangle size={15} /><span>Bu işlem alıcı, konu ve mesajı Google Gmail web ekranına aktarır. Uygulama e-posta göndermez ve gönderimi doğrulamaz.</span></div>
              <label className="email-draft-confirm"><input type="checkbox" checked={handoffConfirmed} onChange={(event) => setHandoffConfirmed(event.target.checked)} /><span>İçeriğin Gmail’e aktarılmasını ve harici veri çıkışını onaylıyorum.</span></label>
              <button className="button button--primary" type="button" disabled={busy !== '' || !handoffConfirmed} onClick={prepareHandoff}>{busy === 'handoff' ? <LoaderCircle className="spin" size={15} /> : <ExternalLink size={15} />} Gmail Taslağını Aç</button>
              {lastComposeUrl !== '' && <a className="button button--secondary" href={lastComposeUrl} target="_blank" rel="noreferrer">Gmail bağlantısını tekrar aç</a>}
            </div>
          )}

          <div className="email-draft-version-history">
            <h3>Sürüm ve handoff geçmişi</h3>
            {selectedDraft.versions.map((version) => <article key={version.id}><strong>Sürüm {version.draftVersion}</strong><span>{version.sourceType === 'manual_revision' ? version.revisionReason : version.sourceType === 'ai_assisted' ? 'AI önerisi uygulandı; insan kontrolüyle kaydedildi.' : 'İlk sürümlü taslak'}</span><small>{version.createdByDisplayName} · {formatDateTime(version.createdAt)}</small></article>)}
            {selectedDraft.handoffs.map((handoff) => <article key={handoff.id}><strong>Gmail handoff hazırlandı</strong><span>Gönderim durumu bilinmiyor; uygulama gönderilmiş saymaz.</span><small>{handoff.preparedByDisplayName} · {formatDateTime(handoff.preparedAt)}</small></article>)}
          </div>
        </section>
      )}
    </div>
  )
}
