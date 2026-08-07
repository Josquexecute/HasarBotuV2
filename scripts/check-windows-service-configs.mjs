import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
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

  // HB-2026-162: enumerateSourceTree'ye eklenen ISTEGE BAGLI kapsam
  // parametresi -- per-case reconciliation motorunun tek bir vaka
  // klasorunu taramasini saglar. options olmadan cagiran 5 mevcut
  // cagri noktasi (bu blok disinda) davranis degisikligi gormemeli.
  assertContains(maintenanceGate, /options\?\.scopeRelativePath/, 'pcloud-maintenance-window-gate.mjs', 'enumerateSourceTree kapsam parametresi opsiyonel (options olmadan davranis degismez)')
  assertContains(maintenanceGate, /SOURCE_SCOPE_NOT_DIRECTORY/, 'pcloud-maintenance-window-gate.mjs', 'kapsam yolu gecersizse fail-closed red')
  assertContains(maintenanceGate, /scopedExpectedExcludedCount/, 'pcloud-maintenance-window-gate.mjs', 'ghost-exclusion sayisi kapsam altinda daraltilir (tam agac sayisiyla degil)')
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

// HB-2026-129: D8 post-sync rebaseline — aktif Add Sync altında çalışan,
// pre-sync gate'in sync-yok varsayımını ASLA gevşetmeyen ayrı stage/araç.
// Statik kapı bu yeni dosyaların fail-closed kablolamasını korur.
try {
  const preflight = await readFile(`${DEPLOY_DIR}test-storage-sync-migration-preflight.ps1`, 'utf8')
  const rebaselineGate = await readFile(`${DEPLOY_DIR}pcloud-post-sync-rebaseline-gate.mjs`, 'utf8')
  const rebaselineWrapper = await readFile(`${DEPLOY_DIR}test-pcloud-post-sync-rebaseline-gate.ps1`, 'utf8')

  assertContains(preflight, /'PostSyncRebaseline'/, 'test-storage-sync-migration-preflight.ps1', 'aktif sync altında çalışan ayrı PostSyncRebaseline stage')
  assertContains(preflight, /\$ActiveSyncWindowReportPath/, 'test-storage-sync-migration-preflight.ps1', 'PostSyncRebaseline için ayrı rapor parametresi (MaintenanceWindowReportPath DEĞİL)')
  assertContains(preflight, /ACTIVE_SYNC_WINDOW_SOURCE_BASELINE_CHANGED/, 'test-storage-sync-migration-preflight.ps1', 'post-sync rebaseline sırasında kaynak baseline değişimi blockeri')
  assertContains(preflight, /Invoke-ActiveSyncWindowCurrentCheck/, 'test-storage-sync-migration-preflight.ps1', 'post-sync rebaseline tam hash öncesi/sonrası güncellik kontrolü')
  assertContains(preflight, /Get-ValidatedActiveSyncWindowReport/, 'test-storage-sync-migration-preflight.ps1', 'post-sync rebaseline rapor doğrulayıcısı')
  assertContains(preflight, /report\.Stage -notin @\('D8BeforeSync', 'PostSyncRebaseline'\)/, 'test-storage-sync-migration-preflight.ps1', 'AfterSync baseline kabulünün D8BeforeSync VE PostSyncRebaseline ile sınırlı kalması')

  assertContains(rebaselineGate, /getExactGhostRootId,/, 'pcloud-post-sync-rebaseline-gate.mjs', 'pre-sync gate ile aynı vetted kok cozumleme mantiginin yeniden kullanimi')
  assertContains(rebaselineGate, /withConsistentPcloudDatabase,/, 'pcloud-post-sync-rebaseline-gate.mjs', 'pre-sync gate ile ayni WAL-dahil tutarli snapshot tekniginin yeniden kullanimi')
  assertContains(rebaselineGate, /SYNC_MAPPING_ROW_COUNT_INVALID/, 'pcloud-post-sync-rebaseline-gate.mjs', 'tam olarak bir aktif sync kaydi sarti')
  assertContains(rebaselineGate, /SYNC_MAPPING_ROOT_MISMATCH/, 'pcloud-post-sync-rebaseline-gate.mjs', 'sync kaydinin beklenen uzak kokle eslesme sarti')
  assertContains(rebaselineGate, /SYNC_MAPPING_TARGET_MISMATCH/, 'pcloud-post-sync-rebaseline-gate.mjs', 'sync kaydinin beklenen hedef yerel yolla eslesme sarti')
  assertContains(rebaselineGate, /PCLOUD_PENDING_TASKS_FOUND/, 'pcloud-post-sync-rebaseline-gate.mjs', 'sifir bekleyen pCloud kuyrugu sarti')
  assertContains(rebaselineGate, /localFolderTaskSum/, 'pcloud-post-sync-rebaseline-gate.mjs', 'localfolder.taskcnt toplaminin (bilgi amacli, artik blocker degil) okunup rapora tasinmasi')
  assertContains(rebaselineGate, /PCLOUD_CONFLICT_NAME_PATTERN_DETECTED/, 'pcloud-post-sync-rebaseline-gate.mjs', 'conflict-adi deseni fail-closed reddi')
  assertContains(rebaselineGate, /SOURCE_TARGET_HASH_MISMATCH_AT_PASS/, 'pcloud-post-sync-rebaseline-gate.mjs', 'kaynak/hedef tam SHA-256 esitsizliginde fail-closed BLOCKED')
  assertContains(rebaselineGate, /MINIMUM_QUIET_SECONDS,/, 'pcloud-post-sync-rebaseline-gate.mjs', 'pre-sync gate ile ayni degistirilemez 600 saniye sabitinin yeniden kullanimi')

  assertContains(rebaselineWrapper, /Test-AdministratorsOnlyFile/, 'test-pcloud-post-sync-rebaseline-gate.ps1', 'admin-only manifest kapısı')
  assertContains(rebaselineWrapper, /New-AdminOnlySecurity/, 'test-pcloud-post-sync-rebaseline-gate.ps1', 'admin-only gate raporu')
  assertNotContains(rebaselineWrapper, /SetEnvironmentVariable|Start-Service|Set-Service|Stop-Service|Stop-Process|Unlink|Clear-/, 'test-pcloud-post-sync-rebaseline-gate.ps1', 'env/servis/pCloud eslemesi mutasyonu')

  const rebaselineTests = spawnSync(
    process.execPath,
    ['--test', `${DEPLOY_DIR}pcloud-post-sync-rebaseline-gate.test.mjs`],
    { encoding: 'utf8' },
  )
  if (rebaselineTests.status !== 0) {
    throw new Error(`D8 post-sync rebaseline testleri başarısız — ${rebaselineTests.stderr || rebaselineTests.stdout}`)
  }
} catch (error) {
  errors.push(`D8 post-sync rebaseline tooling doğrulaması çalışmadı — ${error.message}`)
}

