import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Plus, Trash2, Users } from 'lucide-react'
import { MAX_CASE_VEHICLE_OWNERS } from '@hasarbotu/domain'
import { LoadingState } from '../../components/StateViews'
import {
  CaseVehicleOwnersClientError,
  createHttpCaseVehicleOwnersAdapter,
  type CaseVehicleOwnerRecord,
  type CaseVehicleOwnersDataPort,
  type CaseVehicleOwnersRecord,
} from '../../data/caseVehicleOwnersPort'

const EMPTY_ROW: CaseVehicleOwnerRecord = { name: '', phone: null }

export function CaseVehicleOwnersModule({ caseId, port }: {
  readonly caseId: string
  readonly port?: CaseVehicleOwnersDataPort
}) {
  const [adapter] = useState<CaseVehicleOwnersDataPort>(() => port ?? createHttpCaseVehicleOwnersAdapter())
  const [record, setRecord] = useState<CaseVehicleOwnersRecord | null>(null)
  // Yukleme durumu `caseId` istek anahtarina baglidir; anahtar degisince RENDER
  // sirasinda 'loading' turetilir. `load` yalniz bu efektten cagrilir.
  const [loadStatus, setLoadStatus] = useState<{ key: string; value: 'loading' | 'ok' | 'error' }>(
    () => ({ key: caseId, value: 'loading' }),
  )
  const status = loadStatus.key === caseId ? loadStatus.value : 'loading'
  const setStatus = useCallback((value: 'loading' | 'ok' | 'error') => setLoadStatus({ key: caseId, value }), [caseId])
  const [editing, setEditing] = useState(false)
  const [rows, setRows] = useState<CaseVehicleOwnerRecord[]>([])
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    adapter.read(caseId).then((result) => {
      if (cancelled) return
      setRecord(result)
      setStatus('ok')
    }).catch(() => {
      if (cancelled) return
      setRecord(null)
      setStatus('error')
    })
    return () => { cancelled = true }
  }, [adapter, caseId, setStatus])

  const beginEdit = () => {
    setRows(record !== null && record.owners.length > 0 ? record.owners.map((owner) => ({ ...owner })) : [{ ...EMPTY_ROW }])
    setSaveError(null)
    setEditing(true)
  }

  const save = async () => {
    setBusy(true)
    setSaveError(null)
    try {
      const cleaned = rows
        .map((row) => ({ name: row.name.trim(), phone: row.phone === null || row.phone.trim() === '' ? null : row.phone.trim() }))
        .filter((row) => row.name.length > 0)
      const result = await adapter.save(caseId, {
        owners: cleaned,
        expectedSetVersion: record?.setVersion ?? null,
      })
      setRecord(result)
      setEditing(false)
    } catch (error) {
      setSaveError(error instanceof CaseVehicleOwnersClientError ? error.kind : 'unavailable')
    } finally {
      setBusy(false)
    }
  }

  if (status === 'loading') return <LoadingState label="Araç sahibi bilgisi yükleniyor" />
  if (status === 'error' || record === null) {
    return (
      <div className="dashboard-state" role="alert">
        <AlertTriangle size={24} />
        <strong>Araç sahibi bilgisi alınamadı</strong>
        <span>API veya ağ bağlantısını kontrol edin. Sahte veri gösterilmiyor.</span>
      </div>
    )
  }

  if (!editing) {
    return (
      <section className="info-panel" aria-label="Araç sahibi">
        <header><h3><Users size={16} aria-hidden="true" /> Araç Sahibi veya Sahipleri</h3></header>
        {record.owners.length === 0
          ? <p>Henüz kayıtlı araç sahibi yok.</p>
          : <ul>{record.owners.map((owner, index) => (
              <li key={`${owner.name}-${index}`}>{owner.name}{owner.phone !== null ? ` · ${owner.phone}` : ''}</li>
            ))}</ul>}
        {record.permissions.canEdit && (
          <button className="button button--secondary" type="button" onClick={beginEdit}>
            {record.owners.length === 0 ? 'Sahip Ekle' : 'Listeyi Düzenle'}
          </button>
        )}
      </section>
    )
  }

  return (
    <section className="info-panel" aria-label="Araç sahibi düzenleme">
      <header><h3><Users size={16} aria-hidden="true" /> Araç Sahibi veya Sahipleri</h3></header>
      {saveError !== null && <div className="case-form-alert case-form-alert--error" role="alert"><AlertTriangle size={16} /><span>Kaydedilemedi ({saveError}). Tekrar deneyin.</span></div>}
      {rows.map((row, index) => (
        <div className="case-form-grid" key={index}>
          <label className="form-field">
            <span>Ad Soyad</span>
            <input
              aria-label={`Sahip ${index + 1} adı`}
              value={row.name}
              maxLength={200}
              onChange={(event) => setRows(rows.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))}
            />
          </label>
          <label className="form-field">
            <span>Telefon (isteğe bağlı)</span>
            <input
              aria-label={`Sahip ${index + 1} telefonu`}
              value={row.phone ?? ''}
              maxLength={32}
              onChange={(event) => setRows(rows.map((item, itemIndex) => itemIndex === index ? { ...item, phone: event.target.value } : item))}
            />
          </label>
          <button
            className="icon-button" type="button" aria-label={`Sahip ${index + 1} satırını kaldır`}
            onClick={() => setRows(rows.filter((_, itemIndex) => itemIndex !== index))}
          ><Trash2 size={15} /></button>
        </div>
      ))}
      {rows.length < MAX_CASE_VEHICLE_OWNERS && (
        <button className="button button--secondary" type="button" onClick={() => setRows([...rows, { ...EMPTY_ROW }])}>
          <Plus size={14} aria-hidden="true" /> Sahip Ekle
        </button>
      )}
      <div className="email-draft-actions">
        <button className="button button--secondary" type="button" onClick={() => setEditing(false)} disabled={busy}>Vazgeç</button>
        <button className="button button--primary" type="button" onClick={() => void save()} disabled={busy}>
          {busy ? 'Kaydediliyor…' : 'Listeyi Kaydet'}
        </button>
      </div>
    </section>
  )
}
