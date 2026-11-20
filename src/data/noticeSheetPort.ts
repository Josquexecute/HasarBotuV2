import { NOTICE_SHEET_DOCX_ROUTE, type NoticeSheetResponse, type NoticeSheetSaveRequest } from '@hasarbotu/contracts'

const wordMediaType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export interface NoticeSheetDataPort {
  read(caseId: string): Promise<NoticeSheetResponse>
  save(caseId: string, input: Omit<NoticeSheetSaveRequest, 'confirmed'>): Promise<NoticeSheetResponse>
  exportWord(caseId: string): Promise<{ blob: Blob; filename: string }>
}
export type NoticeSheetErrorKind = 'unauthorized' | 'forbidden' | 'not_found' | 'validation' | 'conflict' | 'unavailable'
export class NoticeSheetClientError extends Error {
  constructor(readonly kind: NoticeSheetErrorKind) {
    super(kind)
    this.name = 'NoticeSheetClientError'
  }
}

function errorForStatus(status: number): NoticeSheetClientError {
  const kinds: Record<number, NoticeSheetErrorKind> = { 400: 'validation', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 409: 'conflict' }
  return new NoticeSheetClientError(kinds[status] ?? 'unavailable')
}

function wordFilename(disposition: string): string {
  let candidate = ''
  const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition)?.[1]
  if (encoded) {
    try { candidate = decodeURIComponent(encoded.trim()) } catch { /* Use the ASCII fallback if the UTF-8 filename is malformed. */ }
  }
  if (!candidate) {
    const fallback = /(?:^|;)\s*filename\s*=\s*(?:"([^"]*)"|([^;]*))/i.exec(disposition)
    candidate = fallback?.[1] ?? fallback?.[2] ?? ''
  }
  const basename = candidate.split(/[\\/]/).at(-1)?.replace(/[<>:"|?*\p{Cc}]/gu, '-').trim() ?? ''
  return basename.length <= 180 && /^.+\.docx$/i.test(basename) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(basename) ? basename : 'ihbar-foyu.docx'
}

export function createHttpNoticeSheetAdapter(options: { baseUrl?: string; fetchImpl?: typeof fetch } = {}): NoticeSheetDataPort {
  const fetchImpl = options.fetchImpl ?? fetch
  async function request(caseId: string, input?: Omit<NoticeSheetSaveRequest, 'confirmed'>): Promise<NoticeSheetResponse> {
    let response: Response
    try {
      response = await fetchImpl(`${options.baseUrl ?? ''}/api/v1/cases/${encodeURIComponent(caseId)}/notice-sheet`, {
        credentials: 'include',
        headers: { accept: 'application/json', 'x-hasarbotu-notice-sheet-fields': '3', ...(input ? { 'content-type': 'application/json' } : {}) },
        ...(input ? { method: 'PUT', body: JSON.stringify({ ...input, confirmed: true }) } : {}),
      })
    } catch { throw new NoticeSheetClientError('unavailable') }
    if (!response.ok) throw errorForStatus(response.status)
    try {
      const { noticeSheetResponseSchema } = await import('@hasarbotu/contracts')
      const parsed = noticeSheetResponseSchema.safeParse(await response.json())
      if (!parsed.success || parsed.data.caseId !== caseId) throw new NoticeSheetClientError('unavailable')
      return parsed.data
    } catch { throw new NoticeSheetClientError('unavailable') }
  }
  return {
    read: caseId => request(caseId),
    save: (caseId, input) => request(caseId, input),
    async exportWord(caseId) {
      let response: Response
      try {
        response = await fetchImpl(`${options.baseUrl ?? ''}${NOTICE_SHEET_DOCX_ROUTE.replace(':caseId', encodeURIComponent(caseId))}`, {
          credentials: 'include', headers: { accept: wordMediaType },
        })
      } catch { throw new NoticeSheetClientError('unavailable') }
      if (!response.ok) throw errorForStatus(response.status)
      if (response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== wordMediaType) throw new NoticeSheetClientError('unavailable')
      try {
        const blob = await response.blob()
        if (blob.size === 0) throw new NoticeSheetClientError('unavailable')
        return { blob, filename: wordFilename(response.headers.get('content-disposition') ?? '') }
      } catch { throw new NoticeSheetClientError('unavailable') }
    },
  }
}
