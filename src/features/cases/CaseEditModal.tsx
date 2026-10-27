import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ModalFrame } from '../../components/ModalFrame'
import { AlertTriangle, LoaderCircle, RefreshCw, Save, Pencil, X } from 'lucide-react'
import type { SessionUser } from '../../data/authPort'
import { CaseCommandError, createHttpCaseCommandAdapter, type CaseCommandPort, type CaseUpdateInput } from '../../data/commandPort'
import type { CaseReferenceDataPort } from '../../data/ports'
import { useCaseReferences } from '../../data/useCaseReferences'
import type { CaseRecord, CaseStageCode } from '../../types/case'
import { eksistKey, matchEksistReference } from '@hasarbotu/domain'
import { ServiceRevisionDialog } from './ServiceRevisionDialog'
import { ServiceContactFields } from './ServiceContactFields'
import { serviceContactDraft, type ServiceContactDraft } from './service-contact'
import {
  CASE_STAGE_OPTIONS,
  VEHICLE_TRANSMISSION_OPTIONS,
  commandErrorMessage,
  commandFieldMessages,
  nullableText,
  serviceEvaluationSummary,
  serviceOptionLabel,
} from './caseForm'

interface CaseEditModalProps {
  readonly item: CaseRecord
  readonly currentUser: SessionUser
  readonly onClose: () => void
  readonly onUpdated: (item: CaseRecord) => void
  readonly onReload: () => void
  readonly onUnauthorized: () => void
  readonly commandPort?: CaseCommandPort
  readonly referencePort?: CaseReferenceDataPort
}

function FieldError({ message }: { readonly message?: string }) {
  return message === undefined ? null : <span className="form-field__error">{message}</span>
}

