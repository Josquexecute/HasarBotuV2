import { generateKeyPairSync, sign } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { createGoogleProvider, isDesktopGoogleRedirect, parseGoogleConfig } from '../src/tracking/google.js'

const redirect = 'http://127.0.0.1:54321/api/v1/google/desktop/callback'
const env = { GOOGLE_CLIENT_ID: 'web.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'synthetic-web',
  GOOGLE_REDIRECT_URI: 'https://office.example/api/v1/google/callback', GOOGLE_TOKEN_ENCRYPTION_KEY: 'ab'.repeat(32), GOOGLE_LOGIN_DOMAIN: 'office.example' }

it('requires a distinct configured desktop client and rejects incomplete configuration', () => {
  for (const values of [{ GOOGLE_DESKTOP_CLIENT_ID: '' }, { GOOGLE_DESKTOP_CLIENT_ID: 'bad' },
    { GOOGLE_DESKTOP_CLIENT_ID: env.GOOGLE_CLIENT_ID }, { GOOGLE_DESKTOP_CLIENT_SECRET: 'orphan' }]) {
    expect(() => parseGoogleConfig({ ...env, ...values })).toThrow()
  }
  expect(() => parseGoogleConfig({ GOOGLE_DESKTOP_CLIENT_ID: 'native.apps.googleusercontent.com' })).toThrow()
  expect(parseGoogleConfig({ ...env, GOOGLE_DESKTOP_CLIENT_ID: 'native.apps.googleusercontent.com' })).toMatchObject({ desktopClientId: 'native.apps.googleusercontent.com' })
})

it.each(['https://127.0.0.1:54321', 'http://localhost:54321', 'http://192.168.1.108:54321', 'http://[::1]:54321',
  'http://2130706433:54321', 'http://127.0.0.1:443', 'http://user@127.0.0.1:54321', 'http://127.0.0.1:65536'])('rejects a noncanonical native redirect %s', origin => {
  expect(isDesktopGoogleRedirect(`${origin}/api/v1/google/desktop/callback`)).toBe(false)
})

it('binds authorization and token exchange to the same loopback URI and desktop client', async () => {
  const config = parseGoogleConfig({ ...env, GOOGLE_DESKTOP_CLIENT_ID: 'native.apps.googleusercontent.com', GOOGLE_DESKTOP_CLIENT_SECRET: 'synthetic-native' })!
  const fetcher = vi.fn(async () => Response.json({ access_token: 'synthetic-only' }))
  const provider = createGoogleProvider(config, fetcher)
  const url = new URL(provider.authorizeUrl('login', 'state', 'nonce', 'verifier', redirect))
  expect(url.searchParams.get('client_id')).toBe(config.desktopClientId)
  expect(url.searchParams.get('redirect_uri')).toBe(redirect)
  expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  expect(url.searchParams.get('include_granted_scopes')).toBeNull()
  await provider.exchange('synthetic-code', 'verifier', redirect)
  const body = new URLSearchParams((fetcher.mock.calls as unknown as [string, RequestInit][])[0]![1].body as URLSearchParams)
  expect(Object.fromEntries(body)).toMatchObject({ client_id: config.desktopClientId, client_secret: 'synthetic-native', redirect_uri: redirect, code_verifier: 'verifier' })
  expect(body.get('client_secret')).not.toBe(env.GOOGLE_CLIENT_SECRET)
  expect(() => provider.authorizeUrl('mail', 'state', 'nonce', 'verifier', redirect)).toThrow()
  for (const bad of [redirect + '?x=1', redirect + '#x', redirect + '/', redirect.replace('/desktop/', '/')]) {
    expect(isDesktopGoogleRedirect(bad)).toBe(false)
    await expect(provider.exchange('code', 'verifier', bad)).rejects.toThrow()
  }
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('verifies signed native identities against desktop audience, nonce and corporate domain', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const config = parseGoogleConfig({ ...env, GOOGLE_DESKTOP_CLIENT_ID: 'native.apps.googleusercontent.com' })!
  const provider = createGoogleProvider(config, async () => Response.json({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' }] }))
  const jwt = (overrides = {}) => {
    const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url')
    const body = Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: config.desktopClientId, sub: 'synthetic',
      exp: Date.now() / 1000 + 60, iat: Date.now() / 1000, nonce: 'nonce', email: 'staff@office.example', email_verified: true, hd: 'office.example', ...overrides })).toString('base64url')
    return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`
  }
  expect(await provider.identity(jwt(), 'nonce', true, redirect)).toMatchObject({ email: 'staff@office.example' })
  for (const change of [{ aud: config.clientId }, { nonce: 'wrong' }, { hd: 'other.example' }, { email_verified: false }, { exp: 0 }]) {
    await expect(provider.identity(jwt(change), 'nonce', true, redirect)).rejects.toThrow()
  }
  await expect(provider.identity(jwt(), 'nonce', true)).rejects.toThrow()
})
