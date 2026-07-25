import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, CheckCircle2, FilePlus2, LoaderCircle, X } from 'lucide-react'
import { useNavigate } from 'react-router'
import {
  CaseCommandError,
  createHttpCaseCommandAdapter,
  type CaseCommandPort,
  type CaseCreateInput,
  type CaseReferenceDataPort,
  type SessionUser,
  useCaseReferences,
} from '../../data'
import type { CaseStageCode } from '../../types/case'
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
}

interface StableAttempt {
  readonly fingerprint: string
  readonly key: string
}

function FieldError({ message }: { readonly message?: string }) {
  return message === undefined ? null : <span className="form-field__error">{message}</span>
}

export function CaseCreateModal({ currentUser, onClose, onUnauthorized, commandPort, referencePort }: CaseCreateModalProps) {
  const navigate = useNavigate()
  const commands = useMemo(() => commandPort ?? createHttpCaseCommandAdapter(), [commandPort])
  const submittingRef = useRef(false)
  const attemptRef = useRef<StableAttempt | null>(null)
  const [caseType, setCaseType] = useState<'traffic' | 'casco'>('traffic')
  const [plate, setPlate] = useState('')
  const [notificationFormNumber, setNotificationFormNumber] = useState('')
  const [insurerClaimNumber, setInsurerClaimNumber] = useState('')
  const [workflowStage, setWorkflowStage] = useState<CaseStageCode>('new_notification')
  const [followUpDate, setFollowUpDate] = useState('')
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

  useEffect(() => {
    if (referenceData.status === 'unauthorized') onUnauthorized()
  }, [referenceData.status, onUnauthorized])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submittingRef.current) return

    const canonicalPlate = normalizePlateInput(plate)
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
      ...(followUpDate === '' ? {} : { followUpDate }),
      ...(lossDate === '' ? {} : { lossDate }),
      ...(notificationDate === '' ? {} : { notificationDate }),
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
      <section className="modal modal--case-form" role="dialog" aria-modal="true" aria-labelledby="new-notice-title" aria-busy={submitting}>
        <form onSubmit={submit} noValidate>
          <header className="modal__header">
            <div><span className="eyebrow">Gerçek API · güvenli oluşturma</span><h2 id="new-notice-title">Yeni İhbar Oluştur</h2></div>
            <button className="icon-button" type="button" onClick={onClose} disabled={submitting} aria-label="Pencereyi kapat"><X size={18} /></button>
          </header>
          <div className="modal__body case-form-scroll">
            <div className="case-form-note"><CheckCircle2 size={16} /><span>Ofis dosya numarası backend tarafından otomatik atanır. Çift gönderim aynı idempotency anahtarıyla korunur.</span></div>
            {generalError && <div className="case-form-alert case-form-alert--error" role="alert"><AlertTriangle size={17} /><span>{generalError}</span></div>}
            {referenceData.status === 'loading' && <div className="case-form-note" role="status"><LoaderCircle className="spin" size={16} /><span>Aktif referans listeleri yükleniyor…</span></div>}
            {(referenceData.status === 'unavailable' || referenceData.status === 'unauthorized') && <div className="case-form-alert case-form-alert--error" role="alert"><AlertTriangle size={17} /><span>{referenceData.status === 'unauthorized' ? 'Referanslar için yeniden giriş gerekli.' : 'Referans listeleri yüklenemedi; sahte seçenek kullanılmadı.'}</span><button className="button button--secondary" type="button" onClick={referenceData.reload}>Yeniden Dene</button></div>}
            <div className="case-form-grid">
              <label className="form-field"><span>Dosya türü *</span><select value={caseType} onChange={(event) => setCaseType(event.target.value as 'traffic' | 'casco')}><option value="traffic">Trafik</option><option value="casco">Kasko</option></select><FieldError message={fieldErrors.caseType} /></label>
              <label className="form-field"><span>Plaka *</span><input autoFocus value={plate} onChange={(event) => setPlate(event.target.value)} onBlur={() => setPlate(normalizePlateInput(plate))} placeholder="34 MPA 764" autoComplete="off" aria-invalid={fieldErrors.plate !== undefined} /><FieldError message={fieldErrors.plate} /></label>
              <label className="form-field"><span>İhbar numarası</span><input value={notificationFormNumber} onChange={(event) => setNotificationFormNumber(event.target.value)} autoComplete="off" aria-invalid={fieldErrors.notificationFormNumber !== undefined} /><FieldError message={fieldErrors.notificationFormNumber} /></label>
              <label className="form-field"><span>Hasar dosya numarası</span><input value={insurerClaimNumber} onChange={(event) => setInsurerClaimNumber(event.target.value)} autoComplete="off" aria-invalid={fieldErrors.insurerClaimNumber !== undefined} /><FieldError message={fieldErrors.insurerClaimNumber} /></label>
              <label className="form-field"><span>İlk workflow aşaması *</span><select value={workflowStage} onChange={(event) => setWorkflowStage(event.target.value as CaseStageCode)}>{CASE_STAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><FieldError message={fieldErrors.workflowStage} /></label>
              <label className="form-field"><span>Takip tarihi</span><input type="date" value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} aria-invalid={fieldErrors.followUpDate !== undefined} /><small>LocalDate olarak gönderilir; saat içermez.</small><FieldError message={fieldErrors.followUpDate} /></label>
              <label className="form-field"><span>Sorumlu</span><select value={responsibleUserId} onChange={(event) => setResponsibleUserId(event.target.value)} disabled={referenceData.status !== 'ok'}><option value="">Atanmadı</option>{referenceData.references?.users.map((option) => <option key={option.id} value={option.id}>{option.displayName}</option>)}</select><FieldError message={fieldErrors.responsibleUserId} /></label>
              <label className="form-field"><span>Sigorta şirketi</span><select value={insurerId} onChange={(event) => setInsurerId(event.target.value)} disabled={referenceData.status !== 'ok'}><option value="">Seçilmedi</option>{referenceData.references?.insurers.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select><FieldError message={fieldErrors.insurerId} /></label>
              <label className="form-field"><span>Servis</span><select aria-label="Servis" value={serviceId} onChange={(event) => setServiceId(event.target.value)} disabled={referenceData.status !== 'ok'}><option value="">Seçilmedi</option>{referenceData.references?.services.map((option) => <option key={option.id} value={option.id}>{serviceOptionLabel(option)}</option>)}</select><small>{serviceEvaluationSummary(referenceData.references?.services.find((option) => option.id === serviceId))}</small><FieldError message={fieldErrors.serviceId} /></label>
              <label className="form-field"><span>Eksper</span><select value={expertUserId} onChange={(event) => setExpertUserId(event.target.value)} disabled={referenceData.status !== 'ok'}><option value="">Atanmadı</option>{referenceData.references?.experts.map((option) => <option key={option.id} value={option.id}>{option.displayName}</option>)}</select><FieldError message={fieldErrors.expertUserId} /></label>
              <label className="form-field"><span>Hasar tarihi</span><input type="date" value={lossDate} onChange={(event) => setLossDate(event.target.value)} aria-invalid={fieldErrors.lossDate !== undefined} /><small>LocalDate; saat içermez.</small><FieldError message={fieldErrors.lossDate} /></label>
              <label className="form-field"><span>İhbar tarihi</span><input type="date" value={notificationDate} onChange={(event) => setNotificationDate(event.target.value)} aria-invalid={fieldErrors.notificationDate !== undefined} /><small>Hasar tarihinden önce olamaz.</small><FieldError message={fieldErrors.notificationDate} /></label>
            </div>
          </div>
          <footer className="modal__footer">
            <button className="button button--secondary" type="button" onClick={onClose} disabled={submitting}>İptal</button>
            <button className="button button--primary" type="submit" disabled={submitting || referenceData.status !== 'ok'}>{submitting ? <><LoaderCircle className="spin" size={16} /> Kaydediliyor…</> : <><FilePlus2 size={16} /> Dosyayı Oluştur</>}</button>
          </footer>
        </form>
      </section>
    </div>
  )
}
