import { describe, expect, it } from 'vitest'
import {
  CASE_INVENTORY_COLUMNS,
  MAX_CASE_VEHICLE_OWNERS,
  buildInventoryCells,
  buildInventoryExportFilename,
  caseTypeLabel,
  escapeExcelCellValue,
  formatInventoryDate,
  joinOwners,
  normalizePhoneForExport,
  validateCaseVehicleOwners,
  type CaseInventoryRow,
} from '../src/index.js'

const baseRow: CaseInventoryRow = {
  caseId: 'c1',
  officeNumber: '2026/6700',
  plate: '34 ABC 123',
  insurerName: 'Referans Sigorta',
  responsibleName: 'Enes Yılmaz',
  caseType: 'traffic',
  caseStatus: 'open',
  accidentDate: '2026-07-10',
  notificationDate: '2026-07-12',
  expertReportStatus: 'Tamamlandı',
  expertReportDate: '2026-07-15',
  expertReportNumber: 'ER-2026-88',
  serviceName: 'Yetkili Servis A',
  serviceCity: 'İstanbul',
  servicePhone: '02121234567',
  owners: [
    { name: 'Ahmet Demir', phone: '05321112233' },
    { name: 'Ayşe Demir', phone: '05334445566' },
  ],
}

describe('sütun tanımları', () => {
  it('16 zorunlu sütunu Türkçe başlıkla taşır', () => {
    expect(CASE_INVENTORY_COLUMNS).toHaveLength(16)
    expect(CASE_INVENTORY_COLUMNS.map((c) => c.header)).toContain('Dosya No')
    expect(CASE_INVENTORY_COLUMNS.map((c) => c.header)).toContain('Araç Sahibi veya Sahipleri')
  })

  it('telefon, plaka ve dosya no DAİMA text tipindedir (sayı değil)', () => {
    const byKey = new Map(CASE_INVENTORY_COLUMNS.map((c) => [c.key, c]))
    for (const key of ['servicePhone', 'ownerPhones', 'plate', 'officeNumber', 'expertReportNumber']) {
      expect(byKey.get(key)?.cellType).toBe('text')
    }
  })

  it('telefon ve araç sahibi sütunları PII işaretlidir', () => {
    const byKey = new Map(CASE_INVENTORY_COLUMNS.map((c) => [c.key, c]))
    expect(byKey.get('servicePhone')?.pii).toBe(true)
    expect(byKey.get('ownerNames')?.pii).toBe(true)
    expect(byKey.get('ownerPhones')?.pii).toBe(true)
    expect(byKey.get('plate')?.pii).toBe(false)
  })
})

