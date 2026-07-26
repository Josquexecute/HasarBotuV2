import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Car, History } from 'lucide-react'
import { LoadingState } from '../../components/StateViews'
import { CaseVehicleProfileClientError, createHttpCaseVehicleProfileAdapter, type CaseVehicleProfileDataPort, type CaseVehicleProfileFieldsRecord, type CaseVehicleProfileRecord, type VehicleClassRecord, type VehicleEvidenceSourceRecord } from '../../data/caseVehicleProfilePort'
/**
 * Paket 56 — dosya araç profili bölümü.
 *
 * Kullanıcı kontrollüdür ve sürümlüdür; otomatik belge çıkarımı YOKTUR.
 * Tam şasi numarası girilmez: alan yalnız PREFIX kabul eder.
 */
const CLASS_LABELS: Record<VehicleClassRecord, string> = {
  passenger_car: 'Otomobil',
  light_commercial: 'Hafif ticari',
  heavy_commercial: 'Ağır ticari',
  motorcycle: 'Motosiklet',
  trailer: 'Römork',
  other: 'Diğer',
}

const SOURCE_LABELS: Record<VehicleEvidenceSourceRecord, string> = {
  registration_document: 'Ruhsat',
  policy_document: 'Poliçe',
  insurer_record: 'Sigorta kaydı',
  user_statement: 'Beyan',
  other: 'Diğer',
}

const EMPTY: CaseVehicleProfileFieldsRecord = {
  brand: '',
  model: '',
  modelYear: new Date().getFullYear(),
  variant: null,
  vehicleClass: 'passenger_car',
  chassisPrefix: null,
  engineCode: null,
  evidenceSource: 'registration_document',
  evidenceReference: null,
}

