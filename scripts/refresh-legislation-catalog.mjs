import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { unzipSync } from 'fflate'

// Fixed official destinations: runtime users cannot submit fetch URLs.
const root = 'https://seddk.gov.tr/upload/Sigortacılık Mevzuatı/Genel Şartlar/'
const definitions = [
  { id: 'ktk', title: '2918 sayılı Karayolları Trafik Kanunu', kind: 'Kanun', publisher: 'Mevzuat Bilgi Sistemi', url: 'https://www.mevzuat.gov.tr/MevzuatMetin/1.5.2918.pdf', marker: 'KARAYOLLARI TRAFİK KANUNU', effectiveFrom: null },
  { id: 'ttk', title: '6102 sayılı Türk Ticaret Kanunu', kind: 'Kanun', publisher: 'Mevzuat Bilgi Sistemi', url: 'https://www.mevzuat.gov.tr/MevzuatMetin/1.5.6102.pdf', marker: 'TÜRK TİCARET KANUNU', effectiveFrom: '2012-07-01' },
  { id: 'tbk', title: '6098 sayılı Türk Borçlar Kanunu', kind: 'Kanun', publisher: 'Mevzuat Bilgi Sistemi', url: 'https://www.mevzuat.gov.tr/MevzuatMetin/1.5.6098.pdf', marker: 'TÜRK BORÇLAR KANUNU', effectiveFrom: '2012-07-01' },
  { id: 'traffic-conditions', title: 'Trafik Sigortası Genel Şartları', kind: 'Genel Şartlar', publisher: 'Mevzuat Bilgi Sistemi / SEDDK', url: 'https://www.mevzuat.gov.tr/MevzuatMetin/yonetmelik/9.5.20752.pdf', marker: 'ZORUNLU MALİ SORUMLULUK', effectiveFrom: '2015-06-01' },
  { id: 'casco-conditions', title: 'Kara Araçları Kasko Sigortası Genel Şartları', kind: 'Genel Şartlar', publisher: 'SEDDK', url: root + 'Mal Sigortaları/Kara Araçları Kasko Sigortası Genel Şartları.pdf', marker: 'Kasko Sigortası Genel Şartları', effectiveFrom: '2013-04-01' },
  { id: 'imm-conditions', title: 'İhtiyari Mali Sorumluluk Sigortası Genel Şartları', kind: 'Genel Şartlar', publisher: 'SEDDK', url: root + 'Sorumluluk Sigortaları/Motorlu Kara Taşıtları İhtiyari Mali Sorumluluk Sigortası Genel Şartları.pdf', marker: 'Mali Sorumluluk', effectiveFrom: null },
]
const normalize = s => s.toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim()
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const sources = []
for (const source of definitions) {
  const response = await fetch(new URL(source.url), { signal: AbortSignal.timeout(30_000), redirect: 'error' })
  if (!response.ok) throw new Error('official_source_http_failure:' + source.id)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length > 20_000_000 || Buffer.from(bytes.subarray(0, 4)).toString() !== '%PDF') throw new Error('official_source_not_pdf:' + source.id)
  const contentHash = sha(bytes)
  const task = getDocument({ data: bytes, useSystemFonts: false, verbosity: 0 })
  const pages = []
  try {
    const pdf = await task.promise
    if (pdf.numPages > 500) throw new Error('official_source_page_limit')
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index), content = await page.getTextContent()
      const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').replace(/[ \t]+/g, ' ').trim()
      if (text.length > 0) pages.push({ id: source.id + ':p' + index, page: index, text })
    }
  } finally { await task.destroy() }
  if (!normalize(pages.slice(0, 2).map(p => p.text).join(' ')).includes(normalize(source.marker))) throw new Error('official_source_title_mismatch:' + source.id)
  sources.push({ id: source.id, title: source.title, kind: source.kind, publisher: source.publisher, url: new URL(source.url).href, format: 'pdf', contentHash, verifiedAt: new Date().toISOString(), effectiveFrom: source.effectiveFrom, applicability: 'snapshot_requires_date_review', pages })
  console.log(JSON.stringify({ id: source.id, pages: pages.length, hash: contentHash }))
}
// Official appendices are DOCX files in an archive. Their ordinal is an annex, never a fabricated PDF page.
const annexUrl = 'https://www.mevzuat.gov.tr/MevzuatMetin/yonetmelik/9.5.20752-Ek.zip'
const response = await fetch(annexUrl, { signal: AbortSignal.timeout(30_000), redirect: 'error' })
if (!response.ok) throw new Error('official_annex_http_failure')
const bytes = new Uint8Array(await response.arrayBuffer())
if (bytes.length > 2_000_000 || bytes[0] !== 80 || bytes[1] !== 75) throw new Error('official_annex_not_zip')
const archive = unzipSync(bytes), pages = []
for (let index = 1; index <= 7; index++) {
  const docx = archive[`Ek-${index}.docx`]
  if (!docx || docx.length > 1_000_000) throw new Error('official_annex_missing')
  const document = unzipSync(docx)['word/document.xml']
  if (!document || document.length > 2_000_000) throw new Error('official_annex_document_missing')
  const xml = new TextDecoder().decode(document)
  const text = [...xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)].map(p => [...p[1].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(t => t[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')).join('')).join('\n').trim()
  if (!text || !text.toLocaleUpperCase('tr').includes('EK')) throw new Error('official_annex_text_invalid')
  pages.push({ id: `traffic-annexes:Ek-${index}`, page: index, text: `Ek-${index}.docx\n${text}` })
}
sources.push({ id: 'traffic-annexes', title: 'Trafik Sigortası Genel Şartları Ekleri (Ek 1–7)', kind: 'Genel Şartlar', publisher: 'Mevzuat Bilgi Sistemi / SEDDK', url: annexUrl, format: 'docx_archive', contentHash: sha(bytes), verifiedAt: new Date().toISOString(), effectiveFrom: '2015-06-01', applicability: 'snapshot_requires_date_review', pages })
console.log(JSON.stringify({ id: 'traffic-annexes', annexes: pages.length, hash: sha(bytes) }))
const data = { version: sha(JSON.stringify(sources.map(s => [s.id, s.contentHash]))), sources }
await mkdir('services/api/src/legislation', { recursive: true })
await writeFile('services/api/src/legislation/catalog.generated.ts', '// Generated by scripts/refresh-legislation-catalog.mjs; public official source snapshots.\nexport const legislationCatalogData: unknown = ' + JSON.stringify(data) + '\n')
await mkdir('.local/legislation-build', { recursive: true })
await writeFile('.local/legislation-build/catalog-proof.json', JSON.stringify({ status: 'PASS', version: data.version, sources: sources.length, pdfPages: sources.filter(s => s.format === 'pdf').reduce((n, s) => n + s.pages.length, 0), annexes: pages.length, checkedAt: new Date().toISOString() }, null, 2))
