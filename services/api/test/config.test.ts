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

  it('DATABASE_URL opsiyoneldir: yoksa undefined, gecerliyse tasinir, gecersizse deger sizdirmadan reddedilir', () => {
    expect(parseConfig({}).databaseUrl).toBeUndefined()
    expect(
      parseConfig({ DATABASE_URL: 'postgres://app:pw@127.0.0.1:5432/hasarbotu' }).databaseUrl,
    ).toBe('postgres://app:pw@127.0.0.1:5432/hasarbotu')

    let caught: unknown
    try {
      parseConfig({ DATABASE_URL: 'mysql://gizli-sifre-99@yer/db' })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ConfigError)
    expect((caught as ConfigError).message).not.toContain('gizli-sifre-99')
    expect((caught as ConfigError).message).toContain('DATABASE_URL')
  })

  it('OpenAI policy provider secretini yalniz eksiksiz server config ile kabul eder', () => {
    const config = parseConfig({
      OPENAI_API_KEY: 'sk-test-only-not-a-real-secret-0001',
      OPENAI_POLICY_MODEL: 'gpt-5-mini-pinned',
      OPENAI_POLICY_INPUT_COST_MINOR_PER_MILLION: '25',
      OPENAI_POLICY_OUTPUT_COST_MINOR_PER_MILLION: '200',
      OPENAI_POLICY_MAX_OUTPUT_TOKENS: '2048',
    })
    expect(config.openAiPolicyProvider).toMatchObject({
      modelId: 'gpt-5-mini-pinned',
      inputCostMinorPerMillionTokens: 25,
      outputCostMinorPerMillionTokens: 200,
      maximumOutputTokens: 2048,
    })
    expect(parseConfig({}).openAiPolicyProvider).toBeUndefined()
    expect(() => parseConfig({ OPENAI_POLICY_MODEL: 'gpt-5-mini' })).toThrow(ConfigError)
  })

  it('OpenAI secret veya fiyat degerini config hatasina sizdirmaz', () => {
    const secret = 'gizli gecersiz key degeri'
    let caught: unknown
    try {
      parseConfig({ OPENAI_API_KEY: secret, OPENAI_POLICY_MODEL: 'gpt-5-mini' })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ConfigError)
    expect((caught as ConfigError).message).not.toContain(secret)
    expect((caught as ConfigError).message).toContain('OPENAI_API_KEY')
  })

  it('saf fonksiyondur: process.env okumaz ve degistirmez', () => {
    const before = process.env.PORT
    parseConfig({ PORT: '4242' })
    expect(process.env.PORT).toBe(before)
    // Gercek ortam PORT tasisa bile acik nesne ile calisir.
    expect(parseConfig({}).port).toBe(DEFAULT_PORT)
  })
})
