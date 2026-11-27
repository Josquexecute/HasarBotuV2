import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Calculator, CirclePlus, LoaderCircle } from 'lucide-react'
import { VALUE_LOSS_BODY_LABELS, VALUE_LOSS_CALCULATOR_V2_VERSION, buildValueLossPartSuggestions, valueLossBodyOptions, valueLossCalculatorRequestSchema, valueLossCalculatorResponseSchema, valueLossCalculatorVehicleContext, type ValueLossCalculatorRequest, type ValueLossCalculatorResponse } from '@hasarbotu/contracts'
import { canUsePermission } from '../../app/permissions'
import { notifyValueLossSaved } from '../../app/valueLossSaved'
import { SearchableSelect } from '../../components/SearchableSelect'
import { useSession } from '../../app/sessionContext'
import type { DataSourceKind } from '../../data/ports'
import { TrafficValueLossError, type TrafficValueLossPartCatalogRecord } from '../../data/trafficValueLossPort'
import { createHttpValueLossCalculatorAdapter, type ValueLossCalculatorPort } from '../../data/valueLossCalculatorPort'
import type { CaseRecord } from '../../types/case'
import { VEHICLE_GROUPS, calculatorCaseDefaultsSchema, calculatorDraftSchema, calculatorPartDraftSchema, calculatorRequest, calculatorDraftFromRequest, calculatorVehicleBlockReason, consolidateCalculatorParts, initialCalculatorDraft, mergeCalculatorHistory, type CalculatorDraft, type CalculatorPartDraft } from './value-loss-calculator-form'
import { calculatorCaseDefaults, mergeCalculatorCaseDefaults } from './value-loss-calculator-prefill'
import { ValueLossCalculatorPart } from './ValueLossCalculatorPart'
import { ValueLossCalculationDetails } from './ValueLossCalculationDetails'
import { calculatorReportHtml } from './value-loss-calculator-report'

const moneyFormatter = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' })
const formatMoney = (value: number) => moneyFormatter.format(value / 100)


function readRemembered(key: string, item: CaseRecord): { draft: CalculatorDraft; result: ValueLossCalculatorResponse | null; input: ValueLossCalculatorRequest | null } | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(key) ?? 'null')
    const draft = calculatorDraftSchema.safeParse(value?.draft)
    if (!draft.success) return null
    const result = valueLossCalculatorResponseSchema.safeParse(value?.result)
    const previousDefaults = calculatorCaseDefaultsSchema.safeParse(value?.caseDefaults)
    const currentFormat = value?.draft?.formatVersion === 3
    const restored = { ...mergeCalculatorCaseDefaults({ ...draft.data, formatVersion: 3, parts: consolidateCalculatorParts(draft.data.parts) }, calculatorCaseDefaults(item), previousDefaults.success ? previousDefaults.data : {}), calculationBasis: 'reference' as const }
    const changed = JSON.stringify(restored) !== JSON.stringify(draft.data)
    const input = valueLossCalculatorRequestSchema.safeParse(value?.input)
    return { draft: restored, result: !changed && currentFormat && value?.verificationVersion >= 5 && result.success ? result.data : null, input: input.success ? input.data : null }
  } catch { return null } // Invalid or unavailable session storage must not prevent calculation.
}

