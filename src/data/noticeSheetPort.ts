import type { NoticeSheetResponse, NoticeSheetSaveRequest } from '@hasarbotu/contracts'

export interface NoticeSheetDataPort {
  read(caseId: string): Promise<NoticeSheetResponse>
  save(caseId: string, input: Omit<NoticeSheetSaveRequest, 'confirmed'>): Promise<NoticeSheetResponse>
}
export type NoticeSheetErrorKind = 'unauthorized' | 'forbidden' | 'not_found' | 'validation' | 'conflict' | 'unavailable'
export class NoticeSheetClientError extends Error {
  constructor(readonly kind: NoticeSheetErrorKind) {
    super(kind)
    this.name = 'NoticeSheetClientError'
  }
}

export function createHttpNoticeSheetAdapter(options: { baseUrl?: string; fetchImpl?: typeof fetch } = {}): NoticeSheetDataPort {
  const fetchImpl = options.fetchImpl ?? fetch
  async function request(caseId: string, input?: Omit<NoticeSheetSaveRequest, 'confirmed'>): Promise<NoticeSheetResponse> {
    let response: Response
    try {
      response = await fetchImpl(`${options.baseUrl ?? ''}/api/v1/cases/${encodeURIComponent(caseId)}/notice-sheet`, {
        credentials: 'include',
        headers: { accept: 'application/json', 'x-hasarbotu-notice-sheet-fields': '2', ...(input ? { 'content-type': 'application/json' } : {}) },
        ...(input ? { method: 'PUT', body: JSON.stringify({ ...input, confirmed: true }) } : {}),
      })
    } catch { throw new NoticeSheetClientError('unavailable') }
    if (!response.ok) {
      const kinds: Record<number, NoticeSheetErrorKind> = { 400: 'validation', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 409: 'conflict' }
      throw new NoticeSheetClientError(kinds[response.status] ?? 'unavailable')
    }
    try {
      const { noticeSheetResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = noticeSheetResponseSchema.safeParse(await response.json())
      if (!parsed.success || parsed.data.caseId !== caseId) throw new NoticeSheetClientError('unavailable')
      return parsed.data
    } catch { throw new NoticeSheetClientError('unavailable') }
  }
  return { read: caseId => request(caseId), save: (caseId, input) => request(caseId, input) }
}
