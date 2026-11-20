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
  it('downloads the authenticated Word document with a UTF-8 filename and no save', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('PK document', { headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'content-disposition': `attachment; filename="ihbar-foyu.docx"; filename*=UTF-8''${encodeURIComponent('İhbar Föyü 34 TEST 123.docx')}`,
    } }))
    const file = await createHttpNoticeSheetAdapter({ baseUrl: 'https://office.example', fetchImpl }).exportWord('case / özel')
    expect(file.filename).toBe('İhbar Föyü 34 TEST 123.docx')
    expect(file.blob.size).toBe(11)
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith('https://office.example/api/v1/cases/case%20%2F%20%C3%B6zel/notice-sheet.docx', {
      credentials: 'include', headers: { accept: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    })
  })
  it.each([
    ['attachment; filename="ihbar-foyu.docx"', 'ihbar-foyu.docx'],
    ["attachment; filename*=UTF-8''invalid%ZZ; filename=backup.docx", 'backup.docx'],
    ['attachment; filename="../../unsafe:word?.docx"', 'unsafe-word-.docx'],
    ['attachment; filename="program.exe"', 'ihbar-foyu.docx'],
    ['', 'ihbar-foyu.docx'],
  ])('uses a safe Word filename for %s', async (disposition, expected) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('PK document', { headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'content-disposition': disposition,
    } }))
    expect((await createHttpNoticeSheetAdapter({ fetchImpl }).exportWord('case')).filename).toBe(expected)
  })
  it.each([[400, 'validation'], [401, 'unauthorized'], [403, 'forbidden'], [404, 'not_found'], [409, 'conflict'], [500, 'unavailable']])('preserves Word HTTP %s failures', async (status, kind) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: status as number }))
    await expect(createHttpNoticeSheetAdapter({ fetchImpl }).exportWord('case')).rejects.toMatchObject({ kind })
  })
  it('rejects Word responses with a wrong media type, an empty file or a transport failure', async () => {
    for (const response of [new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }), new Response('', { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } })]) {
      await expect(createHttpNoticeSheetAdapter({ fetchImpl: vi.fn().mockResolvedValue(response) }).exportWord('case')).rejects.toMatchObject({ kind: 'unavailable' })
    }
    await expect(createHttpNoticeSheetAdapter({ fetchImpl: vi.fn().mockRejectedValue(new Error('network')) }).exportWord('case')).rejects.toMatchObject({ kind: 'unavailable' })
  })
})
