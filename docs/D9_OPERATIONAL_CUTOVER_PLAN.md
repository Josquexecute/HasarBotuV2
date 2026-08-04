# D9 — Gerçek operasyonel devretme planı (PLAN, henüz UYGULANMADI)

Durum: **Yalnız plan + fail-closed önizleme.** Bu belge hiçbir env
değişkeni, servis, dosya veya pCloud ayarı DEĞİŞTİRMEDEN, yalnız
salt-okunur doğrulama ve mevcut (test edilmiş, bu makinede daha önce
gerçekten çalıştırılmış) araçların `-Apply` VERİLMEDEN önizleme
modlarıyla hazırlandı. Gerçek `-Apply` bu paket içinde ÇALIŞTIRILMADI.

**Hedef:** File Agent'ın depolama kökünü `P:\BARAN GLOBAL EKSPERTİZ`
(pCloud sanal sürücü) yerine `C:\HasarBotuStorage\BARAN GLOBAL EKSPERTİZ`
(pCloud senkronize klasör, D7/D8'de doğrulanmış NTFS dizini) yapmak ve
API + File Agent Windows servislerini gerçekten çalışır hâle getirmek.

## 0. Önkoşul — D8 kanıtı

D8 migration doğrulama zinciri (`gate` → `PostSyncRebaseline` →
`AfterSync`) HB-2026-139'da baştan sona `PASS/0` verdi: 6873 dosya, 673
klasör, kaynak (`P:\`) ve hedef (`C:\HasarBotuStorage\...`) arasında tam
SHA-256 eşitliği kanıtlandı. Kanıt: Administrators-only
`C:\ProgramData\HasarBotu\migration-preflight\poststage-aftersync-
20260803T211949338Z-1bb00fbc.json` (+ sha256 sidecar).

**D9 Apply öncesi zorunlu taze-doğrulama:** bu rapor zaman içinde
bayatlar (yeni dosya/senkron aktivitesi). Gerçek `-Apply`'dan hemen önce
`test-storage-sync-migration-preflight.ps1 -Stage AfterSync` (aynı ghost
manifest + bu raporu `-BeforeSyncReportPath` olarak) tek kez yeniden
çalıştırılıp taze `PASS/0` alınmalı — HB-2026-134/136/137/138'de
gözlemlendiği gibi ofis aktivitesi kısa aralıklarla gerçek dosya
değişikliği üretebiliyor.

## 1. Bu paket içinde salt-okunur doğrulanan GERÇEK makine durumu

Aşağıdaki her satır bu paket içinde DESKTOP-EFN2G33 üzerinde gerçekten,
salt-okunur olarak sorgulandı (komutlar ve tam çıktılar §5'te):

| Alan | Gerçek durum |
|---|---|
| `hasarbotu-file-agent` Windows servisi | **Kurulu.** `StartType=Disabled`, `Status=Stopped` (D6, HB-2026-119/120'de gerçekten uygulandı) |
| `hasarbotu-api` Windows servisi | **Kurulu DEĞİL** |
| Servis hesabı `svc-hb-fileagent` | **Var, Enabled=True.** `SeServiceLogonRight` ✓, `SeDenyInteractiveLogonRight` ✓, `SeDenyRemoteInteractiveLogonRight` ✓, `PasswordRequired=True` (HB-2026-120 düzeltmesi) |
| Depolama kökü ACL (`C:\HasarBotuStorage\BARAN GLOBAL EKSPERTİZ`) | **Doğru.** `Administrators`→Full, `DESKTOP-EFN2G33\user` (pCloud senkron hesabı)→Modify, `svc-hb-fileagent`→Modify. Başka ACE yok |
| File Agent uygulama dizini ACL (`C:\HasarBotu\services\file-agent`) | **Doğru** (Read+Execute + yalnız `logs`da Modify) |
| File Agent WinSW XML (render edilmiş, diskte) | `<depend>hasarbotu-api</depend>`, `<serviceaccount><user>svc-hb-fileagent</user></serviceaccount>`, `HASARBOTU_AGENT_ROOTS`/`HASARBOTU_AGENT_SECRET` XML'de YOK (ortam değişkeni bekleniyor) |
| `C:\HasarBotu\services\file-agent\dist\index.js` | **Var** (D6 sırasında dağıtılmış) |
| `C:\HasarBotu\services\api\` (dizinin kendisi) | **YOK** — hiç oluşturulmamış |
| WinSW ikili dosyası | **Var**: `C:\Tools\WinSW-x64.exe` (18.243.033 bayt, file-agent kopyasıyla aynı boyut) |
| `postgresql-x64-17` servisi | `Running`, `StartType=Automatic` |
| `node.exe` | `C:\Program Files\nodejs\node.exe` |
| Repo build çıktısı | `services/api/dist/index.js` VE `services/file-agent/dist/index.js` repo ağacında MEVCUT (tazeliği doğrulanmadı — bkz. Blocker B2) |
| Makine ortam değişkenleri | `HASARBOTU_AGENT_ROOTS`, `HASARBOTU_AGENT_ID`, `HASARBOTU_AGENT_SECRET`, `HASARBOTU_API_BASE_URL`, `DATABASE_URL` — **Machine/User/Process kapsamlarının HİÇBİRİNDE TANIMLI DEĞİL** |
| Uygulama DB rolü parola dosyası | `%USERPROFILE%\.hasarbotu\hasarbotu_app.pass` **var** (içeriği bu pakette OKUNMADI/yazdırılmadı) |

## 2. Hedef son durum

- `hasarbotu-api` servisi kurulu, `Automatic`, `Running`.
- `hasarbotu-file-agent` servisi `Automatic` (şu an `Disabled`), `Running`.
- Makine kapsamında kalıcı ortam değişkenleri:
  - `DATABASE_URL = postgres://hasarbotu_app:<pass dosyasından>@127.0.0.1:5432/hasarbotu`
  - `HASARBOTU_API_BASE_URL = http://127.0.0.1:3100`
  - `HASARBOTU_AGENT_ROOTS = {"baran-global-primary":"C:\\HasarBotuStorage\\BARAN GLOBAL EKSPERTİZ"}`
  - `HASARBOTU_AGENT_ID`, `HASARBOTU_AGENT_SECRET` — API'nin agent-kayıt uç noktasından ÜRETİLECEK gerçek değerler (bkz. Adım 4c)
  - `NODE_ENV = production` (API için)
- `GET /health` → `{"status":"ok",...}`.
- File Agent logunda ilk döngüde `storage_unavailable` YOK.

## 3. Bu paket içinde bulunan gerçek blocker'lar (Apply öncesi çözülmeli)

| Kod | Blocker | Not |
|---|---|---|
| **B1 (mekanizma HAZIR, HB-2026-143, 2026-08-04) — kopyalama HENÜZ UYGULANMADI** | `C:\HasarBotu\services\api\` dizini hâlâ yok. | **Araç hazır:** `deploy-service-artifacts.ps1` (fail-closed, idempotent, atomik, geri alınabilir, allowlist=`dist/`+`package.json`) yazıldı, 12 regresyon testi + statik denetim eklendi. Gerçek makinede yalnız salt-okunur önizleme çalıştırıldı: kaynak `services/api` → hedef `C:\HasarBotu\services\api`, **436 allowlist dosyası, ~1,56 MB**, `would_apply`, sıfır değişiklik. Gerçek `-Apply` HÂLÂ çalıştırılmadı (B6 — kullanıcı onayı + sakin pencere bekliyor). |
| **B7 — ÇÖZÜLDÜ (HB-2026-144, 2026-08-04)** | `deploy-service-artifacts.ps1` yalnız `dist/`+`package.json` taşıyordu — npm workspace'in KÖK `node_modules`'ında hoisted olan çalışma zamanı bağımlılıklarını (fastify, pg, zod, `@hasarbotu/contracts`/`database`/`domain`, argon2, `@napi-rs/canvas`, tesseract.js vb.) TAŞIMIYORDU. | **Çözüldü:** `resolve-runtime-dependency-closure.mjs` (yeni, salt-okunur) `package-lock.json`dan (canlı `node_modules` introspeksiyonu DEĞİL) Node'un KENDİ modül çözümleme sırasıyla birebir eşleşen, deterministik bir kapanış hesaplar — workspace-internal paketler (yalnız kendi `dist/`+`package.json`'ı), harici paketler (TAM dizin, iç içe override'lar dahil, platform-uyumsuz optional'lar ZATEN elenmiş), kilit bütünlüğü çift doğrulamalı. `deploy-service-artifacts.ps1`e opsiyonel `-DependencyClosureManifestPath`/`-RepoRoot` eklendi (verilmezse davranış HB-2026-143 ile birebir aynı — regresyon güvenliği). 27 regresyon testi (deploy) + 16 birim testi (resolver) + 4 izole smoke testi, hepsi geçti. **Gerçek makinede kanıtlandı:** api kapanışı 3 workspace-internal + 113 harici paket (10 platform-uyumsuz optional elendi), file-agent 2+20; her ikisi de gerçek `-Apply` ile izole bir kısa ömürlü test dizinine dağıtıldı (api: 6429 dosya/~102MB, file-agent: 2156 dosya/~158MB, sıfır doğrulama uyumsuzluğu) ve repo köküne/NODE_PATH'e HİÇ erişimi olmayan ayrı bir Node sürecinden `dist/index.js` başarıyla import edilip TÜM modül grafiği (argon2, `@napi-rs/canvas`, tesseract.js dahil native modüller) çözüldü — gerçek servis kodu ASLA başlatılmadı (giriş-noktası koruması nedeniyle). Test dizinleri silindi. |
| **B8 — ÇÖZÜLDÜ (araç, HB-2026-145, 2026-08-04) — gerçek Apply HENÜZ ÇALIŞTIRILMADI** | B7 çözümü sırasında izole smoke testte GERÇEK bir ek sorun bulundu: `services/api/src/traffic-value-loss/rule-source.ts`, hash-doğrulamalı bir referans-veri snapshot'ını (`reference-data/value-loss/real-market-analysis/2026-07-01/1.0.0/snapshot.json`) derlenmiş kod konumuna göre REPO KÖKÜNE sabit kodlanmış göreli yolla (`new URL('../../../../reference-data/...', import.meta.url)`) okuyor — bu, kilit dosyasında hiç görünmez ve servisin KENDİ `dist/`inin dışında kaldığı için normal kopyalama bunu kapsamaz; deploy sonrası `ENOENT` ile çöker (gerçek izole smoke testte üretildi ve doğrulandı). File Agent'ta bu desen YOK (statik tarama: sıfır sonuç). | **Araç TAMAMLANDI:** `provision-extra-data-references.ps1` (yeni) + `verify-value-loss-reference-data-identity.mjs` (yeni) eklendi. Kaynak allowlist (referansı İÇEREN dizinin TAMAMI, kilit dosyasındaki gibi başka hiçbir şey), canonical SHA-256 manifest, uygulamanın KENDİ kanonik JSON hash algoritmasıyla kimlik/sürüm doğrulaması (`packages/domain`nin `VALUE_LOSS_SNAPSHOT_IDENTITY`/`REAL_MARKET_VALUE_LOSS_SNAPSHOT_SHA256` sabitlerine karşı), `-Apply`'dan hemen önce kaynağı TAZE yeniden tarayıp plan-anıyla karşılaştıran eksik/fazla/değişmiş TOCTOU koruması, staging+atomik replace, admin-only hash'li zaman damgalı yedek, idempotency, rollback, bağımsız doğrulama — hepsi var. Hedef konumu, `deploy-service-artifacts.ps1` ile BİREBİR AYNI hesaplamayla `ExtraDataReferences`ten TÜRETİLİR (API'nin sabit yol sözleşmesi HİÇ değiştirilmedi, hiçbir yol bu yeni araçta da sabit kodlanmadı). 12 regresyon testi + 12 kimlik-doğrulama birim testi (GERÇEK diskteki snapshot'a ve domain paketinin GERÇEK sabitine pinlenmiş) + statik denetim, hepsi geçti. **Gerçek makinede kanıtlandı (yalnız salt-okunur önizleme):** `C:\HasarBotu\services\api` hedefine göre hesaplanan konum `C:\HasarBotu\reference-data\value-loss\real-market-analysis\2026-07-01\1.0.0\`dir; 4 dosya (108.525 bayt), kimlik doğrulaması `snapshot.json` için GEÇTİ, `would_apply`, sıfır blocker (§5.G). **Gerçek `-Apply` bu pakette ÇALIŞTIRILMADI** — B6 ile aynı, kullanıcının ayrı onayını bekliyor. |
| **B2** | Repo'daki `services/api/dist/index.js` / `services/file-agent/dist/index.js` çıktısının GÜNCEL HEAD'e karşı taze olduğu doğrulanmadı | Apply öncesi `npm run build:packages` yeniden çalıştırılıp temiz çıkış alınmalı. |
| **B3 (mimari boşluk) — ÇÖZÜLDÜ (HB-2026-142, 2026-08-04)** | `install-services.ps1` her zaman iki servisi de kurardı, tek servis seçme seçeneği yoktu. | **Çözüldü:** `-Services Api` / `-Services FileAgent` / (varsayılan) ikisi parametresi eklendi. `-Services` verilmezse davranış birebir aynı kaldı (regresyon testiyle doğrulandı). Tek-servis modunda seçilmeyen servise ait HİÇBİR dosya/dizin okunmaz/doğrulanmaz. Ayrıca yeni bir idempotency guard'ı eklendi: seçilen servis SCM'de zaten kuruluysa `-Apply` OLMADAN BİLE fail-closed reddedilir (gerçek makinede `hasarbotu-file-agent` ile doğrulandı). 8 regresyon testi (`install-services.tests.ps1`) + statik denetim eklendi, `npm run check:deploy`e bağlandı. Gerçek makinede yalnız salt-okunur önizleme çalıştırıldı (`-Services Api`: yalnız API build eksikliği raporlandı; `-Services FileAgent`: idempotency blocker doğru raporlandı) — hiçbir servis/env/dosya değişmedi. |
| **B4** | Gerçek `HASARBOTU_AGENT_ID`/`HASARBOTU_AGENT_SECRET` yok — bunlar sabit kodlanamaz; API'nin `POST /api/v1/agents` (admin oturumu gerektirir, `services/api/src/agent/routes.ts:187`) uç noktasından ÜRETİLİR ve yalnız BİR KEZ düz metin döner (`services/api/src/agent/store.ts:126` `registerAgent`) | API çalışmadan bu adım atılamaz — sıralama: API kur+başlat (secret olmadan, yalnız `HASARBOTU_AGENT_ROOTS`/`_ID`/`_SECRET` gerektirmeyen kısım) → admin oturumuyla agent kaydet → dönen `agentId`+`secret`i File Agent ortam değişkenlerine yaz → File Agent'ı başlat. |
| **B5 — DOĞRULANDI: BLOCKED (HB-2026-146, 2026-08-04)** | En az bir admin rollü kullanıcının DB'de var olduğu salt-okunur `SELECT` ile doğrulandı (gerçek `hasarbotu_app` bağlantısıyla, parola/bağlantı dizesi hiçbir çıktıya yazdırılmadan). **Sonuç: 0 admin kullanıcı.** | **GERÇEK, doğrulanmış blocker:** `organizations` tablosunda **0 satır**, `users` tablosunda **0 satır** (dolayısıyla admin dahil hiçbir rol atanmış kullanıcı yok). `roles` tablosu 6 kod ile seed edilmiş (migration 0002) ama HİÇBİR organizasyon/kullanıcı satırı ile ilişkilendirilmemiş. Bkz. **B9** — bu, ayrı ve daha temel bir blocker. |
| **B6** | `AGENTS.md` §7 kritik işlem standardı gereği bu, açık kullanıcı onayı gerektiren bir sınıf işlemdir (env/servis değişikliği) | Bu belge onay İSTEĞİDİR — gerçek `-Apply` yalnız kullanıcının bu planı gözden geçirip AÇIKÇA onaylamasından sonra çalıştırılmalı. |
| **B9 — ARACI TAMAMLANDI (HB-2026-147, 2026-08-04) — gerçek Apply HENÜZ ÇALIŞTIRILMADI** | Repo'da organizasyon/kullanıcı (özellikle İLK admin) oluşturacak **HİÇBİR mekanizma yoktu**: `services/api/src/users/routes.ts`de yalnız `GET` (liste), `users/store.ts`de yalnız `list`+`updateRoles` (roller yalnız VAR OLAN bir kullanıcıya atanır) — `INSERT INTO users`/`INSERT INTO organizations` üreten hiçbir HTTP uç noktası, CLI aracı veya seed betiği repo genelinde yoktu. | **Araç TAMAMLANDI:** `bootstrap-first-admin.mjs` (yeni) eklendi — yalnız `organizations=0` VE `users=0` iken çalışır (transaction İÇİNDE TAZE yeniden kontrol, TOCTOU güvenli), gerçek şema/domain doğrulamalarını (`@hasarbotu/contracts`nin `userSummarySchema.shape.email`/`.displayName`, `passwordSchema`) ve gerçek argon2id hash mekanizmasını (`@hasarbotu/api`nin `hashPassword`, `ARGON2_OPTIONS`) YENİDEN KULLANIR — yeniden implemente ETMEZ. Parola ASLA CLI argümanı/dosya/log olarak geçmez — yalnız ham (raw-mode) terminalden yankısız okunur, izin verilen tek bayrak `--apply`dır. Organizasyon+kullanıcı+`user_roles`+iki `audit_events` kaydı TEK DB transaction'ında yazılır; hata veya yarış durumunda tam `ROLLBACK`. 15 test (7 birim/CLI + 8 GERÇEK PostgreSQL entegrasyon testi — tek-kullanımlık red, TOCTOU yarış simülasyonu, geçersiz girdi/DB CHECK ihlali sıfır-satır kanıtı dahil) + statik denetim, hepsi geçti. **Gerçek makinede kanıtlandı (yalnız salt-okunur önizleme):** `hasarbotu_app` bağlantısıyla `Status:"ready"`, `OrganizationCount:0`, `UserCount:0`, `AdminRoleSeeded:true`, sıfır blocker, sıfır satır yazıldı. **Gerçek `-Apply` bu pakette ÇALIŞTIRILMADI** — B6 ile aynı, kullanıcının ayrı onayını bekliyor. |
| **B10 (YENİ, HB-2026-148'de bulundu) — GERÇEK Apply denemesi #1'i Adım 0'da durdurdu** | Kullanıcının açık onayıyla başlatılan gerçek Apply denemesinde, taze Adım 0 (`test-pcloud-post-sync-rebaseline-gate.ps1`) çalıştırıldı: sessizlik kısmı TEMİZ geçti (`ObservedQuietSeconds=689`, `WindowResetCount=0`), ama nihai tam kaynak==hedef SHA-256 karşılaştırması UYUŞMADI (`SOURCE_TARGET_HASH_MISMATCH_AT_PASS`). Salt-okunur `run-pcloud-post-sync-diff-forensics.ps1` ile izole edildi: 6996/7000 dosyadan 6987 özdeş, 2 zararsız metadata-only, **13 GERÇEK fark** (3 ayrı vaka klasöründe) — 6 dosya hedefte TAM SIFIR BAYT (yazma tamamlanmamış gibi), 1 dosya iki tarafta da dolu ama İÇERİK FARKLI, 4 dosya yalnız hedefte var (kaynakta karşılığı yok). Hepsi `PCloudTaskReferenceCount=0` (geçici değil, KARARLI fark). | **Çözülmedi, gerçek bir ürün/operasyon kararı gerektirir** (bu pakette YAPILMADI): hangi dosyaların nasıl ele alınacağı (elle inceleme, HB-2026-130'un dar kapsamlı `repair-post-sync-stale-target-files.ps1` aracıyla mı, başka bir yöntemle mi) kullanıcıya bırakıldı — hiçbir onarım GİRİŞİMİ yapılmadı. Tam dosya listesi (kesin yollar/vaka numaraları) yalnız Administrators-only+hash'li rapordadır (`pcloud-post-sync-diff-forensics-20260804T203501157Z-75ebf919.json`) ve kullanıcıya sohbet içinde tam detayla raporlandı — repo/commit'e (HB-2026-123 ilkesiyle) ALINMADI. **B10 çözülmeden Adım 0 tekrar PASS veremez, D9'un geri kalanı (Adım 1-6) başlatılamaz.** |

## 4. Sıralı Apply planı (yalnız kullanıcı onayından SONRA çalıştırılacak)

Model: Planla → Önizle → Onay → Uygula → Doğrula → Kesinleştir → Audit
(AGENTS.md §7).

### Adım 0 — Taze D8 doğrulaması
```powershell
.\deploy\windows-service\test-storage-sync-migration-preflight.ps1 `
  -Stage AfterSync -GhostExclusionManifestPath $ghostManifest `
  -BeforeSyncReportPath $beforeSyncReport -BeforeSyncReportSha256 $hash
```
`PASS/0` olmadan hiçbir sonraki adıma geçilmez.

### Adım 1 — Dosya hazırlığı (üç alt-adım, bu SIRAYLA — HB-2026-146'da düzeltildi)

**SIRA DÜZELTMESİ (HB-2026-146, 2026-08-04):** Önceki sürüm Adım 1'i
(API dosyaları) Adım 1b'den (reference-data) ÖNCE listeliyordu. Gerçek
makinede taze bir önizleme, `deploy-service-artifacts.ps1`nin KENDİ
`ExtraDataReferences` ön koşulunun `reference-data` hedefte olmadan API
dosyalarının dağıtımını fail-closed REDDETTİĞİNİ kanıtladı — yani
sıralama TERSİNE çalışmaz. Aşağıdaki sıra GERÇEKTEN çalışan tek sıradır
(1b, 1a'dan SONRA ama 1c'den ÖNCE çalıştırılmalı).

**Adım 1a — Kapanış hesaplama (her Apply'dan hemen önce TAZE, salt-okunur):**
```powershell
node deploy\windows-service\resolve-runtime-dependency-closure.mjs `
  --repo-root 'C:\...\HasarBotuV2' --workspace services/api > $env:TEMP\api-closure.json
node deploy\windows-service\resolve-runtime-dependency-closure.mjs `
  --repo-root 'C:\...\HasarBotuV2' --workspace services/file-agent > $env:TEMP\file-agent-closure.json
```
İkisi de `"Status":"ok"` dönmeli (aksi halde sonraki adımlara geçilmez).

**Adım 1b — Ek veri referansı sağlama (reference-data), API dosyalarından ÖNCE:**
```powershell
.\deploy\windows-service\provision-extra-data-references.ps1 `
  -RepoRoot 'C:\...\HasarBotuV2' `
  -DependencyClosureManifestPath "$env:TEMP\api-closure.json" `
  -ServiceTargetDir 'C:\HasarBotu\services\api' `
  -DataLabel 'value-loss-reference-data' `
  -Apply
```
Araç TAMAMLANDI, test edildi, gerçek makinede yalnız önizleme çalıştırıldı
(§5.G, §9) — `C:\HasarBotu\reference-data\...` HENÜZ oluşturulmadı.
`-ServiceTargetDir`in KENDİSİNİN henüz var OLMAMASI sorun değildir (araç
yalnız `C:\HasarBotu\services`in var olmasını ister, gerçek makinede
doğrulandı — §9).

**Adım 1c — API dosyaları (dist/+node_modules kapanışı), Adım 1b'DEN SONRA:**
```powershell
npm run build:packages   # B2: tazelik icin her Apply'dan once yeniden calistirilmali
.\deploy\windows-service\deploy-service-artifacts.ps1 `
  -SourceDir 'C:\...\HasarBotuV2\services\api' `
  -TargetDir 'C:\HasarBotu\services\api' `
  -ServiceLabel 'api' `
  -DependencyClosureManifestPath "$env:TEMP\api-closure.json" `
  -RepoRoot 'C:\...\HasarBotuV2' `
  -Apply
```
`deploy-service-artifacts.ps1` (B1) yazıldı, test edildi, gerçek makinede
yalnız önizleme çalıştırıldı (§5.E/§5.F/§9). **B7 ÇÖZÜLDÜ (HB-2026-144)** —
`-DependencyClosureManifestPath`/`-RepoRoot` verilirse servis artık
gerçekten kendi kendine yeten (self-contained) dağıtılır. Adım 1b
tamamlanmadan bu adım fail-closed REDDEDİLİR (§9'da gerçek makinede
kanıtlandı).

File Agent için de aynı şekilde (kapanış zaten hesaplandı, `ExtraDataReferences`
yok — Adım 1b'ye gerek yok):
```powershell
.\deploy\windows-service\deploy-service-artifacts.ps1 `
  -SourceDir 'C:\...\HasarBotuV2\services\file-agent' `
  -TargetDir 'C:\HasarBotu\services\file-agent' `
  -ServiceLabel 'file-agent' `
  -DependencyClosureManifestPath "$env:TEMP\file-agent-closure.json" `
  -RepoRoot 'C:\...\HasarBotuV2' `
  -Apply
```

### Adım 2 — TAMAMLANDI (HB-2026-142): `install-services.ps1`e `-Services` seçici eklendi
`-Services Api` / `-Services FileAgent` / (varsayılan) ikisi. Mevcut
`-ApiDir`/`-FileAgentDir` semantiği korundu; seçilmeyen servise hiç
dokunulmaz. Zaten kurulu bir servis seçilirse (idempotency) fail-closed
reddedilir. 8 regresyon testi + statik denetim eklendi. Gerçek makinede
yalnız önizleme çalıştırıldı (§5'e eklendi).

### Adım 3 — Yalnız API'nin WinSW kurulumu
```powershell
.\deploy\windows-service\install-services.ps1 -ApiDir 'C:\HasarBotu\services\api' `
  -FileAgentDir 'C:\HasarBotu\services\file-agent' -WinSwExe 'C:\Tools\WinSW-x64.exe' `
  -Services @('Api')   # Adım 2'nin ürettiği yeni parametre
```
Önce `-Apply` OLMADAN çalıştırılıp plan gözden geçirilir, sonra `-Apply`.

### Adım 4 — Secret/ortam değişkenleri (sıra ÖNEMLİ)
```powershell
# 4a) DB parolası yerel dosyadan okunur (asla ekrana/log'a yazılmaz)
$pw = Get-Content "$env:USERPROFILE\.hasarbotu\hasarbotu_app.pass" -Raw
[Environment]::SetEnvironmentVariable('DATABASE_URL', "postgres://hasarbotu_app:$pw@127.0.0.1:5432/hasarbotu", 'Machine')
[Environment]::SetEnvironmentVariable('HASARBOTU_API_BASE_URL', 'http://127.0.0.1:3100', 'Machine')
[Environment]::SetEnvironmentVariable('NODE_ENV', 'production', 'Machine')

# 4b) API başlatılır (File Agent HENÜZ değil — henüz agent kimliği yok)
Start-Service hasarbotu-api
Start-Sleep -Seconds 3
Invoke-RestMethod http://127.0.0.1:3100/health   # "ok" beklenir

# 4c) Admin oturumuyla agent kaydı (GERÇEK admin kimlik bilgisiyle,
# operatör elle çalıştırır — otomatikleştirilmez, secret ekrana YAZILMAZ,
# yalnız güvenli şekilde saklanır):
#   POST /api/v1/agents  { "name": "file-agent-baran-global" }
#   -> { agent: { id, ... }, secret: "..." }  (BİR KEZ döner)
#
# ÖNKOŞUL (B9 — ARACI HAZIR, HB-2026-147, bu adımdan ÖNCE, herhangi bir
# zamanda yapılabilir): giriş yapılabilecek EN AZ BİR admin rollü
# kullanıcı GEREKİR. `bootstrap-first-admin.mjs` (yeni, fail-closed,
# tek-kullanımlık) bunun için yazıldı — DATABASE_URL zaten Machine
# kapsamında tanımlı olduğundan ayrıca env vermeye gerek yok:
#   node deploy\windows-service\bootstrap-first-admin.mjs           # önizleme
#   node deploy\windows-service\bootstrap-first-admin.mjs --apply   # GERÇEK oluşturma (interaktif)
# Yalnız `organizations=0` VE `users=0` iken çalışır (bu paket önizlemesinde
# doğrulandı: Status="ready", OrganizationCount=0, UserCount=0,
# AdminRoleSeeded=true). `--apply` ile org kodu/adı, admin e-posta/görünen
# ad düz metin, PAROLA ise ham (raw-mode) terminalden YANKISIZ okunur —
# hiçbir zaman CLI argümanı/dosya/log olarak geçmez. Gerçek argon2id hash'i
# (`@hasarbotu/api`nin `hashPassword`/`ARGON2_OPTIONS`) ve gerçek
# `@hasarbotu/contracts` doğrulamaları YENİDEN KULLANILIR. Organizasyon +
# kullanıcı + `user_roles` + iki `audit_events` kaydı TEK transaction'da
# yazılır; ikinci çalıştırma (organizations/users artık boş değilse)
# fail-closed reddedilir. Kanıt raporu (parola/hash İÇERMEZ) admin-only ACL
# ile `C:\ProgramData\HasarBotu\migration-preflight\`e yazılır. Bu pakette
# yalnız salt-okunur önizleme çalıştırıldı — gerçek `--apply` B6 ile aynı,
# kullanıcının ayrı onayını bekliyor.

[Environment]::SetEnvironmentVariable('HASARBOTU_AGENT_ID', '<agent.id>', 'Machine')
[Environment]::SetEnvironmentVariable('HASARBOTU_AGENT_SECRET', '<secret>', 'Machine')
[Environment]::SetEnvironmentVariable('HASARBOTU_AGENT_ROOTS', '{"baran-global-primary":"C:\\HasarBotuStorage\\BARAN GLOBAL EKSPERTİZ"}', 'Machine')

# 4d) File Agent'ı Automatic yap ve başlat
Set-Service hasarbotu-file-agent -StartupType Automatic
Start-Service hasarbotu-file-agent
```

### Adım 5 — Smoke test (Doğrula)
- `Get-Service hasarbotu-api, hasarbotu-file-agent` → ikisi de `Running`.
- `Invoke-RestMethod http://127.0.0.1:3100/health` → `status: "ok"`.
- `C:\HasarBotu\services\file-agent\logs\hasarbotu-file-agent.out.log` ilk
  döngüde `storage_unavailable` İÇERMEZ.
- Küçük, zararsız bir gerçek iş (ör. mevcut bir dosyanın salt-okunur
  envanter/okuma işlemi — YAZMA testi burada YAPILMAZ) uçtan uca izlenir.

### Adım 6 — Kesinleştir
- Eski `P:\BARAN GLOBAL EKSPERTİZ` en az 14 gün silinmeden, salt-okunur
  referans olarak tutulur (mevcut karar, PROJECT_STATUS §2903).
- Deployment audit kaydı (RUNBOOK §6 formatı) yazılır.

## 5. Bu paket içinde GERÇEKTEN çalıştırılan salt-okunur önizleme kanıtları

**A) D6 dosya-ajanı hesap/ACL/servis durumu** (`setup-file-agent-service-account.ps1`, `-Apply` YOK):
```
Hesap (svc-hb-fileagent) mevcut mu   : True
Sahip mi: SeServiceLogonRight        : True
Sahip mi: SeDenyInteractiveLogonRight: True
Sahip mi: SeDenyRemoteInteractiveLogonRight: True
Parola gerekli (PasswordRequired)    : True
Depolama koku ACL uygun mu           : True
Uygulama dizini ACL uygun mu         : True
Log dizini ACL uygun mu              : True
WinSW servisi kurulu mu              : True (StartType=Disabled Status=Stopped)
UYARI: hasarbotu-file-agent servisi ZATEN kurulu - bu betik VAR OLAN bir
servisi guncellemez/yeniden kurmaz.
-Apply verilmedi: yalniz durum + plan gosterildi, HICBIR degisiklik yapilmadi.
EXITCODE=0
```

**B) API+File Agent WinSW kurulum önizlemesi** (`install-services.ps1`, `-Apply` YOK, gerçek yollarla):
```
--- HasarBotu V2 Windows servis kurulumu: PLAN ---
  Postgres servisi    : Running
--- Ön koşul HATALARI (kurulum yapılamaz) ---
  - API build çıktısı yok: C:\HasarBotu\services\api\dist\index.js
    (önce 'npm run build --workspace @hasarbotu/api')
EXITCODE=1
```
(`exit 1` beklenen fail-closed davranıştır — hiçbir dosya/servis
değişmedi.)

**C) Tek-servis önizlemesi, HB-2026-142 sonrası** (`install-services.ps1 -Services Api`, `-Apply` YOK, gerçek yollarla):
```
--- HasarBotu V2 Windows servis kurulumu: PLAN ---
  Seçilen servisler   : Api
  API dizini          : C:\HasarBotu\services\api
--- Ön koşul HATALARI (kurulum yapılamaz) ---
  - API build çıktısı yok: C:\HasarBotu\services\api\dist\index.js
    (önce 'npm run build --workspace @hasarbotu/api')
EXITCODE=1
```
File Agent hiç bahsi geçmedi/kontrol edilmedi.

**D) Tek-servis önizlemesi** (`install-services.ps1 -Services FileAgent`, `-Apply` YOK, gerçek yollarla):
```
--- HasarBotu V2 Windows servis kurulumu: PLAN ---
  Seçilen servisler   : FileAgent
  File Agent dizini   : C:\HasarBotu\services\file-agent
--- Ön koşul HATALARI (kurulum yapılamaz) ---
  - hasarbotu-file-agent servisi ZATEN kurulu - bu betik VAR OLAN bir
    servisi güncellemez/yeniden kurmaz.
EXITCODE=1
```
Idempotency guard gerçek, zaten kurulu servise karşı doğru çalıştı;
API/Postgres hiç bahsi geçmedi/kontrol edilmedi.

