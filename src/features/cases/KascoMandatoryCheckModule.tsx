import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, History, RefreshCw, ShieldAlert, ShieldCheck, Sparkles } from 'lucide-react'
import { useCaseDocuments } from '../../data/useCaseDocuments'
import { useKascoMandatoryCheckGate } from '../../data/useKascoMandatoryCheckGate'
import {
  KascoMandatoryCheckError,
  type KascoCheckEvidenceRecord,
  type KascoCheckResultValue,
  type KascoMandatoryCheckCodeValue,
  type KascoMandatoryCheckHistoryItemRecord,
  type KascoMandatoryCheckRecord,
} from '../../data/kascoMandatoryCheckPort'
import type { DataSourceKind } from '../../data/ports'

const RESULT_LABELS: Readonly<Record<KascoCheckResultValue, string>> = {
  same: 'Aynı', different: 'Farklı', present: 'Var', absent: 'Yok', unclear: 'Belirsiz', unknown: 'Bilinmiyor',
}

const STATUS_META: Readonly<Record<string, { label: string; className: string }>> = {
  resolved: { label: 'Tamamlandı', className: 'status-pill--open' },
  missing: { label: 'Eksik', className: 'status-pill--late' },
  control_required: { label: 'Kontrol gerekli', className: 'status-pill--review' },
  needs_review: { label: 'Yeniden gözden geçir', className: 'status-pill--review' },
  not_applicable: { label: 'Uygulanmaz', className: 'status-pill--waiting' },
}

const DEFINITIVE_RESULTS = new Set<KascoCheckResultValue>(['same', 'different', 'present', 'absent'])

function statusIcon(status: string) {
  if (status === 'resolved') return <CheckCircle2 size={15} aria-hidden="true" />
  if (status === 'not_applicable') return <ShieldCheck size={15} aria-hidden="true" />
  if (status === 'missing') return <AlertTriangle size={15} aria-hidden="true" />
  return <ShieldAlert size={15} aria-hidden="true" />
}

function safeMessage(error: unknown): string {
  if (error instanceof KascoMandatoryCheckError) {
    if (error.kind === 'conflict') return 'Bu kontrol değişti, dosya kapandı veya Kasko dışı bir dosyada onaylanmaya çalışıldı. Güncel veriyi yükleyin.'
    if (error.kind === 'validation') return 'Sonuç, kanıt veya kontrol türü tutarlılık kurallarına uymuyor.'
    if (error.kind === 'forbidden') return 'Bu işlem için yetkiniz yok.'
    if (error.kind === 'not_found') return 'Kontrol veya dosya bulunamadı.'
    if (error.kind === 'unavailable') return 'Zorunlu Kasko Kontrolü servisine ulaşılamadı.'
  }
  return 'İşlem tamamlanamadı.'
}

interface EvidenceOption {
  readonly documentId: string
  readonly documentVersionId: string
  readonly label: string
}

interface FormState {
  readonly result: KascoCheckResultValue | ''
  readonly evidenceKey: string
  readonly page: string
  readonly section: string
  readonly excerpt: string
  readonly reason: string
  readonly confirmed: boolean
}

const EMPTY_FORM: FormState = { result: '', evidenceKey: '', page: '', section: '', excerpt: '', reason: '', confirmed: false }

function evidenceSummary(evidence: KascoCheckEvidenceRecord | null): string | null {
  if (evidence === null) return null
  return `s.${evidence.page} · ${evidence.section}`
}

