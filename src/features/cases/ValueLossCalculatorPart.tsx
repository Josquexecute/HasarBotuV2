import { memo } from 'react'
import { Trash2 } from 'lucide-react'
import { valueLossBaseOnlyPrinciple } from '@hasarbotu/contracts'
import type { CalculatorPartDraft } from './value-loss-calculator-form'

const operations = { replacement: 'Değişim', repair: 'Onarım', paint: 'Boya' } as const
type Operation = keyof typeof operations

interface PartProps {
  readonly part: CalculatorPartDraft
  readonly operations: readonly string[] | undefined
  readonly onUpdate: (id: string, patch: Partial<CalculatorPartDraft>) => void
  readonly onRemove: (id: string) => void
}

export const ValueLossCalculatorPart = memo(function ValueLossCalculatorPart({ part, operations: supported, onUpdate, onRemove }: PartProps) {
  const operation = part.operation === 'replacement_paint' ? 'replacement'
    : part.operation === 'repair_paint' || part.operation === 'paintless_repair' ? 'repair' : part.operation
  const additionalPaint = part.operation === 'replacement_paint' || part.operation === 'repair_paint'
  const canPaint = supported === undefined || supported.includes('paint')
  const baseOnly = valueLossBaseOnlyPrinciple(part) !== null
  const hasHistory = !['none', 'unknown'].includes(part.priorPartState)

  return <div className="value-loss-calculator__part">
    <strong>{part.label || 'Kayıtlı parça'}</strong>
    <label className="form-field"><span>İşlem</span>
      <select aria-label={`${part.label} işlemi`} value={operation} onChange={event => {
        const next = event.target.value as Operation
        onUpdate(part.id, { operation: next !== 'paint' && additionalPaint ? `${next}_paint` : next })
      }}>
        {(Object.keys(operations) as Operation[]).map(key => <option key={key} value={key} disabled={supported !== undefined && !supported.includes(key)}>{operations[key]}</option>)}
      </select>
    </label>
    <button className="icon-button" type="button" aria-label={`${part.label} işlemini kaldır`} onClick={() => onRemove(part.id)}><Trash2 size={16} /></button>
    {hasHistory && <p className="value-loss-calculator__reference">Geçmiş hasarlı. Parçayı ve hasara düşen payını çıkarın.</p>}
    {baseOnly && <p className="value-loss-calculator__reference">Bu kayıt yalnız baz değer kaybına dahil edilir.</p>}
    {!baseOnly && operation !== 'paint' && canPaint && <label className="value-loss-calculator__check value-loss-calculator__extra-paint">
      <input type="checkbox" aria-label={`${part.label} boya da uygulandı`} checked={additionalPaint}
        onChange={event => onUpdate(part.id, { operation: event.target.checked ? `${operation}_paint` : operation })} />
      Boya da uygulandı
    </label>}
    {!baseOnly && (operation === 'paint' || additionalPaint) && <label className="form-field value-loss-calculator__paint"><span>Boya türü</span>
      <select aria-label={`${part.label} boya türü`} value={part.paintMode} onChange={event => onUpdate(part.id, { paintMode: event.target.value as 'full' | 'local' })}>
        <option value="full">Tam boya</option><option value="local">Lokal boya</option>
      </select>
    </label>}
    {!baseOnly && operation === 'repair' && <div className="value-loss-calculator__repair">
      <label className="value-loss-calculator__check"><input type="checkbox" checked={part.priceUnknown} onChange={event => onUpdate(part.id, { priceUnknown: event.target.checked })} /> Parça bedeli veya işçilik bilinmiyor</label>
      {!part.priceUnknown && <>
        <label className="form-field"><span>Yeni parça bedeli (TL)</span><input inputMode="decimal" aria-label={`${part.label} yeni parça bedeli`} value={part.price} onChange={event => onUpdate(part.id, { price: event.target.value })} /></label>
        <label className="form-field"><span>Onarım işçiliği (TL)</span><input inputMode="decimal" aria-label={`${part.label} onarım işçiliği`} value={part.labor} onChange={event => onUpdate(part.id, { labor: event.target.value })} /></label>
      </>}
      <small>{part.priceUnknown ? 'Doğrulanmış onarıma ağır onarım katsayısı uygulanır.' : 'İskontosuz, KDV hariç bedelleri girin.'}</small>
    </div>}
  </div>
})
