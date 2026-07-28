import { describe, expect, it } from 'vitest'
import {
  buildDownstreamHeaders,
  buildUpstreamHeaders,
  isAllowedBridgeHost,
  isApiPath,
  resolveAssetPath,
  shouldFallbackToIndex,
} from '../src/index.js'

describe('köprü yol sınıflandırması', () => {
  it('yalnız /api ve altını API sayar', () => {
    expect(isApiPath('/api')).toBe(true)
    expect(isApiPath('/api/v1/users')).toBe(true)
    // Komşu yollar API DEĞİLDİR; aksi halde `/apiary` gibi bir UI route'u
    // sessizce upstream'e giderdi.
    expect(isApiPath('/apiary')).toBe(false)
    expect(isApiPath('/dosyalar/123')).toBe(false)
    expect(isApiPath('/')).toBe(false)
  })
})

describe('köprü host denetimi (DNS rebinding)', () => {
  it('loopback host kabul eder, yabancı host reddeder', () => {
    expect(isAllowedBridgeHost('127.0.0.1:51234', 51234)).toBe(true)
    expect(isAllowedBridgeHost('localhost:51234', 51234)).toBe(true)
    expect(isAllowedBridgeHost('[::1]:51234', 51234)).toBe(true)
    // Saldırganın kontrolündeki bir ad 127.0.0.1'e çözülse bile Host başlığı
    // loopback olmadığı için reddedilir.
    expect(isAllowedBridgeHost('kotu.example:51234', 51234)).toBe(false)
    expect(isAllowedBridgeHost(undefined, 51234)).toBe(false)
  })

  it('port uyuşmazlığını reddeder', () => {
    expect(isAllowedBridgeHost('127.0.0.1:9999', 51234)).toBe(false)
  })
})

describe('köprü başlık kuralları', () => {
  it('cookie başlığını upstreame AYNEN taşır ve host yeniden yazar', () => {
    const headers = buildUpstreamHeaders(
      { host: '127.0.0.1:51234', cookie: 'hb_session=abc', connection: 'keep-alive' },
      '127.0.0.1:3100',
    )
    // Oturum çerezinin API'ye ulaşması köprünün varlık sebebidir.
    expect(headers.cookie).toBe('hb_session=abc')
    expect(headers.host).toBe('127.0.0.1:3100')
    expect(headers.connection).toBeUndefined()
  })

  it('set-cookie dizisini nitelikleriyle birlikte değiştirmeden aktarır', () => {
    const setCookie = ['hb_session=tok; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600']
    const headers = buildDownstreamHeaders({
      'set-cookie': setCookie,
      'transfer-encoding': 'chunked',
      'content-type': 'application/json',
    })
    expect(headers['set-cookie']).toEqual(setCookie)
    expect(headers['transfer-encoding']).toBeUndefined()
    expect(headers['content-type']).toBe('application/json')
  })

  it('hiçbir yönde CORS başlığı ÜRETMEZ', () => {
    const upstream = buildUpstreamHeaders({ origin: 'http://127.0.0.1:51234' }, '127.0.0.1:3100')
    const downstream = buildDownstreamHeaders({ 'content-type': 'application/json' })
    const cors = (headers: Record<string, unknown>) =>
      Object.keys(headers).filter((name) => name.startsWith('access-control-'))
    expect(cors(upstream)).toEqual([])
    expect(cors(downstream)).toEqual([])
  })
})

describe('varlık yolu güvenliği', () => {
  it('normal yolları segmentlere ayırır', () => {
    expect(resolveAssetPath('/assets/index-abc.js')).toEqual({ ok: true, segments: ['assets', 'index-abc.js'] })
    expect(resolveAssetPath('/')).toEqual({ ok: true, segments: [] })
  })

  it('traversal, ters bölü, sürücü ve kontrol karakterini reddeder', () => {
    expect(resolveAssetPath('/../../etc/passwd')).toEqual({ ok: false, reason: 'traversal' })
    // Kod çözümünden SONRA denetlendiği için çift kodlama da yakalanır.
    expect(resolveAssetPath('/%2e%2e/gizli')).toEqual({ ok: false, reason: 'traversal' })
    expect(resolveAssetPath('/assets%5Cwin')).toEqual({ ok: false, reason: 'backslash' })
    expect(resolveAssetPath('/C:/Windows')).toEqual({ ok: false, reason: 'absolute_or_drive' })
    expect(resolveAssetPath('/a%00b')).toEqual({ ok: false, reason: 'control_character' })
    expect(resolveAssetPath('/%E0%A4%A')).toEqual({ ok: false, reason: 'not_decodable' })
  })
})

describe('SPA geri düşüşü', () => {
  it('uzantısız derin route index.html’e düşer', () => {
    expect(shouldFallbackToIndex([])).toBe(true)
    expect(shouldFallbackToIndex(['dosyalar', '019fa300'])).toBe(true)
  })

  it('eksik varlık dosyası 404 kalır; sessizce HTML dönmez', () => {
    expect(shouldFallbackToIndex(['assets', 'index-abc.js'])).toBe(false)
  })
})
