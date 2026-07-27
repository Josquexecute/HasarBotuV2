import { strToU8, zipSync } from 'fflate'
import type { InventoryColumn } from '@hasarbotu/domain'

/**
 * Dosya Envanteri — sıfırdan minimal `.xlsx` yazıcı.
 *
 * Var olan bir dosyayı DÜZENLEMEZ (Paket 65A/65B'nin cerrahi patch akışından
 * farklıdır); burada tamamen yeni, tek sayfalık bir OOXML paketi üretilir.
 * Beş parçalık standart minimal yapı kullanılır (paylaşılan string tablosu
 * yok; her hücre `inlineStr`tir — daha az hareketli parça, daha az hata
 * yüzeyi). Hücre değerleri her zaman metin (`t="inlineStr"`); sayı/tarih
 * tipi ASLA kullanılmaz — biçim/baştaki sıfır kaybı riski taşımaz.
 */

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
  + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
  + '</Types>'

const ROOT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
  + '</Relationships>'

const WORKBOOK_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
  + '</Relationships>'

function workbookXml(sheetName: string): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
    + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>`
    + '</workbook>'
}

/** 0-tabanlı sütun indeksini Excel harf referansına çevirir (0 -> A, 26 -> AA). */
export function excelColumnLetter(index: number): string {
  let n = index + 1
  let letters = ''
  while (n > 0) {
    const remainder = (n - 1) % 26
    letters = String.fromCharCode(65 + remainder) + letters
    n = Math.floor((n - 1) / 26)
  }
  return letters
}

function cellXml(columnIndex: number, rowNumber: number, value: string): string {
  const ref = `${excelColumnLetter(columnIndex)}${rowNumber}`
  if (value.length === 0) return `<c r="${ref}" t="inlineStr"/>`
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
}

export function buildInventoryXlsx(input: {
  readonly columns: readonly InventoryColumn[]
  readonly rows: readonly Readonly<Record<string, string>>[]
  readonly sheetName: string
}): Uint8Array {
  const lastColumn = excelColumnLetter(Math.max(input.columns.length - 1, 0))
  const rowsXml: string[] = [
    `<row r="1">${input.columns.map((column, index) => cellXml(index, 1, column.header)).join('')}</row>`,
  ]
  input.rows.forEach((row, offset) => {
    const rowNumber = offset + 2
    const cells = input.columns.map((column, index) => cellXml(index, rowNumber, row[column.key] ?? '')).join('')
    rowsXml.push(`<row r="${rowNumber}">${cells}</row>`)
  })
  const sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + `<dimension ref="A1:${lastColumn}${input.rows.length + 1}"/>`
    + `<sheetData>${rowsXml.join('')}</sheetData>`
    + '</worksheet>'

  return zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(ROOT_RELS),
    'xl/workbook.xml': strToU8(workbookXml(input.sheetName)),
    'xl/_rels/workbook.xml.rels': strToU8(WORKBOOK_RELS),
    'xl/worksheets/sheet1.xml': strToU8(sheetXml),
  }, { level: 6 })
}
