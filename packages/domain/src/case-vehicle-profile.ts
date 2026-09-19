/**
 * Paket 56 — dosya düzeyinde araç profili (HB-2026-063).
 *
 * Sürümlü ve kullanıcı kontrollüdür; otomatik belge çıkarımı bu dilimde YOKTUR.
 * Tam şasi numarası ve plaka bu modelde TUTULMAZ: yalnız şasi PREFIX'i saklanır
 * ve dış sağlayıcıya yalnız normalize profil çıkar.
 */
export const CASE_VEHICLE_PROFILE_SCHEMA_VERSION = 'case-vehicle-profile/1.0.0' as const

export const VEHICLE_EVIDENCE_SOURCES = [
  'registration_document',
  'policy_document',
  'insurer_record',
  'user_statement',
  'other',
] as const
export type VehicleEvidenceSource = (typeof VEHICLE_EVIDENCE_SOURCES)[number]

/**
 * Araç sınıfı. Bu liste uydurma geniş bir taksonomi değildir: dosya türleriyle
 * uyumlu, ofis operasyonunda ayrım yaratan asgari kümedir. Karşılığı yoksa
 * `other` kullanılır ve bu tek başına kanıtı eksik saymaz.
 */
export const VEHICLE_CLASSES = [
  'passenger_car',
  'light_commercial',
  'heavy_commercial',
  'motorcycle',
  'trailer',
  'other',
] as const
export type VehicleClass = (typeof VEHICLE_CLASSES)[number]

export const MAX_VEHICLE_REVISION_REASON_LENGTH = 500
export const MAX_VEHICLE_TEXT_LENGTH = 60
export const MAX_VEHICLE_EVIDENCE_REFERENCE_LENGTH = 120
/** Şasi PREFIX'i: WMI+VDS aralığı. 17 haneli tam VIN kabul edilmez. */
export const MAX_VEHICLE_CHASSIS_PREFIX_LENGTH = 11
export const MIN_VEHICLE_MODEL_YEAR = 1950
export const MAX_VEHICLE_MODEL_YEAR = 2100

export interface CaseVehicleProfileInput {
  readonly brand: string
  readonly model: string
  readonly modelYear: number
  readonly variant: string | null
  readonly vehicleClass: VehicleClass
  readonly chassisPrefix: string | null
  readonly engineCode: string | null
  readonly evidenceSource: VehicleEvidenceSource
  readonly evidenceReference: string | null
}

export interface NormalizedCaseVehicleProfile {
  readonly brand: string
  readonly model: string
  readonly modelYear: number
  readonly variant: string | null
  readonly vehicleClass: VehicleClass
  readonly chassisPrefix: string | null
  readonly engineCode: string | null
  readonly evidenceSource: VehicleEvidenceSource
  readonly evidenceReference: string | null
}

export type CaseVehicleProfileValidation =
  | { readonly valid: true; readonly profile: NormalizedCaseVehicleProfile }
  | {
      readonly valid: false
      readonly reasonCode:
        | 'VEHICLE_BRAND_INVALID'
        | 'VEHICLE_MODEL_INVALID'
        | 'VEHICLE_MODEL_YEAR_INVALID'
        | 'VEHICLE_VARIANT_INVALID'
        | 'VEHICLE_CLASS_INVALID'
        | 'VEHICLE_CHASSIS_PREFIX_INVALID'
        | 'VEHICLE_ENGINE_CODE_INVALID'
        | 'VEHICLE_EVIDENCE_SOURCE_INVALID'
        | 'VEHICLE_EVIDENCE_REFERENCE_INVALID'
    }

function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0)
    if (code < 32 || (code >= 127 && code <= 159)) return true
  }
  return false
}

function normalizeText(value: string, maxLength: number): string | null {
  const normalized = value.trim().replace(/\s+/gu, ' ')
  if (normalized.length === 0 || normalized.length > maxLength) return null
  if (hasControlCharacter(normalized)) return null
  return normalized
}

/** Şasi prefix'i: yalnız büyük harf/rakam, en çok 11 karakter, tam VIN değil. */
export function normalizeChassisPrefix(value: string): string | null {
  const normalized = value.trim().toUpperCase().replace(/[\s-]/gu, '')
  if (normalized.length < 3 || normalized.length > MAX_VEHICLE_CHASSIS_PREFIX_LENGTH) return null
  // I, O, Q VIN alfabesinde bulunmaz; tam VIN uzunluğu zaten reddedilir.
  if (!/^[A-HJ-NPR-Z0-9]+$/u.test(normalized)) return null
  return normalized
}

