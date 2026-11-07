import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { CASE_FAULT_PERCENTAGES, complementaryFault, potentialRecourse, type CaseFaultPercentage } from '@hasarbotu/domain'
import type { CaseFaultResponse } from '@hasarbotu/contracts'
import { useSession } from '../../app/sessionContext'
import { CaseFaultClientError, createHttpCaseFaultAdapter, type CaseFaultPort } from '../../data/caseFaultPort'
import { publishCaseFaultChange, subscribeCaseFaultChanges } from '../../data/caseFaultEvents'
import './case-fault.css'

const defaultPort = createHttpCaseFaultAdapter()
const percentage = (value: CaseFaultPercentage | null) => value === null ? 'Belirlenmemiş' : `%${value}`

export const CaseFaultModule = memo(function CaseFaultModule({ caseId, port = defaultPort }: { caseId: string; port?: CaseFaultPort }) {
  const { user, reportUnauthorized } = useSession()
  // The inner boundary resets draft and cancels requests on case/account changes.
  return <FaultEditor key={`${user?.id ?? 'anonymous'}:${caseId}`} caseId={caseId} port={port} userId={user?.id ?? 'anonymous'} onUnauthorized={reportUnauthorized} />
})

function FaultEditor({ caseId, port, userId, onUnauthorized }: { caseId: string; port: CaseFaultPort; userId: string; onUnauthorized: () => void }) {
  const [record, setRecord] = useState<CaseFaultResponse | null>(null)
  // Skip dispatch entirely for unchanged refreshes, including error clearing.
  // React may still commit a queued same-value update after a previous change.
  const received = useRef<CaseFaultResponse | null>(null)
  const [draft, setDraft] = useState<{ insuredPercent: CaseFaultPercentage | null; version: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const failed = useRef(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const request = useRef<AbortController | null>(null)
  const saving = useRef(false)
  const live = useRef(true)
  const acceptRecord = useCallback((next: CaseFaultResponse) => {
    const previous = received.current
    if (previous?.version === next.version && previous.caseType === next.caseType && previous.permissions.canEdit === next.permissions.canEdit) return
    received.current = next
    setRecord(next)
  }, [])
  const handleError = useCallback((failure: unknown) => {
    failed.current = true
    if (failure instanceof CaseFaultClientError && failure.status === 401) onUnauthorized()
    setError(failure instanceof CaseFaultClientError && failure.status === 409
      ? 'Dosya veya kusur bilgisi değişti. Güncel bilgiyi yenileyip tekrar düzenleyin.'
      : 'Kusur bilgisi alınamadı veya kaydedilemedi. Bağlantıyı kontrol edip tekrar deneyin.')
  }, [onUnauthorized])
  const refresh = useCallback(() => {
    if (saving.current) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    void port.read(caseId, controller.signal).then(next => {
      if (!controller.signal.aborted) {
        acceptRecord(next)
        if (failed.current) { failed.current = false; setError(null) }
      }
    }).catch(failure => { if (!controller.signal.aborted) handleError(failure) })
  }, [caseId, port, handleError, acceptRecord])
  useEffect(() => {
    live.current = true
    refresh()
    const unsubscribe = subscribeCaseFaultChanges(userId, caseId, refresh)
    return () => { live.current = false; request.current?.abort(); unsubscribe() }
  }, [caseId, userId, refresh])

  const save = async () => {
    if (!record || !draft || saving.current || !record.permissions.canEdit) return
    saving.current = true
    setBusy(true)
    failed.current = false
    setError(null)
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    try {
      const result = await port.save(caseId, { insuredPercent: draft.insuredPercent, expectedVersion: draft.version }, controller.signal)
      if (!live.current || controller.signal.aborted) return
      acceptRecord(result)
      setDraft(null)
      setSaved(true)
      // Own refresh is suppressed while saving; other mounted windows re-read once.
      publishCaseFaultChange(userId, caseId)
    } catch (failure) {
      if (live.current && !controller.signal.aborted) handleError(failure)
    } finally {
      saving.current = false
      if (live.current) setBusy(false)
    }
  }

  const left = draft ? draft.insuredPercent : record?.insuredPercent ?? null
  const right = complementaryFault(left)
  const potential = potentialRecourse(record?.caseType ?? null, left)
  const changedElsewhere = draft && record && draft.version !== record.version
  const choose = (value: string, side: 'left' | 'right') => {
    if (!record) return
    const selected = value === '' ? null : CASE_FAULT_PERCENTAGES.find(item => String(item) === value)
    if (selected === undefined) return
    setDraft({ insuredPercent: side === 'left' ? selected : complementaryFault(selected), version: draft?.version ?? record.version })
    setSaved(false)
  }
  return <section className="case-fault" aria-label="Kusur oranı" aria-busy={busy}>
    <header><h2>Kusur oranı</h2>{record && <span>{draft ? 'Kaydedilmemiş' : left === null ? 'Belirlenmemiş' : 'Toplam %100'}</span>}</header>
    {error && <p role="alert">{error} <button type="button" onClick={() => { setDraft(null); setSaved(false); refresh() }} disabled={busy}>Kusur bilgisini yenile</button></p>}
    {!record ? !error && <p role="status">Kusur bilgisi yükleniyor…</p> : record.caseType === null ? <p>Önce dosya türünü seçin.</p> : <>
      <div className="case-fault__sides">
        {(['left', 'right'] as const).map(side => {
          const label = side === 'left' ? record.caseType === 'traffic' ? 'Sigortalı' : 'Kaskolu Sigortalı' : record.caseType === 'traffic' ? 'Mağdur' : 'Karşı Taraf'
          const value = side === 'left' ? left : right
          return <label key={side}><span>{label}</span>{record.permissions.canEdit
            ? <select aria-label={`${label} kusur oranı`} value={value ?? ''} disabled={busy} onChange={event => choose(event.target.value, side)}>
              <option value="">Belirlenmemiş</option>{CASE_FAULT_PERCENTAGES.map(option => <option key={option} value={option}>%{option}</option>)}
            </select> : <strong>{percentage(value)}</strong>}</label>
        })}
      </div>
      {potential !== null && <p className="case-fault__potential" role="note"><strong>Potansiyel Rücu: %{potential}</strong><span>Kesinleşmiş rücu değildir.</span></p>}
      {changedElsewhere && <p role="alert">Başka pencerede güncellendi. Taslağınızı kaydetmeden önce kusur bilgisini yenileyin.</p>}
      {draft && <div className="case-fault__actions"><button type="button" className="button button--primary" disabled={busy || !!changedElsewhere || !record.permissions.canEdit} onClick={() => void save()}>{busy ? 'Kaydediliyor…' : 'Kusuru kaydet'}</button><button type="button" className="button" disabled={busy} onClick={() => { setDraft(null); setError(null) }}>Vazgeç</button>{changedElsewhere && <button type="button" className="button" onClick={() => { setDraft(null); refresh() }}>Kusur bilgisini yenile</button>}</div>}
      {saved && !draft && <p role="status">Kusur bilgisi kaydedildi.</p>}
      {!record.permissions.canEdit && <small>Bu dosyada kusur bilgisi salt okunur.</small>}
    </>}
  </section>
}