// HB-2026-130: D8 post-sync stale-target-file repair — bu depodaki İLK
// gerçek yazma yolu olan araç. Statik kapı, -Apply olmadan hiçbir yazma
// yapılmadığını ve Add Sync/env/servise hiç dokunulmadığını korur.
try {
  const stateProbe = await readFile(`${DEPLOY_DIR}pcloud-stale-target-file-state.mjs`, 'utf8')
  const repairScript = await readFile(`${DEPLOY_DIR}repair-post-sync-stale-target-files.ps1`, 'utf8')

  assertContains(stateProbe, /This module is READ-ONLY/, 'pcloud-stale-target-file-state.mjs', 'salt-okunur oldugunu belirten dokumantasyon')
  assertNotContains(stateProbe, /writeFile|WriteAllText|WriteAllBytes|\.exec\(['"]INSERT|\.exec\(['"]UPDATE|\.exec\(['"]DELETE/, 'pcloud-stale-target-file-state.mjs', 'herhangi bir dosya/DB yazma cagrisi')

  assertContains(repairScript, /\[switch\]\$Apply/, 'repair-post-sync-stale-target-files.ps1', 'varsayilan onizleme, yalniz acik -Apply ile gercek yazma')
  assertContains(repairScript, /ForensicsReportPath/, 'repair-post-sync-stale-target-files.ps1', 'kapsamin hash dogrulanmis forensics raporundan gelmesi (sabit kodlanmis yol listesi degil)')
  assertContains(repairScript, /SOURCE_CHANGED_SINCE_FORENSICS/, 'repair-post-sync-stale-target-files.ps1', 'kaynak degisimi fail-closed blockeri')
  assertContains(repairScript, /TARGET_NOT_KNOWN_SUPERSEDED_VERSION/, 'repair-post-sync-stale-target-files.ps1', 'hedefin bilinen eski surum olmama blockeri')
  assertContains(repairScript, /PCLOUD_TASK_REFERENCE_FOUND/, 'repair-post-sync-stale-target-files.ps1', 'pending task/conflict referansi blockeri')
  assertContains(repairScript, /TARGET_FILE_LOCKED/, 'repair-post-sync-stale-target-files.ps1', 'acik handle kontrolu')
  assertContains(repairScript, /Test-AdministratorsOnlyFile/, 'repair-post-sync-stale-target-files.ps1', 'admin-only forensics rapor/manifest ACL kapisi')
  assertContains(repairScript, /New-AdminOnlySecurity/, 'repair-post-sync-stale-target-files.ps1', 'admin-only yedek/rapor ACL uygulamasi')
  assertContains(repairScript, /\[System\.IO\.File\]::Replace/, 'repair-post-sync-stale-target-files.ps1', 'atomik replace ilkeli')
  assertNotContains(repairScript, /SetEnvironmentVariable|Start-Service|Set-Service|Stop-Service|Stop-Process/, 'repair-post-sync-stale-target-files.ps1', 'env/servis mutasyonu')

  // HB-2026-149: pcloud-post-sync-diff-forensics/1.0.0 semasi icin adapter
  // eklendi -- eski 56AAG629-ozel yol (fonksiyon adiyla) bozulmadan korunmali.
  assertContains(repairScript, /function Get-CandidateEntries56aag629/, 'repair-post-sync-stale-target-files.ps1', 'eski 56AAG629 semasinin degismeden korundugu (ayri fonksiyon)')
  assertContains(repairScript, /function Get-CandidateEntriesDiffForensics/, 'repair-post-sync-stale-target-files.ps1', 'jenerik pcloud-post-sync-diff-forensics semasi icin adapter')
  assertContains(repairScript, /'TARGET_ONLY_NO_SOURCE_COUNTERPART'/, 'repair-post-sync-stale-target-files.ps1', 'target-only dosyalarin ASLA aday olmamasi (yalniz blocker)')
  assertContains(repairScript, /'CURRENCY_NOT_SOURCE_CURRENT_TARGET_SUPERSEDED'/, 'repair-post-sync-stale-target-files.ps1', 'ters yon (hedef guncel/kaynak eski) asla aday olmamasi')
  assertContains(repairScript, /'NO_DISTINCT_SUPERSEDED_REVISION_MATCHING_TARGET'/, 'repair-post-sync-stale-target-files.ps1', 'revision kaniti olmadan content_mismatch aday olmamasi')
  assertContains(repairScript, /'METADATA_ONLY_CONTENT_IDENTICAL'/, 'repair-post-sync-stale-target-files.ps1', 'metadata_only kayitlarin kapsam disi birakilmasi')
  assertContains(repairScript, /ClassificationBlockedCount/, 'repair-post-sync-stale-target-files.ps1', 'aday/blocker/kapsam-disi sayilarinin ayri raporlanmasi')

  // HB-2026-162: ucuncu sema adapteri (per-case reconciliation) -- eski iki
  // yol (56AAG629, diff-forensics) fonksiyon adiyla degismeden korunmali.
  assertContains(repairScript, /function Get-CandidateEntriesCaseReconciliation/, 'repair-post-sync-stale-target-files.ps1', 'hasarbotu-pcloud-case-reconciliation semasi icin ayri adapter (eski ikisi degismez)')
  assertContains(repairScript, /PATTERN_CLASSIFICATION_NOT_STALE_TARGET/, 'repair-post-sync-stale-target-files.ps1', 'yalniz PatternClassification==stale_target aday olur (unknown asla); rename_artifact-esli extra ise zaten TARGET_ONLY_NO_SOURCE_COUNTERPART ile bloke olur')
  // HB-2026-162: JPEG'e ozel butunluk kontrolu artik uzantiya gore
  // dagitiliyor -- .jpg/.jpeg icin AYNI eski fonksiyon/blocker kodu
  // (SOURCE_JPEG_INTEGRITY_FAILED) korunur; PNG ve digerleri icin YENI,
  // AYRI kod adlari kullanilir (mevcut davranisi degistirmeden).
  assertContains(repairScript, /function Get-PngIntegrityOk/, 'repair-post-sync-stale-target-files.ps1', 'PNG imza kontrolu (yeni, JPEG yolunu degistirmeden)')
  assertContains(repairScript, /function Test-SourceIntegrityOk/, 'repair-post-sync-stale-target-files.ps1', 'uzantiya gore butunluk kontrolu dagitici')
  assertContains(repairScript, /MINIMAL_INTEGRITY_CHECK_FAILED/, 'repair-post-sync-stale-target-files.ps1', 'JPEG/PNG disi uzantilar icin asgari sifir-olmayan-uzunluk kontrolu')
  // HB-2026-162: kopyalama oncesi/sonrasi source identity fence + sinirli
  // yeniden deneme -- yalniz etkilenen dosyayi bloke eder, digerlerini
  // etkilemez (mevcut per-dosya izolasyonu degismez).
  assertContains(repairScript, /MaxIdentityRetries/, 'repair-post-sync-stale-target-files.ps1', 'sinirli kimlik-yeniden-deneme parametresi')
  assertContains(repairScript, /SOURCE_IDENTITY_CHANGED_DURING_REPAIR/, 'repair-post-sync-stale-target-files.ps1', 'atomik replace ONCESI canli pCloud kimligi yeniden dogrulanir; degistiyse yalniz bu dosya bloke olur')

  const stateProbeTests = spawnSync(
    process.execPath,
    ['--test', `${DEPLOY_DIR}pcloud-stale-target-file-state.test.mjs`],
    { encoding: 'utf8' },
  )
  if (stateProbeTests.status !== 0) {
    throw new Error(`stale-target-file-state testleri başarısız — ${stateProbeTests.stderr || stateProbeTests.stdout}`)
  }

  const repairTests = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `${DEPLOY_DIR}repair-post-sync-stale-target-files.tests.ps1`],
    { encoding: 'utf8' },
  )
  if (repairTests.status !== 0 || !/SUMMARY: 0 failure\(s\)/.test(repairTests.stdout)) {
    throw new Error(`repair-post-sync-stale-target-files testleri başarısız — ${repairTests.stderr || repairTests.stdout}`)
  }
} catch (error) {
  errors.push(`D8 post-sync stale-target-file repair tooling doğrulaması çalışmadı — ${error.message}`)
}

// HB-2026-157: D9 B10 target-only orphan cleanup — ikinci gerçek yazma
// (bu sefer silme) yolu. Statik kapı, -Apply olmadan hiçbir yazma
// yapılmadığını, yalnız 'extra' sınıflı kayıtların işlendiğini, yedek
// dizininin sync kökü dışında zorunlu tutulduğunu ve pCloud/env/servise
// hiç dokunulmadığını korur.
try {
  const cleanupScript = await readFile(`${DEPLOY_DIR}cleanup-post-sync-target-only-files.ps1`, 'utf8')

  assertContains(cleanupScript, /\[switch\]\$Apply/, 'cleanup-post-sync-target-only-files.ps1', 'varsayılan önizleme, yalnız açık -Apply ile gerçek silme')
  assertContains(cleanupScript, /-ne 'extra'/, 'cleanup-post-sync-target-only-files.ps1', 'yalnız extra (target-only) kayıtların aday olması')
  assertContains(cleanupScript, /SOURCE_NOW_EXISTS/, 'cleanup-post-sync-target-only-files.ps1', 'kaynağın yeniden ortaya çıkması fail-closed blockeri')
  assertContains(cleanupScript, /TARGET_CHANGED_SINCE_FORENSICS/, 'cleanup-post-sync-target-only-files.ps1', 'hedefin forensics anından beri değişmiş olması blockeri')
  assertContains(cleanupScript, /PCLOUD_OBJECT_NOW_FOUND/, 'cleanup-post-sync-target-only-files.ps1', 'pCloud canlı nesne bulursa fail-closed geri çekilme')
  assertContains(cleanupScript, /BACKUP_DIRECTORY_INSIDE_SYNC_ROOT/, 'cleanup-post-sync-target-only-files.ps1', 'yedek dizininin sync kökü dışında zorunlu tutulması')
  assertContains(cleanupScript, /Test-AdministratorsOnlyFile/, 'cleanup-post-sync-target-only-files.ps1', 'admin-only forensics rapor/manifest ACL kapısı')
  assertContains(cleanupScript, /New-AdminOnlySecurity/, 'cleanup-post-sync-target-only-files.ps1', 'admin-only yedek/rapor ACL uygulaması')
  assertContains(cleanupScript, /\[System\.IO\.File\]::Delete/, 'cleanup-post-sync-target-only-files.ps1', 'gerçek silme çağrısı')
  assertContains(cleanupScript, /POST_DELETE_FILE_STILL_EXISTS/, 'cleanup-post-sync-target-only-files.ps1', 'silme sonrası bağımsız doğrulama')
  assertNotContains(cleanupScript, /SetEnvironmentVariable|Start-Service|Set-Service|Stop-Service|Stop-Process/, 'cleanup-post-sync-target-only-files.ps1', 'env/servis mutasyonu')

  const cleanupTests = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `${DEPLOY_DIR}cleanup-post-sync-target-only-files.tests.ps1`],
    { encoding: 'utf8' },
  )
  if (cleanupTests.status !== 0 || !/SUMMARY: 0 failure\(s\)/.test(cleanupTests.stdout)) {
    throw new Error(`cleanup-post-sync-target-only-files testleri başarısız — ${cleanupTests.stderr || cleanupTests.stdout}`)
  }
} catch (error) {
  errors.push(`D9 B10 target-only orphan cleanup tooling doğrulaması çalışmadı — ${error.message}`)
}

