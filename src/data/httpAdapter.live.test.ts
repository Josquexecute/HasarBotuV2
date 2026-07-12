import { describe, expect, it } from 'vitest'
import { createHttpCasesAdapter } from './httpAdapter'

/**
 * Gercek API smoke testi: yalniz LIVE_API_BASE_URL (+ LIVE_API_COOKIE)
 * verildiginde kosar; normal test kosusunda acikca atlanir. Calisan API,
 * Paket 07 seed'li test veritabani ve gecerli oturum cerezi ister.
 */
const BASE_URL = process.env.LIVE_API_BASE_URL
const COOKIE = process.env.LIVE_API_COOKIE
const describeLive = BASE_URL === undefined || BASE_URL.length === 0 ? describe.skip : describe

describeLive('HttpApiAdapter gercek API smoke', () => {
  it('oturumla gercek listeyi ceker ve UI modeline esler', async () => {
    const adapter = createHttpCasesAdapter({
      baseUrl: BASE_URL as string,
      headers: COOKIE !== undefined && COOKIE.length > 0 ? { cookie: COOKIE } : {},
    })
    const cases = await adapter.listCases()
    expect(cases.length).toBeGreaterThan(0)
    const mpa = cases.find((item) => item.plate === '34 MPA 764')
    expect(mpa).toBeDefined()
    expect(mpa).toMatchObject({ type: 'Kasko', stage: 'Ekspertiz Bekliyor', officeNumber: '2026/184' })
  })

  it('oturumsuz cagri unauthorized turunde HttpCasesError firlatir', async () => {
    const adapter = createHttpCasesAdapter({ baseUrl: BASE_URL as string })
    await expect(adapter.listCases()).rejects.toMatchObject({
      name: 'HttpCasesError',
      kind: 'unauthorized',
    })
  })
})
