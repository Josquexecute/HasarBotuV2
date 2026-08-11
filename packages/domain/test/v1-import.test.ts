import { describe, expect, it } from 'vitest'
import {
  decideV1FieldBackfill,
  deriveV1ClosedState,
  mapV1ClaimType,
  parseV1PlateFolderName,
} from '../src/v1-import.js'

describe('parseV1PlateFolderName', () => {
  it('duz plaka klasor adini kabul eder', () => {
    const result = parseV1PlateFolderName('34BKU210')
    expect(result).not.toBeNull()
    expect(result?.plate).toBe('34 BKU 210')
    expect(result?.suffix).toBeNull()
  })

  it('AGENTS.md tekrarli-plaka sonekini (" - 2") ayristirir', () => {
    const result = parseV1PlateFolderName('34MPA764 - 2')
    expect(result).not.toBeNull()
    expect(result?.plate).toBe('34 MPA 764')
    expect(result?.suffix).toBe('2')
  })

  it('serbest metin sonekini de ayristirir ("- AGIR HASARLI" gercek ornek)', () => {
    const result = parseV1PlateFolderName('72ACV940 - AGIR HASARLI')
    expect(result).not.toBeNull()
    expect(result?.plate).toBe('72 ACV 940')
    expect(result?.suffix).toBe('AGIR HASARLI')
  })

  it('gecersiz plaka govdesi olan klasor adinda null doner (TAHMIN etmez)', () => {
    expect(parseV1PlateFolderName('DEĞER KAYBI')).toBeNull()
    expect(parseV1PlateFolderName('_HASARBOTU_OFFICE')).toBeNull()
    expect(parseV1PlateFolderName('')).toBeNull()
  })
})

describe('mapV1ClaimType', () => {
  it('trafik/kasko esler', () => {
    expect(mapV1ClaimType('trafik')).toBe('traffic')
    expect(mapV1ClaimType('kasko')).toBe('casco')
  })

  it('buyuk/kucuk harf ve bosluk toleransli', () => {
    expect(mapV1ClaimType('  Trafik  ')).toBe('traffic')
    expect(mapV1ClaimType('KASKO')).toBe('casco')
  })

  it('bilinmeyen/bos/gecersiz deger HER ZAMAN unknown doner, asla varsayilan trafik/kasko SECILMEZ', () => {
    expect(mapV1ClaimType('unknown')).toBe('unknown')
    expect(mapV1ClaimType('')).toBe('unknown')
    expect(mapV1ClaimType(null)).toBe('unknown')
    expect(mapV1ClaimType(undefined)).toBe('unknown')
    expect(mapV1ClaimType(42)).toBe('unknown')
    expect(mapV1ClaimType('trafik ')).toBe('traffic') // trim edilir
    expect(mapV1ClaimType('gecersiz-deger')).toBe('unknown')
  })
})

describe('deriveV1ClosedState', () => {
  it('uc sinyal de acik ise acik, celiskisiz doner', () => {
    const result = deriveV1ClosedState({
      physicallyUnderKapali: false, isClosedFolderFlag: false, kapaliMi: false,
    })
    expect(result).toMatchObject({ closed: false, conflicting: false })
  })

  it('uc sinyal de kapali ise kapali, celiskisiz doner', () => {
    const result = deriveV1ClosedState({
      physicallyUnderKapali: true, isClosedFolderFlag: true, kapaliMi: true,
    })
    expect(result).toMatchObject({ closed: true, conflicting: false })
  })

  it('GERCEK ornek: fiziksel KAPALI klasor + kapaliMi:true ama isClosedFolderFlag:false -- celiskili ama fiziksel/kapaliMi kapali diyor', () => {
    // Gercek production dosyasinda gozlenen: 2026/Temmuz 2026/KAPALI TEMMUZ
    // 2026/34MPM953 klasorunde caseIdentity.isClosedFolder=false, status.kapaliMi=true.
    const result = deriveV1ClosedState({
      physicallyUnderKapali: true, isClosedFolderFlag: false, kapaliMi: true,
    })
    expect(result.closed).toBe(true)
    expect(result.conflicting).toBe(true)
  })

  it('yalniz isClosedFolderFlag kapali derse ama fiziksel konum ve kapaliMi acik derse -- acik kabul edilir (fiziksel konum en guvenilir), celiski isaretlenir', () => {
    const result = deriveV1ClosedState({
      physicallyUnderKapali: false, isClosedFolderFlag: true, kapaliMi: false,
    })
    expect(result.closed).toBe(false)
    expect(result.conflicting).toBe(true)
  })

  it('sinyal eksikse (null) yalniz mevcut sinyallerden karar verir', () => {
    const result = deriveV1ClosedState({
      physicallyUnderKapali: false, isClosedFolderFlag: null, kapaliMi: null,
    })
    expect(result).toMatchObject({ closed: false, conflicting: false })
  })
})

describe('decideV1FieldBackfill', () => {
  it('V1 kaynaginda deger yoksa no_source_value', () => {
    expect(decideV1FieldBackfill(null, '')).toMatchObject({ kind: 'no_source_value' })
    expect(decideV1FieldBackfill('mevcut', null)).toMatchObject({ kind: 'no_source_value' })
  })

  it('V2 alani BOS ve V1de gercek deger varsa safe_backfill', () => {
    const result = decideV1FieldBackfill(null, 'Ömer Faruk İşleyen')
    expect(result).toMatchObject({ kind: 'safe_backfill', value: 'Ömer Faruk İşleyen' })
  })

  it('V2 ve V1 degeri zaten ayniysa already_matches (no-op)', () => {
    expect(decideV1FieldBackfill('Ömer Faruk İşleyen', 'Ömer Faruk İşleyen')).toMatchObject({ kind: 'already_matches' })
  })

  it('V2 alaninda kullanicinin SONRADAN girdigi FARKLI bir deger varsa conflict -- KOR EZILMEZ', () => {
    const result = decideV1FieldBackfill('Kullanicinin V2de girdigi deger', 'V1 degeri')
    expect(result).toMatchObject({
      kind: 'conflict', currentValue: 'Kullanicinin V2de girdigi deger', sourceValue: 'V1 degeri',
    })
  })
})
