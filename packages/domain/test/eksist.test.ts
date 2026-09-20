import { describe, expect, it } from 'vitest'
import { parseEksist, matchEksistReference } from '../src/eksist.js'

describe('Eksist shared mapping', () => {
  it('maps labels with clipboard whitespace and keeps distinct identities apart', () => {
    const result = parseEksist('Talep İşlem Ref No:\n\n162111\nÜrün: Trafik\nPlaka: 034 - TR2491\nHasar Dosya No: 2026 T 47308\nHasar Zamanı: 17/09/2026 00:00\nSigortalı TC Kimlik No: 30***62\nSigortalı Ad/Ünvan: ALİ\nPoliçe Vadesi: 2026 - 2027\nMarka: VW\nAraç Tipi: PASSAT\nModel Yılı: 2014\nAraç Tarife Grubu: OTOMOBİL\nMotor No: CAYZ46629\nŞasi No: WVWZZZ3CZEE144172\nEksper Atama Tarihi: 2026-09-18')
    expect(result).toMatchObject({ reference: '162111', plate: '34 TR 2491', caseType: 'traffic', lossDate: '2026-09-17', claimNumber: '2026 T 47308', brand: 'VW', model: 'PASSAT', modelYear: '2014', vehicleClass: 'passenger_car' })
    expect(result.fields).toMatchObject({ sigortalitckimlikno: '30***62', policevadesi: '2026 - 2027', motorno: 'CAYZ46629', sasino: 'WVWZZZ3CZEE144172', eksperatamatarihi: '2026-09-18' })
    for (const field of ['notificationDate', 'notificationFormNumber', 'owner', 'engineCode', 'chassisPrefix']) expect(result).not.toHaveProperty(field)
  })
  it('does not guess absent fields or overwrite conflicting values', () => {
    expect(parseEksist('Ürün: Diğer\nPlaka: 34 AA 123\nPlaka: 06 BB 456')).toMatchObject({ reference: '', caseType: null, conflicts: ['plaka'] })
    expect(parseEksist('')).toMatchObject({ lossDate: '', modelYear: '', caseType: null })
  })
  it('preserves assignment timestamps and complete vehicle identifiers without truncation', () => {
    const result = parseEksist('Eksper Atama Tarihi: 20.09.2026 08:41:33\nEksper Ad-Soyad: ÖRNEK EKSPER\nLevha No: E123\nTüzel Eksper Levha No: T456\nEksper Atanacak Araç Bilgileri\nPlaka: 034 - TEST201\nMarka: VW\nAraç Tipi: PASSAT 1.6 TDI\nModel Yılı: 2014\nAraç Tarife Grubu: OTOMOBİL\nMotor No: CAYZ46629\nŞasi No: WVWZZZ3CZEE144172\nRenk: BEYAZ\nYakıt Tipi: DİZEL\nVites Tipi: OTOMATİK\nSilindir Hacmi: 1598\nMotor Gücü: 77 KW\nKoltuk Sayısı: 5\nİlk Tescil Tarihi: 01.02.2014')
    expect(result).toMatchObject({ assignmentDate: '2026-09-20', assignmentDateText: '20.09.2026 08:41:33', expert: 'ÖRNEK EKSPER', expertLicenseNumber: 'E123', corporateExpertLicenseNumber: 'T456', engineNumber: 'CAYZ46629', chassisNumber: 'WVWZZZ3CZEE144172' })
    expect(result.vehicleFields).toMatchObject({ 'Şasi No': 'WVWZZZ3CZEE144172', 'Motor No': 'CAYZ46629', 'Yakıt Tipi': 'DİZEL', 'Vites Tipi': 'OTOMATİK', 'Silindir Hacmi': '1598', 'Motor Gücü': '77 KW', 'Koltuk Sayısı': '5', 'İlk Tescil Tarihi': '01.02.2014' })
    expect(parseEksist('Eksper Atama Tarihi: 31.02.2026 10:00').assignmentDate).toBe('')
  })
  it('matches canonical names only when unique', () => {
    expect(matchEksistReference('ALLİANZ SİGORTA ANONİM ŞİRKETİ', [{ id: '1', name: 'Allianz Sigorta A.Ş.' }], true)).toBe('1')
    expect(matchEksistReference('Ali Taş', [{ id: '1', name: 'Ali T' }])).toBeNull()
    expect(matchEksistReference('Ali', [{ id: '1', name: 'Ali' }, { id: '2', name: 'ALİ' }])).toBeNull()
    expect(matchEksistReference('Ali Veli', [{ id: '1', name: 'Ali' }])).toBeNull()
  })
})
