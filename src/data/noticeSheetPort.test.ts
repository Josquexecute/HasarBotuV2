import { describe, expect, it, vi } from 'vitest'
import { createHttpNoticeSheetAdapter } from './noticeSheetPort'
import { noticeSheetFixture } from '../test/fixtures/notice-sheet'

describe('Notice sheet HTTP adapter', () => {
  it('uses a session and validates the case identity on reads', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(noticeSheetFixture))))
    const port = createHttpNoticeSheetAdapter({ fetchImpl })
    expect(await port.read(noticeSheetFixture.caseId)).toEqual(noticeSheetFixture)
    expect(fetchImpl).toHaveBeenCalledWith('/api/v1/cases/notice-case-1/notice-sheet', expect.objectContaining({ credentials: 'include',headers: expect.objectContaining({ 'x-hasarbotu-notice-sheet-fields': '3' }) }))
    await expect(port.read('different-case')).rejects.toMatchObject({ kind: 'unavailable' })
  })
  it('sends only the versioned overrides and explicit confirmation', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(noticeSheetFixture)))
    await createHttpNoticeSheetAdapter({ fetchImpl }).save(noticeSheetFixture.caseId, { expectedVersion: null, overrides: { fields: { recourse: 'İnceleniyor' }, documents: {} } })
    expect(JSON.parse(fetchImpl.mock.calls[0]![1].body)).toEqual({ expectedVersion: null, confirmed: true, overrides: { fields: { recourse: 'İnceleniyor' }, documents: {} } })
  })
  it.each([[401, 'unauthorized'], [403, 'forbidden'], [404, 'not_found'], [409, 'conflict'], [500, 'unavailable']])('preserves HTTP %s failures', async (status, kind) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: status as number }))
    await expect(createHttpNoticeSheetAdapter({ fetchImpl }).read('case')).rejects.toMatchObject({ kind })
  })
  it('fails closed on malformed responses and transport failures', async () => {
    await expect(createHttpNoticeSheetAdapter({ fetchImpl: vi.fn().mockResolvedValue(new Response('{}')) }).read('case')).rejects.toMatchObject({ kind: 'unavailable' })
    await expect(createHttpNoticeSheetAdapter({ fetchImpl: vi.fn().mockRejectedValue(new Error('network')) }).read('case')).rejects.toMatchObject({ kind: 'unavailable' })
  })
})