// HB-2026-131: D8 post-sync source/target diff forensics — rebaseline
// gate'in SOURCE_TARGET_HASH_MISMATCH_AT_PASS'te verdiği toplu hash
// uyuşmazlığını dosya bazında izole eden, tamamen salt-okunur araç.
try {
  const diffForensics = await readFile(`${DEPLOY_DIR}pcloud-post-sync-diff-forensics.mjs`, 'utf8')
  const diffWrapper = await readFile(`${DEPLOY_DIR}run-pcloud-post-sync-diff-forensics.ps1`, 'utf8')

  assertContains(diffForensics, /This module is READ-ONLY/, 'pcloud-post-sync-diff-forensics.mjs', 'salt-okunur oldugunu belirten dokumantasyon')
  assertNotContains(diffForensics, /writeFile|WriteAllText|WriteAllBytes|\.exec\(['"]INSERT|\.exec\(['"]UPDATE|\.exec\(['"]DELETE/, 'pcloud-post-sync-diff-forensics.mjs', 'herhangi bir dosya/DB yazma cagrisi')
  assertContains(diffForensics, /'missing'/, 'pcloud-post-sync-diff-forensics.mjs', 'missing siniflandirmasi')
  assertContains(diffForensics, /'extra'/, 'pcloud-post-sync-diff-forensics.mjs', 'extra siniflandirmasi')
  assertContains(diffForensics, /'content_mismatch'/, 'pcloud-post-sync-diff-forensics.mjs', 'content_mismatch siniflandirmasi')
  assertContains(diffForensics, /'metadata_only'/, 'pcloud-post-sync-diff-forensics.mjs', 'metadata_only siniflandirmasi')
  assertContains(diffForensics, /getTaskReferenceCount/, 'pcloud-post-sync-diff-forensics.mjs', 'pCloud task/fstask referans kontrolu')
  assertContains(diffForensics, /getRevisionHistory/, 'pcloud-post-sync-diff-forensics.mjs', 'pCloud filerevision gecmisi')
  assertContains(diffForensics, /isNotLockedForWrite/, 'pcloud-post-sync-diff-forensics.mjs', 'acik handle probu')
  assertContains(diffForensics, /findAllConflictNames/, 'pcloud-post-sync-diff-forensics.mjs', 'conflict-adi deseni taramasi')

  assertContains(diffWrapper, /ADMINISTRATOR_REQUIRED/, 'run-pcloud-post-sync-diff-forensics.ps1', 'admin rol sarti')
  assertContains(diffWrapper, /Test-AdministratorsOnlyFile/, 'run-pcloud-post-sync-diff-forensics.ps1', 'admin-only manifest ACL kapisi')
  assertContains(diffWrapper, /New-AdminOnlySecurity/, 'run-pcloud-post-sync-diff-forensics.ps1', 'admin-only rapor ACL uygulamasi')
  assertNotContains(diffWrapper, /SetEnvironmentVariable|Start-Service|Set-Service|Stop-Service|Stop-Process|\[System\.IO\.File\]::Replace|\[System\.IO\.File\]::Delete|\[System\.IO\.File\]::Copy/, 'run-pcloud-post-sync-diff-forensics.ps1', 'env/servis/dosya yazma-tasima mutasyonu yok (yalniz rapor yazimi)')

  const diffForensicsTests = spawnSync(
    process.execPath,
    ['--test', `${DEPLOY_DIR}pcloud-post-sync-diff-forensics.test.mjs`],
    { encoding: 'utf8' },
  )
  if (diffForensicsTests.status !== 0) {
    throw new Error(`pcloud-post-sync-diff-forensics testleri başarısız — ${diffForensicsTests.stderr || diffForensicsTests.stdout}`)
  }
} catch (error) {
  errors.push(`D8 post-sync diff forensics tooling doğrulaması çalışmadı — ${error.message}`)
}

// HB-2026-162: per-case pCloud reconciliation motoru -- global 600 saniyelik
// bütün-ağaç sessizlik kapısını, tek bir vaka klasörüne dar bir canlı
// pCloud kimlik denetimiyle değiştiren yeni katman. Tamamen salt-okunur;
// silme yeteneği YOKTUR (extra/unknown asla otomatik silinmez).
try {
  const caseReconciliation = await readFile(`${DEPLOY_DIR}pcloud-case-reconciliation.mjs`, 'utf8')
  const caseReconciliationWrapper = await readFile(`${DEPLOY_DIR}run-pcloud-case-reconciliation.ps1`, 'utf8')

  assertContains(caseReconciliation, /This module is READ-ONLY/, 'pcloud-case-reconciliation.mjs', 'salt-okunur oldugunu belirten dokumantasyon')
  assertNotContains(caseReconciliation, /writeFile|WriteAllText|WriteAllBytes|unlink|rmSync|\.exec\(['"]INSERT|\.exec\(['"]UPDATE|\.exec\(['"]DELETE/, 'pcloud-case-reconciliation.mjs', 'herhangi bir dosya/DB yazma veya silme cagrisi (silme yetenegi yok)')
  assertContains(caseReconciliation, /'stale_target'/, 'pcloud-case-reconciliation.mjs', 'stale_target desen siniflandirmasi')
  assertContains(caseReconciliation, /'rename_artifact'/, 'pcloud-case-reconciliation.mjs', 'rename_artifact desen siniflandirmasi (SHA-256 esleseni ile)')
  assertContains(caseReconciliation, /'unknown'/, 'pcloud-case-reconciliation.mjs', 'unknown desen siniflandirmasi (asla otomatik cozulmez)')
  assertContains(caseReconciliation, /metadata_only/, 'pcloud-case-reconciliation.mjs', 'metadata_only tamamen yok sayilir')
  assertContains(caseReconciliation, /'ready'/, 'pcloud-case-reconciliation.mjs', 'ready vaka durumu')
  assertContains(caseReconciliation, /'syncing'/, 'pcloud-case-reconciliation.mjs', 'syncing vaka durumu')
  assertContains(caseReconciliation, /'conflict'/, 'pcloud-case-reconciliation.mjs', 'conflict vaka durumu')
  assertContains(caseReconciliation, /CASE_FOLDER_NOT_FOUND_ON_EITHER_SIDE|CASE_FOLDER_MISSING_ON_TARGET|CASE_FOLDER_MISSING_ON_SOURCE/, 'pcloud-case-reconciliation.mjs', 'vaka klasoru eksikse fail-closed unknown/conflict (crash degil)')
  assertContains(caseReconciliation, /allAffectedFilesSyncing/, 'pcloud-case-reconciliation.mjs', 'syncing yalniz TUM etkilenen dosyalar canli task gosterirse (fail-closed, tek takili dosya conflict e dusurur)')

  assertContains(caseReconciliationWrapper, /ADMINISTRATOR_REQUIRED/, 'run-pcloud-case-reconciliation.ps1', 'admin rol sarti')
  assertContains(caseReconciliationWrapper, /Test-AdministratorsOnlyFile/, 'run-pcloud-case-reconciliation.ps1', 'admin-only manifest ACL kapisi')
  assertContains(caseReconciliationWrapper, /New-AdminOnlySecurity/, 'run-pcloud-case-reconciliation.ps1', 'admin-only rapor ACL uygulamasi')
  assertContains(caseReconciliationWrapper, /CaseRelativePath/, 'run-pcloud-case-reconciliation.ps1', 'tek bir vaka klasoruyle sinirli (Mandatory parametre)')
  assertNotContains(caseReconciliationWrapper, /SetEnvironmentVariable|Start-Service|Set-Service|Stop-Service|Stop-Process|\[System\.IO\.File\]::Replace|\[System\.IO\.File\]::Delete|\[System\.IO\.File\]::Copy/, 'run-pcloud-case-reconciliation.ps1', 'env/servis/dosya yazma-tasima-silme mutasyonu yok (yalniz rapor yazimi)')

  const caseReconciliationTests = spawnSync(
    process.execPath,
    ['--test', `${DEPLOY_DIR}pcloud-case-reconciliation.test.mjs`],
    { encoding: 'utf8' },
  )
  if (caseReconciliationTests.status !== 0) {
    throw new Error(`pcloud-case-reconciliation testleri başarısız — ${caseReconciliationTests.stderr || caseReconciliationTests.stdout}`)
  }
} catch (error) {
  errors.push(`Per-case pCloud reconciliation tooling doğrulaması çalışmadı — ${error.message}`)
}

// HB-2026-134 follow-up: PCLOUD_PENDING_TASKS_FOUND salt-okunur teshis
// araci. Gate/PostSyncRebaseline/AfterSync'i asla calistirmadigini ve
// hicbir yazma yapmadigini koruyan statik denetim.
try {
  const queueForensics = await readFile(`${DEPLOY_DIR}pcloud-task-queue-forensics.mjs`, 'utf8')
  const queueWrapper = await readFile(`${DEPLOY_DIR}run-pcloud-task-queue-forensics.ps1`, 'utf8')

  assertContains(queueForensics, /This module is READ-ONLY/, 'pcloud-task-queue-forensics.mjs', 'salt-okunur oldugunu belirten dokumantasyon')
  assertNotContains(queueForensics, /writeFile|WriteAllText|WriteAllBytes|\.exec\(['"]INSERT|\.exec\(['"]UPDATE|\.exec\(['"]DELETE/, 'pcloud-task-queue-forensics.mjs', 'herhangi bir dosya/DB yazma cagrisi')
  assertContains(queueForensics, /'genuine_transfer'/, 'pcloud-task-queue-forensics.mjs', 'genuine_transfer siniflandirmasi')
  assertContains(queueForensics, /'recurring_retry'/, 'pcloud-task-queue-forensics.mjs', 'recurring_retry siniflandirmasi')
  assertContains(queueForensics, /'metadata_churn'/, 'pcloud-task-queue-forensics.mjs', 'metadata_churn siniflandirmasi')
  assertContains(queueForensics, /'remote_writer'/, 'pcloud-task-queue-forensics.mjs', 'remote_writer siniflandirmasi')
  assertContains(queueForensics, /'unknown'/, 'pcloud-task-queue-forensics.mjs', 'unknown siniflandirmasi')
  assertContains(queueForensics, /IMPORTANT HONESTY NOTE/, 'pcloud-task-queue-forensics.mjs', 'undokumante type/status kodlarinin uydurulmadigini belirten not')

  assertContains(queueWrapper, /ADMINISTRATOR_REQUIRED/, 'run-pcloud-task-queue-forensics.ps1', 'admin rol sarti')
  assertContains(queueWrapper, /Test-AdministratorsOnlyFile/, 'run-pcloud-task-queue-forensics.ps1', 'admin-only manifest ACL kapisi')
  assertContains(queueWrapper, /New-AdminOnlySecurity/, 'run-pcloud-task-queue-forensics.ps1', 'admin-only rapor ACL uygulamasi')
  assertNotContains(queueWrapper, /SetEnvironmentVariable|Start-Service|Set-Service|Stop-Service|Stop-Process|\[System\.IO\.File\]::Replace|\[System\.IO\.File\]::Delete|\[System\.IO\.File\]::Copy|test-pcloud-post-sync-rebaseline-gate|test-storage-sync-migration-preflight/, 'run-pcloud-task-queue-forensics.ps1', 'env/servis/dosya yazma + gate/PostSyncRebaseline/AfterSync cagrisi yok (yalniz rapor yazimi)')

  const queueForensicsTests = spawnSync(
    process.execPath,
    ['--test', `${DEPLOY_DIR}pcloud-task-queue-forensics.test.mjs`],
    { encoding: 'utf8' },
  )
  if (queueForensicsTests.status !== 0) {
    throw new Error(`pcloud-task-queue-forensics testleri başarısız — ${queueForensicsTests.stderr || queueForensicsTests.stdout}`)
  }
} catch (error) {
  errors.push(`pCloud task queue forensics tooling doğrulaması çalışmadı — ${error.message}`)
}

// HB-2026-142 (D9 ilk kucuk paketi): install-services.ps1'e tek-servis
// secici eklendi. -Services verilmezse eski davranis (her iki servis)
// korunmali; secili olmayan servise ait dizin/build/servis durumu HIC
// okunmamali; zaten kurulu bir servis (idempotency) fail-closed
// reddedilmeli. Bu araç daha once bu dosyada HIC test edilmiyordu.
try {
  const installServices = await readFile(`${DEPLOY_DIR}install-services.ps1`, 'utf8')

  assertContains(installServices, /\[ValidateSet\('Api', 'FileAgent'\)\]/, 'install-services.ps1', 'Services parametresinin izinli degerleri Api/FileAgent ile sinirlandirilmasi')
  assertContains(installServices, /\[string\[\]\]\$Services = @\('Api', 'FileAgent'\)/, 'install-services.ps1', '-Services verilmezse varsayilanin HER IKI servis olmasi (eski davranis korunur)')
  assertContains(installServices, /servisi ZATEN kurulu - bu betik VAR OLAN bir servisi güncellemez\/yeniden kurmaz/, 'install-services.ps1', 'idempotency: zaten kurulu servise fail-closed red')
  assertContains(installServices, /if \(\$installApi\)/, 'install-services.ps1', 'API kontrol/kurulum adimlarinin -Services secimine kosullu olmasi')
  assertContains(installServices, /if \(\$installFileAgent\)/, 'install-services.ps1', 'File Agent kontrol/kurulum adimlarinin -Services secimine kosullu olmasi')
  assertContains(installServices, /\[Console\]::OutputEncoding = \[System\.Text\.UTF8Encoding\]::new\(\$false\)/, 'install-services.ps1', 'Turkce konsol ciktisi icin UTF-8 encoding duzeltmesi')

  const installServicesTests = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `${DEPLOY_DIR}install-services.tests.ps1`],
    { encoding: 'utf8' },
  )
  if (installServicesTests.status !== 0 || !/SUMMARY: 0 failure\(s\)/.test(installServicesTests.stdout)) {
    throw new Error(`install-services testleri başarısız — ${installServicesTests.stderr || installServicesTests.stdout}`)
  }
} catch (error) {
  errors.push(`install-services.ps1 tek-servis seçici doğrulaması çalışmadı — ${error.message}`)
}

// HB-2026-143 (D9 ikinci kucuk paketi): servis KURMAYAN, yalniz build
// ciktisini (dist/ + package.json, allowlist disi HICBIR SEY) fail-closed,
// idempotent, atomik-degistirmeli, geri alinabilir sekilde deploy dizinine
// hazirlayan arac. Servis kurma/env yazma/servis baslatma bu aracin
// KAPSAMI DISINDADIR -- statik denetim bunu da dogrular.
try {
  const deployArtifacts = await readFile(`${DEPLOY_DIR}deploy-service-artifacts.ps1`, 'utf8')

  assertContains(deployArtifacts, /\$AllowlistTopLevelDir = 'dist'/, 'deploy-service-artifacts.ps1', 'allowlist yalniz dist/ dizinine sinirli')
  assertContains(deployArtifacts, /\$AllowlistTopLevelFile = 'package\.json'/, 'deploy-service-artifacts.ps1', 'allowlist yalniz package.json dosyasina sinirli')
  assertContains(deployArtifacts, /SOURCE_DIST_REPARSE_POINT/, 'deploy-service-artifacts.ps1', 'dist altinda reparse point/symlink fail-closed reddi')
  assertContains(deployArtifacts, /already_up_to_date/, 'deploy-service-artifacts.ps1', 'idempotency: hedef zaten guncelse degisiklik yapilmamasi')
  assertContains(deployArtifacts, /\[System\.IO\.Directory\]::Move\(\$target, \$backupPath\)/, 'deploy-service-artifacts.ps1', 'yedekleme kopya degil atomik Directory.Move ile')
  assertContains(deployArtifacts, /STAGING_HASH_MISMATCH/, 'deploy-service-artifacts.ps1', 'staging asamasinda hash dogrulamasi')
  assertContains(deployArtifacts, /PostApplyVerificationMismatches/, 'deploy-service-artifacts.ps1', 'uygulama sonrasi bagimsiz hash dogrulamasi')
  assertContains(deployArtifacts, /-Rollback/, 'deploy-service-artifacts.ps1', 'rollback modu var')
  assertContains(deployArtifacts, /bütünlük hatası/, 'deploy-service-artifacts.ps1', 'rollback oncesi yedek butunlugu dogrulamasi')
  assertContains(deployArtifacts, /\[Console\]::OutputEncoding = \[System\.Text\.UTF8Encoding\]::new\(\$false\)/, 'deploy-service-artifacts.ps1', 'Turkce konsol ciktisi icin UTF-8 encoding duzeltmesi')
  assertNotContains(deployArtifacts, /Start-Service|Stop-Service|Set-Service|New-Service|\.exe['"]?\s+install\b|SetEnvironmentVariable|hasarbotu-api\.exe|hasarbotu-file-agent\.exe/, 'deploy-service-artifacts.ps1', 'servis kurma/baslatma/env yazma yok (kapsam disi)')

  // HB-2026-144 (D9 B7 cozumu): opsiyonel bagimlilik kapanisi destegi --
  // verilmezse HB-2026-143 ile birebir ayni davranis, verilirse
  // workspace-internal + harici paketleri de dahil eden self-contained
  // dagitim.
  assertContains(deployArtifacts, /\[string\]\$DependencyClosureManifestPath/, 'deploy-service-artifacts.ps1', 'opsiyonel -DependencyClosureManifestPath parametresi')
  assertContains(deployArtifacts, /\[string\]\$RepoRoot/, 'deploy-service-artifacts.ps1', 'opsiyonel -RepoRoot parametresi')
  assertContains(deployArtifacts, /birlikte verilmeli/, 'deploy-service-artifacts.ps1', 'kapanis parametrelerinin birlikte-yoksa fail-closed reddi')
  assertContains(deployArtifacts, /function Get-SourceDeploymentManifest/, 'deploy-service-artifacts.ps1', 'kapanis-farkindali kaynak envanteri fonksiyonu')
  assertContains(deployArtifacts, /function Get-FullTreeManifest/, 'deploy-service-artifacts.ps1', 'zaten dagitilmis (hedef/yedek) dizinler icin sinirsiz envanter fonksiyonu')
  assertContains(deployArtifacts, /function Add-FullSubtreeEntries/, 'deploy-service-artifacts.ps1', 'harici paketin TAM dizinini vendoring ilkesiyle ekleyen fonksiyon')
  assertContains(deployArtifacts, /Join-Path 'node_modules' \(\$workspacePackageName -replace '\/', '\\'\)/, 'deploy-service-artifacts.ps1', 'workspace-internal paketlerin node_modules\\@hasarbotu\\<ad>\\ altina yerlestirilmesi')
  assertContains(deployArtifacts, /Kilit bütünlüğü uyuşmazlığı \(TAZE doğrulama\)/, 'deploy-service-artifacts.ps1', 'Apply anindaki BAGIMSIZ (manifest-uretim-anindan ayrı) taze kilit butunlugu kontrolu')
  assertContains(deployArtifacts, /MAX_PATH sınırını/, 'deploy-service-artifacts.ps1', 'derin ic ice node_modules override zincirlerinde Windows MAX_PATH fail-closed kapisi')
  assertNotContains(deployArtifacts, /\(Get-FileHash -LiteralPath \$Path/, 'deploy-service-artifacts.ps1', 'Get-Sha256 artik ham .NET akisi kullanmali (performans, HB-2026-144) -- eski Get-FileHash cmdlet cagrisi kalmamali')
  assertContains(deployArtifacts, /\[System\.Security\.Cryptography\.SHA256\]::Create\(\)/, 'deploy-service-artifacts.ps1', 'Get-Sha256 ham .NET SHA256 akis hash implementasyonu kullanmali')

  const deployArtifactsBytes = await readFile(`${DEPLOY_DIR}deploy-service-artifacts.ps1`)
  if (!(deployArtifactsBytes[0] === 0xef && deployArtifactsBytes[1] === 0xbb && deployArtifactsBytes[2] === 0xbf)) {
    throw new Error('deploy-service-artifacts.ps1 UTF-8 BOM eksik (Windows PowerShell 5.1 Turkce karakterleri BOM olmadan yanlis ayristirir)')
  }
  const deployArtifactsTestsBytes = await readFile(`${DEPLOY_DIR}deploy-service-artifacts.tests.ps1`)
  if (!(deployArtifactsTestsBytes[0] === 0xef && deployArtifactsTestsBytes[1] === 0xbb && deployArtifactsTestsBytes[2] === 0xbf)) {
    throw new Error('deploy-service-artifacts.tests.ps1 UTF-8 BOM eksik')
  }

  const deployArtifactsTests = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `${DEPLOY_DIR}deploy-service-artifacts.tests.ps1`],
    { encoding: 'utf8' },
  )
  if (deployArtifactsTests.status !== 0 || !/SUMMARY: 0 failure\(s\)/.test(deployArtifactsTests.stdout)) {
    throw new Error(`deploy-service-artifacts testleri başarısız — ${deployArtifactsTests.stderr || deployArtifactsTests.stdout}`)
  }
} catch (error) {
  errors.push(`deploy-service-artifacts.ps1 doğrulaması çalışmadı — ${error.message}`)
}

// HB-2026-144 (D9 B7 cozumu): API ve File Agent'in GERCEK calisma zamani
// bagimlilik kapanisini SADECE package-lock.json'dan (canli node_modules
// introspeksiyonu DEGIL) cikaran salt-okunur resolver. Statik kapı:
// salt-okunurlugu, link-stub yonlendirmesini, platform filtrelemesini ve
// kilitlenmemis-lockfile-surumu red kapisini korur.
try {
  const closureResolver = await readFile(`${DEPLOY_DIR}resolve-runtime-dependency-closure.mjs`, 'utf8')

  assertContains(closureResolver, /This module is READ-ONLY/, 'resolve-runtime-dependency-closure.mjs', 'salt-okunur oldugunu belirten dokumantasyon')
  assertNotContains(closureResolver, /writeFile|WriteAllText|WriteAllBytes|\.exec\(['"]INSERT|\.exec\(['"]UPDATE|\.exec\(['"]DELETE/, 'resolve-runtime-dependency-closure.mjs', 'herhangi bir dosya/DB yazma cagrisi')
  assertContains(closureResolver, /LOCKFILE_VERSION_UNSUPPORTED/, 'resolve-runtime-dependency-closure.mjs', 'desteklenmeyen lockfileVersion fail-closed reddi')
  assertContains(closureResolver, /export function resolveDependencyLockKey/, 'resolve-runtime-dependency-closure.mjs', 'Node modul cozumlemesini taklit eden yukari-dogru yol yurumesi')
  assertContains(closureResolver, /export function isOptionalDependencyCompatible/, 'resolve-runtime-dependency-closure.mjs', 'platform/mimari uyumluluk filtresi')
  assertContains(closureResolver, /export function computeClosure/, 'resolve-runtime-dependency-closure.mjs', 'saf (dosya sistemi erisimsiz) kapanis hesaplayicisi')
  assertContains(closureResolver, /export async function verifyOnDiskVersions/, 'resolve-runtime-dependency-closure.mjs', 'diskteki surumu kilit dosyasiyla karsilastiran kilit butunlugu kontrolu')
  assertContains(closureResolver, /entry\.link === true/, 'resolve-runtime-dependency-closure.mjs', 'npm workspace link:true stub yonlendirmesi (harici paket olarak yanlis siniflandirmayi onler)')
  assertContains(closureResolver, /keys ONLY \(never "devDependencies"\)/, 'resolve-runtime-dependency-closure.mjs', 'devDependencies HICBIR ZAMAN izlenmez dokumantasyonu')
  assertContains(closureResolver, /LOCK_INTEGRITY_MISMATCH/, 'resolve-runtime-dependency-closure.mjs', 'diskteki surum kilitten sapmissa fail-closed red')

  const closureResolverTests = spawnSync(
    process.execPath,
    ['--test', `${DEPLOY_DIR}resolve-runtime-dependency-closure.test.mjs`],
    { encoding: 'utf8' },
  )
  if (closureResolverTests.status !== 0) {
    throw new Error(`resolve-runtime-dependency-closure testleri başarısız — ${closureResolverTests.stderr || closureResolverTests.stdout}`)
  }
} catch (error) {
  errors.push(`resolve-runtime-dependency-closure.mjs doğrulaması çalışmadı — ${error.message}`)
}

// HB-2026-145 (D9 B8 cozumu): kilit disi "ExtraDataReferences" icin
// kimlik/surum dogrulamasi (deger kaybi referans-veri snapshot'inin
// uygulamanin KENDI kanonik JSON hash algoritmasiyla dogrulanmasi) ve
// bunlari GERCEK, planlanan servis hedefine gore TAZE hesaplanan konuma
// saglayan fail-closed, idempotent, atomik, geri alinabilir arac. Statik
// kapı: kimlik sabitlerinin domain paketiyle eslestigini, salt-okunur
// dogrulayicinin hicbir yazma yapmadigini ve saglama betiginin TOCTOU
// (eksik/fazla/degismis) korumasini/sabit-yol-sozlesmesi-degistirmedigini
// dogrular.
try {
  const identityVerifier = await readFile(`${DEPLOY_DIR}verify-value-loss-reference-data-identity.mjs`, 'utf8')
  const domainSnapshotSource = await readFile(
    fileURLToPath(new URL('../packages/domain/src/value-loss-rule-snapshot.ts', import.meta.url)),
    'utf8',
  )
  const domainRealMarketSource = await readFile(
    fileURLToPath(new URL('../packages/domain/src/traffic-value-loss-real-market.ts', import.meta.url)),
    'utf8',
  )

  assertNotContains(identityVerifier, /writeFile|WriteAllText|WriteAllBytes|\.exec\(['"]INSERT|\.exec\(['"]UPDATE|\.exec\(['"]DELETE/, 'verify-value-loss-reference-data-identity.mjs', 'herhangi bir dosya/DB yazma cagrisi (salt-okunur dogrulayici)')
  assertContains(identityVerifier, /export function canonicalizeValueLossJson/, 'verify-value-loss-reference-data-identity.mjs', 'kanonik (siralanmis anahtar) JSON serilestirici')
  assertContains(identityVerifier, /export function verifySnapshotIdentity/, 'verify-value-loss-reference-data-identity.mjs', 'kimlik+hash dogrulama fonksiyonu')

  // Bu araçtaki sabitlerin domain paketinin KENDI sabitleriyle esleştigini
  // dogrudan kaynak metinden dogrula -- iki kopya arasinda sessiz sapmayi
  // engeller (biri degisirse bu denetim BASARISIZ olur).
  const identityMatch = /const EXPECTED_SNAPSHOT_IDENTITY = '([^']+)'/.exec(identityVerifier)
  const hashMatch = /const EXPECTED_SNAPSHOT_SHA256 =\s*\n?\s*'([^']+)'/.exec(identityVerifier)
  if (identityMatch === null || hashMatch === null) {
    throw new Error('verify-value-loss-reference-data-identity.mjs: EXPECTED_SNAPSHOT_IDENTITY/SHA256 sabitleri bulunamadı')
  }
  if (!domainSnapshotSource.includes(`VALUE_LOSS_SNAPSHOT_IDENTITY = '${identityMatch[1]}'`)) {
    throw new Error('verify-value-loss-reference-data-identity.mjs: EXPECTED_SNAPSHOT_IDENTITY, packages/domain/src/value-loss-rule-snapshot.ts VALUE_LOSS_SNAPSHOT_IDENTITY ile eşleşmiyor (biri değişmiş, diğeri güncellenmemiş)')
  }
  if (!domainRealMarketSource.includes(hashMatch[1])) {
    throw new Error('verify-value-loss-reference-data-identity.mjs: EXPECTED_SNAPSHOT_SHA256, packages/domain/src/traffic-value-loss-real-market.ts REAL_MARKET_VALUE_LOSS_SNAPSHOT_SHA256 ile eşleşmiyor (biri değişmiş, diğeri güncellenmemiş)')
  }

  const identityVerifierTests = spawnSync(
    process.execPath,
    ['--test', `${DEPLOY_DIR}verify-value-loss-reference-data-identity.test.mjs`],
    { encoding: 'utf8' },
  )
  if (identityVerifierTests.status !== 0) {
    throw new Error(`verify-value-loss-reference-data-identity testleri başarısız — ${identityVerifierTests.stderr || identityVerifierTests.stdout}`)
  }

  const provisionScript = await readFile(`${DEPLOY_DIR}provision-extra-data-references.ps1`, 'utf8')
  assertContains(provisionScript, /ExtraDataReferences/, 'provision-extra-data-references.ps1', 'kapanistan ExtraDataReferences okunmasi (yol sabit kodlanmaz)')
  assertContains(provisionScript, /verify-value-loss-reference-data-identity\.mjs/, 'provision-extra-data-references.ps1', 'kimlik/surum dogrulayicisinin cagrilmasi')
  assertContains(provisionScript, /SOURCE_DATA_CHANGED_SINCE_PLAN/, 'provision-extra-data-references.ps1', 'TOCTOU (eksik/fazla/degismis) fail-closed korumasi')
  assertContains(provisionScript, /function Get-ManifestDiff/, 'provision-extra-data-references.ps1', 'plan-ani ile taze manifest arasindaki fark hesaplayicisi')
  assertContains(provisionScript, /farklı ek veri kök dizini bulundu/, 'provision-extra-data-references.ps1', 'coklu-hedef-grubu henuz desteklenmedigi icin fail-closed reddi')
  assertContains(provisionScript, /Servis dağıtım köküne ait üst dizin yok/, 'provision-extra-data-references.ps1', 'servis dagitim koku saglik tabani kontrolu')
  assertContains(provisionScript, /\[System\.IO\.Directory\]::Move\(\$target, \$backupPath\)/, 'provision-extra-data-references.ps1', 'yedekleme kopya degil atomik Directory.Move ile')
  assertContains(provisionScript, /-Rollback/, 'provision-extra-data-references.ps1', 'rollback modu var')
  assertContains(provisionScript, /\[Console\]::OutputEncoding = \[System\.Text\.UTF8Encoding\]::new\(\$false\)/, 'provision-extra-data-references.ps1', 'Turkce konsol ciktisi icin UTF-8 encoding duzeltmesi')
  assertNotContains(provisionScript, /Start-Service|Stop-Service|Set-Service|New-Service|SetEnvironmentVariable/, 'provision-extra-data-references.ps1', 'servis kurma/baslatma/env yazma yok (kapsam disi)')

  const provisionScriptBytes = await readFile(`${DEPLOY_DIR}provision-extra-data-references.ps1`)
  if (!(provisionScriptBytes[0] === 0xef && provisionScriptBytes[1] === 0xbb && provisionScriptBytes[2] === 0xbf)) {
    throw new Error('provision-extra-data-references.ps1 UTF-8 BOM eksik')
  }
  const provisionTestsBytes = await readFile(`${DEPLOY_DIR}provision-extra-data-references.tests.ps1`)
  if (!(provisionTestsBytes[0] === 0xef && provisionTestsBytes[1] === 0xbb && provisionTestsBytes[2] === 0xbf)) {
    throw new Error('provision-extra-data-references.tests.ps1 UTF-8 BOM eksik')
  }

  const provisionTests = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `${DEPLOY_DIR}provision-extra-data-references.tests.ps1`],
    { encoding: 'utf8' },
  )
  if (provisionTests.status !== 0 || !/SUMMARY: 0 failure\(s\)/.test(provisionTests.stdout)) {
    throw new Error(`provision-extra-data-references testleri başarısız — ${provisionTests.stderr || provisionTests.stdout}`)
  }
} catch (error) {
  errors.push(`D9 B8 (ek veri referansı sağlama) tooling doğrulaması çalışmadı — ${error.message}`)
}

