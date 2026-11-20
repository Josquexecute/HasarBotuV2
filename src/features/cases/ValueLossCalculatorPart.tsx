import { memo } from 'react'
import { Trash2 } from 'lucide-react'
import { VALUE_LOSS_PART_COVERAGE_LABELS, valueLossBaseOnlyPrinciple, type ValueLossPartCoverage } from '@hasarbotu/contracts'
import { CALCULATOR_OPERATION_LABELS, type CalculatorPartDraft } from './value-loss-calculator-form'

function PartReference({ part, hasReference, coverage }: { readonly part: CalculatorPartDraft; readonly hasReference: boolean; readonly coverage: ValueLossPartCoverage | undefined }) {
  if (coverage && ['coefficient_unverified', 'part_mismatch'].includes(coverage.reason)) return <p className="value-loss-calculator__reference">{VALUE_LOSS_PART_COVERAGE_LABELS[coverage.reason]}</p>
  const principle = valueLossBaseOnlyPrinciple(part)
  if (principle !== null) return <p className="value-loss-calculator__reference">Kaynak rehber {principle}: ek parça / boya katsayısı uygulanmaz. Hasar tutarı üzerinden değerlendirilir; toplam değer kaybı sıfır kabul edilmez.</p>
  if (!hasReference) return <p className="value-loss-calculator__reference">Bu parça için doğrulanmış referans bulunamadı; piyasa araştırması gerekir.</p>
  return null
}

interface PartProps {
  readonly part: CalculatorPartDraft
  readonly index: number
  readonly hasReference: boolean
  readonly coverage: ValueLossPartCoverage | undefined
  readonly onUpdate: (id: string, patch: Partial<CalculatorPartDraft>) => void
  readonly onRemove: (id: string) => void
}

export const ValueLossCalculatorPart = memo(function ValueLossCalculatorPart({ part, index, hasReference, coverage, onUpdate, onRemove }: PartProps) {
  return <div className="value-loss-calculator__part" >
          <strong><span className="value-loss-calculator__part-number">{index + 1}</span>{part.label || 'Yeni parça'}</strong>
          <label className="form-field"><span>İşlem</span><select aria-label={`${part.label} işlemi`} value={part.operation} onChange={event => {
            const operation = event.target.value as CalculatorPartDraft['operation']
            onUpdate(part.id, { operation, treatment: operation === 'paintless_repair' ? 'paintless_repair' : part.treatment === 'paintless_repair' ? 'standard' : part.treatment })
          }}>{Object.entries(CALCULATOR_OPERATION_LABELS).map(([operation, label]) => <option key={operation} value={operation}>{label}</option>)}</select></label>
          <label className="form-field"><span>Önceki durum</span><select aria-label={`${part.label} önceki durumu`} value={part.priorPartState} onChange={event => onUpdate(part.id, { priorPartState: event.target.value as CalculatorPartDraft['priorPartState'], priorEvidence: 'Kullanıcı doğrulaması' })}><option value="unknown">Doğrulama gerekli</option><option value="none">Önceki hasarı yok (doğrulandı)</option><option value="previously_damaged">Önceden hasarlı</option><option value="previously_repaired_detachable">Sökülebilir parça onarımlı</option><option value="previously_repaired_welded">Sabit parça onarımlı</option></select></label>
          <button className="icon-button" type="button" aria-label={`${part.label} işlemini kaldır`} onClick={() => onRemove(part.id)}><Trash2 size={16} /></button>
          {!part.stableRuleId && <div className="value-loss-calculator__part-facts"> <label className="form-field"><span>Parça adı</span><input aria-label={`${index + 1}. parça adı`} value={part.label} maxLength={200} onChange={event => onUpdate(part.id, { label: event.target.value })} placeholder="Örn. ön grenaj" /></label>
          </div>}
          <label className="form-field"><span>Parça malzemesi</span><select aria-label={`${part.label || 'Yeni parça'} malzemesi`} value={part.material} onChange={event => onUpdate(part.id, { material: event.target.value as CalculatorPartDraft['material'] })}><option value="unspecified">Belirtilmedi</option><option value="steel">Sac / çelik</option><option value="aluminium">Alüminyum</option><option value="plastic_bodywork">Plastik karoseri (doğrulandı)</option><option value="plastic">Diğer plastik</option><option value="other">Diğer malzeme</option></select></label>
          {['steel', 'aluminium'].includes(part.material) && part.operation !== 'paintless_repair' && <label className="value-loss-calculator__check"><input type="checkbox" checked={part.treatment === 'plastic_or_unpainted'} onChange={event => onUpdate(part.id, { treatment: event.target.checked ? 'plastic_or_unpainted' : 'standard' })} /> Boyasız panel (rehber 3.9)</label>}
          <PartReference part={part} hasReference={hasReference} coverage={coverage} />
          {['paint', 'repair_paint', 'replacement_paint'].includes(part.operation) && <label className="form-field"><span>Boya türü</span><select aria-label={`${part.label} boya türü`} value={part.paintMode} onChange={event => onUpdate(part.id, { paintMode: event.target.value as 'full' | 'local' })}><option value="full">Tam boya</option><option value="local">Lokal boya</option></select></label>}
          {valueLossBaseOnlyPrinciple(part) === null && ['repair', 'repair_paint'].includes(part.operation) && <div className="value-loss-calculator__repair"><label className="value-loss-calculator__check"><input type="checkbox" checked={part.priceUnknown} onChange={event => onUpdate(part.id, { priceUnknown: event.target.checked })} /> Parça bedeli bilinmiyor</label>{!part.priceUnknown && <><label className="form-field"><span>Yeni parça bedeli (TL)</span><input inputMode="decimal" aria-label={`${part.label} yeni parça bedeli`} value={part.price} onChange={event => onUpdate(part.id, { price: event.target.value })} /></label><label className="form-field"><span>Onarım işçiliği (TL)</span><input inputMode="decimal" aria-label={`${part.label} onarım işçiliği`} value={part.labor} onChange={event => onUpdate(part.id, { labor: event.target.value })} /></label></>}<small>İskontosuz, KDV hariç bedelleri girin.{part.priceUnknown && ' Bedel bilinmiyorsa ağır onarım katsayısı uygulanır.'}</small></div>}

        </div>
})
