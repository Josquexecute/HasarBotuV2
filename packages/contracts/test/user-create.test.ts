import { describe, expect, it } from 'vitest'
import { userCreateRequestSchema } from '../src/index.js'

const input = { displayName: 'Yeni Kullanıcı', email: 'user@example.test', password: 'sentetik-parola-25', roles: ['case_manager'] }

describe('manual user creation contract', () => {
  it('normalizes name and email whitespace without modifying the password', () => {
    const parsed = userCreateRequestSchema.parse({ ...input, displayName: ' Yeni Kullanıcı ', email: ' user@example.test ', password: ' parola-boşluklu ' })
    expect(parsed).toMatchObject({ displayName: 'Yeni Kullanıcı', email: input.email, password: ' parola-boşluklu ' })
  })
  it.each([
    { displayName: '   ' }, { email: 'not-an-email' }, { password: 'short' },
    { password: 'x'.repeat(129) }, { roles: [] }, { roles: ['owner'] }, { organizationId: 'foreign-tenant' },
  ])('rejects invalid or client-owned tenant fields %j', fields => {
    expect(userCreateRequestSchema.safeParse({ ...input, ...fields }).success).toBe(false)
  })
})
