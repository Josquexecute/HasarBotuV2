import { strFromU8, unzipSync } from 'fflate'
import { expect, it } from 'vitest'
import { CASE_INVENTORY_COLUMNS } from '@hasarbotu/domain'
import { buildInventoryXlsx } from '../src/case-inventory/xlsx-writer.js'

function sheet(value: string) {
  const column = CASE_INVENTORY_COLUMNS[0]!
  const bytes = buildInventoryXlsx({ columns: [column], rows: [{ [column.key]: value }], sheetName: 'Envanter' })
  return strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml']!)
}

it('encodes invalid XML characters without losing their Excel string values', () => {
  const xml = sheet('A\u0000B\u0001C\u000bD\ufffeE\uffffF\r\nG\tTürkçe 😀')
  expect(xml).toContain('A_x0000_B_x0001_C_x000B_D_xFFFE_E_xFFFF_F_x000D_\nG\tTürkçe 😀')
})

it('keeps literal Excel escape sequences literal and writes formulas as text', () => {
  const xml = sheet('=_x0041_ + _x000D_ & <test>')
  expect(xml).toContain('=_x005F_x0041_ + _x005F_x000D_ &amp; &lt;test&gt;')
  expect(xml).not.toContain('<f>')
  expect(xml).toContain('t="inlineStr"')
})

it('encodes unpaired UTF-16 surrogates instead of emitting replacement characters', () => {
  expect(sheet('A\ud800B\udc00C')).toContain('A_xD800_B_xDC00_C')
})
