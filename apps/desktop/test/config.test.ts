import { describe, expect, it } from 'vitest'
import {
  DEFAULT_API_ORIGIN,
  DesktopConfigError,
  parseDesktopConfig,
} from '../src/main/config.js'

const defaults = { assetRoot: 'C:/hasarbotu/dist' }

describe('parseDesktopConfig', () => {
  it('boş ortamda loopback API ve efemer köprü portu ile varsayılana düşer', () => {
    const config = parseDesktopConfig({}, defaults)
    expect(config.apiOrigin).toBe(DEFAULT_API_ORIGIN)
    expect(config.assetRoot).toBe(defaults.assetRoot)
    // `0` = işletim sistemi boş port seçer; sabit port varsayılmaz.
    expect(config.bridgePort).toBe(0)
  })

  it('değeri origin biçimine indirger', () => {
    const config = parseDesktopConfig({ HASARBOTU_API_ORIGIN: 'https://api.ofis.example:8443' }, defaults)
    expect(config.apiOrigin).toBe('https://api.ofis.example:8443')
  })

  it('uzak API için düz http REDDEDİLİR; oturum çerezi ağda düz metin geçemez', () => {
    expect(() => parseDesktopConfig({ HASARBOTU_API_ORIGIN: 'http://192.168.1.40:3100' }, defaults))
      .toThrow(DesktopConfigError)
    // Loopback aynı değerde kabul edilir: kabuğun kendi köprüsü düz HTTP'dir.
    expect(parseDesktopConfig({ HASARBOTU_API_ORIGIN: 'http://127.0.0.1:3100' }, defaults).apiOrigin)
      .toBe('http://127.0.0.1:3100')
    expect(parseDesktopConfig({ HASARBOTU_API_ORIGIN: 'http://localhost:3100' }, defaults).apiOrigin)
      .toBe('http://localhost:3100')
  })

  it('http/https dışındaki şemaları reddeder', () => {
    for (const value of ['file:///C:/hasarbotu', 'ws://127.0.0.1:3100', 'javascript:alert(1)', 'not-a-url']) {
      expect(() => parseDesktopConfig({ HASARBOTU_API_ORIGIN: value }, defaults)).toThrow(DesktopConfigError)
    }
  })

  it('kimlik bilgisi, yol, sorgu veya fragment taşıyan değeri reddeder', () => {
    for (const value of [
      'http://kullanici:parola@127.0.0.1:3100',
      'http://127.0.0.1:3100/api',
      'http://127.0.0.1:3100/?x=1',
      'http://127.0.0.1:3100/#p',
    ]) {
      expect(() => parseDesktopConfig({ HASARBOTU_API_ORIGIN: value }, defaults)).toThrow(DesktopConfigError)
    }
  })

  it('hata mesajı alan adı ve kuralı taşır, ortam DEĞERİNİ taşımaz', () => {
    // Secret sızıntısına karşı repo genelindeki kural (`services/api/src/config.ts`).
    const secretish = 'https://kullanici:cok-gizli-parola@api.ofis.example'
    try {
      parseDesktopConfig({ HASARBOTU_API_ORIGIN: secretish }, defaults)
      expect.unreachable('geçersiz yapılandırma kabul edilmemeliydi')
    } catch (error) {
      expect(error).toBeInstanceOf(DesktopConfigError)
      const message = (error as DesktopConfigError).message
      expect(message).toContain('HASARBOTU_API_ORIGIN')
      expect(message).not.toContain('cok-gizli-parola')
      expect(message).not.toContain(secretish)
    }
  })

  it('köprü portunu yalnız açık tam sayı biçiminde kabul eder', () => {
    expect(parseDesktopConfig({ HASARBOTU_BRIDGE_PORT: '51234' }, defaults).bridgePort).toBe(51_234)
    for (const value of ['-1', '1e3', '0x10', ' 80', '65536', '80.5']) {
      expect(() => parseDesktopConfig({ HASARBOTU_BRIDGE_PORT: value }, defaults)).toThrow(DesktopConfigError)
    }
  })

  it('varlık kökü açıkça verilebilir', () => {
    const config = parseDesktopConfig({ HASARBOTU_ASSET_ROOT: 'D:/paket/ui' }, defaults)
    expect(config.assetRoot).toBe('D:/paket/ui')
  })
})
