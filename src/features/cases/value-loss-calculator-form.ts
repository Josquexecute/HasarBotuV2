import { z } from 'zod'
import { VALUE_LOSS_BODY_TYPES, VALUE_LOSS_PART_MATERIALS, VALUE_LOSS_VEHICLE_GROUPS as VEHICLE_GROUPS, resolveValueLossCalculatorParts, valueLossBaseOnlyPrinciple, valueLossBodyOptions, valueLossCalculatorRequestSchema, valueLossCalculatorVehicleContext, type ValueLossCalculatorPartSelection, type ValueLossCalculatorRequest } from '@hasarbotu/contracts'
import type { CaseRecord } from '../../types/case'
import type { CalculatorSavedInput } from '../../data/valueLossCalculatorPort'
import { calculatorCaseDefaults } from './value-loss-calculator-prefill'

export { VEHICLE_GROUPS }
export const calculatorPartDraftSchema = z.object({
  id: z.string(), stableRuleId: z.string(), label: z.string(), operation: z.enum(['replacement', 'repair', 'paint', 'replacement_paint', 'repair_paint', 'paintless_repair']),
  paintMode: z.enum(['full', 'local']), price: z.string(), labor: z.string(), priceUnknown: z.boolean(),
  priorPartState: z.enum(['unknown', 'none', 'previously_damaged', 'previously_repaired_detachable', 'previously_repaired_welded']),
  priorEvidence: z.string().optional(),
  treatment: z.enum(['standard', 'accessory', 'paintless_repair', 'plastic_or_unpainted', 'superstructure']),
  position: z.string().default(''), quantity: z.string().default('1'), material: z.enum(VALUE_LOSS_PART_MATERIALS).default('unspecified'),
})
export const calculatorDraftSchema = z.object({
  formatVersion: z.union([z.literal(2), z.literal(3)]).default(3), bodyType: z.enum(VALUE_LOSS_BODY_TYPES).default('unspecified'), calculationBasis: z.enum(['reference', 'market_difference']).default('reference'),
  accidentDate: z.string(), vehicleType: z.enum(Object.keys(VEHICLE_GROUPS) as [keyof typeof VEHICLE_GROUPS, ...(keyof typeof VEHICLE_GROUPS)[]]),
  manufacturer: z.string().max(120).default(''), model: z.string().max(160).default(''),
  modelYear: z.string(), usageValue: z.string(), marketValue: z.string(), damageAmount: z.string(),
  previousDamageCount: z.string(), commercialOrRental: z.boolean(),
  vehicleCondition: z.enum(['normal', 'prior_heavy_damage', 'current_heavy_damage', 'antique', 'foreign_plate']),
  postRepairMarketValue: z.string(), faultPercent: z.string(), parts: z.array(calculatorPartDraftSchema).max(100),
})
export type CalculatorDraft = z.infer<typeof calculatorDraftSchema>
export type CalculatorPartDraft = z.infer<typeof calculatorPartDraftSchema>
export const calculatorCaseDefaultsSchema = calculatorDraftSchema.pick({ accidentDate: true, vehicleType: true, bodyType: true, manufacturer: true, model: true, modelYear: true, usageValue: true, previousDamageCount: true, commercialOrRental: true, vehicleCondition: true, damageAmount: true }).partial()

export const CALCULATOR_OPERATION_LABELS = { replacement: 'Değişim', replacement_paint: 'Değişim + Boya', repair: 'Yalnız onarım', repair_paint: 'Onarım + Boya', paint: 'Boya', paintless_repair: 'Boyasız onarım' } as const

export function calculatorOperations(supported: readonly string[]): CalculatorPartDraft['operation'][] {
  return (Object.keys(CALCULATOR_OPERATION_LABELS) as CalculatorPartDraft['operation'][]).filter(operation => {
    if (operation === 'paintless_repair') return supported.includes('repair')
    if (operation === 'repair_paint') return supported.includes('repair') && supported.includes('paint')
    if (operation === 'replacement_paint') return supported.includes('replacement') && supported.includes('paint')
    return supported.includes(operation)
  })
}