// HB-2026-147 (D9 B9 cozumu): ilk organizasyon+admin kullanicisi icin
// tek-kullanimlik, fail-closed bootstrap CLI'si -- bu depodaki GERCEK bir
// veritabani INSERT'i yapan ilk Node araci. Statik kapı: gercek parola
// hash mekanizmasinin (argon2, @hasarbotu/api) VE gercek id uretecinin
// (uuidv7, @hasarbotu/database) yeniden kullanildigini, parolanin asla
// argv/dosya/log olarak gecmedigini, TEK transaction+TOCTOU-taze-yeniden-
// kontrol+audit_events kaydinin var oldugunu dogrular.
try {
  const bootstrapScript = await readFile(`${DEPLOY_DIR}bootstrap-first-admin.mjs`, 'utf8')

  assertContains(bootstrapScript, /import \{ hashPassword \} from '@hasarbotu\/api'/, 'bootstrap-first-admin.mjs', 'gercek argon2id parola hash mekanizmasinin yeniden kullanimi (kendi implementasyonu degil)')
  assertContains(bootstrapScript, /import \{ uuidv7,/, 'bootstrap-first-admin.mjs', 'gercek uuidv7 id ureticisinin yeniden kullanimi (registerAgent/createSession ile ayni)')
  assertContains(bootstrapScript, /userSummarySchema\.shape\.email|userSummarySchema\.shape\.displayName/, 'bootstrap-first-admin.mjs', 'gercek contracts semasinin (userSummarySchema) yeniden kullanimi')
  assertContains(bootstrapScript, /passwordSchema\.safeParse/, 'bootstrap-first-admin.mjs', 'gercek contracts parola semasinin (passwordSchema) yeniden kullanimi')
  assertContains(bootstrapScript, /allowed = new Set\(\['--apply'\]\)/, 'bootstrap-first-admin.mjs', 'yalniz --apply bayragi izinli -- parola ASLA CLI argumani olamaz')
  assertNotContains(bootstrapScript, /--password|argv.*password|password.*argv/i, 'bootstrap-first-admin.mjs', 'parolanin CLI argumani olarak gecmesi ihtimali')
  assertNotContains(bootstrapScript, /writeFile\([^)]*password|appendFile\([^)]*password/i, 'bootstrap-first-admin.mjs', 'parolanin dosyaya yazilmasi ihtimali')
  assertContains(bootstrapScript, /setRawMode\(true\)/, 'bootstrap-first-admin.mjs', 'guvenli (yankisiz) interaktif parola girisi')
  assertContains(bootstrapScript, /STDIN_NOT_INTERACTIVE/, 'bootstrap-first-admin.mjs', 'TTY olmayan baglamda fail-closed red (otomasyonla yanlislikla calistirilamaz)')
  assertContains(bootstrapScript, /ORGANIZATIONS_NOT_EMPTY_|USERS_NOT_EMPTY_/, 'bootstrap-first-admin.mjs', 'tek-kullanimlik fail-closed koruma (organizations=0 VE users=0 sarti)')
  assertContains(bootstrapScript, /READINESS_CHANGED_SINCE_CHECK/, 'bootstrap-first-admin.mjs', 'TOCTOU: transaction icinde TAZE yeniden kontrol')
  assertContains(bootstrapScript, /await client\.query\('BEGIN'\)/, 'bootstrap-first-admin.mjs', 'tek DB transaction (BEGIN)')
  assertContains(bootstrapScript, /await client\.query\('COMMIT'\)/, 'bootstrap-first-admin.mjs', 'tek DB transaction (COMMIT)')
  assertContains(bootstrapScript, /await client\.query\('ROLLBACK'\)/, 'bootstrap-first-admin.mjs', 'hata halinde tam geri alma (ROLLBACK)')
  assertContains(bootstrapScript, /INSERT INTO audit_events/, 'bootstrap-first-admin.mjs', 'audit kaniti -- ayni transaction icinde audit_events kaydi')
  assertContains(bootstrapScript, /SetAccessControl/, 'bootstrap-first-admin.mjs', 'yerel kanit raporu icin Administrators-only ACL')

  const bootstrapTests = spawnSync(
    process.execPath,
    ['--test', `${DEPLOY_DIR}bootstrap-first-admin.test.mjs`],
    { encoding: 'utf8' },
  )
  if (bootstrapTests.status !== 0) {
    throw new Error(`bootstrap-first-admin testleri başarısız — ${bootstrapTests.stderr || bootstrapTests.stdout}`)
  }
} catch (error) {
  errors.push(`D9 B9 (ilk admin bootstrap) tooling doğrulaması çalışmadı — ${error.message}`)
}

// HB-2026-162 SS8: File Agent -> pCloud local DB cross-account READ-ONLY
// erisimi icin PLAN + PREVIEW ONLY araci. -Apply YOK -- yapisal olarak
// (guard'li degil, hic mevcut degil) hicbir ACL/pCloud/servis/env/dosya
// mutasyonu yapamaz.
try {
  const previewScript = await readFile(`${DEPLOY_DIR}preview-file-agent-pcloud-db-access.ps1`, 'utf8')

  assertNotContains(previewScript, /\[switch\]\$Apply|SetAccessControl\([^)]*svc|\.SetAccessRule\(|AddAccessRule\([^)]*Write|icacls[^\n]*\/grant/, 'preview-file-agent-pcloud-db-access.ps1', 'Apply parametresi/gercek ACL yazma cagrisi YOK -- yalniz Get-Acl/GetAccessControl okuma')
  assertContains(previewScript, /Mode = 'preview'/, 'preview-file-agent-pcloud-db-access.ps1', 'sabit preview modu')
  assertContains(previewScript, /svc-hb-fileagent/, 'preview-file-agent-pcloud-db-access.ps1', 'varsayilan File Agent servis hesabi adi (HB-2026-113 ile ayni)')
  assertContains(previewScript, /RequiredFilesystemOperationsNote/, 'preview-file-agent-pcloud-db-access.ps1', 'ListDirectory gerekmedigi kod-seviyesinde kanitlanmis (captureDatabaseFiles dogrudan-yol stat)')
  assertContains(previewScript, /ImpersonationLimitNote/, 'preview-file-agent-pcloud-db-access.ps1', 'canli impersonation yapilamadigi acikca belirtilir (SeDenyInteractiveLogonRight + bilinmeyen parola)')
  assertContains(previewScript, /EXPLICIT_DENY_PRESENT/, 'preview-file-agent-pcloud-db-access.ps1', 'acik DENY, ALLOW dan once kazanir')
  assertContains(previewScript, /PlannedAcesContainNoWriteOrDeleteBits/, 'preview-file-agent-pcloud-db-access.ps1', 'planlanan ACE setinin yazma/silme biti icermedigi yapisal olarak dogrulanir')
  assertContains(previewScript, /forbiddenBits/, 'preview-file-agent-pcloud-db-access.ps1', 'yasakli haklar maskesiyle calisma zamani oz-kontrolu (PLANNED_RIGHTS_CONTAIN_FORBIDDEN_BITS)')
  assertContains(previewScript, /ObjectInherit/, 'preview-file-agent-pcloud-db-access.ps1', 'pCloud klasorundeki Read ACE dosyalara miras alinir (WAL/SHM yeniden olusursa erisim sureklidir)')
  assertContains(previewScript, /RollbackPlan/, 'preview-file-agent-pcloud-db-access.ps1', 'rollback plani (tam SDDL geri yukleme)')
  assertContains(previewScript, /DriftCheckPlan/, 'preview-file-agent-pcloud-db-access.ps1', 'ACL drift kontrol plani')
  assertNotContains(previewScript, /Start-Service|Stop-Service|Set-Service|SetEnvironmentVariable|New-LocalUser|Set-LocalUser|Remove-LocalUser/, 'preview-file-agent-pcloud-db-access.ps1', 'servis/env/hesap mutasyonu yok')

  const previewTests = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `${DEPLOY_DIR}preview-file-agent-pcloud-db-access.tests.ps1`],
    { encoding: 'utf8' },
  )
  if (previewTests.status !== 0 || !/SUMMARY: 0 failure\(s\)/.test(previewTests.stdout)) {
    throw new Error(`preview-file-agent-pcloud-db-access testleri başarısız — ${previewTests.stderr || previewTests.stdout}`)
  }
} catch (error) {
  errors.push(`File Agent pCloud DB erişim önizleme tooling doğrulaması çalışmadı — ${error.message}`)
}

