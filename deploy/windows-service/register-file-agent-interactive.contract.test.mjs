import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import http from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  AGENTS_ROUTE,
  AGENT_DETAIL_ROUTE,
  AUTH_LOGIN_ROUTE,
  agentRegisterRequestSchema,
  agentRegisterResponseSchema,
  agentResponseSchema,
  agentUpdateRequestSchema,
  agentsListResponseSchema,
  loginRequestSchema,
  sessionResponseSchema,
} from '@hasarbotu/contracts'

// register-file-agent-interactive.ps1 icin GERCEK API sozlesme testleri
// (@hasarbotu/contracts'in gercek zod semalari + route sabitleriyle) ve
// SENTETIK rollback regresyon testleri (HB-2026-176).
//
// Bu makinede TEST_DATABASE_URL provizyonlanmadigi icin gercek, DB-destekli
// Fastify app'i (buildApp) burada calistiramiyoruz -- bunun yerine, GERCEK
// zod semalarini her istek/yanitta .parse() ile dogrulayan (semalardan
// herhangi biri driftlerse test derhal kirilir) minimal bir http mock
// sunucusu kullaniyoruz. Bu, "elle tahmin edilmis sekil" degil, reponun
// SU ANKI gercek sozlesmesine karsi calisan bir testtir.
//
// register-file-agent-interactive.ps1 hicbir zaman gercek Machine env'i
// bu testler tarafindan degistirilmez: her cagri -EnvScope Process ile
// yapilir (yalniz cagrilan alt-surecin kendi process ortam blogu).

const scriptPath = fileURLToPath(new URL('./register-file-agent-interactive.ps1', import.meta.url))
const scriptSource = readFileSync(scriptPath, 'utf8')

// --- Kaynak-sozlesme koprusu: ps1'deki sabit route string'leri gercek export'larla birebir ---
test('ps1 route sabitleri @hasarbotu/contracts export degerleriyle birebir eslesir', () => {
  assert.equal(AUTH_LOGIN_ROUTE, '/api/v1/auth/login')
  assert.equal(AGENTS_ROUTE, '/api/v1/agents')
  assert.equal(AGENT_DETAIL_ROUTE, '/api/v1/agents/:agentId')
  assert.match(scriptSource, /\$AuthLoginRoute\s*=\s*'\/api\/v1\/auth\/login'/)
  assert.match(scriptSource, /\$AgentsRoute\s*=\s*'\/api\/v1\/agents'/)
  assert.ok(scriptSource.includes('"$ApiBaseUrl$AgentsRoute/$agentId"'), 'PATCH cagrisi AGENT_DETAIL_ROUTE seklini (/agents/:agentId) gercekten kurar')
})

