import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, CheckCircle2, FilePlus2, LoaderCircle, Pencil, X } from 'lucide-react'
import { useNavigate } from 'react-router'
import type { SessionUser } from '../../data/authPort'
import { CaseCommandError, createHttpCaseCommandAdapter, type CaseCommandPort, type CaseCreateInput } from '../../data/commandPort'
import type { CaseReferenceDataPort } from '../../data/ports'
import { useCaseReferences } from '../../data/useCaseReferences'
import type { CaseStageCode } from '../../types/case'
import type { QuickCaseCreate } from '@hasarbotu/contracts'
import { matchEksistReference } from '@hasarbotu/domain'
import { createEksistPort, type EksistPort, type EksistSource, type QuickCreation } from '../../data/eksistPort'
import { createHttpWorkspaceCommandAdapter, type WorkspaceCommandPort, type WorkspaceRootRecord } from '../../data/workspacePort'
import { EksistImportPanel } from './EksistImportPanel'
import { ServiceRevisionDialog } from './ServiceRevisionDialog'
import { EksistVehicleFields } from './EksistVehicleFields'
import {
  CASE_STAGE_OPTIONS,
  commandErrorMessage,
  commandFieldMessages,
  makeSubmissionKey,
  normalizePlateInput,
  optionalText,
  serviceEvaluationSummary,
  serviceOptionLabel,
} from './caseForm'

interface CaseCreateModalProps {
  readonly currentUser: SessionUser
  readonly onClose: () => void
  readonly onUnauthorized: () => void
  readonly commandPort?: CaseCommandPort
  readonly referencePort?: CaseReferenceDataPort
  readonly eksistPort?: EksistPort
  readonly workspacePort?: WorkspaceCommandPort
}

interface StableAttempt {
  readonly fingerprint: string
  readonly key: string
}

function FieldError({ message }: { readonly message?: string }) {
  return message === undefined ? null : <span className="form-field__error">{message}</span>
}

