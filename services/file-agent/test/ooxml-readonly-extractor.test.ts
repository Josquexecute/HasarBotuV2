import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  OoxmlExtractorError,
  assertWorkbookHashUnchanged,
  assertWorkbookSha256,
  extractOoxmlWorkbook,
  getOoxmlCell,
  getOoxmlSheet,
  resolveOoxmlRelationshipTarget,
  sha256WorkbookBytes,
} from '../src/ooxml-readonly-extractor.js'

const xml = (body: string): Uint8Array =>
  strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`)

function fixtureWorkbook(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': xml(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    ),
    '_rels/.rels': xml(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rootBook" '
      + 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
      + 'Target="xl/book/workbook.xml"/>'
      + '</Relationships>',
    ),
    'xl/book/workbook.xml': xml(
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
      + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<sheets>'
      + '<sheet name="İlişkili Sayfa" sheetId="1" r:id="sheetRel"/>'
      + '<sheet name="Gizli" sheetId="2" state="hidden" r:id="hiddenRel"/>'
      + '</sheets></workbook>',
    ),
    'xl/book/_rels/workbook.xml.rels': xml(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="stringsRel" '
      + 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" '
      + 'Target="../data/strings.xml"/>'
      + '<Relationship Id="sheetRel" '
      + 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
      + 'Target="../worksheets/alpha.xml"/>'
      + '<Relationship Id="hiddenRel" '
      + 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
      + 'Target="../worksheets/hidden.xml"/>'
      + '</Relationships>',
    ),
    'xl/data/strings.xml': xml(
      '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="1">'
      + '<si><r><t xml:space="preserve">Bir </t></r><r><t>İki</t></r></si>'
      + '</sst>',
    ),
    'xl/worksheets/alpha.xml': xml(
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<dimension ref="A1:C3"/>'
      + '<cols><col min="3" max="4" hidden="1"/></cols>'
      + '<sheetData>'
      + '<row r="1"><c r="A1" t="s"><v>0</v></c>'
      + '<c r="C1" t="inlineStr"><is><t>Türkçe</t></is></c></row>'
      + '<row r="2" hidden="1"><c r="A2"><v>42</v></c></row>'
      + '</sheetData>'
      + '<mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells>'
      + '<dataValidations count="1"><dataValidation type="list" allowBlank="1" sqref="C3">'
      + '<formula1>"A,B"</formula1></dataValidation></dataValidations>'
      + '</worksheet>',
    ),
    'xl/worksheets/hidden.xml': xml(
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<dimension ref="A1"/><sheetData/></worksheet>',
    ),
  })
}

describe('generic salt-okunur OOXML extractor', () => {
  it('package ve workbook relationship hedeflerini ada göre tahmin etmeden çözer', () => {
    const workbook = extractOoxmlWorkbook(fixtureWorkbook())
    expect(workbook.workbookPartName).toBe('xl/book/workbook.xml')
    expect(workbook.sharedStringsPartName).toBe('xl/data/strings.xml')
    expect(getOoxmlSheet(workbook, 'İlişkili Sayfa').partName).toBe('xl/worksheets/alpha.xml')
  })

  it('sharedStrings rich text, inline string ve merged cell değerini okur', () => {
    const sheet = getOoxmlSheet(extractOoxmlWorkbook(fixtureWorkbook()), 'İlişkili Sayfa')
    expect(getOoxmlCell(sheet, 'A1')?.value).toBe('Bir İki')
    expect(getOoxmlCell(sheet, 'B1')?.value).toBe('Bir İki')
    expect(getOoxmlCell(sheet, 'C1')?.value).toBe('Türkçe')
    expect(sheet.mergedRanges).toEqual(['A1:B1'])
  })

  it('hidden sheet, satır ve sütunları; data validation kuralını korur', () => {
    const workbook = extractOoxmlWorkbook(fixtureWorkbook())
    const visible = getOoxmlSheet(workbook, 'İlişkili Sayfa')
    expect(getOoxmlSheet(workbook, 'Gizli').state).toBe('hidden')
    expect(visible.hiddenRows).toEqual([2])
    expect(visible.hiddenColumns).toEqual([{ min: 3, max: 4 }])
    expect(visible.dataValidations).toEqual([{
      sqref: 'C3',
      type: 'list',
      allowBlank: true,
      formula1: '"A,B"',
    }])
  })

  it('yanlış workbook hash değerinde fail-closed davranır', () => {
    const bytes = fixtureWorkbook()
    expect(() => assertWorkbookSha256(bytes, '0'.repeat(64))).toThrowError(
      expect.objectContaining({ code: 'WORKBOOK_HASH_MISMATCH' }),
    )
    expect(assertWorkbookSha256(bytes, sha256WorkbookBytes(bytes))).toBe(sha256WorkbookBytes(bytes))
  })

  it('başlangıç ve bitiş workbook hash farkında fail-closed davranır', () => {
    expect(() => assertWorkbookHashUnchanged('a'.repeat(64), 'b'.repeat(64))).toThrowError(
      expect.objectContaining({ code: 'WORKBOOK_CHANGED_DURING_EXTRACTION' }),
    )
    expect(() => assertWorkbookHashUnchanged('A'.repeat(64), 'a'.repeat(64))).not.toThrow()
  })

  it('relationship traversal hedefini reddeder', () => {
    expect(() => resolveOoxmlRelationshipTarget('xl/workbook.xml', '../../outside.xml'))
      .toThrowError(OoxmlExtractorError)
  })
})
