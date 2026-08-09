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

**Strateji değişikliği (HB-2026-162, 2026-08-07):** HB-2026-148'den
HB-2026-161'e kadar süren gerçek olay zinciri, yukarıdaki GLOBAL (bütün
tenant ağacı, 600 sn kesintisiz sessizlik) kapının canlı bir ofiste
operasyonel olarak çalışmadığını kanıtladı — bkz.
`docs/D9_PER_CASE_RECONCILIATION_ARCHITECTURE.md`. Global kapı
(`pcloud-post-sync-rebaseline-gate.mjs` ve iki wrapper'ı) **hiç
değiştirilmedi** ve hâlâ geçerli, doğru bir periyodik/manuel bütünlük
denetim aracıdır — ama artık kritik işlemler için TEK ön koşul değildir.
Yeni, dar kapsamlı per-case reconciliation motoru
(`pcloud-case-reconciliation.mjs` / `run-pcloud-case-reconciliation.ps1`)
salt-okunur olarak uygulandı ve gerçek 10 vaka klasörüne karşı doğrulandı.
File Agent'a CANLI entegrasyon henüz YAPILMADI — açık bir güvenlik kararı
(`svc-hb-fileagent`'ın pCloud'un interaktif hesabına ait yerel DB'sine
okuma erişimi) gerektiriyor, bkz. mimari belgesi §8. Bu nedenle **Adım
0'ın aşağıdaki gerçek Apply prosedürü değişmedi** — D9'un geri kalanının
(Adım 1-6) yeni modele göre yeniden sıralanıp sıralanmayacağı ayrı, açık
bir kullanıcı kararı gerektirir.

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
| **B10 (HB-2026-148…158) — ÇÖZÜLDÜ: 22/22 dosya (17 repair + 5 cleanup) GERÇEKTEN işlendi (2026-08-06)** | Post-sync forensics'te gerçek, sürekli tekrarlanan bir desen: bazı dosyalar hedefte "stale" (`repair-post-sync-stale-target-files.ps1` konusu), bazıları "extra" (kaynakta hiç karşılığı yok — `cleanup-post-sync-target-only-files.ps1` konusu). | **Repair yolu (HB-2026-149/150/151/155/156):** genel şema için adapter eklendi, bir `revisions[0]`-sıra-bağımlılığı hatası düzeltildi. **Gerçek `-Apply` iki kez: 17/17 dosya onarıldı**, sıfır sürüklenme, bağımsız doğrulandı. **Cleanup yolu (HB-2026-157/158):** kalan 5 `extra` dosya salt-okunur köken doğrulamasıyla kesin `rename_artifact`(2)/`stale_duplicate`(3) kanıtlandı; yeni `cleanup-post-sync-target-only-files.ps1` yazıldı. **Gerçek `-Apply` (silme) çalıştırıldı: 5/5 başarılı, sıfır blocker** — hedefler sync kökü dışında Administrators-only+hash'li yedeklendi, silindi, bağımsız doğrulandı. **B10'un kendisi artık ÇÖZÜLDÜ — 22/22 dosya (17+5) gerçek makinede işlendi, sıfır sürüklenme.** **Önemli, B10'dan bağımsız yeni bulgu (HB-2026-158):** bağımsız doğrulama sırasında, bu araçların HİÇBİRİNİN dokunmadığı 4-5 dosyanın (2 vaka klasöründeki "doğru konum" kopyaları + 1 benign metadata_only kaydı) EŞ ZAMANLI olarak GERÇEK pCloud tarafında bağımsız şekilde silindiği bulundu (kaynaktan da kayıp, pCloud'un canlı dosya tablosunda eski fileId'ler tamamen yok — yeniden adlandırma/taşıma değil, gerçek silme) — bu araçların YAPISAL olarak sebep olması imkânsız (kaynağa hiç yazmazlar, bu dosyalar aday listesinde hiç yoktu); muhtemelen operatör aynı vaka klasörlerinde eş zamanlı gerçek iş yapıyordu. Bu yeni olay için hiçbir aksiyon alınmadı. **D9 Adım 0 tek seferlik yeniden çalıştırıldı: hâlâ BLOCKED ama artık B10'dan değil** — sessizlik TAM TEMİZ geçti (658 sn, sıfır reset), blocker gerçek bir içerik farkı (`SOURCE_TARGET_HASH_MISMATCH_AT_PASS`), muhtemelen bu yeni, ayrı olayın yansıması. |

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

**Güncelleme (HB-2026-149, 2026-08-04):** Kullanıcının talebiyle
allowlist yalnız ham Administrators-only forensics JSON'undan
(metin özetine güvenilmeden) yeniden çıkarıldı ve 11 endişe verici
dosyanın her biri için pCloud DB'sine TAZE (rapor anından değil,
şimdi) tekil sorgu + kaynak/hedef SHA-256 yeniden hesaplama
yapıldı — sıfır sürüklenme bulundu. Kesin sonuç: 7 repair adayı
(kanıtlanmış `source_current`/`target_stale`) + 4 blocker
(kaynakta karşılığı yok, dokunulmadı) + 2 kapsam dışı (zararsız
metadata farkı). Ayrıca `repair-post-sync-stale-target-files.ps1`nin
(HB-2026-130) yalnız kendi eski, olaya özel şemasını kabul ettiği ve
bu raporu reddettiği bulundu — bkz. §3 B10. Hiçbir `-Apply` hâlâ
çalıştırılmadı.

**Güncelleme (HB-2026-150, 2026-08-05):** `repair-post-sync-stale-
target-files.ps1` genel şemayı destekleyecek şekilde genelleştirildi
(eski yol değişmedi) — bkz. §3 B10 ve `docs/DECISION_LOG.md`. Gerçek
makinede yalnız önizleme, gerçek B10 raporuna karşı: `WouldApplyCount=
7, ClassificationBlockedCount=4, OutOfScopeCount=2`. Gerçek onarım
Apply'ı hâlâ çalıştırılmadı.

