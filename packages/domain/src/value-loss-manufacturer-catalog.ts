/** Public manufacturer documentation confirms a component category, not VIN fitment. */
export interface ValueLossVehicleIdentity {
  readonly manufacturer: string
  readonly model: string
}

export interface ValueLossManufacturerPart {
  readonly manufacturer: string
  readonly model: string
  readonly firstModelYear: number
  readonly lastModelYear: number
  readonly vehicleType: string
  readonly bodyType: string
  readonly partName: string
  readonly sourceTitle: string
  readonly sourceUrl: string
  readonly checkedOn: string
}

const procedures = [
  ['MOTOR KAPUTU', 'Hood', 'GUID-485FE399-AB5A-4E92-A465-6E9A6A670B5B'],
  ['SOL ÖN ÇAMURLUK (SAC)', 'Fender Assembly - Front - LH', 'GUID-560AD448-8C36-45E7-9A51-A6F986A849D9'],
  ['SOL ÖN KAPI (KAPI SACI)', 'Door - Front - LH', 'GUID-FFC0B263-F0FC-48C7-96AE-6C0CE39FA9BD'],
  ['SOL ARKA KAPI (KAPI SACI)', 'Door - Rear - LH', 'GUID-DF610287-2E91-4316-8CA2-887841FAD5E2'],
] as const

// The Turkish labels identify workbook categories; “SAC” does not establish the OEM material.
// These manuals provide no value-loss coefficients or VIN-specific part-number verification.
export const VALUE_LOSS_MANUFACTURER_PARTS: readonly ValueLossManufacturerPart[] = procedures.map(([partName, title, guid]) => ({
  manufacturer: 'Tesla', model: 'Model 3', firstModelYear: 2017, lastModelYear: 2023,
  vehicleType: 'OTOMOBİL', bodyType: 'sedan', partName,
  sourceTitle: `Tesla 2017–2023 Model 3 Service Manual — ${title}`,
  sourceUrl: `https://service.tesla.com/docs/Model3/ServiceManual/en-us/${guid}.html`,
  checkedOn: '2026-10-18',
}))

const normalize = (value: string) => value.trim().replaceAll(/\s+/g, ' ').toLocaleUpperCase('tr-TR')

export function findValueLossManufacturerPart(identity: ValueLossVehicleIdentity, modelYear: number | null, vehicleType: string, bodyType: string, partName: string): ValueLossManufacturerPart | null {
  if (modelYear === null) return null
  return VALUE_LOSS_MANUFACTURER_PARTS.find(part => normalize(part.manufacturer) === normalize(identity.manufacturer)
    && normalize(part.model) === normalize(identity.model)
    && part.firstModelYear <= modelYear && modelYear <= part.lastModelYear
    && part.vehicleType === vehicleType && (bodyType === 'unspecified' || part.bodyType === bodyType)
    && normalize(part.partName) === normalize(partName)) ?? null
}