**E) API deploy önizlemesi, HB-2026-143** (`deploy-service-artifacts.ps1`, `-Apply` YOK, gerçek yollarla — kaynak: repo `services/api`, hedef: `C:\HasarBotu\services\api`):
```
--- HasarBotu V2 servis dağıtımı: preview (api) ---
  Allowlist dosya sayısı : 436
  Toplam bayt         : 1562900
  Hedef zaten var mı  : False
Ön koşullar karşılandı.
-Apply verilmedi: yalnız plan gösterildi, HİÇBİR değişiklik yapılmadı.
{"Status":"would_apply", ...}
```
436 dosya (`dist/` tamamı + `package.json`), ~1,56 MB. Hedef dizin
oluşturulmadı, hiçbir dosya kopyalanmadı.

**F) Kapanış-farkındalı (closure-aware) önizleme, HB-2026-144** (`deploy-service-artifacts.ps1 -DependencyClosureManifestPath ... -RepoRoot ...`, `-Apply` YOK, gerçek yollarla):

API (kaynak: repo `services/api`, hedef: `C:\HasarBotu\services\api`):
```
--- HasarBotu V2 servis dağıtımı: preview (api) ---
  Bağımlılık kapanışı : EVET (workspace-internal=3, harici=113)
  Dağıtılacak dosya sayısı : 0
  Hedef zaten var mı  : False
--- Ön koşul HATALARI (dağıtım yapılamaz) ---
  - Ek veri dosyası hedefte yok/eski (dist/traffic-value-loss/rule-source.js
    içinde '../../../../reference-data/value-loss/real-market-analysis/
    2026-07-01/1.0.0/snapshot.json' referansı) -- beklenen konum:
    C:\HasarBotu\reference-data\value-loss\real-market-analysis\
    2026-07-01\1.0.0\snapshot.json
EXITCODE=2
```
Bu, B8'in GERÇEK makinede doğrulanmış kanıtıdır: `reference-data/`
gerçek `C:\HasarBotu\`e yerleştirilmeden API `-Apply` fail-closed
reddedilir (servis SESSİZCE bozuk dağıtılamaz).

File Agent (kaynak: repo `services/file-agent`, hedef: `C:\HasarBotu\
services\file-agent` — D6'da ZATEN gerçek kurulu, yalnız `dist/`+
`package.json` içeriyor):
```
--- HasarBotu V2 servis dağıtımı: preview (file-agent) ---
  Bağımlılık kapanışı : EVET (workspace-internal=2, harici=20)
  Dağıtılacak dosya sayısı : 2156
  Toplam bayt         : 157738198
  Hedef zaten var mı  : True
  Hedef zaten güncel mi : False
