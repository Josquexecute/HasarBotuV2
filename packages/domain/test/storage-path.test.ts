import { describe, expect, it } from 'vitest'
import {
  parseRelativePath,
  parseStorageLocation,
  parseStorageRootKey,
} from '../src/index.js'

describe('parseStorageRootKey', () => {
  it('küçük harf slug kabul eder', () => {
    expect(parseStorageRootKey('baran-global-primary')).toEqual({ ok: true, value: 'baran-global-primary' })
    expect(parseStorageRootKey('root1')).toMatchObject({ ok: true })
  })

  it('boş, biçimsiz veya çok uzun anahtarı reddeder', () => {
    expect(parseStorageRootKey('').ok).toBe(false)
    expect(parseStorageRootKey('Baran_Global').ok).toBe(false) // büyük harf + alt çizgi
    expect(parseStorageRootKey('a/b').ok).toBe(false)
    expect(parseStorageRootKey('-lead').ok).toBe(false)
    expect(parseStorageRootKey('a'.repeat(65)).ok).toBe(false)
    expect(parseStorageRootKey(42).ok).toBe(false)
  })
})

describe('parseRelativePath — geçerli yollar', () => {
  it('POSIX göreli yolu (Türkçe ad ve iç boşluk dahil) kabul eder', () => {
    const cases = [
      '2026/Temmuz 2026/34MPA764/EVRAK/ruhsat__docv_01.pdf',
      '2026/Temmuz 2026/34MPA764 - 2/HASAR/hasar_001__photo_01.jpg',
      '2026/KAPALI TEMMUZ 2026/34MPA764/DEĞER KAYBI/deger_kaybi__docv_02.pdf',
      'EVRAK',
    ]
    for (const value of cases) {
      expect(parseRelativePath(value)).toMatchObject({ ok: true, value })
    }
  })
})

describe('parseRelativePath — güvenlik reddi (traversal ve mutlak yol)', () => {
  const NUL = String.fromCharCode(0)
  const C1F = String.fromCharCode(31)
  const DEL = String.fromCharCode(127)

  const rejected: [string, string][] = [
    ['..', 'traversal tek segment'],
    ['a/../b', 'ortada traversal'],
    ['../secret', 'baştan traversal'],
    ['a/b/..', 'sonda traversal'],
    ['/etc/passwd', 'POSIX absolute'],
    ['C:/Windows', 'sürücü ön eki'],
    [`P:${String.fromCharCode(92)}BARAN`, 'sürücü + backslash'],
    [`${String.fromCharCode(92)}${String.fromCharCode(92)}server${String.fromCharCode(92)}share`, 'UNC'],
    [`a${String.fromCharCode(92)}b`, 'backslash ayraç'],
    ['a//b', 'çift ayraç'],
    ['a/b/', 'sonda ayraç'],
    ['/leading', 'baştan ayraç'],
    ['a/./b', 'geçerli-dizin segmenti'],
    ['foo<bar', 'yasak karakter <'],
    ['foo:bar', 'yasak karakter : (ADS)'],
    ['foo|bar', 'yasak karakter |'],
    ['foo?bar', 'yasak karakter ?'],
    ['foo*bar', 'yasak karakter *'],
    [`a${NUL}b`, 'null byte'],
    [`a${C1F}b`, 'kontrol karakteri'],
    [`a${DEL}b`, 'DEL karakteri'],
    ['dir/con', 'ayrılmış aygıt adı CON'],
    ['dir/NUL.txt', 'ayrılmış aygıt adı uzantılı'],
    ['dir/lpt1', 'ayrılmış aygıt adı LPT1'],
    ['trailing./file', 'segment sonu nokta'],
    ['trailing /file', 'segment sonu boşluk'],
    [' leading/file', 'segment başı boşluk'],
    ['', 'boş'],
  ]

  it.each(rejected)('reddeder: %s (%s)', (value) => {
    expect(parseRelativePath(value).ok).toBe(false)
  })

  it('traversal reddi hata kodu invalid_format taşır', () => {
    const result = parseRelativePath('a/../b')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid_format')
  })

  it('string olmayan ve aşırı uzun değeri reddeder', () => {
    expect(parseRelativePath(123).ok).toBe(false)
    expect(parseRelativePath('a/'.repeat(220)).ok).toBe(false)
  })
})

describe('parseStorageLocation', () => {
  it('rootKey + göreli yolu birlikte doğrular', () => {
    expect(parseStorageLocation('baran-global-primary', '2026/EVRAK/x.pdf')).toMatchObject({
      ok: true,
      value: { rootKey: 'baran-global-primary', relativePath: '2026/EVRAK/x.pdf' },
    })
  })

  it('yol güvensizse veya rootKey biçimsizse reddeder', () => {
    expect(parseStorageLocation('baran-global-primary', '../escape').ok).toBe(false)
    expect(parseStorageLocation('BAD KEY', '2026/x.pdf').ok).toBe(false)
  })
})
