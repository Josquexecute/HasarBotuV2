import { describe, expect, it } from 'vitest'
import {
  extractExtension,
  fileCategoryOf,
  isMimeExtensionConsistent,
  parseOriginalFileName,
  parseSha256Hex,
  toSafeDisplayName,
} from '../src/index.js'

describe('parseOriginalFileName', () => {
  it('güvenli dosya adını kabul eder (Türkçe ve boşluk dahil)', () => {
    expect(parseOriginalFileName('ruhsat ön yüz.pdf')).toMatchObject({ ok: true, value: 'ruhsat ön yüz.pdf' })
    expect(parseOriginalFileName('hasar_001.jpg')).toMatchObject({ ok: true })
  })

  it('tehlikeli adları reddeder', () => {
    const bad = [
      '../etc/passwd',
      'a/b.pdf',
      `a${String.fromCharCode(92)}b.pdf`,
      'C:foo.pdf',
      'foo<bar.pdf',
      'foo|bar.pdf',
      `evil${String.fromCharCode(0)}.pdf`,
      'con.pdf',
      'NUL',
      'trailingdot.',
      '',
      '.',
      '..',
    ]
    for (const value of bad) expect(parseOriginalFileName(value).ok, value).toBe(false)
  })

  it('aşırı uzun adı reddeder', () => {
    expect(parseOriginalFileName(`${'a'.repeat(256)}.pdf`).ok).toBe(false)
  })
})

describe('extractExtension + toSafeDisplayName', () => {
  it('uzantıyı küçük harf noktasız döndürür', () => {
    expect(extractExtension('Ruhsat.PDF')).toBe('pdf')
    expect(extractExtension('foto.JPEG')).toBe('jpeg')
    expect(extractExtension('uzantisiz')).toBeNull()
    expect(extractExtension('.gizli')).toBeNull()
  })

  it('gösterim adını güvenli hale getirir', () => {
    expect(toSafeDisplayName('a/b:c*.pdf')).toBe('a_b_c_.pdf')
    expect(toSafeDisplayName('   ')).toBe('dosya')
    expect(toSafeDisplayName('ruhsat.pdf')).toBe('ruhsat.pdf')
  })
})

describe('isMimeExtensionConsistent + fileCategoryOf', () => {
  it('tutarlı uzantı/MIME kabul, uyuşmazlık ret', () => {
    expect(isMimeExtensionConsistent('pdf', 'application/pdf')).toBe(true)
    expect(isMimeExtensionConsistent('jpg', 'image/jpeg')).toBe(true)
    expect(isMimeExtensionConsistent('png', 'image/jpeg')).toBe(false) // uyuşmazlık
    expect(isMimeExtensionConsistent('exe', 'application/octet-stream')).toBe(false) // izinsiz
    expect(isMimeExtensionConsistent(null, 'application/pdf')).toBe(false)
  })

  it('kategori döndürür', () => {
    expect(fileCategoryOf('pdf')).toBe('document')
    expect(fileCategoryOf('jpg')).toBe('photo')
    expect(fileCategoryOf('exe')).toBeNull()
  })
})

describe('parseSha256Hex', () => {
  it('64 hex kabul eder (küçük harfe normalize)', () => {
    const hex = 'A'.repeat(64)
    expect(parseSha256Hex(hex)).toMatchObject({ ok: true, value: 'a'.repeat(64) })
  })

  it('yanlış uzunluk veya hex olmayanı reddeder', () => {
    expect(parseSha256Hex('abc').ok).toBe(false)
    expect(parseSha256Hex(`${'z'.repeat(64)}`).ok).toBe(false)
    expect(parseSha256Hex(123).ok).toBe(false)
  })
})