function CheckHistoryPanel({ items }: { items: readonly KascoMandatoryCheckHistoryItemRecord[] }) {
  if (items.length === 0) return <p className="labor-empty">Henüz onay geçmişi yok.</p>
  return (
    <div className="table-scroll metadata-table-scroll">
      <table className="data-table metadata-table">
        <thead><tr><th>Sonuç</th><th>Önceki</th><th>Kanıt</th><th>Gerekçe</th><th>Kaydeden</th><th>Tarih</th></tr></thead>
        <tbody>{items.map((item) => (
          <tr key={item.id}>
            <td>{RESULT_LABELS[item.confirmedResult]}</td>
            <td>{item.previousConfirmedResult === null ? '—' : RESULT_LABELS[item.previousConfirmedResult]}</td>
            <td>{evidenceSummary(item.evidence) ?? '—'}</td>
            <td>{item.reason ?? '—'}</td>
            <td>{item.confirmedByDisplayName}</td>
            <td>{new Date(item.occurredAt).toLocaleString('tr-TR')}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

function ModuleState({ kind, onRetry }: { kind: 'loading' | 'unauthorized' | 'forbidden' | 'not_found' | 'unavailable'; onRetry: () => void }) {
  const content = {
    loading: ['Zorunlu Kasko Kontrolü yükleniyor…', 'Sürücü, ruhsat, ehliyet ve poliçe kontrolleri değerlendiriliyor.'],
    unauthorized: ['Oturum gerekli', 'Zorunlu Kasko Kontrolü verisini görmek için yeniden giriş yapın.'],
    forbidden: ['Yetki yok', 'Bu dosya için erişim yetkiniz yok.'],
    not_found: ['Dosya bulunamadı', 'Dosya yok veya bu organizasyonun erişim alanında değil.'],
    unavailable: ['Bağlantı kurulamadı', 'Zorunlu Kasko Kontrolü servisine erişilemiyor.'],
  } as const
  return (
    <div className="document-module-state" role={kind === 'loading' ? 'status' : 'alert'}>
      {kind === 'loading' ? <RefreshCw className="state-view__spinner" aria-hidden="true" /> : <ShieldAlert aria-hidden="true" />}
      <strong>{content[kind][0]}</strong><span>{content[kind][1]}</span>
      {kind === 'unavailable' && <button className="button button--secondary" type="button" onClick={onRetry}><RefreshCw size={14} /> Yeniden dene</button>}
    </div>
  )
}

export function KascoMandatoryCheckModule({ caseId, source }: { caseId: string; source: DataSourceKind }) {
  const workspace = useKascoMandatoryCheckGate(caseId, source, true)
  const documents = useCaseDocuments(caseId, source, true)
  const [expandedCode, setExpandedCode] = useState<KascoMandatoryCheckCodeValue | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [historyByCode, setHistoryByCode] = useState<Partial<Record<KascoMandatoryCheckCodeValue, readonly KascoMandatoryCheckHistoryItemRecord[]>>>({})
  const [historyOpenCode, setHistoryOpenCode] = useState<KascoMandatoryCheckCodeValue | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)

  const gate = workspace.data

  const evidenceOptions = useMemo<readonly EvidenceOption[]>(() => {
    const docs = documents.data?.documents ?? []
    return docs
      .filter((doc) => doc.status === 'ready' && doc.hashVerified && doc.sizeVerified)
      .map((doc) => ({ documentId: doc.documentId, documentVersionId: doc.id, label: `${doc.displayName} · v${doc.versionNumber}` }))
  }, [documents.data])

  const openEditor = (check: KascoMandatoryCheckRecord) => {
    setExpandedCode(check.checkCode)
    setForm({
      result: check.confirmedResult ?? '',
      evidenceKey: check.confirmedEvidence === null ? '' : `${check.confirmedEvidence.documentId}|${check.confirmedEvidence.documentVersionId}`,
      page: check.confirmedEvidence === null ? '' : String(check.confirmedEvidence.page),
      section: check.confirmedEvidence?.section ?? '',
      excerpt: check.confirmedEvidence?.excerpt ?? '',
      reason: '',
      confirmed: false,
    })
    setError('')
    setNotice('')
  }

  const closeEditor = () => {
    setExpandedCode(null)
    setForm(EMPTY_FORM)
    setError('')
  }

  const applyAiSuggestion = (check: KascoMandatoryCheckRecord) => {
    if (check.aiSuggestedResult === null) return
    setForm((current) => ({
      ...current,
      result: check.aiSuggestedResult as KascoCheckResultValue,
      evidenceKey: check.aiEvidence === null ? current.evidenceKey : `${check.aiEvidence.documentId}|${check.aiEvidence.documentVersionId}`,
      page: check.aiEvidence === null ? current.page : String(check.aiEvidence.page),
      section: check.aiEvidence?.section ?? current.section,
      excerpt: check.aiEvidence?.excerpt ?? current.excerpt,
    }))
  }

  const toggleHistory = async (code: KascoMandatoryCheckCodeValue) => {
    if (historyOpenCode === code) {
      setHistoryOpenCode(null)
      return
    }
    setHistoryOpenCode(code)
    if (historyByCode[code] !== undefined) return
    setHistoryLoading(true)
    try {
      const items = await workspace.port.loadHistory(caseId, code)
      setHistoryByCode((current) => ({ ...current, [code]: items }))
    } catch {
      setHistoryByCode((current) => ({ ...current, [code]: [] }))
    } finally {
      setHistoryLoading(false)
    }
  }

  const submit = async (check: KascoMandatoryCheckRecord) => {
    if (busy) return
    if (form.result === '') {
      setError('Sonuç seçilmelidir.')
      return
    }
    const result = form.result
    let evidence: KascoCheckEvidenceRecord | null = null
    if (form.evidenceKey !== '') {
      const [documentId, documentVersionId] = form.evidenceKey.split('|')
      const page = Number(form.page)
      if (documentId === undefined || documentVersionId === undefined || !Number.isInteger(page) || page < 1
        || form.section.trim() === '' || form.excerpt.trim() === '') {
        setError('Kanıt belgesi seçildiyse sayfa, bölüm ve alıntı zorunludur.')
        return
      }
      evidence = { documentId, documentVersionId, page, section: form.section.trim(), excerpt: form.excerpt.trim() }
    }
    if (DEFINITIVE_RESULTS.has(result) && evidence === null) {
      setError('Kesin sonuç (aynı / farklı / var / yok) için kanıt belgesi zorunludur; poliçe, ruhsat veya ehliyet tamamı okunmadan kesin sonuç verilemez.')
      return
    }
    if (!form.confirmed) {
      setError('Sonucu ve kanıtı kontrol ettiğinizi açıkça onaylayın.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await workspace.port.confirmCheck(caseId, check.checkCode, {
        result,
        evidence,
        reason: form.reason.trim() === '' ? null : form.reason.trim(),
        expectedVersion: check.version,
      })
      setNotice(`${check.label} kaydedildi.`)
      closeEditor()
      setHistoryByCode((current) => {
        const next = { ...current }
        delete next[check.checkCode]
        return next
      })
      workspace.reload()
    } catch (caught) {
      setError(safeMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  if (source !== 'api') return null
  if (gate !== null && !gate.applicable) return null

  if (workspace.status !== 'ok' || gate === null) {
    const state = workspace.status === 'idle' || workspace.status === 'ok' ? 'loading' : workspace.status
    return <ModuleState kind={state} onRetry={workspace.reload} />
  }

  return (
    <section className="document-checklist kasco-mandatory-check-module" aria-labelledby="kasco-mandatory-check-heading">
      <header>
        <div>
          <h2 id="kasco-mandatory-check-heading">Zorunlu Kasko Kontrolü</h2>
          <span>kural {gate.ruleVersion} · kanıtlanmadan kesin sonuç verilmez</span>
        </div>
        <div className="requirement-counts" aria-label="Zorunlu Kasko Kontrolü özeti">
          {gate.missingCount > 0 && <span className="status-pill status-pill--late">{gate.missingCount} eksik</span>}
          {gate.controlRequiredCount > 0 && <span className="status-pill status-pill--review">{gate.controlRequiredCount} kontrol</span>}
          {gate.needsReviewCount > 0 && <span className="status-pill status-pill--review">{gate.needsReviewCount} yeniden gözden geçir</span>}
          <span className="status-pill status-pill--open">{gate.resolvedCount} tamam</span>
        </div>
      </header>
      {gate.incomplete && (
        <div className="case-form-alert case-form-alert--error" role="alert">
          <AlertTriangle size={17} /><span>Bu 7 kontrol tamamlanmadan (kanıtlı sonuç veya açık kontrol notu) Kasko dosyasının nihai raporu ve kapanışı engellenir.</span>
        </div>
      )}
      {error !== '' && <div className="case-form-alert case-form-alert--error" role="alert"><AlertTriangle size={17} /><span>{error}</span></div>}
      {notice !== '' && <div className="case-form-alert case-form-alert--success" role="status"><CheckCircle2 size={17} /><span>{notice}</span></div>}
      <ul className="kasco-check-list">
        {gate.checks.map((check) => {
          const status = STATUS_META[check.status] ?? STATUS_META.missing!
          const isOpen = expandedCode === check.checkCode
          return (
            <li className={`kasco-check-row kasco-check-row--${check.status}`} key={check.checkCode}>
              <div className="requirement-row__title">
                {statusIcon(check.status)}
                <strong>{check.label}</strong>
                <span className={`status-pill ${status.className}`}>{status.label}</span>
              </div>
              <p>{check.description}</p>
              <p className="kasco-check-reason">{check.reason}</p>
              {check.confirmedResult !== null && (
                <div className="kasco-check-confirmed">
                  <span>Kayıtlı sonuç: <strong>{RESULT_LABELS[check.confirmedResult]}</strong></span>
                  {evidenceSummary(check.confirmedEvidence) !== null && <span>Kanıt: {evidenceSummary(check.confirmedEvidence)}</span>}
                  {check.confirmedByDisplayName !== null && check.confirmedAt !== null && (
                    <span>{check.confirmedByDisplayName} · {new Date(check.confirmedAt).toLocaleString('tr-TR')}</span>
                  )}
                </div>
              )}
              {check.aiSuggestedResult !== null && (
                <div className="kasco-check-ai-suggestion">
                  <Sparkles size={13} aria-hidden="true" />
                  <span>AI önerisi: <strong>{RESULT_LABELS[check.aiSuggestedResult]}</strong>{check.aiConfidenceBasisPoints !== null && ` (%${Math.round(check.aiConfidenceBasisPoints / 100)} güven)`} — yalnız öneridir, kesinleşmesi için onay gerekir.</span>
                </div>
              )}
              <div className="kasco-check-actions">
                {gate.permissions.canWrite && (
                  <button className="button button--secondary" type="button" onClick={() => (isOpen ? closeEditor() : openEditor(check))}>
                    {isOpen ? 'Vazgeç' : check.confirmedResult === null ? 'Kontrolü Kaydet' : 'Sonucu Düzenle'}
                  </button>
                )}
                <button className="button" type="button" onClick={() => void toggleHistory(check.checkCode)}>
                  <History size={13} /> Geçmiş {historyOpenCode === check.checkCode ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>
              </div>
              {historyOpenCode === check.checkCode && (
                historyLoading && historyByCode[check.checkCode] === undefined
                  ? <p className="labor-empty">Geçmiş yükleniyor…</p>
                  : <CheckHistoryPanel items={historyByCode[check.checkCode] ?? []} />
              )}
              {isOpen && (
                <div className="labor-editor kasco-check-editor">
                  {check.aiSuggestedResult !== null && (
                    <button className="button button--secondary" type="button" onClick={() => applyAiSuggestion(check)}>
                      <Sparkles size={13} /> AI önerisini forma al
                    </button>
                  )}
                  <div className="pert-editor__grid">
                    <label className="form-field"><span>Sonuç</span>
                      <select value={form.result} onChange={(event) => setForm((current) => ({ ...current, result: event.target.value as KascoCheckResultValue }))}>
                        <option value="">Seçilmedi</option>
                        {check.validResults.map((value) => <option key={value} value={value}>{RESULT_LABELS[value]}</option>)}
                      </select>
                    </label>
                    <label className="form-field"><span>Kanıt belgesi</span>
                      <select value={form.evidenceKey} onChange={(event) => setForm((current) => ({ ...current, evidenceKey: event.target.value }))}>
                        <option value="">— Kanıt yok (yalnız belirsiz/bilinmiyor) —</option>
                        {evidenceOptions.map((option) => (
                          <option key={`${option.documentId}|${option.documentVersionId}`} value={`${option.documentId}|${option.documentVersionId}`}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="form-field"><span>Sayfa</span>
                      <input type="number" min={1} value={form.page} onChange={(event) => setForm((current) => ({ ...current, page: event.target.value }))} disabled={form.evidenceKey === ''} />
                    </label>
                    <label className="form-field"><span>Bölüm / madde</span>
                      <input value={form.section} onChange={(event) => setForm((current) => ({ ...current, section: event.target.value }))} maxLength={300} disabled={form.evidenceKey === ''} placeholder="Örnek: Ruhsat sahibi alanı" />
                    </label>
                  </div>
                  <label className="form-field"><span>Kanıt alıntısı</span>
                    <input value={form.excerpt} onChange={(event) => setForm((current) => ({ ...current, excerpt: event.target.value }))} maxLength={1000} disabled={form.evidenceKey === ''} placeholder="Belgeden sınırlı, doğrudan alıntı" />
                  </label>
                  <label className="form-field"><span>Not / gerekçe (opsiyonel)</span>
                    <input value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} maxLength={2000} placeholder="Örnek: Meslek bilgisi poliçede yok, sigortalıya soruldu" />
                  </label>
                  <label className="email-draft-confirm labor-confirm">
                    <input type="checkbox" checked={form.confirmed} onChange={(event) => setForm((current) => ({ ...current, confirmed: event.target.checked }))} />
                    <span>Sonucu ve kanıtı kontrol ettim; kaydedilmesini onaylıyorum.</span>
                  </label>
                  <div className="labor-editor__actions">
                    <button className="button button--primary" type="button" onClick={() => void submit(check)} disabled={busy}><CheckCircle2 size={15} /> Kaydet</button>
                    <button className="button" type="button" onClick={closeEditor} disabled={busy}>Vazgeç</button>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