// HB-2026-164: File Agent -> pCloud DB erişimi icin APPLY + ROLLBACK.
// Yalniz HB-2026-163 preview raporunun URETTIGI exact ACE listesini kabul
// eder; kendi ACE seti UYDURMAZ. Yazma/silme/sahiplik biti asla verilmez
// (hem calisma zamaninda bit-maskesiyle hem statik denetimde kontrol
// edilir); drift'te fail-closed; rollback tam SDDL geri yukler.
try {
  const applyScript = await readFile(`${DEPLOY_DIR}apply-file-agent-pcloud-db-access.ps1`, 'utf8')

  assertContains(applyScript, /PlannedMinimumAces/, 'apply-file-agent-pcloud-db-access.ps1', 'yalniz preview raporunun urettigi exact ACE listesi kabul edilir (kendi ACE seti uydurulmaz)')
  assertNotContains(applyScript, /\$AllowedRightsMask\s*=[^\n]*FullControl|\$AllowedRightsMask\s*=[^\n]*Modify\b/, 'apply-file-agent-pcloud-db-access.ps1', 'izin verilen haklar maskesi hic FullControl/Modify icermez (hard-coded genis izin yok)')
  assertContains(applyScript, /ForbiddenRightsMask/, 'apply-file-agent-pcloud-db-access.ps1', 'yazma/silme/sahiplik/izin-degistirme bitleri acikca yasakli')
  assertContains(applyScript, /PLANNED_ACE_OUTSIDE_WHITELIST/, 'apply-file-agent-pcloud-db-access.ps1', 'beyaz listedeki haklarin disina cikan ACE fail-closed reddedilir')
  assertContains(applyScript, /PREVIEW_DRIFT_SINCE_REPORT/, 'apply-file-agent-pcloud-db-access.ps1', 'Apply oncesi ORIJINAL preview scripti TAZE yeniden calistirilir, sonuc raporla uyusmazsa fail-closed')
  assertContains(applyScript, /ACL_DRIFT_SINCE_PREVIEW_REPORT/, 'apply-file-agent-pcloud-db-access.ps1', 'her dugumun taze ACL SDDL si rapor baseline iyle karsilastirilir, farkta fail-closed')
  assertContains(applyScript, /Restore-NodeSddl/, 'apply-file-agent-pcloud-db-access.ps1', 'rollback tam SDDL geri yukler (hangi ACE eklendigini tahmin etmez)')
  assertContains(applyScript, /WalShmContinuityTest|WAL_SHM_CONTINUITY_INHERITANCE_NOT_CONFIRMED/, 'apply-file-agent-pcloud-db-access.ps1', 'WAL/SHM sureklilik GERCEK bir dosya-olusturma + miras kanitiyla dogrulanir, simulasyon degil')
  assertContains(applyScript, /ServiceAccountContextVerification/, 'apply-file-agent-pcloud-db-access.ps1', 'servis hesabi baglaminda gercek Zamanlanmis Gorev tabanli dogrulama denenir (basarisizlik acikca raporlanir, sessizce atlanmaz/sahte basari uretilmez)')
  assertContains(applyScript, /DbFileEffectiveAccessSimulation/, 'apply-file-agent-pcloud-db-access.ps1', 'gercek DB dosyalari (data.db/-wal/-shm) uzerinde SID/effective-access simulasyonuyla Read=evet/Write=hayir dogrulanir (HB-2026-165)')
  assertContains(applyScript, /DB_FILE_READ_NOT_CONFIRMED_BY_SIMULATION|DB_FILE_FORBIDDEN_ACCESS_GRANTED_BY_SIMULATION/, 'apply-file-agent-pcloud-db-access.ps1', 'data.db icin simulasyon basarisiz olursa fail-closed (rollback tetiklenir)')
  assertContains(applyScript, /RollbackPackageVerified|ROLLBACK_PACKAGE_SCHEMA_INCOMPLETE/, 'apply-file-agent-pcloud-db-access.ps1', 'rollback paketi hash-dogrulamali geri okuma ile hazir-olma acisindan dogrulanir (rollback GERCEKTEN calistirilmadan)')
  assertNotContains(applyScript, /LsaAddAccountRights|LsaRemoveAccountRights|SeBatchLogonRight\s*=|New-LocalUser|Set-LocalUser/, 'apply-file-agent-pcloud-db-access.ps1', 'YENI bir LSA hakki/hesap asla verilmez -- yalniz mevcut SeServiceLogonRight ile calisir')
  assertNotContains(applyScript, /Start-Service|Set-Service|SetEnvironmentVariable/, 'apply-file-agent-pcloud-db-access.ps1', 'servis/env mutasyonu yok')

  const applyTests = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `${DEPLOY_DIR}apply-file-agent-pcloud-db-access.tests.ps1`],
    { encoding: 'utf8' },
  )
  if (applyTests.status !== 0 || !/SUMMARY: 0 failure\(s\)/.test(applyTests.stdout)) {
    throw new Error(`apply-file-agent-pcloud-db-access testleri başarısız — ${applyTests.stderr || applyTests.stdout}`)
  }
} catch (error) {
  errors.push(`File Agent pCloud DB erişim Apply/Rollback tooling doğrulaması çalışmadı — ${error.message}`)
}

