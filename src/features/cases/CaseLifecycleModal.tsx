import { useEffect, useMemo, useRef, useState } from 'react'
import { ModalFrame } from '../../components/ModalFrame'
import { AlertTriangle, CheckCircle2, LoaderCircle, RefreshCw, X } from 'lucide-react'
import { LifecycleCommandError, createHttpCaseLifecycleCommandAdapter, type CaseLifecycleCommandPort, type LifecycleOperationRecord, type LifecycleOperationStatus } from '../../data/caseLifecyclePort'
import type { CaseRecord, CaseStageCode } from '../../types/case'
import { CASE_STAGE_OPTIONS } from './caseForm'
import { DOCUMENT_LABELS } from './document-labels'

interface Props {
  readonly item: CaseRecord
  readonly onClose: () => void
  readonly onUpdated: (item: CaseRecord) => void
  readonly onUnauthorized: () => void
  readonly onReload: (item: CaseRecord) => void
  readonly port?: CaseLifecycleCommandPort
}

const STATUS_LABELS: Readonly<Record<string, string>> = {
  present: 'Mevcut', missing: 'Eksik', control_required: 'Kontrol gerekli', not_applicable: 'Uygulanmaz',
  calculable: 'Hesaplanabilir', no_value_loss: 'Değer kaybı yok',
}
const OPERATION_LABELS: Readonly<Record<LifecycleOperationStatus, string>> = {
  planned: 'Önizleme hazır', blocked: 'İşlem engellendi', approval_required: 'Onay bekliyor',
  approved: 'Onaylandı', queued: 'Sırada', moving: 'Klasör taşınıyor', verifying: 'Dosyalar doğrulanıyor',
  finalizing: 'Tamamlanıyor', closed: 'Dosya kapatıldı', reopened: 'Dosya yeniden açıldı',
  failed: 'İşlem başarısız', stale: 'Önizleme güncel değil', cancelled: 'İptal edildi',
  cleanup_pending: 'Klasör temizliği bekleniyor', manual_recovery_required: 'Kontrol gerekiyor',
}
const TERMINAL = new Set(['closed', 'reopened', 'failed', 'stale', 'cancelled', 'manual_recovery_required', 'cleanup_pending'])

function minorCurrency(value: number | null): string {
  return value === null
    ? 'Tutar uygulanmıyor'
    : new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(value / 100)
}

