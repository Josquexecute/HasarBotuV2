import { describe, expect, it } from 'vitest'
import {
  LABOR_WORKBOOK_LIMITS,
  aggregateAppliedCategoriesToColumns,
  assertLaborWorkbookPlanSource,
  buildLaborWorkbookPlanHash,
  detectForbiddenOoxmlParts,
  detectZipEntryHazard,
  laborWorkbookPlanStale,
  minorToExcelNumericString,
  normalizeZipEntryName,
  validateZipStructure,
  type LaborWorkbookPlanFingerprint,
  type ZipEntryMeta,
} from '../src/index.js'

const CATEGORIES = [
  'bodywork', 'mechanical', 'electrical', 'upholstery_lock',
  'glass', 'calibration', 'repair', 'paint',
] as const

const amounts = (bodywork: number, paint: number) =>
  CATEGORIES.map((category) => ({
    category,
    amountMinor: category === 'bodywork' ? bodywork : category === 'paint' ? paint : 0,
  }))

describe('ZIP girişi tehlike tespiti', () => {
  it('kök/mutlak yolu reddeder', () => {
    expect(detectZipEntryHazard('/xl/worksheets/sheet1.xml')).toBe('WORKBOOK_ABSOLUTE_ENTRY')
    expect(detectZipEntryHazard('C:/evil.xml')).toBe('WORKBOOK_ABSOLUTE_ENTRY')
    expect(detectZipEntryHazard('\\\\server\\share')).toBe('WORKBOOK_ABSOLUTE_ENTRY')
  })

  it('üst dizine çıkan `..` segmentini reddeder (zip-slip)', () => {
    expect(detectZipEntryHazard('xl/../../etc/passwd')).toBe('WORKBOOK_PARENT_TRAVERSAL')
    expect(detectZipEntryHazard('..\\windows\\system32')).toBe('WORKBOOK_PARENT_TRAVERSAL')
  })

  it('kontrol karakteri ve aşırı uzun adı reddeder', () => {
    expect(detectZipEntryHazard(`xl/a${String.fromCharCode(0)}b.xml`)).toBe('WORKBOOK_ENTRY_NAME_INVALID')
    expect(detectZipEntryHazard('x'.repeat(LABOR_WORKBOOK_LIMITS.maxEntryNameLength + 1)))
      .toBe('WORKBOOK_ENTRY_NAME_INVALID')
  })

  it('normal OOXML girişini kabul eder', () => {
    expect(detectZipEntryHazard('xl/worksheets/sheet1.xml')).toBeNull()
    expect(detectZipEntryHazard('[Content_Types].xml')).toBeNull()
  })

  it('normalize: ters eğik çizgi ve casing tek biçime iner (Windows davranışı)', () => {
    expect(normalizeZipEntryName('xl\\Worksheets\\Sheet1.XML'))
      .toBe(normalizeZipEntryName('xl/worksheets/sheet1.xml'))
  })
})

describe('ZIP yapısı doğrulaması (zip-bomb)', () => {
  const clean: ZipEntryMeta = { name: 'xl/workbook.xml', compressedSize: 400, uncompressedSize: 1200 }

  it('temiz arşivi geçirir', () => {
    expect(validateZipStructure([clean]).ok).toBe(true)
  })

  it('tehlikeli açılma oranını yakalar', () => {
    const bomb: ZipEntryMeta = { name: 'xl/big.xml', compressedSize: 100, uncompressedSize: 100 * 500 }
    expect(validateZipStructure([bomb]).codes).toContain('WORKBOOK_COMPRESSION_RATIO')
  })

  it('normalize edilmiş yinelenen girişi yakalar (harf-duyarsız)', () => {
    const result = validateZipStructure([
      { name: 'xl/Sheet.xml', compressedSize: 10, uncompressedSize: 20 },
      { name: 'xl/sheet.xml', compressedSize: 10, uncompressedSize: 20 },
    ])
    expect(result.codes).toContain('WORKBOOK_DUPLICATE_ENTRY')
  })

  it('aşırı açılmış toplam boyutu yakalar', () => {
    const huge: ZipEntryMeta = {
      name: 'xl/huge.bin', compressedSize: 1_000_000,
      uncompressedSize: LABOR_WORKBOOK_LIMITS.maxUncompressedBytes + 1,
    }
    expect(validateZipStructure([huge]).codes).toContain('WORKBOOK_UNCOMPRESSED_TOO_LARGE')
  })

  it('şifreli paketi yakalar', () => {
    expect(validateZipStructure([{ ...clean, encrypted: true }]).codes).toContain('WORKBOOK_ENCRYPTED')
  })

  it('negatif, kesirli ve sıfıra sıkışmış ZIP metadata değerlerini reddeder', () => {
    const result = validateZipStructure([
      { name: 'xl/negative.xml', compressedSize: -1, uncompressedSize: 20 },
      { name: 'xl/fraction.xml', compressedSize: 10.5, uncompressedSize: 20 },
      { name: 'xl/zero.xml', compressedSize: 0, uncompressedSize: 20 },
    ])
    expect(result.codes).toContain('WORKBOOK_ZIP_METADATA_INVALID')
  })

  it('tüm ihlalleri toplar, ilkinde durmaz', () => {
    const result = validateZipStructure([
      { name: '/abs.xml', compressedSize: 1, uncompressedSize: 1000 },
      { name: 'xl/../x', compressedSize: 1, uncompressedSize: 1 },
    ])
    expect(result.codes).toContain('WORKBOOK_ABSOLUTE_ENTRY')
    expect(result.codes).toContain('WORKBOOK_PARENT_TRAVERSAL')
  })
})

