import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, History, ReceiptText, RefreshCw } from 'lucide-react'
import { formatCurrency } from '../../mocks/cases'
import type { CaseDocumentsDataPort, DataSourceKind } from '../../data/ports'
import type { ReportsFeesDataPort } from '../../data/reportsFeesPort'
import { useCaseDocuments } from '../../data/useCaseDocuments'
import { useCaseFee } from '../../data/useReportsFees'
import type { CaseRecord } from '../../types/case'

function formatMinor(minor: number | null): string {
  return minor === null ? '—' : formatCurrency(minor / 100)
}

function parseMinor(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(normalized)) return null
  const [whole, fraction = ''] = normalized.split('.')
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null
}

function statusLabel(status: 'control_required' | 'approved' | 'corrected'): string {
  if (status === 'approved') return 'Kullanıcı Onaylı'
  if (status === 'corrected') return 'Kullanıcı Düzeltti'
  return 'Kontrol Gerekli'
}

function loadMessage(status: string): string | null {
  if (status === 'loading') return 'Kapanma ücreti yükleniyor…'
  if (status === 'unauthorized') return 'Oturum gerekli; mock ücret gösterilmiyor.'
  if (status === 'forbidden') return 'Bu işlem için yetkiniz yok.'
  if (status === 'not_found') return 'Dosya veya ücret kaydı bulunamadı.'
  if (status === 'conflict') return 'Kayıt değişti veya mevcut durumda işlem yapılamıyor. Güncel veriyi yükleyin.'
  if (status === 'validation') return 'Tutar, kaynak sayfa veya gerekçe geçerli değil.'
  if (status === 'unavailable') return 'Ücret servisine ulaşılamıyor; mock fallback yapılmadı.'
  return null
}

