import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Calculator, CirclePlus, LoaderCircle, Trash2 } from 'lucide-react'
import { valueLossCalculatorResponseSchema, type ValueLossCalculatorResponse } from '@hasarbotu/contracts'
import { canUsePermission } from '../../app/permissions'
import { useSession } from '../../app/sessionContext'
import type { DataSourceKind } from '../../data/ports'
import { TrafficValueLossError, type TrafficValueLossPartCatalogRecord } from '../../data/trafficValueLossPort'
import { createHttpValueLossCalculatorAdapter, type ValueLossCalculatorPort } from '../../data/valueLossCalculatorPort'
import type { CaseRecord } from '../../types/case'
import { VEHICLE_GROUPS, calculatorDraftSchema, calculatorRequest, initialCalculatorDraft, type CalculatorDraft, type CalculatorPartDraft } from './value-loss-calculator-form'

const OPERATION_LABELS = { replacement: 'Değişim', repair: 'Onarım', paint: 'Boya' } as const
const formatMoney = (value: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(value / 100)

function readRemembered(key: string): { draft: CalculatorDraft; result: ValueLossCalculatorResponse | null } | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(key) ?? 'null')
    const draft = calculatorDraftSchema.safeParse(value?.draft)
    if (!draft.success) return null
    const result = valueLossCalculatorResponseSchema.safeParse(value?.result)
    return { draft: draft.data, result: result.success ? result.data : null }
  } catch { return null } // Invalid or unavailable session storage must not prevent calculation.
}