describe('yasaklı OOXML parçaları', () => {
  const ct = '<?xml version="1.0"?><Types></Types>'

  it('vbaProject.bin ve makro content-type yakalanır', () => {
    const macroCt = '<Types><Override ContentType="application/vnd.ms-office.vbaProject"/></Types>'
    const codes = detectForbiddenOoxmlParts({
      entryNames: ['xl/vbaProject.bin'], contentTypesXml: macroCt,
    })
    expect(codes).toContain('WORKBOOK_VBA_PROJECT')
    expect(codes).toContain('WORKBOOK_MACRO_CONTENT')
  })

  it('_xmlsignatures dijital imza olarak yakalanır', () => {
    const codes = detectForbiddenOoxmlParts({
      entryNames: ['_xmlsignatures/sig1.xml'], contentTypesXml: ct,
    })
    expect(codes).toContain('WORKBOOK_DIGITAL_SIGNATURE')
  })

  it('harici bağlantı ve gömülü nesne yakalanır', () => {
    const codes = detectForbiddenOoxmlParts({
      entryNames: ['xl/externalLinks/externalLink1.xml', 'xl/embeddings/oleObject1.bin'],
      contentTypesXml: ct,
    })
    expect(codes).toContain('WORKBOOK_EXTERNAL_LINK')
    expect(codes).toContain('WORKBOOK_UNSUPPORTED_OBJECT')
  })

  it('part adı olmasa da external relationship hedefini yakalar', () => {
    const codes = detectForbiddenOoxmlParts({
      entryNames: ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels'],
      contentTypesXml: ct,
      relationshipXmls: [
        '<Relationships><Relationship Id="r1" Type="x/hyperlink" '
        + 'Target="https://example.invalid/" TargetMode="External"/></Relationships>',
      ],
    })
    expect(codes).toContain('WORKBOOK_EXTERNAL_LINK')
  })

  it('temiz workbook parçaları hiçbir kod üretmez', () => {
    expect(detectForbiddenOoxmlParts({
      entryNames: ['xl/workbook.xml', 'xl/worksheets/sheet1.xml'], contentTypesXml: ct,
    })).toEqual([])
  })
})

describe('minor-unit -> Excel ondalık dizesi (float yok)', () => {
  it('bilinen değerleri deterministik çevirir', () => {
    expect(minorToExcelNumericString(0)).toBe('0.00')
    expect(minorToExcelNumericString(5)).toBe('0.05')
    expect(minorToExcelNumericString(50)).toBe('0.50')
    expect(minorToExcelNumericString(123_456)).toBe('1234.56')
    expect(minorToExcelNumericString(100_000)).toBe('1000.00')
  })

  it('float hatası biriktirmez: büyük tutar tam kalır', () => {
    // 0.1 + 0.2 float tuzağı; string aritmetiği bundan etkilenmez.
    expect(minorToExcelNumericString(999_999_999_999)).toBe('9999999999.99')
  })

  it('negatif ve geçersiz değeri reddeder', () => {
    expect(minorToExcelNumericString(-1)).toBeNull()
    expect(minorToExcelNumericString(1.5)).toBeNull()
    expect(minorToExcelNumericString(Number.NaN)).toBeNull()
  })

  it('locale ayıracı kullanmaz; her zaman nokta', () => {
    expect(minorToExcelNumericString(150_000)).not.toContain(',')
  })
})

describe('aynı sütuna kategori toplama (deterministik)', () => {
  it('kanonik sırada deterministik toplar', () => {
    const mapping = { bodywork: 'A', paint: 'A' } as Record<string, string | null>
    const result = aggregateAppliedCategoriesToColumns({
      appliedAmounts: amounts(60_000, 40_000), mapping, laborAmountMinor: 100_000,
    })
    expect(result).toEqual([{ columnKey: 'A', amountMinor: 100_000 }])
  })

  it('pozitif tutar eşlenmemiş sütuna düşerse null', () => {
    const mapping = { bodywork: 'A', paint: null } as Record<string, string | null>
    expect(aggregateAppliedCategoriesToColumns({
      appliedAmounts: amounts(60_000, 40_000), mapping, laborAmountMinor: 100_000,
    })).toBeNull()
  })

  it('toplam işçilik tutarını tutmuyorsa null', () => {
    const mapping = { bodywork: 'A' } as Record<string, string | null>
    expect(aggregateAppliedCategoriesToColumns({
      appliedAmounts: amounts(60_000, 0), mapping, laborAmountMinor: 100_000,
    })).toBeNull()
  })
})

