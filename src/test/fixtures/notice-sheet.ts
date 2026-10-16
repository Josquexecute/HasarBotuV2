import { noticeSheetResponseSchema } from '@hasarbotu/contracts'

export const noticeSheetFixture = noticeSheetResponseSchema.parse({
  caseId: 'notice-case-1', caseType: 'traffic', organizationName: 'Örnek Ekspertiz', officeNumber: '2026/123',
  claimNumber: 'TR-2026-123', noticeNumber: 'IH-123', insurerName: 'Örnek Sigorta', plate: '34 TEST 123',
  notificationDate: '2026-10-16', lossDate: '2026-10-15', closureDate: null, expertName: 'Örnek Eksper',
  version: null, updatedAt: null, permissions: { canEdit: true }, overrides: { fields: {}, documents: {} },
  defaults: {
    fields: {
      inspectionDate: '', reportNumber: 'R-123', insuredPolicyPeriod: '01.01.2026 – 01.01.2027', victimPolicyPeriod: '',
      recourse: '', deductible: '', insuredFault: '', victimFault: '', insuredName: 'Sigortalı Örnek', insuredPlate: '',
      insuredMileage: '', insuredHeavyDamage: '', insuredPreviousClaims: '', victimName: 'Mağdur Örnek', victimPlate: '34 TEST 123',
      victimMileage: '', victimHeavyDamage: '', victimPreviousClaims: '', vehicleDescription: 'Örnek Marka · Model · 2024',
      serviceName: 'Örnek Servis', serviceContact: '', servicePhone: '0212 000 00 00', serviceAddress: '', procurement: '',
      preliminaryReportDate: '', tramer: '', iban: '', missingDocuments: '', inspectionNotes: '',
    },
    documents: { statement: false, officialReport: false, accidentReport: true, alcoholReport: false, damagePhotos: false,
      scenePhotos: false, insuredLicense: false, insuredRegistration: false, victimLicense: false, victimRegistration: true, tramerEntry: false, partsList: false },
  },
})