export function CaseVehicleProfileModule({ caseId, port }: {
  readonly caseId: string
  readonly port?: CaseVehicleProfileDataPort
}) {
  const [adapter] = useState<CaseVehicleProfileDataPort>(
    () => port ?? createHttpCaseVehicleProfileAdapter(),
  )
  const [record, setRecord] = useState<CaseVehicleProfileRecord | null>(null)
  // Yukleme durumu `caseId` istek anahtarina baglidir; anahtar degisince RENDER
  // sirasinda 'loading' turetilir ve efektte senkron sifirlama gerekmez.
  // `load` yalniz bu efektten cagrilir, baska cagiran yoktur.
  const [loadStatus, setLoadStatus] = useState<{ key: string; value: 'loading' | 'ok' | 'error' }>(
    () => ({ key: caseId, value: 'loading' }),
  )
  const status = loadStatus.key === caseId ? loadStatus.value : 'loading'
  const setStatus = useCallback((value: 'loading' | 'ok' | 'error') => setLoadStatus({ key: caseId, value }), [caseId])
  const [errorKind, setErrorKind] = useState<string | null>(null)
  const [fields, setFields] = useState<CaseVehicleProfileFieldsRecord>(EMPTY)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  // Okuma efekt icinde yapilir ve durum yalniz async geri cagrilarda yazilir.
  // `cancelled` muhafazasi eklendi: case degisiminde ucustaki yanit artik
  // yeni case'in alanlarini ezemez.
  useEffect(() => {
    let cancelled = false
    adapter.read(caseId).then((result) => {
      if (cancelled) return
      setRecord(result)
      if (result.current !== null) {
        setFields({
          brand: result.current.brand,
          model: result.current.model,
          modelYear: result.current.modelYear,
          variant: result.current.variant,
          vehicleClass: result.current.vehicleClass,
          chassisPrefix: result.current.chassisPrefix,
          engineCode: result.current.engineCode,
          evidenceSource: result.current.evidenceSource,
          evidenceReference: result.current.evidenceReference,
        })
      }
      setStatus('ok')
    }).catch((error: unknown) => {
      if (cancelled) return
      setRecord(null)
      setErrorKind(error instanceof CaseVehicleProfileClientError ? error.kind : 'unavailable')
      setStatus('error')
    })
    return () => { cancelled = true }
  }, [adapter, caseId, setStatus])

  const save = async () => {
    if (record === null) return
    setBusy(true)
    try {
      const result = await adapter.save(caseId, {
        fields,
        expectedVersion: record.version,
        reason: record.version === null ? null : reason.trim() || null,
      })
      setRecord(result)
      setReason('')
      setErrorKind(null)
    } catch (error) {
      setErrorKind(error instanceof CaseVehicleProfileClientError ? error.kind : 'unavailable')
    } finally {
      setBusy(false)
    }
  }

  if (status === 'loading') return <LoadingState label="Araç profili yükleniyor" />
  if (status === 'error' || record === null) {
    return (
      <div className="dashboard-state" role="alert">
        <AlertTriangle size={24} />
        <strong>Araç profili alınamadı</strong>
        <span>API veya ağ bağlantısını kontrol edin. Sahte veri gösterilmiyor.</span>
      </div>
    )
  }

  const isRevision = record.version !== null
  const canSubmit = fields.brand.trim() !== '' && fields.model.trim() !== ''
    && (!isRevision || reason.trim() !== '')

  return (
    <section className="vehicle-profile" aria-label="Araç profili">
      <header className="vehicle-profile__head">
        <h3><Car size={16} aria-hidden="true" /> Araç Profili</h3>
        <small>
          {record.version === null ? 'Henüz kaydedilmedi' : `Sürüm ${record.version}`}
          {' · '}Kullanıcı girişi; otomatik belge çıkarımı yok
        </small>
      </header>

      <div className="vehicle-profile__grid">
        <label className="field">
          <span>Marka</span>
          <input value={fields.brand} onChange={(event) => setFields({ ...fields, brand: event.target.value })} />
        </label>
        <label className="field">
          <span>Model</span>
          <input value={fields.model} onChange={(event) => setFields({ ...fields, model: event.target.value })} />
        </label>
        <label className="field">
          <span>Model yılı</span>
          <input
            type="number"
            value={fields.modelYear}
            onChange={(event) => setFields({ ...fields, modelYear: Number(event.target.value) })}
          />
        </label>
        <label className="field">
          <span>Varyant</span>
          <input
            value={fields.variant ?? ''}
            onChange={(event) => setFields({ ...fields, variant: event.target.value || null })}
          />
        </label>
        <label className="select-field">
          <span className="select-field__label">Araç sınıfı</span>
          <select
            aria-label="Araç sınıfı"
            value={fields.vehicleClass}
            onChange={(event) => setFields({ ...fields, vehicleClass: event.target.value as VehicleClassRecord })}
          >
            {Object.entries(CLASS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Şasi ön eki</span>
          <input
            aria-label="Şasi ön eki"
            value={fields.chassisPrefix ?? ''}
            maxLength={11}
            placeholder="En çok 11 karakter"
            onChange={(event) => setFields({ ...fields, chassisPrefix: event.target.value || null })}
          />
          <small>Tam şasi numarası girilmez ve dışarı gönderilmez.</small>
        </label>
        <label className="field">
          <span>Motor kodu</span>
          <input
            value={fields.engineCode ?? ''}
            onChange={(event) => setFields({ ...fields, engineCode: event.target.value || null })}
          />
        </label>
        <label className="select-field">
          <span className="select-field__label">Kanıt kaynağı</span>
          <select
            aria-label="Kanıt kaynağı"
            value={fields.evidenceSource}
            onChange={(event) => setFields({
              ...fields, evidenceSource: event.target.value as VehicleEvidenceSourceRecord,
            })}
          >
            {Object.entries(SOURCE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Kanıt referansı</span>
          <input
            aria-label="Kanıt referansı"
            value={fields.evidenceReference ?? ''}
            onChange={(event) => setFields({ ...fields, evidenceReference: event.target.value || null })}
          />
          <small>Yalnız dosyada saklanır; AI sağlayıcısına gönderilmez.</small>
        </label>
        {isRevision && (
          <label className="field">
            <span>Değişiklik gerekçesi</span>
            <input value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
        )}
      </div>

      {errorKind !== null && (
        <p className="allocation-panel__error" role="alert">
          Kayıt tamamlanamadı ({errorKind}).
        </p>
      )}

      <div className="vehicle-profile__actions">
        <button
          className="button button--primary"
          type="button"
          disabled={busy || !canSubmit || !record.permissions.canEdit}
          onClick={() => void save()}
        >
          {record.version === null ? 'Araç profilini kaydet' : 'Yeni sürüm kaydet'}
        </button>
      </div>

      {record.history.length > 0 && (
        <details className="vehicle-profile__history">
          <summary><History size={13} aria-hidden="true" /> Sürüm geçmişi ({record.history.length})</summary>
          <ul>
            {record.history.map((version) => (
              <li key={version.id}>
                <strong>Sürüm {version.profileVersion}</strong>
                <span>{version.brand} {version.model} {version.modelYear}</span>
                {version.revisionReason !== null && <small>{version.revisionReason}</small>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
