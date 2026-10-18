import { z } from 'zod'
import { valueLossCalculatorRequestSchema, type ValueLossCalculatorRequest } from '@hasarbotu/contracts'
import type { CaseRecord } from '../../types/case'
import type { TrafficValueLossVersionRecord } from '../../data/trafficValueLossPort'

export const VEHICLE_GROUPS = { 'OTOMOBİL': 'A', 'TAKSİ': 'A', 'MİNİBÜS': 'B', 'OTOBÜS': 'B', 'KAMYONET': 'C', 'KAMYON': 'C', 'ÇEKİCİ': 'C', 'İŞ MAKİNESİ': 'D', 'TRAKTÖR': 'D', 'TARIM MAKİNESİ': 'D', 'ÖZEL AMAÇLI ARAÇ': 'Ç', 'RÖMORK': 'E', 'MOTORSİKLET': 'F', 'TANKER': 'Ç' } as const
export const calculatorPartDraftSchema = z.object({
  id: z.string(), stableRuleId: z.string(), label: z.string(), operation: z.enum(['replacement', 'repair', 'paint']),
  paintMode: z.enum(['full', 'local']), price: z.string(), labor: z.string(), priceUnknown: z.boolean(),
  priorPartState: z.enum(['none', 'previously_damaged', 'previously_repaired_detachable', 'previously_repaired_welded']),
  treatment: z.enum(['standard', 'accessory', 'paintless_repair', 'plastic_or_unpainted', 'superstructure']),
})
export const calculatorDraftSchema = z.object({
  accidentDate: z.string(), vehicleType: z.enum(Object.keys(VEHICLE_GROUPS) as [keyof typeof VEHICLE_GROUPS, ...(keyof typeof VEHICLE_GROUPS)[]]),
  modelYear: z.string(), usageValue: z.string(), marketValue: z.string(), damageAmount: z.string(),
  previousDamageCount: z.string(), commercialOrRental: z.boolean(),
  vehicleCondition: z.enum(['normal', 'prior_heavy_damage', 'current_heavy_damage', 'antique', 'foreign_plate']),
  postRepairMarketValue: z.string(), faultPercent: z.string(), parts: z.array(calculatorPartDraftSchema).max(100),
})
export type CalculatorDraft = z.infer<typeof calculatorDraftSchema>
export type CalculatorPartDraft = z.infer<typeof calculatorPartDraftSchema>

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

export function initialCalculatorDraft(item: CaseRecord, saved?: TrafficValueLossVersionRecord['input'] | null): CalculatorDraft {
  const real = saved?.realMarket
  const type = real?.vehicleType && real.vehicleType in VEHICLE_GROUPS ? real.vehicleType as keyof typeof VEHICLE_GROUPS : 'OTOMOBİL'
  return {
    accidentDate: item.lossDate ?? '', vehicleType: type,
    modelYear: saved?.vehicle.modelYear?.toString() ?? item.eksist?.vehicleFields['Model Yılı']?.replace(/\D/g, '') ?? '',
    usageValue: real?.usageValue?.toString() ?? saved?.vehicle.mileage?.toString() ?? '',
    marketValue: moneyText(real?.marketValueMinor ?? saved?.preAccidentMarketValueMinor),
    damageAmount: moneyText(real?.damageAmountMinor ?? (item.estimatedDamage > 0 ? Math.round(item.estimatedDamage * 100) : null)),
    previousDamageCount: String(real?.previousDamageCount ?? 0), commercialOrRental: real?.commercialOrRental ?? false,
    vehicleCondition: real?.eligibilityFacts.currentHeavyOrTotalDamage || saved?.heavyOrTotalDamage ? 'current_heavy_damage' : real?.eligibilityFacts.priorHeavyDamage ? 'prior_heavy_damage' : real?.eligibilityFacts.antiqueOrCollector ? 'antique' : real?.eligibilityFacts.foreignPlate ? 'foreign_plate' : 'normal',
    postRepairMarketValue: moneyText(saved?.postRepairMarketValueMinor), faultPercent: String((saved?.faultRateBasisPoints ?? 10_000) / 100),
    parts: (real?.parts ?? []).map((part, index) => ({ id: String(index), stableRuleId: part.stableRuleId, label: saved?.damageParts[index]?.partName ?? 'Kayıtlı parça', operation: part.operation, paintMode: part.paintMode ?? 'full', price: moneyText(part.newPartPriceMinor), labor: moneyText(part.repairLaborMinor), priceUnknown: part.partPriceAvailability === 'unavailable', priorPartState: part.priorPartState, treatment: part.treatment })),
  }
}

export function calculatorRequest(draft: CalculatorDraft): ValueLossCalculatorRequest {
  const input = valueLossCalculatorRequestSchema.safeParse({
    accidentDate: draft.accidentDate, vehicleType: draft.vehicleType, modelYear: draft.accidentDate < '2026-07-01' ? null : integer(draft.modelYear), usageValue: draft.accidentDate < '2026-07-01' ? null : integer(draft.usageValue),
    marketValueMinor: moneyMinor(draft.marketValue), damageAmountMinor: draft.accidentDate < '2026-07-01' ? 0 : moneyMinor(draft.damageAmount),
    previousDamageCount: integer(draft.previousDamageCount), commercialOrRental: draft.commercialOrRental, vehicleCondition: draft.vehicleCondition,
    postRepairMarketValueMinor: moneyMinor(draft.postRepairMarketValue), faultRateBasisPoints: moneyMinor(draft.faultPercent),
    parts: draft.parts.map(part => ({ stableRuleId: part.stableRuleId, operation: part.operation, paintMode: part.operation === 'paint' ? part.paintMode : null, newPartPriceMinor: moneyMinor(part.price), repairLaborMinor: moneyMinor(part.labor), partPriceAvailability: part.priceUnknown ? 'unavailable' : 'available', priorPartState: part.priorPartState, treatment: part.treatment })),
  })
  if (!input.success) {
    const field = input.error.issues[0]?.path[0]
    const messages: Record<string, string> = { accidentDate: 'Kaza tarihini girin.', modelYear: 'Geçerli bir model yılı girin; kaza yılından büyük olamaz.', usageValue: 'Geçerli kilometre / çalışma saati girin.', marketValueMinor: 'Rayiç bedelini sıfırdan büyük bir TL tutarı olarak girin.', damageAmountMinor: 'Hasar tutarını TL olarak girin.', previousDamageCount: 'Önceki hasar sayısını 0 ile 100 arasında girin.', parts: 'En az bir hasarlı parça ekleyin.', postRepairMarketValueMinor: 'Onarım sonrası piyasa değerini girin.', faultRateBasisPoints: 'Karşı taraf kusurunu 0 ile 100 arasında girin.' }
    throw new Error(messages[String(field)] ?? 'Hesap bilgilerini kontrol edin.')
  }
  if (draft.accidentDate >= '2026-07-01') {
    for (const part of input.data.parts) if (part.operation === 'repair' && part.partPriceAvailability === 'available' && (part.newPartPriceMinor === null || part.newPartPriceMinor === 0 || part.repairLaborMinor === null)) throw new Error('Onarılan parça için yeni parça bedelini ve onarım işçiliğini girin.')
  }
  return input.data
}
