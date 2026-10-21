import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, firefox, webkit, _electron, type BrowserContext, type Page } from '@playwright/test'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import type { FastifyInstance } from 'fastify'
import { assertTestDatabaseUrl, runMigrations, uuidv7 } from '@hasarbotu/database'
import { startDesktopBridge, type DesktopBridge } from '@hasarbotu/desktop-bridge'
import { buildApp } from '@hasarbotu/api'
import { createGoogleProvider, GMAIL_SCOPE, validateGoogleClaims, type GoogleConfig } from '../../../services/api/dist/tracking/google.js'

const require = createRequire(import.meta.url)
const assets = fileURLToPath(new URL('../../../dist/', import.meta.url))
describe.skipIf(!process.env.TEST_DATABASE_URL)('production Google OAuth in browsers and Electron (synthetic provider)', () => {
  let app: FastifyInstance, pool: pg.Pool, bridge: DesktopBridge, apiOrigin: string, work: string, userId: string
  const config: GoogleConfig = { clientId: 'synthetic-browser-client', clientSecret: 'synthetic-only', redirectUri: 'http://127.0.0.1/api/v1/google/callback', encryptionKey: 'a'.repeat(64), loginDomain: 'office.example', sbmSenders: ['sbm@sbm.org.tr'], automaticSbmEnabled: false }
  const flows = new Map<string, { nonce: string; verifier: string }>()
  beforeAll(async () => {
    const db = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL!)
    pool = new pg.Pool({ connectionString: db.url })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await runMigrations({ databaseUrl: db.url, quiet: true })
    work = await mkdtemp(join(tmpdir(), 'hb-google-browser-'))
    const org = uuidv7(); userId = uuidv7(); config.signupOrganizationId = org
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'google-browser','Synthetic browser office')", [org])
    await pool.query("INSERT INTO users(id,organization_id,email,display_name) VALUES($1,$2,'browser@office.example','Google Browser')", [userId, org])
    await pool.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code='admin'", [userId])
    const real = createGoogleProvider(config)
    app = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false }, google: config, googleProvider: { ...real,
      authorizeUrl: (purpose, state, nonce, verifier) => { flows.set(state, { nonce, verifier }); return real.authorizeUrl(purpose, state, nonce, verifier) },
      exchange: async (code, verifier) => {
        if (!flows.has(code) || flows.get(code)?.verifier !== verifier) throw new Error('Synthetic provider rejected code or PKCE verifier')
        return { access_token: 'synthetic-only', refresh_token: 'synthetic-only', id_token: code, scope: GMAIL_SCOPE }
      },
      identity: async (code, nonce, corporate) => validateGoogleClaims({ iss: 'https://accounts.google.com', aud: config.clientId, exp: Date.now() / 1000 + 600, iat: Date.now() / 1000, nonce: flows.get(code)?.nonce, email_verified: true, email: 'browser@office.example', sub: 'synthetic-browser-subject', hd: config.loginDomain }, config.clientId, nonce, corporate ? config.loginDomain : undefined),
      gmail: async () => ({ emailAddress: 'browser@office.example' }) } })
    // Independent synthetic browser clients must not share the loopback IP's production login quota.
    let clientNumber = 0
    app.addHook('onRequest', async request => {
      if (request.url === '/api/v1/google/start') Object.defineProperty(request, 'ip', { value: `127.2.0.${++clientNumber}` })
    })
    apiOrigin = await app.listen({ host: '127.0.0.1', port: 0 })
    config.redirectUri = `${apiOrigin}/api/v1/google/callback`
    bridge = await startDesktopBridge({ apiOrigin, assetRoot: assets })
  })
  afterAll(async () => {
    await bridge?.close(); await app?.close(); await pool?.end()
    if (work) await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  const session = (page: Page) => page.evaluate(async () => {
    const response = await fetch('/api/v1/auth/session', { credentials: 'include' })
    return { status: response.status, body: await response.json() }
  })
  async function fakeGoogle(context: BrowserContext, mode = 'success') {
    await context.route(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/, async route => {
      const state = new URL(route.request().url()).searchParams.get('state')!
      const redirectUri = new URL(route.request().url()).searchParams.get('redirect_uri')!
      const target = `${redirectUri}?state=${encodeURIComponent(state)}&${mode === 'denied' ? 'error=access_denied' : `code=${encodeURIComponent(state)}`}`
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset="utf-8"><title>Synthetic Google consent</title><a href="${target}">Test onayı</a>` })
    })
  }
  async function login(page: Page, context: BrowserContext) {
    await fakeGoogle(context)
    await page.goto(bridge.origin)
    const button = page.getByRole('button', { name: 'Kurumsal Google hesabıyla giriş' })
    await button.waitFor()
    const next = context.waitForEvent('page')
    await button.click()
    const popup = await next
    try { await popup.getByRole('link', { name: 'Test onayı' }).waitFor({ timeout: 8000 }) }
    catch { throw new Error(`Consent page did not open: ${new URL(popup.url()).pathname}; ${await page.locator('.google-connect__notice').textContent()}`) }
    expect(await popup.evaluate(() => window.opener === null)).toBe(true)
    await popup.getByRole('link', { name: 'Test onayı' }).click()
    await page.waitForFunction(() => !document.querySelector('.login-screen'))
    expect((await session(page)).body.user.id).toBe(userId)
    return popup
  }

  it.each([['Chromium', chromium], ['Firefox', firefox], ['WebKit', webkit]] as const)('%s updates the original session, closes script-opened tabs and supports reloads and mail linking', async (_name, engine) => {
    const browser = await engine.launch({ headless: true })
    const context = await browser.newContext(), page = await context.newPage()
    try {
      const cookieHeaders: Promise<string | null>[] = []
      page.on('response', response => {
        if (response.url().endsWith('/api/v1/google/complete')) cookieHeaders.push(response.headerValue('set-cookie'))
      })
      const popup = await login(page, context)
      await expect.poll(() => popup.isClosed(), { timeout: 8000 }).toBe(true)
      const cookies = await context.cookies(bridge.origin)
      expect(cookies.find(c => c.name === 'hb_session')?.httpOnly).toBe(true)
      expect((await Promise.all(cookieHeaders)).some(header => header?.includes('HttpOnly; SameSite=Strict'))).toBe(true)
      await page.reload()
      expect((await session(page)).body.user.id).toBe(userId)
      // The production shared button is mounted in tracking; the browser-bound mail API uses the same cookies.
      const mail = await page.evaluate(async () => (await fetch('/api/v1/google/start', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ purpose: 'mail', client: 'web' }) })).json())
      const callback = await context.newPage()
      await callback.goto(`${apiOrigin}/api/v1/google/callback?state=${mail.flowId}&code=${mail.flowId}`)
      expect(new URL(callback.url()).search).toBe('')
      expect(new URL(callback.url()).pathname).toBe('/api/v1/google/result/web/mail/success')
      const mailCompleted = await page.evaluate(async flowId => (await fetch('/api/v1/google/complete', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ flowId }) })).json(), mail.flowId)
      expect(mailCompleted.status).toBe('complete')
      expect((await session(page)).body.user.id).toBe(userId)
    } finally { await context.close(); await browser.close() }
  })

  for (const [name, engine] of [['Chromium', chromium], ['Firefox', firefox], ['WebKit', webkit]] as const) {
    // This Windows WebKit build reports None and sends Strict cookies cross-site; it cannot verify this boundary.
    it.skipIf(process.platform === 'win32' && engine === webkit)(`${name} enforces SameSite=Strict across sites`, async () => {
      const browser = await engine.launch({ headless: true }), context = await browser.newContext(), page = await context.newPage()
      try {
        await login(page, context)
        const foreign = await context.newPage()
        await foreign.route('https://foreign.example/', route => route.fulfill({ contentType: 'text/html', body: `<a href="${bridge.origin}/api/v1/auth/session">Continue</a>` }))
        await foreign.goto('https://foreign.example/')
        const crossSite = foreign.waitForResponse(bridge.origin + '/api/v1/auth/session')
        await foreign.getByRole('link', { name: 'Continue' }).click()
        expect((await crossSite).status()).toBe(401)
        expect((await session(page)).body.user.id).toBe(userId)
      } finally { await context.close(); await browser.close() }
    })
  }

  it.each([['Chromium', chromium], ['Firefox', firefox], ['WebKit', webkit]] as const)('%s renders mobile/reduced-motion outcomes and handles actual non-closable browser tabs', async (_name, engine) => {
    const browser = await engine.launch({ headless: true })
    const context = await browser.newContext({ reducedMotion: 'reduce' }), page = await context.newPage()
    try {
      for (const outcome of ['pending', 'approval', 'denied', 'expired', 'failed', 'success']) {
        await page.goto(`${apiOrigin}/api/v1/google/result/web/login/${outcome}`)
        await page.getByRole('heading', { level: 1 }).waitFor()
        for (const width of [320, 390, 768, 1440]) {
          await page.setViewportSize({ width, height: 844 })
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        }
        expect(await page.locator('.icon').evaluate(el => getComputedStyle(el).animationName)).toBe('none')
        await page.getByRole('link', { name: 'Uygulamaya Dön' }).focus()
        expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('A')
      }
      await page.waitForFunction(() => document.getElementById('return-hint')?.textContent?.includes('Tarayıcınız bu sekmeyi açık tutuyor'))
      expect(page.isClosed()).toBe(false)
      expect((await context.request.get(`${apiOrigin}/api/v1/auth/session`)).status()).toBe(401)
    } finally { await context.close(); await browser.close() }
  })

  it('shows denied consent in both the result tab and original web app without issuing a session', async () => {
    const browser = await chromium.launch({ headless: true }), context = await browser.newContext(), page = await context.newPage()
    try {
      await fakeGoogle(context, 'denied')
      await page.goto(bridge.origin)
      const next = context.waitForEvent('page')
      const started = page.waitForResponse(response => response.url().endsWith('/api/v1/google/start'))
      await page.getByRole('button', { name: 'Kurumsal Google hesabıyla giriş' }).click()
      expect((await started).status()).toBe(200)
      const popup = await next
      await popup.getByRole('link', { name: 'Test onayı' }).click()
      await popup.getByRole('heading', { name: 'İzin verilmedi.' }).waitFor()
      await page.getByRole('alert').filter({ hasText: 'Google bağlantısına izin verilmedi' }).waitFor()
      expect((await session(page)).status).toBe(401)
      expect(new URL(popup.url()).search).toBe('')
    } finally { await context.close(); await browser.close() }
  })

  it('recovers blocked popups and reloads through the actual restricted mobile web proxy', async () => {
    const { createFieldPortal } = await import(fileURLToPath(new URL('../../../scripts/field-portal-server.mjs', import.meta.url)))
    const portal = createFieldPortal({ directory: assets, upstream: apiOrigin, publicOrigin: 'http://127.0.0.1:0' })
    await new Promise<void>(done => portal.listen(0, '127.0.0.1', done))
    const origin = `http://127.0.0.1:${portal.address().port}`
    const browser = await chromium.launch({ headless: true }), context = await browser.newContext(), page = await context.newPage()
    const previousRedirect = config.redirectUri
    config.redirectUri = `${origin}/api/v1/google/callback`
    try {
      await fakeGoogle(context)
      await page.addInitScript(() => { window.open = () => null })
      await page.goto(origin + '/saha')
      await page.getByRole('button', { name: 'Kurumsal Google hesabıyla giriş' }).click()
      await page.getByText(/yeni sekmeyi engelledi/).waitFor()
      const next = context.waitForEvent('page')
      await page.getByRole('link', { name: 'Google sayfasını yeniden aç' }).click()
      const popup = await next
      await popup.getByRole('link', { name: 'Test onayı' }).waitFor()
      await page.reload()
      await page.getByText('Google bağlantısı kontrol ediliyor…').waitFor()
      await popup.getByRole('link', { name: 'Test onayı' }).click()
      await page.getByRole('textbox', { name: 'Plaka ara' }).waitFor()
      expect((await session(page)).body.user.id).toBe(userId)
      expect((await context.cookies()).find(c => c.name === 'hb_session')?.expires).toBe(-1)
    } finally {
      config.redirectUri = previousRedirect
      await context.close(); await browser.close()
      await new Promise<void>(done => portal.close(done))
    }
  })

  it('uses the real Electron external-browser gate, automatically focuses/reloads, persists the session and shows cancellation', async () => {
    const launch = () => _electron.launch({ executablePath: require('electron') as string,
      args: [fileURLToPath(new URL('./harness/google-oauth-main.mjs', import.meta.url)), `--user-data-dir=${join(work, 'electron-profile')}`],
      env: { ...process.env, HB_OAUTH_API: apiOrigin, HB_OAUTH_ASSETS: assets } })
    let electron = await launch()
    try {
      const page = await electron.firstWindow()
      await page.getByRole('button', { name: 'Kurumsal Google hesabıyla giriş' }).click()
      const opened = () => electron.evaluate(() => (globalThis as unknown as { oauthOpened: string[] }).oauthOpened)
      await expect.poll(async () => (await opened()).length, { timeout: 5000 }).toBe(1)
      const url = new URL((await opened())[0]!), state = url.searchParams.get('state')!
      expect(url.hostname).toBe('accounts.google.com')
      expect(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
      const result = await fetch(`${apiOrigin}/api/v1/google/callback?state=${state}&code=${state}`, { redirect: 'manual' })
      expect(result.headers.get('location')).toBe('/api/v1/google/result/desktop/login/success')
      expect(result.headers.get('set-cookie')).toBeNull()
      await page.waitForFunction(() => !document.querySelector('.login-screen'))
      expect((await session(page)).body.user.id).toBe(userId)
      expect(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isFocused())).toBe(true)
      await electron.close()
      electron = await launch()
      const restored = await electron.firstWindow()
      await restored.waitForFunction(() => !document.querySelector('.login-screen') && !!document.querySelector('.app-shell'))
      expect((await session(restored)).body.user.id).toBe(userId)
      await restored.evaluate(async () => { await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' }); location.reload() })
      await restored.getByRole('button', { name: 'Kurumsal Google hesabıyla giriş' }).click()
      await expect.poll(async () => (await opened()).length, { timeout: 5000 }).toBe(1)
      const deniedState = new URL((await opened())[0]!).searchParams.get('state')!
      expect((await fetch(`${apiOrigin}/api/v1/google/callback?state=${deniedState}&error=access_denied`, { redirect: 'manual' })).headers.get('location')).toBe('/api/v1/google/result/desktop/login/denied')
      await restored.getByRole('alert').filter({ hasText: 'Google bağlantısına izin verilmedi' }).waitFor()
      expect((await session(restored)).status).toBe(401)
    } finally { await electron.close() }
  })
})
