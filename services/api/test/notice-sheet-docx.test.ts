import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { buildNoticeSheetDefaults, type NoticeSheetFields } from '@hasarbotu/domain'
import type { NoticeSheetResponse } from '@hasarbotu/contracts'
import { buildNoticeSheetDocx } from '../src/notice-sheets/docx-writer.js'

function sheet(caseType: 'traffic' | 'casco' | null): NoticeSheetResponse {
  const defaults = buildNoticeSheetDefaults({
    caseType, plate: '34 TEST 123', serviceName: null, servicePhone: null,
    eksistText: null, eksistServiceRevised: false, vehicleDescription: null,
    ownerNames: [], approvedPolicyPeriods: [], readyDocumentTypes: [],
  })
  return {
    caseId: '019aa78c-7f00-7000-8000-000000000001', caseType, organizationName: 'Örnek Ofis', officeNumber: '2026/7001',
    claimNumber: null, noticeNumber: null, insurerName: null, plate: '34 TEST 123', notificationDate: null,
    lossDate: null, closureDate: null, expertName: null, version: 1, updatedAt: null,
    defaults, overrides: { fields: {}, documents: {} }, permissions: { canEdit: true },
  }
}

describe('Native notice sheet Word export', () => {
  it.each(['traffic', 'casco'] as const)('writes an editable A4 %s document and excludes retired content from every package part', caseType => {
    const input = sheet(caseType)
    const fields: Partial<NoticeSheetFields> = {
      organizationName: 'Örnek Ekspertiz', officeNumber: '2026/7001', plate: '06 WORD 99', insurerName: 'Örnek Sigorta',
      insuredName: 'Sigortalı Örnek', insuredPlate: '34 INS 01', insuredRegistrationDate: '2020-02-29',
      insuredMileage: 'INSURED_KM', insuredHeavyDamage: 'INSURED_HEAVY', insuredPreviousClaims: 'INSURED_CLAIMS', insuredDamageHistory: 'INSURED_HISTORY',
      victimName: 'VICTIM_NAME', victimPlate: 'VICTIM_PLATE', victimRegistrationDate: '2021-10-17',
      victimMileage: 'VICTIM_KM', victimHeavyDamage: 'VICTIM_HEAVY', victimPreviousClaims: 'VICTIM_CLAIMS', victimDamageHistory: 'VICTIM_HISTORY',
      iban: 'RETIRED_IBAN', missingDocuments: 'RETIRED_MISSING', inspectionNotes: 'RETIRED_NOTES',
      servicePhone: '0212 000 00 00', serviceAddress: 'Örnek servis adresi',
    }
    input.overrides = { fields, documents: { statement: true, victimRegistration: true } }
    const bytes = buildNoticeSheetDocx(input)
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04])
    const entries = unzipSync(bytes)
    expect(Object.keys(entries).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/styles.xml'])
    const allXml = Object.values(entries).map(part => strFromU8(part)).join('\n')
    expect(allXml).not.toMatch(/RETIRED_|IBAN|Evrak kontrolü|Eksikler|Beyan|<w:altChunk|<w:object|TargetMode="External"|<w:fldChar/)
    const document = strFromU8(entries['word/document.xml']!)
    expect(document).toContain('<w:pgSz w:w="11906" w:h="16838"/>')
    expect(document).toContain('İhbar Föyü')
    expect(document).toContain('Örnek Ekspertiz')
    expect(document).toContain('06 WORD 99')
    expect(document).toContain('29.02.2020')
    expect(document).toContain('Sigortalı Örnek')
    expect(document).toContain('Örnek servis adresi')
    expect(document).not.toContain('w:tblLayout w:type="autofit"')
    expect(document).not.toContain('w:hRule="exact"')
    if (caseType === 'traffic') {
      expect(document).toContain('TRAFİK')
      expect(document).toContain('Mağdur araç')
      expect(document).toContain('17.10.2021')
      expect(document).toContain('VICTIM_KM')
      expect(document).toContain('VICTIM_HISTORY')
      expect(document).not.toMatch(/INSURED_KM|INSURED_HEAVY|INSURED_CLAIMS|INSURED_HISTORY/)
    } else {
      expect(document).toContain('KASKO')
      expect(document).toContain('INSURED_KM')
      expect(document).toContain('INSURED_HEAVY')
      expect(document).toContain('INSURED_CLAIMS')
      expect(document).toContain('INSURED_HISTORY')
      expect(document).not.toMatch(/VICTIM_|Mağdur araç|Mağdur poliçe/)
    }
    expect(input.overrides.fields.iban).toBe('RETIRED_IBAN')
  })
  it('escapes XML and preserves multiline Turkish text without executable Word fields or invalid XML controls', () => {
    const input = sheet('casco')
    input.overrides.fields = { insuredName: 'İşleyen & <w:fldChar w:fldCharType="begin"/>', insuredDamageHistory: 'Önceki hasar\nİkinci satır\tNot\u0000\u000b\ud800\u{1f697}', serviceName: 'Yeni & güvenli servis' }
    const entries = unzipSync(buildNoticeSheetDocx(input))
    const document = strFromU8(entries['word/document.xml']!)
    expect(document).toContain('İşleyen &amp; &lt;w:fldChar w:fldCharType=&quot;begin&quot;/&gt;')
    expect(document).not.toContain('<w:fldChar')
    expect(document).toContain('<w:br/>')
    expect(document).toContain('<w:tab/>')
    for (const invalid of ['\u0000', '\u000b', '\ud800']) expect(document).not.toContain(invalid)
    expect(document).toContain('\u{1f697}')
  })
  it('rejects an unclassified sheet instead of producing a misleading casco document', () => {
    expect(() => buildNoticeSheetDocx(sheet(null))).toThrow('unclassified_notice_sheet')
  })
})
