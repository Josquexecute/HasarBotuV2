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
  it('matches canonical names only when unique', () => {
    expect(matchEksistReference('ALLİANZ SİGORTA ANONİM ŞİRKETİ', [{ id: '1', name: 'Allianz Sigorta A.Ş.' }], true)).toBe('1')
    expect(matchEksistReference('Ali Taş', [{ id: '1', name: 'Ali T' }])).toBeNull()
    expect(matchEksistReference('Ali', [{ id: '1', name: 'Ali' }, { id: '2', name: 'ALİ' }])).toBeNull()
    expect(matchEksistReference('Ali Veli', [{ id: '1', name: 'Ali' }])).toBeNull()
  })
})
