import { readFile, readdir, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const VITE_WARNING_LIMIT_BYTES = 500_000
const DIST_DIR = fileURLToPath(new URL('../dist/', import.meta.url))
const ASSETS_DIR = fileURLToPath(new URL('../dist/assets/', import.meta.url))
const REQUIRED_LAZY_CHUNKS = [
  'CaseDetailPage-',
  'DocumentPhotoApiModule-',
  'PolicyPdfTextApiModule-',
  'PolicyOcrApiModule-',
  'PolicyAnalysisWorkspace-',
  'TrafficValueLossApiModule-',
  'CaseOperationsApiModule-',
  'EmailDraftApiModule-',
  'LaborApiModule-',
  'PertApiModule-',
]

const indexHtml = await readFile(`${DIST_DIR}index.html`, 'utf8')
const initialAssets = [...new Set(
  [...indexHtml.matchAll(/(?:src|href)="\/?assets\/([^"]+\.js)"/g)]
    .map((match) => match[1]),
)]
const allJavaScriptAssets = (await readdir(ASSETS_DIR))
  .filter((name) => name.endsWith('.js'))
  .sort()

async function sizeOf(name) {
  return (await stat(`${ASSETS_DIR}${name}`)).size
}

const initialSizes = await Promise.all(initialAssets.map(async (name) => ({
  name,
  size: await sizeOf(name),
})))
const allSizes = await Promise.all(allJavaScriptAssets.map(async (name) => ({
  name,
  size: await sizeOf(name),
})))
const initialBytes = initialSizes.reduce((sum, item) => sum + item.size, 0)
const largestChunk = allSizes.reduce(
  (largest, item) => item.size > largest.size ? item : largest,
  { name: 'none', size: 0 },
)

const failures = []
if (initialAssets.length === 0) failures.push('index.html başlangıç JavaScript grafiği bulunamadı.')
if (initialBytes >= VITE_WARNING_LIMIT_BYTES) {
  failures.push(`Başlangıç JavaScript grafiği ${initialBytes} bayt; sınır ${VITE_WARNING_LIMIT_BYTES} bayt.`)
}
for (const item of allSizes) {
  if (item.size >= VITE_WARNING_LIMIT_BYTES) {
    failures.push(`${item.name} ${item.size} bayt ile Vite uyarı sınırını aşıyor.`)
  }
}
for (const prefix of REQUIRED_LAZY_CHUNKS) {
  const chunk = allJavaScriptAssets.find((name) => name.startsWith(prefix))
  if (chunk === undefined) {
    failures.push(`${prefix} için ayrı lazy chunk bulunamadı.`)
  } else if (initialAssets.includes(chunk)) {
    failures.push(`${chunk} başlangıç grafiğinde preload edildi; lazy sınırı bozuldu.`)
  }
}

if (failures.length > 0) {
  throw new Error(`Frontend bundle bütçe kapısı başarısız:\n- ${failures.join('\n- ')}`)
}

console.log(
  `Frontend bundle bütçesi geçti: başlangıç ${initialBytes} bayt; en büyük chunk `
  + `${largestChunk.name} ${largestChunk.size} bayt; ${REQUIRED_LAZY_CHUNKS.length} lazy modül ayrıldı.`,
)