export function CaseEditModal({ item, onClose, onUpdated, onReload, onUnauthorized, commandPort, referencePort }: CaseEditModalProps) {
  const commands = useMemo(() => commandPort ?? createHttpCaseCommandAdapter(), [commandPort])
  const submittingRef = useRef(false)
  const [caseType, setCaseType] = useState<'' | 'traffic' | 'casco'>(item.type === 'Trafik' ? 'traffic' : item.type === 'Kasko' ? 'casco' : '')
  const [workflowStage, setWorkflowStage] = useState<CaseStageCode>(item.workflowStage ?? 'new_notification')
  const [serviceRevision, setServiceRevision] = useState<string | null>(null)
  const [serviceEditorOpen, setServiceEditorOpen] = useState(false)
  const [sourceText, setSourceText] = useState<string>()
  const [notificationFormNumber, setNotificationFormNumber] = useState(item.noticeNumber === '—' ? '' : item.noticeNumber)
  const [insurerClaimNumber, setInsurerClaimNumber] = useState(item.claimNumber === '—' ? '' : item.claimNumber)
  const [responsibleUserId, setResponsibleUserId] = useState(item.responsibleUserId ?? '')
  const [expertUserId, setExpertUserId] = useState(item.expertUserId ?? '')
  const [serviceId, setServiceId] = useState(item.serviceId ?? '')
  const initialService = { name: item.serviceDetails?.name ?? item.eksist?.serviceName ?? item.serviceProfile?.name ?? (item.service === '—' ? '' : item.service), phone: item.serviceDetails?.phone ?? '', address: item.serviceDetails?.address ?? '' }
  const [serviceDetails, setServiceDetails] = useState<ServiceContactDraft>(initialService)
  const [insurerId, setInsurerId] = useState(item.insurerId ?? '')
  const [lossDate, setLossDate] = useState(item.lossDate ?? '')
  const [notificationDate, setNotificationDate] = useState(item.notificationDate ?? '')
  const [transmission, setTransmission] = useState(item.transmission ?? 'unknown')
  const referenceData = useCaseReferences(referencePort, {
    ...(insurerId === '' ? {} : { insurerId }),
    ...(lossDate === '' ? {} : { evaluationDate: lossDate }),
    dateSource: 'loss_date',
    operation: 'closure_documents',
  })
  const [submitting, setSubmitting] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [generalError, setGeneralError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({})

  useEffect(() => {
    if (commandPort || !item.eksist) return
    const controller = new AbortController()
    fetch(`/api/v1/cases/${encodeURIComponent(item.caseId)}/eksist-sources`, { credentials: 'include', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('source_unavailable')
        const body = await response.json() as { items: { id: string; raw_text: string }[] }
        const source = body.items.find(source => source.id === item.eksist!.sourceId)
        if (!source) throw new Error('source_unavailable')
        setSourceText(source.raw_text)
      }).catch(() => { if (!controller.signal.aborted) { setSourceText(''); setGeneralError('SBM servis kaynağı yüklenemedi. Servis değiştirirken telefon ve adresi kontrol edip elle girin.'); } })
    return () => controller.abort()
  }, [commandPort, item.caseId, item.eksist])

  useEffect(() => {
    if (referenceData.status === 'unauthorized') onUnauthorized()
  }, [referenceData.status, onUnauthorized])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submittingRef.current) return
    if (!serviceDetails.name.trim() && (serviceDetails.phone.trim() || serviceDetails.address.trim())) { setGeneralError('Telefon ve adresi kaydetmek için servis adını girin.'); return }
    if (item.version === undefined) {
      setGeneralError('Güncelleme sürümü yüklenemedi. Dosyayı yeniden yükleyin.')
      return
    }

    const input: CaseUpdateInput = { expectedVersion: item.version }
    if (transmission !== (item.transmission ?? 'unknown')) Object.assign(input, { transmission })
    if (caseType && caseType !== (item.type === 'Trafik' ? 'traffic' : item.type === 'Kasko' ? 'casco' : '')) Object.assign(input, { caseType })
    if (workflowStage !== item.workflowStage) Object.assign(input, { workflowStage })
    if (serviceRevision !== null && serviceRevision !== item.eksist?.serviceName) Object.assign(input, { serviceRevision: { name: serviceRevision } })
    if (JSON.stringify(serviceDetails) !== JSON.stringify(initialService)) Object.assign(input, { serviceDetails: serviceDetails.name.trim() ? { name: serviceDetails.name.trim(), phone: serviceDetails.phone.trim() || null, address: serviceDetails.address.trim() || null } : null })
    if (nullableText(notificationFormNumber) !== (item.noticeNumber === '—' ? null : item.noticeNumber)) Object.assign(input, { notificationFormNumber: nullableText(notificationFormNumber) })
    if (nullableText(insurerClaimNumber) !== (item.claimNumber === '—' ? null : item.claimNumber)) Object.assign(input, { insurerClaimNumber: nullableText(insurerClaimNumber) })
    if (nullableText(responsibleUserId) !== (item.responsibleUserId ?? null)) Object.assign(input, { responsibleUserId: nullableText(responsibleUserId) })
    if (nullableText(expertUserId) !== (item.expertUserId ?? null)) Object.assign(input, { expertUserId: nullableText(expertUserId) })
    if (nullableText(serviceId) !== (item.serviceId ?? null)) Object.assign(input, { serviceId: nullableText(serviceId) })
    if (nullableText(insurerId) !== (item.insurerId ?? null)) Object.assign(input, { insurerId: nullableText(insurerId) })
    if (lossDate !== (item.lossDate ?? '')) Object.assign(input, { lossDate: lossDate === '' ? null : lossDate })
    if (notificationDate !== (item.notificationDate ?? '')) Object.assign(input, { notificationDate: notificationDate === '' ? null : notificationDate })

    if (Object.keys(input).length === 1) {
      setGeneralError('Kaydedilecek bir değişiklik yok.')
      return
    }

    submittingRef.current = true
    setSubmitting(true)
    setConflict(false)
    setGeneralError('')
    setFieldErrors({})
    try {
      const updated = await commands.updateCase(item.caseId, input)
      onUpdated(updated)
    } catch (error) {
      const safeError = error instanceof CaseCommandError
        ? error
        : new CaseCommandError('unavailable', 'unknown command failure')
      setConflict(safeError.kind === 'version_conflict')
      setGeneralError(commandErrorMessage(safeError))
      setFieldErrors(commandFieldMessages(safeError))
      if (safeError.kind === 'unauthorized') onUnauthorized()
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <>
      <ModalFrame className="modal--case-form" labelledBy="case-edit-title" onClose={onClose} busy={submitting} inert={serviceEditorOpen}>
        <form onSubmit={submit} noValidate>
          <header className="modal__header">
            <h2 id="case-edit-title">Temel Dosya Bilgilerini Düzenle</h2>
            <button className="icon-button" type="button" onClick={onClose} disabled={submitting} aria-label="Pencereyi kapat"><X size={18} /></button>
          </header>
          <div className="modal__body case-form-scroll">
            <p className="form-hint">Dosya türü değişirse evrak listesi yeniden değerlendirilir.</p>
            {generalError && <div className="case-form-alert case-form-alert--error" role="alert"><AlertTriangle size={17} /><span>{generalError}</span>{conflict && <button className="button button--secondary" type="button" onClick={onReload}><RefreshCw size={15} /> Güncel Veriyi Yükle</button>}</div>}
            {referenceData.status === 'loading' && <div className="case-form-note" role="status"><LoaderCircle className="spin" size={16} /><span>Seçenekler yükleniyor…</span></div>}
            {(referenceData.status === 'unavailable' || referenceData.status === 'unauthorized') && <div className="case-form-alert case-form-alert--error" role="alert"><AlertTriangle size={17} /><span>{referenceData.status === 'unauthorized' ? 'Referanslar için yeniden giriş gerekli.' : 'Seçenekler yüklenemedi.'}</span><button className="button button--secondary" type="button" onClick={referenceData.reload}>Yeniden Dene</button></div>}
            <fieldset className="case-form-grid" disabled={submitting}>
              <label className="form-field form-field--immutable"><span>Plaka</span><input value={item.plate} readOnly /></label>
              <label className="form-field"><span>Dosya türü</span><select value={caseType} onChange={event => setCaseType(event.target.value as typeof caseType)}>{!caseType && <option value="">Seçiniz</option>}<option value="traffic">Trafik</option><option value="casco">Kasko</option></select><FieldError message={fieldErrors.caseType} /></label>
              <label className="form-field"><span>Vites</span><select value={transmission} onChange={event => setTransmission(event.target.value as typeof transmission)}>{VEHICLE_TRANSMISSION_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><FieldError message={fieldErrors.transmission} /></label>
              <label className="form-field form-field--immutable"><span>Ofis dosya numarası</span><input value={item.officeNumber} readOnly /></label>
              <label className="form-field form-field--immutable"><span>Dosya durumu</span><input value="Açık" readOnly /></label>
              <label className="form-field"><span>Aşama</span><select autoFocus value={workflowStage} onChange={(event) => setWorkflowStage(event.target.value as CaseStageCode)}>{CASE_STAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><FieldError message={fieldErrors.workflowStage} /></label>
              <label className="form-field"><span>Takip tarihi</span><input value={item.followUpDate ?? "—"} readOnly /></label>
              <label className="form-field"><span>İhbar numarası</span><input readOnly={item.eksist !== undefined} value={notificationFormNumber} onChange={(event) => setNotificationFormNumber(event.target.value)} autoComplete="off" aria-invalid={fieldErrors.notificationFormNumber !== undefined} /><FieldError message={fieldErrors.notificationFormNumber} /></label>
              <label className="form-field"><span>Hasar dosya numarası</span><input value={insurerClaimNumber} onChange={(event) => setInsurerClaimNumber(event.target.value)} autoComplete="off" aria-invalid={fieldErrors.insurerClaimNumber !== undefined} /><FieldError message={fieldErrors.insurerClaimNumber} /></label>
              <label className="form-field"><span>Sorumlu</span><select value={responsibleUserId} onChange={(event) => setResponsibleUserId(event.target.value)} disabled={referenceData.status !== 'ok'}><option value="">Atanmadı</option>{item.responsibleUserId && !referenceData.references?.users.some((option) => option.id === item.responsibleUserId) && <option value={item.responsibleUserId}>Mevcut sorumlu · pasif/erişilemez</option>}{referenceData.references?.users.map((option) => <option key={option.id} value={option.id}>{option.displayName}</option>)}</select><FieldError message={fieldErrors.responsibleUserId} /></label>
              <label className="form-field"><span>Sigorta şirketi</span><select value={insurerId} onChange={(event) => setInsurerId(event.target.value)} disabled={referenceData.status !== 'ok'}><option value="" disabled={!!item.eksist}>{item.eksist?.insurerName ?? 'Seçilmedi'}</option>{item.insurerId && !referenceData.references?.insurers.some((option) => option.id === item.insurerId) && <option value={item.insurerId}>{item.eksist?.insurerName ?? 'Mevcut sigorta şirketi'} · pasif</option>}{referenceData.references?.insurers.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select><FieldError message={fieldErrors.insurerId} />{referenceData.status === 'ok' && referenceData.references?.insurers.length === 0 && <small>Aktif şirket bulunamadı. Yönetim → Sigorta Şirketleri bölümünden ekleyebilirsiniz.</small>}</label>
              {item.eksist ? <div className="form-field"><label><span>Servis</span><input aria-label="Servis" value={serviceRevision ?? item.eksist.serviceName} readOnly /></label><button type="button" className="icon-button" aria-label="Servisi revize et" disabled={!commandPort && sourceText === undefined} onClick={() => setServiceEditorOpen(true)}><Pencil size={17} /></button><FieldError message={fieldErrors.serviceRevision} /></div> : <label className="form-field"><span>Servis</span><select aria-label="Servis" value={serviceId} onChange={(event) => { setServiceId(event.target.value); const option = referenceData.references?.services.find(option => option.id === event.target.value); setServiceDetails(serviceContactDraft(option?.name ?? "", referenceData.references?.services ?? [])) }} disabled={referenceData.status !== 'ok'}><option value="">Seçilmedi</option>{item.serviceId && !referenceData.references?.services.some((option) => option.id === item.serviceId) && <option value={item.serviceId}>Mevcut servis · pasif/erişilemez</option>}{referenceData.references?.services.map((option) => <option key={option.id} value={option.id}>{serviceOptionLabel(option)}</option>)}</select><small>{serviceEvaluationSummary(referenceData.references?.services.find((option) => option.id === serviceId) ?? item.serviceProfile)}</small><FieldError message={fieldErrors.serviceId} /></label>}
              <ServiceContactFields value={serviceDetails} options={referenceData.references?.services ?? []} nameReadOnly={!!item.eksist} onChange={value => { setServiceDetails(value); if (!item.eksist && eksistKey(value.name) !== eksistKey(serviceDetails.name)) setServiceId(matchEksistReference(value.name, referenceData.references?.services ?? []) ?? '') }} />
              {item.eksist ? <label className="form-field"><span>Eksper</span><input value={item.eksist.expertName} readOnly /></label> : <label className="form-field"><span>Eksper</span><select value={expertUserId} onChange={(event) => setExpertUserId(event.target.value)} disabled={referenceData.status !== 'ok'}><option value="">Atanmadı</option>{item.expertUserId && !referenceData.references?.experts.some((option) => option.id === item.expertUserId) && <option value={item.expertUserId}>Mevcut eksper · pasif/uygun değil</option>}{referenceData.references?.experts.map((option) => <option key={option.id} value={option.id}>{option.displayName}</option>)}</select><FieldError message={fieldErrors.expertUserId} /></label>}
              <label className="form-field"><span>Hasar tarihi</span><input type="date" value={lossDate} onChange={(event) => setLossDate(event.target.value)} aria-invalid={fieldErrors.lossDate !== undefined} /><small>Boş bırakılırsa tarih kaldırılır.</small><FieldError message={fieldErrors.lossDate} /></label>
              <label className="form-field"><span>İhbar tarihi</span><input type="date" value={notificationDate} onChange={(event) => setNotificationDate(event.target.value)} aria-invalid={fieldErrors.notificationDate !== undefined} /><small>Hasar tarihinden önce olamaz.</small><FieldError message={fieldErrors.notificationDate} /></label>
            </fieldset>
          </div>
          <footer className="modal__footer">
            <button className="button button--secondary" type="button" onClick={onClose} disabled={submitting}>İptal</button>
            <button className="button button--primary" type="submit" disabled={submitting || referenceData.status !== 'ok'}>{submitting ? <><LoaderCircle className="spin" size={16} /> Kaydediliyor…</> : <><Save size={16} /> Değişiklikleri Kaydet</>}</button>
          </footer>
        </form>
      </ModalFrame>
      {serviceEditorOpen && <ServiceRevisionDialog name={serviceRevision ?? item.eksist?.serviceName ?? ""} details={serviceDetails} sourceText={sourceText} options={referenceData.references?.services ?? []} onClose={() => setServiceEditorOpen(false)} onSave={(name, details) => { setServiceDetails(details); setServiceRevision(name); setServiceEditorOpen(false) }} />}
    </>
  )
}
