import type { RealMarketValueLossPartInput } from './traffic-value-loss-real-market.js'
import { buildValueLossPartStableId, type ValueLossPartRule } from './value-loss-rule-snapshot.js'
import { findValueLossManufacturerPart, type ValueLossVehicleIdentity } from './value-loss-manufacturer-catalog.js'

export const VALUE_LOSS_CALCULATOR_OPERATIONS = ['replacement', 'replacement_paint', 'repair', 'repair_paint', 'paint', 'paintless_repair'] as const
export const VALUE_LOSS_PART_MATERIALS = ['unspecified', 'steel', 'aluminium', 'plastic', 'plastic_bodywork', 'composite', 'glass', 'mechanical', 'electrical', 'accessory', 'superstructure', 'other'] as const
export const VALUE_LOSS_BODY_TYPES = ['unspecified', 'sedan', 'hatchback', 'station_wagon', 'suv', 'coupe', 'cabriolet', 'van_minibus', 'coach_minibus', 'city_bus', 'coach', 'midibus', 'panel_van', 'passenger_van', 'pickup', 'double_cab_pickup', 'truck', 'tractor_unit', 'excavator', 'loader', 'backhoe_loader', 'cab_tractor', 'open_tractor', 'combine', 'special_body', 'box_trailer', 'flatbed_trailer', 'tanker_trailer', 'scooter', 'naked', 'sport', 'touring', 'off_road', 'tanker_truck', 'other'] as const
export const VALUE_LOSS_CALCULATOR_REFERENCE_VERSION = 'calculator-reference/2026-07-01/1.1.0' as const
export const VALUE_LOSS_VEHICLE_GROUPS = { 'OTOMOBİL': 'A', 'TAKSİ': 'A', 'MİNİBÜS': 'B', 'OTOBÜS': 'B', 'KAMYONET': 'C', 'KAMYON': 'C', 'ÇEKİCİ': 'C', 'İŞ MAKİNESİ': 'D', 'TRAKTÖR': 'D', 'TARIM MAKİNESİ': 'D', 'ÖZEL AMAÇLI ARAÇ': 'Ç', 'RÖMORK': 'E', 'MOTORSİKLET': 'F', 'TANKER': 'Ç' } as const
export type ValueLossBodyType = typeof VALUE_LOSS_BODY_TYPES[number]
export type ValueLossPartMaterial = typeof VALUE_LOSS_PART_MATERIALS[number]
export type ValueLossCalculatorOperation = typeof VALUE_LOSS_CALCULATOR_OPERATIONS[number]

export const VALUE_LOSS_BODY_LABELS: Record<ValueLossBodyType, string> = {
  unspecified: 'Belirtilmedi', sedan: 'Sedan', hatchback: 'Hatchback', station_wagon: 'Station wagon', suv: 'SUV', coupe: 'Coupe', cabriolet: 'Cabrio',
  van_minibus: 'Van tipi minibüs', coach_minibus: 'Otobüs gövdeli minibüs', city_bus: 'Şehir içi otobüs', coach: 'Şehirler arası otobüs', midibus: 'Midibüs',
  panel_van: 'Panelvan', passenger_van: 'Koltuklu hususi görünümlü hafif ticari', pickup: 'Tek kabin pikap', double_cab_pickup: 'Çift kabin pikap', truck: 'Kamyon', tractor_unit: 'Çekici kabini',
  excavator: 'Ekskavatör', loader: 'Yükleyici', backhoe_loader: 'Kazıcı yükleyici', cab_tractor: 'Kabinli traktör', open_tractor: 'Kabinsiz traktör', combine: 'Biçerdöver',
  special_body: 'Özel üstyapı', box_trailer: 'Kapalı kasa / tenteli römork', flatbed_trailer: 'Platform römork', tanker_trailer: 'Tanker römork',
  scooter: 'Scooter', naked: 'Naked', sport: 'Sport', touring: 'Touring / adventure', off_road: 'Enduro / off-road', tanker_truck: 'Tanker kamyon', other: 'Diğer yapı',
}

