import { legislationAiSettingsSchema, legislationAiSettingsUpdateSchema, legislationAnswerSchema, legislationHistorySchema, legislationLibrarySchema, legislationPageSchema, legislationQuestionSchema } from '@hasarbotu/contracts'
import type { z } from 'zod'

export class LegislationError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}
export function createLegislationPort(fetchImpl: typeof fetch = (...args) => fetch(...args)) {
  async function request<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
    let response: Response
    try { response = await fetchImpl('/api/v1/legislation/' + path, { credentials: 'include', ...init }) }
    catch (error) {
      if (init.signal?.aborted) throw error
      throw new LegislationError(503, 'Ofis sunucusuyla bağlantı kurulamadı. Bağlantınızı kontrol edip yeniden deneyin.')
    }
    if (!response.ok) {
      let message = 'Mevzuat servisine ulaşılamadı.'
      try {
        const body = await response.json() as { error?: { message?: unknown } }
        if (typeof body.error?.message === 'string') message = body.error.message
      } catch { /* Non-JSON proxy errors retain the safe default. */ }
      throw new LegislationError(response.status, message)
    }
    let body: unknown
    try { body = await response.json() }
    catch { throw new LegislationError(502, 'Mevzuat servisi geçerli bir yanıt göndermedi. Sunucu ve program sürümlerini kontrol edin.') }
    const parsed = schema.safeParse(body)
    if (!parsed.success) throw new LegislationError(502, 'Mevzuat yanıtının biçimi program sürümüyle uyumlu değil. Programı güncelleyip yeniden yükleyin.')
    return parsed.data
  }
  function settingsInput(input: z.infer<typeof legislationAiSettingsUpdateSchema>) {
    const parsed = legislationAiSettingsUpdateSchema.safeParse(input)
    if (parsed.success) return parsed.data
    const field = parsed.error.issues[0]?.path[0]
    throw new LegislationError(400, field === 'apiKey' ? 'API anahtarını kontrol edin. Yalnız anahtarı yapıştırın; boşluk, tırnak veya GEMINI_API_KEY= eklemeyin.'
      : field === 'model' ? 'Gemini model adı geçersiz. Örnek: gemini-3.8-flash' : 'Gemini ayarları doğrulanamadı. Ayarları yeniden yükleyin.')
  }
  return {
    library: (signal?: AbortSignal) => request('library', legislationLibrarySchema, { signal }),
    page: (id: string, page: number, signal?: AbortSignal) => request(`sources/${encodeURIComponent(id)}?page=${page}`, legislationPageSchema, { signal }),
    history: (signal?: AbortSignal) => request('history', legislationHistorySchema, { signal }),
    settings: (signal?: AbortSignal) => request('ai-settings', legislationAiSettingsSchema, { signal }),
    saveSettings: (input: z.infer<typeof legislationAiSettingsUpdateSchema>, signal?: AbortSignal) => request('ai-settings', legislationAiSettingsSchema, { method: 'PUT', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(settingsInput(input)) }),
    ask: (input: z.input<typeof legislationQuestionSchema>, signal?: AbortSignal) => request('questions', legislationAnswerSchema, { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(legislationQuestionSchema.parse(input)) }),
  }
}
