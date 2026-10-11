import { describe, expect, it, vi } from 'vitest'
import { createHttpUsersAdapter } from './usersPort'

const input = { displayName: 'Sentetik Eksper', email: 'expert@example.test', password: 'sentetik-parola-25', roles: ['expert'] as const }
const record = { id: '11111111-1111-4111-8111-111111111111', displayName: input.displayName, email: input.email, roles: ['expert'], status: 'active', version: 1 }

describe('user creation HTTP adapter', () => {
  it('sends a real authenticated POST and validates the server response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ user: record }), { status: 201 }))
    expect(await createHttpUsersAdapter({ fetchImpl }).create(input)).toEqual(record)
    expect(fetchImpl).toHaveBeenCalledWith('/api/v1/users', expect.objectContaining({ method: 'POST', credentials: 'include', body: JSON.stringify(input) }))
  })
  it('distinguishes duplicate email from a version conflict', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, error: { code: 'user_email_in_use' } }), { status: 409 }))
    await expect(createHttpUsersAdapter({ fetchImpl }).create(input)).rejects.toMatchObject({ kind: 'email_in_use' })
  })
  it('never treats an invalid success body as a saved user', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ user: { ...record, password: input.password } }), { status: 201 }))
    await expect(createHttpUsersAdapter({ fetchImpl }).create(input)).rejects.toMatchObject({ kind: 'unavailable' })
  })
})
