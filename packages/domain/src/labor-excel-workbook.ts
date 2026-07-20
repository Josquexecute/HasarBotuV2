/**
 * Paket 64 — gerçek workbook geometrisi ve cerrahi hücre yamalama
 * (HB-2026-071).
 *
 * Bu modül SAF'tır: dosya okumaz/yazmaz, yalnız çözülmüş XML metinleri
 * üzerinde çalışır. ZIP açma/kapama ve dosya işlemleri File Agent'ta.
 *
 * TASARIM KARARI — neden tam bir xlsx nesne modeli kullanılmıyor:
 * Nesne modeli kuran kütüphaneler workbook'u parse edip YENİDEN üretir ve
 * modellemedikleri özellikleri (grafik, pivot, koşullu biçimlendirme, veri
 * doğrulama) sessizce düşürür. Burada yalnız hedef hücreler yamalanır;
 * dokunulmayan her ZIP girdisi byte-birebir korunur ve bu doğrulanabilir.
 */
export const LABOR_EXCEL_GEOMETRY_VERSION = 'labor-excel-geometry/1.0.0' as const

/** Excel A1 gösterimi: sütun harfi + satır numarası. */
export interface CellReference {
  readonly column: string
  readonly row: number
}

export function parseCellReference(value: string): CellReference | null {
  const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(value)
  if (match === null) return null
  return { column: match[1] as string, row: Number(match[2]) }
}

export function columnToIndex(column: string): number {
  let index = 0
  for (const character of column) {
    index = index * 26 + (character.charCodeAt(0) - 64)
  }
  return index
}

export function indexToColumn(index: number): string {
  let remaining = index
  let column = ''
  while (remaining > 0) {
    const remainder = (remaining - 1) % 26
    column = String.fromCharCode(65 + remainder) + column
    remaining = Math.floor((remaining - 1) / 26)
  }
  return column
}

/** XML metin kaçışı; hücre değeri sayıdır ama savunma amaçlı uygulanır. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

export type WorkbookSignatureFailure =
  | 'sheet_not_found'
  | 'header_row_mismatch'
  | 'identity_mismatch'
  | 'no_data_rows'

export interface WorkbookHeaderExpectation {
  /** Hücre referansı → beklenen başlık metni (harf duyarsız karşılaştırılır). */
  readonly cell: string
  readonly text: string
}

export interface WorkbookSignatureCheck {
  readonly sheetName: string
  readonly headers: readonly WorkbookHeaderExpectation[]
  /** Plaka/dosya numarası doğrulama hücreleri; boş bırakılabilir. */
  readonly identityCells: readonly WorkbookHeaderExpectation[]
}

export type WorkbookSignatureResult =
  | { readonly verified: false; readonly reason: WorkbookSignatureFailure; readonly detail: string | null }
  | { readonly verified: true }

/** Karşılaştırma için metin normalize edilir; biçim farkı imzayı bozmaz. */
export function normalizeSignatureText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr')
}

/**
 * Sheet XML'inden hücre → metin haritası çıkarır.
 *
 * `sharedStrings` paylaşılan metin tablosudur; inline string ve sayı da
 * desteklenir. Bu fonksiyon YALNIZ okur.
 */
export function readSheetTextCells(
  sheetXml: string,
  sharedStrings: readonly string[],
): ReadonlyMap<string, string> {
  const cells = new Map<string, string>()
  for (const match of sheetXml.matchAll(/<c\s+r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g)) {
    const reference = match[1] as string
    const attributes = match[2] as string
    const body = match[3] as string
    const type = /\st="([^"]+)"/.exec(attributes)?.[1] ?? 'n'
    if (type === 's') {
      const index = Number(/<v>(\d+)<\/v>/.exec(body)?.[1] ?? '-1')
      const text = sharedStrings[index]
      if (text !== undefined) cells.set(reference, text)
      continue
    }
    if (type === 'inlineStr') {
      const text = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
        .map((item) => item[1] as string).join('')
      cells.set(reference, text)
      continue
    }
    const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]
    if (value !== undefined) cells.set(reference, value)
  }
  return cells
}

