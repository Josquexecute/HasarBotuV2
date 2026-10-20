import type { NoticeSheetDocument, NoticeSheetField } from '@hasarbotu/contracts'

interface FieldDefinition { key: NoticeSheetField; label: string; multiline?: boolean; date?: boolean }
export const noticeSheetFieldGroups: readonly { title: string; fields: readonly FieldDefinition[] }[] = [
  { title: 'Dosya ve poliçe', fields: [
    { key: 'organizationName', label: 'Ofis adı' },
    { key: 'officeNumber', label: 'Ofis dosya no' },
    { key: 'claimNumber', label: 'Hasar dosya no' },
    { key: 'noticeNumber', label: 'İhbar föy no' },
    { key: 'insurerName', label: 'Sigorta şirketi' },
    { key: 'plate', label: 'Dosya plakası' },
    { key: 'notificationDate', label: 'İhbar tarihi', date: true },
    { key: 'lossDate', label: 'Hasar tarihi', date: true },
    { key: 'closureDate', label: 'Kapatma tarihi', date: true },
    { key: 'expertName', label: 'Eksper adı' },
    { key: 'inspectionDate', label: 'Ekspertiz tarihi', date: true },
    { key: 'reportNumber', label: 'Eksper rapor no' },
    { key: 'insuredPolicyPeriod', label: 'Sigortalı poliçe vadesi' },
    { key: 'victimPolicyPeriod', label: 'Mağdur poliçe vadesi' },
    { key: 'recourse', label: 'Rücu durumu' },
    { key: 'deductible', label: 'Muafiyet' },
    { key: 'insuredFault', label: 'Sigortalı kusur durumu' },
    { key: 'victimFault', label: 'Mağdur kusur durumu' },
  ] },
  { title: 'Sigortalı araç', fields: [
    { key: 'insuredName', label: 'Sigortalı adı / unvanı' },
    { key: 'insuredPlate', label: 'Sigortalı plaka' },
    { key: 'insuredMileage', label: 'Sigortalı kilometre' },
    { key: 'insuredHeavyDamage', label: 'Sigortalı ağır hasar kaydı' },
    { key: 'insuredPreviousClaims', label: 'Sigortalı geçmiş hasar sayısı' },
  ] },
  { title: 'Mağdur / karşı araç', fields: [
    { key: 'victimName', label: 'Mağdur adı / unvanı' },
    { key: 'victimPlate', label: 'Mağdur plaka' },
    { key: 'victimMileage', label: 'Mağdur kilometre' },
    { key: 'victimHeavyDamage', label: 'Mağdur ağır hasar kaydı' },
    { key: 'victimPreviousClaims', label: 'Mağdur geçmiş hasar sayısı' },
  ] },
  { title: 'Servis ve araç', fields: [
    { key: 'serviceName', label: 'Servis adı' },
    { key: 'serviceContact', label: 'Servis yetkilisi' },
    { key: 'servicePhone', label: 'Servis telefonu' },
    { key: 'serviceAddress', label: 'Servis adresi', multiline: true },
    { key: 'vehicleDescription', label: 'Araç marka ve model' },
  ] },
  { title: 'Takip ve çalışma notları', fields: [
    { key: 'procurement', label: 'Tedarik' },
    { key: 'preliminaryReportDate', label: 'Ön rapor tarihi', date: true },
    { key: 'tramer', label: 'Tramer' },
    { key: 'iban', label: 'IBAN' },
    { key: 'missingDocuments', label: 'Eksikler', multiline: true },
    { key: 'inspectionNotes', label: 'Ekspertiz çalışması', multiline: true },
  ] },
]

export const noticeSheetDocumentLabels: readonly [NoticeSheetDocument, string][] = [
  ['statement', 'Beyan'], ['officialReport', 'Zabıt'],
  ['accidentReport', 'Tutanak (anlaşmalı, ifade, görgü)'], ['alcoholReport', 'Alkol raporu'],
  ['damagePhotos', 'Hasar fotoğrafları (KM, şase)'], ['scenePhotos', 'Olay yeri fotoğrafları'],
  ['insuredLicense', 'S. ehliyet'], ['insuredRegistration', 'S. ruhsat'],
  ['victimLicense', 'M. ehliyet'], ['victimRegistration', 'M. ruhsat'],
  ['tramerEntry', 'Tramer girişi'], ['partsList', 'Liste'],
]

export function formatNoticeSheetDate(value: string | null): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('.') : value ?? ''
}
