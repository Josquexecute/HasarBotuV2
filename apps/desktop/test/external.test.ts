import { describe, expect, it } from 'vitest'
import { TRAFFIC_VALUE_LOSS_RULE_SOURCES } from '@hasarbotu/domain'
import {
  EXTERNAL_HOST_ALLOWLIST,
  MAXIMUM_EXTERNAL_URL_LENGTH,
  resolveExternalOpen,
} from '../src/main/external.js'

describe('resolveExternalOpen — allowlist', () => {
  it('Gmail compose bağlantısını açar', () => {
    // `src/data/emailDraftPort.ts` → `buildGmailWebComposeUrl` ile aynı biçim.
    // UI kaynağı bu paketten import EDİLMEZ (paket sınırı korunur); bunun
    // yerine üretilen biçimin kendisi doğrulanır.
    const composeUrl = 'https://mail.google.com/mail/?view=cm&fs=1&tf=1'
      + '&to=eksper%40firma.example&su=Dosya%202026%2F144&body=Say%C4%B1n%20yetkili'
    expect(resolveExternalOpen(composeUrl).action).toBe('open-external')
  })

  it('Değer Kaybı kural kaynaklarının GERÇEK mevzuat bağlantılarını açar', () => {
    // `packages/domain` içindeki gerçek kaynak listesi; sabit kopya değil.
    expect(TRAFFIC_VALUE_LOSS_RULE_SOURCES.length).toBeGreaterThan(0)
    for (const source of TRAFFIC_VALUE_LOSS_RULE_SOURCES) {
      expect(resolveExternalOpen(source.url).action).toBe('open-external')
    }
  })

  it('allowlist dışındaki host\'u reddeder', () => {
    for (const url of [
      'https://ornek.gecersiz.example/',
      'https://google.com/',
      // Alt alan adı ayrı host'tur; allowlist önek eşleşmesi yapmaz.
      'https://kotu.mail.google.com/',
      // Benzeyen ama farklı host.
      'https://mail.google.com.kotu.example/',
      'https://resmigazete.gov.tr.kotu.example/',
    ]) {
      const decision = resolveExternalOpen(url)
      expect(decision).toEqual({ action: 'deny', reason: 'host_not_allowed' })
    }
  })

  it('https dışındaki her şemayı reddeder', () => {
    for (const url of [
      'http://mail.google.com/',
      'file:///C:/Windows/System32/calc.exe',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'mailto:biri@firma.example',
      'smb://sunucu/paylasim',
      'ms-msdt:/id',
    ]) {
      expect(resolveExternalOpen(url)).toEqual({ action: 'deny', reason: 'scheme_not_https' })
    }
  })

  it('çözümlenemeyen değeri reddeder', () => {
    for (const url of ['', 'bozuk url', '//mail.google.com/', 'mail.google.com']) {
      expect(resolveExternalOpen(url)).toEqual({ action: 'deny', reason: 'not_a_url' })
    }
  })

  it('URL içindeki kimlik bilgisini reddeder', () => {
    expect(resolveExternalOpen('https://kullanici:parola@mail.google.com/'))
      .toEqual({ action: 'deny', reason: 'credentials_present' })
  })

  it('kontrol karakteri veya satır sonu taşıyan değeri reddeder', () => {
    // İşletim sistemine devredilen dizgede satır sonu/komut karakteri olmamalı.
    for (const url of [
      'https://mail.google.com/\n',
      'https://mail.google.com/\r\nSet-Cookie: x=1',
      'https://mail.google.com/\u0000',
      'https://mail.google.com/\u007f',
    ]) {
      expect(resolveExternalOpen(url)).toEqual({ action: 'deny', reason: 'control_character' })
    }
  })

  it('uzunluk sınırını aşan bağlantıyı KISALTMADAN reddeder', () => {
    const long = `https://mail.google.com/mail/?body=${'a'.repeat(MAXIMUM_EXTERNAL_URL_LENGTH)}`
    expect(resolveExternalOpen(long)).toEqual({ action: 'deny', reason: 'too_long' })
  })

  it('işletim sistemine NORMALİZE edilmiş URL verir, ham dizgeyi değil', () => {
    const decision = resolveExternalOpen('https://MAIL.GOOGLE.COM/mail/?view=cm')
    expect(decision).toEqual({ action: 'open-external', url: 'https://mail.google.com/mail/?view=cm' })
  })

  it('allowlist yalnız repository\'de gerçekten kullanılan host\'ları içerir', () => {
    expect([...EXTERNAL_HOST_ALLOWLIST].sort()).toEqual([
      'mail.google.com',
      'resmigazete.gov.tr',
      'seddk.gov.tr',
      'www.resmigazete.gov.tr',
      'www.seddk.gov.tr',
    ])
  })
})
