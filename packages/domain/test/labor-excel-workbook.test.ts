import { describe, expect, it } from 'vitest'
import {
  columnToIndex,
  indexToColumn,
  matchFolderName,
  normalizePlateFolderName,
  parseCellReference,
  patchSheetCells,
  planCellWrites,
  readSheetTextCells,
  requestFullRecalculation,
  resolveCaseFolderCandidates,
  validateInsurerFolderName,
  verifyWorkbookSignature,
} from '../src/index.js'

/**
 * Paket 64 — gerçek workbook geometrisi.
 *
 * Fixture'lar 2026-07-20 salt okunur keşfinde ölçülen GERÇEK yapıyı taklit
 * eder: `İşçilik Dağılımı` formu, 1. satır başlık, F–M operasyon sütunları,
 * N sütununda formüllü toplam. Gerçek müşteri verisi kullanılmaz.
 */
const HEADERS = [
  ['A1', '#'], ['B1', 'Ekleme Yeri'], ['C1', 'Orj. Kodu'], ['D1', 'Parça Adı'],
  ['E1', 'Eksper Fiyatı'], ['F1', 'Kaporta'], ['G1', 'Mekanik'], ['H1', 'Elektrik'],
  ['I1', 'Döş/Kilit'], ['J1', 'Cam'], ['K1', 'Kalibrasyon'], ['L1', 'Onarım'],
  ['M1', 'Boya'], ['N1', 'Toplam'],
] as const

/** Paylaşılan metin tablosuyla sentetik sheet XML'i üretir. */
function buildSheet(): { xml: string; shared: string[] } {
  const shared: string[] = []
  const sharedIndex = (text: string) => {
    const existing = shared.indexOf(text)
    if (existing >= 0) return existing
    shared.push(text)
    return shared.length - 1
  }
  const headerCells = HEADERS
    .map(([ref, text]) => `<c r="${ref}" t="s" s="3"><v>${sharedIndex(text)}</v></c>`)
    .join('')
  // 2. satır: metin sütunları + sayısal operasyon sütunları + formüllü toplam.
  const row2 = [
    `<c r="A2"><v>1</v></c>`,
    `<c r="B2" t="s"><v>${sharedIndex('CMD')}</v></c>`,
    `<c r="C2" t="s"><v>${sharedIndex('6C16V20123DJ')}</v></c>`,
    `<c r="D2" t="s"><v>${sharedIndex('SOL ÖN KAPI')}</v></c>`,
    `<c r="E2" s="7"><v>37000</v></c>`,
    `<c r="F2" s="7"><v>0</v></c>`,
    `<c r="N2" s="9"><f>SUM(F2:M2)</f><v>0</v></c>`,
  ].join('')
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<dimension ref="A1:N2"/><sheetData>'
    + `<row r="1" spans="1:14">${headerCells}</row>`
    + `<row r="2" spans="1:14">${row2}</row>`
    + '</sheetData><mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells>'
    + '</worksheet>'
  return { xml, shared }
}

const SIGNATURE = {
  sheetName: 'Main sheet',
  headers: HEADERS.map(([cell, text]) => ({ cell, text })),
  identityCells: [],
}

describe('Paket 64 — workbook imza doğrulaması', () => {
  it('gerçek başlık düzenini doğrular', () => {
    const { xml, shared } = buildSheet()
    const cells = readSheetTextCells(xml, shared)
    expect(verifyWorkbookSignature(SIGNATURE, cells)).toEqual({ verified: true })
  })

  it('başlık biçim farkını (boşluk/harf) imza bozulması saymaz', () => {
    const { xml, shared } = buildSheet()
    const cells = new Map(readSheetTextCells(xml, shared))
    cells.set('F1', '  KAPORTA  ')
    expect(verifyWorkbookSignature(SIGNATURE, cells).verified).toBe(true)
  })

  it('eksik veya değişmiş başlıkta doğrulamayı reddeder', () => {
    const { xml, shared } = buildSheet()
    const cells = new Map(readSheetTextCells(xml, shared))
    cells.set('I1', 'Döşeme')
    const result = verifyWorkbookSignature(SIGNATURE, cells)
    expect(result.verified).toBe(false)
    expect(!result.verified && result.reason).toBe('header_row_mismatch')
    expect(!result.verified && result.detail).toBe('I1')

    cells.delete('I1')
    expect(verifyWorkbookSignature(SIGNATURE, cells).verified).toBe(false)
  })

  it('kimlik hücresi uyuşmazlığını ayrı kodla reddeder', () => {
    const { xml, shared } = buildSheet()
    const cells = new Map(readSheetTextCells(xml, shared))
    const withIdentity = {
      ...SIGNATURE,
      identityCells: [{ cell: 'D2', text: 'BAŞKA PARÇA' }],
    }
    const result = verifyWorkbookSignature(withIdentity, cells)
    expect(result.verified).toBe(false)
    expect(!result.verified && result.reason).toBe('identity_mismatch')
  })
})

