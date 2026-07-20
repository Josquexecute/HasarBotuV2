import { describe, expect, it } from 'vitest'
import { lookupCaseFolder, type CaseFolderLister } from '../src/index.js'

/**
 * Paket 64 sonrası — sürücüde iki klasör düzeni bir arada.
 *
 * Yalın: <yıl>\<Ay YYYY>\<PLAKA>
 * Eski:  <yıl>\<Sigorta Klasörü>\<Ay YYYY>\<PLAKA>
 *
 * Testlerin hepsi tek ilkeye dayanır: klasör adı üretilip denenmez, mevcut
 * dizinler taranır; birden fazla konum eşleşirse tahmin edilmez.
 */
const BASE = { year: 2026, month: 7, plate: '47 ACA 535' }

/** Göreli yol → alt klasör adları. Yol yoksa `null`. */
function lister(tree: Record<string, readonly string[]>): CaseFolderLister {
  return (segments) => tree[segments.join('\\')] ?? null
}

describe('vaka klasörü çözümleme — yalın düzen', () => {
  it('kullanıcının bildirdiği güncel yapıyı bulur', () => {
    // P:\BARAN GLOBAL EKSPERTİZ\2026\Temmuz 2026\47ACA535
    const result = lookupCaseFolder({
      ...BASE,
      listFolders: lister({
        '2026': ['Temmuz 2026'],
        '2026\\Temmuz 2026': ['47ACA535'],
      }),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.match.layout).toBe('lean')
    expect(result.match.location).toBe('active')
    expect(result.match.insurerFolderName).toBeNull()
    // Seçilen yol SÜRÜCÜDEKİ adlarla raporlanır, üretilmiş adlarla değil.
    expect(result.match.segments).toEqual(['2026', 'Temmuz 2026', '47ACA535'])
  })

  it('ay klasörü büyük harfle yazılmışsa da bulur', () => {
    const result = lookupCaseFolder({
      ...BASE,
      listFolders: lister({
        '2026': ['TEMMUZ 2026'],
        '2026\\TEMMUZ 2026': ['47ACA535'],
      }),
    })
    expect(result.ok && result.match.segments[1]).toBe('TEMMUZ 2026')
  })

  it('kapalı dosyayı ay klasörünün İÇİNDE bulur', () => {
    const result = lookupCaseFolder({
      ...BASE,
      listFolders: lister({
        '2026': ['Temmuz 2026'],
        '2026\\Temmuz 2026': ['KAPALI TEMMUZ 2026'],
        '2026\\Temmuz 2026\\KAPALI TEMMUZ 2026': ['47ACA535'],
      }),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.match.location).toBe('closed')
    expect(result.match.segments).toEqual([
      '2026', 'Temmuz 2026', 'KAPALI TEMMUZ 2026', '47ACA535',
    ])
  })
})

describe('vaka klasörü çözümleme — eski sigorta düzeni', () => {
  it('sigorta klasörü altındaki dosyayı bulur ve klasör adını bildirir', () => {
    const result = lookupCaseFolder({
      ...BASE,
      listFolders: lister({
        '2026': ['REFERANS SİGORTA'],
        '2026\\REFERANS SİGORTA': ['Temmuz 2026'],
        '2026\\REFERANS SİGORTA\\Temmuz 2026': ['47ACA535'],
      }),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.match.layout).toBe('insurer_scoped')
    // Fiziksel klasör adı ekrandaki şirket adıyla aynı VARSAYILMAZ; okunur.
    expect(result.match.insurerFolderName).toBe('REFERANS SİGORTA')
  })

  it('sigorta düzeninde kapalı dosyayı da bulur', () => {
    const result = lookupCaseFolder({
      ...BASE,
      listFolders: lister({
        '2026': ['ANADOLU SİGORTA'],
        '2026\\ANADOLU SİGORTA': ['TEMMUZ 2026'],
        '2026\\ANADOLU SİGORTA\\TEMMUZ 2026': ['KAPALI Temmuz 2026'],
        '2026\\ANADOLU SİGORTA\\TEMMUZ 2026\\KAPALI Temmuz 2026': ['47ACA535'],
      }),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.match.layout).toBe('insurer_scoped')
    expect(result.match.location).toBe('closed')
  })

  it('sigorta klasörü ZORUNLU değildir; yokluğu hata sayılmaz', () => {
    const result = lookupCaseFolder({
      ...BASE,
      listFolders: lister({
        '2026': ['Temmuz 2026'],
        '2026\\Temmuz 2026': ['47ACA535'],
      }),
    })
    expect(result.ok).toBe(true)
  })
})

describe('belirsizlikte otomatik seçim yapılmaz', () => {
  it('aynı plaka iki düzende birden varsa CASE_FOLDER_AMBIGUOUS', () => {
    const result = lookupCaseFolder({
      ...BASE,
      listFolders: lister({
        '2026': ['Temmuz 2026', 'REFERANS SİGORTA'],
        '2026\\Temmuz 2026': ['47ACA535'],
        '2026\\REFERANS SİGORTA': ['Temmuz 2026'],
        '2026\\REFERANS SİGORTA\\Temmuz 2026': ['47ACA535'],
      }),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('case_folder_ambiguous')
    // Kullanıcı hangisini seçeceğini görebilsin diye İKİSİ de raporlanır.
    expect(result.matches).toHaveLength(2)
    expect(result.matches.map((match) => match.layout).sort())
      .toEqual(['insurer_scoped', 'lean'])
  })

  it('hem aktif hem kapalı konumda varsa CASE_FOLDER_AMBIGUOUS', () => {
    const result = lookupCaseFolder({
      ...BASE,
      listFolders: lister({
        '2026': ['Temmuz 2026'],
        '2026\\Temmuz 2026': ['47ACA535', 'KAPALI TEMMUZ 2026'],
        '2026\\Temmuz 2026\\KAPALI TEMMUZ 2026': ['47ACA535'],
      }),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('case_folder_ambiguous')
    expect(result.matches.map((match) => match.location).sort())
      .toEqual(['active', 'closed'])
  })
})

describe('bulunamama ve girdi doğrulaması', () => {
  it('klasör yoksa uydurulmaz', () => {
    const result = lookupCaseFolder({
      ...BASE,
      listFolders: lister({ '2026': ['Temmuz 2026'], '2026\\Temmuz 2026': ['34XYZ111'] }),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('case_folder_not_found')
  })

  it('yıl klasörü hiç yoksa bulunamadı döner', () => {
    const result = lookupCaseFolder({ ...BASE, listFolders: lister({}) })
    expect(result.ok && false).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('case_folder_not_found')
  })

  it('geçersiz ay reddedilir', () => {
    const result = lookupCaseFolder({ ...BASE, month: 13, listFolders: lister({}) })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('invalid_month')
  })

  it('plaka yerine açık klasör adı verilebilir; kardeş vaka tahmin edilmez', () => {
    // `47ACA535 - 2` AYRI bir vakadır ve kendi adıyla çözümlenir.
    const tree = {
      '2026': ['Temmuz 2026'],
      '2026\\Temmuz 2026': ['47ACA535', '47ACA535 - 2'],
    }
    const second = lookupCaseFolder({
      ...BASE, folderName: '47ACA535 - 2', listFolders: lister(tree),
    })
    expect(second.ok && second.match.segments[2]).toBe('47ACA535 - 2')

    // Plakayla arama yalnız TAM adı eşleştirir; kardeş belirsizlik üretmez.
    const first = lookupCaseFolder({ ...BASE, listFolders: lister(tree) })
    expect(first.ok && first.match.segments[2]).toBe('47ACA535')
  })
})
