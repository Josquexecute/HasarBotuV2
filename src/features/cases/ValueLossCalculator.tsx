import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Calculator, CirclePlus, LoaderCircle, Trash2 } from 'lucide-react'
import { VALUE_LOSS_BODY_LABELS, VALUE_LOSS_PART_COVERAGE_LABELS, buildValueLossPartSuggestions, valueLossBaseOnlyPrinciple, valueLossBodyOptions, valueLossCalculatorResponseSchema, valueLossCalculatorSourceParts, valueLossCalculatorVehicleContext, type ValueLossCalculatorResponse, type ValueLossPartCoverage } from '@hasarbotu/contracts'
import { canUsePermission } from '../../app/permissions'
import { SearchableSelect } from '../../components/SearchableSelect'
import { useSession } from '../../app/sessionContext'
import type { DataSourceKind } from '../../data/ports'
import { TrafficValueLossError, type TrafficValueLossPartCatalogRecord } from '../../data/trafficValueLossPort'
import { createHttpValueLossCalculatorAdapter, type ValueLossCalculatorPort } from '../../data/valueLossCalculatorPort'
import type { CaseRecord } from '../../types/case'
import { CALCULATOR_OPERATION_LABELS, VEHICLE_GROUPS, calculatorCaseDefaultsSchema, calculatorDraftSchema, calculatorPartDraftSchema, calculatorPartResolution, calculatorRequest, calculatorRequiresMarket, consolidateCalculatorParts, initialCalculatorDraft, mergeCalculatorHistory, type CalculatorDraft, type CalculatorPartDraft } from './value-loss-calculator-form'
import { calculatorCaseDefaults, mergeCalculatorCaseDefaults } from './value-loss-calculator-prefill'

const formatMoney = (value: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(value / 100)

function PartReference({ part, draft, catalog, coverage }: { readonly part: CalculatorPartDraft; readonly draft: CalculatorDraft; readonly catalog: TrafficValueLossPartCatalogRecord | null; readonly coverage: ValueLossPartCoverage | undefined }) {
  if (coverage && ['coefficient_unverified', 'part_mismatch'].includes(coverage.reason)) return <p className="value-loss-calculator__reference">{VALUE_LOSS_PART_COVERAGE_LABELS[coverage.reason]}</p>
  const principle = valueLossBaseOnlyPrinciple(part)
  if (principle !== null) return <p className="value-loss-calculator__reference">Kaynak rehber {principle}: ek parça / boya katsayısı uygulanmaz. Hasar tutarı üzerinden değerlendirilir; toplam değer kaybı sıfır kabul edilmez.</p>
  const rule = valueLossCalculatorSourceParts(draft.vehicleType, draft.bodyType, catalog?.parts ?? []).find(rule => rule.stableRuleId === part.stableRuleId)
  if (!rule?.coefficients) return <p className="value-loss-calculator__reference">Bu parça için doğrulanmış referans bulunamadı; piyasa araştırması gerekir.</p>
  return null
}

function readRemembered(key: string, item: CaseRecord): { draft: CalculatorDraft; result: ValueLossCalculatorResponse | null } | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(key) ?? 'null')
    const draft = calculatorDraftSchema.safeParse(value?.draft)
    if (!draft.success) return null
    const result = valueLossCalculatorResponseSchema.safeParse(value?.result)
    const previousDefaults = calculatorCaseDefaultsSchema.safeParse(value?.caseDefaults)
    const currentFormat = value?.draft?.formatVersion === 3
    const restored = mergeCalculatorCaseDefaults({ ...draft.data, formatVersion: 3, ...(!currentFormat ? { previousDamageCount: calculatorCaseDefaults(item).previousDamageCount ?? '' } : {}), parts: consolidateCalculatorParts(draft.data.parts).map(part => currentFormat ? part : { ...part, priorPartState: 'unknown' as const, priorEvidence: '' }) }, calculatorCaseDefaults(item), previousDefaults.success ? previousDefaults.data : { accidentDate: '', vehicleType: 'OTOMOBİL', bodyType: 'unspecified', manufacturer: '', model: '', modelYear: '' })
    const changed = JSON.stringify(restored) !== JSON.stringify(draft.data)
    return { draft: restored, result: !changed && value?.verificationVersion === 3 && value?.draft?.formatVersion === 3 && result.success ? result.data : null }
  } catch { return null } // Invalid or unavailable session storage must not prevent calculation.
}