test('ps1 kesinlikle ZeroFreeGlobalAllocUnicode finally icinde cagirir', () => {
  assert.match(scriptSource, /finally\s*\{[\s\S]*ZeroFreeGlobalAllocUnicode\(\$passwordPtr\)/)
  assert.match(scriptSource, /SecureStringToGlobalAllocUnicode\(\$Credential\.Password\)/)
})

test('ps1 secret degerini asla Write-Host/Write-Output/exception mesajina yazmaz', () => {
  assert.ok(!/Write-(Host|Output).*\$agentSecretLocal/.test(scriptSource), 'agentSecretLocal dogrudan yazdirilmiyor')
  assert.ok(!/\$registerResp\.secret\s*\|\s*Write-/.test(scriptSource))
})

function createMockApiServer() {
  const state = {
    agents: [],
    adminEmail: 'admin@hasarbotu.test',
    adminPassword: 'Sentetik-Test-Parola-42!',
    sessionCookieValue: null,
    disableShouldFail: false,
    disableShouldReturnWrongStatus: false,
  }

  function readJsonBody(req) {
    return new Promise((resolve, reject) => {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        try { resolve(raw.length === 0 ? {} : JSON.parse(raw)) }
        catch (err) { reject(err) }
      })
      req.on('error', reject)
    })
  }

  function send(res, status, body) {
    const json = JSON.stringify(body)
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(json) })
    res.end(json)
  }

  function hasValidSession(req) {
    const cookie = req.headers.cookie ?? ''
    return state.sessionCookieValue !== null && cookie.includes(`hb_session=${state.sessionCookieValue}`)
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1')

      if (req.method === 'POST' && url.pathname === AUTH_LOGIN_ROUTE) {
        const body = loginRequestSchema.parse(await readJsonBody(req))
        if (body.email !== state.adminEmail || body.password !== state.adminPassword) {
          return send(res, 401, { ok: false, error: { code: 'unauthorized' } })
        }
        state.sessionCookieValue = randomBytes(16).toString('hex')
        res.setHeader('set-cookie', `hb_session=${state.sessionCookieValue}; Path=/; HttpOnly`)
        const payload = sessionResponseSchema.parse({
          user: { id: randomUUID(), organizationId: randomUUID(), email: body.email, displayName: 'Test Admin', roles: ['admin'] },
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        })
        return send(res, 200, payload)
      }

      if (!hasValidSession(req)) return send(res, 401, { ok: false, error: { code: 'unauthorized' } })

      if (req.method === 'GET' && url.pathname === AGENTS_ROUTE) {
        return send(res, 200, agentsListResponseSchema.parse({ items: state.agents }))
      }

      if (req.method === 'POST' && url.pathname === AGENTS_ROUTE) {
        const body = agentRegisterRequestSchema.parse(await readJsonBody(req))
        const agent = { id: randomUUID(), name: body.name, status: 'active', lastSeenAt: null, createdAt: new Date().toISOString() }
        const secret = randomBytes(24).toString('hex')
        state.agents.push(agent)
        return send(res, 201, agentRegisterResponseSchema.parse({ agent, secret }))
      }

      const patchMatch = /^\/api\/v1\/agents\/([^/]+)$/.exec(url.pathname)
      if (req.method === 'PATCH' && patchMatch) {
        const body = agentUpdateRequestSchema.parse(await readJsonBody(req))
        if (state.disableShouldFail) return send(res, 500, { ok: false, error: { code: 'internal' } })
        const agent = state.agents.find((a) => a.id === patchMatch[1])
        if (agent === undefined) return send(res, 404, { ok: false, error: { code: 'not_found' } })
        agent.status = state.disableShouldReturnWrongStatus ? 'active' : body.status
        return send(res, 200, agentResponseSchema.parse({ agent }))
      }

      return send(res, 404, { ok: false, error: { code: 'not_found' } })
    }
    catch (err) {
      return send(res, 400, { ok: false, error: { code: 'bad_request', message: String(err?.message ?? err) } })
    }
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ url: `http://127.0.0.1:${port}`, state, close: () => new Promise((r) => server.close(r)) })
    })
  })
}

function runScript({ apiBaseUrl, agentName, email, password, forcePreflightFailure = false, forceEnvWriteFailure = false }) {
  // ONEMLI: async spawn() kullanilir, spawnSync DEGIL -- mock http sunucusu
  // AYNI Node surecinde/event loop'unda calisir; spawnSync event loop'u
  // TAMAMEN bloke eder, bu da PowerShell alt-surecinin geri-cagirdigi mock
  // sunucunun hicbir istegi kabul edemedigi bir kendi-kendine kilitlenmeye
  // (deadlock) yol acar. Bu, gercek register-file-agent-interactive.ps1
  // betiginde DEGIL, ilk taslak test kosucusunda bulunup duzeltilen gercek
  // bir hatadir (bagimsiz elle dogrulama betigin kendisinin dogru
  // calistigini kanitladi).
  const flags = []
  if (forcePreflightFailure) flags.push('-ForcePreflightFailureForTesting')
  if (forceEnvWriteFailure) flags.push('-ForceEnvWriteFailureForTesting')

  const inner = `
$ErrorActionPreference = 'Stop'
$sec = ConvertTo-SecureString ${JSON.stringify(password)} -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential(${JSON.stringify(email)}, $sec)
& ${JSON.stringify(scriptPath)} -ApiBaseUrl ${JSON.stringify(apiBaseUrl)} -AgentName ${JSON.stringify(agentName)} -EnvScope Process -Credential $cred ${flags.join(' ')}
$exitCode = $LASTEXITCODE
$idPresent = [bool]([Environment]::GetEnvironmentVariable('HASARBOTU_AGENT_ID','Process'))
$secretPresent = [bool]([Environment]::GetEnvironmentVariable('HASARBOTU_AGENT_SECRET','Process'))
Write-Output "___ENVCHECK___$(@{IdPresent=$idPresent;SecretPresent=$secretPresent} | ConvertTo-Json -Compress)"
exit $exitCode
`
  const encoded = Buffer.from(inner, 'utf16le').toString('base64')

  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error(`powershell.exe 30s icinde tamamlanmadi (agentName=${agentName})`)) }, 30000)
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (err) => { clearTimeout(timer); reject(err) })
    child.on('close', (status) => {
      clearTimeout(timer)
      try {
        const markerIndex = stdout.indexOf('___ENVCHECK___')
        assert.ok(markerIndex >= 0, `ENVCHECK marker not found in stdout:\n${stdout}\n---stderr---\n${stderr}`)
        const jsonText = stdout.slice(0, markerIndex).trim()
        const envCheckText = stdout.slice(markerIndex + '___ENVCHECK___'.length).trim()
        const json = JSON.parse(jsonText)
        const envCheck = JSON.parse(envCheckText)
        resolve({ exitCode: status, json, envCheck, stdout, stderr })
      }
      catch (err) { reject(new Error(`${err.message}\n---stdout---\n${stdout}\n---stderr---\n${stderr}`)) }
    })
  })
}