describe('plan hash ve bayatlık', () => {
  const fp: LaborWorkbookPlanFingerprint = {
    organizationId: 'org', caseId: 'case', insurerId: 'ins',
    applicationId: 'app', applicationTargetSheetVersion: 2,
    sheetId: 'sheet', sheetVersion: 2,
    profileId: 'prof', profileSchemaVersion: 'labor-excel-profile/2.0.0', profileVersion: 1,
    folderModel: 'lean/active', relativeWorkbookPath: '2026/Temmuz 2026/47ACA535/İŞÇİLİK.xlsx',
    workbookSha256: 'a'.repeat(64), workbookSize: 12_345,
    workbookModifiedIso: '2026-07-21T09:00:00.000Z',
    targetWorksheetPart: 'xl/worksheets/sheet1.xml',
    appliedProvenanceHash: 'b'.repeat(64),
  }

  it('aynı girdi aynı hash (idempotent)', () => {
    expect(buildLaborWorkbookPlanHash(fp)).toBe(buildLaborWorkbookPlanHash({ ...fp }))
  })

  it('anahtar sırası değişse de hash aynı (kanonik)', () => {
    const reordered = Object.fromEntries(
      Object.entries(fp).reverse(),
    ) as unknown as LaborWorkbookPlanFingerprint
    expect(buildLaborWorkbookPlanHash(reordered)).toBe(buildLaborWorkbookPlanHash(fp))
  })

  it('workbook hash değişince plan bayatlar', () => {
    expect(laborWorkbookPlanStale(fp, {
      workbookSha256: 'c'.repeat(64), workbookSize: fp.workbookSize,
      workbookModifiedIso: fp.workbookModifiedIso,
      applicationTargetSheetVersion: fp.applicationTargetSheetVersion,
      sheetVersion: fp.sheetVersion, profileVersion: fp.profileVersion,
    })).toBe(true)
  })

  it('hiçbir şey değişmezse bayat değil', () => {
    expect(laborWorkbookPlanStale(fp, fp)).toBe(false)
  })

  it('sheet veya profil sürümü değişince bayatlar', () => {
    expect(laborWorkbookPlanStale(fp, { ...fp, sheetVersion: 3 })).toBe(true)
    expect(laborWorkbookPlanStale(fp, { ...fp, profileVersion: 2 })).toBe(true)
  })
})

describe('plan kaynak kapısı — operasyon türünden türetme YOK', () => {
  const mapping = { bodywork: 'KAPORTA', paint: 'BOYA' } as Record<string, string | null>
  const base = {
    applicationCompleted: true,
    appliedAmounts: amounts(60_000, 40_000),
    profileSchemaVersion: 'labor-excel-profile/2.0.0',
    profileWritable: true,
    stale: false,
    mapping,
    laborAmountMinor: 100_000,
  }

  it('geçerli kaynak sütun planı üretir', () => {
    const result = assertLaborWorkbookPlanSource(base)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.columns).toEqual([
      { columnKey: 'KAPORTA', amountMinor: 60_000 },
      { columnKey: 'BOYA', amountMinor: 40_000 },
    ])
  })

  it('provenance null ise reddeder; dağılım UYDURULMAZ', () => {
    const result = assertLaborWorkbookPlanSource({ ...base, appliedAmounts: null })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('PLAN_PROVENANCE_MISSING')
  })

  it('tamamlanmamış uygulama reddedilir', () => {
    const result = assertLaborWorkbookPlanSource({ ...base, applicationCompleted: false })
    expect(result.ok && 'x').toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('PLAN_APPLICATION_NOT_COMPLETED')
  })

  it('profil 1.0.0 veya non-writable reddedilir', () => {
    expect(assertLaborWorkbookPlanSource({
      ...base, profileSchemaVersion: 'labor-excel-profile/1.0.0',
    }).ok).toBe(false)
    const r = assertLaborWorkbookPlanSource({ ...base, profileWritable: false })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('PLAN_PROFILE_NOT_WRITABLE')
  })

  it('bayat kayıt reddedilir', () => {
    const r = assertLaborWorkbookPlanSource({ ...base, stale: true })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('PLAN_STALE')
  })

  it('toplam uyuşmazlığı reddedilir', () => {
    const r = assertLaborWorkbookPlanSource({ ...base, laborAmountMinor: 90_000 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('PLAN_CATEGORY_TOTAL_MISMATCH')
  })

  it('pozitif tutar eşlenmemiş sütuna düşerse reddedilir', () => {
    const r = assertLaborWorkbookPlanSource({
      ...base, mapping: { bodywork: 'KAPORTA', paint: null } as Record<string, string | null>,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('PLAN_CATEGORY_COLUMN_UNMAPPED')
  })
})
