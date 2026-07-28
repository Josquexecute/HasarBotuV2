import { describe, expect, it } from 'vitest'
import {
  ALLOWED_PERMISSIONS,
  ALLOWED_WINDOW_OPEN_ORIGINS,
  CONTENT_SECURITY_POLICY,
  SECURE_WEB_PREFERENCES,
  isAllowedNavigationUrl,
  isAllowedPermission,
  isAllowedWindowOpen,
  withSecurityHeaders,
} from '../src/main/security.js'

const SHELL_ORIGIN = 'http://127.0.0.1:51234'

describe('SECURE_WEB_PREFERENCES', () => {
  it('renderer için Node ve izolasyon ayarlarını sabitler', () => {
    expect(SECURE_WEB_PREFERENCES.nodeIntegration).toBe(false)
    expect(SECURE_WEB_PREFERENCES.nodeIntegrationInWorker).toBe(false)
    expect(SECURE_WEB_PREFERENCES.nodeIntegrationInSubFrames).toBe(false)
    expect(SECURE_WEB_PREFERENCES.contextIsolation).toBe(true)
    expect(SECURE_WEB_PREFERENCES.sandbox).toBe(true)
    expect(SECURE_WEB_PREFERENCES.webSecurity).toBe(true)
    expect(SECURE_WEB_PREFERENCES.allowRunningInsecureContent).toBe(false)
    expect(SECURE_WEB_PREFERENCES.webviewTag).toBe(false)
    expect(SECURE_WEB_PREFERENCES.experimentalFeatures).toBe(false)
  })
})

describe('CONTENT_SECURITY_POLICY', () => {
  it('kapalı başlar ve yalnız gereken yetenekleri açar', () => {
    expect(CONTENT_SECURITY_POLICY.startsWith("default-src 'none'")).toBe(true)
    for (const directive of [
      "script-src 'self'",
      "style-src 'self'",
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "object-src 'none'",
    ]) {
      expect(CONTENT_SECURITY_POLICY).toContain(directive)
    }
  })

  it('inline/eval kaçış yollarını içermez', () => {
    // `style-src` dahil hiçbir yönerge `unsafe-*` taşımaz.
    expect(CONTENT_SECURITY_POLICY).not.toContain('unsafe-inline')
    expect(CONTENT_SECURITY_POLICY).not.toContain('unsafe-eval')
    expect(CONTENT_SECURITY_POLICY).not.toContain('*')
    expect(CONTENT_SECURITY_POLICY).not.toContain('http:')
    expect(CONTENT_SECURITY_POLICY).not.toContain('https:')
  })
})

describe('withSecurityHeaders', () => {
  it('doküman yanıtına CSP ve nosniff yazar', () => {
    const headers = withSecurityHeaders({ 'content-type': ['text/html'] }, 'mainFrame')
    expect(headers?.['content-security-policy']).toEqual([CONTENT_SECURITY_POLICY])
    expect(headers?.['x-content-type-options']).toEqual(['nosniff'])
    expect(headers?.['content-type']).toEqual(['text/html'])
  })

  it('alt çerçeve yanıtını da kapsar', () => {
    expect(withSecurityHeaders({}, 'subFrame')?.['content-security-policy']).toEqual([CONTENT_SECURITY_POLICY])
  })

  it('doküman OLMAYAN yanıtlara DOKUNMAZ; köprünün şeffaflığı bozulmaz', () => {
    // `/api/*` JSON yanıtları buradan geçer: `set-cookie` aktarımı ve
    // adapter sözleşmesi değişmemelidir.
    for (const resourceType of ['xhr', 'script', 'stylesheet', 'image', 'font', 'other']) {
      expect(withSecurityHeaders({ 'set-cookie': ['hb_session=x; SameSite=Strict'] }, resourceType)).toBeUndefined()
    }
  })

  it('upstream CSP başlığını harf farkı olsa bile siler; kabuğun politikası tektir', () => {
    const headers = withSecurityHeaders(
      {
        'Content-Security-Policy': ["default-src *"],
        'CONTENT-SECURITY-POLICY-REPORT-ONLY': ["default-src *"],
        'X-Content-Type-Options': ['sniff-me'],
      },
      'mainFrame',
    )
    expect(headers?.['content-security-policy']).toEqual([CONTENT_SECURITY_POLICY])
    expect(headers?.['x-content-type-options']).toEqual(['nosniff'])
    expect(Object.keys(headers ?? {}).filter((name) => name.toLowerCase().includes('content-security-policy')))
      .toEqual(['content-security-policy'])
  })
})

describe('isAllowedNavigationUrl', () => {
  it('yalnız kabuk origin\'i içindeki navigasyona izin verir', () => {
    expect(isAllowedNavigationUrl(`${SHELL_ORIGIN}/`, SHELL_ORIGIN)).toBe(true)
    expect(isAllowedNavigationUrl(`${SHELL_ORIGIN}/dosyalar/019fa300-0000-7000-8000-000000003899`, SHELL_ORIGIN)).toBe(true)
    expect(isAllowedNavigationUrl(`${SHELL_ORIGIN}/dosyalar?durum=acik#ozet`, SHELL_ORIGIN)).toBe(true)
  })

  it('port veya host farkını AYRI origin sayar', () => {
    expect(isAllowedNavigationUrl('http://127.0.0.1:51235/', SHELL_ORIGIN)).toBe(false)
    // `localhost` ile `127.0.0.1` ayrı origin'lerdir; köprü Host olarak ikisini
    // de kabul etse bile navigasyon kapısı origin eşitliği arar.
    expect(isAllowedNavigationUrl('http://localhost:51234/', SHELL_ORIGIN)).toBe(false)
    expect(isAllowedNavigationUrl('https://127.0.0.1:51234/', SHELL_ORIGIN)).toBe(false)
  })

  it('uzak origin ve tehlikeli şemaları reddeder', () => {
    for (const target of [
      'https://ornek.gecersiz.example/',
      'http://ornek.gecersiz.example/',
      'file:///C:/Windows/System32/drivers/etc/hosts',
      'data:text/html,<script>alert(1)</script>',
      'javascript:alert(1)',
      'about:blank',
      'devtools://devtools/bundled/inspector.html',
      'chrome://settings',
      '',
      'bozuk url',
    ]) {
      expect(isAllowedNavigationUrl(target, SHELL_ORIGIN)).toBe(false)
    }
  })
})

describe('izin ve yeni pencere allowlist\'leri', () => {
  it('izin allowlist\'i boştur; hiçbir cihaz/OS izni açılmaz', () => {
    expect(ALLOWED_PERMISSIONS).toEqual([])
    for (const permission of ['media', 'geolocation', 'notifications', 'clipboard-read', 'openExternal', 'fullscreen']) {
      expect(isAllowedPermission(permission)).toBe(false)
    }
  })

  it('yeni pencere allowlist\'i boştur; kabuk origin\'i bile yeni pencere açamaz', () => {
    expect(ALLOWED_WINDOW_OPEN_ORIGINS).toEqual([])
    for (const target of [`${SHELL_ORIGIN}/dosyalar`, 'https://ornek.gecersiz.example/', 'bozuk url']) {
      expect(isAllowedWindowOpen(target)).toBe(false)
    }
  })
})
