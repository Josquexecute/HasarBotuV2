import { VALUE_LOSS_BODY_LABELS, VALUE_LOSS_VEHICLE_GROUPS, valueLossBodyOptions } from '@hasarbotu/contracts'
import type { CaseRecord } from '../../types/case'
import type { CalculatorDraft } from './value-loss-calculator-form'

export type CalculatorCaseDefaults = Partial<Pick<CalculatorDraft, 'accidentDate' | 'vehicleType' | 'bodyType' | 'manufacturer' | 'model' | 'modelYear'>>
const plain = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').replace(/ı/g, 'i').toLowerCase()
const key = (value: string) => plain(value).replace(/[^a-z0-9]/g, '')
const vehicleTypes = new Map(Object.keys(VALUE_LOSS_VEHICLE_GROUPS).map(type => [key(type), type as CalculatorDraft['vehicleType']]))
vehicleTypes.set('motosiklet', 'MOTORSİKLET')
const bodies = new Map(Object.entries(VALUE_LOSS_BODY_LABELS).flatMap(([body, label]): [string, CalculatorDraft['bodyType']][] => [[key(body), body as CalculatorDraft['bodyType']], [key(label), body as CalculatorDraft['bodyType']]]))
for (const [alias, body] of [['cabriolet', 'cabriolet'], ['cabrio', 'cabriolet'], ['station', 'station_wagon'], ['sw', 'station_wagon'], ['pikap', 'pickup'], ['coupe', 'coupe']] as const) bodies.set(alias, body)

/** Exact source labels and explicit body descriptions only; a model name is not a body catalogue. */
export function calculatorCaseDefaults(item: CaseRecord): CalculatorCaseDefaults {
  const fields = Object.entries(item.eksist?.vehicleFields ?? {})
  const get = (...labels: string[]) => {
    const names = new Set(labels.map(key))
    const values = [...new Set(fields.filter(([label]) => names.has(key(label))).map(([, value]) => value.trim().replace(/\s+/g, ' ')).filter(Boolean))]
    return values.length === 1 ? values[0]! : ''
  }
  const tariff = get('Araç Tarife Grubu') || get('Araç Cinsi')
  const vehicleType = vehicleTypes.get(key(tariff.replace(/^\d+\s*[-–:/.]\s*/, '')))
  const manufacturer = get('Marka')
  const model = get('Araç Tipi') || get('Model')
  const year = get('Model Yılı')
  const modelYear = /^\d{4}$/.test(year) && Number(year) >= 1900 && Number(year) <= 2200 ? year : ''
  const bodyLabels = ['Kasa Tipi', 'Kasa Cinsi', 'Gövde Tipi', 'Araç Gövde Tipi', 'Kasa / Araç Yapısı']
  const bodyText = get(...bodyLabels)
  let bodyType = bodies.get(key(bodyText))
  if (!fields.some(([label, value]) => bodyLabels.some(bodyLabel => key(bodyLabel) === key(label)) && value.trim())) {
    const description = plain([model, get('Tip / Varyant / Versiyon')].join(' '))
    const hints: [RegExp, CalculatorDraft['bodyType']][] = [
      [/\bsedan\b/, 'sedan'], [/\bhatchback\b/, 'hatchback'], [/\bstation[\s-]*wagon\b/, 'station_wagon'],
      [/\bsuv\b/, 'suv'], [/\bcoupe\b/, 'coupe'], [/\bcabrio(?:let)?\b/, 'cabriolet'], [/\bpanel[\s-]*van\b/, 'panel_van'],
    ]
    const matches = hints.filter(([pattern]) => pattern.test(description)).map(([, body]) => body)
    if (matches.length === 1) bodyType = matches[0]
  }
  const defaults: CalculatorCaseDefaults = {
    accidentDate: item.lossDate ?? '',
    ...(vehicleType ? { vehicleType } : {}), ...(manufacturer ? { manufacturer } : {}),
    ...(model ? { model } : {}), ...(modelYear ? { modelYear } : {}),
  }
  if (bodyType && valueLossBodyOptions(vehicleType ?? 'OTOMOBİL').includes(bodyType)) defaults.bodyType = bodyType
  return defaults
}

/** Follow refreshed source values only while the corresponding field is still automatic. */
export function mergeCalculatorCaseDefaults(draft: CalculatorDraft, defaults: CalculatorCaseDefaults, previous: CalculatorCaseDefaults): CalculatorDraft {
  const next = { ...draft }
  for (const field of Object.keys(defaults) as (keyof CalculatorCaseDefaults)[]) {
    if (draft[field] === previous[field]) Object.assign(next, { [field]: defaults[field] })
  }
  if (!valueLossBodyOptions(next.vehicleType).includes(next.bodyType)) next.bodyType = 'unspecified'
  if (next.vehicleType !== draft.vehicleType || next.bodyType !== draft.bodyType) {
    // Physical observations remain useful even when their old reference IDs no longer apply.
    next.parts = draft.parts.map(part => ({ ...part, stableRuleId: '' }))
    if ((VALUE_LOSS_VEHICLE_GROUPS[next.vehicleType] === 'D') !== (VALUE_LOSS_VEHICLE_GROUPS[draft.vehicleType] === 'D')) next.usageValue = ''
  }
  return next
}
