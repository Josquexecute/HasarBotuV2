import { describe, expect, it } from 'vitest'
import { matchSourceFolderInsurer, parseSourcePlateFolderName } from '../src/source-plate-folder.js'
describe('physical plate folder annotations', () => {
  it.each(['34ABC123', '34 ABC 123 - 2', '34ABC123(AVUKATLI)', '34ABC123 (AVUKATLI)', '34ABC123----SİGORTA', '34ABC123 ZURICH', '34ABC123-AXA SİGORTA', '34ABC123_ALLIANZ', '34ABC123–ZURICH'])('recognizes %s without using annotations as vehicle data', name => {
    expect(parseSourcePlateFolderName(name)?.plate).toBe('34 ABC 123')
  })
  it('matches the insurer annotation without merging cases by plate', () => {
    const insurers = [{ id: 'axa', name: 'AXA Sigorta' }, { id: 'allianz', name: 'Allianz Sigorta' }]
    expect(matchSourceFolderInsurer('34ABC123-AXA SİGORTA', insurers)?.id).toBe('axa')
    expect(matchSourceFolderInsurer('34ABC123 ALLIANZ', insurers)?.id).toBe('allianz')
    expect(matchSourceFolderInsurer('34ABC123 AXA ALLIANZ', insurers)).toBeNull()
    expect(matchSourceFolderInsurer('34ABC123 MAKSAT', insurers)).toBeNull()
    expect(matchSourceFolderInsurer('AXA SİGORTA - 123456 - 34ABC123 GİRİŞ YAPILDI', insurers)?.id).toBe('axa')
    expect(matchSourceFolderInsurer('AXA SİGORTA ALLIANZ - 123456 - 34ABC123', insurers)).toBeNull()
  })
  it.each([
    'ANADOLU SİGORTA - 123456-1 - 34 ABC 123 GİRİŞ YAPILDI',
    'UNICO SİGORTA--123456-- 34ABC123',
    'ŞEKER SİGORTA 123456-- 34 ABC 123',
    'ZURİCH SİGIORTA--123456-- 34 ABC 123',
  ])('recognizes an insurer-prefixed folder with one unambiguous plate: %s', name => {
    expect(parseSourcePlateFolderName(name)?.plate).toBe('34 ABC 123')
  })
  it.each([
    'ANADOLU SİGORTA - 34ABC123 - 06DEF456',
    'ANADOLU SİGORTA - 123456 - 34ABC12345',
    'ARŞİV - 34ABC123',
    'ANADOLU SİGORTA - 34ABC123XYZ',
  ])('rejects ambiguous insurer labels and unrelated prefixes: %s', name => {
    expect(parseSourcePlateFolderName(name)).toBeNull()
  })
  it.each(['DEĞER KAYBI', 'EKİM 2026', '--- KAPANANLAR', '34ABC123XYZ', '34ABC123 06DEF456', '34ABC123 - 06DEF456', '34ABC12345'])('rejects ambiguous or non-plate %s', name => {
    expect(parseSourcePlateFolderName(name)).toBeNull()
  })
})
