import { app } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startDesktopShell } from '../../dist/main/shell.js'
import { assertTestDatabaseUrl,createDatabasePool,runMigrations,uuidv7 } from '../../../../packages/database/dist/index.js'
import { buildApp,hashPassword } from '../../../../services/api/dist/index.js'
import { encryptToken } from '../../../../services/api/dist/tracking/google.js'
import { syncMailboxes } from '../../../../services/api/dist/tracking/mail-worker.js'

const checks = []
const check = (name,pass) => { checks.push({ name,pass: Boolean(pass) });if (!pass) throw new Error(name) }
const until = async (predicate,label) => {
  const deadline = Date.now()+25_000
  while (!(await predicate())) { if (Date.now()>deadline) throw new Error(`${label} timed out`);await new Promise((resolve) => setTimeout(resolve,30)) }
}
app.enableSandbox()
app.on('window-all-closed',() => {})
void app.whenReady().then(async () => {
  let pool,api,shell
  try {
    const config = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    await runMigrations({ databaseUrl: config.url,quiet: true })
    const org = uuidv7(),owner = uuidv7(),connectionId = uuidv7()
    const password = 'isolated-tramer-ui-password',email = 'tramer-owner@example.test'
    const google = { clientId: 'isolated',clientSecret: 'isolated',redirectUri: 'https://example.test/api/v1/google/callback',encryptionKey: 'ab'.repeat(32),sbmSenders: ['results@sbm.example'],automaticSbmEnabled: true,loginDomain: 'office.example' }
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'tramer-ui','Tramer UI Acceptance')",[org])
    await pool.query("INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,'Tramer Test Sorumlusu',$4)",[owner,org,email,await hashPassword(password)])
    await pool.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code='admin'",[owner])
    await pool.query(`INSERT INTO mail_connections(id,organization_id,connected_by,subject,email,encrypted_refresh_token,status)
      VALUES($1::uuid,$2,$3,$1::text,'tramer-mail@example.test',$4,'connected')`,[connectionId,org,owner,encryptToken('isolated-refresh',google.encryptionKey,`${org}:${connectionId}`)])
    api = buildApp({ loggerEnabled: false,auth: { pool,cookieSecure: false },google })
    const apiOrigin = await api.listen({ host: '127.0.0.1',port: 0 })
    const login = await fetch(`${apiOrigin}/api/v1/auth/login`,{ method: 'POST',headers: { 'content-type': 'application/json' },body: JSON.stringify({ email,password }) })
    check('actual HTTP login succeeds',login.status === 200)
    const cookie = login.headers.get('set-cookie').split(';')[0]
    const request = async (path,body) => {
      const response = await fetch(`${apiOrigin}/api/v1/${path}`,{ method: 'POST',headers: { cookie,'content-type': 'application/json','idempotency-key': uuidv7() },body: JSON.stringify(body) })
      if (!response.ok) throw new Error(`Synthetic request failed (${response.status})`)
      return response.status === 204 ? undefined : response.json()
    }
    const caseId = (await request('cases',{ caseType: 'traffic',plate: '34 TEST 310',responsibleUserId: owner })).case.id
    const number = '000123456789012345678901234567890'
    const open = async (path) => {
      shell = await startDesktopShell({ apiOrigin,assetRoot: process.env.HB_TRAMER_ASSETS,show: false })
      const separator = cookie.indexOf('=')
      await shell.window.webContents.session.cookies.set({ url: shell.origin,name: cookie.slice(0,separator),value: cookie.slice(separator+1),httpOnly: true,path: '/',sameSite: 'strict' })
      await shell.window.loadURL(`${shell.origin}${path}`)
    }
    await open(`/dosyalar/${caseId}`)
    const evaluate = (code) => shell.window.webContents.executeJavaScript(code)
    const button = (label) => `Array.from(document.querySelectorAll('button')).find((item)=>item.textContent.trim()===${JSON.stringify(label)})`
    const setField = (selector,value,tag = 'HTMLInputElement') => evaluate(`(()=>{const field=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${tag}.prototype,'value').set.call(field,${JSON.stringify(value)});field.dispatchEvent(new Event('${tag === 'HTMLSelectElement' ? 'change' : 'input'}',{bubbles:true}));})()`)
    await until(() => evaluate(`${button('Operasyon')} !== undefined`),'case operations tab')
    await evaluate(`${button('Operasyon')}.click()`)
    await until(() => evaluate('document.querySelector(".tracking-workspace select") !== null'),'Tramer assignment')
    await setField('.tracking-workspace select',owner,'HTMLSelectElement')
    await evaluate(`${button('Tramer sorumlusunu ata')}.click()`)
    await until(() => evaluate('document.querySelector(".tracking-workspace input[pattern]") !== null'),'Tramer number input')
    await setField('.tracking-workspace input[pattern]',number)
    await evaluate(`${button('Numarayı kaydet')}.click()`)
    await until(async () => (await pool.query('SELECT application_number FROM tramer_requests WHERE case_id=$1',[caseId])).rows[0]?.application_number === number,'persisted number')
    check('the real UI saves the exact long number including all leading zeros',true)
    await shell.window.reload()
    await until(() => evaluate(`document.querySelector('.tracking-workspace')?.textContent.includes(${JSON.stringify(number)})`),'saved number after reload')
    check('the saved number survives a full page reload',true)
    let messageNumber = number,messageId = 'actual-http-result'
    const provider = { refresh: async () => ({ access_token: 'isolated-access' }),gmail: async (_token,path) => path.startsWith('messages?') ? { messages: [{ id: messageId }] } : {
      id: messageId,internalDate: String(Date.now()),payload: { mimeType: 'text/plain',headers: [{ name: 'From',value: 'results@sbm.example' },{ name: 'Authentication-Results',value: 'mx.google.com; dmarc=pass header.from=sbm.example' }],body: { data: Buffer.from(`Başvuru no: ${messageNumber}\nSonuç: Tamamlandı`).toString('base64url') } },
    } }
    await syncMailboxes(pool,google,provider)
    await until(() => evaluate(`document.querySelector('.tracking-popup')?.textContent.includes(${JSON.stringify(`Tramer sonuçlandı — ${number}`)})`),'scheduled result popup')
    check('the normal polling timer displays the matching result popup without a manual refresh',await evaluate('document.querySelector(".tracking-popup").textContent.includes("34 TEST 310")'))
    check('the popup links to the exact matched case',await evaluate(`document.querySelector('.tracking-popup a').getAttribute('href') === ${JSON.stringify(`/dosyalar/${caseId}`)}`))
    await until(() => evaluate('Array.from(document.querySelectorAll(".tracking-row strong")).some(element=>element.textContent === "Tamamlandı")'),'updated Tramer status in the open case')
    check('the open case updates to completed without a manual refresh',true)
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))')
    await writeFile(join(process.env.HB_TRAMER_EVIDENCE,'tramer-result-popup.png'),(await shell.window.webContents.capturePage()).toPNG())
    await syncMailboxes(pool,google,provider)
    const state = (await pool.query('SELECT status,result_text FROM tramer_requests WHERE case_id=$1',[caseId])).rows[0]
    check('mailbox ingestion persists the actual completed outcome',state.status === 'completed' && state.result_text === 'Sonuç: Tamamlandı')
    check('a repeated mailbox scan creates exactly one permanent alert',(await pool.query('SELECT count(*)::int AS n FROM tracking_notifications WHERE case_id=$1',[caseId])).rows[0].n === 1)
    await shell.close();shell = undefined
    const closedCase = (await request('cases',{ caseType: 'traffic',plate: '34 TEST 311',responsibleUserId: owner })).case.id
    await request(`tracking/cases/${closedCase}/tramer`,{ action: 'assign',assignedUserId: owner })
    await request(`tracking/cases/${closedCase}/tramer`,{ action: 'number',applicationNumber: '000311',expectedVersion: 1 })
    messageId = 'desktop-closed-result';messageNumber = '000311'
    await syncMailboxes(pool,google,provider)
    check('the result and alert are stored while no desktop window exists',(await pool.query('SELECT count(*)::int AS n FROM tracking_notifications WHERE case_id=$1',[closedCase])).rows[0].n === 1)
    await open('/bildirimler')
    await until(() => evaluate('document.body.textContent.includes("Tramer sonuçlandı — 000311")'),'persistent result inbox after reopen')
    check('reopening the desktop shows the result received while it was closed',true)
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))')
    await writeFile(join(process.env.HB_TRAMER_EVIDENCE,'tramer-inbox-after-reopen.png'),(await shell.window.webContents.capturePage()).toPNG())
  } catch (error) { checks.push({ name: error instanceof Error ? error.message : 'Unexpected Tramer UI error',pass: false }) }
  finally {
    await shell?.close();await api?.close();await pool?.end()
    await writeFile(process.env.HB_TRAMER_RESULT,JSON.stringify(checks,null,2))
    await writeFile(join(process.env.HB_TRAMER_EVIDENCE,'tramer-ui-acceptance.json'),JSON.stringify({ checkedAt: new Date().toISOString(),mailProvider: 'synthetic',checks },null,2))
    app.exit(checks.every((item) => item.pass) ? 0 : 1)
  }
})