Ön koşullar karşılandı.
-Apply verilmedi: yalnız plan gösterildi, HİÇBİR değişiklik yapılmadı.
```
File Agent'ta `ExtraDataReferences` YOK (statik tarama sıfır sonuç
verdi) — B8 yalnız API'ye özgü. Bu önizleme, D6'da zaten kurulu File
Agent'ın node_modules kapanışıyla self-contained hâle getirilebileceğini
kanıtlar; hiçbir dosya bu paket içinde değişmedi.

Ayrıca izole bir smoke-test dizininde (`C:\HBSmoke144\...`, repoya
DOKUNMAYAN, gerçek `-Apply` ile GERÇEKTEN dağıtılan, iş bitince silinen,
`C:\HasarBotu\...` DEĞİL) her iki kapanış da uygulandı (api: 6429 dosya,
file-agent: 2156 dosya, sıfır doğrulama uyumsuzluğu) ve repo köküne/
`node_modules`'a/`NODE_PATH`'e HİÇ erişimi olmayan ayrı bir Node
sürecinden `dist/index.js` başarıyla import edilip argon2, `@napi-rs/
canvas`, tesseract.js dahil TÜM native modül grafiği çözüldü (giriş
noktası koruması sayesinde gerçek servis kodu ASLA başlatılmadı). Test
dizini ve `C:\ProgramData\...\pre-deploy-backups` altındaki sentetik
test yedekleri silindi.

**G) Ek veri referansı sağlama önizlemesi, HB-2026-145** (`provision-extra-data-references.ps1`, `-Apply` YOK, gerçek yollarla — kaynak: repo `reference-data/value-loss/real-market-analysis/2026-07-01/1.0.0/`, hedef: `deploy-service-artifacts.ps1` ile BİREBİR AYNI hesaplamadan türetildi):
```
--- Ek veri referansı sağlama: preview (value-loss-reference-data) ---
  Kaynak dizin        : C:\...\HasarBotuV2\reference-data\value-loss\real-market-analysis\2026-07-01\1.0.0
  Hedef dizin         : C:\HasarBotu\reference-data\value-loss\real-market-analysis\2026-07-01\1.0.0
  Sağlanacak dosya sayısı : 4
  Toplam bayt         : 108525
  Kimlik doğrulaması yapılan dosya sayısı : 1
  Hedef zaten var mı  : False
