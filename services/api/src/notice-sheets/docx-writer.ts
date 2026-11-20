import { strToU8, zipSync } from 'fflate'
import { applyNoticeSheetOverrides, isNoticeSheetFieldVisible, type NoticeSheetField, type NoticeSheetOverrides } from '@hasarbotu/domain'
import type { NoticeSheetResponse } from '@hasarbotu/contracts'

type Field = readonly [NoticeSheetField, string, boolean?]
const CASE_FIELDS: readonly Field[] = [
  ['officeNumber', 'Ofis dosya no'], ['plate', 'Dosya plakası'],
  ['claimNumber', 'Hasar dosya no'], ['noticeNumber', 'İhbar föy no'],
  ['notificationDate', 'İhbar tarihi', true], ['inspectionDate', 'Ekspertiz tarihi', true],
  ['lossDate', 'Hasar tarihi', true], ['reportNumber', 'Eksper rapor no'],
  ['insuredPolicyPeriod', 'Sigortalı poliçe vadesi'], ['victimPolicyPeriod', 'Mağdur poliçe vadesi'],
  ['recourse', 'Rücu durumu'], ['deductible', 'Muafiyet'],
  ['insuredFault', 'Sigortalı kusur durumu'], ['victimFault', 'Mağdur kusur durumu'],
]
const INSURED_FIELDS: readonly Field[] = [
  ['insuredName', 'Sigortalı adı ve unvanı'], ['insuredPlate', 'Plaka'],
  ['insuredRegistrationDate', 'Tescil tarihi', true], ['insuredMileage', 'Kilometre'],
  ['insuredHeavyDamage', 'Ağır hasar kaydı'], ['insuredPreviousClaims', 'Geçmiş hasar sayısı'],
]
const VICTIM_FIELDS: readonly Field[] = [
  ['victimName', 'Mağdur adı ve unvanı'], ['victimPlate', 'Plaka'],
  ['victimRegistrationDate', 'Tescil tarihi', true], ['victimMileage', 'Kilometre'],
  ['victimHeavyDamage', 'Ağır hasar kaydı'], ['victimPreviousClaims', 'Geçmiş hasar sayısı'],
]
const SERVICE_FIELDS: readonly Field[] = [
  ['serviceName', 'Servis adı'], ['servicePhone', 'Telefon'],
  ['serviceContact', 'Yetkili ad soyad'], ['vehicleDescription', 'Araç marka ve model'],
  ['serviceAddress', 'Adres'],
]
const TRACKING_FIELDS: readonly Field[] = [
  ['procurement', 'Tedarik'], ['preliminaryReportDate', 'Ön rapor tarihi', true],
  ['tramer', 'Tramer'], ['closureDate', 'Kapatma tarihi', true],
]

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const WORD_NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const REL_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/relationships'
const DOCUMENT_REL_NAMESPACE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const TABLE_WIDTH = 10466
const LABEL_WIDTH = 1640
const VALUE_WIDTH = TABLE_WIDTH / 2 - LABEL_WIDTH

