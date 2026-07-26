import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, History, RefreshCw, Save, Scale } from 'lucide-react'
import { formatCurrency } from '../../mocks/cases'
import { PertError, type PertAssessmentPayloadRecord, type PertDataPort, type PertDecisionRecord, type PertWorkflowStatusRecord } from '../../data/pertPort'
import type { DataSourceKind } from '../../data/ports'
import { usePert } from '../../data/usePert'
import type { CaseRecord } from '../../types/case'

interface Props {
  readonly item: CaseRecord
  readonly source: DataSourceKind
  readonly onUnauthorized: () => void
  readonly port?: PertDataPort
}

const STATUS_LABELS: Readonly<Record<PertWorkflowStatusRecord, string>> = {
  review_not_started: 'İnceleme Başlamadı',
  data_missing: 'Veri Eksik',
  under_review: 'İnceleniyor',
  repair_indicated: 'Onarım Yönünde',
  pert_candidate: 'PERT Adayı',
  expert_opinion_issued: 'PERT Kanaati',
  center_decision_pending: 'Merkez Kararı Bekleniyor',
  repair_decided: 'Onarım Kararı Verildi',
  pert_decided: 'PERT Kararı Verildi',
}

const DECISION_LABELS: Readonly<Record<PertDecisionRecord, string>> = {
  repair: 'Onarım',
  pert: 'PERT',
}

function formatMinor(minor: number | null): string {
  return minor === null ? '—' : formatCurrency(minor / 100)
}

/** Boş alan null sayılır; geçersiz sayı undefined döner. */
function parseMinorOrNull(value: string): number | null | undefined {
  const normalized = value.trim().replace(',', '.')
  if (normalized === '') return null
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(normalized)) return undefined
  const [whole, fraction = ''] = normalized.split('.')
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(minor) && minor >= 0 ? minor : undefined
}

function loadMessage(status: string): string | null {
  if (status === 'loading') return 'PERT değerlendirmesi yükleniyor…'
  if (status === 'unauthorized') return 'Oturum gerekli; mock değerlendirme gösterilmiyor.'
  if (status === 'forbidden') return 'Bu işlem için yetkiniz yok.'
  if (status === 'not_found') return 'Dosya bulunamadı.'
  if (status === 'unavailable') return 'PERT servisine ulaşılamıyor; mock fallback yapılmadı.'
  return null
}

function safeMessage(error: unknown): string {
  if (error instanceof PertError) {
    if (error.kind === 'conflict') return 'Değerlendirme değişti veya bu durumda işlem yapılamıyor. Güncel veriyi yükleyin.'
    if (error.kind === 'validation') return 'Durum, tutar, kanaat veya merkez kararı tutarlılık kurallarına uymuyor.'
    if (error.kind === 'forbidden') return 'Bu işlem için yetkiniz yok. PERT kanaati eksper/yönetim işidir.'
    if (error.kind === 'unavailable') return 'PERT servisine ulaşılamadı; mock fallback yapılmadı.'
  }
  return 'İşlem tamamlanamadı.'
}

