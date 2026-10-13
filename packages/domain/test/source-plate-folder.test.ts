import { describe, expect, it } from 'vitest'
import { parseSourcePlateFolderName } from '../src/source-plate-folder.js'
describe('physical plate folder annotations', () => {
  it.each(['34ABC123', '34 ABC 123 - 2', '34ABC123(AVUKATLI)', '34ABC123 (AVUKATLI)', '34ABC123----SİGORTA', '34ABC123 ZURICH'])('recognizes %s without using annotations as vehicle data', name => {
    expect(parseSourcePlateFolderName(name)?.plate).toBe('34 ABC 123')
  })
  it.each(['DEĞER KAYBI', 'EKİM 2026', '--- KAPANANLAR', '34ABC123XYZ', '34ABC123 06DEF456', '34ABC123 - 06DEF456', '34ABC12345'])('rejects ambiguous or non-plate %s', name => {
    expect(parseSourcePlateFolderName(name)).toBeNull()
  })
})
