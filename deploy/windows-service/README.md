# HasarBotu V2 — Windows servis ve depolama geçiş araçları (D5–D7)

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
| `test-storage-sync-migration-preflight.ps1` | D7 için tamamen salt-okunur envanter/kapasite/tam SHA-256 kapısıdır. Yol veya dosya adı sızdırmadan JSON özet ve fail-closed çıkış kodu üretir; dosya, ayar, ortam değişkeni veya servis değiştirmez. |

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
  kurulum yapmaz; D7 preflight aracı ise hiçbir modda yazma yapmaz. Bu
  makinedeki gerçek D6 sonucu ve D7 salt-okunur ölçümü runbook/karar
  günlüğünde ayrıca kayıtlıdır. pCloud ayarı, veri kopyalama,
  `HASARBOTU_AGENT_ROOTS` değişikliği ve servis başlatma bu araçların
  kendiliğinden yaptığı işlemler değildir.
