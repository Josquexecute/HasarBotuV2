import { describe, expect, it } from 'vitest'
import { createHttpAuthAdapter, HttpAuthError } from './authPort'
import { createHttpCaseCommandAdapter } from './commandPort'
import { createHttpCasesAdapter } from './httpAdapter'

/**
 * Gercek API uctan uca smoke (Paket 10): yalniz LIVE_API_BASE_URL verildiginde
 * kosar. Calisan API + Paket 06/09 seed'li test veritabani + gecerli kimlik
 * ister. Oturum cerezi login yanitindan alinip sonraki cagrilara enjekte edilir.
 */
const BASE_URL = process.env.LIVE_API_BASE_URL
const EMAIL = process.env.LIVE_API_EMAIL
const PASSWORD = process.env.LIVE_API_PASSWORD
const describeLive =
  BASE_URL === undefined || BASE_URL.length === 0 || EMAIL === undefined || PASSWORD === undefined
    ? describe.skip
    : describe

describeLive('Auth + komut gercek API uctan uca', () => {
  it('login -> bootstrap -> liste -> create -> update -> logout', async () => {
    let cookie = ''
    const captureFetch: typeof fetch = async (input, init) => {
      const response = await fetch(input, init)
      const setCookie = response.headers.get('set-cookie')
      if (setCookie !== null) cookie = setCookie.split(';')[0] as string
      return response
    }

    const auth = createHttpAuthAdapter({ baseUrl: BASE_URL as string, fetchImpl: captureFetch })
    const user = await auth.login(EMAIL as string, PASSWORD as string)
    expect(user.email).toBe(EMAIL)
    expect(cookie.length).toBeGreaterThan(0)

    const authWithCookie = createHttpAuthAdapter({ baseUrl: BASE_URL as string, headers: { cookie } })
    const bootstrapped = await authWithCookie.bootstrap()
    expect(bootstrapped?.id).toBe(user.id)

    const list = createHttpCasesAdapter({ baseUrl: BASE_URL as string, headers: { cookie } })
    await expect(list.listCases()).resolves.toBeInstanceOf(Array)

    const commands = createHttpCaseCommandAdapter({ baseUrl: BASE_URL as string, headers: { cookie } })
    const created = await commands.createCase({ caseType: 'traffic', plate: '34 LIVE 10', notificationFormNumber: 'F-LIVE-10' })
    expect(created.caseId.length).toBeGreaterThan(0)
    const updated = await commands.updateCase(created.caseId, { expectedVersion: 1, notificationFormNumber: 'F-LIVE-11' })
    expect(updated.caseId).toBe(created.caseId)

    // Node'da cerez otomatik tasinmaz; cikis cagrisi da oturum cerezini gondermeli.
    await authWithCookie.logout()
    await expect(list.listCases()).rejects.toMatchObject({ name: 'HttpCasesError', kind: 'unauthorized' })
  })

  it('gecersiz kimlik invalid_credentials firlatir', async () => {
    const auth = createHttpAuthAdapter({ baseUrl: BASE_URL as string })
    await expect(auth.login('yok@baran.example', 'yanlis-parola-123')).rejects.toMatchObject({
      name: 'HttpAuthError',
      kind: 'invalid_credentials',
    })
    expect(HttpAuthError).toBeDefined()
  })
})