const BODY_PROFILES: Record<string, readonly ValueLossBodyType[]> = {
  'OTOMOBİL': ['sedan', 'hatchback', 'station_wagon', 'suv', 'coupe', 'cabriolet'], 'TAKSİ': ['sedan', 'hatchback', 'station_wagon', 'suv'],
  'MİNİBÜS': ['van_minibus', 'coach_minibus'], 'OTOBÜS': ['city_bus', 'coach', 'midibus'],
  'KAMYONET': ['panel_van', 'passenger_van', 'pickup', 'double_cab_pickup', 'truck'], 'KAMYON': ['truck'], 'ÇEKİCİ': ['tractor_unit'],
  'İŞ MAKİNESİ': ['excavator', 'loader', 'backhoe_loader'], 'TRAKTÖR': ['cab_tractor', 'open_tractor'], 'TARIM MAKİNESİ': ['combine', 'cab_tractor', 'open_tractor'],
  'ÖZEL AMAÇLI ARAÇ': ['special_body'], 'RÖMORK': ['box_trailer', 'flatbed_trailer', 'tanker_trailer'],
  'MOTORSİKLET': ['scooter', 'naked', 'sport', 'touring', 'off_road'], 'TANKER': ['tanker_truck', 'tanker_trailer'],
}

export function valueLossBodyOptions(vehicleType: string): readonly ValueLossBodyType[] {
  return ['unspecified', ...(BODY_PROFILES[vehicleType] ?? []), 'other']
}

export function valueLossCalculatorVehicleContext(vehicleType: keyof typeof VALUE_LOSS_VEHICLE_GROUPS, body: ValueLossBodyType) {
  // Source application principle 3.8, Uygulama Esasları!B54.
  const passengerVan = vehicleType === 'KAMYONET' && body === 'passenger_van'
  return { vehicleType: passengerVan ? 'OTOMOBİL' as const : vehicleType, group: passengerVan ? 'A' as const : VALUE_LOSS_VEHICLE_GROUPS[vehicleType], commercialRequired: passengerVan }
}

export interface ValueLossSourcePart {
  readonly stableRuleId: string
  readonly label: string
  readonly supportedOperations: readonly string[]
  readonly coefficients?: ValueLossPartRule['coefficients']
}
export interface ValueLossPartSuggestion {
  readonly id: string
  readonly label: string
  readonly stableRuleId: string | null
  readonly supportedOperations: readonly string[]
}
export interface ValueLossCalculatorPartSelection extends Omit<RealMarketValueLossPartInput, 'stableRuleId' | 'operation'> {
  readonly entryId: string
  readonly stableRuleId: string | null
  readonly partName: string
  readonly position: string
  readonly quantity: number
  readonly material: ValueLossPartMaterial
  readonly operation: ValueLossCalculatorOperation
}

const normalized = (value: string) => value.trim().replaceAll(/\s+/g, ' ').toLocaleUpperCase('tr-TR')
const categoryLabel = (value: string) => normalized(value).replace(/^YAN KAPAK \d+$/, 'YAN KAPAK')

/** Source workbook Tablolar!B264:L265; application principle 3.7 (B50). */
export function valueLossCalculatorAdditionalRules(vehicleType: string, body: ValueLossBodyType): readonly ValueLossPartRule[] {
  if (vehicleType !== 'OTOMOBİL' || body !== 'cabriolet') return []
  return [264, 265].map(row => {
    const sourceLabel = `${row === 264 ? 'SOL' : 'SAĞ'} YAN PANEL (TİCARİ VE CABRİO)`
    const normalizedLabel = sourceLabel.toLocaleLowerCase('tr-TR')
    const operationCapabilities = ['replacement', 'repair', 'paint'] as const
    return { stableId: buildValueLossPartStableId({ vehicleGroupCode: 'A', sourceTable: 'calculator-source-additions', sourceRow: row, normalizedLabel, operationCapabilities }), vehicleGroupCode: 'A', sourceTable: 'calculator-source-additions', sourceRow: row, sourceLabel, normalizedLabel, operationCapabilities, coefficients: { replacement: '4.5', repair: { light: '1', medium: '1.5', heavy: '2' }, paint: { full: '1.5', local: '0.75' } } }
  })
}

export function valueLossCalculatorSourceParts(vehicleType: string, body: ValueLossBodyType, source: readonly ValueLossSourcePart[]): ValueLossSourcePart[] {
  return [...source, ...valueLossCalculatorAdditionalRules(vehicleType, body).map(rule => ({ stableRuleId: rule.stableId, label: rule.sourceLabel, supportedOperations: rule.operationCapabilities, coefficients: rule.coefficients }))]
}

