import { describe, expect, it, vi } from 'vitest'
import { legislationQuestionSchema } from '@hasarbotu/contracts'
import { catalog, retrieveLegislation } from '../src/legislation/library.js'
import { createLegalGeminiProvider } from '../src/legislation/provider.js'

const input = legislationQuestionSchema.parse({ question: 'kasko sigortası teminat dışında kalan haller', eventDate: null, sourceIds: ['casco-conditions'], mode: 'ai' })
const evidence = retrieveLegislation(input, new Date(catalog.sources[0]!.verifiedAt))
const output = { statements: [{ text: 'İncelenecek teminat hükmü.', citations: [{ id: evidence[0]!.id, quote: evidence[0]!.excerpt.slice(0, 100) }] }], missingInformation: [] }
const response = (body: unknown, finishReason = 'STOP') => new Response(JSON.stringify({ candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(body) }] } }] }))
const config = { apiKey: 'synthetic-test-only-key', model: 'gemini-3.8-flash' }
describe('resmî mevzuat ve Gemini kaynak doğrulaması', () => {
  it('indeks gerçek kaynakları, tarih sınırını ve eski doğrulamayı uygular', () => {
    expect(catalog.sources.length).toBeGreaterThanOrEqual(6)
    expect(evidence.length).toBeGreaterThan(0)
    expect(evidence.every(e => e.sourceId === 'casco-conditions' && e.url.includes('#page='))).toBe(true)
    expect(retrieveLegislation({ ...input, eventDate: legislationQuestionSchema.parse({ ...input, eventDate: '2010-01-01' }).eventDate })).toEqual([])
    expect(retrieveLegislation(input, new Date(Date.parse(catalog.sources[0]!.verifiedAt) + 15 * 86_400_000))).toEqual([])
  })
  it('kimlikleri/platayı ayıklar, anahtarı yalnız başlıkta taşır ve birebir dayanağı doğrular', async () => {
    const fetcher = vi.fn(async () => response(output))
    const result = await createLegalGeminiProvider(fetcher)({ ...input, question: 'Kasko 34 ABC 123 12345678901 kisi@example.test' }, evidence, config)
    expect(result).toEqual(output)
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent')
    expect(new Headers(options.headers).get('x-goog-api-key')).toBe(config.apiKey)
    expect(options.body).not.toContain(config.apiKey)
    expect(options.body).not.toContain('34 ABC 123')
    expect(options.body).not.toContain('12345678901')
    expect(options.body).not.toContain('kisi@example.test')
    expect(JSON.parse(String(options.body)).generationConfig.responseFormat.text.mimeType).toBe('application/json')
    expect(options.redirect).toBe('error')
  })
  it.each([
    { ...output, statements: [{ text: 'Uydurma', citations: [{ id: 'unknown:p1', quote: evidence[0]!.excerpt.slice(0, 100) }] }] },
    { ...output, statements: [{ text: 'Uydurma', citations: [{ id: evidence[0]!.id, quote: 'Kaynakta bulunmayan uydurma bir alıntı.' }] }] },
    { ...output, statements: [{ text: 'Dayanaksız', citations: [] }] },
  ])('geçersiz dayanağı reddeder', async invalid => {
    await expect(createLegalGeminiProvider(async () => response(invalid))(input, evidence, config)).rejects.toThrow()
  })
  it('kesilen/HTTP hatalı/aşırı büyük yanıtları başarıya çevirmez', async () => {
    for (const r of [response(output, 'MAX_TOKENS'), new Response('remote secret', { status: 403 }), new Response('x'.repeat(200_001))]) {
      await expect(createLegalGeminiProvider(async () => r)(input, evidence, config)).rejects.toThrow()
    }
  })
})