/**
 * Workbook'un beklenen şablon olduğunu doğrular.
 *
 * Dosya ADINA bakılmaz: keşifte dosya adına güvenmenin yanlış workbook'u
 * seçtiği ölçüldü (`İŞÇİLİK.xlsx` adlı iki dosya aslında parça listesiydi).
 * Ayırt edici olan İÇERİK imzasıdır.
 */
export function verifyWorkbookSignature(
  check: WorkbookSignatureCheck,
  cells: ReadonlyMap<string, string>,
): WorkbookSignatureResult {
  for (const header of check.headers) {
    const actual = cells.get(header.cell)
    if (actual === undefined
      || normalizeSignatureText(actual) !== normalizeSignatureText(header.text)) {
      return { verified: false, reason: 'header_row_mismatch', detail: header.cell }
    }
  }
  for (const identity of check.identityCells) {
    const actual = cells.get(identity.cell)
    if (actual === undefined
      || normalizeSignatureText(actual) !== normalizeSignatureText(identity.text)) {
      return { verified: false, reason: 'identity_mismatch', detail: identity.cell }
    }
  }
  return { verified: true }
}

export interface CellWrite {
  readonly cell: string
  /** Kuruş değil; Excel'e yazılan gerçek sayı (TL). */
  readonly value: number
}

export type CellWritePlanFailure =
  | 'cell_reference_invalid'
  | 'cell_outside_allowed_columns'
  | 'cell_outside_allowed_rows'
  | 'duplicate_cell'
  | 'value_not_finite'

export interface CellWriteBounds {
  readonly allowedColumns: readonly string[]
  readonly firstDataRow: number
  readonly maxDataRow: number
}

export type CellWritePlanResult =
  | { readonly ok: false; readonly reason: CellWritePlanFailure; readonly detail: string }
  | { readonly ok: true; readonly writes: readonly CellWrite[] }

/**
 * Yazılacak hücrelerin profil sınırları içinde kaldığını doğrular.
 *
 * Sınır dışı tek hücre bile TÜM planı düşürür; kısmi yazım yoktur.
 */
export function planCellWrites(
  writes: readonly CellWrite[],
  bounds: CellWriteBounds,
): CellWritePlanResult {
  const allowed = new Set(bounds.allowedColumns)
  const seen = new Set<string>()
  for (const write of writes) {
    const reference = parseCellReference(write.cell)
    if (reference === null) {
      return { ok: false, reason: 'cell_reference_invalid', detail: write.cell }
    }
    if (!allowed.has(reference.column)) {
      return { ok: false, reason: 'cell_outside_allowed_columns', detail: write.cell }
    }
    if (reference.row < bounds.firstDataRow || reference.row > bounds.maxDataRow) {
      return { ok: false, reason: 'cell_outside_allowed_rows', detail: write.cell }
    }
    if (seen.has(write.cell)) {
      return { ok: false, reason: 'duplicate_cell', detail: write.cell }
    }
    seen.add(write.cell)
    if (!Number.isFinite(write.value)) {
      return { ok: false, reason: 'value_not_finite', detail: write.cell }
    }
  }
  return { ok: true, writes }
}

/**
 * Sheet XML'ine YALNIZ verilen hücreleri yazar.
 *
 * Kurallar:
 * - Var olan hücrenin yalnız `<v>` değeri değişir; stil (`s`) korunur.
 * - Hücre yoksa satır içine SÜTUN SIRASINA göre eklenir.
 * - Satır yoksa `<sheetData>` içine satır numarası sırasına göre eklenir.
 * - Formül taşıyan hücreye YAZILMAZ: formül sessizce sabit sayıya
 *   dönüştürülmez, plan reddedilir.
 * - XML'in geri kalanına dokunulmaz.
 */
export type CellPatchFailure = 'cell_has_formula' | 'sheet_data_missing'

export type CellPatchResult =
  | { readonly ok: false; readonly reason: CellPatchFailure; readonly detail: string }
  | { readonly ok: true; readonly xml: string; readonly patchedCells: readonly string[] }

