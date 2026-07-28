import { describe, expect, it } from 'vitest'
import {
  FALLBACK_DOWNLOAD_FILENAME,
  MAXIMUM_DOWNLOAD_FILENAME_LENGTH,
  resolveDownload,
  sanitizeDownloadFilename,
} from '../src/main/downloads.js'

const SHELL_ORIGIN = 'http://127.0.0.1:51234'

describe('resolveDownload', () => {
  it('UI\'ın gerçek indirme biçimine izin verir: kabuk origin\'i üzerindeki blob', () => {
    // Rapor PDF'i ve envanter Excel'i `URL.createObjectURL` ile indirilir.
    expect(resolveDownload(`blob:${SHELL_ORIGIN}/6f0a1f5c-0000-4000-8000-000000000001`, SHELL_ORIGIN))
      .toEqual({ action: 'allow' })
  })

  it('kabuk origin\'inden doğrudan indirmeye izin verir', () => {
    expect(resolveDownload(`${SHELL_ORIGIN}/api/v1/cases/export.xlsx`, SHELL_ORIGIN))
      .toEqual({ action: 'allow' })
  })

  it('yabancı origin\'den gelen indirmeyi iptal eder', () => {
    for (const url of [
      'https://ornek.gecersiz.example/kotu.exe',
      'blob:https://ornek.gecersiz.example/6f0a1f5c',
      // Port farkı ayrı origin'dir.
      'http://127.0.0.1:51235/rapor.pdf',
      'blob:http://127.0.0.1:51235/6f0a1f5c',
      // `localhost` ile `127.0.0.1` ayrı origin'lerdir.
      'http://localhost:51234/rapor.pdf',
    ]) {
      expect(resolveDownload(url, SHELL_ORIGIN)).toEqual({ action: 'cancel', reason: 'foreign_origin' })
    }
  })

  it('http(s) dışındaki şemaları iptal eder', () => {
    for (const url of ['file:///C:/Windows/System32/calc.exe', 'ftp://sunucu/dosya', 'data:text/plain,x']) {
      expect(resolveDownload(url, SHELL_ORIGIN)).toEqual({ action: 'cancel', reason: 'unsupported_scheme' })
    }
  })

  it('çözümlenemeyen değeri iptal eder', () => {
    expect(resolveDownload('bozuk url', SHELL_ORIGIN)).toEqual({ action: 'cancel', reason: 'not_a_url' })
    expect(resolveDownload('blob:', SHELL_ORIGIN)).toEqual({ action: 'cancel', reason: 'not_a_url' })
  })
})

describe('sanitizeDownloadFilename', () => {
  it('gerçek rapor adlarını olduğu gibi korur', () => {
    // Türkçe karakterler ve tarih/dosya numarası içeren adlar bozulmamalı.
    for (const name of [
      'deger-kaybi-raporu-2026-144.pdf',
      'Dosya Envanteri 2026-07-28.xlsx',
      'Değer Kaybı Raporu — 34MPA764.pdf',
    ]) {
      expect(sanitizeDownloadFilename(name)).toBe(name)
    }
  })

  it('yol ayırıcılarını ve traversal denemesini tek bir ADA indirger', () => {
    // Sonuç "temiz" bir ada dönüştürülmez; yalnız zararsız kılınır. Sessizce
    // güzelleştirmek, kullanıcıya gelmeyen bir adı gelmiş gibi gösterirdi.
    expect(sanitizeDownloadFilename('../../gizli.pdf')).toBe('_.._gizli.pdf')
    expect(sanitizeDownloadFilename('..\\..\\gizli.pdf')).toBe('_.._gizli.pdf')
    expect(sanitizeDownloadFilename('C:\\Windows\\System32\\rapor.pdf')).toBe('C__Windows_System32_rapor.pdf')
    expect(sanitizeDownloadFilename('/etc/passwd')).toBe('_etc_passwd')
  })

  it('Windows\'ta yasak karakterleri değiştirir', () => {
    expect(sanitizeDownloadFilename('rapor<>:"|?*.pdf')).toBe('rapor_______.pdf')
  })

  it('kontrol karakterlerini düşürür', () => {
    expect(sanitizeDownloadFilename('ra\u0000po\u001fr\u007f.pdf')).toBe('rapor.pdf')
    // `content-disposition` üzerinden başlık enjeksiyonu denemesi.
    expect(sanitizeDownloadFilename('rapor.pdf\r\nX-Injected: 1')).toBe('rapor.pdfX-Injected_ 1')
  })

  it('baştaki ve sondaki nokta/boşlukları temizler', () => {
    // Windows sondaki nokta ve boşluğu sessizce kırpar; ad beklenmedik olur.
    expect(sanitizeDownloadFilename('  rapor.pdf  ')).toBe('rapor.pdf')
    expect(sanitizeDownloadFilename('.gizli')).toBe('gizli')
    expect(sanitizeDownloadFilename('rapor.pdf.')).toBe('rapor.pdf')
    expect(sanitizeDownloadFilename('..')).toBe(FALLBACK_DOWNLOAD_FILENAME)
    expect(sanitizeDownloadFilename('   ')).toBe(FALLBACK_DOWNLOAD_FILENAME)
    expect(sanitizeDownloadFilename('')).toBe(FALLBACK_DOWNLOAD_FILENAME)
  })

  it('Windows ayrılmış cihaz adlarını etkisizleştirir', () => {
    expect(sanitizeDownloadFilename('CON.pdf')).toBe('_CON.pdf')
    expect(sanitizeDownloadFilename('nul')).toBe('_nul')
    expect(sanitizeDownloadFilename('COM1.xlsx')).toBe('_COM1.xlsx')
    // Ayrılmış AD değil, yalnız ayrılmış adla başlayan bir ad: dokunulmaz.
    expect(sanitizeDownloadFilename('CONTROL.pdf')).toBe('CONTROL.pdf')
  })

  it('uzunluğu sınırlar ve UZANTIYI korur', () => {
    const result = sanitizeDownloadFilename(`${'a'.repeat(500)}.xlsx`)
    expect(result.length).toBe(MAXIMUM_DOWNLOAD_FILENAME_LENGTH)
    // Uzantısı kesilmiş bir ad kullanıcıyı dosya türü konusunda yanıltır.
    expect(result.endsWith('.xlsx')).toBe(true)
  })

  it('sonuç hiçbir zaman yol ayırıcısı içermez', () => {
    for (const raw of ['../../x', 'a/b\\c', 'C:/x/y.pdf', '\\\\sunucu\\paylasim\\x.pdf']) {
      const result = sanitizeDownloadFilename(raw)
      expect(result).not.toContain('/')
      expect(result).not.toContain('\\')
      expect(result.length).toBeGreaterThan(0)
    }
  })
})
