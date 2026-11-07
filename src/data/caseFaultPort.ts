import type { CaseFaultResponse, CaseFaultSaveRequest } from '@hasarbotu/contracts'

export interface CaseFaultPort {
  read(caseId: string, signal?: AbortSignal): Promise<CaseFaultResponse>
  save(caseId: string, input: CaseFaultSaveRequest, signal?: AbortSignal): Promise<CaseFaultResponse>
}

export class CaseFaultClientError extends Error {
  constructor(readonly status: number) { super(`Fault request failed (${status})`) }
}

export function createHttpCaseFaultAdapter(options: { baseUrl?: string; fetchImpl?: typeof fetch } = {}): CaseFaultPort {
  const request = async (caseId: string, signal?: AbortSignal, input?: CaseFaultSaveRequest) => {
    const response = await (options.fetchImpl ?? fetch)(`${options.baseUrl ?? ''}/api/v1/cases/${encodeURIComponent(caseId)}/fault`, {
      method: input ? 'PUT' : 'GET', credentials: 'include', signal,
      headers: { accept: 'application/json', ...(input ? { 'content-type': 'application/json' } : {}) },
      ...(input ? { body: JSON.stringify(input) } : {}),
    })
    if (!response.ok) throw new CaseFaultClientError(response.status)
    const { caseFaultResponseSchema } = await import('@hasarbotu/contracts')
    return caseFaultResponseSchema.parse(await response.json())
  }
  return { read: (id, signal) => request(id, signal), save: (id, input, signal) => request(id, signal, input) }
}