describe('formül enjeksiyonu koruması', () => {
  it('=, +, -, @ ile başlayan değeri nötrler', () => {
    expect(escapeExcelCellValue('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)")
    expect(escapeExcelCellValue('+1')).toBe("'+1")
    expect(escapeExcelCellValue('-1')).toBe("'-1")
    expect(escapeExcelCellValue('@cmd')).toBe("'@cmd")
  })

  it('sekme/CR/LF ile başlayan değeri nötrler', () => {
    expect(escapeExcelCellValue('\t=x')).toBe("'\t=x")
  })

  it('normal metni değiştirmez', () => {
    expect(escapeExcelCellValue('34 ABC 123')).toBe('34 ABC 123')
    expect(escapeExcelCellValue('Referans Sigorta')).toBe('Referans Sigorta')
  })

  it('hücre üretiminde kullanıcı verisi çalıştırılamaz', () => {
    const cells = buildInventoryCells(
      { ...baseRow, responsibleName: '=HYPERLINK("http://evil")' },
      { includePhones: true, missingAsMarker: false },
    )
    expect(cells.responsibleName.value.startsWith("'=")).toBe(true)
  })
})

describe('telefon string olarak korunur', () => {
  it('baştaki sıfırı korur', () => {
    expect(normalizePhoneForExport('05321234567')).toBe('05321234567')
  })

  it('boş/eksik null döner', () => {
    expect(normalizePhoneForExport('')).toBeNull()
    expect(normalizePhoneForExport('   ')).toBeNull()
    expect(normalizePhoneForExport(null)).toBeNull()
  })

  it('hücre üretiminde telefon text tipinde ve sıfır korunmuş', () => {
    const cells = buildInventoryCells(baseRow, { includePhones: true, missingAsMarker: false })
    expect(cells.servicePhone.cellType).toBe('text')
    expect(cells.servicePhone.value).toBe('02121234567')
  })
})

describe('birden çok araç sahibi', () => {
  it('isim ve telefonları `; ` ile hizalı birleştirir', () => {
    const joined = joinOwners(baseRow.owners)
    expect(joined.names).toBe('Ahmet Demir; Ayşe Demir')
    expect(joined.phones).toBe('05321112233; 05334445566')
  })

  it('telefonu olmayan sahipte hizalama bozulmaz (yeri boş kalır)', () => {
    const joined = joinOwners([
      { name: 'Ahmet Demir', phone: '05321112233' },
      { name: 'Boş Telefonlu', phone: null },
    ])
    expect(joined.names).toBe('Ahmet Demir; Boş Telefonlu')
    expect(joined.phones).toBe('05321112233; ')
  })
})

describe('tarih biçimi', () => {
  it('ISO tarihi dd.mm.yyyy yapar', () => {
    expect(formatInventoryDate('2026-07-10')).toBe('10.07.2026')
    expect(formatInventoryDate('2026-07-10T09:00:00Z')).toBe('10.07.2026')
  })

  it('geçersiz/eksik null döner', () => {
    expect(formatInventoryDate(null)).toBeNull()
    expect(formatInventoryDate('bozuk')).toBeNull()
  })
})

describe('dosya adı', () => {
  it('beklenen kalıbı üretir', () => {
    expect(buildInventoryExportFilename({ dateIso: '2026-07-21', userLabel: 'Enes' }))
      .toBe('Dosya_Envanteri_20260721_Enes.xlsx')
  })

  it('Windows geçersiz karakterlerini ve boşluğu temizler', () => {
    const name = buildInventoryExportFilename({
      dateIso: '2026-07-21', userLabel: 'a/b:c*?<>|"\\ d',
    })
    expect(name).not.toMatch(/[<>:"/\\|?*]/)
    expect(name).toBe('Dosya_Envanteri_20260721_abc_d.xlsx')
  })

  it('boş kullanıcı ve geçersiz tarih güvenli varsayılana düşer', () => {
    expect(buildInventoryExportFilename({ dateIso: 'x', userLabel: '' }))
      .toBe('Dosya_Envanteri_tarih_kullanici.xlsx')
  })
})

describe('hücre üretimi bütünlüğü', () => {
  it('dosya türü Türkçe etikete çevrilir', () => {
    expect(caseTypeLabel('traffic')).toBe('Trafik')
    expect(caseTypeLabel('casco')).toBe('Kasko')
    const cells = buildInventoryCells(baseRow, { includePhones: true, missingAsMarker: false })
    expect(cells.caseType.value).toBe('Trafik')
  })

  it('yetkisiz kullanıcıda telefon HİÇ üretilmez (gizlemek değil, boş)', () => {
    const cells = buildInventoryCells(baseRow, { includePhones: false, missingAsMarker: false })
    expect(cells.servicePhone.value).toBe('')
    expect(cells.ownerPhones.value).toBe('')
    // Ama araç sahibi ADI (ayrı yetki) telefondan bağımsızdır ve kalır.
    expect(cells.ownerNames.value).toBe('Ahmet Demir; Ayşe Demir')
  })

  it('eksik değer politikası TÜM sütunlarda tutarlı (Eksik)', () => {
    const sparse: CaseInventoryRow = {
      ...baseRow, insurerName: null, serviceCity: null, expertReportNumber: null, owners: [],
    }
    const cells = buildInventoryCells(sparse, { includePhones: true, missingAsMarker: true })
    expect(cells.insurerName.value).toBe('Eksik')
    expect(cells.serviceCity.value).toBe('Eksik')
    expect(cells.expertReportNumber.value).toBe('Eksik')
    expect(cells.ownerNames.value).toBe('Eksik')
  })

  it('eksik değer politikası boş hücre modunda tutarlı', () => {
    const sparse: CaseInventoryRow = { ...baseRow, insurerName: null }
    const cells = buildInventoryCells(sparse, { includePhones: true, missingAsMarker: false })
    expect(cells.insurerName.value).toBe('')
  })
})

describe('validateCaseVehicleOwners', () => {
  it('boş liste geçerlidir (sahip bilinmiyor durumuna dönüş)', () => {
    const result = validateCaseVehicleOwners([])
    expect(result).toEqual({ valid: true, owners: [] })
  })

  it('geçerli ad ve telefonu trim eder', () => {
    const result = validateCaseVehicleOwners([{ name: '  Ahmet Demir  ', phone: ' 0532 111 22 33 ' }])
    expect(result).toEqual({ valid: true, owners: [{ name: 'Ahmet Demir', phone: '0532 111 22 33' }] })
  })

  it('telefonu olmayan sahibi kabul eder (null)', () => {
    const result = validateCaseVehicleOwners([{ name: 'Ahmet Demir', phone: null }])
    expect(result).toEqual({ valid: true, owners: [{ name: 'Ahmet Demir', phone: null }] })
  })

  it('boş string telefonu null olarak normalize eder', () => {
    const result = validateCaseVehicleOwners([{ name: 'Ahmet Demir', phone: '   ' }])
    expect(result).toEqual({ valid: true, owners: [{ name: 'Ahmet Demir', phone: null }] })
  })

  it(`üst sınırı (${MAX_CASE_VEHICLE_OWNERS}) aşan listeyi reddeder`, () => {
    const owners = Array.from({ length: MAX_CASE_VEHICLE_OWNERS + 1 }, (_, index) => ({ name: `Sahip ${index}`, phone: null }))
    expect(validateCaseVehicleOwners(owners)).toEqual({ valid: false, reasonCode: 'OWNERS_TOO_MANY' })
  })

  it('boş adı reddeder', () => {
    expect(validateCaseVehicleOwners([{ name: '   ', phone: null }]))
      .toEqual({ valid: false, reasonCode: 'OWNER_NAME_INVALID' })
  })

  it('kontrol karakteri içeren adı reddeder', () => {
    expect(validateCaseVehicleOwners([{ name: 'Ahmet\tDemir', phone: null }]))
      .toEqual({ valid: false, reasonCode: 'OWNER_NAME_INVALID' })
  })

  it('harf içeren telefonu reddeder (numeric-değil ama biçimsiz metin de kabul edilmez)', () => {
    expect(validateCaseVehicleOwners([{ name: 'Ahmet Demir', phone: 'call-me' }]))
      .toEqual({ valid: false, reasonCode: 'OWNER_PHONE_INVALID' })
  })

  it('baştaki sıfırı korur; sayıya çevirmez', () => {
    const result = validateCaseVehicleOwners([{ name: 'Ahmet Demir', phone: '05321234567' }])
    expect(result).toEqual({ valid: true, owners: [{ name: 'Ahmet Demir', phone: '05321234567' }] })
  })

  it('çok kısa telefonu reddeder', () => {
    expect(validateCaseVehicleOwners([{ name: 'Ahmet Demir', phone: '12' }]))
      .toEqual({ valid: false, reasonCode: 'OWNER_PHONE_INVALID' })
  })
})
