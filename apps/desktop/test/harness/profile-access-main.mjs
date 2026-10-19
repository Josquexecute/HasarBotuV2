import { app } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startDesktopShell } from '../../dist/main/shell.js'
import { assertTestDatabaseUrl, createDatabasePool, runMigrations, uuidv7 } from '../../../../packages/database/dist/index.js'
import { buildApp, hashPassword } from '../../../../services/api/dist/index.js'

const checks = [], shells = [], apis = []
const check = (name, pass) => { checks.push({ name, pass: Boolean(pass) }); if (!pass) throw new Error(name) }
async function until(predicate, label) {
  const deadline = Date.now() + 35_000
  while (!await predicate()) { if (Date.now() > deadline) throw new Error(label + ' timed out'); await new Promise(done => setTimeout(done, 50)) }
}
app.enableSandbox()
app.on('window-all-closed', () => {})
void app.whenReady().then(async () => {
  let pool
  try {
    const config = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    const org = uuidv7(), admin = uuidv7(), employee = uuidv7(), password = 'Synthetic-Profile-UI-42!'
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'profile-ui','Synthetic')", [org])
    const passwordHash = await hashPassword(password)
    for (const [id, name, role] of [[admin, 'Ofis Yöneticisi', 'admin'], [employee, 'Eski Ad Soyad', 'read_only']]) {
      await pool.query('INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,$4,$5)', [id, org, `${id}@example.test`, name, passwordHash])
      await pool.query('INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code=$2', [id, role])
    }
    await pool.query(`INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,case_type,lifecycle_status,workflow_stage,plate,plate_normalized,responsible_user_id)
      VALUES($1,$2,2026,1,'2026/1','traffic','open','reporting','34 ABC 123','34ABC123',$3)`, [uuidv7(), org, employee])
    for (const id of [admin, employee]) {
      const api = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false } })
      apis.push(api)
      const apiOrigin = await api.listen({ host: '127.0.0.1', port: 0 })
      const login = await api.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: `${id}@example.test`, password } })
      check('authenticated real API session for ' + (id === admin ? 'admin' : 'read-only user'), login.statusCode === 200)
      const shell = await startDesktopShell({ apiOrigin, assetRoot: process.env.HB_PROFILE_ASSETS, show: false })
      shells.push(shell)
      // Two active office computers must keep polling even when one fixture window is occluded here.
      shell.window.webContents.setBackgroundThrottling(false)
      const cookie = String(login.headers['set-cookie']).split(';')[0], separator = cookie.indexOf('=')
      await shell.window.webContents.session.cookies.set({ url: shell.origin, name: cookie.slice(0, separator), value: cookie.slice(separator + 1), httpOnly: true, path: '/', sameSite: 'strict' })
      shell.window.setMinimumSize(320, 400); shell.window.setSize(1280, 820)
      // Exercise real visible-page synchronization without taking focus or intercepting the user's mouse.
      shell.window.setOpacity(0); shell.window.setSkipTaskbar(true); shell.window.setIgnoreMouseEvents(true); shell.window.showInactive()
      await shell.window.loadURL(shell.origin + (id === admin ? '/yonetim' : '/dosyalar'))
    }
    const [adminShell, employeeShell] = shells
    const evaluate = (shell, code) => shell.window.webContents.executeJavaScript(code)
    await until(() => evaluate(adminShell, 'document.querySelector(".management-content tbody tr") !== null'), 'administrator users')
    await until(() => evaluate(employeeShell, 'document.querySelector(".case-table tbody tr") !== null'), 'employee cases')
    const managementSelector = JSON.stringify('a[href="/yonetim"]')
    check('only administrator sees the management navigation', await evaluate(adminShell, `!!document.querySelector(${managementSelector})`) && await evaluate(employeeShell, `!document.querySelector(${managementSelector})`))
    check('independent cookies and sessions are used', await evaluate(adminShell, 'document.querySelector(".user-card").textContent.includes("Ofis Yöneticisi")') && await evaluate(employeeShell, 'document.querySelector(".user-card").textContent.includes("Eski Ad Soyad")'))
    await employeeShell.window.loadURL(employeeShell.origin + '/yonetim')
    await until(() => evaluate(employeeShell, 'document.querySelector("[role=alert]")?.textContent.includes("yalnızca yöneticilere")'), 'direct route denial')
    check('non-admin direct management navigation is denied', true)
    const denied = await evaluate(employeeShell, `fetch('/api/v1/users/${admin}/profile',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({expectedVersion:1,displayName:'Unauthorized'})}).then(r=>r.status)`)
    check('non-admin cannot rename another user through the API', denied === 403)
    await employeeShell.window.loadURL(employeeShell.origin + '/dosyalar')
    await until(() => evaluate(employeeShell, 'document.querySelector(".case-table tbody")?.textContent.includes("Eski Ad Soyad")'), 'initial owner name')
    check('active clients expose actual visible-page state', await evaluate(employeeShell, 'document.visibilityState === "visible"'))
    await evaluate(adminShell, `Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')==='Eski Ad Soyad ad soyadını düzenle').click()`)
    await until(() => evaluate(adminShell, `!!document.querySelector('input[aria-label="Ad Soyad: ${employee}@example.test"]')`), 'administrator name editor')
    const input = `document.querySelector('input[aria-label="Ad Soyad: ${employee}@example.test"]')`
    async function setInput(shell, selector, value) {
      await evaluate(shell, `(()=>{const input=${selector};Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`)
    }
    await setInput(adminShell, input, 'Yönetici Güncelledi')
    await evaluate(adminShell, `${input}.closest('form').requestSubmit()`)
    await until(async () => (await pool.query('SELECT display_name FROM users WHERE id=$1', [employee])).rows[0].display_name === 'Yönetici Güncelledi', 'administrator persistence')
    check('administrator change persists to the shared account', true)
    await until(() => evaluate(employeeShell, 'document.querySelector(".user-card").textContent.includes("Yönetici Güncelledi") && document.querySelector(".case-table tbody").textContent.includes("Yönetici Güncelledi")'), 'cross-client name synchronization')
    check('administrator rename updates the other live client sidebar and case owner without reload', true)
    await employeeShell.window.loadURL(employeeShell.origin + '/ayarlar')
    await until(() => evaluate(employeeShell, '!!document.querySelector("input[autocomplete=name]:not(:disabled)")'), 'personal name editor')
    await setInput(employeeShell, 'document.querySelector("input[autocomplete=name]")', 'Çalışan Kendi Düzenledi')
    await evaluate(employeeShell, 'document.querySelector("input[autocomplete=name]").closest("form").requestSubmit()')
    await until(() => evaluate(employeeShell, 'document.querySelector(".user-card").textContent.includes("Çalışan Kendi Düzenledi")'), 'self-change sidebar')
    check('read-only user can save their own name and immediately sees it', true)
    await until(() => evaluate(adminShell, 'document.querySelector(".management-content tbody").textContent.includes("Çalışan Kendi Düzenledi")'), 'self-change reaches administrator')
    check('employee rename synchronizes to the open administrator user list', true)
    check('sidebar displays a single name and no role subtitle', await evaluate(employeeShell, 'document.querySelectorAll(".user-card__copy strong").length===1 && !document.querySelector(".user-card__copy small")'))
    check('roles and account status remain intact', (await pool.query('SELECT status FROM users WHERE id=$1', [employee])).rows[0].status === 'active' && (await pool.query('SELECT r.code FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1', [employee])).rows[0].code === 'read_only')
    check('profile changes retain actor attribution', (await pool.query("SELECT count(DISTINCT actor_user_id)::int n FROM audit_events WHERE action='user.profile_updated'")).rows[0].n === 2)
    if (process.env.HB_CAPTURE_SCREENSHOTS === '1') { await writeFile(join(process.env.HB_PROFILE_EVIDENCE, 'profile-settings.png'), (await employeeShell.window.webContents.capturePage()).toPNG()) }
    if (process.env.HB_CAPTURE_SCREENSHOTS === '1') { await writeFile(join(process.env.HB_PROFILE_EVIDENCE, 'profile-management.png'), (await adminShell.window.webContents.capturePage()).toPNG()) }
    await evaluate(employeeShell, `document.querySelector('[aria-label="Koyu temaya geç"]').click()`)
    await until(() => evaluate(employeeShell, 'document.querySelector(".theme-root").dataset.theme === "dark"'), 'profile dark theme')
    check('personal name editor works in dark theme', await evaluate(employeeShell, '!document.querySelector("input[autocomplete=name]").disabled'))
    if (process.env.HB_CAPTURE_SCREENSHOTS === '1') { await writeFile(join(process.env.HB_PROFILE_EVIDENCE, 'profile-settings-dark.png'), (await employeeShell.window.webContents.capturePage()).toPNG()) }
    employeeShell.window.setSize(390, 820)
    await until(() => evaluate(employeeShell, 'innerWidth<500'), 'narrow settings viewport')
    check('profile input fits the narrow settings viewport', await evaluate(employeeShell, 'document.body.scrollWidth<=innerWidth && document.querySelector("input[autocomplete=name]").getBoundingClientRect().right<=innerWidth'))
    if (process.env.HB_CAPTURE_SCREENSHOTS === '1') { await writeFile(join(process.env.HB_PROFILE_EVIDENCE, 'profile-settings-mobile.png'), (await employeeShell.window.webContents.capturePage()).toPNG()) }
  } catch (error) {
    const state = []
    for (const shell of shells) {
      try { state.push(await shell.window.webContents.executeJavaScript('({visibility:document.visibilityState,name:document.querySelector(".user-card")?.textContent,rows:document.querySelector("tbody")?.textContent})')) }
      catch { state.push({ rendererUnavailable: true }) }
    }
    await writeFile(join(process.env.HB_PROFILE_EVIDENCE, 'failure-state.json'), JSON.stringify(state, null, 2))
    checks.push({ name: error instanceof Error ? error.message : 'Profile UI failed', pass: false })
  }
  finally {
    for (const shell of shells) await shell.close()
    for (const api of apis) await api.close()
    await pool?.end()
    await writeFile(process.env.HB_PROFILE_RESULT, JSON.stringify(checks, null, 2))
    await writeFile(join(process.env.HB_PROFILE_EVIDENCE, 'profile-ui-acceptance.json'), JSON.stringify({ checkedAt: new Date().toISOString(), checks }, null, 2))
    app.exit(checks.every(item => item.pass) ? 0 : 1)
  }
})
