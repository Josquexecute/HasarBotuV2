import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
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

// D7 ghost exclusion sınırı gerçek müşteri path/fileId verisini repository'ye
// almadan yapısal olarak korunur. Bu statik kapı gerçek admin-only manifestin
// veya canlı pCloud DB'nin yerine geçmez; fail-closed kablolamanın yanlışlıkla
// kaldırılmasını engeller.
try {
  const preflight = await readFile(`${DEPLOY_DIR}test-storage-sync-migration-preflight.ps1`, 'utf8')
  const validator = await readFile(`${DEPLOY_DIR}validate-storage-ghost-exclusion.mjs`, 'utf8')
  const maintenanceGate = await readFile(`${DEPLOY_DIR}pcloud-maintenance-window-gate.mjs`, 'utf8')
  const maintenanceWrapper = await readFile(`${DEPLOY_DIR}test-pcloud-maintenance-window-gate.ps1`, 'utf8')

  assertContains(preflight, /\$GhostExclusionManifestPath/, 'test-storage-sync-migration-preflight.ps1', 'zorunlu exclusion manifest parametresi')
  assertContains(preflight, /GHOST_EXCLUSION_MANIFEST_REQUIRED/, 'test-storage-sync-migration-preflight.ps1', 'manifest yokluğunda fail-closed hata kodu')
  assertContains(preflight, /Test-AdministratorsOnlyFile/, 'test-storage-sync-migration-preflight.ps1', 'Administrators-only ACL kapısı')
  assertContains(preflight, /validate-storage-ghost-exclusion\.mjs/, 'test-storage-sync-migration-preflight.ps1', 'yerel pCloud DB doğrulayıcı bağlantısı')
  assertContains(preflight, /\$BeforeSyncReportPath/, 'test-storage-sync-migration-preflight.ps1', 'AfterSync için BeforeSync rapor parametresi')
  assertContains(preflight, /\$BeforeSyncReportSha256/, 'test-storage-sync-migration-preflight.ps1', 'BeforeSync rapor SHA-256 parametresi')
  assertContains(preflight, /BEFORE_SYNC_REPORT_REQUIRED/, 'test-storage-sync-migration-preflight.ps1', 'AfterSync baseline yokluğunda fail-closed hata kodu')
  assertContains(preflight, /SOURCE_BASELINE_CHANGED_SINCE_BEFORE_SYNC/, 'test-storage-sync-migration-preflight.ps1', 'senkron sırasında kaynak baseline değişimi blockeri')
  assertContains(preflight, /storage-sync-migration-preflight\/1\.3\.0/, 'test-storage-sync-migration-preflight.ps1', '1.3.0 sonuç şeması')
  assertContains(preflight, /D8BeforeSync/, 'test-storage-sync-migration-preflight.ps1', 'D8 bakım pencereli ayrı stage')
  assertContains(preflight, /MAINTENANCE_WINDOW_REPORT_REQUIRED/, 'test-storage-sync-migration-preflight.ps1', 'D8 raporu yokluğunda fail-closed hata kodu')
  assertContains(preflight, /Invoke-MaintenanceWindowCurrentCheck/, 'test-storage-sync-migration-preflight.ps1', 'tam hash öncesi/sonrası güncellik kontrolü')
  assertContains(preflight, /MAINTENANCE_WINDOW_SOURCE_BASELINE_CHANGED/, 'test-storage-sync-migration-preflight.ps1', 'bakım penceresi tam hash baseline blockeri')
  assertContains(validator, /exact_windows_path_and_pcloud_file_id/, 'validate-storage-ghost-exclusion.mjs', 'exact path+fileId eşleşme modu')
  assertContains(validator, /entryCount === 10/, 'validate-storage-ghost-exclusion.mjs', 'tam 10 kayıt kapısı')
  assertContains(validator, /new DatabaseSync\(databaseUrl, \{ readOnly: true, timeout: 0 \}\)/, 'validate-storage-ghost-exclusion.mjs', 'salt-okunur SQLite açılışı')
  assertContains(validator, /databaseUrl\.searchParams\.set\('immutable', '1'\)/, 'validate-storage-ghost-exclusion.mjs', 'immutable SQLite modu')
  assertNotContains(validator, /endsWith\(['"]\.tmp['"]\)|includes\(['"]\.tmp['"]\)/, 'validate-storage-ghost-exclusion.mjs', 'uzantıya dayalı exclusion kuralı')

  assertContains(maintenanceGate, /MINIMUM_QUIET_SECONDS = 600/, 'pcloud-maintenance-window-gate.mjs', 'değiştirilemez en az 600 saniye kapısı')
  assertContains(maintenanceGate, /getTextSetting\(database, 'diffid'/, 'pcloud-maintenance-window-gate.mjs', 'pCloud diff cursor okuması')
  assertContains(maintenanceGate, /\$\{path\.basename\(databasePath\)\}-wal/, 'pcloud-maintenance-window-gate.mjs', 'WAL dahil canlı DB snapshot')
  assertContains(maintenanceGate, /compareEntryMaps/, 'pcloud-maintenance-window-gate.mjs', 'create/modify/delete fark sayacı')
  assertContains(maintenanceGate, /MAINTENANCE_WINDOW_RESET/, 'pcloud-maintenance-window-gate.mjs', 'yazar hareketinde süre sıfırlama raporu')
  assertContains(maintenanceGate, /PCLOUD_CHANGED_DURING_OBSERVATION/, 'pcloud-maintenance-window-gate.mjs', 'örnek içi uzak harekette fail-closed reset')
  assertContains(maintenanceGate, /PCLOUD_DATABASE_SNAPSHOT_UNSTABLE/, 'pcloud-maintenance-window-gate.mjs', 'DB snapshot kararsızlığında fail-closed reset')
  assertContains(maintenanceGate, /SOURCE_CHANGED_DURING_FULL_HASH/, 'pcloud-maintenance-window-gate.mjs', 'tam hash sırasında kaynak hareketinde fail-closed reset')
  assertContains(maintenanceGate, /SOURCE_CHANGED_DURING_INVENTORY/, 'pcloud-maintenance-window-gate.mjs', 'envanter taraması sırasında kaynak hareketinde fail-closed reset')
  assertContains(maintenanceGate, /Baseline:/, 'pcloud-maintenance-window-gate.mjs', 'başlangıç ve son sayı/boyut/hash kanıtı')
  assertContains(maintenanceGate, /DiffCursorAdvanceCount: 0/, 'pcloud-maintenance-window-gate.mjs', 'final sessiz pencerede sıfır diff hareketi')
  assertContains(maintenanceWrapper, /\[ValidateRange\(10, 120\)\]/, 'test-pcloud-maintenance-window-gate.ps1', '10 dakikanın altına inemeyen wrapper')
  assertContains(maintenanceWrapper, /Test-AdministratorsOnlyFile/, 'test-pcloud-maintenance-window-gate.ps1', 'admin-only manifest kapısı')
  assertContains(maintenanceWrapper, /New-AdminOnlySecurity/, 'test-pcloud-maintenance-window-gate.ps1', 'admin-only gate raporu')
  assertNotContains(maintenanceWrapper, /SetEnvironmentVariable|Start-Service|Set-Service|Stop-Service|Stop-Process/, 'test-pcloud-maintenance-window-gate.ps1', 'env/servis/pCloud süreç mutasyonu')

  const maintenanceTests = spawnSync(
    process.execPath,
    ['--test', `${DEPLOY_DIR}pcloud-maintenance-window-gate.test.mjs`],
    { encoding: 'utf8' },
  )
  if (maintenanceTests.status !== 0) {
    throw new Error(`pCloud bakım penceresi testleri başarısız — ${maintenanceTests.stderr || maintenanceTests.stdout}`)
  }
} catch (error) {
  errors.push(`D7 ghost exclusion tooling doğrulaması çalışmadı — ${error.message}`)
}

if (errors.length > 0) {
  console.error('WinSW servis config doğrulaması BAŞARISIZ:')
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}

console.log(`Windows servis/depolama doğrulaması geçti: ${checks.length} WinSW şablonu ve fail-closed D7/D8 depolama tooling.`)
