import { describe, expect, it } from 'vitest'
import {
  ConfigError,
  DEFAULT_HOST,
  DEFAULT_LOG_LEVEL,
  DEFAULT_NODE_ENV,
  DEFAULT_PORT,
  GEMINI_FREE_TIER_FALLBACK_MODEL_ID,
  GEMINI_FREE_TIER_MODEL_ID,
  createConfiguredPolicyAiProviderRegistry,
  parseConfig,
} from '../src/index.js'

describe('parseConfig', () => {
  it('bos ortamda guvenli varsayilanlari uretir', () => {
    expect(parseConfig({})).toEqual({
      host: DEFAULT_HOST,
      port: DEFAULT_PORT,
      logLevel: DEFAULT_LOG_LEVEL,
      nodeEnv: DEFAULT_NODE_ENV,
      // development'ta cookieSecure her zaman false (mevcut davranış).
      cookieSecure: false,
      // Paket 55: deterministik dağıtım sağlayıcıları varsayılan olarak KAPALI.
      laborAllocationAllowDeterministicProviders: false,
    })
    expect(DEFAULT_HOST).toBe('127.0.0.1')
    expect(DEFAULT_PORT).toBe(3100)
  })

  it('gecerli ozel degerleri kabul eder', () => {
    expect(
      parseConfig({
        HOST: '0.0.0.0',
        PORT: '8080',
        LOG_LEVEL: 'debug',
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://app:pw@127.0.0.1:5432/hasarbotu',
      }),
    ).toEqual({
      host: '0.0.0.0',
      port: 8080,
      logLevel: 'debug',
      nodeEnv: 'production',
      // ALLOW_INSECURE_LOOPBACK_COOKIES verilmedi -> production'da fail-closed
      // varsayılan: Secure ZORUNLU, host 0.0.0.0 (loopback değil) olsa bile
      // (opt-in hiç istenmediği için host kontrolüne hiç girilmez).
      cookieSecure: true,
      databaseUrl: 'postgres://app:pw@127.0.0.1:5432/hasarbotu',
      laborAllocationAllowDeterministicProviders: false,
    })
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

  it('DATABASE_URL development/test icin opsiyonel, production icin zorunludur', () => {
    expect(parseConfig({}).databaseUrl).toBeUndefined()
    expect(() => parseConfig({ NODE_ENV: 'production' })).toThrow(ConfigError)
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

  it('Gemini deployment opt-in olmadan kapali kalir ve cekirdek config calisir', () => {
    expect(parseConfig({
      GEMINI_API_KEY: 'installed-but-disabled-secret',
      GEMINI_POLICY_MODEL: GEMINI_FREE_TIER_MODEL_ID,
    }).geminiPolicyProvider).toBeUndefined()
    expect(createConfiguredPolicyAiProviderRegistry(parseConfig({})).list()).toEqual([])
  })

  it.each([GEMINI_FREE_TIER_MODEL_ID, GEMINI_FREE_TIER_FALLBACK_MODEL_ID])(
    'Gemini secretini bicim tahmini yapmadan eksiksiz server config ile kaydeder: %s',
    (modelId) => {
      const config = parseConfig({
        GEMINI_POLICY_PROVIDER_ENABLED: 'true',
        GEMINI_API_KEY: '  anahtar-noktalama.icerir+ve-regex-tahmini-yok  ',
        GEMINI_POLICY_MODEL: modelId,
        GEMINI_POLICY_MAX_OUTPUT_TOKENS: '4096',
      })
      expect(config.geminiPolicyProvider).toMatchObject({
        apiKey: 'anahtar-noktalama.icerir+ve-regex-tahmini-yok',
        modelId,
        maximumOutputTokens: 4_096,
      })
      const descriptors = createConfiguredPolicyAiProviderRegistry(config).list()
      expect(descriptors).toHaveLength(1)
      expect(descriptors[0]).toMatchObject({
        providerId: 'gemini-generate-content',
        modelId,
        retentionMode: 'free_tier_product_improvement',
      })
      expect(JSON.stringify(descriptors)).not.toContain('anahtar-noktalama')
    },
  )

  it('Gemini opt-in kismi/gecersiz configi secret sizdirmadan fail-closed reddeder', () => {
    const secret = 'bu-deger-hata-mesajina-girmemeli'
    expect(() => parseConfig({ GEMINI_POLICY_PROVIDER_ENABLED: 'yes' })).toThrow(ConfigError)
    expect(() => parseConfig({ GEMINI_POLICY_PROVIDER_ENABLED: 'true', GEMINI_POLICY_MODEL: GEMINI_FREE_TIER_MODEL_ID })).toThrow(ConfigError)
    expect(() => parseConfig({ GEMINI_POLICY_PROVIDER_ENABLED: 'true', GEMINI_API_KEY: secret, GEMINI_POLICY_MODEL: 'gemini-tahmini-model' })).toThrow(ConfigError)
    expect(() => parseConfig({
      GEMINI_POLICY_PROVIDER_ENABLED: 'true',
      GEMINI_API_KEY: 'x'.repeat(4_097),
      GEMINI_POLICY_MODEL: GEMINI_FREE_TIER_MODEL_ID,
    })).toThrow(ConfigError)
    try {
      parseConfig({ GEMINI_POLICY_PROVIDER_ENABLED: 'true', GEMINI_API_KEY: secret, GEMINI_POLICY_MODEL: 'gemini-tahmini-model' })
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError)
      expect((error as ConfigError).message).not.toContain(secret)
      expect((error as ConfigError).message).toContain('GEMINI_POLICY_MODEL')
    }
  })

  it('saf fonksiyondur: process.env okumaz ve degistirmez', () => {
    const before = process.env.PORT
    parseConfig({ PORT: '4242' })
    expect(process.env.PORT).toBe(before)
    // Gercek ortam PORT tasisa bile acik nesne ile calisir.
    expect(parseConfig({}).port).toBe(DEFAULT_PORT)
  })

  describe('cookieSecure (HB-2026-175 auth-transport)', () => {
    it('development/test icin ALLOW_INSECURE_LOOPBACK_COOKIES ne olursa olsun her zaman false doner (mevcut davranis)', () => {
      expect(parseConfig({}).cookieSecure).toBe(false)
      expect(parseConfig({ NODE_ENV: 'test' }).cookieSecure).toBe(false)
      expect(parseConfig({ NODE_ENV: 'development', ALLOW_INSECURE_LOOPBACK_COOKIES: 'true', HOST: '0.0.0.0' }).cookieSecure).toBe(false)
    })

    it('production + opt-in verilmedi -> fail-closed varsayilan: Secure ZORUNLU (host onemsiz)', () => {
      expect(parseConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://app:pw@127.0.0.1:5432/hasarbotu' }).cookieSecure).toBe(true)
      expect(parseConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://app:pw@127.0.0.1:5432/hasarbotu',
        HOST: '127.0.0.1',
      }).cookieSecure).toBe(true)
    })

    it('production + opt-in=true + gercek loopback host (127.0.0.1 veya ::1) -> Secure gevsetilir', () => {
      expect(parseConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://app:pw@127.0.0.1:5432/hasarbotu',
        ALLOW_INSECURE_LOOPBACK_COOKIES: 'true',
        HOST: '127.0.0.1',
      }).cookieSecure).toBe(false)
      expect(parseConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://app:pw@127.0.0.1:5432/hasarbotu',
        ALLOW_INSECURE_LOOPBACK_COOKIES: 'true',
        HOST: '::1',
      }).cookieSecure).toBe(false)
    })

    it('production + opt-in=true + loopback OLMAYAN host (0.0.0.0, gercek LAN IP, localhost hostname) -> fail-closed reddedilir, sunucu BASLAMAZ', () => {
      const base = { NODE_ENV: 'production' as const, DATABASE_URL: 'postgres://app:pw@127.0.0.1:5432/hasarbotu', ALLOW_INSECURE_LOOPBACK_COOKIES: 'true' }
      expect(() => parseConfig({ ...base, HOST: '0.0.0.0' })).toThrow(ConfigError)
      expect(() => parseConfig({ ...base, HOST: '192.168.1.50' })).toThrow(ConfigError)
      // 'localhost' bilerek loopback SAYILMAZ (DNS/hosts dosyasi cozumlemesi,
      // bind adresiyle birebir ayni garantiyi tasimaz) -- yalniz ciplak IP.
      expect(() => parseConfig({ ...base, HOST: 'localhost' })).toThrow(ConfigError)
      try {
        parseConfig({ ...base, HOST: '0.0.0.0' })
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError)
        expect((error as ConfigError).message).toContain('ALLOW_INSECURE_LOOPBACK_COOKIES')
      }
    })

    it('ALLOW_INSECURE_LOOPBACK_COOKIES gecersiz deger -> fail-closed reddedilir', () => {
      const base = { NODE_ENV: 'production' as const, DATABASE_URL: 'postgres://app:pw@127.0.0.1:5432/hasarbotu', HOST: '127.0.0.1' }
      expect(() => parseConfig({ ...base, ALLOW_INSECURE_LOOPBACK_COOKIES: 'yes' })).toThrow(ConfigError)
      expect(() => parseConfig({ ...base, ALLOW_INSECURE_LOOPBACK_COOKIES: '1' })).toThrow(ConfigError)
      // Acik 'false' -- fail-closed varsayilanla AYNI (Secure zorunlu), hata degil.
      expect(parseConfig({ ...base, ALLOW_INSECURE_LOOPBACK_COOKIES: 'false' }).cookieSecure).toBe(true)
    })
  })
})