/** Older drafts stored paint as a second row for the same physical part. */
export function consolidateCalculatorParts(parts: CalculatorPartDraft[]): CalculatorPartDraft[] {
  return parts.flatMap(part => {
    const peers = parts.filter(other => other.stableRuleId === part.stableRuleId)
    const base = peers.find(other => other.operation === 'repair' || other.operation === 'replacement')
    const paint = peers.find(other => other.operation === 'paint')
    if (part.stableRuleId && peers.length === 2 && base && paint && base.treatment !== 'paintless_repair' && base.treatment === paint.treatment && base.priorPartState === paint.priorPartState && base.position === paint.position && base.quantity === paint.quantity && base.material === paint.material) {
      return part === paint ? [] : [{ ...base, operation: base.operation === 'repair' ? 'repair_paint' as const : 'replacement_paint' as const, paintMode: paint.paintMode }]
    }
    return [{ ...part, ...(part.treatment === 'paintless_repair' && part.operation === 'repair' ? { operation: 'paintless_repair' as const } : {}) }]
  })
}

export function moneyMinor(text: string): number | null {
  const cleaned = text.trim().replaceAll(/\s/g, '')
  const normalized = /^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(cleaned) ? cleaned.replaceAll('.', '').replace(',', '.') : cleaned.replace(',', '.')
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null
  const [whole, fraction = ''] = normalized.split('.')
  const amount = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'))
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null
}
function integer(text: string): number | null {
  const value = text.trim().replaceAll(/\s/g, '')
  const normalized = /^\d{1,3}(?:\.\d{3})+$/.test(value) ? value.replaceAll('.', '') : value
  return /^\d+$/.test(normalized) && Number.isSafeInteger(Number(normalized)) ? Number(normalized) : null
}
function moneyText(value: number | null | undefined): string { return value == null ? '' : String(value / 100).replace('.', ',') }

export function initialCalculatorDraft(item: CaseRecord, saved?: CalculatorSavedInput | null): CalculatorDraft {
  const real = saved?.realMarket
  const defaults = calculatorCaseDefaults(item)
  const evidence = saved?.historyEvidence?.filter(row => row.supports.includes('prior_damage')) ?? []
  const verified = evidence.length > 0 && evidence.every(row => row.verificationStatus === 'verified' && !row.conflict)
  const type = defaults.vehicleType ?? (real?.vehicleType && real.vehicleType in VEHICLE_GROUPS ? real.vehicleType as keyof typeof VEHICLE_GROUPS : 'OTOMOBİL')
  const workingHours = VEHICLE_GROUPS[type] === 'D'
  return {
    formatVersion: 3, bodyType: defaults.bodyType && valueLossBodyOptions(type).includes(defaults.bodyType) ? defaults.bodyType : 'unspecified', calculationBasis: 'reference',
    accidentDate: item.lossDate ?? '', vehicleType: type,
    manufacturer: defaults.manufacturer || saved?.vehicle.make?.trim() || '', model: defaults.model || saved?.vehicle.model?.trim() || '',
    modelYear: defaults.modelYear ?? saved?.vehicle.modelYear?.toString() ?? '',
    usageValue: (workingHours && defaults.vehicleType === undefined ? undefined : defaults.usageValue) ?? real?.usageValue?.toString() ?? (workingHours ? undefined : saved?.vehicle.mileage?.toString()) ?? '',
    marketValue: moneyText(real?.marketValueMinor ?? saved?.preAccidentMarketValueMinor),
    damageAmount: moneyText(real?.damageAmountMinor ?? (item.estimatedDamage > 0 ? Math.round(item.estimatedDamage * 100) : null)),
    previousDamageCount: defaults.previousDamageCount ?? (verified ? real?.previousDamageCount?.toString() : '') ?? '', commercialOrRental: defaults.commercialOrRental ?? real?.commercialOrRental ?? false,
    vehicleCondition: defaults.vehicleCondition ?? (real?.eligibilityFacts.currentHeavyOrTotalDamage || saved?.heavyOrTotalDamage ? 'current_heavy_damage' : real?.eligibilityFacts.priorHeavyDamage ? 'prior_heavy_damage' : real?.eligibilityFacts.antiqueOrCollector ? 'antique' : real?.eligibilityFacts.foreignPlate ? 'foreign_plate' : 'normal'),
    postRepairMarketValue: moneyText(saved?.postRepairMarketValueMinor), faultPercent: String((saved?.faultRateBasisPoints ?? 10_000) / 100),
    parts: consolidateCalculatorParts(real ? real.parts.map((part, index) => {
      const matches = saved?.damageParts.filter(row => row.partCode === part.stableRuleId) ?? []
      return calculatorPartDraftSchema.parse({ id: String(index), stableRuleId: part.stableRuleId, label: saved?.partLabels?.[part.stableRuleId] ?? (matches.length === 1 ? matches[0]!.partName : 'Kayıtlı parça'), operation: part.operation, paintMode: part.paintMode ?? 'full', price: moneyText(part.newPartPriceMinor), labor: moneyText(part.repairLaborMinor), priceUnknown: part.partPriceAvailability === 'unavailable', priorPartState: verified ? part.priorPartState : 'unknown', priorEvidence: verified ? `Kayıtlı geçmiş: ${evidence.map(row => row.evidenceKey).join(', ')}` : '', treatment: part.treatment })
    }) : (saved?.damageParts ?? []).map((part, index) => calculatorPartDraftSchema.parse({
      id: String(index), stableRuleId: '', label: part.partName,
      operation: part.repairAction === 'replace' ? 'replacement' : part.repairAction === 'replace_paint' ? 'replacement_paint' : part.repairAction,
      paintMode: 'full', price: '', labor: '', priceUnknown: true, treatment: 'standard',
      priorPartState: !verified || part.priorDamage === 'unknown' ? 'unknown' : part.priorDamage === 'no' ? 'none' : 'previously_damaged',
      priorEvidence: verified ? `Kayıtlı geçmiş: ${evidence.map(row => row.evidenceKey).join(', ')}` : '',
    }))),
  }
}

