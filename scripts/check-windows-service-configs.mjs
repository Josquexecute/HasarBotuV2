import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * D5 (HB-2026-108) — WinSW servis şablonlarının yapısal doğrulaması.
 *
 * Bu iki dosya tamamen bizim kontrolümüzde, sabit ve dar kapsamlı olduğu
 * için tam bir XML ayrıştırıcı EKLENMEDİ (AGENTS.md §8: yeni dependency
 * eklemeden önce mevcut araçları kontrol et). Yerine: (1) basit yığın
 * tabanlı etiket dengesi kontrolü — gerçek bir XML iyi-biçimlilik denetimi
 * — ve (2) WinSW şemasına özgü, dosyaya özel yapısal/güvenlik denetimleri.
 *
 * `check-frontend-bundle.mjs` ile aynı desen: düz Node betiği, harici
 * bağımlılık yok, başarısızlıkta ANLAMLI mesajla çıkış kodu 1.
 */

const DEPLOY_DIR = fileURLToPath(new URL('../deploy/windows-service/', import.meta.url))

const SELF_CLOSING_OR_DECL = /^(\?xml|br|hr|img)/i

/** Yorumları çıkarıp basit yığın tabanlı etiket dengesini doğrular. */
function assertWellFormedTagBalance(xml, label) {
  const withoutComments = xml.replace(/<!--[\s\S]*?-->/g, '')
  const tagPattern = /<\/?([a-zA-Z][\w:-]*)\b[^>]*?(\/)?>/g
  const stack = []
  let match
  while ((match = tagPattern.exec(withoutComments)) !== null) {
    const [full, name, selfClosingMark] = match
    if (full.startsWith('<?') || SELF_CLOSING_OR_DECL.test(name)) continue
    const isClosing = full.startsWith('</')
    const isSelfClosing = selfClosingMark === '/' || full.endsWith('/>')
    if (isClosing) {
      const top = stack.pop()
      if (top !== name) {
        throw new Error(`${label}: etiket dengesi bozuk — </${name}> beklenirken yığında ${top ?? '(boş)'} vardı`)
      }
    } else if (!isSelfClosing) {
      stack.push(name)
    }
  }
  if (stack.length > 0) {
    throw new Error(`${label}: kapatılmamış etiket(ler): ${stack.join(', ')}`)
  }
}

function assertContains(xml, pattern, label, description) {
  if (!pattern.test(xml)) throw new Error(`${label}: ${description} eksik`)
}

function assertNotContains(xml, pattern, label, description) {
  if (pattern.test(xml)) throw new Error(`${label}: ${description} — dosyada bulunmamalı`)
}

const checks = [
  {
    file: 'hasarbotu-api.winsw.xml',
    id: 'hasarbotu-api',
    dependsOn: 'postgresql-x64-17',
  },
  {
    file: 'hasarbotu-file-agent.winsw.xml',
    id: 'hasarbotu-file-agent',
    dependsOn: 'hasarbotu-api',
  },
]

const errors = []

for (const check of checks) {
  const path = `${DEPLOY_DIR}${check.file}`
  let xml
  try {
    xml = await readFile(path, 'utf8')
  } catch (error) {
    errors.push(`${check.file}: okunamadı — ${error.message}`)
    continue
  }

  try {
    assertWellFormedTagBalance(xml, check.file)

    // Yorumlar meşru biçimde bu kelimeleri AÇIKLAMA amacıyla geçebilir
    // ("... BU DOSYADA YOKTUR" gibi); gerçek içerik denetimi yalnız
    // yorumlar çıkarılmış metin üzerinde yapılır.
    const withoutComments = xml.replace(/<!--[\s\S]*?-->/g, '')

    assertContains(withoutComments, new RegExp(`<id>${check.id}</id>`), check.file, `<id>${check.id}</id>`)
    assertContains(withoutComments, /<executable>__NODE_EXE__<\/executable>/, check.file, 'render zamanı yer tutucu <executable>__NODE_EXE__</executable>')
    assertContains(withoutComments, /<workingdirectory>__APP_DIR__<\/workingdirectory>/, check.file, 'render zamanı yer tutucu <workingdirectory>__APP_DIR__</workingdirectory>')
    assertContains(withoutComments, new RegExp(`<depend>${check.dependsOn}</depend>`), check.file, `<depend>${check.dependsOn}</depend>`)
    assertContains(withoutComments, /<startmode>Automatic<\/startmode>/, check.file, '<startmode>Automatic</startmode>')
    assertContains(withoutComments, /<onfailure action="restart"/, check.file, 'en az bir <onfailure action="restart" .../> girişi')
    assertContains(withoutComments, /<resetfailure>/, check.file, '<resetfailure> eşiği')
    assertContains(withoutComments, /<logpath>%BASE%\\logs<\/logpath>/, check.file, "göreli <logpath>%BASE%\\logs</logpath> (mutlak yol DEĞİL)")
    assertContains(withoutComments, /<log mode="roll-by-size">/, check.file, 'boyuta göre log döndürme (<log mode="roll-by-size">)')
    assertContains(withoutComments, /<sizeThreshold>\d+<\/sizeThreshold>/, check.file, '<sizeThreshold> saklama sınırı')
    assertContains(withoutComments, /<keepFiles>\d+<\/keepFiles>/, check.file, '<keepFiles> saklama sınırı')
    assertContains(withoutComments, /<stoptimeout>/, check.file, '<stoptimeout> graceful shutdown süresi')

    // Güvenlik: RENDER EDİLMEMİŞ şablon secret, mutlak sürücü harfi veya
    // makineye özgü yol TAŞIMAMALI. Yorumlarda AÇIKLAMA amaçlı geçmesi
    // sorun değildir; asıl tehlike bunların gerçek <env>/element DEĞERİ
    // olarak gömülmesidir.
    assertNotContains(withoutComments, /P:\\/i, check.file, 'mutlak P:\\ sürücü yolu (yorum dışında)')
    assertNotContains(withoutComments, /C:\\Users/i, check.file, 'geliştirici makinesine özgü mutlak yol (yorum dışında)')
    assertNotContains(withoutComments, /<env name="DATABASE_URL"|<env name="HASARBOTU_AGENT_SECRET"|<env name="GEMINI_API_KEY"/i, check.file, 'secret alanı <env> olarak gömülü')
  } catch (error) {
    errors.push(error.message)
  }
}

// İki servisin bağımlılık zinciri BİRBİRİNE tutarlı olmalı: file-agent
// hasarbotu-api'ye bağımlı, api ise WinSW dışı (zaten kurulu) postgres'e.
const apiId = checks[0].id
const fileAgentDependsOnApi = checks[1].dependsOn === apiId
if (!fileAgentDependsOnApi) {
  errors.push(`Bağımlılık zinciri tutarsız: file-agent '${checks[1].dependsOn}'e bağımlı, ancak api id'si '${apiId}'`)
}

if (errors.length > 0) {
  console.error('WinSW servis config doğrulaması BAŞARISIZ:')
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}

console.log(`WinSW servis config doğrulaması geçti: ${checks.length} şablon, başlangıç sırası api -> ${checks[0].dependsOn}, file-agent -> ${checks[1].dependsOn}.`)