describe('Paket 64 — yazılabilir hücre sınırları', () => {
  const bounds = {
    allowedColumns: ['F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'],
    firstDataRow: 2,
    maxDataRow: 200,
  }

  it('izin verilen sütun ve satırdaki yazımı kabul eder', () => {
    const result = planCellWrites([{ cell: 'F2', value: 1 }, { cell: 'M9', value: 2 }], bounds)
    expect(result.ok).toBe(true)
  })

  it('izin verilmeyen sütuna yazımı reddeder', () => {
    for (const cell of ['A2', 'E2', 'N2', 'D5']) {
      const result = planCellWrites([{ cell, value: 1 }], bounds)
      expect(result.ok).toBe(false)
      expect(!result.ok && result.reason).toBe('cell_outside_allowed_columns')
    }
  })

  it('başlık satırına ve sınır dışı satıra yazımı reddeder', () => {
    expect(planCellWrites([{ cell: 'F1', value: 1 }], bounds).ok).toBe(false)
    expect(planCellWrites([{ cell: 'F201', value: 1 }], bounds).ok).toBe(false)
  })

  it('mükerrer hücreyi ve sayı olmayan değeri reddeder', () => {
    expect(planCellWrites([{ cell: 'F2', value: 1 }, { cell: 'F2', value: 2 }], bounds).ok)
      .toBe(false)
    expect(planCellWrites([{ cell: 'F2', value: Number.NaN }], bounds).ok).toBe(false)
    expect(planCellWrites([{ cell: 'F2', value: Number.POSITIVE_INFINITY }], bounds).ok)
      .toBe(false)
  })

  it('sınır dışı TEK hücre tüm planı düşürür', () => {
    const result = planCellWrites(
      [{ cell: 'F2', value: 1 }, { cell: 'G2', value: 2 }, { cell: 'A2', value: 3 }],
      bounds,
    )
    expect(result.ok).toBe(false)
  })
})