**Güncelleme (HB-2026-151, 2026-08-05):** Kullanıcının açık onayıyla
gerçek `-Apply` çalıştırıldı — **7/7 dosya başarıyla onarıldı**,
sıfır sürüklenme/blocker, `ClassificationBlockedCount=4`/
`OutOfScopeCount=2` dokunulmadan kaldı (bağımsız SHA-256 yeniden
hash'lemeyle doğrulandı). Orijinal içerik 7 ayrı Administrators-only+
hash'li yedekte korunuyor, geri alınabilir. pCloud/env/servis hiç
değişmedi. **D9 cutover'a (Adım 0-6) DEVAM EDİLMEDİ** — talimat
gereği yalnız bu onarım çalıştırıldı. Kalan: 4 target-only dosya
(kaynakta karşılığı yok) ayrı, çözülmemiş bir konu; D9 Adım 0'ın taze
tekrar çalıştırılması ayrı bir kullanıcı talebini bekliyor.

**Güncelleme (HB-2026-152/153/154, 2026-08-04–05):** Adım 0 birkaç kez
salt-okunur yeniden çalıştırıldı. Her seferinde ofis aktivitesi (yeni
gerçek vaka/fotoğraf yüklemeleri) taze, o ana özgü ek farklar üretti;
bazıları kendiliğinden düzeldi (aktif yükleme sırasında yakalanmıştı),
bazıları tamamen kayboldu (dosya iki taraftan da silinmiş). Sessizlik
şartı bir kez tam temiz sağlandı (907 sn, sıfır reset) ama o anda bile
gerçek bir içerik farkı hâlâ vardı — Adım 0'ın bloke olması artık
zamanlama değil, gerçek veri farkı meselesiydi.

**Güncelleme (HB-2026-155, 2026-08-05):** Ham forensics JSON'undan tam
envanter çıkarıldı: **27 fark, 6 vaka klasöründe** (5 extra + 17
content_mismatch + 5 metadata_only) — dünden bugüne kaynak/hedef dosya
sayısı ~667/668 artmış, gerçek yoğun iş akışını yansıtıyor.

**Güncelleme (HB-2026-156, 2026-08-05):** Kullanıcının açık onayıyla
17 stale_target dosyanın TAMAMI için gerçek `-Apply` çalıştırıldı —
**17/17 başarılı**, bkz. §3 B10.

**Güncelleme (HB-2026-157, 2026-08-05):** Kalan 5 extra dosya salt-okunur
köken doğrulamasıyla kesin `rename_artifact`/`stale_duplicate` olarak
kanıtlandı; yeni `cleanup-post-sync-target-only-files.ps1` yazıldı,
gerçek makinede yalnız önizlendi (`WouldDeleteCount=5, BlockedCount=0`)
— bkz. §3 B10. Gerçek silme Apply'ı hâlâ çalıştırılmadı. D9'un geri
kalanı (Adım 1-6) hâlâ ayrı, açık bir kullanıcı talebini bekliyor.

**Güncelleme (HB-2026-158, 2026-08-06):** Kullanıcının açık onayıyla
gerçek cleanup `-Apply` çalıştırıldı — **5/5 dosya başarıyla silindi**,
sıfır sürüklenme/blocker. **B10 artık tamamen çözüldü** (17 repair +
5 cleanup = 22/22). Bağımsız doğrulama sırasında, bu araçların hiçbirinin
dokunmadığı 4-5 dosyanın (2 vaka klasöründeki "doğru konum" kopyaları
+ 1 benign metadata_only) gerçek pCloud tarafında eş zamanlı ve
bağımsız olarak silindiği bulundu — kod/kaynak-erişim kanıtıyla bu
araçların sebep olması yapısal olarak imkânsız; muhtemelen operatör
aynı vaka klasörlerinde eş zamanlı gerçek iş yapıyordu. Bu yeni,
B10'dan bağımsız olay için hiçbir aksiyon alınmadı. D9 Adım 0 tek
seferlik yeniden çalıştırıldı: sessizlik TAM TEMİZ geçti (658 sn,
sıfır reset) ama hâlâ `SOURCE_TARGET_HASH_MISMATCH_AT_PASS` ile
BLOCKED — artık B10 değil, muhtemelen bu yeni olayın yansıması. D9
Adım 1'e geçilmedi. D9'un geri kalanı ayrı, açık bir kullanıcı
talebini bekliyor.

**Güncelleme (HB-2026-159/160/161, 2026-08-06):** HB-2026-158'de
bağımsız olarak kaybolan 5 dosya için salt-okunur olay forensics'i +
recovery mapping + kök-neden hipotez testi yapıldı (bkz.
`docs/DECISION_LOG.md`) — kayıp dosyaların cleanup'ın allowlist'inde
hiç olmadığı kanıtlandı; "cleanup, pCloud identity-takibi üzerinden
tetikledi" hipotezi kanıtla çürütüldü (orphan'lar hiçbir zaman
pCloud'un takip ettiği nesneler değildi); dar bir zamanlama-tetikleme
olasılığı açık bırakıldı. Kullanıcının pCloud web Trash kontrolü ve
açık onayı sonrası, 5 dosya cleanup'ın admin-only yedeklerinden
GERÇEKTEN restore edildi — **5/5 başarılı**, C:\=P:\=beklenen
SHA-256, pCloud `found:true`, kuyruk sıfır, bağımsız doğrulandı. D9
gate çalıştırılmadı, D9 Adım 1'e geçilmedi. D9'un geri kalanı hâlâ
ayrı, açık bir kullanıcı talebini bekliyor.

## 11. NİHAİ plan/preview paketi — freshness-gate mimarisi entegre, TAZE doğrulanmış (HB-2026-174, 2026-08-08)

**Kapsam:** Bu bölüm §1-10'u GEÇERSİZ KILMAZ (tarihsel kayıt korunur) —
onun üzerine, HB-2026-162 (per-case reconciliation) ve HB-2026-167..173
(Session-0-safe attestation→freshness-gate mimarisi, gerçek servis-
vehicle probe kanıtı, gerçek attestation store ACL Apply'i) ile GELEN
mimari değişiklikleri de kapsayan, kullanıcının istediği TAM sıralamayla
(build → reference-data → API deploy → env → API servis kurulum/başlatma/
health → admin bootstrap → File Agent env/kök → File Agent enable/start →
service-context freshness smoke → file-operation smoke → nihai
doğrulama/audit) GÜNCEL, TEK bir nihai paket sunar. **Bu bölüm içinde
hiçbir gerçek deploy/env/DB/servis start/enable/cutover Apply'i
ÇALIŞTIRILMADI** — yalnız salt-okunur taze doğrulama + build (yerel,
geri alınabilir, `dist/` çıktısı — servis/env/DB durumu DEĞİŞMEDİ).

### 11.1 Bu bölümde TAZE doğrulanan gerçek durum

| Alan | Taze sonuç (2026-08-08) | Kanıt |
|---|---|---|
| Çalışma ağacı temizliği | **PASS** | `git status --porcelain` — `services/api`, `services/file-agent`, `packages/{contracts,database,domain}` sıfır değişiklik. |
| **B2 — Build tazeliği** | **PASS (KESİN, artık proxy değil)** | `npm run build:packages` GERÇEKTEN çalıştırıldı — domain→contracts→database→desktop-bridge→api→file-agent→desktop sırasıyla, HEPSİ temiz (`tsc -p tsconfig.build.json`, sıfır hata). |
| **B7 — Dependency closure** | **PASS, sürüklenme YOK** | Taze hesaplama: api → `Status:"ok"`, workspace-internal=3, harici=113, 10 platform-uyumsuz optional elendi; file-agent → `Status:"ok"`, workspace-internal=2, harici=20 — HB-2026-146 ile birebir aynı sayılar (kilit dosyası değişmedi). |
| **B1 — API dosya dağıtımı önizlemesi** | **BLOCKED (beklenen, değişmedi)** | Taze `deploy-service-artifacts.ps1` (kapanış-farkındalı) → `Status:"blocked"`, tek blocker: reference-data hedefte yok (B8'e bağımlı, sıralama gereği — araç kendisi sağlam). |
| File Agent dosya dağıtımı önizlemesi | **PASS (would_apply)** | Taze önizleme: 2159 dosya (~157,7 MB, HB-2026-144'teki 2156'dan küçük, beklenen artış — `src/` büyümesi), hedef zaten kurulu ama güncel değil, ön koşullar karşılandı. |
| **B8 — reference-data sağlama önizlemesi** | **PASS (would_apply)** | Taze: 4 dosya (108.525 bayt), kimlik/sürüm doğrulaması `snapshot.json` için GEÇTİ, sıfır blocker — HB-2026-145 ile birebir aynı hash'ler. |
| `install-services.ps1 -Services Api` önizlemesi | **BLOCKED (beklenen)** | Taze: API build çıktısı `C:\HasarBotu\services\api\dist\index.js` hedefte yok (B1 henüz Apply edilmedi) — araç doğru fail-closed reddediyor. |
| `install-services.ps1 -Services FileAgent` önizlemesi | **BLOCKED (beklenen, idempotency)** | Taze: `hasarbotu-file-agent` ZATEN kurulu — bu adım File Agent için gereksiz, yalnız Adım "File Agent enable/start" (mevcut kaydı Automatic yapıp başlatmak) gerekiyor. |
| `hasarbotu-file-agent` servis durumu | **Stopped/Disabled** | `Get-CimInstance Win32_Service` — HB-2026-172/173'ten beri değişmedi. |
| `hasarbotu-api` servis durumu | **Kurulu değil** | Aynı sorgu — boş sonuç. |
| `postgresql-x64-17` servis durumu | **Running/Automatic** | Aynı sorgu. |
| Depolama kökü ACL (`C:\HasarBotuStorage\BARAN GLOBAL EKSPERTİZ`) | **PASS, değişmedi** | Taze `Get-Acl`: Administrators Full, `<makine>\user` (pCloud senkron) Modify, `svc-hb-fileagent` Modify — 3 ACE, başka yok. |
| Attestation store ACL (`C:\ProgramData\HasarBotu\pcloud-attestations`) | **PASS, HB-2026-173 Apply'i hâlâ geçerli** | Taze `Get-Acl`: Administrators Full, `svc-hb-fileagent` Traverse, `svc-hb-fileagent` Read+Synchronize — yazma biti yok. |
| pCloud DB erişim ACL (HB-2026-165) | **PASS, değişmedi** | Taze `Get-Acl` (`%LOCALAPPDATA%\pCloud`): `svc-hb-fileagent` Traverse + Read/Synchronize. |
| **Session-0 freshness gate, gerçek test vakası (bkz. HB-2026-170)** | **PASS — CaseStatus=ready, 40/40** | Taze, salt-okunur çalıştırma: `exit=0`, `CaseStatus="ready"`, `Summary.ReadyCount=40/40`. |
| **B5 — admin kullanıcı sayısı** | **YENİDEN DOĞRULANMADI bu turda** | Bu turda `bootstrap-first-admin.mjs` önizlemesi çalıştırma girişimi araç izin sınıflandırıcısı tarafından REDDEDİLDİ (DB bağlantısı gerektiren komut, iki kez denendi, ikisi de reddedildi) — GERÇEK bir DB sorgusuyla bu turda yeniden kanıtlanamadı. **Son bilinen, bağımsız doğrulanmış durum (HB-2026-147, 2026-08-04): `organizations=0`, `users=0`, `AdminRoleSeeded=true`, `Status:"ready"`.** Gerçek Apply'dan hemen önce bu, tekrar taze çalıştırılıp doğrulanmalı (aşağıdaki Adım 6'da zaten planlı — ayrıca ayrı bir engel değil, zaten sıralamanın kendisi bunu gerektiriyor). |
| Statik denetim (`npm run check:deploy` kapsamındaki her araç) | **PASS** | Önceki turda (HB-2026-172/173) tam çalıştırıldı, bu turda kod değişikliği olmadığından yeniden gerekmedi — §11.6 sonunda yine de tam suite çalıştırılacak. |

### 11.2 File Agent ortam değişkenleri — TAM liste, gerçek ad/değer/kapsam (kaynak: `services/file-agent/src/config.ts`, kod okumasıyla doğrulandı)

**Her zaman ZORUNLU (4):**

| Değişken | Gerçek değer | Not |
|---|---|---|
| `HASARBOTU_AGENT_ROOTS` | `{"baran-global-primary":"C:\\HasarBotuStorage\\BARAN GLOBAL EKSPERTİZ"}` | JSON, `roots` map'i — rootKey ASLA değişmez (mevcut karar). |
| `HASARBOTU_API_BASE_URL` | `http://127.0.0.1:3100` | API'nin varsayılan `HOST`/`PORT`'uyla (`services/api/src/config.ts`) birebir eşleşir. |
| `HASARBOTU_AGENT_ID` | **HENÜZ YOK** | Adım 6'da (admin bootstrap sonrası) `POST /api/v1/agents` ile ÜRETİLİR. |
| `HASARBOTU_AGENT_SECRET` | **HENÜZ YOK** | Aynı çağrıdan, YALNIZ BİR KEZ döner — güvenli saklanmalı. |

**Opsiyonel (varsayılan var, kod okumasıyla doğrulandı):**

| Değişken | Varsayılan |
|---|---|
| `HASARBOTU_AGENT_LEASE_SECONDS` | `120` |
| `HASARBOTU_AGENT_POLL_MS` | `5000` |

**Freshness-gate grubu — HEPSİ BİRDEN VEYA HİÇBİRİ (kısmi verilirse servis başlangıçta `AgentConfigError` ile ÇÖKER, kritik iş denenmeden yakalanır):**

| Değişken | Gerçek değer | Karar/not |
|---|---|---|
| `HASARBOTU_AGENT_FRESHNESS_GATE_TOOL_PATH` | `C:\...\HasarBotuV2\deploy\windows-service\pcloud-session0-freshness-gate.mjs` (repo checkout kökü — bu belgenin geri kalanındaki `C:\...\HasarBotuV2\...` gösterimiyle aynı) | **Karar (bu bölümde verildi, aşağıda gerekçeli):** repo checkout yolu doğrudan kullanılıyor — bkz. §11.2.1. |
| `HASARBOTU_AGENT_PCLOUD_DB_PATH` | `%LOCALAPPDATA%\pCloud\data.db` (gerçek profil yoluyla) | HB-2026-165/172/173'te kullanılan aynı yol. |
| `HASARBOTU_AGENT_PCLOUD_TOP_LEVEL_FOLDER` | `BARAN GLOBAL EKSPERTİZ` | Değişmedi. |
| `HASARBOTU_AGENT_ATTESTATION_STORE` | `C:\ProgramData\HasarBotu\pcloud-attestations` | HB-2026-173'te ACL Apply edildi, taze doğrulandı (§11.1). |

#### 11.2.1 Karar: `HASARBOTU_AGENT_FRESHNESS_GATE_TOOL_PATH` — repo yolu mu, ayrı dağıtım mı?

`freshness-gate-client.ts`, `toolPath`'i `node.exe <toolPath> --args...` ile
doğrudan spawn eder (import değil). Gerçek dosya zinciri tam olarak 4
`.mjs` dosyasıdır (`pcloud-session0-freshness-gate.mjs` +
`pcloud-maintenance-window-gate.mjs` + `pcloud-post-sync-diff-
forensics.mjs` + `pcloud-source-attestation.mjs`, kod okumasıyla
doğrulandı) — hepsi `deploy/windows-service/` İÇİNDE aynı dizinde, hiçbir
`../` importu yok, hiçbir npm bağımlılığı yok (yalnız `node:*` builtin'ler,
`node:sqlite` dahil — Node 24.16.0'da mevcut, doğrulandı). Bu dosyalar
`deploy-service-artifacts.ps1`nin File Agent allowlist'inde (yalnız
`dist/`+`package.json`+bağımlılık kapanışı) YOKTUR.

İki seçenek:
- **(A, ÖNERİLEN VE BU PLANDA VARSAYILAN) Repo checkout yolunu doğrudan
  kullan.** Gerekçe: bu makine zaten hem geliştirme hem üretim/dağıtım
  makinesidir (HB-2026-115'te düzeltilmiş karar); bu turun TÜM gerçek
  freshness-gate çalıştırmaları (HB-2026-170/172/173, bu bölümün §11.1'i
  dahil) ZATEN bu repo yolunu kullandı ve kanıtlandı; sıfır yeni kod/test/
  deploy adımı gerektirir; harici bağımlılığı olmadığından (yalnız
  `node:*`) sürüm sürüklenme riski yalnız repo'nun KENDİ commit
  geçmişine bağlıdır (zaten disiplinli test+audit ile korunuyor).
  Dezavantaj: servis çalışma zamanı, dev repo checkout'unun o yolda
  kalıcı olarak var olmasına bağımlı hâle gelir (bu makinede bu her
  zaman doğru olmuştur, ayrı bir dağıtım hedefi YOKTUR).
- **(B, gelecekteki sertleştirme) `deploy-service-artifacts.ps1`nin
  allowlist'ini bu 4 dosyayı da (örn. `C:\HasarBotu\services\file-
  agent\pcloud-tools\`e) kopyalayacak şekilde genişlet.** Temiz ayrım
  ama yeni kod+test+statik-denetim gerektirir — bu turun kapsamı
  DIŞINDA bırakıldı.

**Bu seçim kullanıcının aşağıdaki §11.9 tek onay noktasında
değiştirilebilir** — (B) istenirse gerçek Apply öncesi ayrı, küçük bir
paket olarak yürütülmeli.

### 11.3 API ortam değişkenleri — TAM liste (kaynak: `services/api/src/config.ts`, kod okumasıyla doğrulandı)

| Değişken | Zorunluluk | Gerçek değer |
|---|---|---|
| `NODE_ENV` | Opsiyonel, varsayılan `development` — **production'da `production` OLMALI** | `production` |
| `DATABASE_URL` | **`NODE_ENV=production` iken ZORUNLU** (`parseDatabaseUrl` ile biçim doğrulanır, geçersizse sunucu BAŞLAMAZ) | `postgres://hasarbotu_app:<pass dosyasından>@127.0.0.1:5432/hasarbotu` |
| `HOST` | Opsiyonel, varsayılan `127.0.0.1` | varsayılan yeterli |
| `PORT` | Opsiyonel, varsayılan `3100` | varsayılan yeterli |
| `LOG_LEVEL` | Opsiyonel, varsayılan `info` | varsayılan yeterli |
| `OPENAI_*` / `GEMINI_*` / `LABOR_ALLOCATION_ALLOW_DETERMINISTIC_PROVIDERS` | **Tamamı opsiyonel, opt-in** | **Bu cutover'da HİÇBİRİ verilmiyor** — AI sağlayıcıları devre dışı kalır (ayrı, açık bir gelecek karardır; File Agent/API temel çalışması için ZORUNLU DEĞİL). `LABOR_ALLOCATION_ALLOW_DETERMINISTIC_PROVIDERS=true`, `NODE_ENV=production` iken kod SEVİYESİNDE reddedilir (`ConfigError`) — zaten yanlışlıkla açılamaz. |

`/health` yalnız süreç canlılığını DEĞİL, GERÇEK DB bağlantısını da
yansıtır: `server.ts` `databaseUrl` tanımlıysa gerçek bir `Pool` kurar ve
`healthDependencyCheck`'i gerçek `checkDatabaseHealth(pool)`'a bağlar
(kod okumasıyla doğrulandı) — Adım 4'teki `/health` kontrolü bu yüzden
API↔DB bağlantısının GERÇEK bir kanıtıdır, yalnız süreç varlığının değil.

### 11.4 API→File Agent bağlantı sözleşmesi (kod okumasıyla doğrulandı, route sabitleri `@hasarbotu/contracts`ten)

| Uç nokta | Yol | Kullanım |
|---|---|---|
| Health | `GET /health` | Adım 4/9 doğrulaması — `status:"ok"`, DB dahil. |
| Agent kaydı | `POST /api/v1/agents` (admin oturumu gerekir) | Adım 6 — `agentId`+`secret` üretir, BİR KEZ döner. |
| Agent listesi | `GET /api/v1/agents` | Doğrulama — kayıtlı agent'ı teyit için. |
| İş talep etme | `POST /api/v1/agent/jobs/claim` | File Agent'ın kendi poll döngüsü (agent kimlik bilgisiyle). |
| İş heartbeat | `POST /api/v1/agent/jobs/:jobId/heartbeat` | Aynı. |
| İş sonucu | `POST /api/v1/agent/jobs/:jobId/result` | Aynı. |

File Agent, `HASARBOTU_AGENT_ID`/`_SECRET` ile `createAgentApiClient`
(`services/file-agent/src/api-client.ts`) üzerinden bu uç noktalara
bağlanır — kod okumasıyla doğrulandı, sürüklenme yok.

### 11.5 NİHAİ fail-closed aktivasyon sırası (kullanıcının istediği TAM sıra)

Model: Planla → Önizle → Onay → Uygula → Doğrula → Kesinleştir → Audit
(AGENTS.md §7). **Her adım bir öncekinin PASS'ine sıkı sıkıya bağlıdır —
herhangi bir adım BLOCKED/FAIL verirse sonraki adıma GEÇİLMEZ, mevcut
haldeyken durulur ve rapor edilir.**

**Adım 1 — Build**
```powershell
npm run build:packages
```
PASS kriteri: sıfır hata. (Bu turda ÇALIŞTIRILDI, PASS — §11.1.)

**Adım 2 — Reference-data sağlama (API dosyalarından ÖNCE, zorunlu sıra)**
```powershell
.\deploy\windows-service\provision-extra-data-references.ps1 `
  -RepoRoot 'C:\...\HasarBotuV2' `
  -DependencyClosureManifestPath '<api-closure.json>' `
  -ServiceTargetDir 'C:\HasarBotu\services\api' `
  -DataLabel 'value-loss-reference-data' `
  -Apply
```
PASS kriteri: `Status:"applied"`, kimlik doğrulaması geçti, hedefte 4
dosya. Rollback: `-Rollback` (aynı araç, sentetik testte kanıtlı).

**Adım 3 — API deploy**
```powershell
.\deploy\windows-service\deploy-service-artifacts.ps1 `
  -SourceDir 'C:\...\HasarBotuV2\services\api' -TargetDir 'C:\HasarBotu\services\api' `
  -ServiceLabel 'api' -DependencyClosureManifestPath '<api-closure.json>' `
  -RepoRoot 'C:\...\HasarBotuV2' -Apply
node .\deploy\windows-service\smoke-test-deployed-service.mjs 'C:\HasarBotu\services\api'
```
PASS kriteri: `Status:"applied"` + smoke-test `status:"ok"` (tüm modül
grafiği, native eklentiler dahil, hedefin KENDİ `node_modules`'ından
çözüldü). Rollback: `-Rollback` (zaman damgalı Administrators-only yedek,
sentetik testte kanıtlı).

**Adım 4 — Env (Machine kapsamı, sıra önemli değil ama hepsi bu adımda)**
```powershell
$pw = Get-Content "$env:USERPROFILE\.hasarbotu\hasarbotu_app.pass" -Raw
[Environment]::SetEnvironmentVariable('DATABASE_URL', "postgres://hasarbotu_app:$($pw.Trim())@127.0.0.1:5432/hasarbotu", 'Machine')
[Environment]::SetEnvironmentVariable('NODE_ENV', 'production', 'Machine')
[Environment]::SetEnvironmentVariable('HASARBOTU_API_BASE_URL', 'http://127.0.0.1:3100', 'Machine')
```
PASS kriteri: üçü de `[Environment]::GetEnvironmentVariable(...,'Machine')`
ile (değer YAZDIRILMADAN, yalnız `-ne $null` kontrolüyle) doğrulanır.
Rollback: `[Environment]::SetEnvironmentVariable('<ad>', $null, 'Machine')`.

**Adım 5 — API servis kurulum/başlatma/health**
```powershell
.\deploy\windows-service\install-services.ps1 -ApiDir 'C:\HasarBotu\services\api' `
  -FileAgentDir 'C:\HasarBotu\services\file-agent' -WinSwExe 'C:\Tools\WinSW-x64.exe' -Services @('Api')
# önce -Apply OLMADAN gözden geçir, sonra:
.\deploy\windows-service\install-services.ps1 ... -Services @('Api') -Apply
Start-Service hasarbotu-api
Start-Sleep -Seconds 3
Invoke-RestMethod http://127.0.0.1:3100/health
```
PASS kriteri: servis `Running`, `/health` → `{"status":"ok",...}` (DB
bağlantısı dahil, §11.3). Rollback: `Stop-Service hasarbotu-api`;
kurulumu tamamen geri almak için `hasarbotu-api.exe uninstall` (WinSW).

**Adım 6 — Admin bootstrap**
```powershell
node .\deploy\windows-service\bootstrap-first-admin.mjs           # önizleme (DATABASE_URL env'de olmalı)
node .\deploy\windows-service\bootstrap-first-admin.mjs --apply   # interaktif, parola ekransız
```
PASS kriteri: `Status:"created"` (veya eşdeğeri), tek transaction, audit
kaydı. Yalnız `organizations=0 VE users=0` iken çalışır — tekrar
çalıştırma fail-closed reddedilir (ikinci bir admin GEREKMEZ zaten).
Rollback: mekanizma yok (idempotent tek-kullanımlık) — YANLIŞ girilirse
DB'den elle silinip yeniden çalıştırılması ayrı bir karardır.

**Adım 6b — Agent kaydı (elle, admin oturumuyla — otomatikleştirilmez, B6 ile aynı sınıf)**
```
POST /api/v1/agents  { "name": "file-agent-baran-global" }
-> { agent: { id, ... }, secret: "..." }   # BİR KEZ döner, güvenli saklanmalı
```

**Adım 7 — File Agent env + kök**
```powershell
[Environment]::SetEnvironmentVariable('HASARBOTU_AGENT_ID', '<agent.id>', 'Machine')
[Environment]::SetEnvironmentVariable('HASARBOTU_AGENT_SECRET', '<secret>', 'Machine')
[Environment]::SetEnvironmentVariable('HASARBOTU_AGENT_ROOTS', '{"baran-global-primary":"C:\\HasarBotuStorage\\BARAN GLOBAL EKSPERTİZ"}', 'Machine')
[Environment]::SetEnvironmentVariable('HASARBOTU_AGENT_FRESHNESS_GATE_TOOL_PATH', 'C:\...\HasarBotuV2\deploy\windows-service\pcloud-session0-freshness-gate.mjs', 'Machine')
[Environment]::SetEnvironmentVariable('HASARBOTU_AGENT_PCLOUD_DB_PATH', "$env:LOCALAPPDATA\pCloud\data.db", 'Machine')
[Environment]::SetEnvironmentVariable('HASARBOTU_AGENT_PCLOUD_TOP_LEVEL_FOLDER', 'BARAN GLOBAL EKSPERTİZ', 'Machine')
[Environment]::SetEnvironmentVariable('HASARBOTU_AGENT_ATTESTATION_STORE', 'C:\ProgramData\HasarBotu\pcloud-attestations', 'Machine')
```
PASS kriteri: 7 değişkenin hepsi Machine kapsamında tanımlı (değer
YAZDIRILMADAN). Rollback: her biri `$null` ile silinir (§11.6).

**Adım 8 — File Agent enable/start**
```powershell
Set-Service hasarbotu-file-agent -StartupType Automatic
Start-Service hasarbotu-file-agent
Start-Sleep -Seconds 5
Get-Content 'C:\HasarBotu\services\file-agent\logs\hasarbotu-file-agent.out.log' -Tail 30
```
PASS kriteri: servis `Running`, log'da `AgentConfigError` YOK (freshness-
gate grubu TAM 4/4 verilmişse config başarıyla yüklenir), `storage_
unavailable` YOK. Rollback: `Stop-Service hasarbotu-file-agent; Set-
Service hasarbotu-file-agent -StartupType Disabled` — HB-2026-168'in
vehicle-probe aracıyla ÇOK KEZ (5/5) kanıtlanmış aynı durdurma mekanizması.

**Adım 9 — Service-context freshness smoke**
Bu adımın GÜVENLİK-KRİTİK mekanizması (gerçek `svc-hb-fileagent`
kimliğiyle, gerçek env değerleriyle DB okuma/yazma-red/attestation
zinciri) HB-2026-172/173'te vehicle-probe aracıyla ZATEN 5 kez gerçek
makinede kanıtlandı (`RestoredExactly=true` 5/5, `CaseStatus=ready`
son çalıştırmada) — bu adım o kanıtı TEKRARLAMAZ (vehicle-probe artık
kullanılamaz: araç Running bir servise dokunmayı yapısal olarak
reddeder). Bunun yerine, GERÇEK servis şimdi Adım 8'de başladığı için:
```powershell
Get-Content 'C:\HasarBotu\services\file-agent\logs\hasarbotu-file-agent.out.log' -Tail 50 | Select-String 'freshness|AgentConfigError|case_not_fresh'
```
PASS kriteri: config yükleme hatası yok (servis zaten Running ise bu
zaten kanıtlanmış demektir — `AgentConfigError` servis başlangıcında
fırlar ve servis Running durumuna hiç geçmez). Henüz gerçek bir vaka
işi kuyrukta olmadığından (DB'de vaka verisi yok, B5/Adım 6 az önce
tamamlandı) freshness gate'in KENDİSİ ilk gerçek `workspace`/
`file_operation` işine kadar tetiklenmez — bu NORMAL, eksik değil.

**Adım 10 — File-operation smoke (elle, gerçek ama zararsız bir iş)**
İlk gerçek vaka File Agent'a atandığında (ayrı, kapsam dışı bir ürün
adımı — UI'dan/API'den gerçek bir dosya kaydı oluşturma), aşağıdakiler
File Agent log'unda GERÇEK olarak gözlemlenmelidir:
1. Freshness gate çağrıldı (`checkCaseFreshness` log satırı/iş
   sonucu).
2. `CaseStatus` doğru rapor edildi (`ready` ise iş devam etti, değilse
   `case_not_fresh` ile REDDEDİLDİ — sessizce atlanmadı).
3. Gerçek işlem (workspace/file_operation) yalnız `ready` iken
   çalıştı.
Bu adım İLK GERÇEK vaka atamasıyla doğal olarak gerçekleşir — bu plan
paketi kapsamında SENTETİK/sahte bir vaka oluşturularak ZORLANMAZ
(gerçek olmayan DB satırı yaratmak, müşteri verisi yaratma disiplinini
bozar).

**Adım 11 — Nihai doğrulama + audit**
- `Get-Service hasarbotu-api, hasarbotu-file-agent` → ikisi de `Running`.
- `Invoke-RestMethod http://127.0.0.1:3100/health` → `status:"ok"`.
- 7 File Agent + 3 API env değişkeni Machine kapsamında (değer
  yazdırılmadan) doğrulanır.
- `npm run check:deploy` (statik denetim, tüm windows-service araçları)
  yeniden çalıştırılır.
- Deployment audit kaydı (RUNBOOK §6 formatı) `docs/DECISION_LOG.md`e
  yazılır.
- `P:\BARAN GLOBAL EKSPERTİZ` en az 14 gün silinmeden tutulur (mevcut
  karar).

### 11.6 Rollback sırası (Adım 11'den 1'e, TERS sıra)

```powershell
# 1) File Agent durdur (Adım 8'in tersi)
Stop-Service hasarbotu-file-agent -ErrorAction SilentlyContinue
Set-Service hasarbotu-file-agent -StartupType Disabled

# 2) File Agent env'i sil (Adım 7'nin tersi)
foreach ($name in @('HASARBOTU_AGENT_ID','HASARBOTU_AGENT_SECRET','HASARBOTU_AGENT_ROOTS','HASARBOTU_AGENT_FRESHNESS_GATE_TOOL_PATH','HASARBOTU_AGENT_PCLOUD_DB_PATH','HASARBOTU_AGENT_PCLOUD_TOP_LEVEL_FOLDER','HASARBOTU_AGENT_ATTESTATION_STORE')) {
  [Environment]::SetEnvironmentVariable($name, $null, 'Machine')
}

# 3) Agent kaydını iptal et (Adım 6b'nin tersi) -- ayrı, admin oturumuyla elle.
#    Uç nokta HB-2026-176/177'de kaynak+testle DOĞRULANDI (artık "varsa"
#    değil, gerçek ve çalışır durumda): PATCH /api/v1/agents/:agentId
#    {status:'disabled'} (bkz. services/api/src/agent/auth.ts, agent.status
#    !== 'active' -> 403). register-file-agent-interactive.ps1'in kendi
#    orphan-önleme yolu bu çağrıyı zaten yapar; gerçek AgentId için admin
#    oturumuyla aynı çağrı elle tekrarlanabilir.

# 4) Admin bootstrap GERİ ALINMAZ (Adım 6) -- idempotent tek-kullanımlıktır,
#    yanlışsa DB'den elle silinip yeniden calıştırılması ayrı bir karardır

# 5) API durdur + env sil (Adım 5/4'ün tersi)
Stop-Service hasarbotu-api -ErrorAction SilentlyContinue
foreach ($name in @('DATABASE_URL','NODE_ENV','HASARBOTU_API_BASE_URL')) {
  [Environment]::SetEnvironmentVariable($name, $null, 'Machine')
}
# Kurulumu tamamen kaldırmak icin (opsiyonel, ayrı karar):
#   C:\HasarBotu\services\api\hasarbotu-api.exe uninstall

# 6) API deploy geri al (Adım 3'ün tersi) -- GERÇEK parametre sözleşmesi
#    (deploy-service-artifacts.ps1'de -ApplyEvidenceReportPath/-Sha256 YOK;
#    -TargetDir ZORUNLU, yedek bütünlüğü -RollbackBackupPath'teki
#    .manifest.json sidecar'ından OTOMATİK doğrulanır, ayrı hash verilmez):
.\deploy\windows-service\deploy-service-artifacts.ps1 -TargetDir 'C:\HasarBotu\services\api' -ServiceLabel 'api' `
  -Rollback -RollbackBackupPath '<C:\ProgramData\HasarBotu\migration-preflight\pre-deploy-backups\ altındaki GERÇEK api-* yedek dizini>' -Apply

# 7) Reference-data geri al (Adım 2'nin tersi) -- GERÇEK parametre sözleşmesi.
#    -DataLabel HER ZAMAN zorunlu. -ServiceTargetDir bu modda Adım 6'daki
#    servis dağıtım kökü DEĞİL: provision modunda "Hedef dizin" olarak
#    yazdırılan GERÇEK çözümlenmiş veri dizinidir (bugün
#    C:\HasarBotu\reference-data\value-loss\real-market-analysis\2026-07-01\1.0.0) --
#    yanlışlıkla 'C:\HasarBotu\services\api' verilirse API dağıtımının
#    ÜZERİNE yazar (kendi güvenli yedeğini alsa da). RepoRoot/
#    DependencyClosureManifestPath olmadan bu betik o yolu KENDİSİ
#    türetemez; script içindeki .EXAMPLE bloğu da bu parametreyi hiç
#    göstermez (verilmezse SERVICE_TARGET_DIR_REQUIRED_FOR_ROLLBACK_TARGET_UNKNOWN
#    ile fail-closed reddeder).
.\deploy\windows-service\provision-extra-data-references.ps1 -DataLabel 'value-loss-reference-data' `
  -ServiceTargetDir 'C:\HasarBotu\reference-data\value-loss\real-market-analysis\2026-07-01\1.0.0' `
  -Rollback -RollbackBackupPath '<pre-deploy-backups altındaki GERÇEK value-loss-reference-data-* yedek dizini>' -Apply
```
Her adımın kendi rollback mekanizması AYRI ayrı, sentetik testlerle
kanıtlanmıştır (HB-2026-143/145 deploy/provision araçları; HB-2026-168
vehicle-probe zaten 5/5 gerçek restore kanıtladı). Attestation store ve
pCloud DB ACL'leri (HB-2026-165/173) bu cutover'ın parçası DEĞİLDİR —
kendi `-Rollback` modlarıyla ayrı yönetilir, bu sıraya dahil değildir
(zaten uygulanmış, kalıcı altyapı).

### 11.7 Açık bloker'lar / eksik gerçek değerler / kullanıcı kararı gereken noktalar

| # | Konu | Durum |
|---|---|---|
| 1 | `HASARBOTU_AGENT_ID`/`_SECRET` gerçek değerleri | **YOK** — yalnız Adım 6b'de (admin oturumu) üretilir, ÖNCEDEN bilinemez. |
| 2 | B5/admin sayısı taze DB doğrulaması | Bu turda araç izin sınıflandırıcısı tarafından ENGELLENDİ — son bilinen durum (HB-2026-147: 0 org/0 kullanıcı, hazır) güvenilir ama TAZE değil; Adım 6'nın kendi önizlemesi zaten taze kontrol yapacak. |
| 3 | `HASARBOTU_AGENT_FRESHNESS_GATE_TOOL_PATH` konumu | **Karar bu bölümde verildi** (§11.2.1, seçenek A) — kullanıcı isterse §11.9'da değiştirebilir. |
| 4 | Gerçek `-Apply` zamanlaması | Önceki karar geçerli (§8.4): ofis sakinken, planlı pencerede. |
| 5 | AI sağlayıcıları (OPENAI_*/GEMINI_*) | Bu cutover'a DAHİL DEĞİL — ayrı, açık gelecek karar. |

### 11.8 Bu bölümde YAPILMAYANLAR (kesin liste)

- Hiçbir env değişkeni (Machine/User/Process) yazılmadı/değiştirilmedi.
- Hiçbir Windows servisi kurulmadı/başlatılmadı/durdurulmadı/enable
  edilmedi.
- Hiçbir dosya `C:\HasarBotu\...`e kopyalanmadı (yalnız repo içi
  `dist/` yeniden üretildi — bu commit edilmez, kaynak kod değildir).
- pCloud ayarı, sync eşlemesi, DB içeriği hiç değişmedi.
- Admin bootstrap `--apply` ÇALIŞTIRILMADI.
- Agent kaydı yapılmadı (`HASARBOTU_AGENT_ID`/`_SECRET` üretilmedi).

### 11.9 TEK son onay noktası

Bu paket §11.5'teki 11 adımı, her biri kendi PASS kriteriyle, TAM
sırayla ve rollback'i hazır şekilde tanımlar. **Gerçek Apply'a
başlamak için kullanıcının vermesi gereken TEK onay:**

> "D9 gerçek aktivasyonuna §11.5'teki 11 adımın TAMAMI için, sırayla,
> her adım PASS vermeden bir sonrakine geçilmeksizin, onay veriyorum."

Bu onay verilmeden bu paketten hiçbir gerçek env/deploy/DB/servis
mutasyonu başlatılmaz. §11.2.1'deki TOOL_PATH kararı (seçenek A) bu
onayla birlikte zımnen kabul edilmiş sayılır; kullanıcı seçenek B'yi
istiyorsa onay yerine bunu belirtmelidir.