Ön koşullar karşılandı (kimlik/sürüm doğrulaması dahil).
-Apply verilmedi: yalnız plan gösterildi, HİÇBİR değişiklik yapılmadı.
{"Status":"would_apply", "IdentityVerifiedFileCount":1, "Blockers":[], ...}
```
Kimlik/sürüm doğrulaması `snapshot.json`ın GERÇEKTEN uygulamanın kabul
edeceği doğru sürüm (`real-market-analysis/2026-07-01/1.0.0`, kanonik
JSON hash `packages/domain`nin `REAL_MARKET_VALUE_LOSS_SNAPSHOT_SHA256`
sabitiyle birebir eşleşiyor) olduğunu GERÇEKTEN doğruladı. 4 dosya
(`manifest.json`, `product-decisions.json`, `schema.json`, `snapshot.json`
— referansı İÇEREN dizinin TAMAMI, allowlist ilkesiyle), hedef dizin
oluşturulmadı, hiçbir dosya kopyalanmadı.

## 6. Rollback planı

`HASARBOTU_AGENT_ROOTS` değişimi geri alınabilirdir (mevcut karar,
PROJECT_STATUS §2903): rootKey DEĞİŞMEZ, yalnız makine ortam değişkeni
eski `P:\BARAN GLOBAL EKSPERTİZ` değerine döndürülüp servisler yeniden
başlatılır — veritabanı DEĞİŞMEZ.

```powershell
Stop-Service hasarbotu-file-agent
[Environment]::SetEnvironmentVariable('HASARBOTU_AGENT_ROOTS', '{"baran-global-primary":"P:\\BARAN GLOBAL EKSPERTİZ"}', 'Machine')
Start-Service hasarbotu-file-agent
```

Daha geniş geri alma (API/File Agent servislerini tamamen durdurup eski
duruma dönmek):
```powershell
Stop-Service hasarbotu-file-agent
Stop-Service hasarbotu-api
Set-Service hasarbotu-file-agent -StartupType Disabled
```
Bu, D9 öncesi duruma (bu belgenin §1'inde belgelenen gerçek durum)
BİREBİR döner — `hasarbotu-api` kurulmuşsa kaldırılması (`hasarbotu-api.exe
uninstall`) ayrı, açık bir karardır.

Eski `P:\` kökü en az 14 gün silinmeden tutulur; rollback bu süre
içinde HER ZAMAN mümkündür.

## 7. Bu pakette YAPILMAYANLAR (kesin liste)

- Hiçbir env değişkeni (Machine/User/Process) yazılmadı/değiştirilmedi.
- Hiçbir Windows servisi kurulmadı/başlatılmadı/durdurulmadı/değiştirilmedi.
- Hiçbir dosya kopyalanmadı/taşınmadı/silinmedi (bu plan dosyası hariç).
- pCloud ayarı, sync eşlemesi hiç değişmedi.
- `setup-file-agent-service-account.ps1` DEĞİŞTİRİLMEDİ — yalnız
  `-Apply` OLMADAN çalıştırıldı.
- Gerçek `DATABASE_URL`/agent secret DEĞERLERİ hiçbir yerde
  okunmadı/yazdırılmadı/kaydedilmedi (yalnız pass dosyasının VARLIĞI
  doğrulandı).

**Güncelleme (HB-2026-142, 2026-08-04):** Yukarıdaki liste ilk plan
paketi (HB-2026-140) içindir. B3'ün çözümü olarak `install-services.ps1`
KOD DEĞİŞİKLİĞİ aldı (`-Services` seçici + idempotency guard'ı) — bu,
kod/test/statik-denetim değişikliğidir, GERÇEK servis/env/deploy
dosyası mutasyonu DEĞİLDİR. Bu değişiklikten sonra bile gerçek
makinede yalnız `-Apply` OLMADAN önizleme çalıştırıldı (§5.C/D); hiçbir
env değişkeni, gerçek Windows servisi, deploy dosyası veya pCloud ayarı
değişmedi.

**Güncelleme (HB-2026-143, 2026-08-04):** B1'in çözümü olarak YENİ bir
araç (`deploy-service-artifacts.ps1` + testleri) EKLENDİ — bu da kod/
test/statik-denetim değişikliğidir, GERÇEK deploy dosyası mutasyonu
DEĞİLDİR. Testler sırasında `C:\ProgramData\HasarBotu\migration-preflight\
pre-deploy-backups\` altına düşen SENTETİK test yedekleri (gerçek kanıtla
karışmasınlar diye) temizlendi. Gerçek makinede yalnız `-Apply` OLMADAN
önizleme çalıştırıldı (§5.E, gerçek `services/api` → `C:\HasarBotu\
services\api`) — hiçbir dosya kopyalanmadı/taşınmadı. Bu çalıştırma
sırasında YENİ bir gerçek blocker (B7, node_modules/bağımlılık çözümü)
bulundu ve belgelendi.

**Güncelleme (HB-2026-144, 2026-08-04):** B7'nin çözümü olarak YENİ bir
araç (`resolve-runtime-dependency-closure.mjs` + testleri) EKLENDİ ve
`deploy-service-artifacts.ps1` kapanış-farkındalı hâle getirildi — bu da
kod/test/statik-denetim değişikliğidir, GERÇEK deploy dosyası mutasyonu
DEĞİLDİR. Gerçek makinede yalnız `-Apply` OLMADAN önizleme çalıştırıldı
(§5.F) — hiçbir dosya `C:\HasarBotu\...`e kopyalanmadı/taşınmadı. Ayrıca
izole, repoya dokunmayan, iş bitince silinen bir smoke-test dizininde
(`C:\HBSmoke144\...`) her iki servis GERÇEKTEN `-Apply` ile dağıtılıp
repo köküne/`NODE_PATH`'e erişimi olmayan ayrı bir Node sürecinden
başarıyla import edildi (native modüller dahil). Bu çalıştırmalar
sırasında YENİ bir gerçek blocker (B8, kilit dışı veri dosyası
referansı) bulundu ve belgelendi; sentetik test yedekleri temizlendi.

**Güncelleme (HB-2026-145, 2026-08-04):** B8'in çözümü olarak İKİ YENİ
araç (`provision-extra-data-references.ps1` + `verify-value-loss-
reference-data-identity.mjs`, ikisi de testleriyle) EKLENDİ — bu da kod/
test/statik-denetim değişikliğidir, GERÇEK deploy dosyası mutasyonu
DEĞİLDİR. Gerçek makinede yalnız `-Apply` OLMADAN önizleme çalıştırıldı
(§5.G, gerçek `reference-data/...` → `C:\HasarBotu\reference-data\...`)
— hiçbir dosya kopyalanmadı/taşınmadı, `C:\HasarBotu\reference-data\`
HÂLÂ yok. Kimlik/sürüm doğrulaması `snapshot.json`ın GERÇEKTEN
uygulamanın (`packages/domain`) kabul edeceği doğru sürüm olduğunu
kanıtladı.

## 8. Onay bekleyen açık kararlar — CEVAPLANDI (2026-08-04)

Kullanıcı aşağıdaki dört soruyu yanıtladı. Bu, yalnız KARARLARIN
kayıt altına alınmasıdır — hiçbiri bu paket içinde UYGULANMADI; her biri
kendi ayrı paketinde, kendi Plan→Önizle→Onay→Uygula→Doğrula döngüsüyle
yürütülecek.

1. **B3 çözümü** → **Onaylandı: önce küçük bir düzeltme yapılacak.**
   `install-services.ps1`e yalnız API'yi kurabilen dar bir seçici
   parametre eklenmesi, File Agent'a hiç dokunulmadan, ayrı küçük bir
   paket olarak yürütülecek (elle/manuel geçici yöntem yerine).
2. **API deploy dizini kopyalama** → **Onaylandı: küçük bir yardımcı
   script ile.** D6'nın File Agent için kullandığı yönteme benzer,
   tekrarlanabilir bir script yazılacak (elle kopyalama yerine).
3. **Agent kaydı (Adım 4c)** → **Onaylandı: uygulama anında kullanıcının
   kendisi elle yapacak.** Yönetici oturumu/şifresi gerektirdiği için
   otomasyona sokulmayacak.
4. **Gerçek Apply zamanlaması** → **Onaylandı: ofis tamamen sakinken,
   önceden planlanmış bir pencerede.** D8 zincirinde görülen kısa
   aktivite patlamalarının riskini azaltmak için.

Bu dört karar kayda geçti. **B3 düzeltmesi TAMAMLANDI (HB-2026-142,
2026-08-04)** — `install-services.ps1` artık File Agent'a hiç dokunmadan
yalnız API'yi kurabiliyor, idempotency guard'ıyla birlikte. **B1'in
mekanizması da TAMAMLANDI (HB-2026-143, 2026-08-04)** —
`deploy-service-artifacts.ps1` yazıldı, test edildi, gerçek makinede
yalnız önizlendi. Gerçek `-Apply` HÂLÂ bu paket içinde başlatılmadı.

**B7 ÇÖZÜLDÜ (HB-2026-144, 2026-08-04):** `deploy-service-artifacts.ps1`
artık opsiyonel `-DependencyClosureManifestPath`/`-RepoRoot` ile
kendi kendine yeten (self-contained) dağıtım üretebiliyor — hem API hem
(zaten gerçek kurulu) File Agent için gerçek makinede kanıtlandı (§5.F).

**B8 ARACI TAMAMLANDI (HB-2026-145, 2026-08-04):** `provision-extra-data-
references.ps1` + `verify-value-loss-reference-data-identity.mjs`
yazıldı, test edildi (24 regresyon+birim testi), gerçek makinede yalnız
önizlendi (§5.G) — `C:\HasarBotu\reference-data\...` HÂLÂ yok, gerçek
`-Apply` bu paket içinde çalıştırılmadı. D9'un Adım 3-6'sı (gerçekten
sakin bir pencerede, kullanıcının açık onayıyla) çalıştırılmadan ÖNCE
Adım 1b (`provision-extra-data-references.ps1 -Apply`) ile
`reference-data/` gerçekten `C:\HasarBotu\reference-data\`e
yerleştirilmelidir — yoksa API'nin `traffic-value-loss` modülü servis
başlatıldığında `ENOENT` ile çöker. File Agent bu sorundan etkilenmiyor
(kendi kapanışında `ExtraDataReferences` yok).

## 9. Gerçek cutover öncesi son salt-okunur hazırlık denetimi (HB-2026-146, 2026-08-04)

Bu bölüm, gerçek `-Apply`den hemen önce yapılan SON denetimdir. Hiçbir
build, deploy, reference-data, env veya servis değişikliği YAPILMADI —
her satır bu paket içinde GERÇEKTEN, salt-okunur olarak sorgulandı.

### 9.1 Tek tablo — PASS / BLOCKED

| Alan | Durum | Kanıt |
|---|---|---|
| **B1 — API dosyaları dağıtımı** | **BLOCKED** | Taze önizleme: `deploy-service-artifacts.ps1`, kapanış-farkındalı, `C:\HasarBotu\services\api` hedefine karşı → `Status:"blocked"`, tek blocker: reference-data hedefte yok (B8'e bağımlı — araç KENDİSİ bozuk değil, sıralama gereği). |
| **B7 — Dependency closure hesaplama** | **PASS** | Taze hesaplama: api → 3 workspace-internal + 113 harici (10 platform-uyumsuz optional elendi), file-agent → 2+20; ikisi de `Status:"ok"`, `lockIntegrityOk` hepsinde `true`. |
| **B8 — reference-data sağlama** | **PASS (önizleme)** | Taze önizleme: `provision-extra-data-references.ps1` → `Status:"would_apply"`, 4 dosya (108.525 bayt), kimlik/sürüm doğrulaması `snapshot.json` için GEÇTİ, sıfır blocker. `C:\HasarBotu\reference-data` HÂLÂ yok. Ön koşulu (`C:\HasarBotu\services`) GERÇEKTEN var — B1'den BAĞIMSIZ çalışabiliyor. |
| **B2 — Build tazeliği** | **PASS (proxy, kesin değil)** | `git status` 5/5 ilgili dizinde (`services/api`, `services/file-agent`, `packages/{contracts,database,domain}`) TEMİZ; `dist/` mtime'ı `src/` mtime'ından YENİ (5/5). Gerçek `npm run build:packages` çalıştırılmadan KESİN garanti YOK — Apply'dan hemen önce yine de çalıştırılmalı (Adım 1c). |
| **Servis hesabı (`svc-hb-fileagent`)** | **PASS** | Taze önizleme (`setup-file-agent-service-account.ps1`): hesap var, `SeServiceLogonRight`/`SeDenyInteractiveLogonRight`/`SeDenyRemoteInteractiveLogonRight` ✓, `PasswordRequired=True`. Sürüklenme YOK. |
| **ACL** | **PASS** | Aynı çalıştırma: depolama kökü ACL, uygulama dizini ACL, log dizini ACL — üçü de `True`. |
| **`install-services.ps1` fail-closed davranışı** | **PASS** | Taze önizleme: `-Services Api` → API build eksik (beklenen, B1/B2 henüz tamam değil); `-Services FileAgent` → idempotency guard doğru reddediyor (zaten kurulu). |
| **env (Machine/User/Process)** | **PASS (beklenen boş durum)** | `HASARBOTU_AGENT_ROOTS`/`_ID`/`_SECRET`/`HASARBOTU_API_BASE_URL`/`DATABASE_URL`/`NODE_ENV` — ÜÇ kapsamın DA HİÇBİRİNDE tanımlı değil. `hasarbotu-api` servisi kurulu değil; `hasarbotu-file-agent` `Stopped`/`Disabled`; `postgresql-x64-17` `Running`/`Automatic`. |
| **DB erişimi** | **PASS** | `hasarbotu_app` rolüyle GERÇEK bağlantı kuruldu (parola `%USERPROFILE%\.hasarbotu\hasarbotu_app.pass`den okundu, HİÇBİR ÇIKTIYA yazdırılmadı — yalnız sayısal sonuçlar). |
| **B5 — admin kullanıcı var mı** | **BLOCKED (yeni doğrulandı)** | Aynı bağlantıyla salt-okunur `SELECT`: `organizations` = **0 satır**, `users` = **0 satır**, dolayısıyla admin dahil **0 rol atanmış kullanıcı**. `roles` tablosu 6 kodla seed edilmiş (`admin` dahil) ama hiçbir kullanıcıya bağlı değil. |
| **B9 — admin bootstrap mekanizması** | **PASS (araç TAMAMLANDI, HB-2026-147)** | `bootstrap-first-admin.mjs` yazıldı, 15 test (8'i GERÇEK PostgreSQL entegrasyonu) + statik denetim geçti. Gerçek makinede önizleme: `Status:"ready"`, `OrganizationCount:0`, `UserCount:0`, `AdminRoleSeeded:true`, sıfır blocker, sıfır satır yazıldı. Gerçek `--apply` bu pakette ÇALIŞTIRILMADI. |
| **B4 — Agent secret üretimi** | **BLOCKED (B5/B9'a bağımlı)** | `services/api/src/agent/routes.ts:187` `POST /api/v1/agents` → `requireAdmin` gate'i (`AGENT_ADMIN_ROLES.has(role)`) kod okumasıyla DOĞRULANDI — admin oturumu olmadan ERİŞİLEMEZ, B9 çözülmeden imkânsız. |
| **B6 — kullanıcı onayı** | **BEKLEMEDE** | Bu bölüm dahil tüm belge onay İSTEĞİDİR. |
| **Rollback** | **PASS (mekanizma, henüz kullanılmadı)** | `deploy-service-artifacts.ps1 -Rollback` ve `provision-extra-data-references.ps1 -Rollback` ikisi de sentetik regresyon testleriyle KANITLANMIŞ (HB-2026-143/145); `HASARBOTU_AGENT_ROOTS` geri alma §6'da belgeli. Henüz GERÇEK bir yedek YOK (hiç `-Apply` çalıştırılmadı) — bu BEKLENEN durumdur. |
| **Smoke-test önkoşulları** | **PASS (araç hazır)** | `smoke-test-deployed-service.mjs` mevcut ve test edilmiş (HB-2026-144, izole modül-çözümleme kanıtı). Adım 6'nın (servis durumu, `/health`, log kontrolü) uç noktaları kod okumasıyla DOĞRULANDI: `HEALTH_ROUTE='/health'`, `AGENTS_ROUTE='/api/v1/agents'` — sürüklenme yok. |

### 9.2 Yeni bulgu: B9 — ilk admin kullanıcısı bootstrap mekanizması yok

B5'in "0 admin kullanıcı" sonucu araştırılırken, bunun tek başına
GEÇİCİ bir durum değil, **yapısal bir boşluk** olduğu ortaya çıktı:
repo'da hiçbir yerde (HTTP uç noktası, CLI aracı, migration seed'i)
organizasyon veya kullanıcı OLUŞTURAN bir kod yolu yok — yalnız VAR OLAN
kayıtları okuyan/güncelleyen kod var. `users`/`organizations` tabloları
migration'da seed edilmez (ID'ler uygulamada UUIDv7 üretilir, DB
varsayılanı yok). Bu, D9'un kendisinin bulduğu bir kusur değil,
sistemde önceden var olan ve şimdiye kadar hiç Apply denenmediği için
fark edilmemiş bir boşluktur (B7/B8'in ortaya çıkış şekliyle aynı
desen).

**HB-2026-147 güncellemesi (2026-08-04): çözüldü.** Kullanıcı ayrı küçük bir
"ilk admin bootstrap" aracı istedi — `bootstrap-first-admin.mjs` (yeni)
bu ihtiyacı karşılıyor: yalnız `organizations=0` VE `users=0` iken çalışır,
gerçek şema/domain doğrulamalarını ve gerçek argon2id hash mekanizmasını
yeniden kullanır, parola asla argv/dosya/log olarak geçmez, tek transaction
+ audit kanıtı üretir, tekrar çalıştırmayı fail-closed reddeder (bkz. §3 B9
ve Adım 4c). Ayrıntılar için `docs/DECISION_LOG.md` HB-2026-147.

### 9.3 Sonuç

D9 gerçek `-Apply`'ı şu an TEK bağımsız neden ile mümkün değil:
1. ~~Sıralama düzeltmesi gerekiyor (B1↔B8)~~ — §4'te düzeltildi, YENİ kod
   DEĞİŞİKLİĞİ gerektirmiyor, yalnız doğru SIRAYLA çalıştırılmalı.
2. ~~B9 (admin bootstrap) çözülmeli~~ — **araç TAMAMLANDI (HB-2026-147)**,
   yalnız salt-okunur önizleme ile kanıtlandı.
3. **B6 — kullanıcının açık onayı** — AGENTS.md §7 gereği, tek kalan ve
   ASLA otomatikleştirilemeyecek adım.

B2/B4/B5 gerçek `-Apply` sırasında Adım 4'teki SIRAYLA uygulanacak;
hiçbiri ayrı bir kod/araç değişikliği gerektirmiyor. **Gerçek `-Apply`
için kullanıcının açık onayı bekleniyor.**

## 10. Gerçek Apply denemesi #1 — Adım 0'da B10 ile durduruldu (HB-2026-148, 2026-08-04)

Kullanıcının "D9 gerçek cutover için açık onay veriyorum" talimatıyla
gerçek Apply denemesi başlatıldı. **Adım 0 (taze D8 doğrulaması) FAIL
verdi** — bkz. §3 B10. Sessizlik/zamanlama sorunu DEĞİL: gerçek 689
saniyelik kesintisiz sessizlik elde edildi. Sorun, nihai tam kaynak==
hedef SHA-256 karşılaştırmasının 13 dosyada UYUŞMAMASI (6 dosya
hedefte sıfır bayt, 1 dosya iki tarafta da farklı içerik, 4 dosya
yalnız hedefte). Talimat gereği ("herhangi bir blocker... sonraki
adıma geçme") **Adım 1'e HİÇ geçilmedi** — hiçbir env/servis/deploy/DB
değişikliği denenmedi, dolayısıyla rollback edilecek bir şey yoktu.

Tam dosya/vaka detayı yalnız Administrators-only+hash'li rapordadır;
kullanıcıya sohbet içinde tam olarak raporlandı. **D9'un geri kalanı
(Adım 1-6), kullanıcı B10'u nasıl ele alacağına karar verip Adım 0
tekrar temiz PASS verene kadar başlatılamaz.**
