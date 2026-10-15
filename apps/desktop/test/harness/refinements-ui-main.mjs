import { app } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startDesktopShell } from '../../dist/main/shell.js'
import { assertTestDatabaseUrl,createDatabasePool,runMigrations,uuidv7 } from '../../../../packages/database/dist/index.js'
import { buildApp,hashPassword } from '../../../../services/api/dist/index.js'

const checks = []
const check = (name,pass) => { checks.push({ name,pass: Boolean(pass) });if (!pass) throw new Error(name) }
const until = async (predicate,label) => {
  const deadline = Date.now()+20_000
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
    const org = uuidv7(),owner = uuidv7(),otherOwner = uuidv7(),idleOwner = uuidv7(),expert = uuidv7()
    const password = 'isolated-ui-acceptance-password'
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'ui-acceptance','UI Acceptance')",[org])
    for (const [id,name,role] of [[owner,'Örnek Şirket Sorumlusu','case_manager'],[otherOwner,'Diğer Sorumlu','case_manager'],[idleOwner,'Dosyasız Sorumlu','case_manager'],[expert,'Yalnız Eksper','expert']]) {
      await pool.query('INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,$4,$5)',[id,org,`${id}@example.test`,name,await hashPassword(password)])
      await pool.query('INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code=$2',[id,role])
    }
    api = buildApp({ loggerEnabled: false,auth: { pool,cookieSecure: false } });await api.ready()
    const apiOrigin = await api.listen({ host: '127.0.0.1',port: 0 })
    const login = await api.inject({ method: 'POST',url: '/api/v1/auth/login',payload: { email: `${owner}@example.test`,password } })
    check('actual API login succeeds in the isolated database',login.statusCode === 200)
    const cookie = String(login.headers['set-cookie']).split(';')[0]
    async function create(plate,responsibleUserId) {
      const response = await api.inject({ method: 'POST',url: '/api/v1/cases',headers: { cookie,'idempotency-key': uuidv7() },payload: { caseType: 'traffic',plate,responsibleUserId,expertUserId: expert } })
      if (response.statusCode !== 201) throw new Error('Synthetic case creation failed')
      return response.json().case.id
    }
    const caseId = await create('34 TEST 001',owner),otherCase = await create('34 TEST 002',otherOwner)
    for (let i=0;i<63;i++) await pool.query(`INSERT INTO tracking_notifications(id,organization_id,case_id,recipient_user_id,event_key,kind,title)
      VALUES($1,$2,$3,$4,$5,'document',$6)`,[uuidv7(),org,i<60 ? caseId : otherCase,owner,`ui-${i}`,i<60 ? `Dosya gelişmesi ${i+1}` : 'FOREIGN_NOTICE_SENTINEL'])
    shell = await startDesktopShell({ apiOrigin,assetRoot: process.env.HB_REFINEMENTS_ASSETS,show: false })
    const separator = cookie.indexOf('=')
    await shell.window.webContents.session.cookies.set({ url: shell.origin,name: cookie.slice(0,separator),value: cookie.slice(separator+1),httpOnly: true,path: '/',sameSite: 'strict' })
    shell.window.setMinimumSize(320,400)
    shell.window.setSize(1280,820)
    await shell.window.loadURL(`${shell.origin}/dosyalar`)
    const evaluate = (code) => shell.window.webContents.executeJavaScript(code)
    const clickAria = (label) => evaluate(`document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)}).click()`)
    const button = (label) => `Array.from(document.querySelectorAll('button')).find((item)=>item.textContent.trim()===${JSON.stringify(label)})`
    await until(() => evaluate('document.querySelectorAll(".case-table tbody tr").length>0 || document.querySelector("tbody")?.textContent.includes("34 TEST 001")'),'actual case list')
    await until(() => evaluate('document.querySelector(\'button[aria-label="Uyarıyı kapat"]\') !== null'),'owned popup')
    await clickAria('Uyarıyı kapat')
    await until(() => evaluate('!document.querySelector(".tracking-popup")'),'backlog dismissal')
    const dismissed = await pool.query('SELECT count(*)::int AS n FROM tracking_notifications WHERE case_id=$1 AND presented_at IS NOT NULL AND read_at IS NULL',[caseId])
    check('one dismissal closes all sixty notices while preserving the unread inbox',dismissed.rows[0].n === 60)
    await evaluate('Array.from(document.querySelectorAll("tbody tr")).find((row)=>row.textContent.includes("34 TEST 001")).click()')
    check('floating quick note is removed',await evaluate('document.querySelector(".touch-assistant-trigger") === null'))
    await evaluate(`${button('Hızlı Not')}.click()`)
    await until(() => evaluate('document.querySelector("textarea") && !document.querySelector(".touch-assistant").textContent.includes("Dosya kontrol ediliyor")'),'quick note workspace')
    const body = Array.from({ length: 16 },(_,i) => `Satır ${i+1}: Çok satırlı hızlı not yerleşim kontrolü.`).join('\n')
    await evaluate(`(()=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(body)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`)
    await until(() => evaluate(`${button('Notu kaydet')}?.disabled===false`),'enabled save action')
    async function geometry(label,width,zoom) {
      shell.window.setSize(width,820);shell.window.webContents.setZoomFactor(zoom)
      await until(() => evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))'),'layout paint')
      const result = await evaluate(`(()=>{const input=document.querySelector('textarea').getBoundingClientRect();const save=${button('Notu kaydet')}.getBoundingClientRect();const panel=document.querySelector('.touch-assistant');return {separate:input.bottom+4<=save.top,inside:input.width<=panel.clientWidth,scroll:document.body.scrollWidth<=innerWidth};})()`)
      check(`${label}: note text stays above the save control and inside the panel`,result.separate && result.inside && result.scroll)
      await writeFile(join(process.env.HB_REFINEMENTS_EVIDENCE,`quick-note-${label}.png`),(await shell.window.webContents.capturePage()).toPNG())
    }
    await geometry('light',1280,1)
    await clickAria('Hızlı notu kapat')
    await clickAria('Koyu temaya geç')
    await until(() => evaluate('document.querySelector(".theme-root").dataset.theme === "dark"'),'effective dark theme')
    await evaluate(`${button('Hızlı Not')}.click()`)
    await until(() => evaluate(`${button('Notu kaydet')}?.disabled===false`),'restored draft')
    check('closing and reopening the quick note preserves the unsaved draft',await evaluate(`document.querySelector('textarea').value === ${JSON.stringify(body)}`))
    await geometry('dark',1280,1)
    await geometry('narrow',390,1)
    await geometry('zoom',1280,1.5)
    shell.window.setSize(1280,820);shell.window.webContents.setZoomFactor(1)
    await evaluate(`${button('Notu kaydet')}.click()`)
    await until(async () => (await pool.query('SELECT count(*)::int AS n FROM case_notes WHERE case_id=$1 AND body=$2',[caseId,body])).rows[0].n === 1,'persisted note')
    check('the note is saved once to the selected actual case',true)
    await clickAria('Hızlı notu kapat')
    const filter = await evaluate(`(()=>{const select=document.querySelector('select[aria-label="Dosya sorumlusu"]');const status=document.querySelector('select[aria-label="Dosya durumu"]');return {names:Array.from(select.options).map(item=>item.text),statuses:Array.from(status.options).map(item=>item.text),dark:getComputedStyle(select).colorScheme,followUp:document.querySelector('select[aria-label="Takip tarihi durumu"]')!==null};})()`)
    check('responsible filter includes idle case managers and excludes expert-only users',filter.names.includes('Dosyasız Sorumlu') && !filter.names.includes('Yalnız Eksper'))
    check('dark native filters use dark color scheme and only open/closed status options',filter.dark === 'dark' && filter.statuses.join(',') === 'Açık,Kapalı' && !filter.followUp)
    await shell.window.loadURL(`${shell.origin}/bildirimler`)
    await until(() => evaluate('document.querySelectorAll(".notification-item").length===50'),'first inbox page')
    check('only owned notices appear on the fifty-row first page',!(await evaluate('document.body.textContent.includes("FOREIGN_NOTICE_SENTINEL")')))
    await evaluate(`${button('Sonraki')}.click()`)
    await until(() => evaluate('document.querySelectorAll(".notification-item").length===10'),'second inbox page')
    check('remaining owned notices are reachable through pagination',true)
    await writeFile(join(process.env.HB_REFINEMENTS_EVIDENCE,'notifications-inbox.png'),(await shell.window.webContents.capturePage()).toPNG())
    async function notificationGeometry(label,width,zoom) {
      shell.window.setSize(width,820);shell.window.webContents.setZoomFactor(zoom)
      await until(() => evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))'),'notification paint')
      const layout=await evaluate(`(()=>{const cards=Array.from(document.querySelectorAll('.notification-card')).slice(0,2).map(card=>card.getBoundingClientRect());return cards.length===2 && cards[0].right<=innerWidth && cards[1].top>=cards[0].bottom && document.body.scrollWidth<=innerWidth;})()`)
      check(`${label}: notification cards stay in one column without horizontal overflow`,layout)
      await writeFile(join(process.env.HB_REFINEMENTS_EVIDENCE,`notifications-${label}.png`),(await shell.window.webContents.capturePage()).toPNG())
    }
    await notificationGeometry('dark',1280,1)
    await notificationGeometry('narrow',390,1)
    await notificationGeometry('zoom',1280,1.5)
    shell.window.setSize(1280,820);shell.window.webContents.setZoomFactor(1)
    await clickAria('Açık temaya geç')
    await until(() => evaluate('document.querySelector(".theme-root").dataset.theme === "light"'),'notification light theme')
    await notificationGeometry('light',1280,1)
  } catch (error) { checks.push({ name: error instanceof Error ? error.message : 'Unexpected UI acceptance error',pass: false }) }
  finally {
    await shell?.close();await api?.close();await pool?.end()
    await writeFile(process.env.HB_REFINEMENTS_RESULT,JSON.stringify(checks,null,2))
    await writeFile(join(process.env.HB_REFINEMENTS_EVIDENCE,'refinements-ui-acceptance.json'),JSON.stringify({ checkedAt: new Date().toISOString(),checks },null,2))
    app.exit(checks.every((item) => item.pass) ? 0 : 1)
  }
})