function escapeXml(value: string): string {
  // XML 1.0 rejects controls and lone UTF-16 surrogates. They are not document markup.
  let text = ''
  for (const character of value) {
    const code = character.codePointAt(0)!
    if (code === 9 || code === 10 || code === 13 || code >= 0x20 && code <= 0xd7ff
      || code >= 0xe000 && code <= 0xfffd || code >= 0x10000 && code <= 0x10ffff) text += character
  }
  return text
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

function runs(value: string, bold = false): string {
  const content = value.replace(/\r\n?/g, '\n').split(/([\n\t])/).map(part => part === '\n'
    ? '<w:br/>' : part === '\t' ? '<w:tab/>' : `<w:t xml:space="preserve">${escapeXml(part)}</w:t>`).join('')
  return `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}${content}</w:r>`
}

function paragraph(value: string, style?: string): string {
  return `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${runs(value || '\u00a0')}</w:p>`
}

function cell(value: string, width: number, bold: boolean, span = 1): string {
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}<w:vAlign w:val="center"/></w:tcPr>`
    + `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>${runs(value || '\u00a0', bold)}</w:p></w:tc>`
}

const STYLES = XML + `<w:styles xmlns:w="${WORD_NAMESPACE}">`
  + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:color w:val="000000"/><w:sz w:val="20"/><w:lang w:val="tr-TR"/></w:rPr></w:rPrDefault>'
  + '<w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
  + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:after="100"/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="30"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="140" w:after="60"/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="22"/></w:rPr></w:style>'
  + '</w:styles>'

/** Builds a native, editable OOXML document from the latest saved effective sheet. */
export function buildNoticeSheetDocx(sheet: NoticeSheetResponse): Uint8Array {
  if (sheet.caseType === null) throw new Error('unclassified_notice_sheet')
  const caseType = sheet.caseType
  const overrides: NoticeSheetOverrides = { fields: {}, documents: {} }
  for (const field of Object.keys(sheet.overrides.fields) as NoticeSheetField[]) {
    const text = sheet.overrides.fields[field]
    if (text !== undefined) overrides.fields[field] = text
  }
  const { fields } = applyNoticeSheetOverrides(sheet.defaults, overrides)
  const value = (field: NoticeSheetField) => isNoticeSheetFieldVisible(caseType, field) ? fields[field] : ''
  const table = (definitions: readonly Field[]) => {
    const visible = definitions.filter(([field]) => isNoticeSheetFieldVisible(caseType, field))
    if (visible.length === 0) return ''
    const rows: string[] = []
    for (let offset = 0; offset < visible.length; offset += 2) {
      const cells = visible.slice(offset, offset + 2).map(([field, label, date], index, pair) => {
        const text = value(field)
        const formatted = date && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text.split('-').reverse().join('.') : text
        const single = pair.length === 1 && index === 0
        return cell(label, LABEL_WIDTH, true) + cell(formatted, single ? TABLE_WIDTH - LABEL_WIDTH : VALUE_WIDTH, false, single ? 3 : 1)
      }).join('')
      rows.push(`<w:tr><w:trPr><w:cantSplit/></w:trPr>${cells}</w:tr>`)
    }
    const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map(side => `<w:${side} w:val="single" w:sz="4" w:color="D9D9D9"/>`).join('')
    return `<w:tbl><w:tblPr><w:tblW w:w="${TABLE_WIDTH}" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/>`
      + '<w:tblCellMar><w:top w:w="65" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="65" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr>'
      + `<w:tblGrid><w:gridCol w:w="${LABEL_WIDTH}"/><w:gridCol w:w="${VALUE_WIDTH}"/><w:gridCol w:w="${LABEL_WIDTH}"/><w:gridCol w:w="${VALUE_WIDTH}"/></w:tblGrid>${rows.join('')}</w:tbl>`
  }
  const section = (title: string, definitions: readonly Field[]) => {
    const body = table(definitions)
    return body ? paragraph(title, 'Heading1') + body : ''
  }
  const traffic = caseType === 'traffic'
  const document = XML + `<w:document xmlns:w="${WORD_NAMESPACE}"><w:body>`
    + paragraph(value('organizationName'))
    + paragraph(`İhbar Föyü ${traffic ? 'TRAFİK' : 'KASKO'}`, 'Title')
    + paragraph(value('insurerName') || 'Sigorta şirketi belirtilmedi')
    + table(CASE_FIELDS)
    + section('Sigortalı araç', INSURED_FIELDS)
    + section('Mağdur araç', VICTIM_FIELDS)
    + paragraph(traffic ? 'Mağdur aracın geçmiş hasarları' : 'Sigortalı aracın geçmiş hasarları', 'Heading1')
    + paragraph(value(traffic ? 'victimDamageHistory' : 'insuredDamageHistory'))
    + section('Servis bilgileri', SERVICE_FIELDS)
    + section('Takip bilgileri', TRACKING_FIELDS)
    + paragraph(`Eksper: ${value('expertName') || '____________________'}`)
    + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>'
    + '</w:body></w:document>'
  return zipSync({
    '[Content_Types].xml': strToU8(XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'),
    '_rels/.rels': strToU8(XML + `<Relationships xmlns="${REL_NAMESPACE}"><Relationship Id="rId1" Type="${DOCUMENT_REL_NAMESPACE}/officeDocument" Target="word/document.xml"/></Relationships>`),
    'word/document.xml': strToU8(document),
    'word/styles.xml': strToU8(STYLES),
    'word/_rels/document.xml.rels': strToU8(XML + `<Relationships xmlns="${REL_NAMESPACE}"><Relationship Id="rId1" Type="${DOCUMENT_REL_NAMESPACE}/styles" Target="styles.xml"/></Relationships>`),
  }, { level: 6 })
}