export function CaseFeeApiModule({
  item,
  source,
  feePort,
  documentPort,
}: {
  readonly item: CaseRecord
  readonly source: DataSourceKind
  readonly feePort?: ReportsFeesDataPort
  readonly documentPort?: CaseDocumentsDataPort
}) {
  const feeState = useCaseFee(item.caseId, source === 'api', feePort)
  const documents = useCaseDocuments(item.caseId, source, source === 'api', documentPort)
  const [amount, setAmount] = useState('')
  const [sourceVersionId, setSourceVersionId] = useState('')
  const [sourcePage, setSourcePage] = useState('1')
  const [confirmed, setConfirmed] = useState(false)
  const [correctionOpen, setCorrectionOpen] = useState(false)
  const [correctionReason, setCorrectionReason] = useState('')
  const candidateKey = useRef<string | null>(null)
  const approvalKey = useRef<string | null>(null)
  const correctionKey = useRef<string | null>(null)

  const reportVersions = useMemo(() => (
    (documents.data?.documents ?? []).filter((document) => (
      document.documentType === 'expert_report'
      && document.status === 'ready'
      && document.hashVerified
      && document.sizeVerified
      && document.verifiedAt !== null
    ))
  ), [documents.data])
  const selectedSource = sourceVersionId || reportVersions[0]?.id || ''
  const current = feeState.workspace?.fee?.currentVersion ?? null
  const permissions = feeState.workspace?.fee?.permissions ?? feeState.workspace?.permissions
  const message = loadMessage(feeState.status)
  const candidateMinor = parseMinor(amount)
  const pageNumber = Number(sourcePage)

  const resetCommandKeys = () => {
    candidateKey.current = null
    correctionKey.current = null
  }

  const createCandidate = async () => {
    if (
      candidateMinor === null
      || selectedSource.length === 0
      || !Number.isInteger(pageNumber)
      || pageNumber < 1
      || item.version === undefined
    ) return
    candidateKey.current ??= globalThis.crypto.randomUUID()
    const ok = await feeState.run(() => feeState.port.createCandidate(item.caseId, {
      expectedCaseVersion: item.version as number,
      candidateAmountMinor: candidateMinor,
      sourceDocumentVersionId: selectedSource,
      sourcePage: pageNumber,
    }, candidateKey.current as string))
    if (ok) {
      candidateKey.current = null
      setAmount('')
      setConfirmed(false)
    }
  }

  const approve = async () => {
    const fee = feeState.workspace?.fee
    if (fee === null || fee === undefined || !confirmed) return
    approvalKey.current ??= globalThis.crypto.randomUUID()
    const ok = await feeState.run(() => feeState.port.approve(
      fee.id,
      fee.version,
      approvalKey.current as string,
    ))
    if (ok) {
      approvalKey.current = null
      setConfirmed(false)
    }
  }

  const correct = async () => {
    const fee = feeState.workspace?.fee
    const correctedMinor = parseMinor(amount)
    if (
      fee === null
      || fee === undefined
      || correctedMinor === null
      || selectedSource.length === 0
      || !Number.isInteger(pageNumber)
      || pageNumber < 1
      || correctionReason.trim().length < 3
      || !confirmed
    ) return
    correctionKey.current ??= globalThis.crypto.randomUUID()
    const ok = await feeState.run(() => feeState.port.correct(fee.id, {
      expectedVersion: fee.version,
      approvedAmountMinor: correctedMinor,
      sourceDocumentVersionId: selectedSource,
      sourcePage: pageNumber,
      reason: correctionReason.trim(),
    }, correctionKey.current as string))
    if (ok) {
      correctionKey.current = null
      setCorrectionOpen(false)
      setCorrectionReason('')
      setAmount('')
      setConfirmed(false)
    }
  }

  if (feeState.status === 'loading' && feeState.workspace === null) {
    return <section className="info-panel"><p role="status">Kapanma ücreti yükleniyor…</p></section>
  }

  return (
    <div className="module-workspace">
      <section className="info-panel module-workspace__main">
        <header>
          <div><h2>Kapanma Ücreti</h2><span>Kaynaklı ve kullanıcı kontrollü</span></div>
          <ReceiptText size={17} />
        </header>

        {message !== null && (
          <div className="alert-panel alert-panel--warning" role="alert">
            <AlertTriangle size={17} />
            <div><strong>İşlem tamamlanamadı</strong><span>{message}</span></div>
            <button className="button button--secondary" type="button" onClick={feeState.reload}>
              <RefreshCw size={14} /> Yenile
            </button>
          </div>
        )}

        {feeState.workspace?.fee === null && (
          <>
            <div className="assistant-note">
              <AlertTriangle size={15} />
              <span>Aday tutar kesin aylık toplama girmez. Yalnız doğrulanmış nihai ekspertiz raporu kaynak olabilir.</span>
            </div>
            {item.lifecycleStatus !== 'closed' && (
              <p>Ücret adayı yalnız fiziksel kapanışı tamamlanmış kapalı dosyada oluşturulabilir.</p>
            )}
            {item.lifecycleStatus === 'closed' && reportVersions.length === 0 && (
              <p role="alert">Ready ve fiziksel doğrulaması tamamlanmış “Nihai Ekspertiz Raporu” bulunamadı.</p>
            )}
            {item.lifecycleStatus === 'closed' && reportVersions.length > 0 && permissions?.canCreateCandidate && (
              <div className="fee-form">
                <label className="fee-field"><span>Aday Tutar (TL)</span><input
                  value={amount}
                  inputMode="decimal"
                  onChange={(event) => { setAmount(event.target.value); resetCommandKeys() }}
                  placeholder="4850,00"
                /></label>
                <label className="fee-field"><span>Kaynak Rapor</span><select
                  value={selectedSource}
                  onChange={(event) => { setSourceVersionId(event.target.value); resetCommandKeys() }}
                >{reportVersions.map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.displayName} · v{document.versionNumber}
                  </option>
                ))}</select></label>
                <label className="fee-field"><span>Kaynak Sayfa</span><input
                  type="number"
                  min="1"
                  max="10000"
                  value={sourcePage}
                  onChange={(event) => { setSourcePage(event.target.value); resetCommandKeys() }}
                /></label>
                <button
                  className="button button--primary"
                  type="button"
                  disabled={feeState.saving || candidateMinor === null || item.version === undefined}
                  onClick={createCandidate}
                >{feeState.saving ? 'Kaydediliyor…' : 'Adayı Kaydet'}</button>
              </div>
            )}
          </>
        )}

        {feeState.workspace?.fee !== null && feeState.workspace?.fee !== undefined && current !== null && (
          <>
            <dl className="overview-fields">
              <div><dt>Durum</dt><dd><span className={`status-pill ${current.status === 'control_required' ? 'status-pill--review' : 'status-pill--open'}`}>{statusLabel(current.status)}</span></dd></div>
              <div><dt>Aday Tutar</dt><dd>{formatMinor(current.candidateAmountMinor)}</dd></div>
              <div><dt>Onaylı Tutar</dt><dd>{formatMinor(current.approvedAmountMinor)}</dd></div>
              <div><dt>Kaynak</dt><dd>Sayfa {current.sourcePage} · {current.ruleVersion}</dd></div>
            </dl>
            {current.status === 'control_required' && (
              <div className="approval-panel">
                <label className="fee-confirmation"><input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                /><span>Aday tutarı ve kaynak sayfayı kontrol ettim.</span></label>
                {permissions?.canApprove
                  ? <button className="button button--primary" type="button" disabled={!confirmed || feeState.saving} onClick={approve}>Ücreti Onayla</button>
                  : <p>Bu kayıt yetkili kullanıcı onayı bekliyor.</p>}
              </div>
            )}
            {(current.status === 'approved' || current.status === 'corrected') && permissions?.canCorrect && !correctionOpen && (
              <button className="button button--secondary" type="button" onClick={() => {
                setCorrectionOpen(true)
                setAmount(String((current.approvedAmountMinor ?? current.candidateAmountMinor) / 100))
                setSourcePage(String(current.sourcePage))
                setSourceVersionId(current.sourceDocumentVersionId)
              }}>Yeni Düzeltme Sürümü</button>
            )}
            {correctionOpen && (
              <div className="fee-form">
                <label className="fee-field"><span>Düzeltilmiş Tutar (TL)</span><input value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
                <label className="fee-field"><span>Kaynak Rapor</span><select value={selectedSource} onChange={(event) => setSourceVersionId(event.target.value)}>{reportVersions.map((document) => <option key={document.id} value={document.id}>{document.displayName} · v{document.versionNumber}</option>)}</select></label>
                <label className="fee-field"><span>Kaynak Sayfa</span><input type="number" min="1" max="10000" value={sourcePage} onChange={(event) => setSourcePage(event.target.value)} /></label>
                <label className="fee-field fee-form__wide"><span>Düzeltme Gerekçesi</span><textarea value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} maxLength={500} /></label>
                <label className="fee-confirmation fee-form__wide"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>Yeni tutarı ve kaynağı kontrol ettim.</span></label>
                <div className="heading-actions">
                  <button className="button button--secondary" type="button" onClick={() => setCorrectionOpen(false)}>Vazgeç</button>
                  <button className="button button--primary" type="button" disabled={!confirmed || feeState.saving} onClick={correct}>Düzeltmeyi Kaydet</button>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <aside className="info-panel">
        <header><h2>Sürüm Geçmişi</h2><History size={16} /></header>
        {feeState.workspace?.fee === null || feeState.workspace?.fee === undefined
          ? <p>Henüz ücret sürümü yok.</p>
          : <ul className="task-list">{feeState.workspace.fee.history.map((version) => (
              <li key={version.id}>
                <span>v{version.feeVersion} · {statusLabel(version.status)} · Sayfa {version.sourcePage}</span>
                <strong>{formatMinor(version.approvedAmountMinor ?? version.candidateAmountMinor)}</strong>
              </li>
            ))}</ul>}
        <div className="alert-panel alert-panel--success">
          <CheckCircle2 size={17} />
          <div><strong>Append-only geçmiş</strong><span>Onaylı sürüm değiştirilmez; düzeltme yeni sürüm oluşturur.</span></div>
        </div>
      </aside>
    </div>
  )
}
