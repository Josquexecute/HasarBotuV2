# HasarBotu V2 — Windows servis dağıtım araçları (D5, HB-2026-108)

Bu dizin **kod değildir**; Faz A ofis dağıtımı için WinSW servis şablonları
ve iki yardımcı PowerShell betiği içerir. Tam prosedür için:

**→ [`docs/RUNBOOK_FAZ_A_WINDOWS_SERVICE_DEPLOYMENT.md`](../../docs/RUNBOOK_FAZ_A_WINDOWS_SERVICE_DEPLOYMENT.md)**

## İçerik

| Dosya | Amaç |
|---|---|
| `hasarbotu-api.winsw.xml` | API için WinSW servis **şablonu**. Makineye özgü yer tutucu (`__NODE_EXE__`, `__APP_DIR__`) içerir; olduğu gibi kurulmaz. |
| `hasarbotu-file-agent.winsw.xml` | File Agent için WinSW servis **şablonu**. Aynı yer tutucu modeli. |
| `install-services.ps1` | Şablonları render edip WinSW ile kurar. `-Apply` verilmeden yalnız PLAN yazdırır, hiçbir değişiklik yapmaz. |
| `probe-p-drive-system-context.ps1` | Bir sürücü harfinin SYSTEM (Windows servis) bağlamından GERÇEKTEN görünüp görünmediğini geçici, kendi kendini temizleyen bir Görev Zamanlayıcı görevi ile ölçer. |

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
- **Gerçek kurulum.** Bu pakette hiçbir servis gerçek bir makineye
  kurulmadı; `install-services.ps1` yalnız sözdizimi ve ön koşul
  doğrulama testleriyle (bkz. `scripts/check-windows-service-configs.mjs`
  ve repo testleri) kanıtlandı.