/** Zero additional part coefficient is explicit here; it is not zero total value loss. */
export function valueLossBaseOnlyPrinciple(entry: Pick<ValueLossCalculatorPartSelection, 'material' | 'operation'> & Partial<Pick<ValueLossCalculatorPartSelection, 'treatment'>>): '3.9' | '3.10' | null {
  if (entry.treatment && !['standard', 'paintless_repair'].includes(entry.treatment)) return null
  if (entry.material === 'plastic_bodywork') return '3.9'
  if (entry.material === 'steel' && entry.operation === 'paintless_repair') return '3.10'
  return null
}

function fitsBody(vehicleType: string, body: ValueLossBodyType, label: string): boolean {
  if (vehicleType === 'MİNİBÜS' && body !== 'coach_minibus' && (/^YAN KAPAK/.test(label) || label.includes('OTOBÜS'))) return false
  if (vehicleType === 'OTOBÜS' && body === 'city_bus' && /^YAN KAPAK/.test(label)) return false
  if (body === 'cabriolet' && /TAVAN SACI|ARKA ÇAMURLUK/.test(label)) return false
  if (['KAMYON', 'ÇEKİCİ', 'TANKER'].includes(vehicleType) && /BAGAJ KAPAĞI|ARKA KAPI/.test(label)) return false
  if (['coupe', 'pickup'].includes(body) && /ARKA KAPI/.test(label)) return false
  if (body === 'open_tractor' && /KABİN|TAVAN/.test(label)) return false
  if (body === 'tanker_trailer') return false
  if (body === 'flatbed_trailer' && /TAVAN|YAN PANEL|KAPAK|ÖN DUVAR/.test(label)) return false
  return true
}

/** These are editable category suggestions, not a manufacturer or VIN parts catalogue. */
export function buildValueLossPartSuggestions(vehicleType: string, body: ValueLossBodyType, sourceParts: readonly ValueLossSourcePart[]): ValueLossPartSuggestion[] {
  const categories = new Map<string, ValueLossSourcePart[]>()
  for (const part of valueLossCalculatorSourceParts(vehicleType, body, sourceParts)) {
    const label = categoryLabel(part.label)
    if (!fitsBody(vehicleType, body, label)) continue
    categories.set(label, [...(categories.get(label) ?? []), part])
  }
  const suggestions: ValueLossPartSuggestion[] = [...categories].map(([label, rows]) => ({
    id: rows.length === 1 ? rows[0]!.stableRuleId : `category:${label}`,
    label, stableRuleId: rows.length === 1 ? rows[0]!.stableRuleId : null,
    supportedOperations: rows.length === 1 ? rows[0]!.supportedOperations : ['replacement', 'repair', 'paint'],
  }))
  const motorcycle = vehicleType === 'MOTORSİKLET'
  const trailer = vehicleType === 'RÖMORK' || body === 'tanker_trailer'
  const machinery = ['İŞ MAKİNESİ', 'TRAKTÖR', 'TARIM MAKİNESİ'].includes(vehicleType)
  const extras = motorcycle
    ? ['ÖN ÇAMURLUK', 'ARKA ÇAMURLUK', 'ÖN MAŞA / AMORTİSÖR', 'ARKA SALINCAK', 'ÖN JANT', 'ARKA JANT', 'MOTOR BLOĞU', 'EGZOZ', 'SELE', 'ÖN FAR', 'ARKA STOP', 'SAĞ AYNA', 'SOL AYNA', 'SAĞ SİNYAL', 'SOL SİNYAL', 'FREN MANETİ', 'DEBRİYAJ MANETİ', 'RADYATÖR']
    : trailer ? ['AKS / DİNGİL', 'JANT', 'BAĞLANTI / ÇEKİ OKU', 'TABAN', 'ARKA STOP']
    : machinery ? ['HİDROLİK SİLİNDİR', 'HİDROLİK POMPA', 'MOTOR BLOĞU', 'RADYATÖR', 'AKS / DİNGİL', 'JANT', 'KABİN CAMI', 'AYDINLATMA']
    : ['ÖN TAMPON', 'ARKA TAMPON', 'SAĞ ÖN FAR', 'SOL ÖN FAR', 'SAĞ ARKA STOP', 'SOL ARKA STOP', 'SAĞ AYNA', 'SOL AYNA', 'ÖN CAM', 'ARKA CAM', 'JANT', 'MOTOR BLOĞU', 'RADYATÖR', 'SÜSPANSİYON']
  if (motorcycle && ['scooter', 'sport', 'touring', 'unspecified', 'other'].includes(body)) extras.push('ÖN GRENAJ', 'SAĞ YAN GRENAJ', 'SOL YAN GRENAJ', 'ARKA GRENAJ', 'ÖN SİPERLİK')
  if (motorcycle && body === 'scooter') extras.push('AYAK BASMA TABANI', 'SELE ALTI GÖVDE KAPAĞI')
  if (vehicleType === 'MİNİBÜS' && body !== 'coach_minibus' || ['panel_van', 'passenger_van'].includes(body)) extras.push('SAĞ SÜRGÜLÜ KAPI', 'SOL SÜRGÜLÜ KAPI', 'ARKA SAĞ YÜK KAPISI', 'ARKA SOL YÜK KAPISI')
  if (['pickup', 'double_cab_pickup', 'truck'].includes(body)) extras.push('KASA TABANI', 'KASA SAĞ YAN PANELİ', 'KASA SOL YAN PANELİ', 'KASA ARKA KAPAĞI')
  if (['tanker_truck', 'tanker_trailer'].includes(body) || vehicleType === 'TANKER') extras.push('TANK GÖVDESİ', 'TANK BÖLMESİ', 'DOLUM KAPAĞI', 'BOŞALTMA VANASI')
  if (body === 'excavator' || body === 'backhoe_loader') extras.push('BOM', 'KAZICI KOL', 'KEPÇE', 'PALET TAKIMI')
  if (body === 'loader') extras.push('YÜKLEYİCİ KOL', 'KEPÇE')
  if (body === 'combine') extras.push('BİÇME TABLASI', 'HELEZON', 'TANE DEPOSU')
  for (const label of extras) {
    if (body === 'open_tractor' && /KABİN|TAVAN/.test(label)) continue
    if (!suggestions.some(item => item.label === label)) suggestions.push({ id: `custom:${label}`, label, stableRuleId: null, supportedOperations: ['replacement', 'repair', 'paint'] })
  }
  return suggestions
}