test('mutlu yol: kayit + Process-scope env yazimi + readback dogrulanir, secret asla stdout uzerinde cikmaz', async () => {
  const mock = await createMockApiServer()
  try {
    const agentName = `contract-test-${randomUUID().slice(0, 8)}`
    const { exitCode, json, envCheck, stdout } = await runScript({
      apiBaseUrl: mock.url, agentName, email: mock.state.adminEmail, password: mock.state.adminPassword,
    })
    assert.equal(exitCode, 0, `beklenmeyen exit code, stdout:\n${stdout}`)
    assert.equal(json.Status, 'registered')
    assert.equal(json.CredentialsConfigured, true)
    assert.ok(typeof json.AgentId === 'string' && json.AgentId.length > 0)
    assert.equal(json.Blockers.length, 0)
    assert.equal(envCheck.IdPresent, true)
    assert.equal(envCheck.SecretPresent, true)

    const createdAgent = mock.state.agents.find((a) => a.name === agentName)
    assert.ok(createdAgent, 'mock sunucuda gercekten bir agent olusturuldu')
    assert.equal(createdAgent.status, 'active')

    // secret hicbir sekilde ciktida gorunmemeli (alan adi bile ciktida yer almaz)
    assert.ok(!stdout.includes('secret'), 'stdout ciktisinda "secret" kelimesi gecmemeli')
  }
  finally { await mock.close() }
})

test('fail-closed: ayni isimde AKTIF agent varsa kayit hic denenmez', async () => {
  const mock = await createMockApiServer()
  try {
    const agentName = `contract-test-existing-${randomUUID().slice(0, 8)}`
    mock.state.agents.push({ id: randomUUID(), name: agentName, status: 'active', lastSeenAt: null, createdAt: new Date().toISOString() })
    const countBefore = mock.state.agents.length

    const { exitCode, json, envCheck } = await runScript({ apiBaseUrl: mock.url, agentName, email: mock.state.adminEmail, password: mock.state.adminPassword })

    assert.equal(exitCode, 2)
    assert.equal(json.Status, 'active_agent_exists')
    assert.equal(json.CredentialsConfigured, false)
    assert.ok(json.Blockers.length > 0)
    assert.equal(mock.state.agents.length, countBefore, 'yeni bir agent OLUSTURULMADI')
    assert.equal(envCheck.IdPresent, false)
    assert.equal(envCheck.SecretPresent, false)
  }
  finally { await mock.close() }
})

test('fail-closed: preflight (env yazma/okuma/silme) basarisizsa kayit hic denenmez', async () => {
  const mock = await createMockApiServer()
  try {
    const agentName = `contract-test-preflight-${randomUUID().slice(0, 8)}`
    const { exitCode, json } = await runScript({
      apiBaseUrl: mock.url, agentName, email: mock.state.adminEmail, password: mock.state.adminPassword, forcePreflightFailure: true,
    })
    assert.equal(exitCode, 2)
    assert.equal(json.Status, 'preflight_failed')
    assert.equal(json.CredentialsConfigured, false)
    assert.equal(mock.state.agents.length, 0, 'preflight basarisizsa API tarafina HICBIR cagri yapilmadi (agent olusmadi)')
  }
  finally { await mock.close() }
})