// HB-2026-166: File Agent kontrollu aktivasyon -- PLAN + PREVIEW.
// -Apply yapisal olarak yok; hicbir env/servis/dosya/pCloud degisikligi
// yapmaz. 6 onkosul kategorisini gercek, salt-okunur kontrollerle
// dogrular ve 7 asamali aktivasyon sirasini (env/root -> service config ->
// start -> service-context DB probe -> per-case freshness smoke -> File
// Agent file-operation smoke -> verify/rollback) yalniz PLAN olarak uretir.
try {
  const activationScript = await readFile(`${DEPLOY_DIR}preview-file-agent-controlled-activation.ps1`, 'utf8')

  assertNotContains(activationScript, /\bStart-Service\b|\bSet-Service\b|\bEnable-.*Service|New-Service\b/, 'preview-file-agent-controlled-activation.ps1', 'hicbir servis baslatma/etkinlestirme/olusturma yok')
  assertNotContains(activationScript, /\[Environment\]::SetEnvironmentVariable/, 'preview-file-agent-controlled-activation.ps1', 'hicbir env degisken yazimi yok')
  assertNotContains(activationScript, /\[switch\]\$Apply\b|ParameterSetName\s*=\s*'Apply'/, 'preview-file-agent-controlled-activation.ps1', 'yapisal olarak -Apply parametresi/anahtari tanimlanmamis')
  assertContains(activationScript, /blocked_structural/, 'preview-file-agent-controlled-activation.ps1', 'gercek, cozulmemis yapisal engeller (orn. P:\\ Session 0 gorunmezligi) durusce raporlanir, gizlenmez')
  assertContains(activationScript, /ActivationSequence/, 'preview-file-agent-controlled-activation.ps1', '7 asamali aktivasyon sirasi PLAN olarak uretilir')
  assertContains(activationScript, /Get-ForbiddenBitsPresent/, 'preview-file-agent-controlled-activation.ps1', 'pCloud DB tarafinda yazma/silme yetkisi bagimsizca (raporun kendi ozetine guvenmeden) yeniden dogrulanir')

  const activationTests = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `${DEPLOY_DIR}preview-file-agent-controlled-activation.tests.ps1`],
    { encoding: 'utf8' },
  )
  if (activationTests.status !== 0 || !/SUMMARY: 0 failure\(s\)/.test(activationTests.stdout)) {
    throw new Error(`preview-file-agent-controlled-activation testleri başarısız — ${activationTests.stderr || activationTests.stdout}`)
  }
} catch (error) {
  errors.push(`File Agent kontrollü aktivasyon önizleme tooling doğrulaması çalışmadı — ${error.message}`)
}

