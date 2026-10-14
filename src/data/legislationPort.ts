import { legislationAiSettingsSchema, legislationAiSettingsUpdateSchema, legislationAnswerSchema, legislationHistorySchema, legislationLibrarySchema, legislationPageSchema, legislationQuestionSchema } from '@hasarbotu/contracts'
import type { z } from 'zod'

export class LegislationError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}
export function createLegislationPort(fetchImpl: typeof fetch = (...args) => fetch(...args)) {
  async function request<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
    const response = await fetchImpl('/api/v1/legislation/' + path, { credentials: 'include', ...init })
    if (!response.ok) {
      let message = 'Mevzuat servisine ulaşılamadı.'
      try {
        const body = await response.json() as { error?: { message?: unknown } }
        if (typeof body.error?.message === 'string') message = body.error.message
      } catch { /* Non-JSON proxy errors retain the safe default. */ }
      throw new LegislationError(response.status, message)
    }
    return schema.parse(await response.json())
  }
  return {
    library: (signal?: AbortSignal) => request('library', legislationLibrarySchema, { signal }),
    page: (id: string, page: number, signal?: AbortSignal) => request(`sources/${encodeURIComponent(id)}?page=${page}`, legislationPageSchema, { signal }),
    history: (signal?: AbortSignal) => request('history', legislationHistorySchema, { signal }),
    settings: (signal?: AbortSignal) => request('ai-settings', legislationAiSettingsSchema, { signal }),
    saveSettings: (input: z.infer<typeof legislationAiSettingsUpdateSchema>, signal?: AbortSignal) => request('ai-settings', legislationAiSettingsSchema, { method: 'PUT', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(legislationAiSettingsUpdateSchema.parse(input)) }),
    ask: (input: z.input<typeof legislationQuestionSchema>, signal?: AbortSignal) => request('questions', legislationAnswerSchema, { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(legislationQuestionSchema.parse(input)) }),
  }
}
