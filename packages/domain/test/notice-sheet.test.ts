import { describe, expect, it } from 'vitest'
import { applyNoticeSheetOverrides, buildNoticeSheetDefaults, type NoticeSheetSource } from '../src/notice-sheet.js'

const source: NoticeSheetSource = {
  caseType: 'traffic', plate: '34 TEST 123', serviceName: 'Yeni Servis', servicePhone: null,
  eksistText: 'Sigortalı Ad/Ünvan: Sigortalı\nSigortalı Soyad: Örnek\nPoliçe Vadesi: 01.01.2026 - 01.01.2027\nSBM Eksper Rapor No: R-123\nTamirhane Ad / Ünvan: Eski Servis\nTelefon: 0212 000 00 00\nAçık Adres: Eski adres',
  eksistServiceRevised: true, vehicleDescription: 'Örnek Marka · Model · 2024',
  ownerNames: ['Mağdur Örnek'], approvedPolicyPeriods: [], readyDocumentTypes: [],
}

describe('İhbar föyü kaynak eşlemesi', () => {
  it('keeps the traffic insured identity separate from the victim and primary plate', () => {
    expect(buildNoticeSheetDefaults(source).fields).toMatchObject({
      insuredName: 'Sigortalı Örnek', insuredPlate: '', victimName: 'Mağdur Örnek', victimPlate: source.plate,
      reportNumber: 'R-123', inspectionDate: '', vehicleDescription: source.vehicleDescription,
      insuredPolicyPeriod: '01.01.2026 - 01.01.2027', victimPolicyPeriod: '',
    })
  })
  it('uses the primary vehicle and current owners on a casco sheet', () => {
    expect(buildNoticeSheetDefaults({ ...source, caseType: 'casco', approvedPolicyPeriods: ['01.02.2026 – 01.02.2027'] }).fields)
      .toMatchObject({ insuredName: 'Mağdur Örnek', insuredPlate: source.plate, victimName: '', victimPlate: '', insuredPolicyPeriod: '01.02.2026 – 01.02.2027' })
  })
  it('leaves unknown decisions blank and does not equate assignment with inspection', () => {
    const result = buildNoticeSheetDefaults({ ...source, eksistText: 'Eksper Atama Tarihi: 16.10.2026' })
    expect(result.fields).toMatchObject({ recourse: '', deductible: '', insuredFault: '', victimFault: '', insuredHeavyDamage: '', victimHeavyDamage: '', victimPreviousClaims: '', inspectionDate: '' })
    expect(Object.values(result.documents).every(value => value === false)).toBe(true)
  })
  it('does not copy contact details from the previous service', () => {
    expect(buildNoticeSheetDefaults(source).fields).toMatchObject({ serviceName: 'Yeni Servis', servicePhone: '', serviceAddress: '' })
    expect(buildNoticeSheetDefaults({ ...source, serviceName: 'Eski Servis', eksistServiceRevised: false }).fields)
      .toMatchObject({ servicePhone: '0212 000 00 00', serviceAddress: 'Eski adres' })
  })
  it('does not silently pick between conflicting source facts or approved periods', () => {
    expect(buildNoticeSheetDefaults({ ...source, eksistText: 'SBM Eksper Rapor No: R1\nSBM Eksper Rapor No: R2' }).fields.reportNumber).toBe('')
    expect(buildNoticeSheetDefaults({ ...source, caseType: 'casco', approvedPolicyPeriods: ['A', 'B'] }).fields.insuredPolicyPeriod).toBe('')
  })
  it('marks only the corresponding verified document types', () => {
    const result = buildNoticeSheetDefaults({ ...source, readyDocumentTypes: ['ktt', 'victim_registration', 'casco_driver_license', 'tramer_result'] })
    expect(result.documents).toMatchObject({ accidentReport: true, victimRegistration: true, insuredLicense: false, tramerEntry: true, damagePhotos: false, scenePhotos: false })
    expect(buildNoticeSheetDefaults({ ...source, caseType: 'casco', readyDocumentTypes: ['casco_driver_license'] }).documents.insuredLicense).toBe(true)
  })
  it('applies explicit blanks and unchecked boxes while protecting the claim identity', () => {
    const defaults = buildNoticeSheetDefaults({ ...source, readyDocumentTypes: ['ktt'] })
    expect(applyNoticeSheetOverrides(defaults, { fields: { insuredName: '', victimPlate: '06 WRONG 99' }, documents: { accidentReport: false } }, 'traffic'))
      .toMatchObject({ fields: { insuredName: '', victimPlate: source.plate }, documents: { accidentReport: false } })
  })
})
