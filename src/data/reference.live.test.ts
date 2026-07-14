import { describe, expect, it } from 'vitest'
import { createHttpAuthAdapter } from './authPort'
import { createHttpCaseCommandAdapter } from './commandPort'
import { createHttpReferenceDataAdapter } from './referenceHttpAdapter'

const BASE_URL = process.env.LIVE_API_BASE_URL
const EMAIL = process.env.LIVE_API_EMAIL
const PASSWORD = process.env.LIVE_API_PASSWORD
const describeLive = BASE_URL && EMAIL && PASSWORD ? describe : describe.skip

describeLive('Paket 18 gerçek API smoke', () => {
  it('login -> referanslar -> eksper/tarihlerle create -> optimistic update', async () => {
    let cookie = ''
    const captureFetch: typeof fetch = async (input, init) => {
      const response = await fetch(input, init)
      const setCookie = response.headers.get('set-cookie')
      if (setCookie !== null) cookie = setCookie.split(';')[0] as string
      return response
    }
    const auth = createHttpAuthAdapter({ baseUrl: BASE_URL as string, fetchImpl: captureFetch })
    await auth.login(EMAIL as string, PASSWORD as string)
    const headers = { cookie }
    const references = await createHttpReferenceDataAdapter({ baseUrl: BASE_URL as string, headers }).getCaseReferences()
    expect(references.insurers).toHaveLength(1)
    expect(references.services).toHaveLength(1)
    expect(references.users.length).toBeGreaterThanOrEqual(2)
    expect(references.experts).toHaveLength(1)
    const insurer = references.insurers[0]
    const service = references.services[0]
    const responsible = references.users[0]
    const expert = references.experts[0]
    if (insurer === undefined || service === undefined || responsible === undefined || expert === undefined) {
      throw new Error('synthetic reference seed missing')
    }

    const commands = createHttpCaseCommandAdapter({ baseUrl: BASE_URL as string, headers })
    const created = await commands.createCase({
      caseType: 'traffic',
      plate: '34 P 188',
      responsibleUserId: responsible.id,
      expertUserId: expert.id,
      insurerId: insurer.id,
      serviceId: service.id,
      lossDate: '2026-07-10',
      notificationDate: '2026-07-11',
    }, 'package-18-live-create')
    expect(created).toMatchObject({ expertUserId: expert.id, lossDate: '2026-07-10', notificationDate: '2026-07-11', version: 1 })
    const updated = await commands.updateCase(created.caseId, { expectedVersion: 1, lossDate: '2026-07-12', notificationDate: '2026-07-13' })
    expect(updated).toMatchObject({ version: 2, lossDate: '2026-07-12', notificationDate: '2026-07-13' })
  })
})
