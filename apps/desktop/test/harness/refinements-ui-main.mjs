import { app } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startDesktopShell } from '../../dist/main/shell.js'
import { assertTestDatabaseUrl,createDatabasePool,runMigrations,uuidv7 } from '../../../../packages/database/dist/index.js'
import { buildApp,hashPassword } from '../../../../services/api/dist/index.js'
import { observeFile } from '../../../../services/api/dist/tracking/store.js'

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
    shell.window.webContents.debugger.attach('1.3')
    const motion = value => shell.window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion',value }] })
    await motion('no-preference')
    const separator = cookie.indexOf('=')
    await shell.window.webContents.session.cookies.set({ url: shell.origin,name: cookie.slice(0,separator),value: cookie.slice(separator+1),httpOnly: true,path: '/',sameSite: 'strict' })
    shell.window.setMinimumSize(320,400)
    shell.window.setSize(1280,820)
    await shell.window.loadURL(`${shell.origin}/dosyalar`)
    const evaluate = (code) => shell.window.webContents.executeJavaScript(code)
    const settleMotion = () => evaluate('Promise.all(document.getAnimations().filter(animation=>animation.effect?.getComputedTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{}))).then(()=>true)')
    const clickAria = (label) => evaluate(`document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)}).click()`)
    const button = (label) => `Array.from(document.querySelectorAll('button')).find((item)=>item.textContent.trim()===${JSON.stringify(label)})`
    await until(() => evaluate('document.querySelectorAll(".case-table tbody tr").length>0 || document.querySelector("tbody")?.textContent.includes("34 TEST 001")'),'actual case list')
    await until(() => evaluate('document.querySelector(".brand__logo")?.complete'),'sidebar logo decode')
    check('original sidebar logo decodes and retains visible dimensions',await evaluate('(()=>{const logo=document.querySelector(".brand__logo");const box=logo.getBoundingClientRect();return logo.naturalWidth>0 && box.width>=32 && box.height>=32;})()'))
    await until(() => evaluate('document.querySelector(\'button[aria-label="Uyarıyı kapat"]\') !== null'),'owned popup')
    await clickAria('Uyarıyı kapat')
    await until(() => evaluate('!document.querySelector(".tracking-popup")'),'backlog dismissal')
    const dismissed = await pool.query('SELECT count(*)::int AS n FROM tracking_notifications WHERE case_id=$1 AND presented_at IS NOT NULL AND read_at IS NULL',[caseId])
    check('one dismissal closes all sixty notices while preserving the unread inbox',dismissed.rows[0].n === 60)
    await evaluate('Array.from(document.querySelectorAll("tbody tr")).find((row)=>row.textContent.includes("34 TEST 001")).click()')
    check('floating quick note is removed',await evaluate('document.querySelector(".touch-assistant-trigger") === null'))
    await evaluate(`${button('Hızlı Not')}.click()`)
    await until(() => evaluate('document.querySelector("textarea") && !document.querySelector(".touch-assistant").textContent.includes("Dosya kontrol ediliyor")'),'quick note workspace')
    check('note panel uses a short transform and opacity entrance',await evaluate('getComputedStyle(document.querySelector(".touch-assistant")).animationName === "panel-enter"'))
    await motion('reduce')
    check('system reduced motion removes panel animation and button motion',await evaluate('getComputedStyle(document.querySelector(".touch-assistant")).animationName === "none" && getComputedStyle(document.querySelector(".button")).transitionDuration === "0s"'))
    await motion('no-preference')
    await settleMotion()
    const body = Array.from({ length: 16 },(_,i) => `Satır ${i+1}: Çok satırlı hızlı not yerleşim kontrolü.`).join('\n')
    await evaluate(`(()=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(body)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`)
    await until(() => evaluate(`${button('Notu kaydet')}?.disabled===false`),'enabled save action')
    async function geometry(label,width,zoom) {
      shell.window.setSize(width,820);shell.window.webContents.setZoomFactor(zoom)
      await until(() => evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))'),'layout paint')
      await settleMotion()
      const result = await evaluate(`(()=>{const input=document.querySelector('textarea').getBoundingClientRect();const save=${button('Notu kaydet')}.getBoundingClientRect();const panel=document.querySelector('.touch-assistant');return {separate:input.bottom+4<=save.top,inside:input.width<=panel.clientWidth,scroll:document.body.scrollWidth<=innerWidth};})()`)
      check(`${label}: note text stays above the save control and inside the panel`,result.separate && result.inside && result.scroll)
      if (process.env.HB_CAPTURE_SCREENSHOTS === '1') { await writeFile(join(process.env.HB_REFINEMENTS_EVIDENCE,`quick-note-${label}.png`),(await shell.window.webContents.capturePage()).toPNG()) }
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
    await clickAria('Dosya sorumlusu')
    await until(() => evaluate('document.querySelectorAll(".searchable-select__popup [role=option]").length>1'),'responsible filter options')
    const filter = await evaluate(`(()=>{const select=document.querySelector('input[aria-label="Dosya sorumlusu"]');const status=document.querySelector('select[aria-label="Dosya durumu"]');return {names:Array.from(document.querySelectorAll('.searchable-select__popup [role=option]')).map(item=>item.textContent),statuses:Array.from(status.options).map(item=>item.text),dark:getComputedStyle(select).colorScheme,followUp:document.querySelector('select[aria-label="Takip tarihi durumu"]')!==null};})()`)
    check('responsible filter includes idle case managers and excludes expert-only users',filter.names.includes('Dosyasız Sorumlu') && !filter.names.includes('Yalnız Eksper'))
    await until(() => evaluate('document.querySelector(".case-table tbody").textContent.includes("Örnek Şirket Sorumlusu")'),'resolved current responsible names')
    check('case list resolves current responsible IDs into real display names',true)
    check('dark native filters use dark color scheme and only open/closed status options',filter.dark === 'dark' && filter.statuses.join(',') === 'Açık,Kapalı' && !filter.followUp)
    check('case rows stay compact with both folder and notice actions',await evaluate('document.querySelector(".case-table tbody tr").getBoundingClientRect().height <= 60'))
    await shell.window.loadURL(`${shell.origin}/bildirimler`)
    await until(() => evaluate('document.querySelectorAll(".notification-item").length===50'),'first inbox page')
    check('only owned notices appear on the fifty-row first page',!(await evaluate('document.body.textContent.includes("FOREIGN_NOTICE_SENTINEL")')))
    await evaluate(`${button('Sonraki')}.click()`)
    await until(() => evaluate('document.querySelectorAll(".notification-item").length===10'),'second inbox page')
    check('remaining owned notices are reachable through pagination',true)
    if (process.env.HB_CAPTURE_SCREENSHOTS === '1') { await writeFile(join(process.env.HB_REFINEMENTS_EVIDENCE,'notifications-inbox.png'),(await shell.window.webContents.capturePage()).toPNG()) }
    async function notificationGeometry(label,width,zoom) {
      shell.window.setSize(width,820);shell.window.webContents.setZoomFactor(zoom)
      await until(() => evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))'),'notification paint')
      const layout=await evaluate(`(()=>{const cards=Array.from(document.querySelectorAll('.notification-card')).slice(0,2).map(card=>card.getBoundingClientRect());return cards.length===2 && cards[0].right<=innerWidth && cards[1].top>=cards[0].bottom && document.body.scrollWidth<=innerWidth;})()`)
      check(`${label}: notification cards stay in one column without horizontal overflow`,layout)
      if (process.env.HB_CAPTURE_SCREENSHOTS === '1') { await writeFile(join(process.env.HB_REFINEMENTS_EVIDENCE,`notifications-${label}.png`),(await shell.window.webContents.capturePage()).toPNG()) }
    }
    await notificationGeometry('dark',1280,1)
    await notificationGeometry('narrow',390,1)
    await notificationGeometry('zoom',1280,1.5)
    shell.window.setSize(1280,820);shell.window.webContents.setZoomFactor(1)
    await clickAria('Açık temaya geç')
    await until(() => evaluate('document.querySelector(".theme-root").dataset.theme === "light"'),'notification light theme')
    await notificationGeometry('light',1280,1)
    await pool.query("INSERT INTO storage_roots(id,organization_id,root_key,label) VALUES($1,$2,'bulk-ui','Bulk UI')",[uuidv7(),org])
    for (const id of [caseId,otherCase]) await pool.query("INSERT INTO case_locations(id,organization_id,case_id,storage_root_key,relative_path) VALUES($1,$2,$3,'bulk-ui',$4)",[uuidv7(),org,id,id])
    for (let i=0;i<104;i++) await observeFile(pool,org,'ui-test-agent',{ caseId: i === 103 ? otherCase : caseId,locationVersion: 1,storageRootKey: 'bulk-ui',relativePath: `${i === 103 ? otherCase : caseId}/${i === 102 ? 'KM.jpg' : `evrak-${i}.pdf`}`,contentHash: String(i).padStart(64,'0'),byteSize: 200 })
    await evaluate(`${button('Tramer ve e-posta')}.click()`)
    const bulkButton = button('Hepsini uygun işaretle (103)')
    await until(() => evaluate(`${bulkButton} !== undefined`),'bulk approval control')
    check('bulk approval counts all owned documents while rendering only the first hundred',await evaluate('document.querySelectorAll(".tracking-document-row").length === 100'))
    const editedFile = await evaluate('document.querySelector(".tracking-document-row strong").textContent')
    await evaluate('document.querySelector(".tracking-document-row .text-button").click()')
    await evaluate(`(()=>{const row=document.querySelector('.tracking-document-row');const type=row.querySelector('select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(type,'victim_traffic_policy');type.dispatchEvent(new Event('change',{bubbles:true}));})()`)
    await evaluate(`(()=>{const note=document.querySelector('.tracking-document-row input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(note,'Toplu kontrol notu');note.dispatchEvent(new Event('input',{bubbles:true}));})()`)
    for (const [label,width,zoom] of [['light',1280,1],['narrow',390,1],['zoom',1280,1.5]]) {
      shell.window.setSize(width,820);shell.window.webContents.setZoomFactor(zoom)
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      await evaluate(`${bulkButton}.scrollIntoView({block:'center'})`)
      check(`${label}: bulk approval button fits the viewport`,await evaluate(`(()=>{const rect=${bulkButton}.getBoundingClientRect();return rect.left>=0 && rect.right<=innerWidth && document.body.scrollWidth<=innerWidth})()`))
      if (process.env.HB_CAPTURE_SCREENSHOTS === '1') { await writeFile(join(process.env.HB_REFINEMENTS_EVIDENCE,`bulk-approval-${label}.png`),(await shell.window.webContents.capturePage()).toPNG()) }
    }
    shell.window.setSize(1280,820);shell.window.webContents.setZoomFactor(1)
    await clickAria('Koyu temaya geç')
    await until(() => evaluate('document.querySelector(".theme-root").dataset.theme === "dark"'),'bulk dark theme')
    await settleMotion()
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    if (process.env.HB_CAPTURE_SCREENSHOTS === '1') { await writeFile(join(process.env.HB_REFINEMENTS_EVIDENCE,'bulk-approval-dark.png'),(await shell.window.webContents.capturePage()).toPNG()) }
    await evaluate(`${bulkButton}.focus();${bulkButton}.click()`)
    await until(() => evaluate('document.querySelector(".tracking-workspace [role=status]")?.textContent === "103 evrak uygun işaretlendi."'),'completed bulk approval')
    await until(() => evaluate('document.querySelectorAll(".tracking-document-row").length === 0'),'refreshed pending documents')
    const approved = (await pool.query('SELECT o.status,o.document_type,o.review_note,o.reviewed_by,o.file_name FROM document_observations o JOIN tracked_files f ON f.id=o.file_id WHERE f.case_id=$1',[caseId])).rows
    check('one real UI action approves all 103 documents through the authenticated API',approved.length === 103 && approved.every(row => row.status === 'approved' && row.reviewed_by === owner))
    check('bulk approval persists the edited category and note',approved.some(row => row.file_name === editedFile && row.document_type === 'victim_traffic_policy' && row.review_note === 'Toplu kontrol notu'))
    const audits = await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE resource_id=$1 AND action='tracking.document_reviewed' AND actor_user_id=$2",[caseId,owner])
    check('every bulk-approved document has its own owner audit entry',audits.rows[0].n === 103)
    const foreign = await pool.query('SELECT o.status FROM document_observations o JOIN tracked_files f ON f.id=o.file_id WHERE f.case_id=$1',[otherCase])
    check('another owner document remains pending',foreign.rows.length === 1 && foreign.rows[0].status === 'pending')
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    if (process.env.HB_CAPTURE_SCREENSHOTS === '1') { await writeFile(join(process.env.HB_REFINEMENTS_EVIDENCE,'bulk-approval-complete.png'),(await shell.window.webContents.capturePage()).toPNG()) }
    await clickAria('Açık temaya geç')
    await until(() => evaluate('document.querySelector(".theme-root").dataset.theme === "light"'),'bulk light theme restored')
    shell.window.setSize(390,844)
    await until(() => evaluate('innerWidth < 600 && !document.querySelector(".sidebar")'),'rendered mobile viewport')
    check('mobile menu opener remains visible',await evaluate('getComputedStyle(document.querySelector(".topbar__menu")).display !== "none"'))
    await evaluate('document.querySelector(".topbar__menu").focus();document.querySelector(".topbar__menu").click()')
    await until(() => evaluate('document.querySelector(".mobile-navigation") !== null'),'mobile drawer')
    check('mobile navigation makes the workspace inert',await evaluate('document.querySelector(".app-shell__main").inert'))
    check('mobile drawer uses the compositor-friendly navigation entrance',await evaluate('getComputedStyle(document.querySelector(".mobile-navigation")).animationName === "navigation-enter"'))
    await settleMotion()
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    if (process.env.HB_CAPTURE_SCREENSHOTS === '1') { await writeFile(join(process.env.HB_REFINEMENTS_EVIDENCE,'mobile-navigation.png'),(await shell.window.webContents.capturePage()).toPNG()) }
    await evaluate('document.querySelector(".mobile-navigation").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))')
    await until(() => evaluate('document.querySelector(".mobile-navigation") === null'),'drawer dismissal')
    check('Escape restores focus to the mobile menu opener',await evaluate('document.activeElement === document.querySelector(".topbar__menu")'))
    shell.window.setSize(1280,820)
    await shell.window.loadURL(`${shell.origin}/dosyalar/${caseId}`)
    await until(() => evaluate('document.querySelector(".case-detail-head .plate") !== null'),'case detail')
    check('detail plate retains its readable large text in the light theme',await evaluate('(()=>{const style=getComputedStyle(document.querySelector(".case-detail-head .plate"));return style.color === "rgb(17, 17, 17)" && style.fontSize === "19px"})()'))
    await clickAria('Koyu temaya geç')
    await until(() => evaluate('document.querySelector(".theme-root").dataset.theme === "dark"'),'detail dark theme')
    check('detail plate retains contrast in the dark theme',await evaluate('getComputedStyle(document.querySelector(".case-detail-head .plate")).color === "rgb(17, 17, 17)"'))
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    if (process.env.HB_CAPTURE_SCREENSHOTS === '1') { await writeFile(join(process.env.HB_REFINEMENTS_EVIDENCE,'case-detail-dark.png'),(await shell.window.webContents.capturePage()).toPNG()) }
    await clickAria('Oturumu kapat')
    await until(() => evaluate('document.querySelector(".login-card") !== null'),'login screen after actual logout')
    await shell.window.loadURL(shell.origin)
    await until(() => evaluate('document.querySelector(".login-card") !== null'),'login persists after reload')
    await until(() => evaluate('document.querySelector(".brand__logo")?.complete'),'login logo decode')
    check('login displays the project owner and copyright with a visible original logo',await evaluate('(()=>{const card=document.querySelector(".login-card");const logo=card.querySelector(".brand__logo");const box=logo.getBoundingClientRect();return card.textContent.includes("Ömer Faruk İŞLEYEN") && card.textContent.includes("© 2026 Ömer Faruk İŞLEYEN. Tüm hakları saklıdır.") && logo.naturalWidth>0 && box.width>=32 && box.height>=32;})()'))
    await settleMotion()
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    if (process.env.HB_CAPTURE_SCREENSHOTS === '1') { await writeFile(join(process.env.HB_REFINEMENTS_EVIDENCE,'ownership-login.png'),(await shell.window.webContents.capturePage(undefined,{stayHidden: true,stayAwake: true})).toPNG()) }
  } catch (error) { checks.push({ name: error instanceof Error ? error.message : 'Unexpected UI acceptance error',pass: false }) }
  finally {
    await shell?.close();await api?.close();await pool?.end()
    await writeFile(process.env.HB_REFINEMENTS_RESULT,JSON.stringify(checks,null,2))
    await writeFile(join(process.env.HB_REFINEMENTS_EVIDENCE,'refinements-ui-acceptance.json'),JSON.stringify({ checkedAt: new Date().toISOString(),checks },null,2))
    app.exit(checks.every((item) => item.pass) ? 0 : 1)
  }
})
