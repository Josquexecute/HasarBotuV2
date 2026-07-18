import { describe, expect, it } from 'vitest'
import {
  laborDictionaryQuerySchema,
  laborDictionaryResponseSchema,
} from '../src/index.js'

const entry = {
  description: 'Ön tampon kaplama',
  action: 'Değişim',
  usageCount: 3,
  lastPartAmountMinor: 18_400_00,
  lastLaborAmountMinor: 2_200_00,
  lastUsedAt: '2026-07-18T09:00:00.000Z',
}

describe('labor dictionary contracts', () => {
  it('sorgu boş metin ve üst limit varsayılanı uygular', () => {
    expect(laborDictionaryQuerySchema.parse({})).toEqual({ query: '', limit: 200 })
    expect(laborDictionaryQuerySchema.parse({ query: '  tampon  ', limit: 20 }))
      .toEqual({ query: 'tampon', limit: 20 })
  })

  it('geçersiz limit ve fazla anahtarı reddeder', () => {
    expect(() => laborDictionaryQuerySchema.parse({ limit: 0 })).toThrow()
    expect(() => laborDictionaryQuerySchema.parse({ limit: 201 })).toThrow()
    expect(() => laborDictionaryQuerySchema.parse({ limit: 1.5 })).toThrow()
    expect(() => laborDictionaryQuerySchema.parse({ extra: 'x' })).toThrow()
    expect(() => laborDictionaryQuerySchema.parse({ query: 'a'.repeat(161) })).toThrow()
  })

  it('yanıt strict doğrulanır; kullanım sayısı pozitif olmalıdır', () => {
    const parsed = laborDictionaryResponseSchema.parse({
      schemaVersion: 'labor-dictionary/1.0.0',
      items: [entry],
    })
    expect(parsed.items[0].usageCount).toBe(3)
    expect(laborDictionaryResponseSchema.parse({
      schemaVersion: 'labor-dictionary/1.0.0',
      items: [],
    }).items).toEqual([])
    expect(() => laborDictionaryResponseSchema.parse({
      schemaVersion: 'labor-dictionary/1.0.0',
      items: [{ ...entry, usageCount: 0 }],
    })).toThrow()
    expect(() => laborDictionaryResponseSchema.parse({
      schemaVersion: 'labor-dictionary/9.9.9',
      items: [entry],
    })).toThrow()
  })
})
