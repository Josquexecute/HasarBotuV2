import { trackingSnapshotSchema, type TramerCommand } from '@hasarbotu/contracts'

export async function trackingRequest(path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`/api/v1/${path}`,{ credentials: 'include',...(signal ? { signal } : {}),...(body === undefined ? {} : { method: 'POST',headers: { 'content-type': 'application/json' },body: JSON.stringify(body) }) })
  if (!response.ok) {
    let message = 'Takip servisine ulaşılamadı.'
    try {
      const result = await response.json() as { error?: string | { message?: string } }
      if (typeof result.error === 'string') message = result.error
      else if (result.error?.message) message = result.error.message
    } catch { /* Transport errors may have no JSON body. */ }
    throw new Error(message)
  }
  return response.status === 204 ? undefined : response.json()
}
export const loadTracking = async (caseId?: string, signal?: AbortSignal) => trackingSnapshotSchema.parse(await trackingRequest(`tracking${caseId ? `?caseId=${encodeURIComponent(caseId)}` : ''}`,undefined,signal))
export const commandTramer = (caseId: string,body: TramerCommand) => trackingRequest(`tracking/cases/${encodeURIComponent(caseId)}/tramer`,body)