export function calculatorSelections(draft: CalculatorDraft, sourceParts?: Parameters<typeof resolveValueLossCalculatorParts>[2]): ValueLossCalculatorPartSelection[] {
  return consolidateCalculatorParts(draft.parts).map(part => {
    const matches = sourceParts?.filter(source => source.label.trim().toLocaleUpperCase('tr-TR') === part.label.trim().toLocaleUpperCase('tr-TR')) ?? []
    return { entryId: part.id, stableRuleId: part.stableRuleId || (matches.length === 1 ? matches[0]!.stableRuleId : null), partName: part.label, position: part.position, quantity: integer(part.quantity) ?? 0, material: part.material, operation: part.operation, paintMode: ['paint', 'repair_paint', 'replacement_paint'].includes(part.operation) ? part.paintMode : null, newPartPriceMinor: moneyMinor(part.price), repairLaborMinor: moneyMinor(part.labor), partPriceAvailability: part.priceUnknown ? 'unavailable' : 'available', priorPartState: part.priorPartState, treatment: part.operation === 'paintless_repair' ? 'paintless_repair' : part.treatment }
  })
}

/** Refresh verified history without replacing the user's current repair observations. */
export function mergeCalculatorHistory(draft: CalculatorDraft, saved: CalculatorDraft): CalculatorDraft {
  const normalize = (value: string) => value.trim().replaceAll(/\s+/g, ' ').toLocaleUpperCase('tr-TR')
  return { ...draft, previousDamageCount: draft.previousDamageCount || saved.previousDamageCount,
    parts: draft.parts.map(part => {
      if (part.priorEvidence === 'Kullanıcı doğrulaması') return part
      const matches = saved.parts.filter(row => part.stableRuleId ? row.stableRuleId === part.stableRuleId : normalize(row.label) === normalize(part.label))
      const history = matches[0]
      if (matches.length === 1 && history?.priorEvidence && history.priorPartState !== 'unknown') return { ...part, priorPartState: history.priorPartState, priorEvidence: history.priorEvidence }
      return part.priorEvidence?.startsWith('Kayıtlı geçmiş:') ? { ...part, priorPartState: 'unknown' as const, priorEvidence: '' } : part
    }),
  }
}

export function calculatorRequiresMarket(draft: CalculatorDraft, sourceParts?: Parameters<typeof resolveValueLossCalculatorParts>[2]): boolean {
  const selections = calculatorSelections(draft)
  if (sourceParts !== undefined) return calculatorPartResolution(draft, sourceParts).requiresMarketDifference
  return selections.some(part => valueLossBaseOnlyPrinciple(part) === null && (part.stableRuleId === null || part.quantity !== 1 || !['unspecified', 'steel'].includes(part.material) || part.treatment !== 'standard' || part.operation === 'paintless_repair'))
}

export function calculatorPartResolution(draft: CalculatorDraft, sourceParts: Parameters<typeof resolveValueLossCalculatorParts>[2]) {
  const identity = draft.manufacturer.trim() || draft.model.trim() ? { identity: { manufacturer: draft.manufacturer, model: draft.model }, modelYear: integer(draft.modelYear) } : undefined
  return resolveValueLossCalculatorParts(draft.vehicleType, draft.bodyType, sourceParts, calculatorSelections(draft, sourceParts), identity)
}