function CalculatorForm({ item, port, storageKey }: { readonly item: CaseRecord; readonly port: ValueLossCalculatorPort; readonly storageKey: string }) {
  const { user, reportUnauthorized } = useSession()
  const [initialItem] = useState(item)
  const [remembered] = useState(() => readRemembered(storageKey, item))
  const sourceDefaults = useRef(calculatorCaseDefaultsSchema.parse(initialCalculatorDraft(item)))
  const [draft, setDraftState] = useState<CalculatorDraft>(() => ({ ...(remembered?.draft ?? initialCalculatorDraft(item)), calculationBasis: 'reference' }))
  const draftRef = useRef(draft)
  const setDraft = useCallback((next: CalculatorDraft) => { draftRef.current = next; setDraftState(next) }, [])
  const caseDefaults = useMemo(() => calculatorCaseDefaults(item), [item])
  const [result, setResult] = useState<ValueLossCalculatorResponse | null>(() => remembered?.result ?? null)
  const resultInput = useRef(remembered?.input ?? null)
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
  const vehicleContext = valueLossCalculatorVehicleContext(draft.vehicleType, draft.bodyType)
  const group = vehicleContext.group
  const catalogKey = `${group}:${catalogRetry}`
  const catalog = catalogState.key === catalogKey ? catalogState.data : null
  const catalogError = catalogState.key === catalogKey && catalogState.error
  const modern = !draft.accidentDate || draft.accidentDate >= '2026-07-01'
  const catalogLoading = catalogState.key !== catalogKey
  const suggestions = useMemo(() => buildValueLossPartSuggestions(draft.vehicleType, draft.bodyType, catalog?.parts ?? [], 2), [draft.vehicleType, draft.bodyType, catalog])
  const supported = useMemo(() => new Map(suggestions.map(part => [part.stableRuleId, part.supportedOperations])), [suggestions])
  const blocked = calculatorVehicleBlockReason(draft.vehicleCondition)
  const workingHours = group === 'D'
  const canCalculate = canUsePermission(user, 'analysis_write', ['admin', 'expert', 'case_manager'])
  const remember = useCallback((nextDraft: CalculatorDraft, nextResult: ValueLossCalculatorResponse | null) => {
    if (!storageWritable.current) return
    try { window.sessionStorage.setItem(storageKey, JSON.stringify({ verificationVersion: 6, caseDefaults: sourceDefaults.current, draft: nextDraft, result: nextResult, input: nextResult ? resultInput.current : null })) }
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
    {
      const initialRevision = revision.current
      void (async () => {
        const calculation = await (port.loadCalculation?.(initialItem.caseId) ?? Promise.resolve(null))
        return { calculation, input: calculation ? null : await port.load(initialItem.caseId) }
      })().then(({ input, calculation }) => {
        if (active.current && revision.current === initialRevision && calculation !== null && (remembered === null || remembered.result !== null)) {
          const saved = calculatorDraftFromRequest(initialItem, calculation.input)
          const savedResult = calculatorVehicleBlockReason(saved.vehicleCondition) === null ? calculation.result : null
          resultInput.current = calculation.input
          setDraft(saved); setResult(savedResult); remember(saved, savedResult)
          return
        }
        if (active.current && revision.current === initialRevision && input !== null) {
          const saved = { ...initialCalculatorDraft(initialItem, input), calculationBasis: 'reference' as const }
          const hydrated = remembered === null ? saved : mergeCalculatorHistory(remembered.draft, saved)
          if (remembered === null || JSON.stringify(hydrated) !== JSON.stringify(remembered.draft)) {
            setDraft(hydrated); setResult(null); remember(hydrated, null)
          }
        }
      }).catch(error => {
        if (!active.current) return
        if (error instanceof TrafficValueLossError && error.kind === 'unauthorized') reportUnauthorized()
        else setMessage('Önceki hesap bilgileri yüklenemedi. Bilgileri girip hesaplayabilirsiniz.')
      })
    }
    return () => { active.current = false }
  }, [port, initialItem, remembered, reportUnauthorized, remember, setDraft])

  useEffect(() => {
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
  }, [port, item.caseId, group, catalogKey, reportUnauthorized])

  const update = useCallback((patch: Partial<CalculatorDraft> | ((current: CalculatorDraft) => Partial<CalculatorDraft>)) => {
    revision.current++
    const condition = caseDefaults.vehicleCondition
    const next = { ...draftRef.current, ...(typeof patch === 'function' ? patch(draftRef.current) : patch), calculationBasis: 'reference' as const, ...(condition && !['unknown', 'normal'].includes(condition) ? { vehicleCondition: condition } : {}) }
    setDraft(next); remember(next, null)
    setChanged(true); setResult(null); setMessage('')
  }, [caseDefaults, remember, setDraft])
  const updatePart = useCallback((id: string, patch: Partial<CalculatorPartDraft>) => {
    update(current => ({ parts: current.parts.map(part => part.id === id ? { ...part, ...patch } : part) }))
  }, [update])
  const removePart = useCallback((id: string) => update(current => ({ parts: current.parts.filter(part => part.id !== id) })), [update])
  const refreshCaseDefaults = () => {
    const defaults = calculatorCaseDefaults(item)
    sourceDefaults.current = calculatorCaseDefaultsSchema.parse(initialCalculatorDraft(item))
    update(mergeCalculatorCaseDefaults(draft, defaults, draft))
    setQuery('')
  }
  const addPart = () => {
    const part = suggestions.find(part => part.id === query)
    if (!part) { setMessage('Listeden geçerli bir parça seçin.'); return }
    if (draft.parts.some(row => row.label === part.label)) { setMessage('Bu parça zaten eklendi. İşlemini mevcut satırda seçin.'); return }
    update({ parts: [...draft.parts, calculatorPartDraftSchema.parse({ id: crypto.randomUUID(), stableRuleId: part.stableRuleId ?? '', label: part.label, operation: part.supportedOperations[0] ?? 'replacement', paintMode: 'full', price: '', labor: '', priceUnknown: false, priorPartState: 'none', treatment: 'standard' })] })
    setQuery('')
  }
  const calculate = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !canCalculate) return
    setMessage(''); setResult(null)
    if (!modern) { setMessage('Referans tahmin, 1 Temmuz 2026 ve sonrasındaki kazalar için kullanılabilir.'); return }
    remember(draft, null)
    let input
    try { input = calculatorRequest(draft, catalog?.parts, 2) } catch (error) { setMessage(reportError(error)); return }
    const started = revision.current
    setBusy(true)
    try {
      const response = await port.calculate(item.caseId, input)
      if (response.ruleVersion !== VALUE_LOSS_CALCULATOR_V2_VERSION) throw new Error('Hesaplama servisi güncel değil. Revize edilmiş hesap için API sürümü de güncellenmelidir.')
      if (response.amountMinor !== null && response.issues.length === 0) notifyValueLossSaved(item.caseId)
      if (active.current && revision.current === started) { resultInput.current = input; setResult(response); setChanged(false); remember(draft, response) }
    } catch (error) { if (active.current && revision.current === started) setMessage(reportError(error)) }
    finally { if (active.current) setBusy(false) }
  }
  const downloadReport = () => {
    if (!result) return
    try {
      const html = calculatorReportHtml(`Dosya ${item.caseId}`, resultInput.current ?? calculatorRequest(draft, catalog?.parts, 2), result)
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url; link.download = `deger-kaybi-${item.caseId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 80)}.html`
      document.body.appendChild(link); link.click(); link.remove()
      // Allow the browser to consume the download before releasing the object URL.
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) { setMessage(reportError(error)) }
  }

  return <section className="value-loss-calculator" aria-labelledby="value-loss-title">
    <header><h2 id="value-loss-title">Değer Kaybı Hesapla</h2><span className="value-loss-calculator__basis">Excel V2</span></header>
    <form onSubmit={event => void calculate(event)} noValidate>
      <button className="button button--secondary" type="button" onClick={refreshCaseDefaults} disabled={!Object.values(calculatorCaseDefaults(item)).some(Boolean)}>Dosya bilgilerini al</button>
      <p className="value-loss-calculator__basis" aria-label="Dosyadan alınan araç bilgileri">{[draft.manufacturer, draft.model, draft.bodyType === 'unspecified' ? '' : VALUE_LOSS_BODY_LABELS[draft.bodyType]].filter(Boolean).join(' · ')}</p>
      <section className="value-loss-calculator__case" aria-labelledby="value-loss-case-title">
      <h3 id="value-loss-case-title">Dosya bilgileri ve eksik hesap girdileri</h3>
      <div className="value-loss-calculator__fields">
        <label className="form-field"><span>Rayiç bedeli (TL)</span><input inputMode="decimal" value={draft.marketValue} onChange={event => update({ marketValue: event.target.value })} placeholder="1.000.000" /></label>
        <label className="form-field"><span>Kaza tarihi</span><input type="date" value={draft.accidentDate} onChange={event => update({ accidentDate: event.target.value })} /></label>
        <label className="form-field"><span>Araç türü</span><select value={draft.vehicleType} onChange={event => {
          const vehicleType = event.target.value as CalculatorDraft['vehicleType']
          const bodyType = valueLossBodyOptions(vehicleType).includes(draft.bodyType) ? draft.bodyType : 'unspecified'
          update({ vehicleType, bodyType, parts: draft.parts.map(part => ({ ...part, stableRuleId: '' })), ...((VEHICLE_GROUPS[vehicleType] === 'D') !== workingHours ? { usageValue: '' } : {}) }); setQuery('')
        }}>{Object.keys(VEHICLE_GROUPS).map(type => <option key={type}>{type}</option>)}</select></label>
        <label className="form-field"><span>Kasa / araç yapısı</span><select value={draft.bodyType} onChange={event => { update({ bodyType: event.target.value as CalculatorDraft['bodyType'], parts: draft.parts.map(part => ({ ...part, stableRuleId: '' })) }); setQuery('') }}>{valueLossBodyOptions(draft.vehicleType).map(body => <option key={body} value={body}>{VALUE_LOSS_BODY_LABELS[body]}</option>)}</select></label>
        {modern && <><label className="form-field"><span>Model yılı</span><input inputMode="numeric" value={draft.modelYear} onChange={event => update({ modelYear: event.target.value })} placeholder="2024" /></label>
        <label className="form-field"><span>{workingHours ? 'Çalışma saati' : 'Kilometre'}</span><input inputMode="numeric" value={draft.usageValue} onChange={event => update({ usageValue: event.target.value })} placeholder="50000" /></label></>}

        <label className="form-field"><span>Hasar tutarı (TL)</span><input inputMode="decimal" value={draft.damageAmount} onChange={event => update({ damageAmount: event.target.value })} placeholder="100.000" /></label>
        <label className="form-field"><span>Karşı taraf kusuru (%)</span><input inputMode="decimal" value={draft.faultPercent} placeholder="Belirlenmediyse boş bırakın" onChange={event => update({ faultPercent: event.target.value })} /></label>
        <label className="form-field"><span>Önceki hasar sayısı</span><input inputMode="numeric" value={draft.previousDamageCount} onChange={event => update({ previousDamageCount: event.target.value })} /></label><label className="value-loss-calculator__check"><input type="checkbox" checked={draft.commercialOrRental || vehicleContext.commercialRequired} disabled={vehicleContext.commercialRequired} onChange={event => update({ commercialOrRental: event.target.checked })} /> Ticari / kiralık kullanım</label>
      </div>
      </section>
      {group === 'Ç' && <p className="value-loss-calculator__basis">Rehber 3.18–3.19: özel amaçlı / tanker araçlarda yalnız kupa ve gövde hasarını girin. Üstyapı hasar bedeli hesap tutarına dahil edilmez.</p>}
      {vehicleContext.commercialRequired && <p className="value-loss-calculator__basis">{draft.vehicleType === 'TAKSİ' ? 'Kaynak rehber 3.6 uyarınca takside ticari kullanım düzeltmesi uygulanır.' : 'Kaynak rehber 3.8 uyarınca bu araç yapısında otomobil tablosu ve ticari değerlendirme birlikte uygulanır.'}</p>}
      <section className="value-loss-calculator__parts" aria-label="Hasarlı parçalar">
        <h3>Hasarlı parçalar</h3>
        <p className="value-loss-calculator__basis">Yalnız bu kazada işlem gören ve geçmiş hasarı bulunmayan parçaları ekleyin. Hasar tutarına da yalnız uygun hasarları dahil edin.</p>
        <div className="value-loss-calculator__add"><div className="form-field"><span>Hasarlı parça</span><SearchableSelect label="Hasarlı parça" value={query} onChange={setQuery} options={suggestions.map(part => ({ value: part.id, label: part.label }))} disabled={catalogLoading || catalogError} /></div><button className="button button--secondary" type="button" onClick={addPart} disabled={catalogLoading || !query || draft.parts.length >= 100}><CirclePlus size={15} /> Ekle</button></div>
        {catalogError && <p role="alert">Parça listesi yüklenemedi. <button type="button" className="button button--secondary" onClick={() => setCatalogRetry(value => value + 1)}>Yeniden dene</button></p>}
        {draft.parts.map(part => <ValueLossCalculatorPart key={part.id} part={part} operations={supported.get(part.stableRuleId)} onUpdate={updatePart} onRemove={removePart} />)}
      </section>
      {blocked && <p className="value-loss-calculator__error" role="alert">{blocked}</p>}
      <footer className="value-loss-calculator__footer"><button className="button button--primary" disabled={!canCalculate || busy || blocked !== null} type="submit">{busy ? <LoaderCircle className="spin" size={17} /> : <Calculator size={17} />}{busy ? 'Hesaplanıyor…' : 'Hesapla'}</button><div aria-live="polite">{!blocked && result?.amountMinor != null ? <><span>{result.ruleVersion !== VALUE_LOSS_CALCULATOR_V2_VERSION ? 'Kayıtlı önceki hesap' : result.breakdown?.faultRateBasisPoints === null ? 'Brüt değer kaybı' : 'Tahmini değer kaybı'}</span><strong>{formatMoney(result.amountMinor)}</strong></> : <span>{changed && !blocked ? 'Bilgiler değişti. Yeniden hesaplayın.' : ''}</span>}</div></footer>
      {result?.amountMinor != null && <p className="value-loss-calculator__saved" role="status">Tutar ve hesap bilgileri bu dosyaya kaydedildi.</p>}
      {result && <ValueLossCalculationDetails result={result} onDownload={downloadReport} />}
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
  return <CalculatorForm key={`${scope}:${JSON.stringify(calculatorCaseDefaults(item))}`} item={item} port={calculator} storageKey={scope} />
}