// HB-2026-167 Karar 1: Session-0-safe per-case freshness gate (attestation
// tabanli). pCloud DB'nin file.hash kolonu 64-bit SQLite INTEGER'dir --
// 256-bit SHA-256 icin YAPISAL olarak yetersizdir (gercek sorguyla
// kanitlandi) -- bu yuzden ready durumu her zaman AYRI, gercek bir SHA-256
// attestation eslesmesi gerektirir, DB hash/size/mtime TEK BASINA asla
// yeterli sayilmaz.
try {
  const attestationModule = await readFile(`${DEPLOY_DIR}pcloud-source-attestation.mjs`, 'utf8')
  assertContains(attestationModule, /plain SQLite INTEGER/, 'pcloud-source-attestation.mjs', 'pCloud file.hash kolonunun 256-bit SHA-256 olamayacagi (64-bit INTEGER) acikca belgelenir')
  assertContains(attestationModule, /SOURCE_SIZE_RACE_VS_PCLOUD_DB_DURING_ATTESTATION/, 'pcloud-source-attestation.mjs', 'attestation sirasinda kaynak/DB boyut yarisi fail-closed yakalanir')
  assertContains(attestationModule, /ATTESTATION_RECORD_HASH_MISMATCH/, 'pcloud-source-attestation.mjs', 'kanit dosyasi okuma sirasinda hash-dogrulama yapilir (tampering fail-closed yakalanir)')

  const gateModule = await readFile(`${DEPLOY_DIR}pcloud-session0-freshness-gate.mjs`, 'utf8')
  assertNotContains(gateModule, /['"]P:\\\\/, 'pcloud-session0-freshness-gate.mjs', 'hicbir P:\\ varsayilani/referansi yok (Session-0-safe olmanin tam nedeni)')
  assertContains(gateModule, /STATUS_PRECEDENCE/, 'pcloud-session0-freshness-gate.mjs', 'CaseStatus her zaman EN KOTU dosya durumunu alir (conflict>syncing>unknown>ready)')
  assertContains(gateModule, /NO_ATTESTATION_FOR_CURRENT_REVISION/, 'pcloud-session0-freshness-gate.mjs', 'attestation yoksa unknown/syncing -- asla sessizce ready degil')
  assertContains(gateModule, /FILE_MISSING_FROM_TARGET/, 'pcloud-session0-freshness-gate.mjs', 'pCloud DB dosyayi listeliyor ama target eksikse sessizce atlanmaz')
  assertContains(gateModule, /PCLOUD_CONFLICT_NAME_PATTERN/, 'pcloud-session0-freshness-gate.mjs', 'conflict-name deseni fail-closed conflict uretir')

  const gateWrapper = await readFile(`${DEPLOY_DIR}run-pcloud-session0-freshness-gate.ps1`, 'utf8')
  assertNotContains(gateWrapper, /['"]P:\\\\|Join-Path\s+['"]P:\\\\['"]/, 'run-pcloud-session0-freshness-gate.ps1', 'hicbir P:\\ varsayilani yok -- run-pcloud-case-reconciliation.ps1nin aksine Session-0-safe')
  assertContains(gateWrapper, /ADMINISTRATOR_REQUIRED/, 'run-pcloud-session0-freshness-gate.ps1', 'admin-only kanit yazimi icin Administrator gerektirir (aracin KENDISI degil -- servis hesabi .mjsyi DOGRUDAN cagirir, ayri bir bulguya bkz. probe inner script)')

  const attestationWrapper = await readFile(`${DEPLOY_DIR}generate-pcloud-source-attestation.ps1`, 'utf8')
  assertContains(attestationWrapper, /ADMINISTRATOR_REQUIRED/, 'generate-pcloud-source-attestation.ps1', 'admin/interactive-context arac -- P:\\ erisimi gerektirir')
  assertNotContains(attestationWrapper, /Start-Service|Set-Service|SetEnvironmentVariable/, 'generate-pcloud-source-attestation.ps1', 'servis/env mutasyonu yok')

  const probeInner = await readFile(`${DEPLOY_DIR}file-agent-disposable-probe-inner.ps1`, 'utf8')
  assertNotContains(probeInner, /ADMINISTRATOR_REQUIRED|WindowsBuiltInRole\]::Administrator/, 'file-agent-disposable-probe-inner.ps1', 'BILEREK Administrator gerektirmez -- svc-hb-fileagent dusuk-yetkili hesaptir, bir admin kontrolu bu betigi o kimlikle calisamaz hale getirirdi')
  assertContains(probeInner, /UnauthorizedAccessException/, 'file-agent-disposable-probe-inner.ps1', 'gercek yazma-reddi kanitlanir (simule edilmez)')
  assertNotContains(probeInner, /Start-Service|Stop-Service|Set-Service|New-Service|New-LocalUser|Set-LocalUser|sc\.exe|SetEnvironmentVariable|Set-Acl|SetAccessControl/, 'file-agent-disposable-probe-inner.ps1', 'hicbir servis/hesap/ACL/env mutasyonu yok -- yalniz DB okuma + yazma-denemesi (basarisizlik beklenir) + freshness gate cagrisi')

  const probePreview = await readFile(`${DEPLOY_DIR}preview-file-agent-disposable-probe-service.ps1`, 'utf8')
  assertNotContains(probePreview, /\[switch\]\$Apply\b/, 'preview-file-agent-disposable-probe-service.ps1', 'yapisal olarak -Apply anahtari yok')
  assertNotContains(probePreview, /<password>/, 'preview-file-agent-disposable-probe-service.ps1', 'planlanan WinSW XMLinde asla <password> elemani yok (HB-2026-118 sc.exe-config-yalniz disiplini)')
  assertContains(probePreview, /<startmode>Manual<\/startmode>/, 'preview-file-agent-disposable-probe-service.ps1', 'planlanan servis Manual baslar -- asla Automatic (tek seferlik probe, kalici servis degil)')
  assertContains(probePreview, /second_service_logon_credential/, 'preview-file-agent-disposable-probe-service.ps1', 'ikinci servisin ayni hesapla oturum acma parola mekanigi (sc.exe/SAM) acikca cozulmemis engel olarak raporlanir')
  // NOTE: does not assertNotContains Start-Service/etc. here -- this
  // script's OWN forbiddenPatterns array (used to check the INNER script)
  // legitimately lists those cmdlet names as strings, which would be a
  // false positive for a naive text-contains check (found via a real
  // audit run while building this block). file-agent-disposable-probe-
  // inner.ps1's own check above is the one that matters for actual calls.

  const gateTests = spawnSync('node', ['--test', `${DEPLOY_DIR}pcloud-session0-freshness-gate.test.mjs`], { encoding: 'utf8' })
  if (gateTests.status !== 0) throw new Error(`pcloud-session0-freshness-gate.test.mjs başarısız — ${gateTests.stderr || gateTests.stdout}`)
  const attestationTests = spawnSync('node', ['--test', `${DEPLOY_DIR}pcloud-source-attestation.test.mjs`], { encoding: 'utf8' })
  if (attestationTests.status !== 0) throw new Error(`pcloud-source-attestation.test.mjs başarısız — ${attestationTests.stderr || attestationTests.stdout}`)

  const probePreviewTests = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `${DEPLOY_DIR}preview-file-agent-disposable-probe-service.tests.ps1`],
    { encoding: 'utf8' },
  )
  if (probePreviewTests.status !== 0 || !/SUMMARY: 0 failure\(s\)/.test(probePreviewTests.stdout)) {
    throw new Error(`preview-file-agent-disposable-probe-service testleri başarısız — ${probePreviewTests.stderr || probePreviewTests.stdout}`)
  }
} catch (error) {
  errors.push(`Session-0-safe freshness gate / disposable probe service tooling doğrulaması çalışmadı — ${error.message}`)
}