export function PertApiModule({ item, source, onUnauthorized, port }: Props) {
  const workspace = usePert(item.caseId, source, true, port)
  const busyRef = useRef(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState(false)
  const [workflowStatus, setWorkflowStatus] = useState<PertWorkflowStatusRecord>('review_not_started')
  const [damageText, setDamageText] = useState('')
  const [marketText, setMarketText] = useState('')
  const [structuralNote, setStructuralNote] = useState('')
  const [opinion, setOpinion] = useState<'' | PertDecisionRecord>('')
  const [rationale, setRationale] = useState('')
  const [centerDecision, setCenterDecision] = useState<'' | PertDecisionRecord>('')
  const [centerNote, setCenterNote] = useState('')
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)

  const data = workspace.data
  const assessment = data?.assessment ?? null
  const canWrite = data?.permissions.canWrite === true && data.lifecycleStatus === 'open'
  const current = assessment?.currentVersion ?? null

  const draftRatio = useMemo(() => {
    const damage = parseMinorOrNull(damageText)
    const market = parseMinorOrNull(marketText)
    if (damage === undefined || market === undefined || damage === null || market === null) return null
    if (damage === 0 || market === 0) return null
    return Math.round((damage * 100) / market)
  }, [damageText, marketText])

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
      if (caught instanceof PertError && caught.kind === 'unauthorized') onUnauthorized()
    } finally {
      busyRef.current = false
      setBusy('')
    }
  }

  const startEdit = () => {
    setWorkflowStatus(current?.workflowStatus ?? 'review_not_started')
    setDamageText(current?.estimatedDamageMinor == null ? '' : String(current.estimatedDamageMinor / 100))
    setMarketText(current?.marketValueMinor == null ? '' : String(current.marketValueMinor / 100))
    setStructuralNote(current?.structuralNote ?? '')
    setOpinion(current?.expertOpinion ?? '')
    setRationale(current?.expertRationale ?? '')
    setCenterDecision(current?.centerDecision ?? '')
    setCenterNote(current?.centerNote ?? '')
    setReason('')
    setConfirmed(false)
    setError('')
    setNotice('')
    setEditing(true)
  }

  const buildPayload = (): PertAssessmentPayloadRecord | null => {
    const damage = parseMinorOrNull(damageText)
    const market = parseMinorOrNull(marketText)
    if (damage === undefined || market === undefined) {
      setError('Tahmini hasar ve rayiç geçerli tutar olmalıdır.')
      return null
    }
    if (opinion !== '' && rationale.trim() === '') {
      setError('Eksper kanaati için gerekçe zorunludur.')
      return null
    }
    return {
      workflowStatus,
      estimatedDamageMinor: damage,
      marketValueMinor: market,
      structuralNote: structuralNote.trim() === '' ? null : structuralNote.trim(),
      expertOpinion: opinion === '' ? null : opinion,
      expertRationale: rationale.trim() === '' ? null : rationale.trim(),
      centerDecision: centerDecision === '' ? null : centerDecision,
      centerNote: centerNote.trim() === '' ? null : centerNote.trim(),
    }
  }

  const save = () => {
    if (!confirmed) {
      setError('Değerlendirmenin kaydedilmesini açıkça onaylayın.')
      return
    }
    if (assessment !== null && reason.trim() === '') {
      setError('Sürüm gerekçesi zorunludur.')
      return
    }
    const payload = buildPayload()
    if (payload === null) return
    void run('save', async () => {
      if (assessment === null) {
        if (data === null) return
        await workspace.port.create(item.caseId, {
          ...payload,
          expectedCaseVersion: data.caseVersion,
          confirmed: true,
        })
        setNotice('PERT değerlendirmesi kullanıcı onayıyla kaydedildi.')
      } else {
        await workspace.port.revise(item.caseId, {
          ...payload,
          expectedVersion: assessment.version,
          reason: reason.trim(),
          confirmed: true,
        })
        setNotice('PERT değerlendirmesinin yeni sürümü kaydedildi.')
      }
      setEditing(false)
      setConfirmed(false)
      workspace.reload()
    })
  }

  if (source !== 'api') return null

  const message = loadMessage(workspace.status)
  if (workspace.status !== 'ok' || data === null) {
    return (
      <div className="module-placeholder">
        <Scale size={26} />
        <h2>Ağır Hasar / PERT</h2>
        <p>{message ?? 'PERT değerlendirmesi hazırlanıyor…'}</p>
        <button className="button" type="button" onClick={() => workspace.reload()}><RefreshCw size={15} /> Yeniden dene</button>
      </div>
    )
  }

  return (
    <div className="module-workspace pert-module">
      <section className="info-panel module-workspace__main">
        <header>
          <h2>Ağır Hasar / PERT Değerlendirmesi</h2>
          <span className={`status-pill ${current ? 'status-pill--open' : 'status-pill--review'}`}>
            {current ? STATUS_LABELS[current.workflowStatus] : 'Değerlendirme yok'}
          </span>
        </header>

        {error !== '' && <p className="form-alert form-alert--error"><AlertTriangle size={15} /> {error}</p>}
        {notice !== '' && <p className="form-alert form-alert--ok"><CheckCircle2 size={15} /> {notice}</p>}

        {!editing && (
          current === null
            ? <p className="labor-empty">Bu dosya için henüz PERT değerlendirmesi oluşturulmadı. AI önerisi, eksper kanaati ve merkez kararı ayrı alanlardır; hiçbir sonuç açık onay olmadan kesinleşmez.</p>
            : (
              <div className="pert-decisions">
                <section className="decision-card">
                  <span className="eyebrow">Ekonomik görünüm</span>
                  <dl className="detail-list">
                    <div><dt>Tahmini Hasar</dt><dd>{formatMinor(current.estimatedDamageMinor)}</dd></div>
                    <div><dt>Rayiç Değer</dt><dd>{formatMinor(current.marketValueMinor)}</dd></div>
                    <div><dt>Hasar / Rayiç</dt><dd>{current.damageRatioPercent === null ? '—' : `%${current.damageRatioPercent}`}</dd></div>
                  </dl>
                  {current.structuralNote !== null && <p className="labor-empty">Yapısal: {current.structuralNote}</p>}
                </section>
                <section className="decision-card">
                  <span className="eyebrow">Eksper kanaati</span>
                  <h3>{current.expertOpinion === null ? 'Kanaat verilmedi' : DECISION_LABELS[current.expertOpinion]}</h3>
                  <p>{current.expertRationale ?? 'Kanaat gerekçesi girildiğinde burada görünür.'}</p>
                </section>
                <section className="decision-card">
                  <span className="eyebrow">Merkez / sigorta kararı</span>
                  <h3>{current.centerDecision === null ? 'Karar kaydedilmedi' : DECISION_LABELS[current.centerDecision]}</h3>
                  <p>{current.centerNote ?? 'Merkez kararı eksper kanaatinden ayrı tutulur.'}</p>
                </section>
              </div>
            )
        )}

        {editing && (
          <div className="labor-editor pert-editor">
            <div className="pert-editor__grid">
              <label className="form-field"><span>Süreç durumu</span>
                <select value={workflowStatus} onChange={(event) => setWorkflowStatus(event.target.value as PertWorkflowStatusRecord)}>
                  {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="form-field"><span>Tahmini hasar (₺)</span>
                <input value={damageText} inputMode="decimal" onChange={(event) => setDamageText(event.target.value)} placeholder="480000,00" />
              </label>
              <label className="form-field"><span>Rayiç değer (₺)</span>
                <input value={marketText} inputMode="decimal" onChange={(event) => setMarketText(event.target.value)} placeholder="625000,00" />
              </label>
              <div className="form-field"><span>Türetilen oran</span><strong className="pert-ratio">{draftRatio === null ? '—' : `%${draftRatio}`}</strong></div>
            </div>
            <label className="form-field"><span>Yapısal değerlendirme notu</span>
              <input value={structuralNote} onChange={(event) => setStructuralNote(event.target.value)} placeholder="Örnek: Ön panel ölçümü bekleniyor." maxLength={500} />
            </label>
            <div className="pert-editor__grid">
              <label className="form-field"><span>Eksper kanaati</span>
                <select value={opinion} onChange={(event) => setOpinion(event.target.value as '' | PertDecisionRecord)}>
                  <option value="">Kanaat verilmedi</option>
                  <option value="repair">Onarım</option>
                  <option value="pert">PERT</option>
                </select>
              </label>
              <label className="form-field"><span>Kanaat gerekçesi</span>
                <input value={rationale} onChange={(event) => setRationale(event.target.value)} placeholder="Kanaat için zorunlu" maxLength={500} />
              </label>
              <label className="form-field"><span>Merkez kararı</span>
                <select value={centerDecision} onChange={(event) => setCenterDecision(event.target.value as '' | PertDecisionRecord)}>
                  <option value="">Karar kaydedilmedi</option>
                  <option value="repair">Onarım</option>
                  <option value="pert">PERT</option>
                </select>
              </label>
              <label className="form-field"><span>Merkez notu</span>
                <input value={centerNote} onChange={(event) => setCenterNote(event.target.value)} maxLength={500} />
              </label>
            </div>
            {assessment !== null && (
              <label className="form-field"><span>Sürüm gerekçesi</span>
                <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Örnek: Eksper kanaati verildi" maxLength={500} />
              </label>
            )}
            <label className="email-draft-confirm labor-confirm">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
              <span>Durum, ekonomik veriler, kanaat ve merkez kararını kontrol ettim; değerlendirmenin sürümlü olarak kaydedilmesini onaylıyorum.</span>
            </label>
            <div className="labor-editor__actions">
              <button className="button button--primary" type="button" onClick={save} disabled={busy !== '' || !confirmed}><Save size={15} /> {assessment === null ? 'Değerlendirmeyi Kaydet' : 'Yeni Sürümü Kaydet'}</button>
              <button className="button" type="button" onClick={() => { setEditing(false); setError(''); setNotice('') }} disabled={busy !== ''}>Vazgeç</button>
            </div>
          </div>
        )}

        {!editing && canWrite && (
          <div className="labor-editor__actions">
            <button className="button button--primary" type="button" onClick={startEdit}>
              {assessment === null ? 'PERT Değerlendirmesi Oluştur' : 'Değerlendirmeyi Düzenle'}
            </button>
          </div>
        )}
        {!editing && !canWrite && (
          <p className="labor-empty">{data.lifecycleStatus === 'closed' ? 'Kapalı dosyanın PERT değerlendirmesi salt okunurdur.' : 'PERT değerlendirmesini düzenleme yetkiniz yok.'}</p>
        )}
      </section>

      <aside className="info-panel labor-side">
        <header><h2>Değerlendirme Bilgisi</h2><Scale size={16} /></header>
        {assessment === null
          ? <p>Değerlendirme kullanıcı tarafından oluşturulur. Eşik veya otomatik karar yoktur; oran yalnız türetilmiş bilgidir ve karar alanları insan onaylıdır.</p>
          : (
            <>
              <dl className="detail-list">
                <div><dt>Sürüm</dt><dd>{assessment.version}</dd></div>
                <div><dt>Durum</dt><dd>{STATUS_LABELS[assessment.currentVersion.workflowStatus]}</dd></div>
                <div><dt>Kaydeden</dt><dd>{assessment.currentVersion.createdByDisplayName}</dd></div>
              </dl>
              <h3 className="labor-side__title"><History size={14} /> Sürüm Geçmişi</h3>
              <ul className="labor-history">
                {assessment.versions.map((version) => (
                  <li key={version.id}>
                    <strong>Sürüm {version.assessmentVersion}</strong> · {STATUS_LABELS[version.workflowStatus]}
                    <span>{version.sourceType === 'user_entered' ? 'İlk kayıt' : version.revisionReason ?? 'Düzeltme'}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
      </aside>
    </div>
  )
}
