import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { unzipSync, strFromU8 } from 'fflate'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { downloadElectronFixture } from './electron-fixture-download.mjs'

/** Real session + API + Electron preview/print/download acceptance using anonymized fixtures. */
export async function verifyNoticeSheetDelivery({ page, electron, caseId, caseType, output }) {
  const request = (url, method = 'GET', body) => page.evaluate(async ({ url, method, body }) => {
    const response = await fetch(url, { method, credentials: 'include', headers: { 'content-type': 'application/json', 'x-hasarbotu-notice-sheet-fields': '3' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    return { status: response.status, body: await response.json() }
  }, { url, method, body })
  const route = `/api/v1/cases/${caseId}/notice-sheet`
  const before = await request(route)
  assert.equal(before.status, 200)
  const fields = { insuredName: 'Sentetik Sigortalı AŞ', insuredPlate: '34 TST 5050', insuredMileage: '171717', insuredHeavyDamage: 'SIGORTALI_HASAR_KAYDI', insuredPreviousClaims: '9', insuredDamageHistory: 'SIGORTALI_GECMIS_HASAR', victimName: 'SENTETIK_MAGDUR', victimPlate: '34 TST 6060', victimMileage: '42424', victimHeavyDamage: 'MAGDUR_HASAR_KAYDI', victimPreviousClaims: '2', victimDamageHistory: 'MAGDUR_GECMIS_HASAR', iban: 'TR00_GIZLI_IBAN', missingDocuments: 'GIZLI_EVRAK_EKSIKLERI', serviceName: 'Sentetik Servis', vehicleDescription: '2024 Test Sedan' }
  const saved = await request(route, 'PUT', { confirmed: true, expectedVersion: before.body.version, overrides: { fields, documents: { statement: true, insuredLicense: false, victimRegistration: true } } })
  assert.equal(saved.status, 200)
  const origin = new URL(page.url()).origin
  await page.goto(`${origin}/dosyalar/${caseId}`)
  await page.getByRole('button', { name: /ihbar föyünü yazdır/i }).click()
  const dialog = page.getByRole('dialog')
  const paper = dialog.locator('.notice-sheet-preview .notice-sheet-paper')
  await paper.waitFor()
  const visible = await paper.innerText()
  assert.equal(await dialog.getByLabel('IBAN', { exact: true }).count(), 0)
  assert.equal(await dialog.getByText('Evrak kontrolü', { exact: true }).count(), 0)
  for (const secret of ['TR00_GIZLI_IBAN', 'GIZLI_EVRAK_EKSIKLERI']) assert.ok(!visible.includes(secret))
  assert.ok(visible.includes('Sentetik Sigortalı AŞ'))
  if (caseType === 'traffic') {
    for (const secret of ['171717', 'SIGORTALI_HASAR_KAYDI', 'SIGORTALI_GECMIS_HASAR']) assert.ok(!visible.includes(secret))
    assert.ok(visible.includes('SENTETIK_MAGDUR') && visible.includes('42424'))
    assert.equal(await dialog.getByLabel('Sigortalı kilometre', { exact: true }).count(), 0)
  } else {
    for (const value of ['171717', 'SIGORTALI_HASAR_KAYDI', 'SIGORTALI_GECMIS_HASAR']) assert.ok(visible.includes(value))
    assert.ok(!visible.includes('SENTETIK_MAGDUR') && !visible.includes('42424'))
    assert.equal(await dialog.getByLabel('Mağdur kilometre', { exact: true }).count(), 0)
  }
  const layout = await paper.locator('.notice-sheet').evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth, height: element.clientHeight, scrollHeight: element.scrollHeight }))
  assert.ok(layout.scrollWidth <= layout.width + 1 && layout.scrollHeight <= layout.height + 1, 'Representative notice must fit A4 without clipping')
  const wordPath = `${output}/notice-${caseType}.docx`
  await downloadElectronFixture(electron, wordPath, () => dialog.getByRole('button', { name: 'Word indir', exact: true }).click())
  const zip = unzipSync(await readFile(wordPath))
  assert.ok(zip['[Content_Types].xml'] && zip['word/document.xml'])
  const xml = strFromU8(zip['word/document.xml'])
  for (const secret of ['TR00_GIZLI_IBAN', 'GIZLI_EVRAK_EKSIKLERI', ...(caseType === 'traffic' ? ['171717', 'SIGORTALI_HASAR_KAYDI', 'SIGORTALI_GECMIS_HASAR'] : ['SENTETIK_MAGDUR', '42424'])]) assert.ok(!xml.includes(secret))
  assert.ok(xml.includes(caseType === 'traffic' ? 'SENTETIK_MAGDUR' : '171717'))
  await page.evaluate(() => { window.print = () => {} })
  await dialog.getByRole('button', { name: 'Yazdır', exact: true }).click()
  await dialog.getByRole('button', { name: 'Yazıcıya gönder', exact: true }).click()
  await page.waitForFunction(() => document.body.classList.contains('printing-notice-sheet'))
  await page.emulateMedia({ media: 'print' })
  const printed = await electron.evaluate(async ({ BrowserWindow }, url) => {
    const contents = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === url)?.webContents
    if (!contents) throw new Error('The notice preview window must exist')
    return (await contents.printToPDF({ printBackground: true, preferCSSPageSize: true })).toString('base64')
  }, page.url())
  const pdfBytes = Buffer.from(printed, 'base64')
  await writeFile(`${output}/notice-${caseType}.pdf`, pdfBytes)
  const loadingTask = getDocument({ data: new Uint8Array(pdfBytes), isEvalSupported: false })
  const pdf = await loadingTask.promise
  assert.equal(pdf.numPages, 1)
  const content = await (await pdf.getPage(1)).getTextContent()
  const text = content.items.map(item => 'str' in item ? item.str : '').join(' ')
  for (const secret of ['TR00_GIZLI_IBAN', 'GIZLI_EVRAK_EKSIKLERI', ...(caseType === 'traffic' ? ['171717', 'SIGORTALI_HASAR_KAYDI', 'SIGORTALI_GECMIS_HASAR'] : ['SENTETIK_MAGDUR', '42424'])]) assert.ok(!text.includes(secret))
  assert.ok(text.includes(caseType === 'traffic' ? 'SENTETIK_MAGDUR' : '171717'))
  await loadingTask.destroy()
  await page.emulateMedia({ media: null })
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  await dialog.getByRole('button', { name: 'Düzenlemeye dön', exact: true }).click()
  await dialog.getByRole('button', { name: 'Otomatik bilgilere dön', exact: true }).click()
  await dialog.getByRole('button', { name: 'Kaydet', exact: true }).click()
  await dialog.getByText('Föy kaydedildi.', { exact: true }).waitFor()
  const preserved = await request(route)
  assert.equal(preserved.body.overrides.fields.iban, fields.iban)
  assert.equal(preserved.body.overrides.fields.missingDocuments, fields.missingDocuments)
  assert.deepEqual(preserved.body.overrides.documents, saved.body.overrides.documents)
  const result = { caseType, actualElectron: true, actualApi: true, editor: true, preview: true, printedPdfPages: 1, nativeDocx: true, hiddenDataPreserved: true, layout, screenshots: false }
  await writeFile(`${output}/notice-${caseType}-verification.json`, JSON.stringify(result, null, 2))
  return result
}