function CalculatorForm({ item, port, storageKey }: { readonly item: CaseRecord; readonly port: ValueLossCalculatorPort; readonly storageKey: string }) {
  const { user, reportUnauthorized } = useSession()
  const [initialItem] = useState(item)
  const [remembered] = useState(() => readRemembered(storageKey))
  const [draft, setDraft] = useState(() => remembered?.draft ?? initialCalculatorDraft(item))
  const [result, setResult] = useState<ValueLossCalculatorResponse | null>(() => remembered?.result ?? null)
  const [catalogState, setCatalogState] = useState<{ key: string; data: TrafficValueLossPartCatalogRecord | null; error: boolean }>({ key: '', data: null, error: false })
  const [catalogRetry, setCatalogRetry] = useState(0)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [changed, setChanged] = useState(false)
  const [storageAvailable, setStorageAvailable] = useState(true)
  const storageWritable = useRef(true)
  const revision = useRef(0)
  const active = useRef(true)
  const group = VEHICLE_GROUPS[draft.vehicleType]
  const catalogKey = `${group}:${catalogRetry}`
  const catalog = catalogState.key === catalogKey ? catalogState.data : null
  const catalogError = catalogState.key === catalogKey && catalogState.error
  const modern = !draft.accidentDate || draft.accidentDate >= '2026-07-01'
  const catalogLoading = modern && catalogState.key !== catalogKey
  const workingHours = group === 'D'
  const canCalculate = canUsePermission(user, 'analysis_write', ['admin', 'expert', 'case_manager'])
  const remember = useCallback((nextDraft: CalculatorDraft, nextResult: ValueLossCalculatorResponse | null) => {
    if (!storageWritable.current) return
    try { window.sessionStorage.setItem(storageKey, JSON.stringify({ draft: nextDraft, result: nextResult })) }
    catch { storageWritable.current = false; setStorageAvailable(false) }
  }, [storageKey])

  const reportError = (error: unknown) => {
    if (error instanceof TrafficValueLossError) {
      if (error.kind === 'unauthorized') { reportUnauthorized(); return 'Yeniden giriş yapın.' }
      if (error.kind === 'forbidden') return 'Hesaplama yapmak için yetkiniz bulunmuyor.'
      if (error.kind === 'validation') return 'Hesap bilgilerini kontrol edin.'
      if (error.kind === 'not_found') return 'Dosya bulunamadı.'
      return 'Hesaplama servisine ulaşılamadı. Yeniden deneyin.'
    }
    return error instanceof Error ? error.message : 'Hesaplama tamamlanamadı.'
  }

  useEffect(() => {
    active.current = true
    if (remembered === null) {
      const initialRevision = revision.current
      void port.load(initialItem.caseId).then(input => {
        if (active.current && revision.current === initialRevision && input !== null) {
          const hydrated = initialCalculatorDraft(initialItem, input)
          setDraft(hydrated); remember(hydrated, null)
        }
      }).catch(error => {
        if (!active.current) return
        if (error instanceof TrafficValueLossError && error.kind === 'unauthorized') reportUnauthorized()
        else setMessage('Önceki hesap bilgileri yüklenemedi. Bilgileri girip hesaplayabilirsiniz.')
      })
    }
    return () => { active.current = false }
  }, [port, initialItem, remembered, reportUnauthorized, remember])

  useEffect(() => {
    if (!modern) return
    let current = true
    void port.catalog(item.caseId, group).then(value => {
      if (value.vehicleGroupCode !== group) throw new Error('Unexpected catalog group')
      if (current) setCatalogState({ key: catalogKey, data: value, error: false })
    }).catch(error => {
      if (!current) return
      setCatalogState({ key: catalogKey, data: null, error: true })
      if (error instanceof TrafficValueLossError && error.kind === 'unauthorized') reportUnauthorized()
    })
    return () => { current = false }
  }, [port, item.caseId, group, modern, catalogKey, reportUnauthorized])

  const update = (patch: Partial<CalculatorDraft>) => {
    revision.current++
    const next = { ...draft, ...patch }
    setDraft(next); remember(next, null)
    setChanged(result !== null || changed); setResult(null); setMessage('')
  }
  const updatePart = (id: string, patch: Partial<CalculatorPartDraft>) => {
    const selected = draft.parts.find(part => part.id === id)
    update({ parts: draft.parts.map(part => part.id === id ? { ...part, ...patch } : part.stableRuleId === selected?.stableRuleId ? { ...part, ...(patch.priorPartState === undefined ? {} : { priorPartState: patch.priorPartState }), ...(patch.treatment === undefined ? {} : { treatment: patch.treatment }) } : part) })
  }
  const addPart = () => {
    const part = catalog?.parts.find(part => part.label === query || part.stableRuleId === query)
    if (!part) { setMessage('Listeden geçerli bir parça seçin.'); return }
    const selected = draft.parts.filter(row => row.stableRuleId === part.stableRuleId)
    const operation = part.supportedOperations.find(operation => !selected.some(row => row.operation === operation) && !(operation !== 'paint' && selected.some(row => row.operation !== 'paint')))
    if (!operation) { setMessage('Bu parçanın işlemi zaten eklendi.'); return }
    update({ parts: [...draft.parts, { id: crypto.randomUUID(), stableRuleId: part.stableRuleId, label: part.label, operation, paintMode: 'full', price: '', labor: '', priceUnknown: false, priorPartState: selected[0]?.priorPartState ?? 'none', treatment: selected[0]?.treatment ?? 'standard' }] })
    setQuery('')
  }
  const calculate = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !canCalculate) return
    setMessage(''); setResult(null)
    remember(draft, null)
    let input
    try { input = calculatorRequest(draft) } catch (error) { setMessage(reportError(error)); return }
    const started = revision.current
    setBusy(true)
    try {
      const response = await port.calculate(item.caseId, input)
      if (active.current && revision.current === started) { setResult(response); setChanged(false); remember(draft, response) }
    } catch (error) { if (active.current && revision.current === started) setMessage(reportError(error)) }
    finally { if (active.current) setBusy(false) }
  }

  return <section className="value-loss-calculator" aria-labelledby="value-loss-title">
    <header><div><h2 id="value-loss-title">Değer Kaybı Hesapla</h2><p>Bilgileri girin, hasarlı parçaları seçin ve tutarı hesaplayın.</p></div><Calculator size={22} /></header>
    <form onSubmit={event => void calculate(event)} noValidate>
      <div className="value-loss-calculator__fields">
        <label className="form-field"><span>Kaza tarihi</span><input type="date" value={draft.accidentDate} onChange={event => update({ accidentDate: event.target.value })} /></label>
        {modern && <label className="form-field"><span>Araç türü</span><select value={draft.vehicleType} onChange={event => {
          const vehicleType = event.target.value as CalculatorDraft['vehicleType']
          update({ vehicleType, ...(VEHICLE_GROUPS[vehicleType] !== group ? { parts: [] } : {}), ...((VEHICLE_GROUPS[vehicleType] === 'D') !== workingHours ? { usageValue: '' } : {}) }); setQuery('')
        }}>{Object.keys(VEHICLE_GROUPS).map(type => <option key={type}>{type}</option>)}</select></label>}
        {modern && <><label className="form-field"><span>Model yılı</span><input inputMode="numeric" value={draft.modelYear} onChange={event => update({ modelYear: event.target.value })} placeholder="2024" /></label>
        <label className="form-field"><span>{workingHours ? 'Çalışma saati' : 'Kilometre'}</span><input inputMode="numeric" value={draft.usageValue} onChange={event => update({ usageValue: event.target.value })} placeholder="50000" /></label></>}
        <label className="form-field"><span>Rayiç bedeli (TL)</span><input inputMode="decimal" value={draft.marketValue} onChange={event => update({ marketValue: event.target.value })} placeholder="1.000.000" /></label>
        {modern ? <label className="form-field"><span>Hasar tutarı (TL)</span><input inputMode="decimal" value={draft.damageAmount} onChange={event => update({ damageAmount: event.target.value })} placeholder="100.000" /></label>
          : <label className="form-field"><span>Onarım sonrası piyasa değeri (TL)</span><input inputMode="decimal" value={draft.postRepairMarketValue} onChange={event => update({ postRepairMarketValue: event.target.value })} /></label>}
        <label className="form-field"><span>Araç durumu</span><select value={draft.vehicleCondition} onChange={event => update({ vehicleCondition: event.target.value as CalculatorDraft['vehicleCondition'] })}><option value="normal">Normal</option><option value="prior_heavy_damage">Önceki ağır hasar</option><option value="current_heavy_damage">Mevcut ağır / pert hasar</option><option value="antique">Antika / koleksiyon</option><option value="foreign_plate">Yabancı plaka</option></select></label>
        {modern ? <><label className="form-field"><span>Önceki hasar sayısı</span><input inputMode="numeric" value={draft.previousDamageCount} onChange={event => update({ previousDamageCount: event.target.value })} /></label><label className="value-loss-calculator__check"><input type="checkbox" checked={draft.commercialOrRental} onChange={event => update({ commercialOrRental: event.target.checked })} /> Ticari / kiralık kullanım</label></>
          : <label className="form-field"><span>Karşı taraf kusuru (%)</span><input inputMode="decimal" value={draft.faultPercent} onChange={event => update({ faultPercent: event.target.value })} /></label>}
      </div>
      {modern && <section className="value-loss-calculator__parts" aria-label="Hasarlı parçalar">
        <div className="value-loss-calculator__add"><label className="form-field"><span>Hasarlı parça</span><input list="calculator-part-catalog" value={query} onChange={event => setQuery(event.target.value)} placeholder={catalogLoading ? 'Parçalar yükleniyor…' : 'Parça adı yazın veya seçin'} disabled={catalogLoading || catalogError} /><datalist id="calculator-part-catalog">{catalog?.parts.map(part => <option key={part.stableRuleId} value={part.label} />)}</datalist></label><button className="button button--secondary" type="button" onClick={addPart} disabled={!catalog || catalogLoading}><CirclePlus size={15} /> Ekle</button></div>
        {catalogError && <p role="alert">Parça listesi yüklenemedi. <button type="button" className="button button--secondary" onClick={() => setCatalogRetry(value => value + 1)}>Yeniden dene</button></p>}
        {draft.parts.map(part => <div className="value-loss-calculator__part" key={part.id}>
          <strong>{part.label}</strong>
          <label className="form-field"><span>İşlem</span><select aria-label={`${part.label} işlemi`} value={part.operation} onChange={event => {
            const operation = event.target.value as CalculatorPartDraft['operation']
            if (draft.parts.some(other => other.id !== part.id && other.stableRuleId === part.stableRuleId && (other.operation === operation || other.operation !== 'paint' && operation !== 'paint'))) { setMessage('Bu parçada değişim ve onarım birlikte seçilemez.'); return }
            updatePart(part.id, { operation })
          }}>{(catalog?.parts.find(row => row.stableRuleId === part.stableRuleId)?.supportedOperations ?? [part.operation]).map(operation => <option key={operation} value={operation}>{OPERATION_LABELS[operation]}</option>)}</select></label>
          <label className="form-field"><span>Önceki durum</span><select aria-label={`${part.label} önceki durumu`} value={part.priorPartState} onChange={event => updatePart(part.id, { priorPartState: event.target.value as CalculatorPartDraft['priorPartState'] })}><option value="none">Hasarsız</option><option value="previously_damaged">Önceden hasarlı</option><option value="previously_repaired_detachable">Sökülebilir parça onarımlı</option><option value="previously_repaired_welded">Sabit parça onarımlı</option></select></label>
          <button className="icon-button" type="button" aria-label={`${part.label} işlemini kaldır`} onClick={() => update({ parts: draft.parts.filter(row => row.id !== part.id) })}><Trash2 size={16} /></button>
          {part.operation === 'paint' && <label className="form-field"><span>Boya türü</span><select aria-label={`${part.label} boya türü`} value={part.paintMode} onChange={event => updatePart(part.id, { paintMode: event.target.value as 'full' | 'local' })}><option value="full">Tam boya</option><option value="local">Lokal boya</option></select></label>}
          {part.operation === 'repair' && <div className="value-loss-calculator__repair"><label className="value-loss-calculator__check"><input type="checkbox" checked={part.priceUnknown} onChange={event => updatePart(part.id, { priceUnknown: event.target.checked })} /> Parça bedeli bilinmiyor</label>{!part.priceUnknown && <><label className="form-field"><span>Yeni parça bedeli (TL)</span><input inputMode="decimal" aria-label={`${part.label} yeni parça bedeli`} value={part.price} onChange={event => updatePart(part.id, { price: event.target.value })} /></label><label className="form-field"><span>Onarım işçiliği (TL)</span><input inputMode="decimal" aria-label={`${part.label} onarım işçiliği`} value={part.labor} onChange={event => updatePart(part.id, { labor: event.target.value })} /></label></>}<small>İskontosuz, KDV hariç bedelleri girin.{part.priceUnknown && ' Bedel bilinmiyorsa ağır onarım katsayısı uygulanır.'}</small></div>}
          <details><summary>Özel işlem</summary><select aria-label={`${part.label} özel işlemi`} value={part.treatment} onChange={event => updatePart(part.id, { treatment: event.target.value as CalculatorPartDraft['treatment'] })}><option value="standard">Standart</option><option value="paintless_repair">Boyasız onarım</option><option value="plastic_or_unpainted">Plastik / boyasız parça</option><option value="accessory">Aksesuar</option><option value="superstructure">Üstyapı</option></select></details>
        </div>)}
      </section>}
      <footer className="value-loss-calculator__footer"><button className="button button--primary" disabled={!canCalculate || busy} type="submit">{busy ? <LoaderCircle className="spin" size={17} /> : <Calculator size={17} />}{busy ? 'Hesaplanıyor…' : 'Hesapla'}</button><div aria-live="polite">{result?.amountMinor != null ? <><span>Değer kaybı tutarı</span><strong>{formatMoney(result.amountMinor)}</strong></> : <span>{changed ? 'Bilgiler değişti. Yeniden hesaplayın.' : 'Hesaplanan tutar burada görünecek.'}</span>}</div></footer>
      {!canCalculate && <p role="status">Hesaplama yapmak için yetkiniz bulunmuyor.</p>}
      {result?.issues.map((issue, index) => <p className="value-loss-calculator__error" role="alert" key={`${issue.field}-${index}`}>{issue.message}</p>)}
      {message && <p className="value-loss-calculator__error" role="alert">{message}</p>}
      {!storageAvailable && <p role="status">Bu pencere kapandığında girdiğiniz bilgiler hatırlanamayabilir.</p>}
    </form>
  </section>
}

export function ValueLossCalculator({ item, source, port }: { readonly item: CaseRecord; readonly source: DataSourceKind; readonly port?: ValueLossCalculatorPort }) {
  const session = useSession()
  const calculator = useMemo(() => port ?? createHttpValueLossCalculatorAdapter(), [port])
  if (item.type !== 'Trafik' || source !== 'api') return <div className="document-module-state" role="status">Değer kaybı hesabı Trafik dosyaları için kullanılabilir.</div>
  const scope = `hasarbotu-value-loss-calculator-v1:${session.user?.organizationId}:${session.user?.id}:${item.caseId}`
  return <CalculatorForm key={scope} item={item} port={calculator} storageKey={scope} />
}