export function CaseCreateModal({ currentUser, onClose, onUnauthorized, commandPort, referencePort, eksistPort, workspacePort }: CaseCreateModalProps) {
  const navigate = useNavigate()
  const commands = useMemo(() => commandPort ?? createHttpCaseCommandAdapter(), [commandPort])
  const submittingRef = useRef(false)
  const attemptRef = useRef<StableAttempt | null>(null)
  const [caseType, setCaseType] = useState<'traffic' | 'casco' | ''>('traffic')
  const [plate, setPlate] = useState('')
  const [notificationFormNumber, setNotificationFormNumber] = useState('')
  const [insurerClaimNumber, setInsurerClaimNumber] = useState('')
  const [workflowStage, setWorkflowStage] = useState<CaseStageCode>('new_notification')
  const [responsibleUserId, setResponsibleUserId] = useState(currentUser.id)
  const [expertUserId, setExpertUserId] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [insurerId, setInsurerId] = useState('')
  const [lossDate, setLossDate] = useState('')
  const [notificationDate, setNotificationDate] = useState('')
  const referenceData = useCaseReferences(referencePort, {
    ...(insurerId === '' ? {} : { insurerId }),
    ...(lossDate === '' ? {} : { evaluationDate: lossDate }),
    dateSource: 'loss_date',
    operation: 'closure_documents',
  })
  const [submitting, setSubmitting] = useState(false)
  const [generalError, setGeneralError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({})
  const canProvision = currentUser.roles.some(role => ['admin', 'expert', 'case_manager'].includes(role))
  const quickMode = canProvision && (commandPort === undefined || eksistPort !== undefined)
  const eksist = useMemo(() => eksistPort ?? createEksistPort(), [eksistPort])
  const workspace = useMemo(() => workspacePort ?? createHttpWorkspaceCommandAdapter(), [workspacePort])
  const [roots, setRoots] = useState<readonly WorkspaceRootRecord[]>([])
  const [rootKey, setRootKey] = useState('')
  const [source, setSource] = useState<EksistSource | null>(null)
  const [expertReviewName, setExpertReviewName] = useState('')
  const [expertReviewed, setExpertReviewed] = useState(false)
  const [serviceRevision, setServiceRevision] = useState<string | null>(null)
  const [serviceEditorOpen, setServiceEditorOpen] = useState(false)
  const [reference, setReference] = useState('')
  const [unresolved, setUnresolved] = useState<Record<string, string>>({})
  const [brand, setBrand] = useState(''), [model, setModel] = useState(''), [modelYear, setModelYear] = useState('')
  const [vehicleClass, setVehicleClass] = useState('')
  const [creation, setCreation] = useState<QuickCreation | null>(null)
  const [locked, setLocked] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const quickAttempt = useRef<{ input: QuickCaseCreate; key: string } | null>(null)
  const destination = useRef<'detail' | 'list'>('detail')

  useEffect(() => {
    if (!quickMode) return
    let cancelled = false
    workspace.listActiveRoots().then(items => { if (!cancelled) { setRoots(items); if (items.length === 1) setRootKey(items[0]!.rootKey) } }).catch(() => { if (!cancelled) setGeneralError('Çalışma klasörü kökleri yüklenemedi. Formu yeniden açıp deneyin.') })
    return () => { cancelled = true }
  }, [quickMode, workspace])

  useEffect(() => {
    if (!creation) return
    if (creation.provisioning?.status === 'ready' && !creation.duplicate) {
      onClose()
      navigate(destination.current === 'list' ? '/dosyalar' : `/dosyalar/${creation.case.caseId}`, { replace: true, state: { creationResult: { caseId: creation.case.caseId, officeNumber: creation.case.officeNumber, plate: creation.case.plate } } })
      return
    }
    if (!creation.provisioning || !['queued', 'approved', 'applying', 'verifying'].includes(creation.provisioning.status)) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      workspace.readPlan(creation.case.caseId, creation.provisioning!.id).then(provisioning => { if (!cancelled) setCreation({ ...creation, provisioning }) }).catch(() => {
        if (!cancelled) { setGeneralError('Dosya kaydedildi; klasör durumu okunamadı. Yeniden deneme aynı kaydı kullanır.'); setCreation({ ...creation, provisioning: null }) }
      })
    }, 1000)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [creation, workspace, navigate, onClose])

  function imported(value: EksistSource) {
    const data = value.extraction, refs = referenceData.references
    setSource(value); setReference(data.reference); setPlate(data.plate); setInsurerClaimNumber(data.claimNumber); setLossDate(data.lossDate)
    setExpertReviewName(data.expert); setExpertReviewed(false)
    setNotificationFormNumber(data.assignmentDateText); setServiceRevision(null)
    setCaseType(data.caseType ?? ''); setBrand(data.brand); setModel(data.model); setModelYear(data.modelYear); setVehicleClass(data.vehicleClass)
    const issues: Record<string, string> = {}
    if (!data.caseType) issues.caseType = 'Ürün eşleşmedi. Dosya türünü seçin.'
    const matches = [
      { field: 'insurerId', value: data.insurer, options: refs?.insurers ?? [], set: setInsurerId },
      { field: 'serviceId', value: data.service, options: refs?.services ?? [], set: setServiceId },
      { field: 'expertUserId', value: data.expert, options: (refs?.experts ?? []).map(item => ({ id: item.id, name: item.displayName })), set: setExpertUserId },
    ]
    for (const item of matches) {
      const matched = matchEksistReference(item.value, item.options, item.field === 'insurerId')
      item.set(matched ?? '')
    }
    const conflictFields: Record<string, string> = { urun: 'caseType', plaka: 'plate', hasardosyano: 'insurerClaimNumber', hasarzamani: 'lossDate', hasartarihi: 'lossDate', talepislemrefno: 'reference', sigortasirketi: 'insurerId', tamirhaneadunvan: 'serviceId', eksperadsoyad: 'expertUserId', marka: 'brand', aractipi: 'model', modelyili: 'modelYear', aractarifegrubu: 'vehicleClass' }
    for (const conflict of data.conflicts) if (conflictFields[conflict]) issues[conflictFields[conflict]!] = 'Kaynakta birden fazla değer var. Alanı kontrol ederek düzeltin.'
    if (!data.assignmentDate) issues.notificationFormNumber = 'Eksper atama tarihi kaynakta eksik veya okunamadı. Belgeyi yeniden aktarın.'
    if (!data.insurer) issues.insurerId = 'Sigorta şirketi kaynakta bulunamadı. Belgeyi yeniden aktarın.'
    if (!data.expert && value.method !== 'ocr') issues.expertUserId = 'Eksper bilgisi kaynakta bulunamadı. Belgeyi yeniden aktarın.'
    if (['Plaka', 'Marka', 'Araç Tipi', 'Model Yılı', 'Araç Tarife Grubu', 'Motor No', 'Şasi No'].some(label => !data.vehicleFields[label])) issues.vehicle = 'Araç bilgileri eksik; belgeyi yeniden aktarın.'
    setUnresolved(issues); setFieldErrors(issues)
  }

  function resolved(field: string) {
    setUnresolved(previous => { const next = { ...previous }; delete next[field]; return next })
    setFieldErrors(previous => { const next = { ...previous }; delete next[field]; return next })
  }

  useEffect(() => {
    if (referenceData.status === 'unauthorized') onUnauthorized()
  }, [referenceData.status, onUnauthorized])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submittingRef.current || extracting) return
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
    destination.current = submitter?.value === 'list' ? 'list' : 'detail'

    const canonicalPlate = normalizePlateInput(plate)
    if (caseType === '') { setFieldErrors({ ...unresolved, caseType: 'Dosya türünü seçin.' }); return }
    if (canonicalPlate === '') {
      setFieldErrors({ plate: 'Plaka zorunludur.' })
      return
    }

    const input: CaseCreateInput = {
      caseType,
      plate: canonicalPlate,
      workflowStage,
      ...(optionalText(notificationFormNumber) === undefined ? {} : { notificationFormNumber: optionalText(notificationFormNumber) }),
      ...(optionalText(insurerClaimNumber) === undefined ? {} : { insurerClaimNumber: optionalText(insurerClaimNumber) }),
      ...(optionalText(responsibleUserId) === undefined ? {} : { responsibleUserId: optionalText(responsibleUserId) }),
      ...(optionalText(expertUserId) === undefined ? {} : { expertUserId: optionalText(expertUserId) }),
      ...(optionalText(serviceId) === undefined ? {} : { serviceId: optionalText(serviceId) }),
      ...(optionalText(insurerId) === undefined ? {} : { insurerId: optionalText(insurerId) }),
      ...(lossDate === '' ? {} : { lossDate }),
      ...(notificationDate === '' ? {} : { notificationDate }),
    }
    if (quickMode) {
      if (!quickAttempt.current) {
        const errors: Record<string, string> = { ...unresolved }
        if (source?.method === 'ocr' && (!expertReviewed || !expertReviewName.trim())) errors.expertUserId = 'Eksper adını orijinal belgeyle karşılaştırıp doğrulayın. Doğrulayamıyorsanız kaynak metni aktarın.'
        if (!notificationDate) errors.notificationDate = 'Çalışma klasörü için ihbar tarihi zorunludur. Atama tarihi ihbar tarihi değildir.'
        if (!rootKey) errors.storageRootKey = 'Çalışma klasörü konumunu seçin.'
        if (source && !/^[A-Za-z0-9/-]{1,80}$/.test(reference.trim())) errors.reference = 'Eksist talep referansını kontrol edin.'
        const hasVehicle = Boolean(brand.trim() && model.trim() && modelYear && vehicleClass)
        if (modelYear && (!/^\d{4}$/.test(modelYear) || Number(modelYear) < 1950 || Number(modelYear) > 2100)) errors.modelYear = 'Geçerli model yılı girin veya isteğe bağlı alanı boş bırakın.'
        if (Object.keys(errors).length) { setFieldErrors(errors); return }
        quickAttempt.current = { key: makeSubmissionKey(), input: { case: { ...input, workflowStage: workflowStage as Exclude<CaseStageCode, 'closed'>, notificationDate }, storageRootKey: rootKey,
          ...(source ? { source: { id: source.id, reference: reference.trim(), ...(source.method === 'ocr' ? { expertReview: { name: expertReviewName.trim(), confirmed: true as const } } : {}), ...(serviceRevision === null ? {} : { serviceRevision: { name: serviceRevision } }), ...(!hasVehicle ? { vehicleDraft: { brand, model, modelYear, vehicleClass } } : {}) } } : {}),
          ...(hasVehicle ? { vehicle: { brand: brand.trim(), model: model.trim(), modelYear: Number(modelYear), vehicleClass: vehicleClass as NonNullable<QuickCaseCreate['vehicle']>['vehicleClass'], variant: null, chassisPrefix: null, engineCode: null, evidenceSource: 'insurer_record', evidenceReference: source ? `Eksist ${reference.trim()}` : null } } : {}),
        } }
      }
      submittingRef.current = true; setSubmitting(true); setLocked(true); setGeneralError('')
      const attempt = quickAttempt.current!
      try { setCreation(await eksist.create(attempt.input, attempt.key)) }
      catch (error) {
        const safe = error instanceof CaseCommandError ? error : new CaseCommandError('unavailable', 'Unknown failure')
        setGeneralError(commandErrorMessage(safe)); setFieldErrors(commandFieldMessages(safe))
        if (safe.kind === 'validation' || safe.kind === 'unknown_reference') { quickAttempt.current = null; setLocked(false) }
        if (safe.kind === 'unauthorized') onUnauthorized()
      } finally { submittingRef.current = false; setSubmitting(false) }
      return
    }
    const fingerprint = JSON.stringify(input)
    try {
      if (attemptRef.current?.fingerprint !== fingerprint) {
        attemptRef.current = { fingerprint, key: makeSubmissionKey() }
      }
    } catch {
      setGeneralError('Güvenli tekrar anahtarı üretilemedi. Bu tarayıcıda oluşturma yapılamıyor.')
      return
    }

    submittingRef.current = true
    setSubmitting(true)
    setGeneralError('')
    setFieldErrors({})
    try {
      const created = await commands.createCase(input, attemptRef.current.key)
      navigate(`/dosyalar/${created.caseId}`, {
        replace: true,
        state: {
          creationResult: {
            caseId: created.caseId,
            officeNumber: created.officeNumber,
            plate: created.plate,
          },
        },
      })
    } catch (error) {
      const safeError = error instanceof CaseCommandError
        ? error
        : new CaseCommandError('unavailable', 'unknown command failure')
      setGeneralError(commandErrorMessage(safeError))
      setFieldErrors(commandFieldMessages(safeError))
      if (safeError.kind === 'unauthorized') onUnauthorized()
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target && !submitting) onClose()
    }}>
      <section className="modal modal--case-form" role="dialog" aria-modal="true" aria-labelledby="new-notice-title" aria-busy={submitting} inert={serviceEditorOpen}>
        <form onSubmit={submit} noValidate>
          <header className="modal__header">
            <div><span className="eyebrow">Gerçek API · güvenli oluşturma</span><h2 id="new-notice-title">Yeni İhbar Oluştur</h2></div>
            <button className="icon-button" type="button" onClick={onClose} disabled={submitting} aria-label="Pencereyi kapat"><X size={18} /></button>
          </header>
          <div className="modal__body case-form-scroll">
            <div className="case-form-note"><CheckCircle2 size={16} /><span>Ofis dosya numarası backend tarafından otomatik atanır. Çift gönderim aynı idempotency anahtarıyla korunur.</span></div>
            {generalError && <div className="case-form-alert case-form-alert--error" role="alert"><AlertTriangle size={17} /><span>{generalError}</span></div>}
            {creation && <div role="status" className="case-form-note">{creation.duplicate ? 'Bu Eksist talebi zaten aktarılmış. Yeni dosya oluşturulmadı.' : `Dosya ${creation.case.officeNumber} kaydedildi.`} {creation.provisioning?.status === 'ready' ? 'Çalışma klasörü doğrulandı.' : creation.provisioning?.status === 'failed' ? `Klasör oluşturulamadı (${creation.provisioning.lastErrorCode ?? 'hata'}). Yeniden deneme aynı dosya ve klasörü kullanır.` : 'Çalışma klasörü henüz doğrulanmadı; işlem tamamlanmış sayılmıyor.'}
              {creation.duplicate && <button type="button" onClick={() => { onClose(); navigate(`/dosyalar/${creation.case.caseId}`) }}>Mevcut dosyayı aç</button>}
            </div>}
            {quickMode && <EksistImportPanel port={eksist} onImported={imported} disabled={locked || submitting || referenceData.status !== 'ok'} onUnauthorized={onUnauthorized} onBusyChange={setExtracting} />}
            {referenceData.status === 'loading' && <div className="case-form-note" role="status"><LoaderCircle className="spin" size={16} /><span>Aktif referans listeleri yükleniyor…</span></div>}
            {(referenceData.status === 'unavailable' || referenceData.status === 'unauthorized') && <div className="case-form-alert case-form-alert--error" role="alert"><AlertTriangle size={17} /><span>{referenceData.status === 'unauthorized' ? 'Referanslar için yeniden giriş gerekli.' : 'Referans listeleri yüklenemedi; sahte seçenek kullanılmadı.'}</span><button className="button button--secondary" type="button" onClick={referenceData.reload}>Yeniden Dene</button></div>}
            <fieldset disabled={locked || submitting || extracting} className="case-form-grid" onChange={event => { const field = (event.target as HTMLElement).closest('label')?.getAttribute('data-field'); if (field) resolved(field) }}>
              <label className="form-field" data-field="caseType"><span>Dosya türü *</span><select value={caseType} onChange={(event) => setCaseType(event.target.value as 'traffic' | 'casco')}><option value="" disabled>Seçin</option><option value="traffic">Trafik</option><option value="casco">Kasko</option></select><FieldError message={fieldErrors.caseType} /></label>
              <label className="form-field" data-field="plate"><span>Plaka *</span><input autoFocus value={plate} onChange={(event) => setPlate(event.target.value)} onBlur={() => setPlate(normalizePlateInput(plate))} placeholder="34 MPA 764" autoComplete="off" aria-invalid={fieldErrors.plate !== undefined} /><FieldError message={fieldErrors.plate} /></label>
              <label className="form-field"><span>İhbar numarası</span><input aria-label="İhbar numarası" value={notificationFormNumber} readOnly={source !== null} onChange={(event) => setNotificationFormNumber(event.target.value)} autoComplete="off" aria-invalid={fieldErrors.notificationFormNumber !== undefined} />{source && <small>Eksper atama tarihinden otomatik alınır.</small>}<FieldError message={fieldErrors.notificationFormNumber} /></label>
              <label className="form-field" data-field="insurerClaimNumber"><span>Hasar dosya numarası</span><input value={insurerClaimNumber} onChange={(event) => setInsurerClaimNumber(event.target.value)} autoComplete="off" aria-invalid={fieldErrors.insurerClaimNumber !== undefined} /><FieldError message={fieldErrors.insurerClaimNumber} /></label>
              <label className="form-field"><span>İlk workflow aşaması *</span><select value={workflowStage} onChange={(event) => setWorkflowStage(event.target.value as CaseStageCode)}>{CASE_STAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><FieldError message={fieldErrors.workflowStage} /></label>
              <label className="form-field"><span>Takip tarihi</span><input aria-label="Takip tarihi" value="Kayıt günü · otomatik" readOnly /><small>Sunucu, Türkiye saatine göre kayıt gününü atar.</small></label>
              <label className="form-field"><span>Sorumlu</span><select value={responsibleUserId} onChange={(event) => setResponsibleUserId(event.target.value)} disabled={referenceData.status !== 'ok'}><option value="">Atanmadı</option>{referenceData.references?.users.map((option) => <option key={option.id} value={option.id}>{option.displayName}</option>)}</select><FieldError message={fieldErrors.responsibleUserId} /></label>
              {source ? <label className="form-field"><span>Sigorta şirketi</span><input aria-label="Sigorta şirketi" value={source.extraction.insurer} readOnly /><small>Eksist kaynağından otomatik alınır.</small><FieldError message={fieldErrors.insurerId} /></label> : <label className="form-field" data-field="insurerId"><span>Sigorta şirketi</span><select value={insurerId} onChange={(event) => setInsurerId(event.target.value)} disabled={referenceData.status !== 'ok'}><option value="">Seçilmedi</option>{referenceData.references?.insurers.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select><FieldError message={fieldErrors.insurerId} />{unresolved.insurerId && <button type="button" onClick={() => { setInsurerId(''); resolved('insurerId') }}>Eşleştirmeden kaynakta sakla</button>}</label>}
              {source ? <div className="form-field"><label><span>Servis</span><input aria-label="Servis" value={serviceRevision ?? source.extraction.service} readOnly /></label><button type="button" className="icon-button" aria-label="Servisi revize et" onClick={() => setServiceEditorOpen(true)}><Pencil size={17} /></button><FieldError message={fieldErrors.serviceId} /></div> : <label className="form-field" data-field="serviceId"><span>Servis</span><select aria-label="Servis" value={serviceId} onChange={(event) => setServiceId(event.target.value)} disabled={referenceData.status !== 'ok'}><option value="">Seçilmedi</option>{referenceData.references?.services.map((option) => <option key={option.id} value={option.id}>{serviceOptionLabel(option)}</option>)}</select><small>{serviceEvaluationSummary(referenceData.references?.services.find((option) => option.id === serviceId))}</small><FieldError message={fieldErrors.serviceId} />{unresolved.serviceId && <button type="button" onClick={() => { setServiceId(''); resolved('serviceId') }}>Eşleştirmeden kaynakta sakla</button>}</label>}
              {source ? <label className="form-field"><span>Eksper</span><input aria-label="Eksper" value={source.extraction.expert} readOnly /><small>Levha no: {source.extraction.expertLicenseNumber || "Kaynakta belirtilmedi"}</small><FieldError message={fieldErrors.expertUserId} /></label> : <label className="form-field" data-field="expertUserId"><span>Eksper</span><select value={expertUserId} onChange={(event) => setExpertUserId(event.target.value)} disabled={referenceData.status !== 'ok'}><option value="">Atanmadı</option>{referenceData.references?.experts.map((option) => <option key={option.id} value={option.id}>{option.displayName}</option>)}</select><FieldError message={fieldErrors.expertUserId} />{unresolved.expertUserId && <button type="button" onClick={() => { setExpertUserId(''); resolved('expertUserId') }}>Eşleştirmeden kaynakta sakla</button>}</label>}
              <label className="form-field" data-field="lossDate"><span>Hasar tarihi</span><input type="date" value={lossDate} onChange={(event) => setLossDate(event.target.value)} aria-invalid={fieldErrors.lossDate !== undefined} /><small>LocalDate; saat içermez.</small><FieldError message={fieldErrors.lossDate} /></label>
              <label className="form-field"><span>İhbar tarihi</span><input type="date" value={notificationDate} onChange={(event) => setNotificationDate(event.target.value)} aria-invalid={fieldErrors.notificationDate !== undefined} /><small>Hasar tarihinden önce olamaz.</small><FieldError message={fieldErrors.notificationDate} /></label>
              {quickMode && <label className="form-field"><span>Çalışma klasörü konumu *</span><select value={rootKey} onChange={event => setRootKey(event.target.value)}><option value="">Seçin</option>{roots.map(root => <option key={root.rootKey} value={root.rootKey}>{root.label}</option>)}</select><FieldError message={fieldErrors.storageRootKey} /></label>}
              {source && <>
                <label className="form-field" data-field="reference"><span>Eksist talep referansı *</span><input value={reference} onChange={event => setReference(event.target.value)} /><FieldError message={fieldErrors.reference} /></label>
                <label className="form-field" data-field="brand"><span>Marka</span><input readOnly value={brand} maxLength={60} onChange={event => setBrand(event.target.value)} /><FieldError message={fieldErrors.brand} /></label>
                <label className="form-field" data-field="model"><span>Model</span><input readOnly value={model} maxLength={60} onChange={event => setModel(event.target.value)} /><FieldError message={fieldErrors.model} /></label>
                <label className="form-field" data-field="modelYear"><span>Model yılı</span><input readOnly value={modelYear} onChange={event => setModelYear(event.target.value)} /><FieldError message={fieldErrors.modelYear} /></label>
                <label className="form-field" data-field="vehicleClass"><span>Araç sınıfı</span><select disabled value={vehicleClass} onChange={event => setVehicleClass(event.target.value)}><option value="">Seçilmedi</option><option value="passenger_car">Otomobil</option><option value="light_commercial">Hafif ticari</option><option value="heavy_commercial">Ağır ticari</option><option value="motorcycle">Motosiklet</option><option value="trailer">Römork</option><option value="other">Diğer</option></select><FieldError message={fieldErrors.vehicleClass} /></label>
              </>}
            </fieldset>
            {source?.method === 'ocr' && <div role="group" aria-label="OCR eksper doğrulaması">
              <p>OCR, I ve İ harflerini karıştırabilir. Eksper adını orijinal belgeyle karşılaştırın; gerekiyorsa düzeltin. Doğrulayamıyorsanız Eksist kaynak metnini aktarın.</p>
              <label className="form-field"><span>Doğrulanan eksper adı</span><input value={expertReviewName} onChange={event => { setExpertReviewName(event.target.value); setExpertReviewed(false) }} maxLength={500} /></label>
              <label><input type="checkbox" checked={expertReviewed} onChange={event => { setExpertReviewed(event.target.checked); setFieldErrors(previous => { const next = { ...previous }; delete next.expertUserId; return next }) }} />Eksper adını orijinal belgeyle karşılaştırdım ve doğruladım</label>
            </div>}
            {source && <><EksistVehicleFields fields={source.extraction.vehicleFields} /><FieldError message={fieldErrors.vehicle} /><details><summary>Kaynak ve ek bilgiler ({source.method === 'ocr' ? 'OCR — alanları kontrol edin' : 'Eksist'})</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{source.text}</pre></details></>}
          </div>
          <footer className="modal__footer">
            <button className="button button--secondary" type="button" onClick={onClose} disabled={submitting}>İptal</button>
            {quickMode ? <>
              <button className="button button--secondary" type="submit" value="list" disabled={submitting || extracting || referenceData.status !== 'ok' || Boolean(creation?.provisioning && ['queued','approved','applying','verifying'].includes(creation.provisioning.status)) || creation?.duplicate}>Kaydet ve kapat</button>
              <button className="button button--primary" type="submit" value="detail" disabled={submitting || extracting || referenceData.status !== 'ok' || Boolean(creation?.provisioning && ['queued','approved','applying','verifying'].includes(creation.provisioning.status)) || creation?.duplicate}>{submitting ? 'Kaydediliyor…' : locked ? 'Aynı kaydı yeniden dene' : 'Kaydet ve detayını aç'}</button>
            </> : <button className="button button--primary" type="submit" disabled={submitting || extracting || referenceData.status !== 'ok'}>{submitting ? <><LoaderCircle className="spin" size={16} /> Kaydediliyor…</> : <><FilePlus2 size={16} /> Dosyayı Oluştur</>}</button>}
          </footer>
        </form>
      </section>
      {serviceEditorOpen && <ServiceRevisionDialog name={serviceRevision ?? source?.extraction.service ?? ''} options={referenceData.references?.services ?? []} onClose={() => setServiceEditorOpen(false)} onSave={name => { setServiceRevision(name); resolved('serviceId'); setServiceEditorOpen(false) }} />}
    </div>
  )
}
