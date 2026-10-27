import './test-display.mjs'
import { app } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startDesktopShell } from '../../dist/main/shell.js'

const checks = []
const check = (name, pass) => { checks.push({ name, pass: Boolean(pass) }); if (!pass) throw Error(name) }
let shell
const evaluate = async code => {
  let result
  try { result = await shell.window.webContents.executeJavaScript(`(async () => { try { return { value: await (${code}) } } catch (error) { return { error: error.message } } })()`) }
  catch (error) { throw Error(error.message + ': ' + code.slice(0, 300)) }
  if (result.error) throw Error(result.error + ': ' + code.slice(0, 300))
  return result.value
}
const until = async code => {
  const end = Date.now() + 12000
  while (!await evaluate(code)) {
    if (Date.now() > end) throw Error('SBM UI timed out: ' + code + '; ' + await evaluate('document.body.innerText.slice(-2200)'))
    await new Promise(done => setTimeout(done, 40))
  }
}
const button = text => evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)} && !b.disabled); if (!b) throw Error('Missing button'); b.click() })()`)
const field = (label, value, nested = false) => evaluate(`(() => {
  const scope = ${nested ? "document.querySelector('form:has(#service-revision-title)')" : 'document'}
  const el = [...scope.querySelectorAll('label')].find(l => l.querySelector('span')?.textContent.trim() === ${JSON.stringify(label)})?.querySelector('input,textarea,select') || scope.querySelector('[aria-label=' + CSS.escape(${JSON.stringify(label)}) + ']')
  if (!el) throw Error('Missing field: ' + ${JSON.stringify(label)})
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, ${JSON.stringify(value)})
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
})()`)
const contacts = async (phone, address, nested = false) => evaluate(`(() => {
  const scope = ${nested ? "document.querySelector('form:has(#service-revision-title)')" : 'document'}
  const value = text => [...scope.querySelectorAll('label')].find(l => l.querySelector('span')?.textContent === text)?.querySelector('input,textarea').value
  return value('Servis telefonu') === ${JSON.stringify(phone)} && value('Servis adresi') === ${JSON.stringify(address)}
})()`)
const revision = async name => {
  await until(`!!document.querySelector('button[aria-label="Servisi revize et"]:not(:disabled)')`)
  await evaluate(`document.querySelector('[aria-label="Servisi revize et"]').click()`)
  await until('!!document.querySelector("#service-revision-title")')
  await field('Servis adı', '', true)
  check('deleting a service name preserves saved contacts', await contacts('0212 555 10 10', 'Kaynak Adres', true))
  await field('Servis adı', name, true)
  await button('Revizyonu uygula')
}
const detail = async id => {
  await shell.window.loadURL(`${shell.origin}/dosyalar/${id}`)
  await until('document.body.textContent.includes("Temel Bilgileri Düzenle")')
  await button('Temel Bilgileri Düzenle')
  await until(`!!document.querySelector('#edit-case-title, [aria-label="Servisi revize et"]')`)
}
app.enableSandbox()
app.on('window-all-closed', () => {})
void app.whenReady().then(async () => {
  try {
    shell = await startDesktopShell({ apiOrigin: process.env.HB_SBM_API, assetRoot: process.env.HB_SBM_ASSETS, userDataPath: app.getPath('userData'), show: false })
    await until('!!document.querySelector("input[name=email]")')
    await evaluate(`(() => { for (const [name,value] of ${JSON.stringify([['email', process.env.HB_SBM_EMAIL], ['password', process.env.HB_SBM_PASSWORD]])}) { const el=document.querySelector('input[name='+name+']'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value); el.dispatchEvent(new Event('input',{bubbles:true})) } })()`)
    await evaluate('document.querySelector(".login-card button[type=submit]").click()')
    await until('!!document.querySelector(".app-shell")')
    const ids = []
    for (let index = 0; index < 2; index++) {
      await shell.window.loadURL(`${shell.origin}/dosyalar?yeni=true`)
      await until('!!document.querySelector(".eksist-import textarea:not(:disabled)")')
      const text = `Talep İşlem Ref No: sbm-electron-${index}\nÜrün: Kasko\nPlaka: 34 TST ${700 + index}\nSigorta Şirketi: Sentetik Sigorta\nEksper Ad-Soyad: Sentetik Eksper\nEksper Atama Tarihi: 18.09.2026 12:00\nMarka: TEST\nAraç Tipi: MODEL\nModel Yılı: 2020\nAraç Tarife Grubu: OTOMOBİL\nMotor No: ENGINE12345\nŞasi No: WVWZZZ3CZEE144172\nTamirhane Yeri Bilgileri\nTamirhane Ad / Ünvan: Kaynak Servis\nTelefon: 0212 555 10 10\nAçık Adres: Kaynak Adres\nEkspertiz Yeri Bilgileri\nEkspertiz Yeri Ad/Ünvan: Yeni Servis\nTelefon: 0216 555 20 20\nAçık Adres: Yeni Adres`
      await field('Eksist metni veya panodan görsel', text)
      await button('Metni forma aktar')
      await until('document.querySelector("input[aria-label=Servis]")?.value === "Kaynak Servis"')
      check('SBM transfers only the repair service contacts', await contacts('0212 555 10 10', 'Kaynak Adres'))
      await revision('Kaynak Servis Düzeltildi')
      await field('İhbar tarihi', '2026-10-26')
      if (index === 1) await field('Servis telefonu', '0212 555 11 11')
      await button(index === 0 ? 'Kaydet ve detayını aç' : 'Kaydet ve kapat')
      await until('document.querySelector(".case-form-note")?.textContent.includes("kaydedildi")')
      const rows = await evaluate('(async () => (await (await fetch("/api/v1/cases?includeServiceDetails=true")).json()).items)()')
      const row = rows.find(row => row.plate.replaceAll(' ', '') === `34TST${700 + index}`)
      check('creation is persisted through the authenticated API', Boolean(row))
      ids.push(row.id)
    }
    await detail(ids[0])
    check('reopening a saved revision preserves both contact fields', await contacts('0212 555 10 10', 'Kaynak Adres'))
    await revision('Cancelled Correction')
    await evaluate(`document.querySelector('[aria-label="Pencereyi kapat"]').click()`)
    await detail(ids[0])
    check('cancelling the outer edit preserves the stored revision', await evaluate('document.querySelector("input[aria-label=Servis]").value === "Kaynak Servis Düzeltildi"') && await contacts('0212 555 10 10', 'Kaynak Adres'))
    await revision('Yeni Servis')
    check('selecting another service uses its own directory phone and matching SBM address', await contacts('0216 555 20 20', 'Yeni Adres'))
    await button('Değişiklikleri Kaydet')
    await until(`!document.querySelector('[aria-label="Servisi revize et"]')`)
    await detail(ids[0])
    check('new service contacts survive reload', await contacts('0216 555 20 20', 'Yeni Adres'))
    await until(`!!document.querySelector('button[aria-label="Servisi revize et"]:not(:disabled)')`)
    await evaluate(`document.querySelector('[aria-label="Servisi revize et"]').click()`)
    await until('!!document.querySelector("#service-revision-title")')
    await field('Servis adı', 'İletişimsiz Servis', true)
    check('a new service without verified contacts never inherits the former contacts', await contacts('', '', true))
    await button('Revizyonu uygula'); await button('Değişiklikleri Kaydet')
    await until(`!document.querySelector('[aria-label="Servisi revize et"]')`)
    await detail(ids[0])
    check('empty replacement contacts remain empty after persistence', await contacts('', ''))
  } catch (error) { checks.push({ name: error.message + '; after: ' + (checks.at(-1)?.name ?? 'startup'), pass: false }) }
  finally {
    await shell?.close()
    await writeFile(join(process.env.HB_SBM_OUTPUT, 'sbm-proof.json'), JSON.stringify({ checks }))
    app.exit(checks.every(check => check.pass) ? 0 : 1)
  }
})