export function normalizeEngineCode(value: string): string | null {
  const normalized = value.trim().toUpperCase().replace(/\s+/gu, '')
  if (normalized.length < 2 || normalized.length > 24) return null
  if (!/^[A-Z0-9./-]+$/u.test(normalized)) return null
  return normalized
}

/**
 * Saf doğrulama. Marka, model, model yılı, sınıf ve kanıt kaynağı zorunludur;
 * varyant, şasi prefix'i ve motor kodu isteğe bağlıdır.
 */
export function validateCaseVehicleProfile(
  input: CaseVehicleProfileInput,
): CaseVehicleProfileValidation {
  const brand = normalizeText(input.brand, MAX_VEHICLE_TEXT_LENGTH)
  if (brand === null) return { valid: false, reasonCode: 'VEHICLE_BRAND_INVALID' }
  const model = normalizeText(input.model, MAX_VEHICLE_TEXT_LENGTH)
  if (model === null) return { valid: false, reasonCode: 'VEHICLE_MODEL_INVALID' }
  if (!Number.isSafeInteger(input.modelYear)
    || input.modelYear < MIN_VEHICLE_MODEL_YEAR
    || input.modelYear > MAX_VEHICLE_MODEL_YEAR) {
    return { valid: false, reasonCode: 'VEHICLE_MODEL_YEAR_INVALID' }
  }
  let variant: string | null = null
  if (input.variant !== null) {
    variant = normalizeText(input.variant, MAX_VEHICLE_TEXT_LENGTH)
    if (variant === null) return { valid: false, reasonCode: 'VEHICLE_VARIANT_INVALID' }
  }
  if (!(VEHICLE_CLASSES as readonly string[]).includes(input.vehicleClass)) {
    return { valid: false, reasonCode: 'VEHICLE_CLASS_INVALID' }
  }
  let chassisPrefix: string | null = null
  if (input.chassisPrefix !== null) {
    chassisPrefix = normalizeChassisPrefix(input.chassisPrefix)
    if (chassisPrefix === null) return { valid: false, reasonCode: 'VEHICLE_CHASSIS_PREFIX_INVALID' }
  }
  let engineCode: string | null = null
  if (input.engineCode !== null) {
    engineCode = normalizeEngineCode(input.engineCode)
    if (engineCode === null) return { valid: false, reasonCode: 'VEHICLE_ENGINE_CODE_INVALID' }
  }
  if (!(VEHICLE_EVIDENCE_SOURCES as readonly string[]).includes(input.evidenceSource)) {
    return { valid: false, reasonCode: 'VEHICLE_EVIDENCE_SOURCE_INVALID' }
  }
  let evidenceReference: string | null = null
  if (input.evidenceReference !== null) {
    evidenceReference = normalizeText(input.evidenceReference, MAX_VEHICLE_EVIDENCE_REFERENCE_LENGTH)
    if (evidenceReference === null) {
      return { valid: false, reasonCode: 'VEHICLE_EVIDENCE_REFERENCE_INVALID' }
    }
  }
  return {
    valid: true,
    profile: {
      brand, model, modelYear: input.modelYear, variant,
      vehicleClass: input.vehicleClass, chassisPrefix, engineCode,
      evidenceSource: input.evidenceSource, evidenceReference,
    },
  }
}

/**
 * AI'ya çıkacak araç bağlamı. `evidenceReference` DIŞARI ÇIKMAZ: belge/dosya
 * numarası taşıyabilir ve dış sağlayıcıya gönderilmesi gerekmez. Tam şasi ve
 * plaka bu modelde zaten bulunmaz.
 */
export interface OutboundVehicleProfile {
  readonly brand: string
  readonly model: string
  readonly modelYear: number
  readonly variant: string | null
  readonly vehicleClass: VehicleClass
  readonly chassisPrefix: string | null
  readonly engineCode: string | null
  readonly evidenceSource: VehicleEvidenceSource
}

export function toOutboundVehicleProfile(
  profile: NormalizedCaseVehicleProfile,
): OutboundVehicleProfile {
  return {
    brand: profile.brand,
    model: profile.model,
    modelYear: profile.modelYear,
    variant: profile.variant,
    vehicleClass: profile.vehicleClass,
    chassisPrefix: profile.chassisPrefix,
    engineCode: profile.engineCode,
    evidenceSource: profile.evidenceSource,
  }
}