export function patchSheetCells(
  sheetXml: string,
  writes: readonly CellWrite[],
): CellPatchResult {
  if (!sheetXml.includes('<sheetData')) {
    return { ok: false, reason: 'sheet_data_missing', detail: 'sheetData' }
  }
  let xml = sheetXml
  const patched: string[] = []

  const byRow = new Map<number, CellWrite[]>()
  for (const write of writes) {
    const reference = parseCellReference(write.cell) as CellReference
    const list = byRow.get(reference.row) ?? []
    list.push(write)
    byRow.set(reference.row, list)
  }

  for (const [rowNumber, rowWrites] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
    const rowPattern = new RegExp(`<row[^>]*\\sr="${rowNumber}"[^>]*(?:/>|>[\\s\\S]*?</row>)`)
    const rowMatch = rowPattern.exec(xml)

    let rowXml = rowMatch?.[0] ?? `<row r="${rowNumber}"></row>`
    if (rowXml.endsWith('/>')) {
      rowXml = `${rowXml.slice(0, -2)}></row>`
    }

    for (const write of rowWrites) {
      const cellPattern = new RegExp(
        `<c\\s+r="${write.cell}"([^>]*)>([\\s\\S]*?)</c>|<c\\s+r="${write.cell}"([^>]*)/>`,
      )
      const cellMatch = cellPattern.exec(rowXml)
      const serialized = escapeXml(String(write.value))

      if (cellMatch === null) {
        // Hücre yok: sütun sırasına göre ekle.
        const targetIndex = columnToIndex((parseCellReference(write.cell) as CellReference).column)
        const existing = [...rowXml.matchAll(/<c\s+r="([A-Z]+)(\d+)"/g)]
        let insertAt = rowXml.lastIndexOf('</row>')
        for (const item of existing) {
          if (columnToIndex(item[1] as string) > targetIndex) {
            insertAt = item.index as number
            break
          }
        }
        rowXml = `${rowXml.slice(0, insertAt)}<c r="${write.cell}"><v>${serialized}</v></c>`
          + rowXml.slice(insertAt)
        patched.push(write.cell)
        continue
      }

      const attributes = (cellMatch[1] ?? cellMatch[3] ?? '')
      const body = cellMatch[2] ?? ''
      if (/<f[\s>/]/.test(body)) {
        return { ok: false, reason: 'cell_has_formula', detail: write.cell }
      }
      // Tür `n` (sayı) olmalı; paylaşılan metin türü kaldırılır çünkü
      // yazdığımız değer sayıdır ve sharedStrings'e dokunmayız.
      const keptAttributes = attributes.replace(/\st="[^"]*"/g, '')
      rowXml = rowXml.slice(0, cellMatch.index)
        + `<c r="${write.cell}"${keptAttributes}><v>${serialized}</v></c>`
        + rowXml.slice((cellMatch.index as number) + cellMatch[0].length)
      patched.push(write.cell)
    }

    if (rowMatch === null) {
      // Satır yoktu: sheetData içine satır sırasına göre ekle.
      const rows = [...xml.matchAll(/<row[^>]*\sr="(\d+)"/g)]
      let insertAt = xml.indexOf('</sheetData>')
      for (const item of rows) {
        if (Number(item[1]) > rowNumber) {
          insertAt = item.index as number
          break
        }
      }
      xml = xml.slice(0, insertAt) + rowXml + xml.slice(insertAt)
    } else {
      xml = xml.slice(0, rowMatch.index)
        + rowXml
        + xml.slice((rowMatch.index as number) + rowMatch[0].length)
    }
  }

  return { ok: true, xml, patchedCells: patched }
}

/**
 * Workbook'un açılışta yeniden hesaplanmasını ister.
 *
 * Toplam sütunu formüllüdür; yamalanan hücreler değişince Excel'in önbelleğe
 * alınmış formül sonucu bayat kalır. Sahte bir toplam YAZILMAZ; bunun yerine
 * Excel'e yeniden hesaplaması söylenir.
 */
export function requestFullRecalculation(workbookXml: string): string {
  if (/<calcPr[^>]*\/>/.test(workbookXml)) {
    return workbookXml.replace(/<calcPr([^>]*)\/>/, (_match, attributes: string) => {
      const cleaned = attributes.replace(/\sfullCalcOnLoad="[^"]*"/g, '')
      return `<calcPr${cleaned} fullCalcOnLoad="1"/>`
    })
  }
  if (workbookXml.includes('</workbook>')) {
    return workbookXml.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>')
  }
  return workbookXml
}