function CalculatorForm({ item, port, storageKey }: { readonly item: CaseRecord; readonly port: ValueLossCalculatorPort; readonly storageKey: string }) {
  const { user, reportUnauthorized } = useSession()
  const [initialItem] = useState(item)
  const [remembered] = useState(() => readRemembered(storageKey, item))
  const sourceDefaults = useRef(calculatorCaseDefaultsSchema.parse(initialCalculatorDraft(item)))
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
  const vehicleContext = valueLossCalculatorVehicleContext(draft.vehicleType, draft.bodyType)
  const group = vehicleContext.group
  const catalogKey = `${group}:${catalogRetry}`
  const catalog = catalogState.key === catalogKey ? catalogState.data : null
  const catalogError = catalogState.key === catalogKey && catalogState.error
  const modern = !draft.accidentDate || draft.accidentDate >= '2026-07-01'
  const catalogLoading = catalogState.key !== catalogKey
  const suggestions = useMemo(() => buildValueLossPartSuggestions(draft.vehicleType, draft.bodyType, catalog?.parts ?? []), [draft.vehicleType, draft.bodyType, catalog])
  const marketRequired = calculatorRequiresMarket(draft, catalog?.parts)
  const coverage = useMemo(() => calculatorPartResolution(draft, catalog?.parts ?? []).coverage, [draft, catalog])
  const market = !modern || draft.calculationBasis === 'market_difference'
  const workingHours = group === 'D'
  const canCalculate = canUsePermission(user, 'analysis_write', ['admin', 'expert', 'case_manager'])
  const remember = useCallback((nextDraft: CalculatorDraft, nextResult: ValueLossCalculatorResponse | null) => {
    if (!storageWritable.current) return
    try { window.sessionStorage.setItem(storageKey, JSON.stringify({ verificationVersion: 3, caseDefaults: sourceDefaults.current, draft: nextDraft, result: nextResult })) }
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
      void port.load(initialItem.caseId).then(input => {
        if (active.current && revision.current === initialRevision && input !== null) {
          const saved = initialCalculatorDraft(initialItem, input)
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
  }, [port, initialItem, remembered, reportUnauthorized, remember])

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

  const update = (patch: Partial<CalculatorDraft>) => {
    revision.current++
    const next = { ...draft, ...patch }
    setDraft(next); remember(next, null)
    setChanged(result !== null || changed); setResult(null); setMessage('')
  }
  const updatePart = (id: string, patch: Partial<CalculatorPartDraft>) => {
    update({ parts: draft.parts.map(part => part.id === id ? { ...part, ...patch } : part) })
  }
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
    update({ parts: [...draft.parts, calculatorPartDraftSchema.parse({ id: crypto.randomUUID(), stableRuleId: part.stableRuleId ?? '', label: part.label, operation: part.supportedOperations[0] ?? 'replacement', paintMode: 'full', price: '', labor: '', priceUnknown: false, priorPartState: 'unknown', treatment: 'standard' })] })
    setQuery('')
  }
  const addCustomPart = () => update({ parts: [...draft.parts, calculatorPartDraftSchema.parse({ id: crypto.randomUUID(), stableRuleId: '', label: '', operation: 'replacement', paintMode: 'full', price: '', labor: '', priceUnknown: false, priorPartState: 'unknown', treatment: 'standard' })] })
  const calculate = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !canCalculate) return
    setMessage(''); setResult(null)
    remember(draft, null)
    let input
    try { input = calculatorRequest(draft, catalog?.parts) } catch (error) { setMessage(reportError(error)); return }
    const started = revision.current
    setBusy(true)
    try {
      const response = await port.calculate(item.caseId, input)
      if (active.current && revision.current === started) { setResult(response); setChanged(false); remember(draft, response) }
    } catch (error) { if (active.current && revision.current === started) setMessage(reportError(error)) }
    finally { if (active.current) setBusy(false) }
  }

  return <section className="value-loss-calculator" aria-labelledby="value-loss-title">
    <header><div><h2 id="value-loss-title">Değer Kaybı Hesapla</h2><p>Hasarsız rayiç bedelini, hasarlı parçaları ve işlemleri girin. Mevcut dosya bilgileri otomatik alınır.</p></div><Calculator size={22} /></header>
    <form onSubmit={event => void calculate(event)} noValidate>
      <button className="button button--secondary" type="button" onClick={refreshCaseDefaults} disabled={!Object.values(calculatorCaseDefaults(item)).some(Boolean)}>Dosya bilgilerini al</button>
      <p className="value-loss-calculator__basis" aria-label="Dosyadan alınan araç bilgileri">{[draft.manufacturer, draft.model, draft.bodyType === 'unspecified' ? '' : VALUE_LOSS_BODY_LABELS[draft.bodyType]].filter(Boolean).join(' · ') || 'Dosyada marka / model / kasa bilgisi yok. Genel araç grubu referansı kullanılır.'}</p>
      <div className="value-loss-calculator__fields">
        <label className="form-field"><span>Rayiç bedeli (TL)</span><input inputMode="decimal" value={draft.marketValue} onChange={event => update({ marketValue: event.target.value })} placeholder="1.000.000" /></label>
      </div>
      <details open={!draft.modelYear || !draft.usageValue || !draft.previousDamageCount || !draft.damageAmount}><summary>Dosya bilgileri ve eksik hesap girdileri</summary>
      <div className="value-loss-calculator__fields">
        <label className="form-field"><span>Kaza tarihi</span><input type="date" value={draft.accidentDate} onChange={event => update({ accidentDate: event.target.value })} /></label>
        <label className="form-field"><span>Araç türü</span><select value={draft.vehicleType} onChange={event => {
          const vehicleType = event.target.value as CalculatorDraft['vehicleType']
          const bodyType = valueLossBodyOptions(vehicleType).includes(draft.bodyType) ? draft.bodyType : 'unspecified'
          update({ vehicleType, bodyType, parts: draft.parts.map(part => ({ ...part, stableRuleId: '' })), ...((VEHICLE_GROUPS[vehicleType] === 'D') !== workingHours ? { usageValue: '' } : {}) }); setQuery('')
        }}>{Object.keys(VEHICLE_GROUPS).map(type => <option key={type}>{type}</option>)}</select></label>
        <label className="form-field"><span>Hesap yöntemi</span><select value={market ? 'market_difference' : 'reference'} onChange={event => update({ calculationBasis: event.target.value as CalculatorDraft['calculationBasis'] })}><option value="reference" disabled={!modern}>Referans tahmin</option><option value="market_difference">Piyasa değer farkı (değerler biliniyorsa)</option></select></label>
        {modern && <><label className="form-field"><span>Model yılı</span><input inputMode="numeric" value={draft.modelYear} onChange={event => update({ modelYear: event.target.value })} placeholder="2024" /></label>
        <label className="form-field"><span>{workingHours ? 'Çalışma saati' : 'Kilometre'}</span><input inputMode="numeric" value={draft.usageValue} onChange={event => update({ usageValue: event.target.value })} placeholder="50000" /></label></>}

        {!market ? <label className="form-field"><span>Hasar tutarı (TL)</span><input inputMode="decimal" value={draft.damageAmount} onChange={event => update({ damageAmount: event.target.value })} placeholder="100.000" /></label>
          : <label className="form-field"><span>Onarım sonrası piyasa değeri (TL)</span><input inputMode="decimal" value={draft.postRepairMarketValue} onChange={event => update({ postRepairMarketValue: event.target.value })} /></label>}
        <label className="form-field"><span>Araç durumu</span><select value={draft.vehicleCondition} onChange={event => update({ vehicleCondition: event.target.value as CalculatorDraft['vehicleCondition'] })}><option value="normal">Normal</option><option value="prior_heavy_damage">Önceki ağır hasar</option><option value="current_heavy_damage">Mevcut ağır / pert hasar</option><option value="antique">Antika / koleksiyon</option><option value="foreign_plate">Yabancı plaka</option></select></label>
        {!market ? <><label className="form-field"><span>Önceki hasar sayısı</span><input inputMode="numeric" value={draft.previousDamageCount} onChange={event => update({ previousDamageCount: event.target.value })} /></label><label className="value-loss-calculator__check"><input type="checkbox" checked={draft.commercialOrRental || vehicleContext.commercialRequired} disabled={vehicleContext.commercialRequired} onChange={event => update({ commercialOrRental: event.target.checked })} /> Ticari / kiralık kullanım</label></>
          : <label className="form-field"><span>Karşı taraf kusuru (%)</span><input inputMode="decimal" value={draft.faultPercent} onChange={event => update({ faultPercent: event.target.value })} /></label>}
      </div>
      </details>
      {vehicleContext.commercialRequired && <p className="value-loss-calculator__basis">Kaynak rehber 3.8 uyarınca bu araç yapısında otomobil tablosu ve ticari değerlendirme birlikte uygulanır.</p>}
      <section className="value-loss-calculator__parts" aria-label="Hasarlı parçalar">
        <p className="value-loss-calculator__basis">Parçayı ve yapılan işlemi seçin. Konum ve referans eşleştirmesi parça adından alınır. Önceki hasar bilinmiyorsa doğrulama gerekir.</p>
        <div className="value-loss-calculator__add"><div className="form-field"><span>Hasarlı parça</span><SearchableSelect label="Hasarlı parça" value={query} onChange={setQuery} options={suggestions.map(part => ({ value: part.id, label: part.label }))} disabled={catalogLoading || catalogError} /></div><button className="button button--secondary" type="button" onClick={addPart} disabled={catalogLoading || !query || draft.parts.length >= 100}><CirclePlus size={15} /> Ekle</button></div>
        <button className="button button--secondary value-loss-calculator__custom" type="button" onClick={addCustomPart} disabled={draft.parts.length >= 100}><CirclePlus size={15} /> Listede olmayan parça ekle</button>
        {catalogError && <p role="alert">Parça listesi yüklenemedi. <button type="button" className="button button--secondary" onClick={() => setCatalogRetry(value => value + 1)}>Yeniden dene</button></p>}
        {draft.parts.map((part, index) => <div className="value-loss-calculator__part" key={part.id}>
          <strong>{part.label || 'Yeni parça'}</strong>
          <label className="form-field"><span>İşlem</span><select aria-label={`${part.label} işlemi`} value={part.operation} onChange={event => {
            const operation = event.target.value as CalculatorPartDraft['operation']
            updatePart(part.id, { operation, treatment: operation === 'paintless_repair' ? 'paintless_repair' : part.treatment === 'paintless_repair' ? 'standard' : part.treatment })
          }}>{Object.entries(CALCULATOR_OPERATION_LABELS).map(([operation, label]) => <option key={operation} value={operation}>{label}</option>)}</select></label>
          <label className="form-field"><span>Önceki durum</span><select aria-label={`${part.label} önceki durumu`} value={part.priorPartState} onChange={event => updatePart(part.id, { priorPartState: event.target.value as CalculatorPartDraft['priorPartState'], priorEvidence: 'Kullanıcı doğrulaması' })}><option value="unknown">Bilinmiyor — doğrulama gerekli</option><option value="none">Hasarsız (kayıt / inceleme ile doğrulandı)</option><option value="previously_damaged">Önceden hasarlı</option><option value="previously_repaired_detachable">Sökülebilir parça onarımlı</option><option value="previously_repaired_welded">Sabit parça onarımlı</option></select></label>
          <button className="icon-button" type="button" aria-label={`${part.label} işlemini kaldır`} onClick={() => update({ parts: draft.parts.filter(row => row.id !== part.id) })}><Trash2 size={16} /></button>
          <div className="value-loss-calculator__part-facts">
            {!part.stableRuleId && <label className="form-field"><span>Parça adı</span><input aria-label={`${index + 1}. parça adı`} value={part.label} maxLength={200} onChange={event => updatePart(part.id, { label: event.target.value })} placeholder="Örn. ön grenaj" /></label>}
          </div>
          {part.priorEvidence && <small>{part.priorEvidence}</small>}
          <PartReference part={part} draft={draft} catalog={catalog} coverage={coverage.find(entry => entry.entryId === part.id)} />
          {['paint', 'repair_paint', 'replacement_paint'].includes(part.operation) && <label className="form-field"><span>Boya türü</span><select aria-label={`${part.label} boya türü`} value={part.paintMode} onChange={event => updatePart(part.id, { paintMode: event.target.value as 'full' | 'local' })}><option value="full">Tam boya</option><option value="local">Lokal boya</option></select></label>}
          {!market && valueLossBaseOnlyPrinciple(part) === null && ['repair', 'repair_paint'].includes(part.operation) && <div className="value-loss-calculator__repair"><label className="value-loss-calculator__check"><input type="checkbox" checked={part.priceUnknown} onChange={event => updatePart(part.id, { priceUnknown: event.target.checked })} /> Parça bedeli bilinmiyor</label>{!part.priceUnknown && <><label className="form-field"><span>Yeni parça bedeli (TL)</span><input inputMode="decimal" aria-label={`${part.label} yeni parça bedeli`} value={part.price} onChange={event => updatePart(part.id, { price: event.target.value })} /></label><label className="form-field"><span>Onarım işçiliği (TL)</span><input inputMode="decimal" aria-label={`${part.label} onarım işçiliği`} value={part.labor} onChange={event => updatePart(part.id, { labor: event.target.value })} /></label></>}<small>İskontosuz, KDV hariç bedelleri girin.{part.priceUnknown && ' Bedel bilinmiyorsa ağır onarım katsayısı uygulanır.'}</small></div>}

        </div>)}
      </section>
      {marketRequired && !market && <p className="value-loss-calculator__basis" role="status">Seçilen parça veya işlem referans tabloda karşılanmıyor. Doğrulanmış eşleştirme yok; bu seçimle tahmini tutar hesaplanamaz.</p>}
      {!market && <p className="value-loss-calculator__basis">Tahmin; rayiç bedeli, hasar tutarı, araç yaşı, kullanım ve parça işlemlerinden hesaplanır. Onarım sonrası piyasa değerini bilmeniz gerekmez. Sonuç araç grubunun referans tahminidir; modele özel piyasa araştırması değildir.</p>}
      {draft.parts.some(part => part.priorPartState === 'unknown') && <p role="status">Önceki parça hasarı bilinmiyor. SBM / geçmiş kayıt veya inceleme ile doğrulamadan tutar hesaplanmaz. KTT sonucu parça geçmişi değildir.</p>}
      <footer className="value-loss-calculator__footer"><button className="button button--primary" disabled={!canCalculate || busy} type="submit">{busy ? <LoaderCircle className="spin" size={17} /> : <Calculator size={17} />}{busy ? 'Hesaplanıyor…' : 'Hesapla'}</button><div aria-live="polite">{result?.amountMinor != null ? <><span>{result.calculationMethod === 'real_market_analysis' ? 'Tahmini değer kaybı' : 'Piyasa değer farkı'}</span><strong>{formatMoney(result.amountMinor)}</strong></> : <span>{changed ? 'Bilgiler değişti. Yeniden hesaplayın.' : 'Hesaplanan tutar burada görünecek.'}</span>}</div></footer>
      <p className="value-loss-calculator__basis">Piyasa değerlerini kaza tarihi koşullarında, aracın geçmiş hasarını da dikkate alarak girin. Sonuç girilen değerlere dayanır. <a href="https://seddk.gov.tr/UploadContent/Documents/2026-11_Say%C4%B1l%C4%B1_Genelge.pdf" target="_blank" rel="noreferrer">SEDDK 2026/11 rapor şablonu</a></p>
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
