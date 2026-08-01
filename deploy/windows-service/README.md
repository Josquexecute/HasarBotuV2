# HasarBotu V2 — Windows servis ve depolama geçiş araçları (D5–D8)

Bu dizin **kod değildir**; Faz A ofis dağıtımı için WinSW servis şablonları
ve salt-okunur/planlı PowerShell araçları içerir. Tam prosedür için:

**→ [`docs/RUNBOOK_FAZ_A_WINDOWS_SERVICE_DEPLOYMENT.md`](../../docs/RUNBOOK_FAZ_A_WINDOWS_SERVICE_DEPLOYMENT.md)**

## İçerik

| Dosya | Amaç |
|---|---|
| `hasarbotu-api.winsw.xml` | API için WinSW servis **şablonu**. Makineye özgü yer tutucu (`__NODE_EXE__`, `__APP_DIR__`) içerir; olduğu gibi kurulmaz. |
| `hasarbotu-file-agent.winsw.xml` | File Agent için WinSW servis **şablonu**. Aynı yer tutucu modeli. |
| `install-services.ps1` | Şablonları render edip WinSW ile kurar. `-Apply` verilmeden yalnız PLAN yazdırır, hiçbir değişiklik yapmaz. |
| `probe-p-drive-system-context.ps1` | Bir sürücü harfinin SYSTEM (Windows servis) bağlamından GERÇEKTEN görünüp görünmediğini geçici bir Görev Zamanlayıcı görevi ile ölçer. Görev KAYDI her durumda kaldırılır; sonuç/log `C:\ProgramData\HasarBotu\probe\` altında zaman damgalı, kalıcı audit kanıtı olarak bırakılır. |
| `setup-file-agent-service-account.ps1` | D6 için adanmış File Agent hesabı, LSA hakları, dar ACL ve WinSW kurulumunu planlar; yalnız açık `-Apply` ile değişiklik yapar ve hata halinde geri alır. |
| `test-storage-sync-migration-preflight.ps1` | D7/D8 için tamamen salt-okunur envanter/kapasite/tam SHA-256 kapısıdır. Hashli ve Administrators-only exact ghost exclusion manifesti olmadan taramaya başlamaz. D8 başlangıcı yalnız admin-only bakım raporlu `D8BeforeSync` stage'idir; raporu tam hash öncesi/sonrası güncel doğrular. `AfterSync` yalnız bu stage'in hashli PASS raporunu kabul edip kaynak tam manifestinin senkron öncesi baseline ile değişmediğini doğrular. Wildcard, uzantı veya klasör kuralı kabul etmez. Yol veya dosya adı sızdırmadan JSON özet ve fail-closed çıkış kodu üretir. |
| `validate-storage-ghost-exclusion.mjs` | Exclusion manifestindeki tam 10 path/fileId kaydını strict şema ile doğrular ve her fileId+metadata bağını yerel pCloud DB'de `mode=ro&immutable=1` ile yeniden kontrol eder. Yalnız güvenli sayaç/kod çıktısı verir. |
| `invoke-storage-source-io-diagnostic.ps1` | D7 kaynak `IO_ERROR` kayıtlarını salt-okunur sınıflandırır. İlk hata ve üç kontrollü yeniden okumayı, offline/reparse, paylaşım kilidi ve yol uzunluğu bulgularıyla birlikte yalnız Administrators erişimli `C:\ProgramData\HasarBotu\migration-preflight` raporuna yazar; konsola dosya/yol adı vermez. |
| `test-pcloud-maintenance-window-gate.ps1` | D8 öncesi fail-closed uzak-yazar izolasyon kapısıdır. pCloud DB+WAL diff cursor/uzak envanterini ve kaynak envanterini birlikte izler; üretimde 600 saniyenin altına inemez. Create/modify/delete, yalnız cursor ilerlemesi veya kaynak hareketi sayacı sıfırlar. Başlangıç/son tam SHA-256 eşitliği olmadan D8 izni üretmez; sonucu admin-only rapor+sidecar olarak yazar. `-ProbeOnly` yazmasız uyumluluk kontrolüdür ve daima `BLOCKED/2` verir. |
| `pcloud-maintenance-window-gate.mjs` | Yukarıdaki kapının dependency'siz Node çekirdeğidir. Kilitli canlı SQLite'ı doğrudan açmak yerine kaynak DB+WAL'i yalnız OS temp alanına tutarlı snapshot alıp `quick_check` ile doğrular; temp snapshot her örnekten sonra silinir. Müşteri yolu/adı çıktısı üretmez. |
| `pcloud-maintenance-window-gate.test.mjs` | Sanal saat ve sentetik pCloud/source envanteriyle 600 saniye alt sınırı, cursor-only hareketi, create/modify/delete sayımı, timer reseti, başlangıç/son hash eşitliği, WAL snapshot ve kısa-süre bypass reddini test eder. |
| `pcloud-database-quiescence.ps1` | `D8BeforeSync`'in tam kaynak hash geçişinin hemen ardından, DB snapshot kontrolüne geçmeden önce pCloud yerel `data.db`/`-wal`/`-shm` için sınırlı (bounded) bir sakinlik bariyeri sağlar: 5 saniye aralıkla varlık+boyut+`LastWriteTimeUtc` örnekler, en az 3 ardışık aynı örnek olmadan geçit vermez, her değişimde ardışık sayacı sıfırlar, en fazla 180 saniye sonra `timeout` döner. Yan etkili üst seviye kod içermez; yalnız fonksiyon tanımları — hem `test-storage-sync-migration-preflight.ps1` hem de kendi test dosyası tarafından `dot-source` edilir. `withConsistentPcloudDatabase`'in (Node çekirdeği) kendi doğrulamasını ve 15 dakikalık tazelik kuralını değiştirmez; tamamen ayrı, ek bir katmandır. |
| `pcloud-database-quiescence.tests.ps1` | Yukarıdaki bariyer için bağımlılıksız test script'i (Pester gerektirmez). Enjekte edilebilir örnekleyici/uyku/saat sayesinde PASS/reset/timeout durum makinesini gerçek zaman beklemeden deterministik test eder; ayrıca Türkçe karakterli (`ı`/`İ`) manifest yollarının yalnız UTF-8 `File.ReadAllText` ile doğru okunduğunu ve `Get-Content` varsayılanının (sistem kod sayfası) bunu bozduğunu regresyon testiyle sabitler. |

## Bu repo'da OLMAYANLAR (bilinçli)

- **WinSW ikili dosyası commit edilmez.** Kaynak koddan derlenmiş bir
  yürütülebilir dosyayı sürüm kontrolüne eklemek AGENTS.md'nin genel
  hijyeniyle çelişir. Resmi ve imzalı ikili
  [github.com/winsw/winsw/releases](https://github.com/winsw/winsw/releases)
  adresinden indirilip yalnız KURULUM MAKİNESİNDE tutulur.
- **Secret/DATABASE_URL/mutlak `P:\` yolu.** Şablonlarda yalnız
  `NODE_ENV=production` gibi secret OLMAYAN ortam değişkenleri vardır.
  Gerçek değerler makine kapsamlı ortam değişkeni olarak RUNBOOK'ta
  ayrı ayarlanır — `services/api/src/config.ts`'in zaten uyguladığı
  "process ortamından oku, repo'ya/`.env`'e yazma" kuralıyla birebir
  tutarlıdır.
- **Kendiliğinden gerçek kurulum/geçiş.** Araçlar açık `-Apply` olmadan
  kurulum yapmaz; D7/D8 preflight aracı ise hiçbir modda yazma yapmaz. Bu
  makinedeki gerçek D6 sonucu ve D7 salt-okunur ölçümü runbook/karar
  günlüğünde ayrıca kayıtlıdır. pCloud ayarı, veri kopyalama,
  `HASARBOTU_AGENT_ROOTS` değişikliği ve servis başlatma bu araçların
  kendiliğinden yaptığı işlemler değildir.
- **Bakım kapısının Add Sync yetkisi yoktur.** Kapı yalnız ölçer ve kanıt
  üretir. pCloud UI ayarı, `Add Sync`, kaynak/hedef dosya, registry/env ve
  servis durumu üzerinde yazma yolu içermez. `D8BeforeSync PASS/0` olmadan
  runbook D8 başlangıcına izin vermez.