test('sentetik rollback: env yazimi (secret asamasinda) basarisiz olursa -- ID temizlenir, agent disabled olur', async () => {
  const mock = await createMockApiServer()
  try {
    const agentName = `contract-test-rollback-${randomUUID().slice(0, 8)}`
    const { exitCode, json, envCheck } = await runScript({
      apiBaseUrl: mock.url, agentName, email: mock.state.adminEmail, password: mock.state.adminPassword, forceEnvWriteFailure: true,
    })

    assert.equal(exitCode, 3)
    assert.equal(json.Status, 'rolled_back')
    assert.equal(json.CredentialsConfigured, false)
    assert.ok(typeof json.AgentId === 'string' && json.AgentId.length > 0)

    const agent = mock.state.agents.find((a) => a.id === json.AgentId)
    assert.ok(agent, 'agent gercekten kayit edilmisti (mock sunucuda mevcut)')
    assert.equal(agent.status, 'disabled', 'sunucu tarafinda GERCEKTEN devre disi birakildi (PATCH gercekten cagrildi ve etkili oldu)')

    // ID onceden BASARIYLA yazilmisti (kismi yazim senaryosu) -- rollback sonrasi KESINLIKLE temizlenmis olmali
    assert.equal(envCheck.IdPresent, false, 'kismi yazilan HASARBOTU_AGENT_ID rollback ile temizlendi')
    assert.equal(envCheck.SecretPresent, false, 'HASARBOTU_AGENT_SECRET hic yazilmadi')
  }
  finally { await mock.close() }
})

test('kritik: env yazimi VE disable cagrisi ikisi de basarisiz olursa -- gercek agent ID kritik blocker olarak raporlanir', async () => {
  const mock = await createMockApiServer()
  try {
    mock.state.disableShouldFail = true
    const agentName = `contract-test-critical-${randomUUID().slice(0, 8)}`
    const { exitCode, json, envCheck } = await runScript({
      apiBaseUrl: mock.url, agentName, email: mock.state.adminEmail, password: mock.state.adminPassword, forceEnvWriteFailure: true,
    })

    assert.equal(exitCode, 4)
    assert.equal(json.Status, 'critical_unrecoverable')
    assert.equal(json.CredentialsConfigured, false)
    assert.ok(typeof json.AgentId === 'string' && json.AgentId.length > 0)
    assert.ok(json.Blockers.some((b) => b.includes(json.AgentId)), 'kritik blocker mesaji gercek agent ID icerir')
    assert.ok(json.Blockers.some((b) => b.toUpperCase().includes('MANUEL')), 'manuel mudahale gerektigi acikca belirtilir')

    const agent = mock.state.agents.find((a) => a.id === json.AgentId)
    assert.ok(agent, 'agent DB tarafinda (mock) hala mevcut -- gercekten disabled edilemedi')
    assert.equal(agent.status, 'active', 'disable cagrisi basarisiz oldugu icin sunucu tarafinda hala active')

    assert.equal(envCheck.IdPresent, false, 'kismi yazilan ID yine de yerel ortamdan temizlendi')
    assert.equal(envCheck.SecretPresent, false)
  }
  finally { await mock.close() }
})

test('kritik senaryoda beklenmeyen PATCH yaniti (status alanı beklenmedik) da kritik blocker olarak ele alinir', async () => {
  const mock = await createMockApiServer()
  try {
    mock.state.disableShouldReturnWrongStatus = true
    const agentName = `contract-test-wrongstatus-${randomUUID().slice(0, 8)}`
    const { exitCode, json } = await runScript({
      apiBaseUrl: mock.url, agentName, email: mock.state.adminEmail, password: mock.state.adminPassword, forceEnvWriteFailure: true,
    })
    assert.equal(exitCode, 4)
    assert.equal(json.Status, 'critical_unrecoverable')
  }
  finally { await mock.close() }
})

test('yanlis parola: login 401 ile reddedilir, hicbir agent olusturulmaz', async () => {
  const mock = await createMockApiServer()
  try {
    const agentName = `contract-test-badauth-${randomUUID().slice(0, 8)}`
    const { exitCode, json } = await runScript({ apiBaseUrl: mock.url, agentName, email: mock.state.adminEmail, password: 'yanlis-parola' })
    assert.equal(exitCode, 1)
    assert.equal(json.Status, 'error')
    assert.equal(mock.state.agents.length, 0)
  }
  finally { await mock.close() }
})

test('gecersiz AgentName parametre dogrulamasinda ps1 seviyesinde reddedilir (ValidatePattern)', () => {
  const encoded = Buffer.from(
    `& ${JSON.stringify(scriptPath)} -ApiBaseUrl 'http://127.0.0.1:1' -AgentName '-invalid-name' -EnvScope Process -Credential (New-Object System.Management.Automation.PSCredential('a@b.c', (ConvertTo-SecureString 'x' -AsPlainText -Force)))`,
    'utf16le',
  ).toString('base64')
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { encoding: 'utf8', timeout: 15000 })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /ValidatePattern|does not match|eslesmiyor/i)
})
