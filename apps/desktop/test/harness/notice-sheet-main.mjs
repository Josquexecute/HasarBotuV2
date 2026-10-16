import { app } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startDesktopShell } from '../../dist/main/shell.js'
import { assertTestDatabaseUrl, createDatabasePool, runMigrations, uuidv7 } from '../../../../packages/database/dist/index.js'
import { buildApp, hashPassword } from '../../../../services/api/dist/index.js'
import { createNoticeSheetStore } from '../../../../services/api/dist/notice-sheets/store.js'

const checks = [], files = []
const check = (name, pass) => { checks.push({ name, pass: Boolean(pass) }); if (!pass) throw new Error(name) }
app.enableSandbox()
app.on('window-all-closed', () => {})
void app.whenReady().then(async () => {
  let pool, api, shell, error
  try {
    const config = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL)
    pool = createDatabasePool({ config })
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    await runMigrations({ databaseUrl: config.url, quiet: true })
    const organizationId = uuidv7(), userId = uuidv7(), insurerId = uuidv7(), serviceId = uuidv7()
    const email = 'notice-print@example.test', password = 'synthetic-notice-print-2026'
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'notice-print','Örnek Ekspertiz')", [organizationId])
    await pool.query("INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,'Örnek Kullanıcı',$4)", [userId, organizationId, email, await hashPassword(password)])
    await pool.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code='secretary'", [userId])
    await pool.query("INSERT INTO insurers(id,organization_id,name) VALUES($1,$2,'Örnek Sigorta A.Ş.')", [insurerId, organizationId])
    await pool.query("INSERT INTO service_centers(id,organization_id,name,center_type,service_type,phone) VALUES($1,$2,'Örnek Servis','ozel','private','0212 000 00 00')", [serviceId, organizationId])
    const cases = []
    for (const [index, type] of ['traffic', 'casco'].entries()) {
      const id = uuidv7(), plate = index ? '34 KSK 456' : '34 TRF 123'
      await pool.query(`INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,plate,plate_normalized,
        notification_date,loss_date,insurer_claim_number,notification_form_number,insurer_id,service_center_id)
        VALUES($1,$2,2026,$3,$4,$5,'new_notification',$6,$7,'2026-10-16','2026-10-15','2026-H-12345','IH-12345',$8,$9)`,
      [id, organizationId, index + 1, `2026/${index + 1}`, type, plate, plate.replaceAll(' ', ''), insurerId, serviceId])
      await createNoticeSheetStore(pool).save({ organizationId, userId, requestId: 'native-print-test' }, id, {
        expectedVersion: null, confirmed: true,
        overrides: { documents: { accidentReport: true, insuredRegistration: true }, fields: {
          inspectionDate: '2026-10-16', reportNumber: 'R-2026-12345', insuredPolicyPeriod: '01.01.2026 - 01.01.2027', victimPolicyPeriod: '01.02.2026 - 01.02.2027',
          recourse: 'İnceleniyor', deductible: 'Poliçe koşullarına göre kontrol edilecek', insuredFault: '%100', victimFault: '%0',
          insuredName: 'Sigortalı Örnek', insuredMileage: '82.150', insuredHeavyDamage: 'Kontrol edilecek', insuredPreviousClaims: '2',
          ...(type === 'traffic' ? { insuredPlate: '06 ORN 789', victimName: 'Mağdur Örnek', victimMileage: '42.750', victimHeavyDamage: 'Yok', victimPreviousClaims: '0' } : {}),
          vehicleDescription: 'Örnek Marka · Sedan 1.6 Otomatik · 2022', serviceContact: 'Örnek Yetkili', serviceAddress: 'Örnek Mahallesi Sanayi Caddesi No 12 İstanbul',
          procurement: 'Orijinal parça / tedarik teyidi bekleniyor', preliminaryReportDate: '2026-10-17', tramer: 'Sorgu kontrol edildi', iban: 'TR00 0000 0000 0000 0000 0000 00',
          missingDocuments: '1. Ehliyet fotokopisi\n2. Onarım faturası', inspectionNotes: 'Sentetik ekspertiz çalışması.\nÖn tampon ve sol ön çamurluk incelendi.\nFotoğraflar, kilometre ve şase bilgileri kontrol edildi.\nParça listesi servis ile karşılaştırılacak.',
        } },
      })
      cases.push({ id, plate, type })
    }
    api = buildApp({ loggerEnabled: false, auth: { pool, cookieSecure: false } })
    const apiOrigin = await api.listen({ host: '127.0.0.1', port: 0 })
    shell = await startDesktopShell({ apiOrigin, assetRoot: process.env.HB_NOTICE_ASSETS, userDataPath: app.getPath('userData'), show: false })
    const evaluate = code => shell.window.webContents.executeJavaScript(code, true)
    const until = predicate => evaluate(`new Promise((resolve,reject)=>{const observer=new MutationObserver(check);const timer=setTimeout(()=>{observer.disconnect();reject(Error('Notice print condition timed out'))},15000);function check(){if(${predicate}){observer.disconnect();clearTimeout(timer);resolve(true)}}observer.observe(document,{childList:true,subtree:true,attributes:true});check()})`)
    await evaluate(`fetch('/api/v1/auth/login',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify(${JSON.stringify({ email, password })})}).then(r=>{if(!r.ok)throw Error('Login failed');return true})`)
    for (const item of cases) {
      await shell.window.loadURL(`${shell.origin}/dosyalar/${item.id}`)
      const selector = `button[aria-label="${item.plate} ihbar föyünü yazdır"]`
      await until(`document.querySelector(${JSON.stringify(selector)})`)
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
      await until(`document.querySelector('.notice-sheet-preview .notice-sheet-paper')`)
      check(`${item.type}: populated preview fits A4`, await evaluate(`(()=>{const e=document.querySelector('.notice-sheet-preview .notice-sheet');return e.scrollHeight<=e.clientHeight+1 && e.scrollWidth<=e.clientWidth+1})()`))
      await evaluate(`window.__noticePrintCalls=0;window.print=()=>{window.__noticePrintCalls++};[...document.querySelectorAll('.notice-sheet-modal button')].find(b=>b.textContent.trim()==='Yazdır').click()`)
      await until(`document.body.classList.contains('printing-notice-sheet')`)
      const file = join(process.env.HB_NOTICE_OUTPUT, `${item.type}.pdf`)
      await writeFile(file, await shell.window.webContents.printToPDF({ printBackground: true, pageSize: 'A4', preferCSSPageSize: true, displayHeaderFooter: false }))
      files.push(file)
      await evaluate(`window.dispatchEvent(new Event('afterprint'))`)
      check(`${item.type}: print restores application state`, await evaluate(`window.__noticePrintCalls===1 && !document.body.classList.contains('printing-notice-sheet')`))
      await shell.window.loadURL(`${shell.origin}/dosyalar`)
      await until(`document.querySelector('tr '+${JSON.stringify(selector)})`)
      await evaluate(`document.querySelector('tr '+${JSON.stringify(selector)}).click()`)
      await until(`document.querySelector('.notice-sheet-save-state')?.textContent.includes('Sürüm 1')`)
      check(`${item.type}: row reopens saved sheet without navigating`, await evaluate(`location.pathname==='/dosyalar' && document.querySelectorAll('[role=dialog]').length===1 && document.querySelector('.notice-sheet-preview .notice-sheet__notes').textContent.includes('Sentetik ekspertiz çalışması')`))
      const overflowingNotes = JSON.stringify('Satır\n'.repeat(100))
      await evaluate(`(()=>{const area=[...document.querySelectorAll('.notice-sheet-editor textarea')].at(-1);Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(area,${overflowingNotes});area.dispatchEvent(new Event('input',{bubbles:true}));window.__noticePrintCalls=0})()`)
      await until(`document.querySelector('.notice-sheet-preview .notice-sheet__notes').textContent.includes('Satır')`)
      await evaluate(`[...document.querySelectorAll('.notice-sheet-modal button')].find(b=>b.textContent.trim()==='Kaydet ve Yazdır').click()`)
      await until(`document.querySelector('.notice-sheet-message[role=alert]')`)
      check(`${item.type}: actual overflow cannot print or save`, await evaluate(`window.__noticePrintCalls===0 && document.querySelector('.notice-sheet-message[role=alert]').textContent.includes('tek A4') && document.querySelector('.notice-sheet-save-state').textContent.includes('Kaydedilmemiş')`))
    }
  } catch (reason) { error = String(reason.stack ?? reason) }
  finally {
    await writeFile(process.env.HB_NOTICE_RESULT, JSON.stringify({ error, files, checks }))
    if (shell) await shell.close()
    if (api) await api.close()
    if (pool) await pool.end()
    app.quit()
  }
})
