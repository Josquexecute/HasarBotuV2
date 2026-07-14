import { describe, expect, it } from 'vitest'
import { createHttpDocumentWorkspaceAdapter } from './documentHttpAdapter'

const baseUrl = process.env.LIVE_API_BASE_URL
const email = process.env.LIVE_API_EMAIL
const password = process.env.LIVE_API_PASSWORD
const caseId = process.env.LIVE_API_CASE_ID
const liveEnabled = Boolean(baseUrl && email && password && caseId)

describe.skipIf(!liveEnabled)('Document workspace canlı API entegrasyonu', () => {
  it('login sonrası gerçek gereksinim ve metadata uçlarını DataPort üzerinden okur', async () => {
    const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    expect(login.status).toBe(200)
    const cookie = login.headers.get('set-cookie')?.split(';')[0]
    expect(cookie).toBeTruthy()
    const data = await createHttpDocumentWorkspaceAdapter({ baseUrl, headers: { cookie: cookie ?? '' } }).getCaseDocumentWorkspace(caseId ?? '')
    expect(data.caseId).toBe(caseId)
    expect(data.ruleSetVersion.length).toBeGreaterThan(0)
    expect(data.requirements.length).toBeGreaterThan(0)
    for (const item of [...data.documents, ...data.photos]) {
      expect(item.relativePath).not.toMatch(/^[a-z]:[\\/]/i)
      expect(item.relativePath).not.toContain('..')
    }
    expect(JSON.stringify(data)).not.toContain(password)
  })
})
