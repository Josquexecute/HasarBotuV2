import { eksistKey, parseEksist } from './eksist.js'

export const NOTICE_SHEET_FIELD_LIMITS = {
  inspectionDate: 10,
  reportNumber: 120,
  insuredPolicyPeriod: 160,
  victimPolicyPeriod: 160,
  recourse: 200,
  deductible: 240,
  insuredFault: 120,
  victimFault: 120,
  insuredName: 300,
  insuredPlate: 30,
  insuredMileage: 40,
  insuredHeavyDamage: 120,
  insuredPreviousClaims: 40,
  victimName: 300,
  victimPlate: 30,
  victimMileage: 40,
  victimHeavyDamage: 120,
  victimPreviousClaims: 40,
  vehicleDescription: 300,
  serviceName: 500,
  serviceContact: 200,
  servicePhone: 80,
  serviceAddress: 500,
  procurement: 200,
  preliminaryReportDate: 10,
  tramer: 200,
  iban: 80,
  missingDocuments: 700,
  inspectionNotes: 2000,
} as const

export const NOTICE_SHEET_DOCUMENT_CODES = [
  'statement', 'officialReport', 'accidentReport', 'alcoholReport',
  'damagePhotos', 'scenePhotos', 'insuredLicense', 'insuredRegistration',
  'victimLicense', 'victimRegistration', 'tramerEntry', 'partsList',
] as const

export type NoticeSheetField = keyof typeof NOTICE_SHEET_FIELD_LIMITS
export type NoticeSheetFields = Record<NoticeSheetField, string>
export type NoticeSheetDocument = typeof NOTICE_SHEET_DOCUMENT_CODES[number]
export type NoticeSheetDocuments = Record<NoticeSheetDocument, boolean>
export interface NoticeSheetOverrides {
  readonly fields: Partial<NoticeSheetFields>
  readonly documents: Partial<NoticeSheetDocuments>
}

export interface NoticeSheetSource {
  readonly caseType: 'traffic' | 'casco' | null
  readonly plate: string
  readonly serviceName: string | null
  readonly servicePhone: string | null
  readonly eksistText: string | null
  readonly eksistServiceRevised: boolean
  readonly vehicleDescription: string | null
  readonly ownerNames: readonly string[]
  readonly approvedPolicyPeriods: readonly string[]
  readonly readyDocumentTypes: readonly string[]
}

/** Only established source facts are copied. Unknown decisions stay blank. */
export function buildNoticeSheetDefaults(source: NoticeSheetSource): {
  fields: NoticeSheetFields
  documents: NoticeSheetDocuments
} {
  const fields = Object.fromEntries(Object.keys(NOTICE_SHEET_FIELD_LIMITS).map(key => [key, ''])) as NoticeSheetFields
  const documents = Object.fromEntries(NOTICE_SHEET_DOCUMENT_CODES.map(code => [code, false])) as NoticeSheetDocuments
  const extracted = source.eksistText ? parseEksist(source.eksistText) : null
  const get = (label: string) => {
    const key = eksistKey(label)
    return extracted?.conflicts.includes(key) ? '' : extracted?.fields[key] ?? ''
  }
  fields.reportNumber = get('SBM Eksper Rapor No')
  fields.insuredName = [get('Sigortalı Ad/Ünvan'), get('Sigortalı Soyad')].filter(Boolean).join(' ')
  fields.insuredPolicyPeriod = get('Poliçe Vadesi')
  fields.vehicleDescription = source.vehicleDescription
    ?? [get('Marka'), get('Araç Tipi'), get('Model Yılı')].filter(Boolean).join(' · ')
  fields.serviceName = source.serviceName ?? extracted?.service ?? ''
  // Contact details from a replaced service must not follow the old name.
  const sameService = !source.eksistServiceRevised && extracted?.service
    && eksistKey(fields.serviceName) === eksistKey(extracted.service)
  fields.servicePhone = source.servicePhone ?? (sameService ? get('Telefon') : '')
  if (sameService) fields.serviceAddress = get('Açık Adres')
  if (source.caseType === 'casco') {
    fields.insuredPlate = source.plate
    fields.insuredName = source.ownerNames.join(' / ') || fields.insuredName
    const periods = [...new Set(source.approvedPolicyPeriods.filter(Boolean))]
    if (periods.length === 1) fields.insuredPolicyPeriod = periods[0]!
    // Conflicting approved policies need a deliberate choice on the sheet.
    if (periods.length > 1) fields.insuredPolicyPeriod = ''
  } else if (source.caseType === 'traffic') {
    fields.victimPlate = source.plate
    fields.victimName = source.ownerNames.join(' / ')
  }
  const ready = new Set(source.readyDocumentTypes)
  const has = (...types: string[]) => types.some(type => ready.has(type))
  documents.statement = has('statement')
  documents.officialReport = has('accident_report')
  documents.accidentReport = has('ktt')
  documents.alcoholReport = has('alcohol_report')
  // Unclassified photos do not establish the presence of KM, VIN or scene photos.
  documents.damagePhotos = has('damage_photos')
  documents.scenePhotos = has('scene_photos')
  documents.insuredLicense = source.caseType === 'casco' ? has('casco_driver_license') : has('insured_driver_license')
  documents.insuredRegistration = source.caseType === 'casco' ? has('casco_vehicle_registration') : has('insured_registration')
  documents.victimLicense = source.caseType === 'casco' ? has('opposing_driver_license') : has('victim_driver_license')
  documents.victimRegistration = source.caseType === 'casco' ? has('opposing_vehicle_registration') : has('victim_registration')
  documents.tramerEntry = has('tramer_result')
  documents.partsList = has('parts_list')
  return { fields, documents }
}

export function applyNoticeSheetOverrides(
  defaults: ReturnType<typeof buildNoticeSheetDefaults>,
  overrides: NoticeSheetOverrides,
  caseType: NoticeSheetSource['caseType'],
) {
  const fields = { ...defaults.fields, ...overrides.fields }
  // A sheet can supplement a claim, but cannot relabel its primary vehicle.
  if (caseType === 'casco') fields.insuredPlate = defaults.fields.insuredPlate
  if (caseType === 'traffic') fields.victimPlate = defaults.fields.victimPlate
  return { fields, documents: { ...defaults.documents, ...overrides.documents } }
}
