import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import type { AgentConfig } from '@hasarbotu/file-agent'
import type { CaseReferenceDataPort } from '../../data/ports'
import { CaseCreateModal } from './CaseCreateModal'

const testUrl = process.env.TEST_DATABASE_URL
// Native loading keeps server-side import.meta URLs outside Vite's browser asset rewriting.
const nativeRequire = createRequire(resolve('package.json'))
const { buildApp, hashPassword } = nativeRequire(resolve('services/api/dist/index.js')) as typeof import('@hasarbotu/api')
const { createDatabasePool, assertTestDatabaseUrl, runMigrations, uuidv7 } = nativeRequire(resolve('packages/database/dist/index.js')) as typeof import('@hasarbotu/database')
const { createAgentApiClient, runOnce } = nativeRequire(resolve('services/file-agent/dist/index.js')) as typeof import('@hasarbotu/file-agent')
describe.skipIf(!testUrl)('UI → real API → isolated PostgreSQL → real File Agent → UI result', () => {
  let pool: ReturnType<typeof createDatabasePool>, app: ReturnType<typeof buildApp>, root: string, config: AgentConfig
  let userId: string, organizationId: string, cookie: string
  let fetchImpl: typeof fetch
  beforeAll(async () => {
    const database = assertTestDatabaseUrl(testUrl!)
    pool = createDatabasePool({ config: database })
    await runMigrations({ databaseUrl: database.url, quiet: true })
    organizationId = uuidv7(); userId = uuidv7()
    await pool.query('INSERT INTO organizations(id,code,name) VALUES ($1,$2,$3)', [organizationId, `ui-${organizationId}`, 'Isolated UI Test'])
    await pool.query('INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,$5)', [userId, organizationId, `${userId}@example.test`, 'Test User', await hashPassword('isolated-test-password-123')])
    await pool.query("INSERT INTO user_roles(user_id,role_id) VALUES ($1,(SELECT id FROM roles WHERE code='admin'))", [userId])
    await pool.query("INSERT INTO storage_roots(id,organization_id,root_key,label) VALUES ($1,$2,'test-root','Test Root')", [uuidv7(), organizationId])
    app = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false } })
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: `${userId}@example.test`, password: 'isolated-test-password-123' } })
    cookie = String(login.headers['set-cookie']).split(';')[0]!
    const registered = (await app.inject({ method: 'POST', url: '/api/v1/agents', headers: { cookie }, payload: { name: 'UI Test Agent' } })).json()
    root = await mkdtemp(join(tmpdir(), 'eksist-ui-'))
    config = { apiBaseUrl: '', agentId: registered.agent.id, agentSecret: registered.secret, roots: { 'test-root': root }, leaseSeconds: 120, pollIntervalMs: 1000, freshnessGate: { toolPath: resolve('services/api/test/fixtures/always-ready-freshness-gate.mjs'), pcloudLocalDatabasePath: 'unused', topLevelFolderName: 'unused', attestationStoreDirectory: 'unused' } }
    fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const response = await app.inject({ method: (init?.method ?? 'GET') as 'POST' | 'GET', url: String(url), headers: { cookie, ...init?.headers as Record<string, string> }, ...(init?.body ? { payload: String(init.body) } : {}) })
      return new Response(response.body, { status: response.statusCode, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
  }, 30_000)
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })
  afterAll(async () => {
    await app?.close(); await pool?.end()
    if (root) await rm(root, { recursive: true, force: true })
  })
  it.each(['Kaydet ve kapat', 'Kaydet ve detayını aç'])('%s requires physical folder verification and leaves case open', async button => {
    vi.stubGlobal('fetch', fetchImpl)
    const references: CaseReferenceDataPort = { getCaseReferences: async () => ({ users: [{ id: userId, displayName: 'Test User' }], insurers: [], services: [], experts: [] }) }
    render(<MemoryRouter initialEntries={['/yeni']}><Routes>
      <Route path="/yeni" element={<CaseCreateModal currentUser={{ id: userId, organizationId, displayName: 'Test User', email: 'test@example.test', roles: ['admin'] }} onClose={() => undefined} onUnauthorized={() => { throw new Error('unexpected unauthorized') }} referencePort={references} />} />
      <Route path="/dosyalar" element={<p>DOĞRULANDI LİSTE</p>} /><Route path="/dosyalar/:id" element={<p>DOĞRULANDI DETAY</p>} />
    </Routes></MemoryRouter>)
    await waitFor(() => expect(screen.getByRole('button', { name: button })).toBeEnabled())
    fireEvent.change(screen.getByLabelText('Eksist metni veya panodan görsel'), { target: { value: `Talep İşlem Ref No: ${button === 'Kaydet ve kapat' ? '88001' : '88002'}\nÜrün: Trafik\nPlaka: 034 - TR2491\nSigorta Şirketi: Sentetik Sigorta\nEksper Ad-Soyad: Sentetik Eksper\nEksper Atama Tarihi: 18.09.2026 12:00\nMarka: TEST\nAraç Tipi: MODEL\nModel Yılı: 2020\nAraç Tarife Grubu: OTOMOBİL\nMotor No: ENGINE12345\nŞasi No: WVWZZZ3CZEE144172` } })
    await userEvent.click(screen.getByRole('button', { name: 'Metni forma aktar' }))
    await screen.findByLabelText('Eksist talep referansı *')
    fireEvent.change(screen.getByLabelText(/İhbar tarihi/), { target: { value: '2026-09-19' } })
    await userEvent.click(screen.getByRole('button', { name: button }))
    await screen.findByText(/henüz doğrulanmadı/)
    expect(screen.queryByText(/DOĞRULANDI/)).not.toBeInTheDocument()
    const client = createAgentApiClient({ baseUrl: '', agentId: config.agentId, secret: config.agentSecret, fetchImpl })
    const run = await runOnce(client, config)
    expect(run.kind).toBe('reported')
    if (run.kind === 'reported') expect(run.reported.status).toBe('succeeded')
    await screen.findByText(button === 'Kaydet ve kapat' ? 'DOĞRULANDI LİSTE' : 'DOĞRULANDI DETAY', {}, { timeout: 4000 })
    const rows = await pool.query('SELECT c.lifecycle_status,p.relative_path,p.status FROM cases c JOIN case_workspace_provisionings p ON p.case_id=c.id WHERE c.organization_id=$1', [organizationId])
    for (const row of rows.rows) {
      expect(row.lifecycle_status).toBe('open'); expect(row.status).toBe('ready')
      await access(join(root, row.relative_path))
    }
  }, 15_000)
})