export type ValueLossPartCoverageReason = 'reference_match' | 'documented_base_only' | 'manufacturer_unverified' | 'manufacturer_documented' | 'coefficient_unverified' | 'part_mismatch'
export const VALUE_LOSS_PART_COVERAGE_LABELS: Record<ValueLossPartCoverageReason, string> = {
  reference_match: 'İşlem katsayısı kaynak tabloda doğrulandı. Üretici / VIN uygunluğu doğrulanmış değildir.',
  documented_base_only: 'Kaynak rehberde ek katsayı uygulanmayan işlem. Üretici / VIN uygunluğu doğrulanmış değildir.',
  manufacturer_unverified: 'Bu üretici, model ve yıl için parça uygunluğu doğrulanamadı. Referans tahmini araç grubunun genel katsayılarına dayanır; modele özel değerleme değildir.',
  manufacturer_documented: 'Parça kategorisi üretici belgesinde eşleşti; VIN uygunluğu doğrulanmadı. Referans tahmini araç grubunun genel katsayılarına dayanır; modele özel değerleme değildir.',
  coefficient_unverified: 'Seçilen işlem için sayısal katsayı bulunamadı. Bu parçayla referans tahmini hesaplanamaz.',
  part_mismatch: 'Parça, konum, adet, malzeme veya işlem referans tabloyla eşleşmedi. Bu seçimle referans tahmini hesaplanamaz.',
}

export interface ValueLossPartCoverage {
  readonly entryId: string
  readonly reason: ValueLossPartCoverageReason
  readonly manufacturerSource: ReturnType<typeof findValueLossManufacturerPart>
}

function hasVerifiedCoefficients(source: ValueLossSourcePart, entry: ValueLossCalculatorPartSelection): boolean {
  const decimal = (value: unknown) => typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value))
  const coefficients = source.coefficients
  if (!coefficients) return false
  if (['replacement', 'replacement_paint'].includes(entry.operation) && !decimal(coefficients.replacement)) return false
  if (['repair', 'repair_paint'].includes(entry.operation) && !(['light', 'medium', 'heavy'] as const).every(key => decimal(coefficients.repair?.[key]))) return false
  if (['paint', 'repair_paint', 'replacement_paint'].includes(entry.operation) && (entry.paintMode === null || !decimal(coefficients.paint?.[entry.paintMode]))) return false
  return true
}

