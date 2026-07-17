import { describe, expect, it, vi } from 'vitest'
import {
  EmailDraftError,
  buildGmailWebComposeUrl,
  createHttpEmailDraftAdapter,
} from './emailDraftPort'

const id = '019f5dd6-b191-7380-afe2-95580597762f'
const hash = 'a'.repeat(64)

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const version = {
  id,
  draftVersion: 1,
  previousVersionId: null,
  to: ['hasar@example.test'],
  cc: [],
  subject: 'Dosya',
  body: 'Merhaba.',
  attachments: [],
  templateVersion: 'email-draft-template/1.0.0',
  sourceType: 'deterministic_template',
  emailAiSuggestionRunId: null,
  previewHash: hash,
  revisionReason: null,
  createdByUserId: id,
  createdByDisplayName: 'Eksper',
  createdAt: '2026-07-16T12:00:00.000Z',
}

const draft = {
  id,
  caseId: id,
  draftType: 'case_status_update',
  version: 1,
  currentVersion: version,
  versions: [version],
  handoffs: [],
  createdByUserId: id,
  createdByDisplayName: 'Eksper',
  createdAt: '2026-07-16T12:00:00.000Z',
  updatedAt: '2026-07-16T12:00:00.000Z',
}

describe('email draft HTTP adapter', () => {
  it('workspace ve create yanıtlarını strict sözleşmeyle okur', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') return response({ draft }, 201)
      return response({
        caseId: id,
        lifecycleStatus: 'open',
        drafts: [draft],
        permissions: { canWrite: true, canPrepareHandoff: true },
      })
    })
    const port = createHttpEmailDraftAdapter({
      fetchImpl: fetchImpl as typeof fetch,
      idempotencyKeyFactory: () => 'p41-key',
    })
    expect((await port.load(id)).drafts).toHaveLength(1)
    await port.create(id, {
      expectedCaseVersion: 1,
      draftType: 'case_status_update',
      instruction: null,
      previewHash: hash,
      to: ['hasar@example.test'],
      cc: [],
      subject: 'Dosya',
      body: 'Merhaba.',
      attachments: [],
      confirmed: true,
    })
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({
      credentials: 'include',
      headers: expect.objectContaining({ 'idempotency-key': 'p41-key' }),
    })
  })

  it('bozuk response ve API kesintisinde mock fallback yapmaz', async () => {
    const invalid = createHttpEmailDraftAdapter({
      fetchImpl: vi.fn(async () => response({ drafts: [] })) as typeof fetch,
    })
    await expect(invalid.load(id)).rejects.toMatchObject({ kind: 'unavailable' })
    const unavailable = createHttpEmailDraftAdapter({
      fetchImpl: vi.fn(async () => { throw new TypeError('offline') }) as typeof fetch,
    })
    await expect(unavailable.load(id)).rejects.toBeInstanceOf(EmailDraftError)
  })

  it('Gmail URL içinde yalnız açık compose alanlarını taşır', () => {
    const url = buildGmailWebComposeUrl({
      to: ['hasar@example.test'],
      cc: [],
      subject: 'Dosya 2026/41',
      body: 'Merhaba.',
    })
    expect(url).toContain('https://mail.google.com/mail/')
    expect(url).toContain('to=hasar%40example.test')
    expect(url).not.toMatch(/attachment|relativePath|P%3A/i)
  })
})
