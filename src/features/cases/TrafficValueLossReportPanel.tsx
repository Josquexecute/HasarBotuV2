import { AlertTriangle, CheckCircle2, Download, Eye, FileText, LoaderCircle, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  useTrafficValueLossReports,
  type DataSourceKind,
  type TrafficValueLossReportDataPort,
  type TrafficValueLossVersionRecord,
} from '../../data'
import { useSession } from '../../app/sessionContext'

function money(value: number | null): string {
  if (value === null) return '—'
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(value / 100)
}

function size(value: number): string {
  if (value < 1024) return `${value} B`
  return `${(value / 1024).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} KB`
}

export function TrafficValueLossReportPanel({
  caseId,
  source,
  version,
  assessmentVersion,
  port,
}: {
  readonly caseId: string
  readonly source: DataSourceKind
  readonly version: TrafficValueLossVersionRecord | null
  readonly assessmentVersion: number
  readonly port?: TrafficValueLossReportDataPort
}) {
  const session = useSession()
  const approved = version !== null
    && version.humanApprovalStatus === 'approved'
    && ['approved', 'superseded'].includes(version.status)
  const state = useTrafficValueLossReports(caseId, source, approved, port)
  const [note, setNote] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const generateKey = useRef<string | null>(null)
  const canGenerate = session.user?.roles.some((role) => ['admin', 'expert', 'case_manager'].includes(role)) === true
  const existing = version === null ? undefined : state.reports.find((report) => report.assessmentVersionId === version.id)

  useEffect(() => {
    setNote('')
    setConfirmed(false)
    setMessage(null)
    generateKey.current = null
    state.clearPreview()
    // clearPreview kararlı bir state setter'dır; sürüm değişimi rapor önizlemesini geçersiz kılar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version?.id])

  const preview = async () => {
    if (version === null) return
    setMessage(null)
    setConfirmed(false)
    generateKey.current = null
    try {
      await state.previewReport(version.id, assessmentVersion, note.trim() || null)
      setMessage('Nihai rapor önizlemesi hazırlandı; henüz çıktı oluşturulmadı.')
    } catch {
      // Güvenli hata metni hook tarafından sağlanır.
    }
  }
  const generate = async () => {
    if (version === null || state.preview === null) return
    if (globalThis.crypto?.randomUUID === undefined) {
      setMessage('Güvenli işlem kimliği üretilemedi.')
      return
    }
    const key = generateKey.current ?? globalThis.crypto.randomUUID()
    generateKey.current = key
    try {
      await state.generateReport(
        version.id,
        assessmentVersion,
        note.trim() || null,
        state.preview.previewHash,
        key,
      )
      generateKey.current = null
      setConfirmed(false)
      setMessage('Nihai PDF çıktısı immutable snapshot olarak oluşturuldu.')
    } catch {
      // Aynı anahtar retry için korunur; güvenli hata metni hook tarafından sağlanır.
    }
  }
  const download = async (reportId: string) => {
    setMessage(null)
    let outputReceived = false
    try {
      const output = await state.downloadReport(reportId)
      outputReceived = true
      if (URL.createObjectURL === undefined) throw new Error('download unsupported')
      const url = URL.createObjectURL(output.blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = output.filename
      anchor.rel = 'noopener'
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      setMessage('Doğrulanmış PDF çıktısı indirildi.')
    } catch {
      // API/network hatasında hook'un güvenli, no-fallback mesajını maskeleme.
      // Yalnız cevap alındıktan sonraki tarayıcı Blob aktarım hatası yerel mesaj üretir.
      if (outputReceived) setMessage('PDF çıktısı tarayıcıya aktarılamadı.')
    }
  }

  if (!approved) {
    return <section className="info-panel value-loss-report-panel">
      <header><div><h2>Nihai Rapor ve Çıktı</h2><span>İnsan onayı zorunlu</span></div><FileText size={16} /></header>
      <div className="value-loss-report-panel__locked"><ShieldCheck size={18} /><div><strong>Onaylı çalışma bekleniyor</strong><span>Nihai rapor önizleme ve PDF çıktısı yalnız insan tarafından onaylanmış sürümden hazırlanır.</span></div></div>
    </section>
  }

  return <section className="info-panel value-loss-report-panel" aria-labelledby="value-loss-report-title">
    <header>
      <div><h2 id="value-loss-report-title">Nihai Rapor Önizleme ve Çıktı</h2><span>Hesap v{version.assessmentVersion} · kural {version.ruleVersion} · kullanıcı kontrollü</span></div>
      <FileText size={16} />
    </header>

    {existing !== undefined ? <div className="value-loss-report-existing">
      <div><CheckCircle2 size={17} /><span><strong>Final PDF hazır</strong><small>{new Date(existing.generatedAt).toLocaleString('tr-TR')} · {size(existing.pdfByteSize)} · {existing.templateVersion}</small></span></div>
      <button className="button button--primary" type="button" disabled={state.busy} onClick={() => void download(existing.id)}>
        {state.busy ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />} PDF İndir
      </button>
    </div> : <>
      <div className="value-loss-report-controls">
        <label className="form-field"><span>Nihai rapor notu (isteğe bağlı)</span><textarea value={note} maxLength={500} onChange={(event) => {
          setNote(event.target.value)
          setConfirmed(false)
          state.clearPreview()
        }} placeholder="Yalnız rapora eklenmesi gereken kısa ve güvenli not" /></label>
        <button className="button button--secondary" type="button" disabled={state.busy} onClick={() => void preview()}>
          {state.busy ? <LoaderCircle className="spin" size={14} /> : <Eye size={14} />} Nihai Raporu Önizle
        </button>
      </div>

      {state.preview !== null && <div className="value-loss-report-preview">
        <div className="value-loss-report-preview__heading">
          <div><span className="eyebrow">Yazmasız önizleme</span><h3>{state.preview.content.title}</h3><p>{state.preview.content.caseReference.officeNumber} · {state.preview.content.caseReference.plate}</p></div>
          <span>{new Date(state.preview.previewedAt).toLocaleString('tr-TR')}</span>
        </div>
        <div className="value-loss-report-preview__metrics">
          <div><span>Brüt fark</span><strong>{money(state.preview.content.calculation.grossValueLossMinor)}</strong></div>
          <div><span>Kusur sonrası</span><strong>{money(state.preview.content.calculation.faultAdjustedValueLossMinor)}</strong></div>
          <div><span>Emsaller</span><strong>{state.preview.content.comparables.length}</strong></div>
          <div><span>Kanıtlar</span><strong>{state.preview.content.evidence.length}</strong></div>
          <div><span>Belirsizlik</span><strong>{state.preview.content.uncertainties.length}</strong></div>
          <div><span>Kural</span><strong>{state.preview.content.rule.ruleVersion}</strong></div>
        </div>
        <div className="value-loss-report-preview__columns">
          <details open><summary>Emsaller</summary><ul>{state.preview.content.comparables.map((item) => <li key={item.id}><strong>{item.side === 'pre_accident' ? 'Kaza öncesi' : 'Onarım sonrası'} · {money(item.amountMinor)}</strong><span>{item.observedAt} · {item.mileage?.toLocaleString('tr-TR') ?? '—'} km</span><small>{item.sourceReference ?? item.evidenceKey}</small></li>)}</ul></details>
          <details open><summary>Kanıtlar</summary><ul>{state.preview.content.evidence.map((item) => <li key={item.id}><strong>{item.evidenceKey}</strong><span>{item.sourceType} · {item.verificationStatus}</span><small>{item.documentVersionId ?? item.externalReference ?? '—'}</small></li>)}</ul></details>
          <details open><summary>Belirsizlikler</summary>{state.preview.content.uncertainties.length === 0 ? <p>Onaylı sürümde açık belirsizlik yok.</p> : <ul>{state.preview.content.uncertainties.map((item) => <li key={`${item.code}-${item.field}`}><strong>{item.code}</strong><span>{item.reason}</span><small>{item.field}</small></li>)}</ul>}</details>
          <details open><summary>Kural kaynakları</summary><ul>{state.preview.content.rule.sources.map((item) => <li key={item.code}><strong>{item.title}</strong><span>{item.locator}</span><small>{item.code}</small></li>)}</ul></details>
        </div>
        <label className="value-loss-report-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>Kaynakları, emsalleri, hesaplamayı, belirsizlikleri ve kural sürümünü inceledim; bu önizlemeden nihai PDF oluşturulmasını onaylıyorum.</span></label>
        <button className="button button--primary" type="button" disabled={!canGenerate || !confirmed || state.busy} onClick={() => void generate()}>
          {state.busy ? <LoaderCircle className="spin" size={14} /> : <FileText size={14} />} Onayla ve Nihai PDF Oluştur
        </button>
        {!canGenerate && <small className="text-warning">Bu rol nihai rapor oluşturamaz; mevcut raporları görüntüleyebilir.</small>}
      </div>}
    </>}

    {(message ?? state.errorMessage) && <div className={`case-form-alert ${(message ?? '').includes('hazırlandı') || (message ?? '').includes('oluşturuldu') || (message ?? '').includes('indirildi') ? 'case-form-alert--success' : 'case-form-alert--error'}`} role="status">
      {(message ?? '').includes('hazırlandı') || (message ?? '').includes('oluşturuldu') || (message ?? '').includes('indirildi') ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
      <span>{message ?? state.errorMessage}</span>
      {state.status === 'conflict' && <button className="button button--secondary" type="button" onClick={state.retry}>Önizlemeyi Yenile</button>}
    </div>}
  </section>
}
