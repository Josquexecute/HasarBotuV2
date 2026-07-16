import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, LoaderCircle, RefreshCw, X } from 'lucide-react'
import {
  LifecycleCommandError,
  createHttpCaseLifecycleCommandAdapter,
  type CaseLifecycleCommandPort,
  type LifecycleOperationRecord,
} from '../../data'
import type { CaseRecord, CaseStageCode } from '../../types/case'
import { CASE_STAGE_OPTIONS } from './caseForm'

interface Props {
  readonly item: CaseRecord
  readonly onClose: () => void
  readonly onUpdated: (item: CaseRecord) => void
  readonly onUnauthorized: () => void
  readonly onReload: () => void
  readonly port?: CaseLifecycleCommandPort
}

const STATUS_LABELS: Readonly<Record<string, string>> = {
  present: 'Mevcut', missing: 'Eksik', control_required: 'Kontrol gerekli', not_applicable: 'Uygulanmaz',
}
const TERMINAL = new Set(['closed', 'reopened', 'failed', 'stale', 'cancelled', 'manual_recovery_required', 'cleanup_pending'])

function minorCurrency(value: number | null): string {
  return value === null
    ? 'Tutar uygulanmıyor'
    : new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(value / 100)
}

function safeError(error: unknown): string {
  if (!(error instanceof LifecycleCommandError)) return 'İşlem güvenli biçimde tamamlanamadı.'
  switch (error.kind) {
    case 'unauthorized': return 'Oturumunuz sona erdi. Yeniden giriş yapın.'
    case 'forbidden': return 'Bu işlem için yönetici, eksper veya dosya sorumlusu rolü gerekir.'
    case 'validation': return 'Form bilgileri kabul edilmedi. Gerekçe ve seçimleri kontrol edin.'
    case 'not_found': return 'Dosya veya işlem bulunamadı.'
    case 'conflict': return 'Dosya başka bir işlemle değişti. Güncel veriyi yeniden yükleyin.'
    case 'manual_recovery_required': return 'Fiziksel durum belirsiz; insan incelemesi gerekiyor.'
    case 'unavailable': return 'Sunucuya ulaşılamadı. Mock veriye geçilmedi.'
  }
}

