import { describe, expect, it } from 'vitest'
import {
  ConfigError,
  DEFAULT_HOST,
  DEFAULT_LOG_LEVEL,
  DEFAULT_NODE_ENV,
  DEFAULT_PORT,
  parseConfig,
} from '../src/index.js'

describe('parseConfig', () => {
  it('bos ortamda guvenli varsayilanlari uretir', () => {
    expect(parseConfig({})).toEqual({
      host: DEFAULT_HOST,
      port: DEFAULT_PORT,
      logLevel: DEFAULT_LOG_LEVEL,
      nodeEnv: DEFAULT_NODE_ENV,
    })
    expect(DEFAULT_HOST).toBe('127.0.0.1')
    expect(DEFAULT_PORT).toBe(3100)
  })

  it('gecerli ozel degerleri kabul eder', () => {
    expect(
      parseConfig({ HOST: '0.0.0.0', PORT: '8080', LOG_LEVEL: 'debug', NODE_ENV: 'production' }),
    ).toEqual({ host: '0.0.0.0', port: 8080, logLevel: 'debug', nodeEnv: 'production' })
    expect(parseConfig({ PORT: '1' }).port).toBe(1)
    expect(parseConfig({ PORT: '65535' }).port).toBe(65_535)
  })

  it.each(['0', '-1', '1.5', '65536', 'abc', '', ' 3100', '0x50', '3100 '])(
    'gecersiz PORT reddedilir: %j',
    (value) => {
      expect(() => parseConfig({ PORT: value })).toThrow(ConfigError)
    },
  )

  it('gecersiz LOG_LEVEL ve NODE_ENV reddedilir', () => {
    expect(() => parseConfig({ LOG_LEVEL: 'verbose' })).toThrow(ConfigError)
    expect(() => parseConfig({ NODE_ENV: 'staging' })).toThrow(ConfigError)
    expect(() => parseConfig({ HOST: '   ' })).toThrow(ConfigError)
  })

  it('hata mesaji ortam DEGERINI tasimaz (secret sizintisi yok)', () => {
    let caught: unknown
    try {
      parseConfig({ PORT: 'gizli-deger-42' })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ConfigError)
    const message = (caught as ConfigError).message
    expect(message).not.toContain('gizli-deger-42')
    expect(message).toContain('PORT')
  })

  it('saf fonksiyondur: process.env okumaz ve degistirmez', () => {
    const before = process.env.PORT
    parseConfig({ PORT: '4242' })
    expect(process.env.PORT).toBe(before)
    // Gercek ortam PORT tasisa bile acik nesne ile calisir.
    expect(parseConfig({}).port).toBe(DEFAULT_PORT)
  })
})
