import { expect, it } from 'vitest'
import { createNativeOAuthGuard } from '../src/native-oauth.js'

const origin = 'http://127.0.0.1:54321', state = 'synthetic-local-state-123456'
const callback = (value = state) => new URL(`${origin}/api/v1/google/desktop/callback?state=${value}&code=synthetic`)
function start(flowId = state, redirect = origin + '/api/v1/google/desktop/callback') {
  return Buffer.from(JSON.stringify({ flowId, url: 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ state: flowId, redirect_uri: redirect }) }))
}
it('accepts only flows issued to this receiver and consumes them after a completed callback', () => {
  const guard = createNativeOAuthGuard(origin)
  expect(guard.accepts(callback())).toBe(false)
  guard.remember(start(state, 'http://127.0.0.1:54322/api/v1/google/desktop/callback'))
  expect(guard.accepts(callback())).toBe(false)
  guard.remember(start())
  expect(guard.accepts(callback())).toBe(true)
  expect(guard.accepts(callback('another-client-state-123456'))).toBe(false)
  expect(guard.accepts(new URL(callback().href + '&state=duplicate'))).toBe(false)
  guard.complete(callback())
  expect(guard.accepts(callback())).toBe(false)
})
it('expires flow state, bounds memory and never registers malformed or non-Google responses', () => {
  let now = 0
  const guard = createNativeOAuthGuard(origin, () => now)
  for (const bytes of [Buffer.from('invalid'), Buffer.from('null'), Buffer.from(JSON.stringify({ flowId: state, url: 'https://evil.example/' }))]) guard.remember(bytes)
  expect(guard.accepts(callback())).toBe(false)
  guard.remember(start())
  now = 600_000
  expect(guard.accepts(callback())).toBe(false)
  for (let index = 0; index < 40; index++) guard.remember(start(`synthetic-local-state-${index}`))
  expect(guard.accepts(callback('synthetic-local-state-0'))).toBe(false)
  expect(guard.accepts(callback('synthetic-local-state-39'))).toBe(true)
})