function safeError(error: unknown, hasOperation: boolean): string {
  if (!(error instanceof LifecycleCommandError)) return 'İşlem güvenli biçimde tamamlanamadı.'
  switch (error.kind) {
    case 'unauthorized': return 'Oturumunuz sona erdi. Yeniden giriş yapın.'
    case 'forbidden': return 'Bu işlem için yönetici, eksper veya dosya sorumlusu rolü gerekir.'
    case 'validation': {
      if (error.fields.includes('idempotency-key')) return 'İşlem bilgileri sunucuya eksik ulaştı. Yeniden önizleme oluşturun; sorun sürerse yöneticinize bildirin.'
      if (error.fields.includes('reason')) return 'En az 3 karakterlik bir gerekçe yazın; 500 karakteri aşmayın.'
      if (error.fields.includes('expectedCaseVersion') || error.fields.includes('expectedLocationVersion')) return 'Dosya veya klasör sürümü alınamadı. Dosyayı yeniden açıp önizlemeyi tekrar oluşturun.'
      return 'Form bilgileri kabul edilmedi. Kapatma seçimini ve gerekçenin 3 ile 500 karakter arasında olduğunu kontrol edin.'
    }
    case 'not_found': return 'Dosya veya işlem bulunamadı.'
    case 'conflict': {
      if (error.code === 'version_conflict') return 'Dosya başka bir işlemle değişti. Güncel veriyi yükleyebilirsiniz; seçiminiz ve gerekçeniz korunur.'
      if (error.code === 'destination_conflict') return 'Hedef klasör başka bir dosya veya işlem tarafından kullanılıyor. Hedef konumu kontrol edin.'
      if (error.code === 'lifecycle_stale') return hasOperation
        ? 'Önizlemeden sonra dosya, evrak veya klasör bilgileri değişmiş. Güncel verilerle yeniden önizleme oluşturun.'
        : 'Dosyanın klasör konumu doğrulanmamış veya kapanış hedefi mevcut klasör yapısıyla uyumlu değil. Klasör konumunu ve ihbar tarihini kontrol edin.'
      if (error.code === 'idempotency_conflict') return 'İşlem anahtarı başka bir istekle çakıştı. Önizlemeyi yeniden oluşturun.'
      return 'Dosyanın açık/kapalı durumu veya devam eden bir işlem bu kapanışa izin vermiyor. Mevcut işlem durumunu kontrol edin.'
    }
    case 'manual_recovery_required': return 'Fiziksel durum belirsiz; insan incelemesi gerekiyor.'
    case 'unavailable': return 'Sunucuya ulaşılamadı. Yeniden deneyin.'
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
  const [canReload, setCanReload] = useState(false)
  const polling = useRef(false)
  useEffect(() => () => { polling.current = false }, [])

  const handleError = (error: unknown) => {
    const typed = error instanceof LifecycleCommandError ? error : null
    if (typed?.kind === 'unauthorized') onUnauthorized()
    setCanReload(typed?.kind === 'conflict' && (typed.code === 'version_conflict' || typed.code === 'lifecycle_stale' && operation !== null))
    setMessage(safeError(error, operation !== null))
  }

  const reloadLatest = async () => {
    if (busy) return
    setBusy(true)
    try {
      const latest = await commands.readCase(item.caseId)
      if (latest.caseId !== item.caseId || latest.version === undefined) throw new LifecycleCommandError('unavailable','invalid case response')
      onReload(latest)
      setOperation(null);setCanReload(false)
      setMessage(latest.lifecycleStatus === (isReopen ? 'closed' : 'open') ? '' : 'Dosyanın açık/kapalı durumu değişmiş. Bu pencereyi kapatıp dosyanın güncel durumunu kontrol edin.')
    } catch (error) { handleError(error) }
    finally { setBusy(false) }
  }

  const preview = async () => {
    if (item.version === undefined) return setMessage('Dosya sürümü bulunamadı. Güncel veriyi yükleyin.')
    if ((isReopen || closeMode === 'with_missing_requirements') && reason.trim().length < 3) {
      return setMessage('Gerekçe en az 3 karakter olmalıdır.')
    }
    setBusy(true); setMessage('');setCanReload(false)
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
    if (polling.current) return
    polling.current = true
    while (polling.current) {
      await new Promise((resolve) => window.setTimeout(resolve, 1500))
      if (!polling.current) return
      try {
        const current = await commands.readOperation(item.caseId, operationId)
        if (!polling.current) return
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
      <ModalFrame className={`modal--case-lifecycle${operation === null ? ' modal--case-lifecycle-form' : ''}`} labelledBy="case-lifecycle-title" onClose={() => { polling.current = false; onClose() }} busy={busy}>
        <header className="modal__header">
          <h2 id="case-lifecycle-title">{isReopen ? 'Dosyayı Yeniden Aç' : 'Dosyayı Kapat'}</h2>
          <button className="icon-button" type="button" onClick={() => { polling.current = false; onClose() }} disabled={busy} aria-label="Pencereyi kapat"><X size={18} /></button>
        </header>
        <div className="modal__body case-lifecycle-scroll">
          {operation === null ? (
            <div className="case-lifecycle-form">
              <p className="form-hint">Önizlemeyi inceleyip onayladıktan sonra {isReopen ? 'dosya yeniden açılır.' : 'dosya ve çalışma klasörü kapatılır.'}</p>
              {!isReopen && <fieldset><legend>Kapanış yolu</legend>
                <label><input type="radio" checked={closeMode === 'normal'} onChange={() => setCloseMode('normal')} /> Normal kapanış</label>
                <label><input type="radio" checked={closeMode === 'with_missing_requirements'} onChange={() => setCloseMode('with_missing_requirements')} /> Eksiklerle kapat</label>
              </fieldset>}
              {isReopen && <label className="form-field"><span>Açılış aşaması</span><select value={targetStage} onChange={(event) => setTargetStage(event.target.value as Exclude<CaseStageCode, 'closed'>)}>
                {CASE_STAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select></label>}
              {(isReopen || closeMode === 'with_missing_requirements') && <label className="form-field"><span>Gerekçe</span><textarea autoFocus value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} required /></label>}
            </div>
          ) : (
            <div className="case-lifecycle-preview">
              <div className={`case-form-alert ${completed ? 'case-form-alert--success' : recovery ? 'case-form-alert--error' : ''}`} role="status">
                {completed ? <CheckCircle2 size={17} /> : recovery ? <AlertTriangle size={17} /> : <LoaderCircle className={operation.status === 'queued' || operation.status === 'moving' ? 'spin' : ''} size={17} />}
                <span><strong>{OPERATION_LABELS[operation.status]}</strong>{operation.status === 'cleanup_pending' ? ' · hedef doğrulandı, kaynak temizliği bekliyor' : ''}</span>
              </div>
              {operation.failureReasonCode && <div className="case-form-alert case-form-alert--error" role="alert"><AlertTriangle size={17} /><span>{operation.failureReasonCode === 'case_not_fresh' ? 'Klasörün güncelliği doğrulanamadı. İşlem tamamlanmadı.' : 'İşlem tamamlanamadı. Klasör ve işlem kayıtlarını kontrol edin.'}</span></div>}
              <dl className="case-lifecycle-paths">
                <div><dt>Kaynak</dt><dd>{operation.source.storageRootKey} · {operation.source.relativePath}</dd></div>
                <div><dt>Hedef</dt><dd>{operation.destination.storageRootKey} · {operation.destination.relativePath}</dd></div>
                {operation.operationType === 'close' && operation.source.storageRootKey === operation.destination.storageRootKey && operation.source.relativePath === operation.destination.relativePath && <div><dt>Klasör zaten kapalı dosyalar içinde</dt><dd>Onaydan sonra içeriği bulunduğu yerde doğrulanır ve programdaki kapanış tamamlanır.</dd></div>}
                <div><dt>Servis koşulu</dt><dd>{operation.requirementSummary.serviceEligibility?.reason ?? 'Servis atanmamış'}</dd></div>
              </dl>
              {operation.requirementSummary.valueLossSummary?.status === 'present' && (
                <section className="case-lifecycle-value-loss" aria-label="Değer kaybı kapanış özeti">
                  <header>
                    <div><span>Değer Kaybı Kapanış Özeti</span><strong>{STATUS_LABELS[operation.requirementSummary.valueLossSummary.status]}</strong></div>
                  </header>
                  <p>{operation.requirementSummary.valueLossSummary.reason}</p>
                  <dl>
                    <div><dt>Sonuç</dt><dd>{STATUS_LABELS[operation.requirementSummary.valueLossSummary.resultCode ?? ''] ?? 'Belirsiz'}</dd></div>
                    <div><dt>Tutar</dt><dd>{minorCurrency(operation.requirementSummary.valueLossSummary.amountMinor)}</dd></div>
                    <div><dt>Hesap Sürümü</dt><dd>{operation.requirementSummary.valueLossSummary.assessmentVersion === null ? '—' : `v${operation.requirementSummary.valueLossSummary.assessmentVersion}`}</dd></div>
                    <div><dt>Nihai Rapor</dt><dd>{operation.requirementSummary.valueLossSummary.reportId === null ? 'Bulunamadı' : 'Doğrulanmış rapor bağlı'}</dd></div>
                  </dl>
                </section>
              )}
              <div className="case-lifecycle-counts"><span>{operation.requirementSummary.missingCount} eksik</span><span>{operation.requirementSummary.controlRequiredCount} kontrol gerekli</span></div>
              <ul className="case-lifecycle-requirements">
                {operation.requirementSummary.requirements.map((requirement) => <li key={requirement.requirementCode}>
                  <div><strong>{DOCUMENT_LABELS[requirement.canonicalType] ?? requirement.reason}</strong>{DOCUMENT_LABELS[requirement.canonicalType] && <span>{requirement.reason}</span>}</div>
                  <span className={`status-pill lifecycle-requirement--${requirement.status}`}>{STATUS_LABELS[requirement.status]}</span>
                </li>)}
              </ul>
              <details className="operation-details"><summary>Kontrol bilgileri</summary><dl className="case-lifecycle-paths"><div><dt>Kural sürümleri</dt><dd>{operation.requirementSummary.documentRuleVersion} · {operation.requirementSummary.closureRuleVersion}</dd></div><div><dt>Servis kuralı</dt><dd>{operation.requirementSummary.serviceEligibility?.ruleVersion ?? '—'}</dd></div></dl></details>
              {operation.blockers.length > 0 && <div className="case-form-alert case-form-alert--error" role="alert"><AlertTriangle size={17} /><span>Normal kapanış eksik veya kontrol gerektiren evraklar nedeniyle engellendi.</span></div>}
              {operation.warnings.length > 0 && <div className="case-form-alert" role="status"><AlertTriangle size={17} /><span>Eksikler ve kapatma gerekçesi işlem geçmişine kaydedilir.</span></div>}
            </div>
          )}
          {message && <div className="case-form-alert case-form-alert--error" role="alert"><AlertTriangle size={17} /><span>{message}</span>{canReload && <button className="button button--secondary" type="button" disabled={busy} onClick={() => void reloadLatest()}><RefreshCw size={15} /> Güncel Veriyi Yükle</button>}{operation && !TERMINAL.has(operation.status) && <button className="button button--secondary" type="button" disabled={busy} onClick={() => { setMessage(''); void poll(operation.id) }}><RefreshCw size={15} /> Durumu yenile</button>}</div>}
        </div>
        <footer className="modal__footer">
          <button className="button button--secondary" type="button" onClick={() => { polling.current = false; onClose() }} disabled={busy}>{completed ? 'Kapat' : 'Vazgeç'}</button>
          {operation === null
            ? <button className="button button--primary" type="button" onClick={preview} disabled={busy || item.lifecycleStatus !== (isReopen ? 'closed' : 'open')}>{busy ? 'Planlanıyor…' : 'Önizleme Oluştur'}</button>
            : operation.canApprove
              ? <button className="button button--danger" type="button" onClick={approve} disabled={busy || operation.blockers.length > 0}>{busy ? 'Kuyruğa alınıyor…' : isReopen ? 'Onayla ve Yeniden Aç' : 'Onayla ve Kapat'}</button>
              : null}
        </footer>
      </ModalFrame>
  )
}