export function resolveValueLossCalculatorParts(vehicleType: string, body: ValueLossBodyType, sourceParts: readonly ValueLossSourcePart[], selections: readonly ValueLossCalculatorPartSelection[], vehicle?: { readonly identity: ValueLossVehicleIdentity; readonly modelYear: number | null }) {
  const suggestions = buildValueLossPartSuggestions(vehicleType, body, sourceParts)
  const issues: { field: string; message: string }[] = []
  const referenceParts: RealMarketValueLossPartInput[] = []
  const baseOnlyParts: { entryId: string; principle: '3.9' | '3.10' }[] = []
  const coverage: ValueLossPartCoverage[] = []
  const sources = valueLossCalculatorSourceParts(vehicleType, body, sourceParts)
  const seenPhysical = new Set<string>(), seenRules = new Set<string>()
  let requiresMarketDifference = false
  for (const entry of selections) {
    const physical = `${normalized(entry.partName)}:${normalized(entry.position)}`
    if (seenPhysical.has(physical)) issues.push({ field: 'partSelections', message: 'Aynı parça ve konum bir kez girilmelidir. Birden çok eş parça için adet veya farklı konum belirtin.' })
    seenPhysical.add(physical)
    const source = sources.find(part => part.stableRuleId === entry.stableRuleId)
    if (entry.stableRuleId !== null && !source) issues.push({ field: 'partSelections', message: 'Parça referansı seçilen araç grubuna ait değildir.' })
    // Manufacturer documentation describes fitment, independently of the generic reference arithmetic.
    const manufacturerSource = vehicle === undefined ? null : findValueLossManufacturerPart(vehicle.identity, vehicle.modelYear, vehicleType, body, entry.partName)
    const referenceReason = vehicle === undefined ? 'reference_match' : manufacturerSource ? 'manufacturer_documented' : 'manufacturer_unverified'
    const principle = valueLossBaseOnlyPrinciple(entry)
    if (principle !== null) { baseOnlyParts.push({ entryId: entry.entryId, principle }); coverage.push({ entryId: entry.entryId, reason: 'documented_base_only', manufacturerSource }); continue }
    const operation = entry.operation === 'replacement_paint' ? 'replacement' : entry.operation === 'repair_paint' || entry.operation === 'paintless_repair' ? 'repair' : entry.operation
    const hasPaint = entry.operation === 'replacement_paint' || entry.operation === 'repair_paint'
    const repeated = entry.stableRuleId !== null && seenRules.has(entry.stableRuleId)
    if (entry.stableRuleId !== null) seenRules.add(entry.stableRuleId)
    if (!source || !suggestions.some(item => item.stableRuleId === entry.stableRuleId && item.label === normalized(entry.partName))
      || entry.quantity !== 1 || repeated || !['unspecified', 'steel'].includes(entry.material) || entry.treatment !== 'standard' || entry.operation === 'paintless_repair'
      || !source.supportedOperations.includes(operation) || hasPaint && !source.supportedOperations.includes('paint')) {
      requiresMarketDifference = true
      coverage.push({ entryId: entry.entryId, reason: 'part_mismatch', manufacturerSource: null })
      continue
    }
    if (!hasVerifiedCoefficients(source, entry)) {
      requiresMarketDifference = true
      coverage.push({ entryId: entry.entryId, reason: 'coefficient_unverified', manufacturerSource: null })
      continue
    }
    coverage.push({ entryId: entry.entryId, reason: referenceReason, manufacturerSource })
    const row: RealMarketValueLossPartInput = { stableRuleId: source.stableRuleId, operation, paintMode: operation === 'paint' ? entry.paintMode : null, newPartPriceMinor: entry.newPartPriceMinor, repairLaborMinor: entry.repairLaborMinor, partPriceAvailability: entry.partPriceAvailability, priorPartState: entry.priorPartState, treatment: entry.treatment }
    referenceParts.push(row)
    if (hasPaint) referenceParts.push({ ...row, operation: 'paint', paintMode: entry.paintMode })
  }
  if (referenceParts.length > 100) requiresMarketDifference = true
  return { requiresMarketDifference, referenceParts: requiresMarketDifference || issues.length ? [] : referenceParts, baseOnlyParts, coverage, issues }
}