describe('Paket 64 — cerrahi hücre yamalama', () => {
  it('var olan hücrenin yalnız değerini değiştirir; stili korur', () => {
    const { xml } = buildSheet()
    const result = patchSheetCells(xml, [{ cell: 'F2', value: 1234.5 }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.xml).toContain('<c r="F2" s="7"><v>1234.5</v></c>')
    expect(result.patchedCells).toEqual(['F2'])
  })

  it('formüllü hücreye yazmaz; formülü sabit sayıya çevirmez', () => {
    const { xml } = buildSheet()
    const result = patchSheetCells(xml, [{ cell: 'N2', value: 99 }])
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toBe('cell_has_formula')
  })

  it('olmayan hücreyi satıra SÜTUN SIRASINDA ekler', () => {
    const { xml } = buildSheet()
    const result = patchSheetCells(xml, [{ cell: 'G2', value: 50 }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const row = /<row r="2"[^>]*>([\s\S]*?)<\/row>/.exec(result.xml)?.[1] ?? ''
    const order = [...row.matchAll(/<c r="([A-Z]+)2"/g)].map((match) => match[1])
    expect(order).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'N'])
  })

  it('dokunulmayan her şeyi olduğu gibi bırakır', () => {
    const { xml } = buildSheet()
    const result = patchSheetCells(xml, [{ cell: 'F2', value: 7 }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Başlık satırı, birleşik hücreler, formül ve boyut bilgisi korunur.
    expect(result.xml).toContain('<mergeCell ref="A1:B1"/>')
    expect(result.xml).toContain('<f>SUM(F2:M2)</f>')
    expect(result.xml).toContain('<dimension ref="A1:N2"/>')
    const header = /<row r="1"[^>]*>([\s\S]*?)<\/row>/.exec(result.xml)?.[1]
    const originalHeader = /<row r="1"[^>]*>([\s\S]*?)<\/row>/.exec(xml)?.[1]
    expect(header).toBe(originalHeader)
  })

  it('olmayan satırı satır sırasına göre ekler', () => {
    const { xml } = buildSheet()
    const result = patchSheetCells(xml, [{ cell: 'F3', value: 5 }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const rows = [...result.xml.matchAll(/<row r="(\d+)"/g)].map((match) => Number(match[1]))
    expect(rows).toEqual([1, 2, 3])
  })

  it('paylaşılan metin türünü sayıya yazarken temizler', () => {
    const { xml } = buildSheet()
    // B2 paylaşılan metindir; sayı yazılırsa t="s" kalmamalıdır.
    const result = patchSheetCells(xml, [{ cell: 'B2', value: 12 }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.xml).toContain('<c r="B2"><v>12</v></c>')
    expect(result.xml).not.toContain('<c r="B2" t="s">')
  })
})

describe('Paket 64 — yeniden hesaplama isteği', () => {
  it('mevcut calcPr üzerine fullCalcOnLoad ekler', () => {
    const xml = '<workbook><calcPr calcId="191029"/></workbook>'
    expect(requestFullRecalculation(xml))
      .toBe('<workbook><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>')
  })

  it('calcPr yoksa ekler ve tekrar çağrılınca çoğaltmaz', () => {
    const once = requestFullRecalculation('<workbook><sheets/></workbook>')
    expect(once).toContain('<calcPr fullCalcOnLoad="1"/>')
    const twice = requestFullRecalculation(once)
    expect([...twice.matchAll(/fullCalcOnLoad/g)]).toHaveLength(1)
  })
})

describe('Paket 64 — sütun referansı', () => {
  it('sütun harfi ile index arasında gidip gelir', () => {
    for (const [column, index] of [['A', 1], ['F', 6], ['N', 14], ['Z', 26], ['AA', 27]] as const) {
      expect(columnToIndex(column)).toBe(index)
      expect(indexToColumn(index)).toBe(column)
    }
  })

  it('geçersiz hücre referansını reddeder', () => {
    for (const value of ['', 'A', '1', 'A0', 'a1', 'AAAA1', 'F2 ']) {
      expect(parseCellReference(value)).toBeNull()
    }
    expect(parseCellReference('F2')).toEqual({ column: 'F', row: 2 })
  })
})

describe('Paket 64 — vaka klasörü yolu', () => {
  const base = { year: 2026, month: 7, plate: '47 ACA 535', insurerFolderName: 'REFERANS SİGORTA' }

  it('yıl, sigorta, ay ve plaka adaylarını üretir', () => {
    const result = resolveCaseFolderCandidates(base)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.candidates.year).toBe('2026')
    expect(result.candidates.plateFolderName).toBe('47ACA535')
    // Sürücüde iki yazım da görüldüğü için ikisi de aday üretilir.
    expect(result.candidates.monthFolderNames).toEqual(['TEMMUZ 2026', 'Temmuz 2026'])
    expect(result.candidates.closedFolderNames).toEqual(['KAPALI TEMMUZ 2026'])
  })

  it('Türkçe büyük harf dönüşümünü doğru yapar', () => {
    const may = resolveCaseFolderCandidates({ ...base, month: 5 })
    expect(may.ok && may.candidates.monthFolderNames[0]).toBe('MAYIS 2026')
    const june = resolveCaseFolderCandidates({ ...base, month: 6 })
    expect(june.ok && june.candidates.monthFolderNames[0]).toBe('HAZİRAN 2026')
    const april = resolveCaseFolderCandidates({ ...base, month: 4 })
    expect(april.ok && april.candidates.monthFolderNames[0]).toBe('NİSAN 2026')
  })

  it('mevcut dizinlerle harf duyarsız eşleşir', () => {
    const result = resolveCaseFolderCandidates(base)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Gerçek sürücüde iki şirket iki farklı yazım kullanıyor; ikisi de eşleşmeli.
    expect(matchFolderName(result.candidates.monthFolderNames, ['TEMMUZ 2026']))
      .toBe('TEMMUZ 2026')
    expect(matchFolderName(result.candidates.monthFolderNames, ['Temmuz 2026']))
      .toBe('Temmuz 2026')
    expect(matchFolderName(result.candidates.monthFolderNames, ['Ağustos 2026'])).toBeNull()
  })

  it('plakayı boşluksuz büyük harfe normalize eder', () => {
    expect(normalizePlateFolderName(' 47 aca 535 ')).toBe('47ACA535')
    expect(normalizePlateFolderName('34 mpa 764')).toBe('34MPA764')
    for (const invalid of ['', '12', 'AB/CD', '34-MPA-764', '34 MPA 764!']) {
      expect(normalizePlateFolderName(invalid)).toBeNull()
    }
  })

  it('sigorta klasör adında kök dışına çıkışı engeller', () => {
    for (const escape of ['..', '../gizli', 'a/b', 'a\\b', 'C:\\Windows', '..\\..\\x']) {
      expect(validateInsurerFolderName(escape)).toBe('insurer_folder_escapes_root')
    }
    expect(validateInsurerFolderName('REFERANS SİGORTA')).toBeNull()
    expect(validateInsurerFolderName('')).toBe('invalid_insurer_folder')
    expect(validateInsurerFolderName('a<b')).toBe('invalid_insurer_folder')
  })

  it('geçersiz yıl ve ayı reddeder; tarih uydurmaz', () => {
    expect(resolveCaseFolderCandidates({ ...base, year: 1999 }))
      .toEqual({ ok: false, reason: 'invalid_year' })
    expect(resolveCaseFolderCandidates({ ...base, month: 0 }))
      .toEqual({ ok: false, reason: 'invalid_month' })
    expect(resolveCaseFolderCandidates({ ...base, month: 13 }))
      .toEqual({ ok: false, reason: 'invalid_month' })
  })
})