export function CaseLifecycleModal({ item, onClose, onUpdated, onUnauthorized, onReload, port }: Props) {
  const commands = useMemo(() => port ?? createHttpCaseLifecycleCommandAdapter(), [port])
  const [isReopen] = useState(() => item.lifecycleStatus === 'closed')
  const [closeMode, setCloseMode] = useState<'normal' | 'with_missing_requirements'>('normal')
  const [reason, setReason] = useState('')
  const [targetStage, setTargetStage] = useState<Exclude<CaseStageCode, 'closed'>>('new_notification')
  const [operation, setOperation] = useState<LifecycleOperationRecord | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const polling = useRef(false)

  const handleError = (error: unknown) => {
    const typed = error instanceof LifecycleCommandError ? error : null
    if (typed?.kind === 'unauthorized') onUnauthorized()
    setMessage(safeError(error))
  }

  const preview = async () => {
    if (item.version === undefined) return setMessage('Dosya sürümü bulunamadı. Güncel veriyi yükleyin.')
    if ((isReopen || closeMode === 'with_missing_requirements') && reason.trim().length < 3) {
      return setMessage('Gerekçe en az 3 karakter olmalıdır.')
    }
    setBusy(true); setMessage('')
    try {
      const locationVersion = await commands.readLocationVersion(item.caseId)
      const planned = isReopen
        ? await commands.planReopen(item.caseId, {
            expectedCaseVersion: item.version, expectedLocationVersion: locationVersion,
            reason: reason.trim(), targetWorkflowStage: targetStage,
          })
        : await commands.planClose(item.caseId, {
            expectedCaseVersion: item.version, expectedLocationVersion: locationVersion, closeMode,
            ...(closeMode === 'with_missing_requirements' ? { reason: reason.trim() } : {}),
          })
      setOperation(planned)
    } catch (error) { handleError(error) }
    finally { setBusy(false) }
  }

  const poll = async (operationId: string) => {
    polling.current = true
    for (let attempt = 0; attempt < 80 && polling.current; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 750))
      try {
        const current = await commands.readOperation(item.caseId, operationId)
        setOperation(current)
        if (TERMINAL.has(current.status)) {
          polling.current = false
          if (current.status === 'closed' || current.status === 'reopened' || current.status === 'cleanup_pending') {
            onUpdated(await commands.readCase(item.caseId))
          }
          return
        }
      } catch (error) {
        polling.current = false
        handleError(error)
        return
      }
    }
    if (polling.current) setMessage('Agent işlemi sürüyor. Durumu daha sonra yeniden kontrol edin.')
    polling.current = false
  }

  const approve = async () => {
    if (operation === null || !operation.canApprove) return
    setBusy(true); setMessage('')
    try {
      const queued = await commands.approve(item.caseId, operation)
      setOperation(queued)
      void poll(queued.id)
    } catch (error) { handleError(error) }
    finally { setBusy(false) }
  }

  const completed = operation?.status === 'closed' || operation?.status === 'reopened'
  const recovery = operation?.status === 'manual_recovery_required'
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target && !busy) { polling.current = false; onClose() }
    }}>
      <section className="modal modal--case-lifecycle" role="dialog" aria-modal="true" aria-labelledby="case-lifecycle-title" aria-busy={busy}>
        <header className="modal__header">
          <div><span className="eyebrow eyebrow--danger">Kritik işlem · gerçek API</span><h2 id="case-lifecycle-title">{isReopen ? 'Dosyayı Yeniden Aç' : 'Dosyayı Kapat'}</h2></div>
          <button className="icon-button" type="button" onClick={() => { polling.current = false; onClose() }} disabled={busy} aria-label="Pencereyi kapat"><X size={18} /></button>
        </header>
        <div className="modal__body case-lifecycle-scroll">
          {operation === null ? (
            <div className="case-lifecycle-form">
              <p>Plan ve önizleme fiziksel klasörü veya yaşam döngüsünü değiştirmez.</p>
              {!isReopen && <fieldset><legend>Kapanış yolu</legend>
                <label><input type="radio" checked={closeMode === 'normal'} onChange={() => setCloseMode('normal')} /> Normal kapanış</label>
                <label><input type="radio" checked={closeMode === 'with_missing_requirements'} onChange={() => setCloseMode('with_missing_requirements')} /> Eksiklerle kapat</label>
              </fieldset>}
              {isReopen && <label className="form-field"><span>Açık workflow aşaması</span><select value={targetStage} onChange={(event) => setTargetStage(event.target.value as Exclude<CaseStageCode, 'closed'>)}>
                {CASE_STAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select></label>}
              {(isReopen || closeMode === 'with_missing_requirements') && <label className="form-field"><span>Gerekçe</span><textarea autoFocus value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} required /></label>}
            </div>
          ) : (
            <div className="case-lifecycle-preview">
              <div className={`case-form-alert ${completed ? 'case-form-alert--success' : recovery ? 'case-form-alert--error' : ''}`} role="status">
                {completed ? <CheckCircle2 size={17} /> : recovery ? <AlertTriangle size={17} /> : <LoaderCircle className={operation.status === 'queued' || operation.status === 'moving' ? 'spin' : ''} size={17} />}
                <span>Durum: <strong>{operation.status}</strong>{operation.status === 'cleanup_pending' ? ' · hedef doğrulandı, kaynak temizliği bekliyor' : ''}</span>
              </div>
              <dl className="case-lifecycle-paths">
                <div><dt>Kaynak</dt><dd>{operation.source.storageRootKey} · {operation.source.relativePath}</dd></div>
                <div><dt>Hedef</dt><dd>{operation.destination.storageRootKey} · {operation.destination.relativePath}</dd></div>
                <div><dt>Kural sürümleri</dt><dd>{operation.requirementSummary.documentRuleVersion} · {operation.requirementSummary.closureRuleVersion}</dd></div>
                <div><dt>Servis koşulu</dt><dd>{operation.requirementSummary.serviceEligibility === null ? 'Servis atanmamış' : `${operation.requirementSummary.serviceEligibility.serviceType} · ${operation.requirementSummary.serviceEligibility.agreementStatus} · ${operation.requirementSummary.serviceEligibility.ruleVersion}`}</dd></div>
              </dl>
              {operation.requirementSummary.valueLossSummary !== null && (
                <section className="case-lifecycle-value-loss" aria-label="Değer kaybı kapanış özeti">
                  <header>
                    <div><span>Değer Kaybı Kapanış Özeti</span><strong>{STATUS_LABELS[operation.requirementSummary.valueLossSummary.status]}</strong></div>
                    <small>{operation.requirementSummary.valueLossSummary.ruleVersion}</small>
                  </header>
                  <p>{operation.requirementSummary.valueLossSummary.reason}</p>
                  <dl>
                    <div><dt>Sonuç</dt><dd>{operation.requirementSummary.valueLossSummary.resultCode ?? 'Belirsiz'}</dd></div>
                    <div><dt>Tutar</dt><dd>{minorCurrency(operation.requirementSummary.valueLossSummary.amountMinor)}</dd></div>
                    <div><dt>Hesap Sürümü</dt><dd>{operation.requirementSummary.valueLossSummary.assessmentVersion === null ? '—' : `v${operation.requirementSummary.valueLossSummary.assessmentVersion}`}</dd></div>
                    <div><dt>Nihai Rapor</dt><dd>{operation.requirementSummary.valueLossSummary.reportId === null ? 'Bulunamadı' : 'Doğrulanmış rapor bağlı'}</dd></div>
                  </dl>
                </section>
              )}
              <div className="case-lifecycle-counts"><span>{operation.requirementSummary.missingCount} eksik</span><span>{operation.requirementSummary.controlRequiredCount} kontrol gerekli</span></div>
              <ul className="case-lifecycle-requirements">
                {operation.requirementSummary.requirements.map((requirement) => <li key={requirement.requirementCode}>
                  <div><strong>{requirement.requirementCode}</strong><span>{requirement.reason}</span></div>
                  <span className={`status-pill lifecycle-requirement--${requirement.status}`}>{STATUS_LABELS[requirement.status]}</span>
                </li>)}
              </ul>
              {operation.blockers.length > 0 && <div className="case-form-alert case-form-alert--error" role="alert"><AlertTriangle size={17} /><span>Normal kapanış eksik veya kontrol gerektiren evraklar nedeniyle engellendi.</span></div>}
              {operation.warnings.length > 0 && <div className="case-form-alert" role="status"><AlertTriangle size={17} /><span>Eksiklerle kapatma seçildi; gerekçe ve snapshot audit geçmişine yazılacak.</span></div>}
            </div>
          )}
          {message && <div className="case-form-alert case-form-alert--error" role="alert"><AlertTriangle size={17} /><span>{message}</span>{message.includes('değişti') && <button className="button button--secondary" type="button" onClick={onReload}><RefreshCw size={15} /> Güncel Veriyi Yükle</button>}</div>}
        </div>
        <footer className="modal__footer">
          <button className="button button--secondary" type="button" onClick={() => { polling.current = false; onClose() }} disabled={busy}>{completed ? 'Kapat' : 'Vazgeç'}</button>
          {operation === null
            ? <button className="button button--primary" type="button" onClick={preview} disabled={busy}>{busy ? 'Planlanıyor…' : 'Önizleme Oluştur'}</button>
            : operation.canApprove
              ? <button className="button button--danger" type="button" onClick={approve} disabled={busy || operation.blockers.length > 0}>{busy ? 'Kuyruğa alınıyor…' : isReopen ? 'Onayla ve Yeniden Aç' : 'Onayla ve Kapat'}</button>
              : null}
        </footer>
      </section>
    </div>
  )
}