export function calculatorRequest(draft: CalculatorDraft, sourceParts?: Parameters<typeof resolveValueLossCalculatorParts>[2]): ValueLossCalculatorRequest {
  const market = draft.accidentDate < '2026-07-01' || draft.calculationBasis === 'market_difference'
  const selections = calculatorSelections(draft, sourceParts)
  if (selections.some(part => part.priorPartState === 'unknown')) throw new Error('Önceki parça hasarı bilinmiyor. SBM / geçmiş kayıt veya inceleme ile doğrulayın.')
  if (!market && integer(draft.previousDamageCount) === null) throw new Error('Önceki hasar sayısı bilinmiyor. SBM / geçmiş kayıt ile doğrulayın.')
  for (const part of selections) {
    if (!part.partName.trim()) throw new Error('Eklediğiniz parçanın adını girin.')
    if (part.quantity < 1 || part.quantity > 20) throw new Error('Parça adedini 1 ile 20 arasında girin.')
    if (part.quantity > 1 && !part.position.trim()) throw new Error('Birden çok parçanın konumlarını belirtin.')
  }
  if (!market && sourceParts !== undefined && calculatorRequiresMarket(draft, sourceParts)) throw new Error('Seçilen parça veya işlem için referans katsayısı bulunamadı. Parça, işlem, adet ve malzeme bilgilerini kontrol edin; bu seçimle tahmini tutar hesaplanamaz.')
  if (market && moneyMinor(draft.postRepairMarketValue) !== null && moneyMinor(draft.marketValue) !== null && moneyMinor(draft.postRepairMarketValue)! > moneyMinor(draft.marketValue)!) throw new Error('Onarım sonrası değer kaza öncesi piyasa değerini aşamaz.')
  const input = valueLossCalculatorRequestSchema.safeParse({
    ...(draft.manufacturer.trim() && draft.model.trim() ? { vehicleIdentity: { manufacturer: draft.manufacturer, model: draft.model } } : {}),
    bodyType: draft.bodyType, calculationBasis: market ? 'market_difference' : 'reference',
    accidentDate: draft.accidentDate, vehicleType: draft.vehicleType, modelYear: draft.accidentDate < '2026-07-01' ? null : integer(draft.modelYear), usageValue: draft.accidentDate < '2026-07-01' ? null : integer(draft.usageValue),
    marketValueMinor: moneyMinor(draft.marketValue), damageAmountMinor: market ? moneyMinor(draft.damageAmount) ?? 0 : moneyMinor(draft.damageAmount),
    previousDamageCount: integer(draft.previousDamageCount), commercialOrRental: draft.commercialOrRental || valueLossCalculatorVehicleContext(draft.vehicleType, draft.bodyType).commercialRequired, vehicleCondition: draft.vehicleCondition,
    postRepairMarketValueMinor: moneyMinor(draft.postRepairMarketValue), faultRateBasisPoints: moneyMinor(draft.faultPercent),
    parts: [], partSelections: selections,
  })
  if (!input.success) {
    const field = input.error.issues[0]?.path[0]
    const messages: Record<string, string> = { vehicleIdentity: 'Üretici eşleştirmesi için marka ve modeli birlikte girin.', accidentDate: 'Kaza tarihini girin.', modelYear: 'Geçerli bir model yılı girin; kaza yılından büyük olamaz.', usageValue: 'Geçerli kilometre / çalışma saati girin.', marketValueMinor: 'Rayiç bedelini sıfırdan büyük bir TL tutarı olarak girin.', damageAmountMinor: 'Hasar tutarını TL olarak girin.', previousDamageCount: 'Önceki hasar sayısını 0 ile 100 arasında girin.', parts: 'En az bir hasarlı parça ekleyin.', postRepairMarketValueMinor: 'Onarım sonrası piyasa değerini girin.', faultRateBasisPoints: 'Karşı taraf kusurunu 0 ile 100 arasında girin.' }
    throw new Error(messages[String(field)] ?? 'Hesap bilgilerini kontrol edin.')
  }
  if (!market) {
    for (const part of selections) if (valueLossBaseOnlyPrinciple(part) === null && ['repair', 'repair_paint'].includes(part.operation) && part.partPriceAvailability === 'available' && (part.newPartPriceMinor === null || part.newPartPriceMinor === 0 || part.repairLaborMinor === null)) throw new Error('Onarılan parça için yeni parça bedelini ve onarım işçiliğini girin.')
  }
  return input.data
}
