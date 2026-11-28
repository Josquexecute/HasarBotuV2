import { strToU8, zipSync } from 'fflate'
import { expect, it } from 'vitest'
import { extractOfficePreview } from '../src/main/case-folder-office-preview.js'

const archive = (parts: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(parts).map(([name, xml]) => [name, strToU8(xml)])))

it('extracts Word paragraphs as inert text and rejects DTDs', () => {
  expect(extractOfficePreview(archive({
    'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Hasar &amp; servis</w:t><w:br/><w:t>&lt;script&gt;</w:t></w:r></w:p></w:body></w:document>',
    'word/_rels/document.xml.rels': '<Relationships><Relationship TargetMode="External" Target="https://example.invalid/"/></Relationships>',
  }), 'docx')).toEqual({ kind: 'word', paragraphs: ['Hasar & servis\n<script>'], truncated: false })
  expect(() => extractOfficePreview(archive({ 'word/document.xml': '<!DOCTYPE document><document/>' }), 'docx')).toThrow('DTD')
  expect(() => extractOfficePreview(archive({ 'word/document.xml': 'x'.repeat(4 * 1024 * 1024 + 1) }), 'docx')).toThrow('size limit')
})

it('shows named Excel sheets and saved cell values without interpreting formulas or external sheets', () => {
  const bytes = archive({
    'xl/workbook.xml': '<workbook><sheets><sheet name="Kalemler" r:id="rows"/><sheet name="Dış bağlantı" r:id="external"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rows" Target="worksheets/expenses.xml" Type="internal/worksheet"/><Relationship Id="external" TargetMode="External" Target="https://example.invalid/" Type="internal/worksheet"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>Parça</t></si></sst>',
    'xl/worksheets/expenses.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><f>EXTERNAL()</f><v>1600</v></c></row><row r="62"><c r="A62"><v>5</v></c></row></sheetData></worksheet>',
  })
  expect(extractOfficePreview(bytes, 'xlsx')).toEqual({ kind: 'workbook', sheets: [{ name: 'Kalemler', rows: [['Parça', '', '1600']] }], truncated: true })
})