// HB-2026-168: mevcut Disabled/Stopped hasarbotu-file-agent servisini
// TAM GERI ALINABILIR gecici probe vehicle olarak kullanma araci. Yeni
// bir servis KAYDETMEZ (HB-2026-167'nin "second_service_logon_credential"
// engelini boyle cozer -- SCM'nin ZATEN sakladigi kimlik bilgisini yeniden
// kullanir), parola sifirlamaz, yeni bir hak vermez.
try {
  const vehicleScript = await readFile(`${DEPLOY_DIR}apply-file-agent-service-vehicle-probe.ps1`, 'utf8')

  assertContains(vehicleScript, /SERVICE_NOT_STOPPED_REFUSING_TO_TOUCH/, 'apply-file-agent-service-vehicle-probe.ps1', 'calisan (Running) bir servise asla dokunulmaz -- fail-closed onkosul')
  assertContains(vehicleScript, /RestoredExactly/, 'apply-file-agent-service-vehicle-probe.ps1', 'geri yukleme sonrasi snapshot ile bit-bit karsilastirma yapilir, guvenilmez')
  assertContains(vehicleScript, /Assert-SnapshotsMatch/, 'apply-file-agent-service-vehicle-probe.ps1', 'StartMode/StartName/PathName/DependOnService/XML hash hepsi yeniden dogrulanir')
  assertNotContains(vehicleScript, /sc\.exe\s+config\s+\S+\s+password=|\$Password\b|New-ServiceAccountPassword|Set-FileAgentServiceLogonCredential/, 'apply-file-agent-service-vehicle-probe.ps1', 'hicbir parola okuma/yazma/sifirlama yok -- SCMnin zaten sakladigi kimlik bilgisi yeniden kullanilir')
  assertNotContains(vehicleScript, /LsaAddAccountRights/, 'apply-file-agent-service-vehicle-probe.ps1', 'YENI bir LSA hakki asla verilmez (yalniz aciklayici yorumda gecebilir, kod olarak asla)')
  assertContains(vehicleScript, /ADMINISTRATOR_REQUIRED/, 'apply-file-agent-service-vehicle-probe.ps1', 'admin-only kanit yazimi + gercek servis config mutasyonu icin Administrator gerektirir')

  const winswExists = existsSync('C:\\Tools\\WinSW-x64.exe')
  if (winswExists) {
    const vehicleTests = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `${DEPLOY_DIR}apply-file-agent-service-vehicle-probe.tests.ps1`],
      { encoding: 'utf8' },
    )
    if (vehicleTests.status !== 0 || !/SUMMARY: 0 failure\(s\)/.test(vehicleTests.stdout)) {
      throw new Error(`apply-file-agent-service-vehicle-probe testleri başarısız — ${vehicleTests.stderr || vehicleTests.stdout}`)
    }
  }
} catch (error) {
  errors.push(`File Agent service-vehicle probe tooling doğrulaması çalışmadı — ${error.message}`)
}

if (errors.length > 0) {
  console.error('WinSW servis config doğrulaması BAŞARISIZ:')
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}

console.log(`Windows servis/depolama doğrulaması geçti: ${checks.length} WinSW şablonu ve fail-closed D7/D8 depolama tooling.`)
