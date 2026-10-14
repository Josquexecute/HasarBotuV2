import type { AssistantAppearance } from '@hasarbotu/contracts/assistant-appearance'

export class AssistantAppearanceError extends Error {
  constructor(readonly kind: 'unauthorized' | 'conflict' | 'unavailable' | 'account_changed') { super(kind) }
}
export function createAssistantAppearancePort(fetchImpl: typeof fetch = fetch) {
  async function request(init: RequestInit) {
    let response: Response
    try { response = await fetchImpl('/api/v1/me/assistant-appearance', { credentials: 'include', ...init }) }
    catch { throw new AssistantAppearanceError('unavailable') }
    if (!response.ok) throw new AssistantAppearanceError(response.status === 401 ? 'unauthorized' : response.status === 409 ? 'conflict' : 'unavailable')
    try {
      const { assistantAppearanceResponseSchema } = await import('@hasarbotu/contracts/assistant-appearance-schema')
      return assistantAppearanceResponseSchema.parse(await response.json())
    }
    catch { throw new AssistantAppearanceError('unavailable') }
  }
  return {
    load: (signal?: AbortSignal) => request({ method: 'GET', signal }),
    save: async (userId: string, version: number, appearance: AssistantAppearance) => {
      const { assistantAppearanceUpdateSchema } = await import('@hasarbotu/contracts/assistant-appearance-schema')
      return request({ method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(assistantAppearanceUpdateSchema.parse({ expectedUserId: userId, expectedVersion: version, appearance })) })
    },
  }
}
export type AssistantAppearancePort = ReturnType<typeof createAssistantAppearancePort>
