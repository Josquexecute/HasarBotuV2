import { describe, expect, it } from 'vitest'
import {
  DatabaseConfigError,
  assertTestDatabaseUrl,
  parseDatabaseUrl,
  redactDatabaseUrl,
} from '../src/index.js'

describe('parseDatabaseUrl', () => {
  it('gecerli URL alanlara ayrilir', () => {
    const config = parseDatabaseUrl('postgres://app:secret@127.0.0.1:5432/hasarbotu')
    expect(config).toMatchObject({
      host: '127.0.0.1',
      port: 5432,
      database: 'hasarbotu',
      user: 'app',
      password: 'secret',
    })
  })

  it('port verilmezse 5432 varsayilir; postgresql:// da gecerlidir', () => {
    expect(parseDatabaseUrl('postgresql://app:pw@localhost/db').port).toBe(5432)
  })

  it.each([
    'mysql://a:b@h/db',
    'postgres://:pw@host/db',
    'postgres://user:pw@host/',
    'postgres://user:pw@host:0/db',
    'postgres://user:pw@host:70000/db',
    'not-a-url',
  ])('gecersiz URL reddedilir: %s', (value) => {
    expect(() => parseDatabaseUrl(value)).toThrow(DatabaseConfigError)
  })

  it('hata mesaji URL veya sifre degerini tasimaz', () => {
    let caught: unknown
    try {
      parseDatabaseUrl('postgres://user:cok-gizli-sifre@host:99999/db')
    } catch (error) {
      caught = error
    }
    const message = (caught as Error).message
    expect(message).not.toContain('cok-gizli-sifre')
    expect(message).not.toContain('host:99999')
  })
})

describe('redactDatabaseUrl', () => {
  it('sifreyi maskeler, gecersiz degerde sabit metin doner', () => {
    expect(redactDatabaseUrl('postgres://app:secret@h:5432/db')).not.toContain('secret')
    expect(redactDatabaseUrl('postgres://app:secret@h:5432/db')).toContain('[redacted]')
    expect(redactDatabaseUrl('???')).toBe('[invalid-database-url]')
  })
})

describe('assertTestDatabaseUrl', () => {
  it('_test ile bitmeyen veritabanini reddeder (uretim korumasi)', () => {
    expect(() => assertTestDatabaseUrl('postgres://t:t@127.0.0.1/hasarbotu')).toThrow(
      DatabaseConfigError,
    )
    expect(assertTestDatabaseUrl('postgres://t:t@127.0.0.1/hasarbotu_test').database).toBe(
      'hasarbotu_test',
    )
  })
})
