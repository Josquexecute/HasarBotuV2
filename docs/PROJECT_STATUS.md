# HasarBotu V2 — Proje Durumu

Son güncelleme: 2026-08-04

## Mevcut sürüm ve aşama

- Sürüm: `0.1.0-ui-baseline`
- Aşama: Dosya Envanteri — Migration 0042 paketi uçtan uca tamamlandı
- Durum: **Case inventory export domain çekirdeği (2026-07-21, yalnız domain) artık persistence + API + UI ile tam. Migration 0042 (0041↔0043 arasındaki boşluk) `case_vehicle_owners`/`case_vehicle_owner_sets` ekler. `npm test` 2.101 başarılı / 6 ortam-koşullu skip.**

## D8 pCloud → NTFS migration — doğrulama zinciri (gate→PostSyncRebaseline→AfterSync) İLK KEZ baştan sona PASS (2026-08-03, HB-2026-139)

- **GÜNCEL DURUM: `AFTERSYNC_PASS / CUTOVER_NOT_STARTED`.** HB-2026-129'dan
  beri süren post-sync rebaseline BLOCKED durumu, HB-2026-133'teki tek
  dosya onarımı ve ardından art arda denemelerle (HB-2026-134–138) sonunda
  HB-2026-139'da çözüldü: `gate` → `PostSyncRebaseline` → `AfterSync`
  zincirinin **üçü de PASS/0** verdi. 6873 dosya, 673 klasör, kaynak
  (P:) ve hedef (`C:\HasarBotuStorage`) arasında tam SHA-256 eşitliği
  kanıtlandı. Kanıtlar Administrators-only
  `C:\ProgramData\HasarBotu\migration-preflight` altında (gate + PostSync-
  Rebaseline stage + AfterSync stage raporları, hepsi hash'li).
  **ÖNEMLİ SINIR: `AfterSync` tamamen salt-okunur bir doğrulamadır —
  gerçek operasyonel devretme (env/servis/File Agent kök dizini
  değişikliği) AYRI, henüz YAPILMAMIŞ bir adımdır** (kullanıcının açık
  talebi + AGENTS.md #7 kritik işlem onayı gerekir).
- Ayrıntı için `HB-2026-139` (karar günlüğü) — aşağıdaki geçmiş kayıtlar
  bu noktaya nasıl gelindiğini belgeler.
- **D9 gerçek operasyonel devretme — YALNIZ plan + fail-closed önizleme
  hazır (HB-2026-140, 2026-08-04):**
  [`docs/D9_OPERATIONAL_CUTOVER_PLAN.md`](D9_OPERATIONAL_CUTOVER_PLAN.md).
  Bu pakette hiçbir env/servis/dosya/pCloud ayarı DEĞİŞMEDİ. Gerçek
  makine durumu salt-okunur doğrulandı: `hasarbotu-file-agent` servisi
  zaten kurulu (D6, `Disabled`/`Stopped`), hesap/ACL doğru;
  `hasarbotu-api` servisi hiç kurulu değil, deploy dizini yok;
  `HASARBOTU_*`/`DATABASE_URL` ortam değişkenlerinin hiçbiri tanımlı
  değil. Kullanıcı dört açık soruyu (§8, HB-2026-141) onaylanan
  seçeneklerle cevapladı.
- **D9'un ilk küçük paketi tamamlandı (B3 çözüldü, HB-2026-142,
  2026-08-04):** `install-services.ps1`e `-Services Api`/`FileAgent`
  seçici + idempotency guard'ı eklendi (File Agent'a hiç dokunmadan
  yalnız API kurulabiliyor artık; zaten kurulu bir servis `-Apply`
  olmadan bile fail-closed reddediliyor). 8 regresyon testi + statik
  denetim eklendi, `npm test`/`check:deploy` geçti. Gerçek makinede
  yalnız salt-okunur önizleme çalıştırıldı — hiçbir env/servis/deploy
  dosyası değişmedi.
- **D9'un ikinci küçük paketi tamamlandı (B1 çözüldü, HB-2026-143,
  2026-08-04):** `deploy-service-artifacts.ps1` eklendi — servis
  KURMAZ/env YAZMAZ/servis BAŞLATMAZ, yalnız bir servisin build
  çıktısını (`dist/`+`package.json`, yapısal allowlist) fail-closed,
  idempotent, atomik, geri alınabilir şekilde deploy dizinine hazırlar.
  12 regresyon testi + statik denetim eklendi. Gerçek makinede yalnız
  önizleme çalıştırıldı (`services/api` → `C:\HasarBotu\services\api`:
  436 dosya, ~1,56 MB, `would_apply`) — hiçbir dosya değişmedi.
  **Yeni gerçek blocker bulundu (B7):** deploy edilen içerik npm
  workspace'in kök `node_modules`'ındaki çalışma zamanı bağımlılıklarını
  taşımıyor — bu, zaten gerçek kurulu File Agent dağıtımında da var
  (orada da `node_modules` yok); hiçbir servis şu an deploy dizininden
  gerçekten başlatılamaz. Ayrı bir karar/paket gerektiriyor.
- **D9'un üçüncü küçük paketi tamamlandı (B7 çözüldü, HB-2026-144,
  2026-08-04):** `resolve-runtime-dependency-closure.mjs` eklendi —
  `package-lock.json`dan (canlı `node_modules` introspeksiyonu DEĞİL)
  Node'un kendi modül çözümlemesiyle birebir eşleşen, deterministik bir
  çalışma zamanı bağımlılık kapanışı hesaplar (workspace-internal +
  harici paketler + platform-uyumsuz optional native modül filtrelemesi).
  `deploy-service-artifacts.ps1` opsiyonel `-DependencyClosureManifestPath`/
  `-RepoRoot` ile kapanış-farkındalı hâle getirildi (verilmezse davranış
  HB-2026-143 ile birebir aynı). 27 regresyon testi + 16 birim testi + 4
  smoke testi + statik denetim eklendi. **Gerçek makinede kanıtlandı:**
  API (3 workspace-internal + 113 harici) ve File Agent (2+20) kapanışları
  hesaplandı; gerçek `C:\HasarBotu\...` hedeflerine karşı salt-okunur
  önizleme çalıştırıldı (dosya değişmedi); izole, repo-dışı bir
  smoke-test dizininde her iki servis GERÇEK `-Apply` ile dağıtılıp repo
  köküne/`NODE_PATH`'e erişimi olmayan ayrı bir Node sürecinden
  `dist/index.js` başarıyla import edilip argon2/`@napi-rs/canvas`/
  tesseract.js dahil tüm native modül grafiği çözüldü (giriş-noktası
  koruması sayesinde gerçek servis kodu hiç başlatılmadı); test dizini
  silindi. **Yeni gerçek blocker bulundu (B8):** API'nin bir modülü
  (`traffic-value-loss/rule-source.ts`) kilit dosyasında hiç görünmeyen
  bir referans-veri dosyasını repo köküne göre sabit kodlanmış göreli
  yolla okuyor — deploy betiği bunu artık statik olarak tespit edip
  `-Apply`'ı net bir mesajla fail-closed reddediyor (otomatik kopyalamıyor,
  hedef tek bir `-TargetDir`in dışına çıkabiliyor). File Agent bu
  sorundan etkilenmiyor.
- **D9'un dördüncü küçük paketi tamamlandı (B8 aracı, HB-2026-145,
  2026-08-04):** `provision-extra-data-references.ps1` + `verify-value-
  loss-reference-data-identity.mjs` eklendi. `ExtraDataReferences`i
  (kilit dosyasında görünmeyen referans-veri dosyaları) `deploy-service-
  artifacts.ps1` ile birebir aynı hesaplamayla türetilen gerçek hedefe
  kaynak allowlist + canonical SHA-256 manifest + uygulamanın kendi
  kanonik JSON hash algoritmasıyla kimlik/sürüm doğrulaması (`packages/
  domain`nin `REAL_MARKET_VALUE_LOSS_SNAPSHOT_SHA256` sabitine karşı) +
  TOCTOU (eksik/fazla/değişmiş) fail-closed koruması + atomik
  değiştirme + admin-only yedek + idempotency + rollback ile sağlar. 24
  test + statik denetim eklendi (kimlik dogrulama testi GERÇEK diskteki
  snapshot'a ve domain paketinin GERÇEK sabitine pinlenmiş). **Gerçek
  makinede kanıtlandı:** hesaplanan hedef `C:\HasarBotu\reference-data\
  value-loss\real-market-analysis\2026-07-01\1.0.0\`, 4 dosya (108.525
  bayt), kimlik doğrulaması GEÇTİ, `would_apply`, sıfır blocker — gerçek
  `-Apply` bu pakette çalıştırılmadı, `C:\HasarBotu\reference-data\`
  hâlâ yok.
- **D9 gerçek cutover öncesi son salt-okunur hazırlık denetimi
  (HB-2026-146, 2026-08-04):** tek PASS/BLOCKED tablosunda konsolide
  edildi (`D9_OPERATIONAL_CUTOVER_PLAN.md` §9). **İki gerçek bulgu:**
  (1) Adım 1 (API dosyaları) → Adım 1b (reference-data) sırası GERÇEKTE
  TERSİNE çalışmıyor — taze önizleme, `deploy-service-artifacts.ps1`nin
  KENDİ `ExtraDataReferences` ön koşulunun reference-data hedefte
  olmadan API dosyalarını fail-closed reddettiğini kanıtladı; doğru sıra
  (kapanış hesapla → reference-data → API dosyaları) §4'e işlendi. (2)
  **Yeni blocker B9:** gerçek, salt-okunur DB sorgusu `organizations`=0,
  `users`=0 (dolayısıyla 0 admin) buldu — repo'da ilk kullanıcıyı
  oluşturacak hiçbir HTTP/CLI/seed mekanizması yok (kod taramasıyla
  doğrulandı), bu B4/B5'in kök nedeni. Servis hesabı/ACL/env/DB
  bağlantısı/rollback mekanizması/smoke-test önkoşulları hepsi PASS,
  sürüklenme yok. Hiçbir build/deploy/reference-data/env/servis
  değişikliği YAPILMADI.
- **D9'un beşinci küçük paketi tamamlandı (B9 aracı, HB-2026-147,
  2026-08-04):** `bootstrap-first-admin.mjs` eklendi — ilk organizasyon +
  admin kullanıcısını uygulama anında elle girilen bilgilerle oluşturan
  tek-kullanımlık, fail-closed CLI. Yalnız `organizations=0` VE
  `users=0` iken çalışır (transaction içinde TAZE TOCTOU yeniden
  kontrolü — gerçek yarış testiyle kanıtlandı). Gerçek argon2id hash
  (`@hasarbotu/api` `hashPassword`) ve gerçek `@hasarbotu/contracts`
  doğrulamaları YENİDEN KULLANILDI — yeniden implemente edilmedi. Parola
  ASLA argv/dosya/log olarak geçmez, yalnız ham (raw-mode) terminalden
  yankısız okunur. Org+kullanıcı+`user_roles`+2 `audit_events` TEK
  transaction'da yazılır. 15 test (7 birim/CLI + 8 GERÇEK PostgreSQL
  entegrasyonu) + statik denetim, hepsi geçti; bu sırada 2 gerçek hata
  bulunup düzeltildi (kaynak dosyada görünmez kontrol karakteri
  bozulması; `pg`nin tek client üzerinde eşzamanlı sorgu deprecation
  uyarısı). **Gerçek makinede kanıtlandı (yalnız salt-okunur önizleme,
  `hasarbotu` DB'sinde):** `Status:"ready"`, `OrganizationCount:0`,
  `UserCount:0`, `AdminRoleSeeded:true`, sıfır blocker, sıfır satır
  yazıldı — gerçek `--apply` bu pakette çalıştırılmadı.
- **D9 gerçek Apply denemesi #1 — Adım 0'da YENİ bir blocker (B10) ile
  durduruldu (HB-2026-148/149, 2026-08-04):** kullanıcı B6'yı (açık
  onay) verdi, gerçek cutover başlatıldı. Adım 0'ın sessizlik kısmı
  TEMİZ geçti (689 sn, sıfır kesinti) ama nihai tam kaynak==hedef
  SHA-256 karşılaştırması UYUŞMADI. Ham Administrators-only forensics
  JSON'undan (metin özetine güvenilmeden) + 11 dosya için TAZE
  pCloud DB sorgusu/SHA-256 yeniden hesaplamasıyla (sıfır sürüklenme)
  kesin sonuç: **7 repair adayı** (kanıtlanmış `source_current`/
  `target_stale`, 3 vaka klasöründe) + **4 blocker** (kaynakta
  karşılığı yok, dokunulmadı) + **2 kapsam dışı** (zararsız metadata
  farkı). `repair-post-sync-stale-target-files.ps1` (HB-2026-130)
  yalnız kendi eski, olaya özel şemasını kabul ediyor — bu raporu
  reddediyor (kod değişikliği gerektirir, yapılmadı). Talimat gereği
  Adım 1'e HİÇ geçilmedi — hiçbir env/servis/deploy/DB/dosya
  değişikliği denenmedi. Tam dosya/vaka detayı yalnız
  Administrators-only+hash'li raporda; kullanıcıya sohbette tam
  raporlandı, repo'ya (HB-2026-123 ilkesiyle) alınmadı.
- **B10 onarım aracı genelleştirildi (HB-2026-150, 2026-08-05):**
  `repair-post-sync-stale-target-files.ps1` artık genel
  `pcloud-post-sync-diff-forensics/1.0.0` şemasını açık bir adapter
  ile destekliyor (eski 56AAG629 yolu değişmedi). Yol boyunca gerçek
  bir hata bulunup düzeltildi: paylaşılan taze-doğrulama zinciri
  yalnız `revisions[0]`e bakıyordu — gerçek B10 verisinde 3 dosyada
  pCloud CURRENT revizyonu index 0'da dönüyor (eşit ctime), bu da 3
  gerçek adayı yanlış reddediyordu; artık index'e değil "ayrı,
  hedefle eşleşen herhangi bir revizyon var mı"ya bakıyor. 11 test
  (6 eski değişmeden + 5 yeni) + statik denetim geçti. **Gerçek
  makinede kanıtlandı (yalnız önizleme, `-Apply` verilmeden):**
  `WouldApplyCount=7, BlockedCount=0, ClassificationBlockedCount=4,
  OutOfScopeCount=2` — sıfır dosya değişti.
- **B10 — 17/17 dosya GERÇEKTEN onarıldı (HB-2026-151/155/156,
  2026-08-05):** kullanıcının açık onayıyla gerçek `-Apply` iki kez
  çalıştırıldı (7 + 17 dosya). Sıfır sürüklenme/blocker her ikisinde
  de; ham forensics JSON'undan çıkarılan tam envanter 27 farkı 6 vaka
  klasöründe kesinleştirdi (5 extra + 17 content_mismatch + 5
  metadata_only) — dünden bugüne kaynak/hedef dosya sayısı ~667/668
  artmış, gerçek yoğun iş akışını yansıtıyor. Orijinal (bozuk) içerik
  Administrators-only+hash'li yedeklerde korunuyor. pCloud/env/servis
  hiç değişmedi.
- **B10 ÇÖZÜLDÜ — 22/22 dosya gerçek makinede işlendi (HB-2026-157/158,
  2026-08-05–06):** kalan 5 `extra` dosya salt-okunur köken
  doğrulamasıyla kesin `rename_artifact`(2)/`stale_duplicate`(3)
  kanıtlandı; yeni `cleanup-post-sync-target-only-files.ps1` (+6 test)
  yazıldı. Kullanıcının açık onayıyla gerçek silme `-Apply`
  çalıştırıldı: **5/5 başarılı, sıfır blocker** — sync kökü dışında
  Administrators-only+hash'li yedeklendi, silindi, bağımsız
  doğrulandı. **B10 artık tamamen çözüldü (17 repair + 5 cleanup).**
  **Önemli, B10'dan bağımsız yeni bulgu:** doğrulama sırasında, bu
  araçların hiç dokunmadığı 4-5 dosyanın (2 vaka klasöründeki "doğru
  konum" kopyaları) eş zamanlı ve bağımsız olarak gerçek pCloud
  tarafında silindiği bulundu (kaynaktan da kayıp, pCloud'un canlı
  tablosunda eski fileId'ler tamamen yok) — bu araçların sebep olması
  yapısal olarak imkânsız (kaynağa hiç yazmazlar, bu dosyalar aday
  listesinde hiç yoktu); muhtemelen operatör eş zamanlı gerçek iş
  yapıyordu. Hiçbir aksiyon alınmadı.
- Kalan: D9 Adım 0 tek seferlik yeniden çalıştırıldı — sessizlik TAM
  TEMİZ geçti (658 sn, sıfır reset) ama hâlâ
  `SOURCE_TARGET_HASH_MISMATCH_AT_PASS` ile BLOCKED (artık B10
  değil, muhtemelen yukarıdaki yeni olayın yansıması). B9 araç olarak
  TAMAMLANDI; B2 (build tazeliği) Apply öncesi gerçek `npm run
  build:packages` ile ayrıca kesinleştirilmeli. D9'un geri kalanı
  (Adım 1-6) ayrı, açık bir kullanıcı talebini bekliyor.
- **5 bağımsız kayıp dosya RESTORE EDİLDİ (HB-2026-159/160/161,
  2026-08-06):** salt-okunur olay forensics'i + recovery mapping
  hazırlandı; "cleanup pCloud identity-takibini tetikledi" hipotezi
  kanıtla çürütüldü (orphan'lar hiçbir zaman pCloud'un takip ettiği
  nesneler değildi — 3 ayrı zaman noktasında `found:false`
  doğrulandı), dar bir zamanlama-tetikleme olasılığı açık bırakıldı.
  Kullanıcının pCloud web Trash kontrolü (bulunamadı) ve açık onayı
  sonrası, 5 dosya cleanup'ın admin-only yedeklerinden gerçekten
  restore edildi: **5/5 başarılı**, C:\=P:\=beklenen SHA-256, pCloud
  `found:true`, kuyruk sıfır — bağımsız doğrulandı. D9 gate
  çalıştırılmadı, D9 Adım 1'e geçilmedi.
- **D9 stratejisi değişti (HB-2026-162, 2026-08-07):** global 600 sn
  bütün-ağaç sessizlik kapısı (`pcloud-post-sync-rebaseline-gate.mjs` +
  iki wrapper'ı) **sıfır satır değişmeden** bakım/denetim aracı olarak
  korundu, ama artık kritik işlem ön koşulu DEĞİL — bkz.
  `docs/D9_PER_CASE_RECONCILIATION_ARCHITECTURE.md`. Yeni, dar kapsamlı
  per-case reconciliation motoru (`pcloud-case-reconciliation.mjs`,
  `run-pcloud-case-reconciliation.ps1`) salt-okunur uygulandı, test
  edildi (18 yeni/genişletilmiş `.mjs` testi + 14 repair-tool testi, 3
  kez üst üste deterministik geçti) ve GERÇEK 10 vaka klasörüne karşı
  doğrulandı: 7/10 `conflict`, 3/10 `unknown` (gerçek, eş zamanlı
  `PCLOUD_DATABASE_SNAPSHOT_UNSTABLE`), 0/10 `ready`/`syncing`. Bu
  süreçte gerçek veriyle (sentetik testlerin yakalamadığı) 2 gerçek hata
  bulunup düzeltildi. `repair-post-sync-stale-target-files.ps1`'e 3.
  şema adapteri + kopyalama öncesi/sonrası source identity fence +
  sınırlı yeniden deneme eklendi; iki eski şema hiç değişmedi.
  File Agent'a canlı entegrasyon (freshness gate) **YAPILMADI** — açık
  bir güvenlik kararı (File Agent servis hesabının pCloud'un interaktif
  hesabına ait yerel DB'sine okuma erişimi yok) gerektiriyor, mimari
  belgesinin §8'inde net şekilde işaretlendi. D9 gate çalıştırılmadı,
  D9 Adım 1'e geçilmedi.
- **File Agent cross-account pCloud DB erişimi — PLAN + PREVIEW hazır
  (HB-2026-163, 2026-08-07):** `preview-file-agent-pcloud-db-access.ps1`
  (`-Apply` yapısal olarak yok) gerçek makinede çalıştırıldı. Gerçek ACL
  taramasıyla tam minimum ACE seti çıkarıldı: yalnız 5 ata düğümünde
  Traverse + pCloud klasöründe 1 Read+Synchronize (dosyalara miras
  alınır, WAL/SHM yeniden oluşsa da kapsar) — hiçbir yazma/silme biti
  yok, bağımsızca doğrulandı. Elle yapılan ilk tahminde bir hata
  (`BUILTIN\Users` ile `Everyone` karıştırılması) aracın kesin SID
  simülasyonuyla yakalandı. Hiçbir ACL/pCloud/servis/env/dosya
  değişmedi; Apply ayrı, açık bir kullanıcı onayı bekliyor.
- **File Agent cross-account pCloud DB erişimi — Apply + Rollback aracı
  hazır ve doğrulandı (HB-2026-164, 2026-08-07):**
  `apply-file-agent-pcloud-db-access.ps1` (+ `.tests.ps1`, 5 test) yalnız
  hash-doğrulanmış preview raporundaki exact ACE'leri kabul eder; Apply
  öncesi preview'ı taze yeniden çalıştırıp raporla karşılaştırır ve her
  düğümün ACL'ini kayıtlı baseline ile karşılaştırır (drift'te
  fail-closed), rollback tam SDDL'yi birebir geri yükler. Sentetik ortamda
  gerçek ACL mutasyonu + gerçek rollback + WAL/SHM mirasının gerçek kanıtı
  uçtan uca doğrulandı. Servis hesabı bağlamında Zamanlanmış Görev
  tabanlı gerçek doğrulama bu makinede `SeBatchLogonRight`
  eksikliği/servisin Disabled olması nedeniyle tamamlanamadı — yeni bir
  hak sessizce verilmedi, sonuç dürüstçe raporlanır. Gerçek
  `svc-hb-fileagent` ACL'ine hâlâ **Apply YAPILMADI**; gerçek makinede
  yalnız (değişmeyen) preview aracı tekrar çalıştırıldı, sonuç aynı: 6
  ACE hâlâ eksik.
- **File Agent cross-account pCloud DB erişimi — GERÇEK Apply yapıldı
  (HB-2026-165, 2026-08-07):** kullanıcı onayıyla 6 ACE GERÇEK
  `svc-hb-fileagent` hesabına uygulandı. Apply öncesi araca DB dosyaları
  (data.db/-wal/-shm) üzerinde SID/effective-access simülasyonu
  (Read=evet/Write=hayır, data.db için zorunlu+fail-closed) ve rollback
  paketi hazır-olma doğrulaması eklendi. Apply sonrası üç bağımsız
  yöntemle doğrulandı: aracın kendi kontrolü, taze preview
  (`already_sufficient`), `icacls`+doğrudan .NET sayısal okuma — tümü
  aynı sonucu gösterdi: 5 ata düğümde `Traverse|Synchronize`, pCloud
  klasöründe + `Read|Synchronize` (ObjectInherit), hiçbir yazma/silme/
  sahiplik biti yok. Servis hesabı bağlamı gerçek okuma probe'u
  kullanıcının açık isteğiyle File Agent kontrollü aktivasyonuna
  ertelendi. Rollback GERÇEKTEN çalıştırılmadı (paket hazır, gerekirse
  ayrı komutla çalıştırılabilir). File Agent servisi hâlâ başlatılmadı.
- **File Agent kontrollü aktivasyon — PLAN + PREVIEW hazır (HB-2026-166,
  2026-08-07):** `preview-file-agent-controlled-activation.ps1` (`-Apply`
  yapısal olarak yok) 6 önkoşulu gerçek, salt-okunur kontrollerle
  doğruladı: 5/6 `verified_ok`/`verified_with_note`, 1/6
  (`per_case_freshness_gate_access`) **`blocked_structural`** — gerçek,
  önceden belgelenmemiş bir bulgu: freshness gate'in CLI sözleşmesi
  (`run-pcloud-case-reconciliation.ps1`) varsayılan kaynağı `P:\`'ye
  işaret ediyor, ve `P:\` pCloud'un sanal sürücüsü olduğu için Session
  0'da (hiçbir Windows servisinden) GÖRÜNMEZ — freshness gate bu haliyle
  bir servis içinden yapısal olarak çağrılamaz, gizlenmedi. 7 aşamalı
  aktivasyon sırası (env/root → service config → start → service-context
  DB probe → per-case freshness smoke → File Agent file-operation smoke
  → verify/rollback) yalnız PLAN olarak üretildi; iki adım (servis
  başlatma vehicle tasarımı, freshness gate yeniden tasarımı) açık,
  çözülmemiş mimari karar olarak işaretlendi. Hiçbir env/servis/dosya/
  pCloud değişikliği yapılmadı; gerçek `hasarbotu-file-agent` servisi hâlâ
  Disabled/Stopped.
- **HB-2026-166'nın 2 açık mimari kararı ONAYLANDI + GERÇEKLEŞTİRİLDİ
  (HB-2026-167, 2026-08-08):** **Karar 1** — Session-0-safe, attestation
  tabanlı yeni bir freshness gate (`pcloud-session0-freshness-gate.mjs`,
  P:\'ye SIFIR bağımlılık) eklendi. Gerçek sorguyla kanıtlandı: pCloud
  DB'nin `file.hash` kolonu 64-bit SQLite INTEGER — SHA-256 için yapısal
  olarak yetersiz — bu yüzden `ready` her zaman ayrı, önceden üretilmiş
  bir SHA-256 attestation (`pcloud-source-attestation.mjs`, admin/P:\
  erişimli ayrı bir araçla üretilir) ile eşleşmeyi gerektirir; DB hash/
  size/mtime tek başına asla yeterli sayılmaz. **Karar 2** — production
  File Agent'a self-test modu eklenmedi; bunun yerine tek-seferlik,
  kendi kendini temizleyen bir disposable probe service PLANLANDI
  (`preview-file-agent-disposable-probe-service.ps1` + gerçek yükü
  `file-agent-disposable-probe-inner.ps1`, henüz kurulmadı/başlatılmadı).
  Gerçek, yeni bulunan bir engel dürüstçe raporlandı: aynı hesapla ikinci
  bir servis kaydı `sc.exe config` ile hesabın SAM'deki gerçek parolasını
  gerektirir — HB-2026-118 bu parolayı hiç saklamadığı için gerçek
  aktivasyon önce parola sıfırlamayı gerektirecek
  (`second_service_logon_credential: blocked_structural`). Gerçek
  makinede yalnız salt-okunur/sentetik testler çalıştırıldı; hiçbir env/
  servis/dosya/pCloud değişikliği yapılmadı.
- **Eski durum (artık çözüldü): `ADD_SYNC_DONE / MIGRATION_BLOCKED`.** Gerçek 600 saniyelik bakım
  kapısı, `D8BeforeSync` ve pCloud `Add new sync` bu makinede gerçekten
  çalıştırıldı (HB-2026-125–128, karar günlüğünde ayrıntılı değil ama
  commit'lerde kayıtlı). Operatör senkron sırasında bilerek 2 büyük program
  dosyası sildi (onaylı) — `AfterSync` bunu doğru şekilde
  `SOURCE_BASELINE_CHANGED_SINCE_BEFORE_SYNC` ile BLOCKED yaptı.
- **Yeni: `PostSyncRebaseline` stage'i (HB-2026-129).** `D8BeforeSync`'in
  aksine **aktif** bir Add Sync eşlemesi altında çalışan, eşlemeyi hiç
  durdurmayan/kaldırmayan ayrı bir gate+stage çifti eklendi:
  `pcloud-post-sync-rebaseline-gate.mjs` +
  `test-pcloud-post-sync-rebaseline-gate.ps1` + `test-storage-sync-migration-preflight.ps1`'e
  yeni `-Stage PostSyncRebaseline`. Eski pre-sync gate/`D8BeforeSync`
  hiç değiştirilmedi (sıfır sync kaydı varsayımı korunuyor); bu tamamen ayrı
  bir araç. Tam olarak bir `syncfolder` kaydının beklenen kök+hedefle
  eşleşmesini, sıfır bekleyen/delayed kuyruğu (task/fstask/upload_tasks/
  localfileupload/uptask_fileupload/pagecachetask/`localfolder.taskcnt`),
  sıfır conflict-adı desenini, en az 600 saniye kaynak+hedef+uzak eşzamanlı
  sessizliği ve nihai tam kaynak==hedef SHA-256 eşitliğini zorunlu kılar.
  `Get-ValidatedBeforeSyncBaseline` artık `D8BeforeSync` VEYA
  `PostSyncRebaseline` kaynaklı raporu kabul eder (AfterSync'in kendisi
  değişmedi).
- **Gerçek çalıştırma sonucu:** Gate 669 saniye tam sessizlik sağladı
  (`WindowResetCount=0` — kaynak/hedef/uzak üçü de hareketsiz), ama nihai
  `EligibleForRebaseline=false`, `Status=blocked`,
  `SOURCE_TARGET_HASH_MISMATCH_AT_PASS`. Kaynak ve hedefte dosya/klasör
  sayısı birebir eşit (6715/662) ama toplam bayt ~16,96 MB farklı. Salt-okunur
  ek tarama tam olarak **4 dosyayı** ayrı ayrı tespit etti — hepsi
  `56AAG629\HASAR` klasöründe (`HASAR 101–104.jpeg`): kaynak (P:) artık çok
  daha küçük (~377–379 KB, daha yeni mtime), hedef hâlâ çok daha büyük
  (~4,4–4,8 MB, daha eski mtime) kopyaları taşıyor. Uzak (bulut) toplam bayt
  kaynakla birebir eşleşiyor (kaynak→bulut yüklemesi bitmiş), ama pCloud'un
  yerel kuyruk tabloları tümü sıfır göstermesine rağmen bulut→hedef indirmesi
  bu 4 dosya için hiç güncellenmemiş. Bu; ilk keşfedilen sahte "2 dosya
  silindi" alarmının (kararlılık kontrolsüz ad-hoc taramadan kaynaklanan yanlış
  alarm, gerçek araçla düzeltildi) aksine **gerçek, kalıcı bir tutarsızlık**.
- Bulgu Administrators-only kanıta yazıldı
  (`post-sync-rebaseline-blocked-diff-*.json` + sha256 sidecar). Migration
  bu 4 dosya çözülüp taze bir `PostSyncRebaseline PASS` alınmadan
  `AfterSync`e geçilmeyecek şekilde fail-closed durduruldu. Sync eşlemesi,
  Stop/Clear, dosya, env ve servis bu paket boyunca hiç değiştirilmedi.
- `node --test` (yeni + mevcut pCloud gate testleri) 15/15, `npm run
  check:deploy` geçti.
- **Salt-okunur adli analiz (HB-2026-130a):** SHA-256/EXIF/JPEG bütünlüğü/
  perceptual hash/pCloud `filerevision` geçmişi ile 4 dosya da
  `source_current_valid` sınıflandı — hedef, pCloud'un açıkça "superseded"
  işaretlediği eski (4032×3024) kamera çıktısını taşıyor; kaynak, aynı
  fotoğrafın pCloud'un current nesnesi olan küçültülmüş (1024×768) türevi.
- **Kontrollü canlı repair aracı eklendi (HB-2026-130):** bu depodaki İLK
  gerçek yazma yolu — `repair-post-sync-stale-target-files.ps1` +
  `pcloud-stale-target-file-state.mjs`, `install-services.ps1` ile aynı
  Planla→Önizle→Apply modeli. Her dosya için taze fail-closed doğrulama
  (kaynak/hedef SHA-256 hâlâ forensics anındaki gibi, pCloud current
  satırı kaynakla eşleşiyor, sıfır task/fstask referansı, hedef kilitli
  değil) olmadan `-Apply` hiçbir şeye dokunmaz. 24 test (Node+PowerShell,
  2 gerçek kusur bulup düzeltti: `.NET` `File.Replace(...,$null)` quirk'i
  ve PS5.1'in `ConvertFrom-Json`/`ConvertTo-Json` dizi-sarma tuhaflığı)
  hepsi geçti. **Gerçek makinede yalnız salt-okunur PREVIEW çalıştırıldı**
  (gerçek 4 dosyaya karşı): `preview_ok`, 4/4 `would_apply`, 0 blocker —
  hiçbir dosya değiştirilmedi, hiçbir yedek alınmadı. Gerçek `-Apply`,
  kullanıcı onayı bekleniyor.
- **Gerçek `-Apply` tamamlandı ve bağımsız doğrulandı (HB-2026-130b):** 4
  dosya (kaynak==hedef SHA-256 birebir eşit) onarıldı. `localfolder.taskcnt`
  toplamının gerçek kuyruklardan bağımsız, kalıcı ve işle ilgisiz bir sapma
  taşıdığı bulunup gate'ten blocker olarak kaldırıldı (commit 1951e39).
- **Düzeltilmiş gate tek deneme yeniden çalıştırıldı, YENİ (HB-2026-131,
  2026-08-03 ~17:15 UTC): `BLOCKED / SOURCE_TARGET_HASH_MISMATCH_AT_PASS`.**
  Ön koşulların tümü geçti ve gerçek 719 saniyelik kesintisiz sessizlik ilk
  kez sağlandı (`WindowResetCount=0`), ama final tam SHA-256'da dosya sayısı
  eşitken (6873/673) toplam bayt 708 bayt farklı — HB-2026-130'daki
  4-fotoğraflık ~16,96 MB'lik farktan tamamen ayrı, önceden belgelenmemiş
  yeni bir tutarsızlık. Talimat gereği otomatik yeniden deneme YAPILMADI.
- **708 baytlık fark dosya bazında izole edildi (HB-2026-132, aynı gün,
  yeni `pcloud-post-sync-diff-forensics.mjs` + `run-pcloud-post-sync-diff-forensics.ps1`
  ile).** Tam olarak TEK dosya sorumlu:
  `2026\Ağustos 2026\56AAG629\EVRAK\ALKOL RAPORU .jpg`. Kaynak (P:)
  210.808 bayt (`LastWriteTimeUtc` 2026-08-03T11:01:44Z), hedef
  210.100 bayt (2026-08-03T09:20:27Z) — fark tam 708 bayt. pCloud'un
  current satırı kaynakla eşleşiyor, `filerevision` geçmişinde hedefin
  boyutuyla eşleşen eski bir kayıt var (`source_current_target_superseded`),
  sıfır task/fstask referansı, iki taraf da kilitli değil. Bu,
  HB-2026-130'daki 4 HASAR fotoğrafından tamamen bağımsız, bugün oluşmuş
  yeni bir tek dosyalık pCloud bulut→hedef indirme gecikmesi. Talimat
  gereği onarım ÇALIŞTIRILMADI — yalnız izolasyon yapıldı.
- **Tek dosya onarıldı ve bağımsız doğrulandı (HB-2026-133, aynı gün
  ~17:53 UTC).** `ALKOL RAPORU .jpg` (56AAG629/EVRAK) için taze fail-closed
  ön doğrulama (kaynak SHA-256 pCloud current object ile, hedef boyutu
  superseded `filerevision` ile eşleşiyor, sıfır task/fstask, kilit yok)
  sonrası `repair-post-sync-stale-target-files.ps1 -Apply`: yedek alındı
  (sync kökü dışında, admin-only+hash'li), atomik replace yapıldı.
  Bağımsız son kontrol: kaynak==hedef SHA-256 birebir eşit.
- **Ardından tek seferlik post-sync rebaseline gate'i (attempt 11) İLK KEZ
  gerçek `PASS` verdi:** `ObservedQuietSeconds=641`, `WindowResetCount=6`,
  `SourceTargetHashMatch=true` (6876 dosya, tam eşitlik).
- **`PostSyncRebaseline` stage'i bu PASS raporuyla hemen ardından
  çalıştırıldı — `BLOCKED`.** Gate'in 641 saniyelik penceresi kapandıktan
  yalnızca ~33 saniye sonra başlayan stage'in kendi hash geçişinde GERÇEK,
  taze ofis aktivitesi yakalandı (kaynak+hedefte aynı ~161.895 bayt eksildi,
  birkaç `IO_ERROR`/`FILE_CHANGED_DURING_HASH`) —
  `ACTIVE_SYNC_WINDOW_SOURCE_BASELINE_CHANGED` +
  `SOURCE_CHANGED_DURING_PREFLIGHT` vb. Araç kusuru değil: sistem gerçek
  eşzamanlı değişikliği doğru şekilde yakalayıp durdu. Talimat gereği
  yeniden deneme YAPILMADI; `AfterSync` bu paket içinde ÇALIŞTIRILMADI.
- **Yeni tek deneme (HB-2026-134, aynı gün ~18:34 UTC): gate'in kendisi
  `BLOCKED` — `PCLOUD_PENDING_TASKS_FOUND`.** `ObservedQuietSeconds=95`
  (600 sınırının çok altında), 30 dakikalık pencere boyunca gerçek, devam
  eden pCloud kuyruk aktivitesi yüzünden hiç kararlı hale gelmedi. Bu kez
  gate hiç PASS vermediği için `PostSyncRebaseline`/`AfterSync` hiç
  ÇALIŞTIRILMADI (bir önceki stage'in PASS raporu şart). Talimat gereği
  yeniden deneme yapılmadı.
- **`PCLOUD_PENDING_TASKS_FOUND` salt-okunur 15 dakikalık teşhis (HB-2026-135,
  yeni `pcloud-task-queue-forensics.mjs`/`run-pcloud-task-queue-forensics.ps1`
  ile, aynı gün).** 45 örneğin 44'ünde (~14 dk 40 sn) kuyruklar tamamen
  boştu; yalnızca pencere kapanmadan saniyeler önce 4 yeni `task` satırı
  belirdi (aracın kendi sınıflandırması: `unknown`/`AMBIGUOUS_SIGNALS` —
  tek örnek noktasından kesin sınıflandırma yapılamadı). Admin-only ham
  kayıtların manuel incelemesi: klasik "kaydet → geçici dosya → yeniden
  adlandır" deseni, `hasarbotu-dosya-listesi-2026-07-21 - Kopya.xlsx`
  (HasarBotu'nun kendi iç dosyası, müşteri kanıtı DEĞİL) için — sıkıntılı
  bir kuyruk değil, zararsız tek dosyalık gerçek bir kaydetme/yükleme
  izlenimi (yorum, kesin değil). Gate/PostSyncRebaseline/AfterSync HİÇ
  çalıştırılmadı, hiçbir şey değişmedi.
- **"Ofis kullanımı durdu" bildirimiyle yeni tek deneme (HB-2026-136, aynı
  gün ~19:20 UTC): gate yine `BLOCKED` — `PCLOUD_PENDING_TASKS_FOUND`.**
  `ObservedQuietSeconds=35`. Bu kez yalnız kuyruk sayacı değil, ~9 dk 48 sn
  boyunca GERÇEK, ölçümlenmiş kaynak+hedef+uzak hareketi kaydedildi
  (`RemoteCreateCount=4`, `RemoteModifyCount=1`, `RemoteDeleteCount=3`,
  `SourceCreateCount=2`, `SourceModifyCount=3`, `SourceDeleteCount=1`,
  `TargetCreateCount=2`, `TargetModifyCount=3`, `TargetDeleteCount=1`) —
  bildirilen "durdu" durumuyla tutarsız. Talimat gereği yeniden deneme
  yapılmadı; `PostSyncRebaseline`/`AfterSync` yine hiç çalıştırılmadı.
- **2 dakikalık ön-kontrol, gate baştan çalıştırılmadan (HB-2026-137, aynı
  gün ~20:00 UTC): hareket tespit edildi, hiçbir aşama başlatılmadı.**
  "Excel kapatıldı" bildirimiyle `pcloud-task-queue-forensics` 120 sn/20 sn
  ile önce çalıştırıldı. Kuyruk 7 örneğin tamamında boştu ama pencere
  başı/sonu tam ağaç karşılaştırması gerçek değişiklik yakaladı:
  `SourceDelta.modifyCount=1`, `RemoteDelta.createCount=1`+`deleteCount=1`,
  `DiffCursorAdvanced=true` — bildirilen "durdu" durumuyla tutarsız. Talimat
  gereği gate/`PostSyncRebaseline`/`AfterSync`'ten hiçbiri başlatılmadı.
- **Temiz ön-kontrol sonrası gate (attempt 14) İLK KEZ PASS, ama
  `PostSyncRebaseline` yine küçük gerçek bir değişiklikle BLOCKED
  (HB-2026-138, aynı gün ~20:39 UTC).** Ön-kontrol sıfır hareket
  gösterdikten sonra başlatılan gate: `ObservedQuietSeconds=650`,
  `SourceTargetHashMatch=true`. Ancak `PostSyncRebaseline` stage'i bu
  PASS'in ~27 sn ardından başlayınca kendi ~1 dakikalık hash geçişinde
  çok küçük gerçek bir değişiklik yakaladı (`MetadataChangedFileCount=1`,
  `BytesDelta=+627`, hem kaynak hem hedefte) —
  `SOURCE_CHANGED_DURING_PREFLIGHT`/`TARGET_CHANGED_DURING_PREFLIGHT`.
  Araç kusuru değil. Talimat gereği yeniden deneme yapılmadı; `AfterSync`
  çalıştırılmadı. **Bu, gate'in artık gerçekten PASS verebildiğini
  kanıtlıyor** — darboğaz artık gate'in 600 saniyesi değil, PASS ile bir
  sonraki stage'in başlaması arasındaki kısa pencerede bile mutlak
  sıfır dosya hareketi gerekmesi.
- **Zincir İLK KEZ baştan sona PASS (HB-2026-139, aynı gün ~21:19 UTC):
  gate `PASS` (657 sn sessizlik) → `PostSyncRebaseline` `PASS` (sıfır
  blocker) → `AfterSync` `PASS` (sıfır blocker).** Kaynak==hedef tam
  SHA-256 eşitliği (6873 dosya) kanıtlandı; üç aşamanın raporu da
  Administrators-only kanıt dizininde. D8 migration DOĞRULAMASI tamamlandı.
  **Gerçek operasyonel devretme (env/servis/File Agent kök dizini)
  AYRI, henüz YAPILMAMIŞ bir adım** — kullanıcının açık talebi ve ayrı
  bir kritik işlem onayı gerekiyor.
- Sonraki adım: kullanıcının açık talebiyle gerçek operasyonel devretmeyi
  (AGENTS.md #7 Planla→Önizle→Onay→Uygula→Doğrula→Kesinleştir→Audit
  modeliyle) planlamak.

## D7 salt-okunur pCloud → NTFS geçiş preflight'ı (2026-07-31)

- **Güncel sonuç: `BeforeSync PASS/0`; geçiş henüz başlatılmadı.** Önceki
  10 kalıcı G/Ç kaydı, admin-only kanıt zincirinde sunucuda `MISSING`, yerel
  olarak `stale_temp_candidate` ve exact path/fileId çifti şeklinde
  doğrulandı. F01 revision ayrımı ayrıca `PASS` ile kapandı.
- Hashli, yalnız Administrators erişimli exclusion manifesti tam 10 kayıt
  taşır. Wildcard, uzantı ve klasör kuralı yoktur. Manifest yoksa, hash/ACL
  bozuksa, kayıt sayısı/kimliği değişirse veya yerel pCloud DB exact metadata
  bağı koparsa araç kaynak hash taramasına başlamadan fail-closed kapanır.
- Gerçek tekrar koşusunda 6.404 kaynak metadata girdisi görüldü; yalnız 10
  yetkili ghost kayıt dışlandı, kalan 6.394 dosyanın tamamı SHA-256 ile
  okundu. Hash hatası 0, kaynak snapshot kararlı, hedef boş ve 3× kapasite
  kapısı `PASS`; blocker yoktur.
- Kalıcı tooling: `test-storage-sync-migration-preflight.ps1`,
  `validate-storage-ghost-exclusion.mjs` ve
  `invoke-storage-source-io-diagnostic.ps1`. Hassas yollar/fileId değerleri
  repo veya konsol çıktısına girmez.
- Veri kopyalama, pCloud ayarı, registry/env veya servis durumu değişikliği
  yapılmadı. Hedef boş, File Agent mevcut durumda bırakıldı.
- Sonraki tek adım: bütün yazarları bakım penceresine alıp gerçek 600 saniyelik
  pCloud diff/source envanter kapısını ve `D8BeforeSync PASS/0` kapısını
  geçirmek. Ancak bundan sonra ayrı açık operatör onayıyla hedef sync
  yapılandırılır; ardından `AfterSync` sayı+boyut+tam SHA-256 geçmeden
  `HASARBOTU_AGENT_ROOTS` veya File Agent durumu değiştirilmez.

## Mevzuat ve AI Yardımcısı uçtan uca UAT doğrulaması (2026-07-27)

- **Kapsam:** Sekiz ana navigasyon modülünün UAT dizisindeki SONUNCUSU.
  Kullanıcının istediği zincir ("gerçek kaynak → analiz/yanıt → kanıt/
  provenance → tenant ve yetki izolasyonu → UI navigasyonu") doğrulanmadan
  önce bu modülün GERÇEK mevcut durumu araştırıldı.
- **ÖNEMLİ BULGU (kusur değil, tekrar tekrar belgelenmiş kasıtlı karantina):**
  Mevzuat ve AI Yardımcısı'nın HİÇBİR gerçek backend'i yoktur — ne mevzuat
  kaynak kütüphanesi tablosu/migration'ı, ne genel amaçlı AI sohbet/soru-
  cevap ucu, ne de sözleşme (contract) tanımı vardır (`packages/domain`'daki
  `LegislationSourceId` markalı tip tanımlı ama repo genelinde HİÇ
  kullanılmıyor — ölü kod). Bu, HB-2026-054'te (2026-07-18) açıkça karar
  verilmiş: "mevzuat kaynak kütüphanesi modeli bilinçli olarak kapsam
  dışıdır ve ayrı ürün kararı bekler" — HB-2026-055 madde 8'de (Paket 49)
  yeniden teyit edilmiş: "Mevzuat ekranı HB-2026-054 uyarınca karantinada
  kalmaya devam eder." Sonraki hiçbir paket bu kararı tersine çevirmedi;
  bugün hâlâ geçerli. `LegislationPage.tsx` API modunda `BackendUnavailableState`
  ile "Mevzuat kaynak kütüphanesi henüz yapılandırılmadı." gösterir ve HİÇBİR
  network isteği yapmaz (kod içinde `fetch`/data-port çağrısı yok); mock
  modda ise 6 sabit örnek kaynak + tek bir sabit metinli "mock" soru-cevap
  gösterir (gerçek LLM/servis çağrısı yok, buton tıklamasıyla senkron sabit
  metin döner).
- **İstenen zincirin gerçekte neyi karşıladığı:** "gerçek kaynak", "analiz/
  yanıt" ve "kanıt/provenance" adımlarının test edilecek GERÇEK bir karşılığı
  yoktur (üretilecek/doğrulanacak üretim kodu/veri hiç mevcut değil).
  "Tenant ve yetki izolasyonu" için tenant-kapsamlı hiçbir sorgu yapılmadığı
  için izole edilecek bir yüzey yoktur; tek anlamlı karşılığı rota
  seviyesindeki oturum kapısı ve API modunda GERÇEKTEN sıfır ek istek
  yapıldığının kanıtlanmasıdır (Ayarlar UAT'ında aynı mantıkla ele alındı).
  "UI navigasyonu" ise gerçek ve test edilebilir tek adımdır.
- **Doğrulanan gerçek zincir:** `/mevzuat-ve-ai`'ye kimliksiz erişim login
  ekranının arkasında kaldı (daha önce yalnız genel nav taramasıyla dolaylı
  kanıtlıydı, şimdi doğrudan); girişten sonra API modunda dürüst boş durum
  ("Mevzuat kaynak kütüphanesi henüz yapılandırılmadı.") GERÇEKTEN TEK istek
  (oturum bootstrap) ile göründü, sıfır ek/sızan istek atılmadı. Gerçek
  Chrome ile `router-v8-browser-smoke.mjs` (8 rotalık nav taraması dahil
  `/mevzuat-ve-ai`, sıfır konsol hatası, taşma yok, 2 ekran/tema kombinasyonu)
  yeniden çalıştırılıp doğrulandı. Mevcut `LegislationPage.test.tsx` (3 test:
  API modunda dürüst boş durum + sıfır mock sızıntısı, mock modda tam
  prototip, varsayılan modda tutarlılık) hâlâ yeşil.
- **Not:** `scripts/package48-browser-smoke.mjs` (Paket 48'e özgü, CI/`npm
  test` kapsamı dışı eski bir betik) bu görev sırasında çalıştırılmaya
  çalışıldı ama Bildirimler'in ESKİ Paket 48 placeholder metnini ("Bildirim
  altyapısı henüz etkin değil.") arıyor — Bildirimler Paket 49'da (bu
  oturumda ayrıca UAT'tan geçti) gerçek backend'e geçtiği için o metin artık
  hiç görünmüyor. Bu, betiğin KENDİSİNİN bayatlaması; Mevzuat'la ilgisi yok
  ve düzeltilmedi (kapsam dışı, tek kullanımlık eski paket betiği).
- **Sonuç: gerçek üretim kusuru bulunmadı.** Üretim kodunda değişiklik
  yapılmadı.
- Kalıcı kanıt olarak `src/app/appGate.test.tsx`'e 2 yeni test eklendi. Ana
  ağaçta typecheck, lint (0 error / 2 warning, önceden var olan ve bu
  görevde dokunulmayan dosyalarda, değişmedi), gerçek PostgreSQL ile
  **domain 759 + contracts 324 + database 74 + UI 376 (+2 yeni, +6 skip) +
  API 490 + file-agent 78**, gerçek Chrome ile `router-v8-browser-smoke.mjs`
  tüm kontroller true, build/bundle (417.259 bayt, değişmedi), `npm audit`
  (moderate) 0 açık geçti.
- Kapsam dışı: gerçek mevzuat kaynak kütüphanesi ve AI soru-cevap backend'i
  (HB-2026-054'te zaten kasıtlı olarak ayrı ürün kararına bırakılmış; bu UAT
  görevi yeni bir backend/özellik EKLEMEDİ, yalnız mevcut karantina
  davranışını doğruladı).

## Raporlar ve Ücretler (üst düzey) uçtan uca UAT doğrulaması (2026-07-27)

- **Kapsam:** Paket 39/45'in (HB-2026-045) kabul edildiği andan bu yana ilk
  kez, üst düzey `/raporlar-ve-ucretler` sayfasının gerçek verisi
  (`GET /api/v1/reports/case-summary`) için gerçek kapanış → gerçek ücret
  onayı → aylık rapora yansıma → tenant izolasyonu → rol görünürlüğü zinciri
  **sentetik SQL ile onaylı sürüm enjekte etmeden (yalnız yabancı organizasyon
  karşılaştırma verisi için SQL kullanılarak)** doğrulandı. Bu, dosya-içi
  "Raporlar ve Ücretler" SEKMESİNDEN ayrı, örgüt geneli bir toplama panosudur.
- **Kapatılan gerçek boşluklar:** (1) Aylık rapor ucunun tenant izolasyonu
  hiçbir zaman YABANCI organizasyonun KENDİ oturumundan sorgulanarak
  kanıtlanmamıştı (`closure-fees-reports.test.ts` yabancı case'i yalnız
  detay-404 için seedliyordu, hiç ücret eklemiyor ve hiç o organizasyon
  olarak giriş yapmıyordu). Bu test yabancı organizasyonda GERÇEKTEN onaylı
  bir ücret oluşturdu ve HER İKİ organizasyonun KENDİ oturumuyla raporu
  sorgulayıp `summary`, `distribution`, `responsibleUsers`, `services` VE
  `pendingFees` alanlarının TAMAMININ sızmadığını doğrudan kanıtladı — dahil
  filtre-organizasyon kombinasyonu (yabancı bir `responsibleUserId` filtre
  olarak geçilse dahi organizasyon sınırının içinde kalıp güvenli biçimde
  boş sonuç döndüğü, hata vermediği ya da sızdırmadığı). (2) Bu uçta rol
  kısıtı YOKTUR (yalnız `requireSession`); `secretary` ve `read_only`
  rollerinin GERÇEKTEN aynı gerçek mali toplamları görebildiği hiç gerçek
  oturumlarla kanıtlanmamıştı — artık kanıtlı (kasıtlı tasarım, DECISIONS ile
  tutarlı: "ilk aşamada herkes tam yetkili çalışır").
- **Zaten kanıtlı olan, TEKRARLANMAYAN:** Onaylı ücretin GERÇEK yeniden
  açmadan sonra aylık toplamdan doğru düştüğü (bu oturumda daha önce bulunup
  düzeltilen çift-sayım kusuru) `closure-fee-uat-e2e.test.ts`'te BU AYNI uç
  üzerinden zaten kanıtlı; bu görev onu doğrulamak için yeniden çalıştırmadı,
  yalnız `npm test` ile birlikte yeşil kaldığını teyit etti.
- **Sonuç: gerçek üretim kusuru bulunmadı.** Üretim kodunda değişiklik
  yapılmadı.
- Kalıcı kanıt olarak `services/api/test/reports-fees-uat-e2e.test.ts`
  eklendi (gerçek `hasarbotu_test` PostgreSQL + sentetik dosya sistemi +
  gerçek Agent `runOnce`). Ana ağaçta typecheck, lint (0 error / 2 warning,
  önceden var olan ve bu görevde dokunulmayan dosyalarda, değişmedi), gerçek
  PostgreSQL ile **domain 759 + contracts 324 + database 74 + UI 374
  (+6 skip) + API 490 (+1 yeni) + file-agent 78**, build/bundle (417.259
  bayt, değişmedi), `npm audit` (moderate) 0 açık geçti.
- Kapsam dışı: PDF/OCR ücret çıkarımı, Excel dışa aktarımı (ayrı Dosya
  Envanteri modülüyle zaten kapatıldı), genel muhasebe yönetimi — hepsi
  HB-2026-045 madde 8'de zaten kasıtlı olarak dışarıda bırakılmış; gerçek
  backend'e karşı React `ReportsPage` UI entegrasyon testi (yalnız mock-fetch
  ile test edilen mevcut kapsam) bu görevde eklenmedi.

## Kapanan Dosyalar uçtan uca UAT doğrulaması (2026-07-27)

- **Kapsam:** Paket 21'in (HB-2026-027) kabul edildiği andan bu yana ilk
  kez, gerçek kapanış saga'sı (plan → onay → gerçek Agent fiziksel taşıması
  → finalize) → `GET /api/v1/cases?status=closed|open` liste üyeliği →
  gerçek yeniden açma → tenant izolasyonu → salt-okunur rol görünürlüğü
  zinciri **sentetik SQL ile onaylı sürüm enjekte etmeden** doğrulandı.
  Mevcut `case-lifecycle.test.ts` (432 satır) saga'yı ve RBAC/tenant/stale-
  version reddini zaten kapsamlıca kanıtlıyordu ama HER ZAMAN `cases`
  tablosunu doğrudan SQL ile okuyordu — hiçbir yerde gerçek saga sonrası
  gerçek `GET ?status=closed` ucu çağrılmamıştı; `cases-pagination.test.ts`
  ise `status=closed` filtresini yalnız TEK organizasyonlu SQL-seed veriyle
  kanıtlıyordu (çapraz-org kapalı liste izolasyonu hiç kanıtlanmamıştı).
- **Doğrulanan gerçek zincir:** gerçek `POST /cases` → tam hazır evrak/
  fotoğraf/onaylı Değer Kaybı → gerçek kapanış saga'sı (plan/onay/gerçek
  Agent `runOnce` fiziksel taşıması) → `GET ?status=closed` GERÇEKTEN
  case'i içerdi, `GET ?status=open` GERÇEKTEN içermedi → yabancı
  organizasyonun (zaten) kapalı case'i hiçbir kapalı listede sızmadı (iki
  yönlü: org A'nın listesinde org B'nin case'i yok, org B'nin listesinde
  org A'nın case'i yok) → `secretary` rolü kapalı listeyi GÖREBİLDİ (yalnız
  `requireSession`) ama yeniden açma KOMUTUNU veremedi (403, kalıcı etkisiz)
  → admin ile gerçek yeniden açma saga'sı (plan/onay/gerçek Agent taşıması)
  → `GET ?status=open` GERÇEKTEN case'i içerdi, `GET ?status=closed`
  GERÇEKTEN içermedi → audit zinciri (`close_planned/approved/closed`,
  `reopen_planned/approved/reopened`) eksiksiz, çapraz-org id sızıntısı yok.
- **Sonuç: gerçek üretim kusuru bulunmadı.** Üretim kodunda değişiklik
  yapılmadı.
- **Dikkat çekilecek (belgelenmiş, kusur değil):** `case-lifecycle`
  `COMMAND_ROLES` (`admin/expert/case_manager`) kasten `cases` yazma
  rollerinden (`+secretary/accounting`) daha dardır (HB-2026-027 §7); ön uç
  kapısı (`CaseDetailPage.tsx`) sunucuyla birebir eşleşir, sürüklenme yok.
  Ayrıca `ClosedCasesPage`'deki "Salt Okunur Dosyayı Aç" butonu aslında tam
  yetkili `CaseDetailPage`'e gider (yetkili roller için gerçek "Yeniden Aç"
  düğmesi orada görünür) — güvenlik açığı değil (rol kapısı hem istemci hem
  sunucuda doğru) ama etiket yanıltıcı; küçük bir metin düzeltmesi, kabul
  edilmiş UI baseline'ını değiştirmemek için bu görevde YAPILMADI.
- Kalıcı kanıt olarak `services/api/test/closed-cases-uat-e2e.test.ts`
  eklendi (gerçek `hasarbotu_test` PostgreSQL + sentetik dosya sistemi +
  gerçek Agent `runOnce`). Ana ağaçta typecheck, lint (0 error / 2 warning,
  önceden var olan ve bu görevde dokunulmayan dosyalarda, değişmedi), gerçek
  PostgreSQL ile **domain 759 + contracts 324 + database 74 + UI 374
  (+6 skip) + API 489 (+1 yeni) + file-agent 78**, build/bundle (417.259
  bayt, değişmedi), `npm audit` (moderate) 0 açık geçti.
- Kapsam dışı: PERT'in kapanış saga'sına bağlanması (HB-2026-027'de zaten
  belgelenmiş bilinen sınır), Kasko Değer Kaybı kapanış entegrasyonu
  (HB-2026-046'da ayrı açık kapsam), "Salt Okunur" etiket düzeltmesi
  (yukarıda not edildi).

## Ayarlar uçtan uca UAT doğrulaması (2026-07-27)

- **Kapsam:** Ayarlar sayfasının kabul edildiği andan bu yana ilk kez, tema/
  kullanıcı tercihleri/kalıcılık/oturum yenileme/tenant izolasyonu zinciri
  doğrulandı.
- **ÖNEMLİ BULGU (kusur değil, belgelenmiş kapsam):** Ayarlar sayfası
  HİÇBİR sunucu çağrısı yapmaz — tema, tablo yoğunluğu, sol menü, varsayılan
  açılış sayfası ve mock çalışma klasörü yalnız tarayıcı `localStorage`'ında
  saklanır (HB-2026-013, Paket 08: "Kabul edilmiş UI davranışı ve Ayarlar
  ekranı değiştirilmez"). Bu yüzden "oturum yenileme" ve "tenant izolasyonu"
  bu modül için yalnız route-koruması seviyesinde anlamlıdır; Ayarlar'ın
  kendisinin izole edilecek organizasyon-kapsamlı verisi yoktur.
- **Kapatılan gerçek boşluk:** `SettingsPage`'in HİÇ kendi test dosyası
  yoktu (yalnız üst düzey navigasyon/başlık smoke kontrolü ve header'daki
  PAYLAŞILAN tema/yoğunluk düğmeleri test ediliyordu — sayfanın KENDİ radyo
  düğmeleri, açılış sayfası seçimi, mock klasör değiştirme ve sıfırlama
  denetimleri hiç dokunulmamıştı). Ayrıca `/ayarlar` rotasının diğer tüm
  korumalı rotalarla AYNI oturum kapısından geçtiği ve girişten sonra
  organizasyon kapsamlı HİÇBİR ek istek yapmadan (tek istek: oturum
  bootstrap) açıldığı hiç doğrudan kanıtlanmamıştı.
- **Doğrulanan gerçek zincir:** gerçek `usePersistentState` kancasıyla (App.tsx
  üretimde kullandığı AYNI kanca) tema/yoğunluk/menü radyo düğmeleri →
  gerçek `localStorage` anahtarlarına (`hasarbotu-theme`, `hasarbotu-density`,
  `hasarbotu-sidebar-collapsed`) kalıcı yazdı; sayfa yenilemesi (yeniden
  mount) önceden yazılmış tüm beş anahtarı (yukarıdakiler + `hasarbotu-
  default-page`, `hasarbotu-mock-folder`) doğru hidratladı; açılış sayfası
  seçimi ve mock klasör değiştirme kalıcı yazdı ve bildirim gösterdi;
  "Varsayılanlara Dön" tüm beş anahtarı gerçek mock varsayılanlarına
  sıfırladı. Route-koruması: `/ayarlar`'a kimliksiz erişim login ekranının
  arkasında kaldı; girişten sonra `/ayarlar` yalnız TEK istek (oturum
  bootstrap) yaptı, organizasyon kapsamlı hiçbir veri isteği göndermedi.
  Gerçek Chrome ile `router-v8-browser-smoke.mjs` (korumalı derin bağlantı,
  8 rotalık nav taraması dahil `/ayarlar`, header tema düğmesiyle gerçek
  koyu tema geçişi, `location.reload()` rota korunumu, sıfır konsol hatası)
  yeniden çalıştırılıp doğrulandı.
- **Sonuç: gerçek üretim kusuru bulunmadı.** Üretim kodunda değişiklik
  yapılmadı; yalnız eksik test kapsamı kapatıldı.
- **Dikkat çekilecek (düzeltilmedi, kapsam dışı):** "Sistem Durumu" paneli
  (`SettingsPage.tsx`) tamamen statik metindir — `Backend: Eklenmedi`,
  `AI Servisi: Mock karar desteği` gibi ifadeler `getConfiguredDataSource()`
  hiç kontrol edilmeden HER ZAMAN gösterilir. Paket 08'den bu yana onlarca
  gerçek backend paketi eklendiği için bu metin `api` modunda artık YANLIŞ
  bilgi verebilir. Bu, HB-2026-013'te Ayarlar ekranının kasıtlı olarak
  değiştirilmediği erken bir karardan kalma ve gerçek bir düzeltmesi (hangi
  sağlık sinyalinin gösterileceği kararı) tek bir UAT görevinin kapsamını
  aşan yeni bir ürün kararı gerektirir; bu görevde DEĞİŞTİRİLMEDİ.
- Kalıcı kanıt olarak `src/features/settings/SettingsPage.test.tsx` (yeni,
  6 test) eklendi ve `src/app/appGate.test.tsx`'e 2 yeni test eklendi. Ana
  ağaçta typecheck, lint (0 error / 2 warning, önceden var olan ve bu
  görevde dokunulmayan dosyalarda, değişmedi), gerçek PostgreSQL ile
  **domain 759 + contracts 324 + database 74 + UI 374 (+8 yeni, +6 skip) +
  API 488 + file-agent 78**, gerçek Chrome ile `router-v8-browser-smoke.mjs`
  tüm kontroller true, build/bundle (417.259 bayt, değişmedi), `npm audit`
  (moderate) 0 açık geçti.
- Kapsam dışı: sunucu tarafı kullanıcı tercihi kalıcılığı (hiçbir zaman
  planlanmadı), "Sistem Durumu" panelinin gerçek sağlık sinyaline bağlanması
  (yukarıda not edildi, yeni ürün kararı gerektirir).

## Yönetim uçtan uca UAT doğrulaması (2026-07-27)

- **Kapsam:** Paket 18/47'nin kabul edildiği andan bu yana ilk kez, gerçek
  kullanıcı/rol/eksper referansları → yetki değişikliği → tenant izolasyonu
  → oturum yenileme zinciri **sentetik SQL ile onaylı sürüm enjekte etmeden**
  doğrulandı.
- **ÖNEMLİ BULGU (kusur değil, belgelenmiş kapsam boşluğu):** "Yönetim"
  sayfası bugün GERÇEK bir yönetim konsolu DEĞİLDİR. Kullanıcılar/Servisler
  sekmeleri yalnız salt-okunur referans listeleridir (`GET /references/*`);
  "Erişim ve Yetki" sekmesi tamamen statik metindir. Hiçbir kullanıcı
  oluşturma, rol atama veya servis/eksper referans CRUD ucu YOKTUR — bu,
  HB-2026-053/Paket 47'de tekrarlanan biçimde KASITLI olarak kapsam dışı
  bırakılmıştır ("Yeni tablo, migration, endpoint veya sözleşme eklenmez").
  Bu görev kapsamında yeni bir rol atama API'si veya UI'ı EKLENMEDİ — bu,
  tek bir UAT görevinin kapsamını aşan yeni bir paket gerektirir.
- **Doğrulanan gerçek zincir:** "yetki değişikliği" bugün var olan TEK
  mekanizmayla — `user_roles`/`users.status` doğrudan mutasyonu (gelecekteki
  bir rol atama API'sinin sonunda kendisi de yapacağı persistence adımı) —
  sürüldü ve asıl kritik üretim davranışı kanıtlandı: `auth/store.ts`
  `findActiveSession()` rolleri HER İSTEKTE canlı JOIN ile çözer, oturum
  satırında rol önbelleği YOKTUR. Zaten açık bir oturum (probeCookie), HİÇ
  yeniden giriş yapılmadan: (1) `read_only`→`expert` yükseltmesini bir
  SONRAKİ istekte anında yansıttı (`GET /auth/session` rolleri güncellendi,
  `POST /cases` 403'ten 201'e döndü, kullanıcı `/references/experts`
  listesinde GERÇEKTEN belirdi); (2) `expert`→`read_only` geri almasını da
  aynı anında yansıttı (yazma tekrar 403, eksper listesinden kayboldu); (3)
  en sert değişiklik olan hesap devre dışı bırakmada (`users.status=
  'disabled'`) AYNI çerez bir sonraki istekte 401 aldı ve kullanıcı
  `/references/users` listesinden tamamen kayboldu. Org A'daki tüm bu
  mutasyonlar boyunca org B'nin kendi oturumu/rolü/eksper görünürlüğü
  değişmeden kaldı (tenant izolasyonu).
- **Sonuç: gerçek üretim kusuru bulunmadı** — canlı rol çözümlemesi hem
  yükseltmede hem geri almada hem devre dışı bırakmada doğru ve anında
  çalışıyor; bu iyi bir mimari özellik olup daha önce hiçbir testte
  kanıtlanmamıştı. Üretim kodunda değişiklik yapılmadı.
- Kalıcı kanıt olarak `services/api/test/management-uat-e2e.test.ts`
  eklendi (gerçek `hasarbotu_test` PostgreSQL, sentetik anonim veriyle;
  mevcut `references.test.ts`'in zaten kapsamlıca kanıtladığı referans
  uçlarının 401/tenant/aktif-filtre davranışı TEKRARLANMADI). Ana ağaçta
  typecheck, lint (0 error / 2 warning, önceden var olan ve bu görevde
  dokunulmayan dosyalarda, değişmedi), gerçek PostgreSQL ile **domain 759 +
  contracts 324 + database 74 + UI 366 (+6 skip) + API 488 (+1 yeni) +
  file-agent 78**, build/bundle (417.259 bayt, değişmedi), `npm audit`
  (moderate) 0 açık geçti.
- Kapsam dışı: gerçek kullanıcı oluşturma/rol atama API'si ve UI'ı, servis/
  eksper referans CRUD, "Erişim ve Yetki" sekmesinin gerçek bir izin
  editörüne dönüştürülmesi — hepsi HB-2026-053'te zaten kasıtlı olarak
  sonraki pakete ertelenmiş; bu UAT bunları YENİDEN AÇMADI, yalnız mevcut
  davranışı belgeledi ve doğruladı.

## Bildirimler uçtan uca UAT doğrulaması (2026-07-27)

- **Kapsam:** Paket 49/51/52'nin (2026-07-18) kabul edildiği andan bu yana
  ilk kez, gerçek uyarı üretimi → bildirim listesi → okunma/durum değişimi →
  ilgili dosyaya navigasyon → tenant ve yetki izolasyonu zincirinin TAMAMI
  **sentetik SQL ile onaylı sürüm enjekte etmeden, uyarıları gerçek `POST
  /cases` + gerçek `POST /cases/:caseId/tasks` command API'leriyle üreterek**
  doğrulandı (yalnız hazır evrak satırları, PERT/İşçilik/Kasko UAT'larında
  ayrıca kanıtlı File Agent doğrulama döngüsünü tekrarlamamak için SQL ile
  hazır kabul edildi — mevcut `operational-alerts.test.ts`'in kendisi de aynı
  şekilde yapıyor). Mevcut üçlü paket (`operational-alerts.test.ts` +
  `operational-alerts-case-filter.test.ts` + `operational-alerts-scaling.test.ts`,
  925+ satır) türetme mantığını, kural motoru detaylarını, 200 sınırını ve
  N+1 korumasını zaten kapsamlıca kanıtlıyordu ama yalnız `case_manager`
  rolüyle çalışıyordu ve `caseDetailPath`'i yalnız düzenli ifadeyle
  doğruluyordu.
- **ÖNEMLİ BULGU (kusur değil, doğrulanmış kasıtlı tasarım):** Bildirimler
  kalıcı bir gelen kutusu DEĞİLDİR (HB-2026-055, 2026-07-18). Her `GET
  /api/v1/operational-alerts` çağrısında görev/takip/evrak verisinden
  deterministik olarak türetilir; ne bildirim tablosu, ne arka plan işçisi,
  ne okundu/durum alanı, ne de yazma ucu vardır. Kullanıcının istediği
  "okunma/durum değişimi" adımı bu sistemde GERÇEKTEN yoktur — bu test o
  yokluğu doğrudan kanıtlar: ham JSON yanıtı `isRead`/`status`/`id` alanı
  taşımaz, tekrarlanan çağrı bayt-bayt aynı sonucu döner ve audit kaydı
  yazmaz, `PATCH /operational-alerts` denemesi 404 döner (yazma ucu hiç
  kayıtlı değil). Ayrıca uçta kasıtlı olarak rol kısıtı yoktur (`auth/
  guard.ts`: "ilk aşamada tüm aktif kullanıcılar tam yetkilidir") — bu,
  gerçek altı rolle (admin/expert/case_manager/secretary/accounting/
  read_only) tek tek kanıtlandı, hepsi 200 alıp yalnız kendi organizasyonunu
  görüyor.
- **Doğrulanan gerçek zincir:** gerçek `POST /cases` (geçmiş takip tarihi) →
  gerçek `POST /cases/:caseId/tasks` (geçmiş bitiş tarihi) → eksik zorunlu
  evrak → `GET /operational-alerts` GERÇEK overdue_task/overdue_follow_up/
  missing_required_document uyarıları üretti (özet, önem derecesi,
  kaynak tarihi, `caseDetailPath` tam eşleşti) → liste seviyesinde tenant
  izolasyonu iki ayrı organizasyonla kanıtlandı → "ilgili dosyaya navigasyon"
  `caseDetailPath` yalnız biçim değil GERÇEK `GET /cases/:caseId` çağrısıyla
  çözülüp plaka/ofis no eşleşmesi doğrulandı (çapraz-org navigasyon denemesi
  gerçekten 404 aldı) → altı rolün tümü kendi organizasyonunu okuyabildi,
  oturumsuz erişim 401 aldı.
- **Sonuç: gerçek üretim kusuru bulunmadı.** Üretim kodunda değişiklik
  yapılmadı.
- Kalıcı kanıt olarak `services/api/test/notifications-uat-e2e.test.ts`
  eklendi (gerçek `hasarbotu_test` PostgreSQL, sentetik anonim veriyle). Ana
  ağaçta typecheck, lint (0 error / 2 warning, önceden var olan ve bu
  görevde dokunulmayan dosyalarda, değişmedi), gerçek PostgreSQL ile
  **domain 759 + contracts 324 + database 74 + UI 366 (+6 skip) + API 487
  (+1 yeni) + file-agent 78**, build/bundle (417.259 bayt, değişmedi),
  `npm audit` (moderate) 0 açık geçti.
- Kapsam dışı: kalıcı bildirim tablosu/kuyruk/worker, okundu/ertelendi/silindi
  kullanıcı durumu, kaynak-bazlı ince taneli permission matrisi (HB-2026-055
  ve HB-2026-011'de zaten sonraki pakete ertelenmiş).

## Dosyalar ve Dosya Detayı uçtan uca UAT doğrulaması — GERÇEK KUSUR BULUNDU VE DÜZELTİLDİ (2026-07-27)

- **Kapsam:** Paket 09'un (Cases yazma uçları) kabul edildiği andan bu yana
  ilk kez, gerçek case oluşturma → listeleme/arama/filtreleme → detay açma →
  sekmeler → yenileme → geri/ileri navigasyon → yetki ve tenant izolasyonu
  zincirinin TAMAMI **sentetik SQL ile onaylı sürüm enjekte etmeden**
  doğrulandı. Mevcut `cases-read.test.ts` (925 satırlık üçlü paketin bir
  parçası) filtre/arama/sıralama/sayfalamayı ve TEK case'in detay ucunda
  tenant izolasyonunu zaten kapsamlıca kanıtlıyordu ama yalnız TEK
  organizasyon fikstürüyle çalışıyordu — LİSTE/ARAMA seviyesinde iki gerçek
  organizasyon arasında hiç doğrudan izolasyon kanıtı yoktu. Ayrıca
  `router-v8-browser-smoke.mjs` (gerçek Chrome/CDP + gerçek Vite + gerçek API
  + gerçek `_test` PostgreSQL) detay/sekme/yenileme/geri-ileri navigasyon
  zincirini zaten kapsıyordu ama bu oturumda hiç ÇALIŞTIRILMAMIŞTI.
- **GERÇEK ÜRETİM KUSURU BULUNDU VE DÜZELTİLDİ:** `POST /api/v1/cases` ve
  `PATCH /api/v1/cases/:caseId` (`services/api/src/cases/write-routes.ts`)
  yalnız `requireSession` kullanıyordu — `requireAnyRole` YOKTU. Sonuç:
  `read_only` rolündeki bir kullanıcı bile yeni dosya oluşturabiliyor ve
  mevcut dosyayı düzenleyebiliyordu. Bu, sistemdeki her diğer modülün
  (İşçilik, PERT, E-posta, Değer Kaybı, Kapanma Ücreti, Poliçe Analizi) kendi
  WRITE_ROLES sınırıyla tutarlı deseninin aksine bir istisnaydı. Yazma
  rolü kapsamı belgelerde açıkça tanımlı olmadığından (HB-2026-011 yalnız
  "ilk aşamada herkes tam yetkili" temelini belirtir, dosya oluşturmaya özgü
  rol kısıtı belirtmez) kullanıcıya soruldu; kullanıcı **"read_only hariç
  herkes yazabilsin"** seçeneğini onayladı. `WRITE_ROLES =
  ['admin','expert','case_manager','secretary','accounting']` olarak
  düzeltildi (İşçilik/PERT ile birebir aynı desen). Kusur önce testi
  kırarak (`git stash` ile düzeltmeyi geçici kaldırıp gerçek PostgreSQL'de
  yeniden çalıştırıp `expected 201 to be 403` hatasıyla doğrulanıp) kanıtlandı;
  düzeltme geri getirilip yeniden yeşile dönüldü. Yan etki: mevcut
  `cases-write.test.ts`'in birincil aktörünün hiç rolü yoktu (önceki
  rolsüz-serbest davranışa dayanıyordu); yeni RBAC kapısı altında
  yeşil kalması için `case_manager` rolü eklendi.
- **Doğrulanan gerçek zincir:** gerçek `POST /cases` (iki ayrı organizasyonda,
  kasıtlı örtüşen aranabilir metinle) → liste/arama/filtre ORG A ve ORG B
  görünümlerinde ayrı ayrı doğrulandı (çapraz org hiç sızmadı) → detay açma
  çapraz-org 404 → RBAC: `read_only` create/update 403 (ve 403'ün GERÇEKTEN
  hiçbir kalıcı etki bırakmadığı DB seviyesinde doğrulandı) ama read 200 →
  daha önce hiç doğrulanmamış `secretary`/`accounting` yazma rolleri gerçek
  201/200 ile kanıtlandı → yenileme (`PATCH` sonrası yeniden `GET` ile hem
  detay hem liste güncel `stage`/`version` gösteriyor) → audit zinciri
  (`case.created`, `case.updated`) eksiksiz, çapraz-org id veya PII sızıntısı
  yok. Ayrıca `router-v8-browser-smoke.mjs` GERÇEKTEN çalıştırıldı: korumalı
  derin bağlantı → giriş → 8 ana nav rotası → case detayı + 8 sekme →
  arama query-string korunumu → `history.back()/forward()` → `location.reload()`
  rota+query korunumu → bilinmeyen rota placeholder → çıkış sonrası korumalı
  rota engeli → 2 ekran/tema kombinasyonu → sıfır konsol hatası — TÜMÜ geçti.
- Kalıcı kanıt olarak `services/api/test/cases-navigation-uat-e2e.test.ts`
  eklendi (gerçek `hasarbotu_test` PostgreSQL, sentetik anonim veriyle).
  Ana ağaçta typecheck, lint (0 error / 2 warning, önceden var olan ve bu
  görevde dokunulmayan dosyalarda, değişmedi), gerçek PostgreSQL ile
  **domain 759 + contracts 324 + database 74 + UI 366 (+6 skip) + API 486
  (+1 yeni) + file-agent 78**, `router-v8-browser-smoke.mjs` (gerçek Chrome),
  build/bundle (417.259 bayt, değişmedi), `npm audit` (moderate) 0 açık
  geçti.
- Kapsam dışı: yeni migration, yeni UI komponenti, dosya kapatma/yeniden açma
  akışı (ayrı paket), kaynak-bazlı ince taneli permission matrisi (yalnız
  case create/update rol kapısı kapsamda).

## Kasko poliçe analizi uçtan uca UAT doğrulaması (2026-07-27)

- **Kapsam:** Paket 23/26/27'nin (2026-07-14/15) kabul edildiği andan bu
  yana ilk kez, gerçek anonim bir Kasko dosyasında poliçe analizi
  zincirinin TAMAMI (poliçe kaynağı → OCR/metin → AI analizi → kullanıcı
  onayı → immutable geçmiş) **tek case üzerinde, sentetik SQL ile onaylı
  sürüm enjekte etmeden -- yalnız Paket 24/25'in kendi ayrı kanıtlanmış
  pdfjs/tesseract hattının hazır çıktısı kabul edilerek -- yalnız gerçek
  command API'leriyle** sürüldü. Mevcut `policy-ai.test.ts` AI adayı
  üretip promote ediyordu ama taslağı HİÇ onaylamıyordu
  (`humanApprovalStatus: pending` üzerinde duruyordu); mevcut
  `policy-analysis.test.ts` yalnız MANUEL/sentetik import edilmiş bir
  analizi onaylıyordu, AI candidate/promotion zincirinden hiç geçmemiş
  veriyle. Bu senaryo ikisini birleştirdi.
- **Gerçek zincirde ölçülen, önceden belgelenmemiş ama KASITLI/doğru üç
  davranış** (üçü de dikkatlice izlenip doğrulandı, kusur değil):
  1. AI-promote edilmiş taslak `sourceCompleteness:'partial'` ile geldi
     çünkü adaylardan biri (`deductible.conditional`) AI'nin KENDİ kanıt
     kalitesi belirsiz kaldığı için kullanıcı "kabul" etse bile evidence
     durumu `validated` sayılmadı. `POST .../approve` ucu
     `source_completeness≠'complete'` iken KESİN OLARAK reddediyor —
     İşçilik UAT'ındaki HB-2026-086 madde 3 ile aynı ilke: kullanıcının
     "kabul ettim" demesi belirsiz kanıtı geriye dönük güçlendirmiyor.
  2. Bu yüzden gerçek ürün akışı, kullanıcının (eksper) eksik/belirsiz
     alanları GERÇEKTEN tamamlayıp yeni bir manuel sürüm girmesini
     gerektiriyor (`POST .../versions`, `sourceCompleteness:'complete'`
     açıkça beyan edilerek) — bu sürüm ONAYLANABİLİYOR ve GERÇEKTEN canlı
     senaryo değerlendirmesinde (`POST .../policy-scenarios/evaluate`,
     sonuç `covered`) kullanılabiliyor.
  3. Hiç onaylanmamış 1. (AI-promote, partial) sürüm yeni sürümle
     değiştirildiğinde `superseded` OLMUYOR — `conflict_detected`
     durumunda donuk kalıyor; `superseded` yalnız DAHA ÖNCE onaylanmış bir
     sürüm değiştiğinde kullanılıyor. DB immutability guard'ı da yalnız
     `approved`/`superseded` sürümleri koruyor (`policy_analysis_versions_
     approved_guard`); hiç onaylanmamış taslak sürüm teknik olarak hâlâ
     düzenlenebilir kalıyor (append-only garantisi yalnız GERÇEKTEN
     onaylanmış kayıtlar için başlıyor).
- **Sonuç: gerçek üretim kusuru bulunmadı.** Yukarıdaki üçü de kodun
  gerçek davranışını doğru okumamaktan kaynaklanan yanlış varsayımlardı;
  kaynak trigger/store mantığı okunduktan sonra üçü de kasıtlı ve tutarlı
  çıktı. Üretim kodunda değişiklik yapılmadı.
- **Doğrulanan gerçek zincir:** gerçek `POST /cases` (Kasko) → poliçe
  kaynağı (ready belge) → OCR/metin (Paket 24 PDF metin + Paket 25 yerel
  OCR, ikisi de ready) → gerçek plan (provider çağırmaz) → gerçek start
  (deterministik sağlayıcı, 5 aday + 1 çelişki) → kullanıcı incelemesi:
  biri GERÇEKTEN düzenlendi (AI önerisinden farklı koşul eklendi), biri
  önce reddedilip sonra kabul edildi, biri önce kontrol-gerekli işaretlenip
  sonra kabul edildi → promotion-preview → gerçek promotion (Paket 23
  taslak sürüm 1, `pending/partial/conflict_detected`) → eksper GERÇEKTEN
  tamamlanmış bir 2. sürüm girdi (`complete/awaiting_approval`) → eksper
  GERÇEKTEN onayladı (`approved/isActive:true`) → onaylı analiz GERÇEKTEN
  canlı senaryo değerlendirmesinde kullanıldı (`covered`, gerçek kaynak
  referansıyla) → bağımsız yeniden okuma + DB seviyesinde append-only/
  immutable garantiler (AI facts, review geçmişi, onaylı sürüm) GERÇEKTEN
  zorlanarak doğrulandı.
- Audit zinciri (`case.created` → `policy_ai_extraction.planned/started/
  review_required` → `policy_ai_candidate.promoted` → `policy_analysis.
  approved`) tam ve ham poliçe metni/PII/mutlak yol sızıntısı yok
  doğrulandı.
- Kalıcı kanıt olarak `services/api/test/policy-ai-uat-e2e.test.ts`
  eklendi (gerçek `hasarbotu_test` PostgreSQL, sentetik anonim veriyle;
  belge/fotoğraf `ready` doğrulaması SQL ile hazır kabul edildi -- gerçek
  File Agent doğrulama döngüsü PERT/İşçilik UAT'larında zaten ayrıca
  kanıtlandı). Ana ağaçta typecheck, lint (0 error / 2 warning,
  değişmedi), gerçek PostgreSQL ile **domain 759 + contracts 324 +
  database 74 + UI 366 (+6 skip) + API 485 (+1 yeni) + file-agent 78**,
  build/bundle (417.259 bayt, değişmedi), `npm audit` (moderate) 0 açık
  geçti.
- Kapsam dışı: yeni migration, yeni endpoint, UI değişikliği, yeni
  dependency, üretim veri/migration çalıştırma, gerçek OpenAI/Gemini
  sağlayıcı çağrısı (deterministik sağlayıcı kullanıldı; dış sağlayıcı
  PII-minimize zinciri `policy-ai.test.ts`'te zaten ayrıca kanıtlı).

## E-posta hazırlama uçtan uca UAT doğrulaması — GERÇEK KUSUR BULUNDU VE DÜZELTİLDİ (2026-07-27)

- **Kapsam:** Paket 41/42'nin (2026-07-16) kabul edildiği andan bu yana ilk
  kez, gerçek anonim bir Trafik dosyasında E-posta hazırlama zincirinin
  TAMAMI (kanıtlar → AI taslak önerisi → kullanıcı düzenlemesi/onayı →
  Gmail taslağı/eşleştirme → dosya geçmişi) **tek case üzerinde, sentetik
  SQL ile onaylı sürüm enjekte etmeden, yalnız gerçek command API'leriyle**
  sürüldü. Mevcut `email-drafts.test.ts` (Paket 41) hiç AI önerisi
  kullanmadan taslak oluşturuyordu; `email-ai.test.ts` (Paket 42) AI
  önerisini taslağa kaydettikten sonra hiç düzeltmiyor ve Gmail handoff'a
  hiç götürmüyordu. Bu senaryo üçünü tek taslağın immutable sürüm+handoff
  geçmişinde birleştirdi.
- **GERÇEK ÜRETİM KUSURU BULUNDU VE DÜZELTİLDİ:** paylaşılan PII redaksiyon
  motorunda (`packages/domain/src/policy-ai-privacy.ts`, labor-ai,
  labor-allocation-ai, email-ai ve policy-ai tarafından ORTAK kullanılır)
  "sigortalı" sonrası çıplak (iki noktasız) ad-soyad kuralı TÜM örüntüde
  case-insensitive'di. Bu, sistemin KENDİ sabit evrak gereksinimi
  etiketlerinden biri olan **"Sigortalı trafik poliçesi"** metnini (gerçek
  bir ad değil, `EMAIL_REQUIREMENT_LABELS`'taki sabit Türkçe etiket) yanlış
  şekilde bir özel ad sanıp `[PII:NAME_1]` ile redakte ediyordu. Somut etki:
  E-posta AI önerisi, deterministik sağlayıcı şablon gövdesini olduğu gibi
  geri döndürdüğünde, çıktı-güvenliği doğrulaması (`validateEmailAiSuggestion`)
  KENDİ redaksiyon motorunun ürettiği bu placeholder'ı YENİDEN tarayıp
  `AI_OUTPUT_PII_UNSAFE` ile fail-closed yapıyordu — yani dosyada Trafik
  sigortalı poliçesi eksik olan (çok yaygın gerçek bir senaryo) HER
  `missing_document_request` AI önerisi kesin olarak başarısız oluyordu.
  Kusur önce testi kırarak (`git stash` ile düzeltmeyi geçici kaldırıp,
  gerçek PostgreSQL'de yeniden çalıştırıp) doğrulandı; düzeltme geri
  getirilip yeniden yeşile dönüldü.
- **Düzeltme:** Kuraldaki DEĞER kısmı (yakalanan "ad" metni) artık BİLİNÇLİ
  olarak case-sensitive'dir — yalnız tetikleyici anahtar kelime
  (`sigortalı`/varyantları) `(?i:...)` satır-içi değiştiriciyle
  case-insensitive kalır (Node 24 / modern V8 regex modifier grubu desteği
  doğrulandı). Büyük harfle başlayan kelime dizisi gerçek özel ad imzasıdır;
  küçük harfli ortak isim tamlaması ("trafik poliçesi", "ehliyet" vb.)
  artık yanlışlıkla yakalanmaz. Diğer 'name' kuralı (iki noktalı biçim,
  `Sigortalı: Ayşe Yılmaz`) DEĞİŞMEDİ — o kural zaten iki nokta işaretiyle
  yeterince güçlü bir sinyale sahip. Mevcut tek PII testi
  (`packages/domain/test/policy-ai.test.ts`, gerçek "Ayşe Yılmaz" adıyla)
  etkilenmedi çünkü Title Case bir isim kullanıyor.
- **Bilinçli, belgelenmiş ödünleşim:** Bu satır-içi kuralla artık YALNIZ
  Title Case (`Sigortalı Ahmet Yılmaz`) veya karışık büyük/küçük yakalanır;
  TAMAMEN BÜYÜK HARFLİ bir ad (`SİGORTALI AHMET YILMAZ`) artık bu ÇIPLAK
  kuralla eşleşmez (iki noktalı kural hâlâ her durumda çalışır). Gerçek iş
  metinlerinde büyük harfli özel adlar Title Case yazılır; bu ödünleşim
  kabul edilebilir ve şu anki tek somut kusuru (kendi şablon etiketini
  ad sanma) doğrudan kapatır.
- **Doğrulanan gerçek zincir:** gerçek `POST /cases` → ready/doğrulanmış
  belge+fotoğraf (kanıtlar; File Agent doğrulama döngüsü PERT/İşçilik
  UAT'larında ayrıca kanıtlandı) → gerçek AI plan+start (deterministik yerel
  sağlayıcı, artık başarıyla `review_required`) → kullanıcının AI önerisini
  GERÇEKTEN değiştirip (gövdeye ek not ekleyip) kanıtları ekleyerek açık
  onayla taslağı kaydetmesi (`sourceType: ai_assisted`) → ikinci bir açık
  onayla alıcı/gövdeyi tekrar düzeltmesi (immutable 2. sürüm,
  `manual_revision`) → Gmail handoff hazırlığı (`not_sent`, compose GÜNCEL
  içerik+ekle eşleşiyor) → bağımsız `GET` ile TAM dosya geçmişi (2 sürüm +
  1 handoff, v1'in AI-assisted ilk gövdesi sessizce değişmemiş) yeniden
  okundu. Audit zinciri tam ve gövde/alıcı/dosya adı sızıntısı yok.
- Kalıcı kanıt olarak `services/api/test/email-draft-uat-e2e.test.ts`
  eklendi (gerçek `hasarbotu_test` PostgreSQL, sentetik anonim veriyle).
  Ana ağaçta typecheck, lint (0 error / 2 warning, değişmedi), gerçek
  PostgreSQL ile **domain 759 + contracts 324 + database 74 + UI 366
  (+6 skip) + API 484 (+1 yeni) + file-agent 78** (paylaşılan PII motorunu
  kullanan policy-ai/labor-ai/labor-allocation-ai/email-ai testlerinin
  TAMAMI dahil, regresyon yok), build/bundle (417.259 bayt, değişmedi),
  `npm audit` (moderate) 0 açık geçti.
- Kapsam dışı: yeni migration, yeni endpoint, UI değişikliği, yeni
  dependency, üretim veri/migration çalıştırma, Gmail OAuth/gerçek gönderim.

## Kapanış ve Ücret uçtan uca UAT doğrulaması — GERÇEK KUSUR BULUNDU VE DÜZELTİLDİ (2026-07-27)

- **Kapsam:** Paket 39/21'in (2026-07-14/16) kabul edildiği andan bu yana ilk
  kez, gerçek anonim bir Kasko dosyasında Kapanış+Ücret zincirinin TAMAMI
  (kapanış → nihai rapor ücret çıkarımı → kullanıcı onayı → aylık rapora
  yansıma → yeniden açma) **tek case üzerinde, sentetik SQL ile onaylı sürüm
  enjekte etmeden, yalnız gerçek command API'leriyle** sürüldü. Kasko
  seçildi çünkü Trafik değer kaybı kapanış gereksinimi Kasko'da otomatik
  `not_applicable` olur (HB-2026-046); bu, zaten ayrı kanıtlanmış
  (`traffic-value-loss-closure-e2e.test.ts`) bir alt-zinciri tekrarlamadan
  Kapanış+Ücret'e odaklanmayı sağladı.
- **GERÇEK ÜRETİM KUSURU BULUNDU VE DÜZELTİLDİ:** `GET /api/v1/reports/
  case-summary` sorgusunda `approved_fee_count` / `approved_fee_total_minor`
  / `control_required_fee_count` sayaçlarında `c.lifecycle_status='closed'`
  filtresi EKSİKTİ — aynı sorgudaki `closedCaseWithoutFeeCount` ve tüm değer
  kaybı sayaçlarında bu filtre vardı, yalnız ücret sayaçlarında yoktu. Somut
  etki: bir dosya kapatılıp ücreti onaylandıktan SONRA yeniden açılınca,
  case satırı o ayki `scopedSql` penceresini "open + bu ay oluşturuldu"
  dalından hâlâ karşıladığı için `closedCaseCount` doğru şekilde 0'a
  düşerken `approvedFeeCount`/`approvedFeeTotalMinor` YANLIŞLIKLA eski
  değerinde (1 / 485.000 TL) kalmaya devam ediyordu — aynı ay için "0
  kapanan dosya" ile "485.000 TL onaylı ücret" birlikte görünen, muhasebe
  açısından yanıltıcı iç tutarsız bir rapor üretiyordu. Kusur önce testi
  kırarak (`git stash` ile düzeltmeyi geçici kaldırıp) doğrulandı, düzeltme
  geri getirilip yeniden yeşile dönüldü.
- **Düzeltme:** `services/api/src/fees/store.ts` — üç sayaca da diğer
  sayaçlarla aynı `c.lifecycle_status='closed'` koşulu eklendi. Mevcut
  `closure-fees-reports.test.ts` (5/5) etkilenmedi çünkü o testteki her
  ücretli case zaten `closed` durumda kalıyor; bu, düzeltmenin yalnız
  reopen-sonrası durumu hedeflediğini doğrular.
- **Doğrulanan gerçek zincir:** gerçek `POST /cases` (Kasko) → gerçek plan
  → onay → gerçek File Agent `runOnce` taşımasıyla kapanış (`closed_at`
  set edildi) → nihai rapor ücret çıkarımı (verified `expert_report`
  belgesine referansla aday: 4.850 TL) → aday onaydan önce aylık toplamda
  YOK (`control_required`) → gerçek `accounting` rollü kullanıcı onayı →
  append-only 2. sürüm (`approved`) → aylık rapor artık onaylı tutarı
  taşıyor → gerçek yeniden açma planı/onayı/File Agent taşıması → `closed_at`
  SIFIRLANMADI (append-only, en son kapanış zamanını korur) → ücret KAYDI
  bozulmadan `approved` kalmaya devam ediyor (bağımsız `GET` ile doğrulandı)
  → düzeltme sonrası aylık rapor artık dosyayı DOĞRU şekilde "kapanan
  dosya" ve "onaylı ücret" toplamlarının İKİSİNDEN de düşürüyor.
- Audit zinciri (`case.created` → `case_lifecycle.close_planned/approved/
  closed` → `closure_fee.candidate_created/approved` →
  `case_lifecycle.reopen_planned/approved/reopened`) tam ve ham gerekçe/
  mutlak yol sızıntısı yok doğrulandı.
- Kalıcı kanıt olarak `services/api/test/closure-fee-uat-e2e.test.ts`
  eklendi (gerçek `hasarbotu_test` PostgreSQL + gerçek File Agent Agent API
  client/`runOnce`/yerel filesystem taşıması, sentetik anonim veriyle). Ana
  ağaçta typecheck, lint (0 error / 2 warning, değişmedi), gerçek PostgreSQL
  ile **domain 759 + contracts 324 + database 74 + UI 366 (+6 skip) + API
  483 (+1 yeni) + file-agent 78**, build/bundle (417.259 bayt, değişmedi —
  yalnız `services/api/src/fees/store.ts` SQL metni değişti, kod boyutu
  frontend bundle'ı etkilemez), `npm audit` (moderate) 0 açık geçti.
- Kapsam dışı: yeni migration, yeni endpoint, UI değişikliği, yeni
  dependency, üretim veri/migration çalıştırma. Belge/fotoğraf `ready`
  doğrulaması bu turda SQL ile hazır kabul edildi (gerçek File Agent
  `runOnce` doğrulama döngüsü PERT ve İşçilik UAT'larında zaten ayrıca
  kanıtlandı); rücu durumu ve fiziksel konum ataması ayrı test edilen
  modüllerdir.

## PERT uçtan uca UAT doğrulaması (2026-07-27)

- **Kapsam:** Paket 45'in (2026-07-18, HB-2026-051) kabul edildiği andan bu
  yana ilk kez, gerçek anonim bir Trafik dosyasında PERT/Ağır Hasar
  zincirinin TAMAMI (rayiç + hasar bedeli girişi → fotoğraf/kanıt →
  eksper kanaati → merkez kararı → nihai PERT sonucu) **tek case üzerinde,
  sentetik SQL ile onaylı sürüm enjekte etmeden, yalnız gerçek command
  API'leriyle** sürüldü. Mevcut `pert.test.ts` bu geçişleri yalnız ayrı
  senaryolarda (her `it` kendi kısa sürüm zincirini kuruyordu) doğruluyordu
  ve kanıt/fotoğraf hiç işin içinde değildi.
- **Doğrulanan gerçek zincir:** gerçek `POST /cases` ile case → gerçek
  belge/fotoğraf kaydı (`sbm_heavy_damage_result` + hasar fotoğrafı) →
  **gerçek File Agent `runOnce`** ile disk üzerinde hash/boyut doğrulaması
  (`pending → ready`, bağımsız `GET` ile yeniden okundu) → PERT
  değerlendirmesi `data_missing` (kanıt var, rayiç/hasar bedeli henüz yok)
  → **rayiç (850.000 TL) + hasar bedeli (720.000 TL) girilince** sunucuda
  türetilen oran doğru hesaplandı (**%85**, istemci hesaplamaz/göndermez)
  ve durum `pert_candidate`'a geçti → gerçek **eksper** kullanıcısı kanaatini
  (`pert` + zorunlu gerekçe) kaydetti (`expert_opinion_issued`) →
  `center_decision_pending` → gerçek **admin** (merkez) kullanıcısı kararı
  kesinleştirdi: **nihai PERT sonucu `pert_decided`**, beş immutable/
  append-only sürüm olarak. Bağımsız bir `GET workspace` isteğiyle tam
  sürüm geçmişi yeniden okunup hiçbir eski sürümün (v1'in null rayiç/hasar
  değerleri dahil) sonradan değişmediği doğrulandı.
- **Sonuç: gerçek üretim kusuru bulunmadı.** Zincirin tamamı belgelenen
  tasarıma (HB-2026-051) göre çalıştı; üretim kodunda değişiklik
  yapılmadı. Audit zincirinde (`case.created` → `document.registered` →
  `photo.registered` → 2× `job.verified` → `pert_assessment.created` →
  4× `pert_assessment.revised`) yapısal not/gerekçe/merkez notu serbest
  metninin HİÇ audit'e kopyalanmadığı doğrudan doğrulandı (yalnız durum/
  kanaat/karar kodları ve türetilmiş oran).
- **Ölçülen bilinen sınır:** PERT değerlendirmesinin case-lifecycle kapanış
  gereksinimleriyle (Değer Kaybı'nın aksine) hiçbir entegrasyonu yok —
  case-lifecycle store'da PERT'e referans bulunamadı. Bu bir gerileme
  değil, Paket 45'in belgelenen kapsamının (yalnız kullanıcı kontrollü
  değerlendirme çekirdeği) doğrudan sonucu; kapanış entegrasyonu hiç
  planlanmamıştı.
- Kalıcı kanıt olarak `services/api/test/pert-uat-e2e.test.ts` eklendi
  (gerçek `hasarbotu_test` PostgreSQL + gerçek File Agent Agent API
  client/`runOnce`/yerel filesystem doğrulaması, sentetik anonim veriyle).
  Ana ağaçta typecheck, lint (0 error / 2 warning, değişmedi), gerçek
  PostgreSQL ile **domain 759 + contracts 324 + database 74 + UI 366
  (+6 skip) + API 482 (+1 yeni) + file-agent 78**, build/bundle (417.259
  bayt, değişmedi), `npm audit` (moderate) 0 açık geçti.
- Kapsam dışı: yeni migration, yeni endpoint, UI değişikliği, yeni
  dependency, üretim veri/migration çalıştırma, PERT'in case-lifecycle
  kapanışına bağlanması (mevcut tasarımda yok; ayrı ürün kararı gerektirir).

## İşçilik uçtan uca UAT doğrulaması (2026-07-27)

- **Kapsam:** Paket 58/64/65A/65B'nin kabul edildiği andan bu yana ilk kez,
  gerçek anonim bir Trafik dosyasında İşçilik zincirinin TAMAMI (AI öneri →
  kullanıcı düzeltmesi → onay → File Agent güvenli fiziksel yazım → yeniden
  okuma → audit) **tek case üzerinde, sentetik SQL ile onaylı sürüm enjekte
  etmeden, yalnız gerçek command API'leriyle** sürüldü. Mevcut testler bu
  adımları ayrı ayrı doğruluyordu (Paket 58: öneri/düzeltme provenance'ı;
  Paket 65B: preview→approve→yazım) ama HİÇBİRİ gerçek File Agent `runOnce`
  döngüsünü (`@hasarbotu/file-agent`) İşçilik workbook job'ları için
  çalıştırmıyordu — workspace, file_operation, PDF/policy OCR ve Değer Kaybı
  kapanış taşıması gibi diğer bütün job türleri için bu döngü zaten gerçek
  testlerde kullanılıyordu. Bu tur o boşluğu kapattı.
- **Doğrulanan gerçek zincir:** gerçek `POST /cases` ile case oluşturma →
  iki kalemli İşçilik föyü → gerçek AI analizi (deterministik sağlayıcı,
  kasıtlı düşük güvenle `controlRequired: true` üretir) → onay: 1. kalemde
  hem tutar hem kategori dağılımı, 2. kalemde YALNIZ kategori dağılımı
  kullanıcı tarafından AI önerisinden gerçekten farklı biçimde düzeltildi
  (ikisi de doğrudan karşılaştırmayla kanıtlandı: `suggestedLaborAmountMinor`
  ≠ `appliedLaborAmountMinor`, `proposed_category_amounts` ≠
  `applied_category_amounts`) → Excel profili → preview isteği → **gerçek
  Agent kayıt/claim/`runOnce`** ile preview job'ı işlendi → plan AI'nin
  önerdiği değeri değil kullanıcının onayladığı nihai değeri taşıdığı
  doğrulandı → açık onay → **gerçek `runOnce`** ile apply job'ı işlendi
  (backup + atomik yazım + ikinci preflight) → workbook diskten BAĞIMSIZ
  yeniden okundu: D hücrelerinde AI önerisi (10000.00) DEĞİL kullanıcının
  düzelttiği tutarlar (9000.00 / 2000.00) yazılı, H–N sütunları ve
  `docProps/core.xml` byte-birebir korunmuş, backup kaynakla byte-eş → audit
  zinciri `case.created`'dan `labor_workbook.apply_completed`'a kadar tam,
  mutlak yol/hücre değeri/ham açıklama sızıntısı yok.
- **Sonuç: gerçek üretim kusuru bulunmadı.** Zincirin tamamı belgelenen
  tasarıma (HB-2026-072/078/080/085/086) göre çalıştı; üretim kodunda
  değişiklik yapılmadı. Ayrıca deterministik AI harness'inin kasıtlı düşük
  güveni nedeniyle "hiç dokunmadan onayla" yolunun fiziksel yazıma
  ULAŞAMADIĞI (control_required temizlenmeden job üretilmediği) gözlemlendi
  — bu bir gerileme değil, HB-2026-086 madde 3'ün tam olarak amaçladığı
  fail-closed davranıştır.
- Kalıcı kanıt olarak `services/api/test/labor-workbook-uat-e2e.test.ts`
  eklendi (gerçek `hasarbotu_test` PostgreSQL + gerçek File Agent Agent
  API client/`runOnce`/yerel filesystem yazımı, sentetik anonim veriyle).
  Ana ağaçta typecheck, lint (0 error / 2 warning, değişmedi), gerçek
  PostgreSQL/OCR ile **domain 759 + contracts 324 + database 74 + UI 366
  (+6 skip) + API 481 (+1 yeni) + file-agent 78**, build/bundle (417.259
  bayt, değişmedi), `npm audit` (moderate) 0 açık geçti.
- Kapsam dışı: yeni migration, yeni endpoint, UI değişikliği, yeni dependency,
  üretim veri/migration çalıştırma. Fiziksel konum ataması (Paket 12) bu
  turda da -- Değer Kaybı UAT'ındaki gibi -- ayrı test edilen bir modül
  olarak ön koşul (`verified` case_location) kabul edildi, gerçek `PUT
  .../location` akışıyla yeniden sürülmedi.

## Değer Kaybı uçtan uca UAT doğrulaması (2026-07-27)

- **Kapsam:** Paket 32/33/34/40'ın kabul edildiği andan bu yana ilk kez, gerçek
  anonim bir Trafik dosyasında hesaplama → revizyon → onay → nihai rapor →
  Paket 40 kapanış zincirinin TAMAMI **tek case üzerinde, yalnız gerçek command
  API'leriyle** (sentetik SQL ile onaylı sürüm enjekte etmeden) sürüldü.
  Mevcut testler bu adımları ayrı ayrı doğruluyordu; bu tur, revizyonun eski
  nihai raporu geçersiz kıldığını ve yeni raporun kapanış hazırlığını yeniden
  `present` yaptığını tek akışta kanıtlayan bir boşluğu kapattı.
- **Doğrulanan gerçek zincir:** case_manager taslak (v1, brüt 120.000 TL,
  kusur uygulanmış 120.000 TL) → submit → expert onayı → v1 nihai raporu →
  kapanış önizlemesi `present` → revizyon (v2, ek emsallerle onarım sonrası
  değer düşürüldü, kusur uygulanmış 160.000 TL) → v1 hâlâ aktif/onaylı kalır
  (append-only) → v2 submit + onay → **v1 otomatik `superseded` olur** →
  kapanış önizlemesi revizyondan sonra doğru şekilde `control_required`'a
  düşer (eski rapor artık güncel sürüme ait değil) → v2 nihai raporu (PDF
  `%PDF-1.4`, byte-size doğrulandı) → kapanış önizlemesi yeniden `present` →
  gerçek File Agent taşımasıyla case kapanışı tamamlanır → Paket 40 kapanış
  özeti listesi ve aylık dönem raporu yeniden hesaplama yapmadan doğru
  onaylı+raporlu tutarı (160.000 TL) yansıtır.
- **Sonuç: gerçek üretim kusuru bulunmadı.** Zincirin tamamı belgelenen
  tasarıma göre çalıştı; üretim kodunda değişiklik yapılmadı.
- Kalıcı kanıt olarak `services/api/test/traffic-value-loss-closure-e2e.test.ts`
  eklendi (gerçek `hasarbotu_test` PostgreSQL + gerçek File Agent/yerel
  filesystem taşıması, sentetik anonim veriyle). Ana ağaçta typecheck, lint
  (0 error / 2 warning, değişmedi), gerçek PostgreSQL/OCR ile **domain 759 +
  contracts 324 + database 74 + UI 366 (+6 skip) + API 480 (+1 yeni) +
  file-agent 78**, build/bundle (417.259 bayt, değişmedi), `npm audit`
  (moderate) 0 açık geçti.
- Kapsam dışı: yeni migration, yeni endpoint, UI değişikliği, yeni dependency,
  üretim veri/migration çalıştırma. UI render yüzeyi (Dosya Detayı Değer
  Kaybı sekmesi, Kapanan Dosyalar, Raporlar) bu turda ayrıca Chrome ile
  yeniden gezilmedi; bu yüzeyler Paket 33/34/40 kabulünde gerçek Chrome/CDP
  smoke ile zaten doğrulanmıştı ve bu turda kod değişmedi.

## Dosya Envanteri — Migration 0042 paketi uçtan uca tamamlama (2026-07-27)

- **Kapsam kararı (kullanıcı onaylı):** 16 sütunun 12'si mevcut tablolardan
  (cases/insurers/users/service_centers) türetildi. Üç alanın kaynağı
  hiçbir tabloda yoktu: `expertReportNumber` ve `serviceCity` dürüstlükle
  daima "Eksik" kalır (tahmin edilmedi, yeni tablo eklenmedi); araç sahibi
  ad/telefonu için ise kullanıcıya soruldu ve **yeni minimal capture**
  onaylandı (owner verisi PII-gated, gerçek export sütununu anlamlı kılıyor).
- **Migration 0042** (`case_vehicle_owner_sets` + `case_vehicle_owners`):
  tam sürüm zinciri yok — liste tek seferde değiştirilir, append-only
  (eski `set_version` satırları asla silinmez/güncellenmez, guard trigger
  zorlar), `case_vehicle_owner_sets.current_set_version` optimistic
  locking işaretçisidir. Telefon DAİMA text (regex `^[0-9()+. -]+$`);
  baştaki sıfır korunur. Gerçek PostgreSQL'de forward/rollback/reapply ve
  tenant/format/append-only kısıt testi geçti.
- **API:**
  - `GET/PUT /api/v1/cases/:caseId/vehicle-owners` — WRITE_ROLES
    admin/expert/case_manager (vehicle-profile ile aynı), sekreterlik salt
    okunur; optimistic `expectedSetVersion` kilidi.
  - `GET /api/v1/case-inventory` — yalnız SAYIM döner (PII taşımaz), her
    oturum için `includesPhones` rol bazlı hesaplanır.
  - `GET /api/v1/case-inventory/export` — gerçek `.xlsx` üretir ve indirir;
    `includePhones=false` ise telefon hücreleri HİÇ üretilmez (gizlemek
    değil, üretilmemek). Her export `case_inventory.exported` audit
    kaydı bırakır (satır sayısı/rol/filtre; PII yok).
  - Sıfırdan minimal OOXML `.xlsx` yazıcı (`fflate`, zaten Paket 65A/65B'de
    kullanılan kütüphane — yeni paket değil, mevcut kullanım genişletildi).
    Beş parçalık standart yapı, `inlineStr` hücreler (paylaşılan string
    tablosu yok). Gerçek API testinde üretilen dosya `unzipSync` ile geri
    açılıp içerik ve PII-gating doğrulandı.
- **UI:** `CaseVehicleOwnersModule` (Dosya Detayı > Özet, araç profilinin
  altında) — liste görünümü + düzenle/kaydet formu, üst sınır 6 sahip.
  `CaseInventoryExportPanel` (Raporlar ve Ücretler, API modunda) — filtre
  + gerçek zamanlı sayım önizleme + "Excel İndir". Mock moddaki eski sahte
  "Excel Taslağı" butonu değişmedi (ayrı kod yolu, API modunda gösterilmez).
- **Doğrulama:** typecheck, lint (0 error / 2 warning, değişmedi), gerçek
  `hasarbotu_test` PostgreSQL ile **2.080 başarılı / 6 ortam-koşullu UI
  skip** (2.055’ten +25: domain +10, database +1, API +5, UI +9),
  build/bundle **417.187 bayt** (bütçe 500.000, +4.544 bayt), `npm audit`
  (production + moderate) 0 bulgu. Gerçek Chrome/CDP smoke: API login,
  gerçek case oluşturma, araç sahibi ekleme/kaydetme (PostgreSQL round-trip
  doğrulandı), Raporlar ve Ücretler'de Dosya Envanteri paneli, gerçek
  export isteği (200, konsol temiz). Kalıcı `hasarbotu` dev DB'sine
  manuel uygulanan migration + smoke verisi doğrulanıp temizlendi (guard
  trigger'lar tekrar etkin, sıfır kalıntı).
- **Bilinen sınır:** `serviceCity`/`expertReportNumber` hâlâ kaynaksız;
  gelecekte gerçek bir kaynak (yeni alan/entegrasyon) onaylanırsa ayrı
  karar gerekir. Envanter export satır sınırı 5.000 (`CASE_INVENTORY_MAX_ROWS`).

## Modül seviyesi `set-state-in-effect` temizliği — 4. dilim (2026-07-25)

- 14 uyarı dört mantıksal grupta, dört ayrı commit ile ele alındı. Toplu
  refactor yapılmadı; her modül ayrı incelendi ve ayrı test edildi.
- **Kuralın gerçek kapsamı ölçüldü:** `react-hooks/set-state-in-effect`,
  efektten doğrudan çağrılan bir fonksiyonun içindeki `setState`'leri de —
  `await` konumundan bağımsız olarak — ihlal sayıyor. Bu yüzden
  `useEffect(() => { void load() })` deseni yalnız `setStatus('loading')`
  kaldırılarak çözülmüyor; ilk okumanın efekt içine alınması ve durumun yalnız
  async geri çağrılarda yazılması gerekiyor.
- **1. grup (`2593b3b`)** — güvenli `load()` modülleri:
  `CaseVehicleProfileModule`, `LaborExcelProfilesModule`,
  `WorkspaceProvisioningPanel`. Üçünde de ilk okuma efekt içine alındı ve
  **`cancelled` muhafazası eklendi** (önceden yoktu; case değişiminde uçuştaki
  yanıt yeni case'in verisini ezebiliyordu).
- **2. grup (`6165f36`)** — fail-closed onay ve seçim sıfırlamaları:
  `PolicyAiCandidatesModule` (4), `CaseDetailPage`, `EmailDraftApiModule`,
  `TrafficValueLossReportPanel`. Onay bayrakları artık kimlik değiştiğinde
  **aynı render'da** düşüyor; önceden sıfırlama efekte bağlı olduğu için bir
  frame boyunca bayat onay görünebiliyordu.
  - **Gerçek kusur bulundu ve düzeltildi:** ilk denemede kaynak seçimi mutabakat
    kuralı her render'da uygulanıyordu; bu, kullanıcının son kaynağı
    kaldırmasını geri alıyor ve plan butonunu yanlışlıkla etkin bırakıyordu.
    Hedefli test yakaladı. Kural artık yalnız kaynak listesi kimliği
    değiştiğinde uygulanıyor.
- **3. grup (`3097664`)** — `LaborAllocationAiModule` ilk okuması; Paket 62 koşu
  seçim kuralı ve iptal davranışı korunarak efekt içine alındı.
- **4. grup (`236161f`)** — `CasesPage` arama kutusu URL senkronu; girdi
  navigasyon kimliğiyle tutulup render'da türetiliyor.
- **Kural `error` seviyesine çıkarıldı (`eslint.config.js`).** 14 React Compiler
  kuralının tamamı artık upstream `recommended` seviyesinde; hiçbiri global
  olarak override edilmiyor.
- **Kalan 2 kanıtlı istisna** (dosya kapsamlı, `warn`; kodda `eslint-disable`
  YOK):
  - `src/features/cases/LaborAllocationAiModule.tsx` — geçen süre sayacı.
    `Date.now()` render'a taşınırsa `react-hooks/purity` ihlal edilir; ilk ölçüm
    efektte yazılmazsa sayaç bir saniye boyunca yanlış değer gösterir.
  - `src/features/cases/CasesPage.tsx` — fetch sonrası sayfa kelepçelemesi.
    `totalPages` ancak yanıt geldikten sonra bilinir; render'da türetmek istenen
    sayfayı kalıcı düzeltmediği için toplam sayfa sayısı yeniden büyüdüğünde
    kullanıcıyı beklenmedik bir sayfaya sıçratırdı.
- Doğrulama: typecheck, lint (**0 error / 2 warning**), gerçek PostgreSQL 17.10
  ile **2.050 başarılı / 6 ortam-koşullu UI skip**, build/bundle 412.643 bayt
  (bütçe 500.000), `npm audit` 0 bulgu. Gerçek Chrome/CDP: Paket 66 smoke 12/12
  ve React Router smoke 13/13, iki çözünürlük ve iki temada, console error yok.
- **4. dilim kapanışı — doğrudan regresyon testi eklendi (2026-07-26):** 2.
  grubun bulduğu kaynak-seçimi kusuru (bkz. yukarı) o sırada hedefli bir testle
  yakalanmıştı, ancak kalıcı test dosyasına ayrı bir vaka olarak girmemişti.
  `PolicyAiCandidatesModule.test.tsx`'e >=2 kaynaklı, sıfıra indirilen seçimin
  kimlik-korumalı bir yeniden yüklemede (`Kaynakları Yenile`) mutabakatla geri
  dönmediğini doğrudan doğrulayan bir vaka eklendi. Testin gerçekten kusuru
  yakaladığı, düzeltmeyi (`ApiPanel` içindeki kimlik kısayolu) geçici olarak
  devre dışı bırakıp testin kırıldığı, sonra düzeltmeyi aynen geri getirip
  (component dosyasında net diff yok) yeniden yeşile döndüğü doğrulandı.
  Ana ağaçta typecheck, lint (**0 error / 2 warning**, değişmedi), gerçek
  `hasarbotu_test` PostgreSQL ile **2.051 başarılı / 6 ortam-koşullu UI skip**
  (+1 yeni test, mevcut hiçbir test bozulmadı), build/bundle **412.643 bayt**
  (değişmedi, yalnız test dosyası eklendi), `npm audit` 0 bulgu geçti.
- **4. dilim — kalan iki seçim/fail-closed türetmesi için doğrudan regresyon
  testi (2026-07-27):** 2. grubun geri kalan iki türetmesi için de kalıcı
  vaka eklendi; üretim kodu **değişmedi** (önce her ikisi için de gerçek bir
  kusur aranıp bulunamadı, sonra test eklendi — bkz. HB-2026-098/099).
  - `EmailDraftApiModule`: `explicitDraftId !== '' ? explicitDraftId :
    drafts[0].id` türetmesi için 2 taslaklı bir workspace'te açık seçimin,
    seçimle İLGİSİZ bir mutasyonun (Gmail handoff) tetiklediği `reload()`
    sonrası aynı iki taslak taze nesnelerle gelse bile ilk taslağa
    dönmediğini doğrudan doğrulayan vaka eklendi.
  - `CaseDetailPage`: `override.key === \`${caseId}#${baseItem.version}\`
    ? override.value : null` türetmesi için, düzenleme ile uygulanan yerel
    override'ın "Tek Dosyayı Yenile" sunucudan farklı bir sürüm getirdiğinde
    (4 → 6) mutabakatla eski override'a değil taze sunucu verisine
    döndüğünü tam sayfa (`MemoryRouter`) üzerinden doğrulayan vaka eklendi.
  - Her iki vakanın da gerçekten kusur yakaladığı ayrı ayrı kanıtlandı:
    ilgili türetme satırı geçici olarak bozuldu (EmailDraftApiModule'de
    her zaman ilk taslağa sabitlendi; CaseDetailPage'de `overrideKey`
    sürümü düşürüldü), yeni testler kırıldı, sonra satırlar aynen geri
    getirilip (her iki component dosyasında da net diff yok) yeniden
    yeşile dönüldü.
  - Ana ağaçta typecheck, lint (**0 error / 2 warning**, değişmedi), gerçek
    `hasarbotu_test` PostgreSQL ile **2.053 başarılı / 6 ortam-koşullu UI
    skip** (+2 yeni test), build/bundle **412.643 bayt** (değişmedi),
    `npm audit` 0 bulgu geçti.
- **4. dilim kapanışı — son türetme: `TrafficValueLossReportPanel`
  (2026-07-27):** 2. grubun son "anahtarlı not/onay/mesaj" türetmesi için de
  kalıcı vaka eklendi; önce gerçek kusur arandı (`ReportFormState` ile
  aynı yapı, ancak PolicyAiCandidatesModule'daki fallback-mutabakat mantığı
  yoktur), **bulunamadı** — üretim kodu değişmedi (bkz. HB-2026-100). Bu
  bileşenin daha önce hiç test dosyası yoktu; yeni
  `TrafficValueLossReportPanel.test.tsx` sıfırdan eklendi:
  - Sürüm değişince not/onay/mesajın **aynı render'da** boşa döndüğünü
    doğrulayan vaka.
  - Sürüm aynı kalırken ilgisiz bir yeniden render'ın (yeni prop referansı,
    aynı `version.id`) girilen notu ve onay kutusunu SIFIRLAMADIĞINI
    doğrulayan vaka.
  - İki vakanın da gerçekten kusur yakaladığı ayrı ayrı kanıtlandı: önce
    anahtar kontrolü (`form.key === formKey`) devre dışı bırakıldı (1. vaka
    kırıldı), sonra `patchForm`'un `prev`'i koruma kontrolü devre dışı
    bırakıldı (her iki vaka da kırıldı — art arda `setNote`/`setConfirmed`
    çağrıları birbirini eziyordu), her ikisinde de satır aynen geri
    getirilip (component dosyasında net diff yok) yeniden yeşile dönüldü.
  - Böylece HB-2026-096'nın 2. grubundaki dört türetmenin (PolicyAiCandidatesModule ×2,
    EmailDraftApiModule, CaseDetailPage, TrafficValueLossReportPanel)
    TAMAMI artık kalıcı, doğrudan regresyon testine sahip.
  - Ana ağaçta typecheck, lint (**0 error / 2 warning**, değişmedi), gerçek
    `hasarbotu_test` PostgreSQL ile **2.055 başarılı / 6 ortam-koşullu UI
    skip** (+2 yeni test), build/bundle **412.643 bayt** (değişmedi),
    `npm audit` 0 bulgu geçti.

## `src/data` barrel bölünmesi (2026-07-25)

- **Kök neden.** `src/data/index.ts` bütün veri katmanını tek noktadan
  re-export ediyordu. Hem başlangıç grafiğindeki sayfalar (Durum Panosu,
  Dosyalar, Raporlar, Kapanan Dosyalar, Bildirimler, Yönetim, Mevzuat) hem de
  lazy `CaseDetailPage` alt ağacı bu barrel'den import ettiği için bundler
  birleşik bir **paylaşılan chunk** üretiyordu: 129.686 baytlık `data-*.js`
  başlangıç grafiğine giriyor ve yalnız lazy sayfalarda kullanılan hook'lar da
  oraya yazılıyordu.
- **Çözüm.** Barrel'den gelen **66 import ifadesi** 66 dosyada doğrudan dosya
  importuna çevrildi (`../../data` → `../../data/<modül>`). Sembol → modül
  eşlemesi barrel'in kendisinden üretildi; tip-only importlar `import type`
  olarak korundu. Referansı kalmayan `src/data/index.ts` silindi.
- İki test dosyasındaki `vi.mock('../../data', …)` çağrıları gerçek modüle
  (`../../data/useDashboard`) yönlendirildi; stub davranışı aynı kaldı.
- **Ölçüm.** Başlangıç grafiği 16 asset / 499.997 bayttan **2 asset / 412.566
  bayta** indi (`index-*.js` 403.109 + `jsx-runtime` 9.457). Paylaşılan
  `data-*.js` chunk'ı başlangıç grafiğinden tamamen kalktı.
- Lazy dağılım gerçekleşti: 28 lazy chunk / 648.512 bayt. Büyükler:
  `PolicyAnalysisWorkspace` 76.111, `TrafficValueLossApiModule` 66.249,
  `CaseDetailPage` 64.511, `LaborAllocationAiModule` 40.846,
  `EmailDraftApiModule` 28.463, `LaborApiModule` 25.209. Route seviyesi lazy
  modül sayısı 10'da sabit kaldı.
- Bütçe **yükseltilmedi** (500.000). Boşluk 3 bayttan **87.434 bayta** çıktı.
- Runtime davranışı, route yapısı, API sözleşmeleri ve hook imzaları değişmedi;
  yeni dependency eklenmedi. Circular dependency uyarısı oluşmadı.
- Doğrulama: typecheck, lint (0 error / 14 warning), gerçek PostgreSQL 17.10 ile
  **2.050 başarılı / 6 ortam-koşullu UI skip**, `npm audit` 0 bulgu. Gerçek
  Chrome/CDP: Paket 66 smoke 12/12 ve React Router smoke 13/13, iki çözünürlük
  ve iki temada, console error yok.

## Veri katmanı yükleme durumu türetmesi — 3. dilim (2026-07-25)

- Çok durumlu dört hook, dört ayrı atomik commit ile dönüştürüldü. Toplu
  değişiklik yapılmadı; her hook ayrı incelendi, ayrı doğrulandı.
- `usePolicyPdfText` (`581df32`): yalnız yükleme durumu `caseId#version`
  anahtarına bağlandı. Kaynak/extraction/sayfa dilimleri **kasıtlı olarak**
  anahtarlanmadı; orijinalde de yükleme süresince önceki değerlerini koruyorlar
  ve yarış koruması `cancelled` ile sağlanıyor.
- `useReportsFees` (`81602df`): dosya dört bağımsız hook içeriyor.
  `useCaseFee` → `caseId#revision`; `useCaseSummaryReport` →
  `period|responsibleUserId|serviceId#revision`. Liste hook'larının değişen
  anahtarı yok; devre dışı ve desteklenmeyen sonuçlar render sırasında
  türetiliyor. `useValueLossClosureList` port desteklemiyorsa fail-closed
  `unavailable` dönmeye devam ediyor.
- `usePolicyOcr` (`5457e08`): iki ayrı senkron sıfırlama vardı. Yükleme durumu
  `caseId#version`'a, PDF sayfa listesi seçili extraction id'sine bağlandı;
  önceki extraction'ın sayfaları artık hiçbir frame'de görünmüyor.
- `useTrafficValueLoss` (`933e1d6`): Paket 66 açısından en kritik olduğu için
  sona bırakıldı. Yükleme kapsamındaki **bütün** dilimler (assessment,
  versions, currentApproved, previewResult, catalog, status, errorMessage) tek
  anahtarlı nesnede taşınıyor; `load`, yükleme efekti, `command`, `preview` ve
  `loadCatalog` yazıcılarının hepsi anahtar korumalı. `command`'ın hata yolunda
  `validation` dışında status yazma davranışı aynen korundu.
- **Bundle bütçesi kapısı gerçekten kırıldı ve düzeltildi** (`4e2dd7d`).
  Eklenen anahtarlı state kodu başlangıç grafiğini 498.882 → 500.125 bayta
  çıkarıp 500.000 sınırını 125 bayt aştı. Bütçe **yükseltilmedi**; kodun runtime
  maliyeti düşürüldü (modül düzeyi fabrika/sabitler, tekrar eden anahtar
  korumalı kapanışların tek `patch` yardımcısında toplanması). Sonuç 499.997
  bayt.
- Doğrulama: typecheck, lint (0 error / 14 warning), gerçek PostgreSQL 17.10 ile
  **2.050 başarılı / 6 ortam-koşullu UI skip**, build/bundle (499.997 bayt, en
  büyük chunk 337.825 bayt, 10 lazy modül), `npm audit` 0 bulgu. Gerçek
  Chrome/CDP: Paket 66 değer kaybı smoke'u 12/12 ve React Router smoke'u 13/13,
  iki çözünürlük ve iki temada, console error yok.

## Veri katmanı yükleme durumu türetmesi — 2. dilim (2026-07-25)

- Dönüştürülen 4 hook (her biri ayrı incelendi, ayrı doğrulandı):
  `useOperationalAlerts`, `usePolicyAnalysis`, `usePolicyAi`,
  `useTrafficValueLossReports`. `src/data` uyarıları 12 → 8'e indi; kalan 8
  bulgu yalnız kapsam dışı bırakılan dört çok durumlu hook'a aittir.
- `useOperationalAlerts`: anahtar `caseIdKey#reloadToken`. Filtre istenip görünür
  satır olmadığında (`caseIdKey === ''`) çağrı yapılmadan `ok`/boş dönen
  fail-closed dal aynen korundu.
- `usePolicyAnalysis`: anahtar `caseId#requestVersion#refreshToken`. Senaryo
  değerlendirmesi de aynı anahtarı taşır. `evaluate()` hata yolunda `status`'ü
  dışarıdan yazdığı için anahtar korumalı fonksiyonel güncellemeye çevrildi;
  bayat bir değerlendirme daha yeni bir yüklemenin durumunu ezemez.
- `usePolicyAi`: anahtar `caseId#version`. `plan`, `start`, `review`, `promote`
  ve `fail` yazıcılarının **tamamı** anahtar korumalı hale getirildi. `plan` ve
  `start` iyimser sonucu hemen ardından gelen sürüm artışının anahtarına yazar;
  böylece Paket 23 akışındaki iyimser frame birebir korunur.
- `useTrafficValueLossReports`: anahtar `caseId#requestVersion`. Liste, rapor
  önizlemesi ve hata mesajı aynı anahtarlı nesnede taşınır; `load()`, `run()`,
  `clearPreview`, `previewReport` ve `generateReport` yazıcıları anahtar
  korumalıdır. Önizleme anahtar değişiminde kendiliğinden düşer.
- Bayat önizleme riski sunucuda kapalıdır: `report-store.ts:235` üretilen
  içeriğin hash'i `previewHash` ile uyuşmazsa `preview_mismatch` ile reddeder.
  Aynı şekilde Paket 23 promotion `review-store.ts:381`'de hash'e bağlıdır.
- `eslint-disable` veya kural istisnası eklenmedi; `eslint.config.js` bu dilimde
  hiç değişmedi. Kapsam dışı bırakılan `usePolicyOcr`, `useReportsFees`,
  `usePolicyPdfText`, `useTrafficValueLoss`, `LaborAllocationAiModule` ve
  `CasesPage` dosyalarına dokunulmadı.
- Doğrulama: typecheck, lint (0 error / 22 warning), gerçek PostgreSQL 17.10 ile
  **2.050 başarılı / 6 ortam-koşullu UI skip**, build/bundle (başlangıç 498.882
  bayt, en büyük chunk 337.825 bayt, 10 lazy modül), `npm audit` 0 bulgu.
  Gerçek Chrome/CDP: Paket 66 değer kaybı smoke'u 12/12 ve React Router smoke'u
  13/13, iki çözünürlük ve iki temada, console error yok.

## Veri katmanı yükleme durumu türetmesi — 1. dilim (2026-07-25)

- Uygulanan desen: yüklenen veri, ait olduğu **istek anahtarıyla birlikte** tek
  bir state nesnesinde taşınır. Anahtar değişince yükleme durumu **render
  sırasında türetilir**; efekt içinde senkron `setState` kalmaz.
- Bu yalnız lint uyarısını kaldırmaz, iki gerçek iyileştirme sağlar:
  - **Bayat veri frame'i ortadan kalkar.** Önceden anahtar değiştiğinde bir
    render eski veriyi yeni anahtarla gösteriyor, sıfırlama ancak efekt
    çalışınca geliyordu. Artık aynı render'da `loading` türetilir.
  - **Yarış durumuna karşı ikinci savunma.** Yanıt, kendi istek anahtarıyla
    yazılır; geç dönen bir önceki isteğin sonucu anahtarı tutmadığı için
    `cancelled` bayrağından bağımsız olarak yok sayılır.
- Dönüştürülen 7 hook: `useCase`, `useCaseDocuments`, `useCaseOperations`,
  `useEmailDrafts`, `useLabor`, `usePert`, `useCasePage`. Her biri ayrı
  incelendi, ayrı doğrulandı; toplu değiştirme yapılmadı.
- Davranış farkı (kasıtlı, belgelenmiş): sekme kapatılıp aynı case'e geri
  dönüldüğünde aynı anahtar için önceden yüklenmiş veri `loading` flash'ı
  olmadan görünür ve efekt yine de yeniden okur. Başka bir case'in verisi
  hiçbir koşulda gösterilmez.
- Doğrulama: typecheck, lint (0 error / 26 warning), gerçek PostgreSQL 17.10 ile
  **2.050 başarılı / 6 ortam-koşullu UI skip**, build/bundle (başlangıç 497.853
  bayt, en büyük chunk 337.825 bayt, 10 lazy modül), `npm audit` 0 bulgu.
  Gerçek Chrome/CDP: Paket 66 değer kaybı smoke'u 12/12 ve React Router
  smoke'u 13/13, iki çözünürlük ve iki temada, console error yok.
- **Kalan 26 bulgunun 2'si bu kuralla giderilemez** ve kalıcı istisnadır:
  `LaborAllocationAiModule` saat okuması (`Date.now()` render'a taşınırsa
  `react-hooks/purity` ihlal edilir) ve `CasesPage` fetch sonrası sayfa
  kelepçelemesi (`totalPages` ancak yanıt geldikten sonra bilinir). Bu nedenle
  `set-state-in-effect` kuralının `error` seviyesine çıkarılması, bu iki nokta
  için dosya bazlı istisna gerektirecektir.

## `dist` lint kapsamı temizliği (2026-07-25)

- Flat config'de global ignore deseni config dosyasının dizinine görecelidir.
  Yalın `dist` deseni **yalnız kök `dist/`** dizinini dışlıyordu (43 dosya);
  workspace `dist` klasörleri lint kapsamındaydı. Desen `**/dist/**` ve
  `**/coverage/**` olarak genişletildi.
- Kapsamdan çıkan 670 üretilmiş dosyanın dağılımı: `services/api/dist` 270,
  `packages/contracts/dist` 250, `packages/domain/dist` 100,
  `services/file-agent/dist` 36, `packages/database/dist` 14.
- **Kaynak lint kapsamı değişmedi.** Değişiklik öncesi ve sonrası lint edilen
  kaynak dosya listesi çıkarılıp karşılaştırıldı: her ikisi de **737 dosya** ve
  listeler **birebir aynı** (`diff` farksız).
- Bulgu sayısı da değişmedi: **0 error / 33 warning**. Bu, `dist` içinde saklı
  bir bulgu olmadığını ve hiçbir kuralın gevşetilmediğini kanıtlar. Kural
  seviyeleri bu pakette hiç değiştirilmedi.
- Lint süresi **14.373 ms → 11.257 ms** (yaklaşık %22 kısalma).
- Workspace düzeyinde `npm run lint` (`@hasarbotu/api`, `@hasarbotu/database`,
  `@hasarbotu/file-agent`) kök config'i çözmeye devam ediyor; üçü de exit 0.

## React Compiler kural adaptasyonu (2026-07-25)

- ESLint 10 paketinden devreden 34 uyarının **tamamı tek tek incelendi**. Toplu
  veya mekanik düzeltme yapılmadı; her hook'un veri akışı ayrı değerlendirildi.
- **Gerçek kusur (1 adet) düzeltildi:** `useTrafficValueLoss.preview`
  `useCallback`'i `assessment?.version` bağımlılığı bildiriyordu; React Compiler
  bunu `assessment` olarak çıkarımladığı için manuel memoization'ı koruyamıyor ve
  **bileşenin tamamını optimizasyon dışı bırakıyordu** ("Compilation Skipped").
  Sürüm çağrı öncesinde `assessmentVersion` primitifine indirgendi; çıkarımlanan
  ve bildirilen bağımlılık artık birebir eşleşiyor. Çağrıya giden değer aynı
  (`assessment?.version ?? 0`), davranış değişmedi.
- **Kural seviyeleri (aşamalı yükseltme).** 14 yeni Compiler kuralının **13'ü**
  artık override edilmiyor ve upstream `recommended` seviyesinde çalışıyor:
  11 kural `error` (`config`, `error-boundaries`, `gating`, `globals`,
  `immutability`, `preserve-manual-memoization`, `purity`, `refs`,
  `set-state-in-render`, `static-components`, `use-memo`), 2 kural
  (`incompatible-library`, `unsupported-syntax`) upstream'in kasıtlı tercihiyle
  `warn`. Bu 13 kuralda **ihlal yoktur**. Paket öncesi sözleşme korunuyor:
  `rules-of-hooks` error, `exhaustive-deps` warn.
- **`set-state-in-effect` `warn` kalıyor** ve kapatılmıyor. 33 bulgunun tamamı
  incelendi; hiçbiri davranışsal kusur değil:
  - **23 bulgu — async yükleme öncesi durum sıfırlama** (`src/data/*` hook'ları ve
    modül `load()` efektleri). Senkron sıfırlama kaldırılırsa yeni anahtar için
    ESKİ veri gösterilir; bu daha kötü bir kusurdur. Doğrulandı: bütün adapter
    kimlikleri `useMemo`/`useState` ile kararlı (**sonsuz yeniden istek yok**) ve
    her fetch `cancelled` muhafazası taşıyor (**yarış durumu yok**).
  - **5 bulgu — anahtar değişiminde fail-closed sıfırlama**: onay bayrakları,
    form durumu ve yerel override geçersizleştirme. Kasıtlı güvenlik davranışı.
    `approvedIdentity` ayrıca render sırasında kimlik karşılaştırmasıyla
    hesaplanıyor (`approved = approvalIdentity !== null && approvedIdentity ===
    approvalIdentity`), bu yüzden bayat onay frame'i **oluşmuyor**.
    `promotionApproved` ise sunucuda hash'e bağlı: `review-store.ts:381`
    `reviewSetHash` uyuşmazlığını reddediyor ve istemci idempotency kimliği aynı
    hash'i içeriyor — fail-closed.
  - **3 bulgu — seçim mutabakatı**: yeni gelen seçenek listesine karşı seçimi
    yakınsayan fonksiyonel güncelleme.
  - **2 bulgu — saat okuması ve fetch sonrası sayfa kelepçelemesi**.
    `Date.now()` render'a taşınamaz; taşınırsa `react-hooks/purity` ihlal edilir.
    Sayfa kelepçelemesi `totalPages`'i ancak fetch sonrası bilebilir ve yakınsar.
- Bu 33 bulgunun render sırasında türetilmesi veri katmanının state şeklinin
  yeniden kurulmasını gerektirir; kullanıcı kararıyla ayrı paket konusudur.
- Doğrulama: ana ağaçta ve repository dışı fresh `npm ci` kopyasında gerçek
  PostgreSQL 17.10 ile **2.050 başarılı / 6 mevcut ortam-koşullu UI skip**.
  Lint **0 error / 33 warning** (önce 0/34). Gerçek Chrome/CDP ile iki smoke
  geçti: Paket 66 değer kaybı zinciri (12 kontrol, değişen `preview` yolunu
  kapsar) ve React Router v8 smoke'u (13 kontrol). Build/bundle: başlangıç
  497.013 bayt, en büyük chunk 337.825 bayt, 10 lazy modül. `npm audit` 0 bulgu.

## ESLint 10 yükseltmesi (2026-07-25)

- Son 5 high bulgu (`eslint@9.39.4` → `minimatch@3.1.5` → `brace-expansion@1.1.16`
  ve bağlı `@eslint/config-array` / `@eslint/eslintrc` / `minimatch`) kapatıldı.
  `eslint@10.8.0` doğrudan `minimatch@^10.2.5`'e bağlıdır; ağaçta artık tek
  `minimatch@10.2.5` ve tek `brace-expansion@5.0.8` vardır. Vulnerable sürümler
  gerçekten kalktı; ignore veya audit seviyesi düşürme kullanılmadı.
- Sürüm değişiklikleri: `eslint` 9.39.4 → **10.8.0**, `@eslint/js` 9.39.4 →
  **10.0.1**, `eslint-plugin-react-hooks` 5.2.0 → **7.1.1**,
  `eslint-plugin-react-refresh` 0.4.26 → **0.5.3**. `typescript-eslint` 8.63.0
  değişmedi (peer'i zaten `^10.0.0` içeriyordu); `globals` da değişmedi.
  `eslint-plugin-react-hooks@7.1.1`, ESLint 10 peer'i taşıyan **ilk** sürümdür;
  6.x ve 7.0.0 taşımadığı için bu jump zorunludur.
- Flat config korundu; `.eslintrc` zaten kullanılmıyordu. `eslint-env` yorumu
  yoktur. Node koşulu (`^20.19.0 || ^22.13.0 || >=24`) mevcut `>=24 <25` engine
  ile uyumludur.
- **Lint kapsamı birebir aynıdır.** ESLint 9.39.4 (önceki commit) ve ESLint 10.8.0
  ölçüldü: her ikisinde de **1.407 dosya** lint edildi, aynı 670 workspace `dist`
  dosyası dahil, `node_modules` 0. ESLint 10'un config arama değişikliği tek kök
  `eslint.config.js` bulunduğu için kapsamı etkilemedi. Workspace düzeyinde
  `npm run lint --workspace @hasarbotu/api` kök config'i çözmeye devam ediyor.
- ESLint 10'un `eslint:recommended` setine eklediği üç kural **gerçek kusur
  buldu ve kod düzeltilerek giderildi** (kural devre dışı bırakılmadı):
  - `no-useless-assignment` ×2: `policy-ai/store.ts`'te ölü `-1` başlangıç
    ataması, `workspace/store.ts`'te hiç okunmayan `jobId` başlangıç ataması.
  - `preserve-caught-error` ×1: `pdf-text-extractor.test.ts` yakalanan hatayı
    `cause` olmadan yeniden fırlatıyordu.
- `eslint-plugin-react-hooks` v7'nin `recommended` seti v5'teki 2 kuraldan
  (`rules-of-hooks` error, `exhaustive-deps` warn) **16 kurala** çıkar; 14 yeni
  React Compiler kuralı gelir. Paket öncesi lint sözleşmesi birebir korundu:
  bu iki kural aynı seviyede duruyor. 14 yeni kural **kapatılmadı**, açıkça
  `warn` seviyesinde bırakıldı ve `eslint.config.js` içinde adlarıyla listelendi.
- Sonuç: `npm run lint` **0 error / 34 warning** ile geçiyor (önce 0/0). 34 uyarı
  yeni Compiler kurallarındandır: 33 × `set-state-in-effect`, 1 ×
  `preserve-manual-memoization`; 27 dosyada, ağırlıklı olarak `src/data` veri
  çekme hook'larında. Bunların `error` seviyesine çıkarılması veri katmanının
  yeniden yapılandırılmasını gerektirdiğinden ayrı "React Compiler kural
  adaptasyonu" paketidir.
- Ana ağaçta ve repository dışı fresh `npm ci` kopyasında gerçek PostgreSQL 17.10
  ile **2.050 başarılı / 6 mevcut ortam-koşullu UI skip** tekrarlandı: UI 352/6,
  domain 749, contracts 324, database 73, API 474, File Agent 78. Değişen iki API
  modülünün hedefli testi 25/25 geçti. Build/bundle değişmedi: başlangıç 497.015
  bayt, en büyük chunk 337.825 bayt, 10 lazy modül.
- `npm audit`: **0 bulgu (her seviyede)**. `--audit-level=high` exit 0.

## React Router v8 güvenlik geçişi (2026-07-25)

- Kalan üretim advisory'si (GHSA-qwww-vcr4-c8h2) **gerçek dependency
  değişikliğiyle** kapatıldı; ignore veya kabul edilmiş risk yolu kullanılmadı.
- `react-router-dom@^7.1.1` kaldırıldı, `react-router@^8.3.0` eklendi. Ağaçta
  tek kopya `react-router@8.3.0` vardır; `react-router-dom` hiçbir sürümde
  bulunmaz (`npm explain react-router-dom` → eşleşme yok).
- Kaynak değişikliği yalnız import belirtecidir: 22 dosyada
  `from 'react-router-dom'` → `from 'react-router'`. Dosya başına tek satır;
  toplam 23 dosya (22 kaynak + `package.json`), 23 ekleme / 23 silme.
- Kullanılan API yüzeyi v8'de aynıdır: `BrowserRouter`, `MemoryRouter`, `Routes`,
  `Route`, `NavLink`, `useNavigate`, `useLocation`, `useParams`,
  `useSearchParams`. `RouterProvider` (`react-router/dom`), data router, loader/
  action, `meta`/`useMatches` ve Framework-mode özellikleri kullanılmadığından v8
  breaking change'lerinin hiçbiri bu repository'yi etkilemez. RSC/SSR eklenmedi.
- Route yolları, URL sözleşmesi, catch-all davranışı ve dosya içi sekme yapısı
  değişmedi. Sekmeler zaten route değil bileşen durumudur; nested route/`Outlet`
  kullanılmıyor.
- Ana ağaçta ve repository dışı fresh `npm ci` kopyasında gerçek PostgreSQL 17.10
  ile **2.050 başarılı / 6 mevcut ortam-koşullu UI skip** tekrarlandı: UI 352/6,
  domain 749, contracts 324, database 73, API 474, File Agent 78. Paket 65B,
  Paket 66 ve Paket 40 sayıları değişmedi.
- Gerçek Chrome/CDP router smoke'u (`scripts/router-v8-browser-smoke.mjs`) gerçek
  API + gerçek PostgreSQL üzerinde geçti: oturumsuz derin link login'e düşer,
  8 ana route, NavLink active durumu, `/dosyalar/:caseId` route parametresi,
  8 dosya içi sekme, `?q=` query korunumu, tarayıcı geri/ileri, yenileme sonrası
  route korunumu, bilinmeyen route placeholder'ı ve logout sonrası korumalı route
  reddi doğrulandı. 1920×1080 açık ve 1366×768 koyu temada yatay taşma, boş ekran
  ve console error yoktu.
- Build/bundle bütçesi geçti. Başlangıç grafiği 498.632 → **497.015 bayt**
  (bütçe 500.000; headroom arttı), en büyük chunk 318.368 → **337.825 bayt**,
  10 lazy modül korundu.
- `npm audit --audit-level=high`: **5 high / 0 critical**. Kalan tek küme dev-only
  `eslint@9.39.4` → `minimatch@3.1.5` → `brace-expansion@1.1.16` zinciridir ve
  ayrı "eslint 10 yükseltmesi" paketine aittir. Yeni high/critical bulgu çıkmadı.
- Git: Yerel repository, `foundation/package-56-ai-evidence-enrichment` dalı, remote yok
- Baseline commit mesajı: `chore: freeze accepted UI prototype baseline`
- Baseline tag: `v0.1.0-ui-baseline`

## Dependency güvenlik bakımı (2026-07-25)

- Paket 65B'nin güvenlik kabulini bloke eden iki bulgu **kapandı**. Yalnız
  lockfile içi, semver aralığında patch yenilemesi yapıldı: `package.json`
  değişmedi, `overrides` eklenmedi, `npm audit fix` çalıştırılmadı ve yeni
  dependency alınmadı.
- Üretim zinciri: `fast-uri` 3.1.3 → **3.1.4** (3 konum) ve 4.1.0 → **4.1.1**
  (`fastify@5.10.0` → `@fastify/ajv-compiler`/`fast-json-stringify`/`ajv`);
  `find-my-way` 9.6.0 → **9.7.0** (`fastify@5.10.0`, aralık `^9.6.0`).
  Fastify `5.10.0` sabit kaldı; major yükseltme gerekmedi.
- Aynı yenilemede kapanan diğer bulgular: `postcss` 8.5.16 → **8.5.23**
  (`vite@8.1.4`, dev) ve `brace-expansion` 5.0.7 → **5.0.8** (üretimde
  `node-pg-migrate` → `glob` → `minimatch@10`, dev tarafta
  `@typescript-eslint/typescript-estree`). `nanoid` 3.3.15 → 3.3.16 aynı
  aralıkta yan güncellemedir.
- Dependency ağacında bu paketlerin vulnerable kopyası kalmadı; advisory
  bastırılmadı.
- Ana ağaçta ve repository dışı fresh `npm ci` kopyasında gerçek PostgreSQL 17.10
  ile **2.050 başarılı / 6 mevcut ortam-koşullu UI skip** tekrarlandı: UI 352/6,
  domain 749, contracts 324, database 73, API 474, File Agent 78. Paket 65B ve
  Paket 66 sayıları değişmedi.
- Typecheck, lint ve build iki ortamda da geçti. Bundle çıktısı bayt-özdeştir:
  başlangıç 498.632 bayt, en büyük chunk `index-DmSaOjdc.js` 318.368 bayt,
  10 lazy modül.
- `npm audit --audit-level=high` **hâlâ başarısızdır (7 high, 0 critical)**.
  Kalan iki küme yalnız semver-major yükseltmeyle çözülebildiği için otonom
  kapsam dışıdır; kullanıcı kararıyla (2026-07-25) her ikisi de ayrı pakete
  alınmıştır ve o paketler kapanana kadar açık bulgu sayılır:
  - `brace-expansion@1.1.16` ← `minimatch@3.1.5` ← `eslint@9.39.4`
    (`@eslint/config-array`, `@eslint/eslintrc` dahil 5 bulgu, yalnız dev).
    `minimatch@3` `^1.1.7` ister; advisory `<=5.0.7` olduğundan yamalı 1.x
    sürüm yayımlanmamıştır. npm'in bildirdiği düzeltme `eslint@10.8.0`
    (semver-major). 1.x CJS `main`, 5.x ise `exports` haritalı dual paket
    olduğundan override ile 5.0.8 zorlanması uyumsuz yerleştirme olurdu.
  - `react-router@7.18.1` ← `react-router-dom@7.18.1` (tam sürüm pin) ← kök
    `^7.1.1` (2 bulgu, üretim UI). Advisory aralığı `7.12.0 - 8.2.0`; yamalı tek
    sürüm **`react-router@8.3.0`** olup 7.x yaması ve `react-router-dom@8.x`
    yoktur. Çözüm `react-router-dom`'u bırakıp 22 kaynak dosyanın import'unu
    `react-router@8`'e taşımayı gerektirir. Kurulu `react@19.2.7`,
    `react-router@8.3.0` peer koşulunu (`>=19.2.7`) karşılar. Bulgu RSC modu
    kapsamlıdır; repository Vite SPA'sıdır, RSC ve react-router sunucu runtime'ı
    kullanmaz.

## Paket 65A — SALT-OKUNUR WORKBOOK PREFLIGHT TAMAMLANDI

- Daha önce eklenen saf ZIP/OOXML güvenlik ve immutable write-plan source
  guard'ı gerçek File Agent salt-okunur preflight yoluna bağlandı.
- Workbook yolu yalnız Agent'ın yerel root eşlemesinden ve güvenli göreli yoldan
  çözülür; mutlak root sonuçta, API'de veya audit'te taşınmaz.
- ZIP merkezi dizini arşiv açılmadan okunur. Entry count, compressed/
  uncompressed toplam, compression ratio, şifreleme, duplicate/zip-slip,
  makro/VBA, dijital imza, embedded object ve external relationship kapıları
  `unzipSync` öncesinde veya hemen sonrasında fail-closed çalışır.
- Hedef worksheet dosya adına göre tahmin edilmez; package/workbook
  relationship zincirinden çözülür. Gizli sheet ve içerik imzası uyuşmazlığı
  plan kaynağı üretmez.
- Kaynak iki kez okunup SHA-256/size karşılaştırılır; preflight dosyayı
  değiştirmez. Sentetik workbook testinde başlangıç/bitiş hash'i aynıdır.
- Gerçek kusur düzeltmesi: negatif/kesirli/sıfır-compressed ZIP metadata'sı
  artık geçerli kabul edilmez; part adı olmasa bile external relationship
  yakalanır.
- Ana ağaç ve repository-dışı fresh kopyada gerçek geçici PostgreSQL 17 ile
  **2.017 başarılı / 6 mevcut ortam-koşullu UI skip** geçti: UI 349/6,
  domain 738, contracts 321, database 72, API 473, File Agent 64. Typecheck,
  lint, build ve bundle kapısı iki ortamda da geçti; başlangıç grafiği 498.514
  bayt ve 10 lazy modüldür.
- Bu dilim migration, API/UI, job kuyruğu, fiziksel `.xlsx` yazımı, backup,
  replace veya production migration EKLEMEZ. Bunlar Paket 65B kapsamıdır.

## Paket 65B — GÜVENLİ FİZİKSEL YAZIM ÇEKİRDEĞİ TAMAMLANDI

- File Agent salt-okunur preview çağrısı yalnız doğrulanmış hedef worksheet
  üzerindeki `D` hücresi değişikliklerini eski/yeni değerle gösterir ve
  deterministik `labor-workbook-write-plan/2.0.0` hash'i üretir.
- Apply; aynı plan hash'ine bağlı açık kullanıcı onayı, yeniden 65A preflight,
  kaynak hash/boyut/mtime ve worksheet relationship/imza eşitliği olmadan
  hiçbir backup/temp/yazım yapmaz.
- Tek fiziksel yazım kapsamı `D2:D1048576`'dır. `H–N`, diğer sütunlar, imza ve
  formül hücreleri fail-closed reddedilir.
- Kaynak yanında zaman damgalı `.bak.xlsx`, aynı dizinde fsync edilmiş temp,
  OOXML part kapsam doğrulaması, ikinci preflight ve atomik replace zinciri
  kuruldu. Replace sonrası doğrulama veya audit hatasında backup'tan atomik
  rollback başlangıç byte'larını geri getirir.
- Aynı workbook için exclusive lock ikinci eşzamanlı yazımı engeller. Audit
  başlangıç/sonuç hash'i ve güvenli metadata taşır; hücre değeri, mutlak yol ve
  ham hata taşımaz.
- Sentetik testler; preview'in salt okunurluğu, D-only kapsam, yanlış plaka,
  makro/external relationship blokajı, açık onay, backup/temp/replace, `H–N`
  korunumu, hata rollback'i, audit rollback'i, lock ve stale kaynak durumlarını
  kapsar. Gerçek müşteri workbook'u veya gerçek `P:\` kullanılmadı.
- Kök typecheck, lint ve build/bundle geçti; başlangıç grafiği 498.514 bayt,
  en büyük chunk 318.291 bayt ve 10 lazy modül korundu. Varsayılan tam test
  zinciri 1.609 başarılı / 423 ortam-koşullu skip verdi; yeni 65B testleri 9/9,
  File Agent bütünü 73/73 ve skip yoktur. PostgreSQL/API testleri bu ortamda
  koşullu skip kaldığı için PASS sayılmadı.
- D hücre değer kaynağı/satır eşlemesi runtime entegrasyonunda tamamlandı:
  yalnız current, tamamlanmış uygulamanın approved/final değeri kullanılır;
  önerilen değer provenance'ta korunur ve exact source-row referansı dışında
  fuzzy eşleme yapılmaz.

## Paket 65B — ONAYLI RUNTIME ENTEGRASYONU TAMAMLANDI

- `labor_workbook_apply_operations` immutable request/snapshot, preview/approval,
  File Agent job/result ve başlangıç/sonuç hashlerini mevcut job queue/lease
  altyapısına bağlar. API fiziksel workbook yazmaz.
- Preview; current revision, writable profil, doğrulanmış case location,
  workbook/sheet identity, part code/source, operation type, kategori toplamı ve
  exact source-row referansını fail-closed doğrular. Belirsiz satır job üretmeden
  `control_required` olur.
- Kullanıcının açıkça düzelttiği nihai değer çözüm sinyalidir; AI proposed değer
  ve manuel değişiklik bilgisi korunur. Düzeltilmemiş eksik-evidence satırı
  fiziksel apply'a geçemez.
- UI, mevcut İşçilik çalışma alanında satır eski/yeni değeri, toplamlar,
  provenance, manuel değişiklik, conflict, açık onay, job durumu, backup ve
  güvenli hata sonucunu gösterir; API modunda mock fallback yoktur.
- Lock metadata job/agent/oluşturulma zamanı/başlangıç hash'i taşır. Süre geçti
  diye lock otomatik silinmez; recovery ürünü bulunmadığından fail-closed kalır.
- Gerçek PostgreSQL 17 + sentetik workbook uçtan uca testi preview → approval →
  claim/lease → File Agent write → audit → persistence zincirini; tenant/RBAC,
  plan mismatch, idempotency, byte-eş backup ve `H–N` korunumu ile doğrular.
- Gerçek PostgreSQL 17 ile tam zincir **2.050 başarılı / 6 mevcut UI skip**
  verdi: UI 352/6, domain 749, contracts 324, database 73, API 474, File Agent
  78. Typecheck, lint, build ve bundle geçti; başlangıç grafiği 498.632 bayt,
  en büyük chunk 318.368 bayt ve 10 lazy modüldür.
- `npm audit --audit-level=high` **başarısızdır**: önceden kayıtlı transitive
  `fast-uri` yanında 23 Temmuz 2026'da yayımlanan transitive `find-my-way`
  HTTP/2 DDoS duyurusu da high raporlanır. Mevcut API yapılandırmasında HTTP/2
  kullanılmıyor ve Package 65B dependency/lockfile değiştirmedi; bulgu gizlenmedi
  veya `npm audit fix` ile kapsam dışı değişiklik yapılmadı.

## Paket 66 — ÜÇ COMMIT İLE TAMAMLANDI VE KABUL EDİLDİ

- Commit #1 kaynak snapshot: `e19870e9a6bd1696e9fa894e8fc09d4dd45e0ecd`.
- Commit #2 sürümlü runtime revision entegrasyonu:
  `1858052f8d335a0562cb856006da698bb6344190`.
- Commit #3 test sertleştirme:
  `120105fc378cd873ad6d08d20de1d6dc9a483b19`.
- Canonical identity/hash, provenance sayıları, 158 aktif kural, 15 anomali,
  immutable revision, explicit approval ve Paket 40 current-approved sınırı
  korunur.

## Paket 66 Commit #1 — KAYNAK SNAPSHOT TAMAMLANDI

- Kaynak workbook SHA-256 başlangıç ve bitişte
  `81d3ae870cd5569b13371ec8b4de081a9a4e3e15098f7454f5d0cdcd3708c424`.
- Snapshot identity `real-market-analysis/2026-07-01/1.0.0`; canonical snapshot
  SHA-256 `e4fc8087ddbc1ff92e3255546e053c6956e20bd1dca269533113b727f728b940`.
- Generic salt-okunur extractor package/workbook relationship'leri üzerinden
  sheet ve sharedStrings part'larını çözüyor; merged cell, hidden state,
  hidden row/column, validation, formula ve cached value görünümünü koruyor.
- Mapping provenance bölündü: 3 `source_workbook`, 11 ayrı ve denetlenebilir
  `product_decision`. Görev DOCX'i ve orphan sharedStrings mapping kaynağı değil.
- Altı aktif parça tablosu workbook'tan programatik çıkarıldı; kaynak satır
  sayıları A=32, B=46, C/Ç=28, D=13, E=7, F=4.
- `source_vehicle_name_column_incomplete` dahil 15 forensic anomaly, dormant ve
  excluded bölümler snapshot/manifestte korundu.
- Bu commit mevcut Paket 32 domain hesaplamasını, API, UI, persistence,
  migration, IPC/dependency veya fiziksel Excel yazım yolunu değiştirmiyor.
- Ana ağaçta lint, typecheck, tam test ve build geçti. Tam test: UI 347 (+6
  ortam-koşullu skip), domain 724, contracts 308, database 16 (+55 skip), API
  102 (+355 skip), File Agent 59. Repository-dışı fresh kopyada workbook/DOCX/
  `.env` sayısı 0; `npm ci`, aynı kalite zinciri ve build geçti.
- `npm audit` mevcut `fast-uri` zinciri için 1 yüksek seviye bulgu veriyor;
  Paket 66 dependency veya lock dosyasını değiştirmedi ve kapsam dışı otomatik
  dependency güncellemesi yapılmadı.
- Ayrıntı: `VALUE_LOSS_RULE_SNAPSHOT_2026-07-01.md`; karar: HB-2026-083.

## Paket 64 semantik düzeltme sonucu — EKSEN DÜZELTİLDİ

- **Bulunan model hatası:** Paket 60-63 profil modeli Excel işçilik sütunlarını kanonik OPERASYON TÜRÜNE eşliyordu. Gerçek şablonun sütunları işçilik BRANŞIDIR. `remove_install` hem kaporta hem mekanik olabilir; `replace` işçilik sütunu değil parça bedelidir.
- **Yeni sınır:** `labor-allocation-categories/1.0.0` (bodywork, mechanical, electrical, upholstery_lock, glass, calibration, repair, paint). Kodlar dil bağımsız; Türkçe etiketler UI katmanında.
- **Eski kayıtlar sessizce yeniden yorumlanmadı:** migration 0038 CHECK kısıtı sürüme göre dallanır; `labor-excel-profile/1.0.0` satırları olduğu gibi okunur ama `writable: false` olur. Yazım yalnız 2.0.0 ile.
- **Kategori uydurulmuyor:** yalnız tek anlamlı türler (paint, calibration, repair) eşlenir. Belirsiz tek tutar TÜM satırı manuel girişe düşürür.
- **Ölçülen dürüst sonuç:** mevcut AI çıktısı belirsiz türler ürettiği için şu anda hiçbir satır otomatik projekte edilemiyor (projeksiyon 0, manuel 2). Bu gerileme değil; önceki davranışın yanlış eksende tutar ürettiğinin kanıtı.
- Dosya numarası kapsamı denetlendi: global unique kısıt YOK ve eklenmedi (`office_number` yalnız organization kapsamında tekil).
- Ana ağaçta typecheck, lint, gerçek PostgreSQL ile **domain 626 + contracts 308 + UI 632 (+6 skip) + database 71 + API 430 + file-agent 53**, build + bundle (495.584 bayt), audit (0 açık) ve diff-check geçti.

## Paket 64 (1. dilim) doğrulama sonucu — KEŞİF GERÇEK, YAZIM HENÜZ YOK

- **Salt okunur keşif yapıldı; P: üzerinde hiçbir dosya değiştirilmedi** (kaynak SHA256 önce/sonra aynı).
- **Klasör düzeni spesifikasyondan iki noktada ayrıldı:** ay klasörü aynı ay için bir şirkette `TEMMUZ 2026`, diğerinde `Temmuz 2026`; ayrıca kapanan dosyalar için belgelenmemiş bir `KAPALI <AY> <YIL>` seviyesi var. Çözümleyici ad üretmek yerine mevcut dizinlerle Türkçe harf duyarsız eşleşiyor; eşleşme yoksa açık hata veriyor ve eski düzene sessiz fallback yapmıyor.
- **Örnek vakada (`47ACA535`) hiç `.xlsx` yok.** Ürün kararı alındı: eksik workbook OLUŞTURULMAZ, yazım açık hatayla bloklanır.
- **Şablon dosya adıyla değil içerik imzasıyla ayrıldı:** 20 workbook / 26 sheet tarandı, imza eşleşmesi tam olarak 1. `İŞÇİLİK.xlsx` adlı iki dosya aslında parça listesiydi — ada güvenen bir seçim tam olarak yanlış dosyaları seçerdi.
- **Bağımlılık `fflate` seçildi** (0 bağımlılık, MIT, saf JS, native binary yok). `exceljs` reddedildi: 9 doğrudan bağımlılık ve workbook'u yeniden üretirken modellemediği özellikleri (grafik, pivot, koşullu biçimlendirme) sessizce düşürmesi.
- **Gerçek şablona karşı doğrulama:** imza doğrulandı, hedef hücreler yamalandı, formüllü Toplam sütunu `cell_has_formula` ile reddedildi ve **11 OOXML part içeriğinin 9'u byte-birebir aynı kaldı** (tüm ZIP dosyasının binary olarak aynı kaldığı iddia edilmez).
- Ana ağaçta typecheck, lint, gerçek PostgreSQL ile **domain 600 + contracts 308 + UI 632 (+6 skip) + database 71 + API 430 + file-agent 53**, build + bundle (495.584 bayt), `npm audit` (0 açık, kilit dosyası dahil) ve `git diff --check` geçti.
- **Fiziksel yazım hattı, geometri migration'ı, sözleşme/API/UI ve Chrome smoke bu dilimde YOK**; 2. dilimdedir.

## Gemini gecikme release kapısı GEÇTİ (2026-07-21)

- Kontrollü ölçüm 10:15 sonrası çalıştırıldı: **5/5 başarılı**. `gemini-3.5-flash`, provider `gemini-generate-content/1.3.0`.
- En yüksek çağrı süresi **3534 ms** (25 sn eşiğinin altında); 429/timeout **0**; 2/2 satır; 8/8 kategori tam; kategori toplamı = işçilik tutarı; domain doğrulama hatası **0**; usage/ledger tutarlı; PII/URL/yol sızıntısı **0**.
- Kapı kapandı. **Ancak production provider otomatik açılmadı**: production enablement ayrı deployment kararıdır ve deployment flag + organization policy (`ai_provider_policies`) ile kontrol edilir.
- **Fiziksel `.xlsx` yazımı hâlâ uygulanmadı** — Paket 65A (preflight + immutable plan) ve 65B (yazım) kapsamı. Ayrıntı: `DECISION_LOG` HB-2026-082.

## Klasör düzeni düzeltmesi (2026-07-21)

- Fiziksel yapı sadeleşti: güncel dosyalar `<yıl><Ay YYYY><PLAKA>` düzeninde, sigorta şirketi klasörü olmadan duruyor. Arşiv yıllarında eski `<yıl><Sigorta Klasörü><Ay YYYY><PLAKA>` düzeni bulunabilir.
- `case-folder-path` çözümleyicisi `2.0.0` sürümüne alındı: iki düzeni de tarar, sigorta seviyesini zorunlu tutmaz, kapalı klasörü ay klasörünün içinde arar ve birden fazla konum eşleşirse `case_folder_ambiguous` verip tahmin etmez.
- Çalışan uygulamada kırılma OLMADI: `buildCaseWorkspaceBasePath` zaten yalın düzeni üretiyordu ve çözümleyicinin henüz tüketicisi yoktu.

## Paket 64 — İŞÇİLİK DAĞITIM KATEGORİSİ TAMAMLANDI (2026-07-20)

Paket kapatıldı. Zincirin tamamı gerçek PostgreSQL ve gerçek tarayıcı üzerinde
doğrulandı; aşağıdaki maddelerin hiçbiri "yazıldı ama çalıştırılmadı" değildir.

### Üç eksen ayrı tutuluyor

- **Operasyon türü** (`labor-operation-types/1.0.0`): işin NE olduğu — onarım,
  değişim, sökme/takma, boya, sarf, kalibrasyon, ilişkili işlem, diğer.
- **İşçilik dağıtım kategorisi** (`labor-allocation-categories/1.0.0`): işi HANGİ
  BRANŞIN yaptığı — kaporta, mekanik, elektrik, döşeme/kilit, cam, kalibrasyon,
  onarım, boya. **Excel sütunları bu eksendedir.**
- **Ekonomik karşılaştırma kovaları**: yalnız onarım/değişim kıyası içindir.

Bu ayrım paketin merkezindeki düzeltmedir: ilk tasarım Excel sütunlarını
operasyon türüne bağlıyordu ve iki ekseni aynı şey sanıyordu.

### Uçtan uca çalışan zincir

- **Gemini kategori wire sürümü `gemini-generate-content/1.3.0`**: model satır
  bazında sekiz kategori tutarını KENDİSİ üretir; kural tabanlı dağıtıcı yoktur.
- **Önerilen ve uygulanan kategori kalıcılığı** (migration 0040): iki dağılım
  AYRI saklanır; sekiz anahtar tamlığı ve toplam eşitliği veritabanı CHECK'inde
  durur.
- **Kullanıcı düzeltmesi ve immutable provenance**: uzman sekiz tutarı
  düzeltebilir; modelin ilk değeri kaybolmaz, `category_modified` gerçeği söyler
  ve satırlar append-only kalır.
- **Onaylı kategori geçmişi**: yalnız tamamlanmış uygulamaların provenance'ı
  dolu satırlarından; operasyon türü ekseninden BAĞIMSIZ hesaplanır; çelişen
  geçmiş otomatik doğru kabul edilmez.
- **Baseline/history çelişkisi sunucuda zorlanır** (migration 0041): kıyas
  vektörleri kodla birlikte immutable saklanır. Karşılaştırma mutlak tutar
  değil kategori PAYI üzerinden yapılır.
- **UI sekiz kategori inceleme ve düzeltme**: tutarlar, işçilik/kategori
  toplamı, ortak gerekçe, güven, kanıt referansları, sunucu çelişki kodları,
  baseline/geçmiş payları. Geçersiz toplam uygulamayı kilitler; fark hiçbir
  kategoriye otomatik dağıtılmaz.
- **Profil `labor-excel-profile/2.0.0`**: eşleme kategori eksenindedir; eski
  1.0.0 profilleri okunabilir ama `writable=false`.
- **Projeksiyon yalnız completed applied provenance'tan üretilir**: eksik
  provenance, toplam uyuşmazlığı veya eşlenmemiş sütun satırı manuel girişe
  düşürür; kısmen eşlenen satır tamamen düşer.

### Doğrulama

- Tam test zinciri gerçek `hasarbotu_test` PostgreSQL ile geçti; kategori
  ekseni için domain, contracts, API ve UI testleri eklendi.
- **P63 Chrome smoke** (profil seçimi, 15 senaryo) ve **P64 Chrome smoke**
  (kategori zinciri, 16 iddia) gerçek Chrome/CDP ile geçti.
- Üç föy sürümlü baseline çelişkisi ve tutarlı-ama-ayrışan geçmiş çelişkisi
  gerçek PostgreSQL'de doğal API akışıyla kanıtlandı.
- İddiaların dişi kasıtlı kırılmalarla ölçüldü: pay karşılaştırması, UI toplam
  kilidi, sunucu toplam kapısı, bayatlık hesabı, applied/proposed karışması,
  baseline zorlaması ve kod ezme senaryosu — her biri doğru testi düşürdü.

### Bu pakette YAPILMAYAN

- **Fiziksel `.xlsx` yazımı yoktur.** Projeksiyon salt okunurdur ve sözleşme
  seviyesinde `written: false` taşır.
- Production Gemini provider açılmadı; üretim migration çalıştırılmadı.

## Paket 63 doğrulama sonucu — SEÇİM SUNUCUDA ZORLANIYOR

- **Kapatılan gerçek açık:** Paket 60'ta dosya ekranı `profiles[0]` ile listedeki İLK profili körü körüne seçiyordu; bu, başka bir sigorta şirketinin şablonunu sessizce kullanabilirdi. Artık aday kümesi sunucuda süzülür ve seçim kullanıcınındır.
- **Sınır sunucudadır.** Projeksiyon ucu pasif profili `PROFILE_INACTIVE`, yabancı şirket profilini `PROFILE_INSURER_MISMATCH` ile **409** döner; smoke bu iki durumu UI'ı atlayıp ham `fetch` ile de doğrular.
- **Öneri seçim yerine geçmez.** Şirkete bağlı tek aktif profil ön-seçili gelir ama onaylanmadan projeksiyon üretilmez; birden fazla adayda hiçbir şey ön-seçili olmaz ve önizleme düğmesi kilitlidir.
- **Genel profil adaydır ama asla otomatik önerilmez** — P60'ın şirkete bağlı olmayan profil tasarımı korunur, öneri yalnız şirkete bağlı tek aktif profille yapılır.
- **Pasifleştirme silme değildir.** Migration 0037 durumu aggregate'te tutar; pasif profil yeni projeksiyonda seçilemez, kaydı okunabilir kalır. Gerekçe zorunludur ve DB CHECK tutarsız durumu imkânsız kılar.
- **Otomatik öneri gerçek şablon eşleşmesi olarak sunulmaz:** yanıt `templateVerified: false` literalini taşır, UI açıkça "profil önerisidir" der. Hedef sayfa ve kimlik doğrulama kuralı modele girdi; **hücre koordinatı bilerek girmedi** — gerçek şablon okunmadan konum uydurmak yanlış güven yaratır.
- **Smoke'un diş taşıdığı ölçüldü.** Paket 62'de teşhis kodum sahte yeşil ürettiği için bu kez smoke kasıtlı kırılmayla sınandı: aktiflik filtresi devre dışı bırakılınca `AFTER_DEACTIVATION_COUNT_2` ile düştü, geri alınınca 2/2 geçti.
- Ana ağaçta typecheck, lint, gerçek `hasarbotu_test` PostgreSQL ile **domain 575 + contracts 308 + UI 632 (+6 skip) + database 71 + API 430 + file-agent 53**, build + bundle bütçesi (495.584 bayt), `npm audit` (0 açık) ve `git diff --check` geçti.
- Gerçek Chrome/CDP smoke **15/15 senaryo**; 1920×1080 açık/koyu ve 1366×768 koyu görünümde yatay taşma yok.
- Yan düzeltme: Paket 62'de asenkron analize geçerken `labor-excel-profile` testinde kalan yarış (`analyze` sonucu beklenmeden `apply`) `waitForRunTerminal` ile kapatıldı.

## Paket 62 doğrulama sonucu — İLERLEME GERÇEK, İPTAL DÜRÜST

- **Analiz asenkron koşuyor.** İstek koşuyu `queued` yaratıp hemen dönüyor; yürütme sunucuda sürüyor. Kullanıcı sayfadan ayrılıp dönünce aktif koşu bulunuyor ve ilerleme kaldığı yerden görünüyor.
- **İlerleme mevcut kayıtlardan türetiliyor** — ikinci paralel ilerleme sistemi kurulmadı. Tamamlanan grup sayısı `result_kind='success'` makbuzlarından sayılıyor. Migration 0036 yalnız türetilemeyen alanları ekliyor.
- **Sahte yüzde ve tahmini kalan süre yok.** UI yalnız `3/5 grup`, `60/100 satır` ve gerçekten geçen süreyi gösteriyor; yüzde çubuğu bilinçli olarak eklenmedi.
- Aynı föy sürümü için çift başlatma `ANALYSIS_ALREADY_RUNNING` (409) ile engelleniyor. İptal `cancel_requested` ara durumundan geçiyor; koşu ancak gerçekten durunca `cancelled` oluyor. Migration 0036 trigger'ı başarısız/iptal koşusunun öneri satırı taşımasını DB seviyesinde yasaklıyor.
- **Smoke, kendi teşhis kodumun ürettiği sahte yeşili ortaya çıkardı.** Ölçüm sırasında eklediğim teşhis, iptal ucuna kendisi POST atıyor ve UI adına iptali gerçekleştiriyordu; smoke bu yüzden geçiyor görünüyordu. Teşhis kaldırılınca hata 3/3 tekrarlandı.
- **Bulunan gerçek kusur:** `cancel` gövdesiz POST gönderiyordu ama istek yine `content-type: application/json` taşıdığı için sunucu boş gövdeyi ayrıştıramıyor ve **400** dönüyordu — iptal düğmesi gerçek API'ye karşı hiç çalışmamıştı. Bileşen testi stub port kullandığından göremezdi; düzeltme sonrası kablo seviyesinde regresyon testi eklendi (`src/data/laborAllocationPort.test.ts`). `authPort.logout` aynı desende ama content-type göndermediği için etkilenmiyor.
- Ana ağaçta typecheck, lint, gerçek `hasarbotu_test` PostgreSQL ile **domain 563 + contracts/UI 628 (+6 skip) + database 71 + API 416**, build + bundle bütçesi (495.584 bayt), `npm audit` (0 açık) ve `git diff --check` geçti.
- Gerçek Chrome/CDP smoke (14/14 senaryo, düzeltme sonrası 3/3 ardışık): 45 satır → 3 grup ilerlemesi, buton kilidi, 409 çift başlatma, navigasyon sonrası ilerlemenin sürmesi, tamamlanınca otomatik geçiş, grup başına makbuz, iptalin kısmi öneri sızdırmaması, önceki koşunun değişmemesi, audit'te PII olmaması, temiz console. 1920×1080 açık/koyu ve 1366×768 koyu görünümde yatay taşma yok.
- **Yanlış alarm kapatıldı:** doğrulama sırasında `services/file-agent` PDF/OCR kuşağında 11 test düşüyordu. Kaynak kodu değil, **bayat `services/file-agent/dist/pdf-parser-worker.js`** çıktısıydı; izole worker derlenmiş `.js` dosyasını tercih ettiği için eski sürüm çalışıyordu. `npm run build` sonrası ana ağaçta da **53/53** geçiyor ve repository dışı temiz kopyada zaten geçiyordu.
- Repository dışı temiz kopyada fresh `npm ci` (0 açık), typecheck, lint, aynı gerçek `_test` PostgreSQL ile tüm kuşaklar ve build + bundle bütçesi yeniden geçti; geçici kopya kaldırıldı.

## Paket 61 doğrulama sonucu — ÖLÇÜLDÜ, CHUNKING GELİŞTİRİLDİ

- **Önce ölçüldü.** Gerçek Gemini + gerçek `analyze` akışı + sentetik föyler. Tek çağrıyla: 10 satır 9,7 sn ✔, 25 satır 20,3 sn ✔, **50 ve 100 satır 30,0 sn'de `AI_PROVIDER_TIMEOUT`** ✘. Ölçülen doğrusal davranış: satır başına ~0,81 sn ve ~307 çıktı token'ı. Çıktı kesilmesi gözlenmedi; darboğaz süredir.
- Karar kuralı gereği (timeout + eksik satır ölçüldü) **kontrollü chunking** geliştirildi. **30 sn'lik politika tavanı yükseltilmedi** — tavan çağrı başınadır, iş bölündü. Chunk boyutu 20, ölçüme dayalı ve sürümlü (`labor-allocation-chunking/1.0.0`).
- **Chunking sonrası tüm boyutlar geçti:** 10 satır 1 çağrı, 25 satır 2 çağrı, 50 satır 3 çağrı (43,9 sn), 100 satır 5 çağrı (84,6 sn) — hepsinde **tam satır kapsaması ve sıfır doğrulama hatası**. Ledger alt çağrıların gerçek toplamını taşıyor (100 satır: 12.275/31.138 token = 5 makbuzun toplamı).
- 11 sağlayıcı çağrısının hiçbirinde timeout, retry veya çıktı kesilmesi yok (`finishReason` hepsinde STOP) — her çağrının **çağrı başına** 30 sn tavana uyduğunun doğrudan kanıtı. Toplam duvar saati chunk'lı run'da meşru biçimde tavanı aşar; ilk ölçüm betiğim bu ikisini karıştırıyordu, kontrol doğru semantiğe çekildi.
- Değişmezler: gruplar deterministik/çakışmasız, dosya bağlamı her gruba taşınır, her grup domain doğrulamasından ayrı geçer, birleştirme sunucuda, **eksik/tekrarlı tek satır bile tüm run'ı düşürür**, gizli tek-çağrı fallback yok, her alt çağrı kendi makbuzunu üretir.
- **Üç yan kusur bulundu ve düzeltildi:** (1) `finishReason` görünmüyordu — çıktı kesilmesi timeout'tan ayırt edilemiyordu, artık ayrı `AI_PROVIDER_RESPONSE_TRUNCATED` kodu var; (2) ledger gerçek kullanımı taşımıyordu — `output_characters` sabit 0, token sütunları hiç dolmuyordu; (3) `finalize` closure'ında gizli TDZ hatası — eski kod yalnız ternary kısa devresi sayesinde kazara kaçınıyordu.
- Gerçek sağlayıcıyla **teyit koşusu kotaya takıldı** (429, ortamsal). Kontrollü retry (2 deneme) ve no-fallback doğru çalıştı; run temiz `failed` oldu, hiçbir satır kaydedilmedi. Chunking değişmezleri kotadan bağımsız olarak deterministik sağlayıcıyla CI kuşağında korunuyor (4/4 test).
- Ana ağaçta typecheck, lint, **1716 test** (+6 ortam-kapılı UI skip), build + bundle bütçesi, `npm audit` (0 açık), `git diff --check` ve Paket 60 Chrome smoke'u regresyonsuz geçti. Repository dışı temiz kopyada tam zincir geçti; yük ölçümü opt-in'siz temiz atlandı.
- **Migration yoktur**; domain doğrulaması ve tam satır kapsaması şartı gevşetilmedi.

## Paket 60 doğrulama sonucu

- **Hiçbir sigorta şirketi kolonu ürüne gömülmedi.** Sütunlar ve eşleme tamamen kullanıcı verisidir; sabit olan tek şey kanonik operasyon türü kümesidir. Testler ve smoke yalnız sentetik sütun adları kullanır.
- Profiller organizasyon düzeyinde, **sürümlü ve immutable** (0032 araç profili kalıbı). İlk kayıt gerekçe istemez, sonraki her sürüm ister; sigorta şirketi bağlantısı composite FK ile aynı organizasyona kilitli.
- Eşleme kanonik tür kümesini **tam kapsamak zorunda**; eksik/fazla anahtar hem sözleşme hem DB CHECK seviyesinde reddediliyor. CHECK içinde subquery kullanılamadığı için fazla-anahtar kuralı jsonb anahtar çıkarma ile ifade edildi.
- **Projeksiyon salt okunur ve dosyaya yazmıyor**; yanıt `written: false` literalini taşıyor. xlsx dependency ve fiziksel yazım bu pakette yok.
- **Dürüstlük kuralı doğrulandı:** Paket 58'de kullanıcı tutarı değiştirerek uyguladıysa tür bazlı dağılım artık doğrulanmış değil; o satır için sütun tutarı üretilmiyor, `manual_entry_required` işaretleniyor ve yalnız uygulanan toplam referans olarak korunuyor. Değiştirilmemiş satırda bile dağılım toplamı tutmuyorsa satır projekte edilmiyor — sessiz düzeltme yok.
- Eşlenmemiş türe düşen tutar hiçbir sütuna yazılmıyor, sütun toplamlarına karışmıyor ve satır incelemeye düşüyor.
- **Ölçülen sonuç (Chrome/CDP smoke, gerçek PostgreSQL):** profil yokken sahte profil gösterilmiyor; kullanıcı kendi sütunlarını ve 8 türden 3'ünün eşlemesini tanımlıyor; değiştirilmemiş satır sütunlara düşüyor, **değiştirilen satır `—` gösterip "Manuel giriş gerekli" işaretleniyor**; projeksiyon föy sürümü sayısını değiştirmiyor.
- Gerçek PostgreSQL API testleri 13/13, domain testleri 16/16, migration/DB testleri 69/69, Yönetim UI testleri 7/7.
- **Bundle bütçesi bir kez düştü ve doğru şekilde düzeltildi:** doğrudan import başlangıç grafiğini 504.045 bayta çıkarmıştı (sınır 500.000). Bütçe yükseltilmedi; projedeki lazy kalıbı uygulandı → 495.584 bayt.
- Ana ağaçta typecheck, lint, **1699 test** (+6 ortam-kapılı UI skip), build + bundle bütçesi, `npm audit` (0 açık) ve `git diff --check` geçti. Repository dışı temiz kopyada tam kapı zinciri geçti; kopya kaldırıldı.
- **Kalan sınır:** v0.7'nin son dilimi güvenli Excel yazımıdır ve xlsx dependency + gerçek ofis şablonu + fiziksel yazma kararı gerektirir.

## Paket 59 doğrulama sonucu — GERÇEK GEMINI RELEASE KAPISI KAPANDI

- **Ölçüm gerçek API anahtarıyla ve P56–P58 sonrası GERÇEK akış üzerinden yapıldı**: policy opt-in → bütçe → egress onayı → `analyze` ucu → immutable kayıt → ledger/makbuz. Anahtar yalnız `.env.local`tan süreç ortamına okundu; `.gitignore` üç desenle ignore ediyor, dosya takip edilmiyor, hiçbir log/commit'e girmedi.
- **Üç kapı ölçümü (2 senaryo × 2 model: birincil `gemini-3.5-flash`, fallback `gemini-2.5-flash`):**
  1. `responseJsonSchema` kabulü: **4/4 koşuda HTTP 200** — enum'lu sıkılaştırılmış şema gerçek API'ce kabul ediliyor.
  2. Satır kapsaması: **4/4 koşuda 2/2 satır**, doğru sırayla.
  3. Doğrulama hata oranı **0/2 (her modelde)**; `control_required` oranı **4/4**. Model her satırda 0.9 güven bildirdi; sunucu zorlaması güvene bakmadan kontrolü korudu.
- **P56–P58 kanalları gerçek modelle doğrulandı**: çıplak senaryoda satır başına 5 eksik kanıt kodu; zengin senaryoda (araç profili + parça kodu + hasar bölgesi + baseline) yalnız `EVIDENCE_MISSING_APPROVED_HISTORY`. Makbuzlar gerçek token kullanımıyla `finalized` (ör. 615/780, 788/716).
- İlk gerçek temasın bulduğu üç kusur düzeltildi, **domain güvenlik kuralları değişmedi** (ayrıntı: HB-2026-066): kapalı kümeler wire şemasına enum olarak eklendi; `thinkingBudget: 0` ile dinamik düşünme kapatıldı (30 sn policy tavanı gevşetilmedi); türetilebilir onarım/değişim toplamları wire'dan çıkarılıp adaptörde modelin kendi kovalarından hesaplanır oldu (fallback değil — kova geçersizse dokunulmaz, domain reddeder).
- Sağlayıcı sürümü `gemini-generate-content/1.1.0` (wire sözleşmesi = şema + talimat bu sürümle izlenir; domain prompt/şema sürümleri ve DB pinleri değişmedi, migration yok).
- **Windows `UV_HANDLE_CLOSING` çökmesi giderildi**: manuel smoke hataları yakalayıp sınıflandırılmış raporlar, undici global dispatcher'ını kapatır ve doğal çıkış kullanır. Betik artık `ok:false` durumunda ham metin içermeyen YAPISAL teşhis raporu üretir.
- Manuel smoke opt-in olmadan atlanmaya devam ediyor (`{"skipped":true}`, exit 0) — fresh checkout'ta doğrulandı; CI ve standart kuşak anahtar istemiyor. Fresh checkout kopyası `.env*` dosyalarını dışlar.
- Ana ağaçta typecheck, lint, **1658 test** (+6 ortam-kapılı UI skip), build + bundle bütçesi, `npm audit` (0 açık), `git diff --check` ve Paket 58 Chrome smoke'u regresyonsuz geçti. Repository dışı temiz kopyada tam kapı zinciri geçti; kopya kaldırıldı.
- **Kapı durumu: KAPALI.** Üretimde `GEMINI_LABOR_ALLOCATION_PROVIDER_ENABLED` açılmadan önceki zorunlu ölçüm tamam. Wire sözleşmesi değişirse (provider sürüm artışı) kapı yeniden koşulmalıdır.

## Paket 58 doğrulama sonucu

- **Paket 54'te bilinçli bırakılan `applied: false` boşluğu kapandı.** AI dağıtımı artık kullanıcının açık onayıyla föye uygulanabiliyor; `apply-preview` önizleme olarak korunuyor.
- **Tek transaction**: föy sürümü, satır snapshot'ları ve provenance birlikte kesinleşiyor. Geçersiz satır ve stale sürüm senaryolarında geriye ne uygulama ne föy sürümü kalıyor — gerçek PostgreSQL testleriyle doğrulandı.
- **Değişmezler DB seviyesinde**: bir hedef föy sürümü yalnız bir uygulamaya, bir run yalnız bir başarılı uygulamaya bağlanabiliyor; `completed` hedef sürüm olmadan imkânsız; tamamlanmış kayıtlar trigger ile değiştirilemiyor. Ters yön deferred constraint trigger ile kapatıldı: `ai_allocation_applied` etiketli sürüm provenance'sız commit edilemiyor.
- Föy sürümü oluşturmanın **tek uygulaması** `labor/sheet-version.ts`e çıkarıldı; kullanıcı revizyonu ve AI uygulaması aynı yardımcıyı kullanıyor. Çıkarma işlemi mevcut 42 testle davranış-koruyucu olarak doğrulandı.
- Kısmi seçim föyü budamıyor: seçilmeyen satırlar korunuyor ve "reddedildi" sayılıyor. Kullanıcı öneriyi düzenleyebiliyor; önerilen ve uygulanan değerler ayrı snapshot'lanıyor ve `modified` bayrağı DB CHECK'inde snapshot'larla tutarlı olmak zorunda.
- **`approvedHistory` gerçek provenance'tan besleniyor**: yalnız `completed` uygulama kayıtları, yalnız `applied_*` sütunları. Ham öneri, önizleme ve reddedilen satırlar kanıt değil.
- **Bir kural hatası testle yakalandı ve düzeltildi:** geçmiş eşleştirmesi ilk sürümde baseline'ın karşılıklı-tek kuralını kullanıyordu. Geçmiş bir havuz olduğu için bu, ikinci uygulamadan sonra kanalı kalıcı olarak kapatıyordu. Kural havuz semantiğine çevrildi: aynı cevabı veren birden çok kayıt tutarlı kanıttır, belirsizlik ancak kayıtlar birbiriyle çelişirse oluşur.
- Öneri geçmişten ayrışıyorsa `CONFLICT_HISTORY_DISAGREEMENT` sunucuda zorlanıyor; geçmiş otomatik doğru sayılmıyor.
- **Ölçülen sonuç (Chrome/CDP smoke, gerçek PostgreSQL):** uygulama öncesi 5 eksik kanıt kodu; kullanıcı açıkça onayladıktan sonra BAŞKA bir dosyadaki yeni analizde 4 kod kalıyor — **yalnız** `EVIDENCE_MISSING_APPROVED_HISTORY` düşüyor. Onay modalı açıkken föy sürümü sayısı değişmiyor; yalnız açık onaydan sonra sürüm 2 oluşuyor ve `ai_allocation_applied` etiketleniyor.
- Gerçek PostgreSQL API testleri 13/13 (`labor-allocation-apply.test.ts`), apply domain testleri 18/18, migration/DB testleri 67/67, AI paneli UI testleri 16/16.
- Ana ağaçta typecheck, lint, **1658 test** (+6 ortam-kapılı UI skip), build + bundle bütçesi (başlangıç 494.639 bayt), `npm audit --audit-level=moderate` (0 açık) ve `git diff --check` geçti.
- Repository dışındaki temiz kopyada fresh `npm ci` + typecheck + lint + tam test + build geçti; geçici kopya kaldırıldı.
- **Gerçek Gemini smoke'u yine ÇALIŞTIRILMADI**: yerel ortamda `GEMINI_API_KEY` yok. Manuel betik opt-in olmadan temiz atlıyor; üretimde sağlayıcı açılmadan önceki zorunlu release kapısı hâlâ AÇIK.

## Paket 57 doğrulama sonucu

- **Baseline kaynağı yalnız önceki onaylı föy sürümüdür.** Yeni kaynak tablo açılmadı; `labor_sheet_versions` zaten immutable ve yalnız açık kullanıcı onayıyla oluşuyor. AI önerileri ayrı aggregate'te durduğu için baseline'a karışmaları yapısal olarak imkânsız — smoke bunu ayrıca doğruluyor.
- Satır eşleştirmesi açıklama + işlem üzerine kurulur; parça kodu ve hasar bölgesi yalnız iki tarafta da doluyken ayırt edici sayılır. Eşleşme **karşılıklı tek** olduğunda kabul edilir; belirsizlikte baseline yokmuş gibi davranılır.
- `EVIDENCE_MISSING_EXPERT_BASELINE` yalnız her satır belirsizlik olmadan eşleştiğinde düşer. Gerçek PostgreSQL testi, iki özdeş satırın bulunduğu dosyada baseline sürümünün bulunmasına rağmen `baselineMatchedLineCount = 0` kaldığını ve kodun düşmediğini doğruluyor.
- **Çelişki sunucuda hesaplanır ve model bildirmese de düşmez.** Karşılaştırma tutar büyüklüğüne değil parça payı oranına bakar (eşik `labor-baseline-comparison/1.0.0` kuralında sürümlü); kullanıcının föyü meşru revizyonu çelişki üretmez, ekonomik şekil sapması üretir.
- Baseline seçimi run kimliğinin parçası ve trigger ile immutable; satır karşılaştırması öneriyle birlikte saklanıyor ve DB CHECK'i "baseline yok ama çelişki var" kaydını imkânsız kılıyor.
- **Ölçülen sonuç (Chrome/CDP smoke, gerçek PostgreSQL):** tek föy sürümünde satır başına 5 eksik kanıt kodu; sürüm 1 baseline olduğunda 4 kod kalıyor — **yalnız** `EVIDENCE_MISSING_EXPERT_BASELINE` düşüyor, diğer dört kanal bağımsız kalıyor. Çelişkili satır kontrol gerekli kalıyor ve toplu seçim devre dışı.
- **Provenance düzeltmesi:** `approvedHistory` kanalı `labor_allocation_line_suggestions` üzerinden okuyor, yani yalnız `control_required=false` işaretlenmiş ham AI çıktısını "kullanıcı onaylı geçmiş" diye geri besliyordu — modelin kendi çıktısını kanıt olarak gördüğü bir döngü. Dağıtım önerilerinin föye uygulandığını gösteren bağ şemada bulunmadığı için kanal uydurma kaynak yerine boş bırakıldı; `EVIDENCE_MISSING_APPROVED_HISTORY` dürüst biçimde üretilmeye devam ediyor. Daraltıcı değişikliktir, kanıt genişletmez.
- Gerçek PostgreSQL API testleri 12/12 (`expert-baseline-evidence.test.ts`), baseline domain testleri 16/16, migration/DB testleri 65/65, AI paneli UI testleri 11/11.
- Chrome/CDP smoke (`scripts/package57-browser-smoke.mjs`) geçti: ilk sürümde baseline yokluğunun açıkça söylenmesi, AI önerisinin baseline'a dönüşmemesi, revizyondan sonra sürüm 1'in baseline olması, yalnız baseline kodunun düşmesi, satır bazlı karşılaştırmanın görünmesi, çelişkinin sunucuda zorlanması, kanıt hash'inin değişmesi, plakanın audit'e sızmaması ve API kapandığında bayat karşılaştırma kalmaması. 1920×1080 açık/koyu ve 1366×768 koyu görünümde yatay taşma yok; console warning/error/exception 0.
- **Bir test kusuru tam kuşakta yakalandı ve düzeltildi:** baseline değiştirilemezlik testi `LIMIT 1` ile sırasız satır seçiyordu; tek dosyada geçip tam kuşakta düşüyordu çünkü seçilen run'ın satırlarında baseline dolu olabiliyordu. Hedef satır deterministik seçilecek biçimde yeniden yazıldı ve iddia gerçekten sınanır hale getirildi.
- Ana ağaçta typecheck, lint, **1617 test** (+6 ortam-kapılı UI skip), build + bundle bütçesi (başlangıç 494.639 bayt), `npm audit --audit-level=moderate` (0 açık) ve `git diff --check` geçti.
- Repository dışındaki temiz kopyada fresh `npm ci` + typecheck + lint + tam test + build geçti; geçici kopya kaldırıldı.
- **Gerçek Gemini smoke'u ÇALIŞTIRILMADI.** Yerel ortamda `GEMINI_API_KEY` bulunmuyor ve `%USERPROFILE%\.hasarbotu\` altında yalnız PostgreSQL parola dosyaları var. `scripts/package55-gemini-manual-smoke.mjs` opt-in olmadan temiz biçimde atlanıyor (`{"skipped":true}`, çıkış kodu 0), yani CI ve standart kuşak anahtar istemiyor. Üretimde sağlayıcı açılmadan önceki zorunlu release kapısı **hâlâ açıktır**.

## Paket 56 doğrulama sonucu

- **Üç eksik kanıt kanalı birlikte kapatıldı.** Yalnız araç kimliği eklemek yetmezdi: domain her kanal için ayrı `control_required` sebebi üretiyor, tek kanal kapatılsaydı bütün satırlar yine kontrol gerekli kalırdı.
- `detectMissingEvidence` sabit kod listesi döndürmeyi bıraktı; kodlar gerçek plan bağlamından türetiliyor. Böylece kanıt doldukça kod gerçekten düşüyor.
- **Ölçülen sonuç (Chrome/CDP smoke, gerçek PostgreSQL):** üç kanal boşken satır başına 5 eksik kanıt kodu (`APPROVED_HISTORY`, `DAMAGE_REGION`, `EXPERT_BASELINE`, `PART_CODE`, `VEHICLE_IDENTITY`); araç profili, parça kodu ve hasar bölgesi girildikten sonra 2 kod kalıyor (`APPROVED_HISTORY`, `EXPERT_BASELINE`). `control_required` satır sayısı 1 → 1: kod sayısı düşse de sunucu zorlaması kalkmıyor.
- Araç profili dosya düzeyinde, versiyonlu ve kullanıcı kontrollü (`case_vehicle_profiles` + immutable `case_vehicle_profile_versions`); ilk kayıt gerekçe istemiyor, sonraki her sürüm istiyor. Otomatik belge çıkarımı bu dilimde yok.
- **Tam şasi numarası hiçbir katmanda tutulmuyor**: alan yalnız 3–11 karakterlik prefix kabul ediyor ve sınır UI (`maxLength=11`), sözleşme ve DB CHECK seviyesinde birlikte uygulanıyor. Kanıt referansı yalnız dosyada duruyor; dışarı çıkan pakete konmuyor.
- Parça kodu ve hasar bölgesi işçilik satırında nullable; eski föy sürümleri null kalıyor ve değişmeden okunuyor. Saf işçilik satırında parça kodu zorunlu değil; `partAmountMinor > 0` olup kod yoksa eksik kanıt üretiliyor. Kullanıcı girdisi ile sözlük önerisi `part_code_source` ile ayrışıyor ve kod/kaynak DB CHECK'inde birlikte null ya da birlikte dolu.
- **Bir hata testle yakalandı ve düzeltildi:** `validateLaborSheetItems` yeni alanları doğruluyor ama normalize edilmiş sonuca taşımıyordu; parça kodu ve hasar bölgesi hiç kalıcı olmuyor, `EVIDENCE_MISSING_DAMAGE_REGION` da hiç düşmüyordu.
- **Bir UI boşluğu smoke'ta yakalandı ve kapatıldı:** föy aynı sekmede revize edildiğinde AI dağıtım modülü eski kaynak föy sürümüyle kalıyordu. Föy kaydedildiğinde modül yeniden kuruluyor; kullanıcı revize edilmiş föyün üstünde eski öneriyle çalışamıyor.
- Gerçek PostgreSQL API testleri 12/12 (`ai-evidence-enrichment.test.ts`), araç profili domain testleri 12/12, migration/DB testleri 63/63.
- Chrome/CDP smoke (`scripts/package56-browser-smoke.mjs`) geçti: araç profilinin UI'dan kaydedilip sürümlenmesi, şasi prefix sınırı, parça kodu/hasar bölgesinin editörden PostgreSQL'e yazılması, eksik kanıt kodlarının gerçekten düşmesi, `control_required` zorlamasının kalkmaması, kanıt snapshot hash'inin değişmesi, önceki öneri kaydının değişmemesi, plaka ve tam şasinin audit'e sızmaması, API kapandığında sahte profil gösterilmemesi. 1920×1080 açık/koyu ve 1366×768 koyu görünümde yatay taşma yok; console warning/error/exception 0.
- Ana ağaçta typecheck, lint, **1584 test** (+6 ortam-kapılı UI skip), build + bundle bütçesi (başlangıç 494.639 bayt), `npm audit --audit-level=moderate` (0 açık) ve `git diff --check` geçti.
- Repository dışındaki temiz kopyada fresh `npm ci` + typecheck + lint + tam test + build geçti; geçici kopya kaldırıldı.
- **Kalan sınır:** `EVIDENCE_MISSING_APPROVED_HISTORY` ve `EVIDENCE_MISSING_EXPERT_BASELINE` kanalları hâlâ açık; bunlar organizasyon içi onaylı geçmiş ve eksper sonucu doldukça düşer ve Paket 56 kapsamında değildir.

## Paket 55 doğrulama sonucu

- Üretim yolu gerçek Gemini adaptörüne bağlandı; deterministik harness korundu ama **yalnız açık izinle** görünür ve `NODE_ENV=production` altında config aşamasında reddedilir.
- **Üç ayrı opt-in kapısı** doğrulandı: deployment (`GEMINI_LABOR_ALLOCATION_PROVIDER_ENABLED` + `GEMINI_API_KEY`), organization (`ai_provider_policies.labor_allocation_enabled` + izin listesi) ve kullanıcı (`confirmedEgress`). Politika satırı yokken sağlayıcı hiç çağrılmıyor ve sağlayıcı makbuzu bile oluşmuyor; egress onayı yokken istek 409 dönüyor.
- Credential yalnız süreç ortamından okunuyor ve yalnız `x-goog-api-key` başlığında taşınıyor. Payload testi anahtarın, plakanın, organization/case/sheet kimliğinin, e-postanın ve dosya yolunun istek gövdesinde bulunmadığını doğruluyor.
- Yapılandırılmış çıktı isteniyor (`responseMimeType: application/json` + `responseJsonSchema`, `temperature: 0`); dönen veri yine domain doğrulamasından ve PII/URL/path taramasından geçiyor.
- Kontrollü retry yalnız 429 ve 5xx'te. Kalıcı hatada (401) retry yapılmadığı, 5xx'te retry tükendiğinde hata verildiği, malformed JSON'da fallback üretilmediği, bağlantı kesilmesi ve timeout'ta sonucun `outcome_unknown` işaretlendiği mock HTTP server testleriyle doğrulandı (12/12).
- Sağlayıcı makbuzu ve `ai_usage_ledger` ile mükerrer maliyet koruması; gerçek model adı/sürümü, prompt sürümü, token kullanımı ve tahmini maliyet saklanıyor. Ham prompt ve ham yanıt saklanmıyor.
- Sistem talimatı sözlüğü ve onaylı örnekleri kanıt olarak veriyor, otomatik doğru olduklarını söylemiyor; eksik kanıt kanalları açıkça bildiriliyor ve `control_required` sunucu tarafında zorlanmaya devam ediyor.
- **Bir tip hatası testle yakalandı ve düzeltildi:** sağlayıcı makbuzunda `run_id` (uuid) ve `request_id` (text) aynı parametreyi paylaşınca PostgreSQL tip çıkaramıyor ve uç 500 dönüyordu; ayrı parametreye ayrıldı.
- Gerçek Gemini smoke'u isteğe bağlı ve manueldir (`scripts/package55-gemini-manual-smoke.mjs`); opt-in olmadan atlanır, CI ve standart kuşak gerçek API anahtarı istemez.
- API testleri 31/31 (dağıtım 12 + Gemini mock 12 + opt-in 7). Ana ağaçta typecheck, lint, **1546 test** (+6 ortam-kapılı UI skip), build + bundle bütçesi, `npm audit --audit-level=moderate` (0 açık) ve `git diff --check` geçti. Paket 54 Chrome smoke'u regresyonsuz tekrar geçti.
- Repository dışındaki temiz kopyada fresh `npm ci` + typecheck + lint + tam test + build geçti; geçici kopya kaldırıldı.

## Paket 54 dilim 2 doğrulama sonucu

- Dilim 1'de eklenen domain modülü artık **runtime tarafından tüketiliyor**: sözleşme, migration 0031, API store/routes/provider harness ve `LaborAllocationAiModule` eklendi. Ölü kod durumu kapandı.
- Öneri föy sürümünden ayrı aggregate'te saklanıyor (`labor_allocation_runs` + `labor_allocation_line_suggestions`); `labor_sheet_versions` bu tablolara bağlanmıyor ve föy kendiliğinden değişmiyor.
- Append-only ve sürüm zinciri DB seviyesinde: run kimliği immutable, terminal run değiştirilemez/silinemez, satır sonuçları hiç güncellenemez/silinemez, `review_required` geçişinde bildirilen satır sayısı trigger'da gerçek satırlarla doğrulanıyor.
- **Tasarım hatası testle yakalandı ve düzeltildi:** idempotency kimliği ilk sürümde tüm statülerde tekildi; bu, sağlayıcı kapalıyken oluşan bir çalıştırmanın analiz anahtarını kalıcı kilitlemesine ve sağlayıcı sonradan açıldığında yeniden denenememesine yol açıyordu. Tekrar koruması `review_required` üzerinde kısmi unique indekse çevrildi.
- Sağlayıcı çıktısı domain doğrulamasından geçmeden hiçbir satır yazılmıyor; doğrulama başarısızsa run `failed` ve satır tablosu boş kalıyor.
- Gizli fallback yok: hata `failed`, bilinmeyen sonuç `outcome_unknown`, bütçe `budget_blocked`, politika kapalı `provider_disabled`. Hepsi `ai_usage_ledger` üzerinde `labor_allocation` modülüyle kaydediliyor. Deterministik harness'e sıfır olmayan sembolik maliyet verildi; aksi halde bütçe kapısı sıfır maliyet yüzünden hiç sınanmıyordu.
- `apply-preview` föyü revize etmiyor; `applied: false` sözleşme seviyesinde literal. Stale kaynak föy sürümü hem analizde hem önizlemede 409 ile reddediliyor.
- Gerçek PostgreSQL API testleri 12/12: workspace taksonomisi, sağlayıcı kapalıyken sahte sonuç üretmeme, tüm satır kapsaması + eksik kanıt → `control_required`, ledger kaydı, idempotency, stale sürüm, üç ayrı sağlayıcı hatasında no-fallback ve sıfır satır, bütçe engeli, tenant izolasyonu, oturumsuz 401, önizlemenin föyü değiştirmemesi, audit/PII sızıntısı yokluğu.
- Migration/DB testleri 61/61 (0031 up/down/reapply, append-only, immutable satır, satır kapsaması, kısmi idempotency indeksi, ledger modül ayrımı). Domain 23/23, sözleşme testleri dahil contracts 298/298, UI paneli 8/8.
- Chrome/CDP smoke (`scripts/package54-browser-smoke.mjs`) geçti: gerçek föyden analiz, iki satırın tamamının kapsanması, `control_required` ve eksik kanıt kodlarının görünmesi, kanonik operasyon türleri, tüm satırlar kontrol gerekliyken toplu seçim butonunun devre dışı olması, satır bazlı seçim, önizlemenin föy sürümünü değiştirmemesi, önerinin ayrı aggregate'te saklanması, taksonomi sürümünün kaydedilmesi, usage ledger yazımı, parça açıklamasının audit'e sızmaması ve API kapandığında bayat sonuç kalmaması. 1920×1080 açık/koyu ve 1366×768 koyu görünümde yatay taşma yok; console warning/error/exception 0.
- Ana ağaçta typecheck, lint, **1527 test** (+6 ortam-kapılı UI skip), build + bundle bütçesi, `npm audit --audit-level=moderate` (0 açık) ve `git diff --check` geçti.
- Tam kuşağın bir koşumunda `CasesPage.api.test.tsx` bir kez zamanlama nedeniyle düştü (dinamik contracts chunk'ı varsayılan 1 sn `waitFor` eşiğini aştı). Tekrar üretilemedi; kalıcı çözüm olarak o beklemeye açık zaman payı verildi — kapsam değil, zamanlama düzeltmesi.
- Repository dışındaki temiz kopyada fresh `npm ci` + typecheck + lint + tam test + build geçti; geçici kopya kaldırıldı.

## Paket 54 dilim 1 doğrulama sonucu

- **Kapsam kararı:** paketin kanıt listesindeki bazı alanlar bu repository'de yok. Migration yazmadan önce şema doğrulandı: araç marka/model/model yılı/şasi prefix/motor alanı hiçbir migration'da yok (`cases` yalnız plaka + tür taşır), `labor_sheet_items` parça/malzeme kodu taşımıyor, yapısal hasar bölgesi alanı yok, ve kodda/dokümanda işçilik maliyet kategorisi seti tanımlı değil. Kategori seti kullanıcıya soruldu ve karara bağlandı (HB-2026-060); diğer eksik kanallar uydurulmadı, eksik kanıt kodlarıyla işaretlenip `controlRequired` zorunlu kılındı.
- Taksonomi kullanıcı kararına göre **iki ayrı yapı**: kanonik operasyon türleri (`labor-operation-types/1.0.0`, `other` dahil sekiz tür) ve ekonomik karşılaştırma kovaları (altı kova, işçilik kategorisi sayılmaz). Hiçbir sigorta şirketi veya Excel sütunu bağlanmadı.
- Onarım–değişim karşılaştırması ortak kovalarla modellendi; bildirilen toplamlar `computeEconomicTotals` ile kovalardan deterministik hesaplanıyor, sağlayıcının kendi aritmetiği kabul edilmiyor.
- `controlRequired` sunucu tarafında yeniden hesaplanıyor: `other` türü, eksik kanıt, çelişki kodu, 0.6 altı güven veya `insufficient_evidence` kanaati kontrolü zorunlu kılıyor.
- Çıktı doğrulaması strict: satır kapsaması (sessiz boş satır yok), tahsis toplamının satır toplamına eşitliği, tekrarlı operasyon türü reddi, PII placeholder/URL/dosya yolu/PII reddi, şema ve taksonomi sürüm kontrolü.
- Dış sağlayıcıya organization/case/sheet kimliği ve plaka çıkmadığı testle doğrulandı; PII minimizasyonu ve outbound hash mevcut Paket 44 altyapısını kullanıyor.
- Domain testleri 23/23. Ana ağaçta typecheck, lint, **1491 test** (+6 ortam-kapılı UI skip), build + bundle bütçesi, `npm audit --audit-level=moderate` (0 açık) ve `git diff --check` geçti.
- **Bu dilim runtime davranışını değiştirmez:** tablo, migration, endpoint veya UI eklenmedi. Saf domain modülü henüz hiçbir çağıran tarafından tüketilmiyor.
- **Kalan dilimler açık** (`IMPLEMENTATION_PLAN.md` Paket 54 dilim 2): sözleşme + fixture, migration 0031, API store/routes/provider harness, UI önizleme ve satır bazlı kabul/ret, gerçek PostgreSQL no-fallback/tenant/stale/audit testleri, Chrome smoke.

## Paket 53 doğrulama sonucu

- Yeni endpoint, tablo veya migration eklenmedi. Mevcut `GET /api/v1/cases` sözleşmesi `page`, `pageSize` (üst sınır 100), arama, tür, durum, aşama, sorumlu, servis, takip aralığı ve sıralama alanlarını zaten taşıyordu; store da filtreleri sayfalamadan önce uygulayıp `id` ile deterministik sıralıyordu. Bu pakette API tarafında davranış değişmedi, kanıt testleri eklendi.
- `pageInfo.totalItems` bilinçli olarak `totalCount` diye yeniden adlandırılmadı: alan aynı bilgiyi taşıyor ve kararlı sözleşme ile golden fixture'ları yalnız adlandırma için değiştirmek işlevsel kazanç sağlamıyordu. İstemci portu değeri `totalCount` adıyla dışa veriyor.
- UI artık API modunda bütün listeyi çekmiyor: `useCases` yalnız mock prototipi besliyor (`enabled: false`), ekran `useCasePage` ile yalnız aktif sayfayı okuyor. Sayfa boyutu 50 ve uyarı `caseIds` sınırının (100) altında.
- Satır uyarı isteği yalnız aktif sayfa kimliklerini gönderiyor; **Paket 52'de kalan "bilinmiyor" satır sınırı kapandı.** Smoke bunu doğruladı: gönderilen kimlik sayısı render edilen satır sayısına eşit ve `.row-alert--unknown` eleman sayısı 0.
- Filtre/arama/sıralama değişince sayfa 1'e dönüyor. Son sayfa küçüldüğünde istemci geçerli son sayfaya çekiliyor; kelepçeleme **istenen** sayfa ile yapılıyor — ilk denemede yüklenmiş eski sayfa ile karşılaştırma uçuştaki sayfa değişimini geri alıyordu, UI testleri bunu yakaladı ve düzeltildi.
- UI durum/takip filtreleri saf `casesQuery.ts` modülünde sunucu alanlarına eşleniyor ("Gecikmiş" → açık + geçmiş takip). API modunda sorumlu/servis filtreleri kimlik bazlı ve gerçek referans uçlarından besleniyor; sunucunun sıralayamadığı sütunlar tıklanabilir sunulmuyor.
- Gerçek PostgreSQL testi 11/11: toplam sayım, iki yönlü tenant izolasyonu (sonuç + sayım), 3 sayfada kayıp/mükerrer kayıt olmaması, eşit değerlerde deterministik sıralama, filtrenin sayfalamadan önce uygulanması, kapalı dosyanın açık listeye girmemesi, boşluksuz plaka ve AND araması, takip aralığı, `pageSize` 100 sınırı ve geçersiz değerlerin 400 dönmesi, aralık dışı sayfa, oturumsuz 401.
- UI testleri: `casesQuery` 14/14, sayfalama davranışı 11/11, satır uyarı göstergesi 7/7.
- Chrome/CDP smoke (`scripts/package53-browser-smoke.mjs`) geçti: 137 kayıttan sayfada yalnız 50 satır render edildi; `pageSize` sözleşme sınırında; toplam sayım sunucudan; uyarı kimlikleri satırlarla birebir eşleşti (sayfa 1, sayfa 2, geri dönüş ve arama sonrası); sayfalar arası mükerrer kayıt yok; arama sunucuda uygulandı; mock plakası DOM'a girmedi; API kapatılınca satır kalmadı. 1920×1080 açık/koyu ve 1366×768 koyu görünümde yatay taşma yok; console warning/error/exception 0.
- Ana ağaçta typecheck, lint, **1468 test** (+6 ortam-kapılı UI skip), build + bundle bütçesi, `npm audit --audit-level=moderate` (0 açık) ve `git diff --check` geçti.
- Repository dışındaki temiz kopyada fresh `npm ci` + typecheck + lint + tam test + build geçti; geçici kopya kaldırıldı.

## Paket 52 doğrulama sonucu

- Yeni endpoint açılmadı: mevcut `GET /api/v1/operational-alerts` ucuna sözleşmeyle sınırlı (`MAX_OPERATIONAL_ALERT_CASE_FILTER` = 100), UUID biçimli, tekil `caseIds` filtresi eklendi. Sınır aşımı, mükerrer ve biçimsiz kimlik 400 döner.
- **Yanlış negatif kapatıldı:** dosya başına özet 200 kırpmasından önce hesaplanır (`deriveOperationalAlerts` → `summarizeOperationalAlertsByCase`) ve `caseSummaries` alanında döner. Filtresiz çağrının yanıtı ve 200 sınırı davranışı değişmedi.
- Gerçek PostgreSQL testiyle senaryo kanıtlandı: 55 gürültülü dosya 200 sınırını yüksek önemli uyarılarla doldurunca, yalnız düşük önemli uyarısı olan dosyalar kırpılmış listede **hiç görünmüyor**; filtreli çağrı aynı dosyalar için doğru sayıyı (1) veriyor.
- Tenant sınırı istemciden gelen kimliklere güvenmiyor: yabancı organization, kapalı ve var olmayan dosya ne uyarı ne özet üretiyor, özete hiç girmiyor. İki yönlü tenant testi geçti.
- UI'da satır toplam uyarı sayısı ve tür ayrımını (geciken görev / geciken takip / eksik evrak) gösteriyor; uyarısız satırda dikkat çekici rozet yok; özeti dönmeyen satır "bilinmiyor" gösteriliyor, "uyarı yok" değil. Hata halinde tüm satırlar uyarısız gösterilmiyor ve footer'da göstergenin yüklenemediği yazıyor.
- Yalnız görünür satırlar soruluyor; arama/filtre değişince sorgu anahtarı değişip yeniden yükleniyor. Mock modda uç hiç çağrılmıyor ve "Uyarı" sütunu gösterilmiyor.
- API tarafı 25/25 (Paket 49 davranış 10, Paket 51 ölçeklenme 6, Paket 52 filtre 9); UI tarafı Dosyalar özelliğinde 83/83.
- Chrome/CDP smoke (`scripts/package52-browser-smoke.mjs`) geçti: filtresiz çağrı 200 sınırında ve sessiz dosyayı içermiyor; satır rozeti buna rağmen doğru sayıyı gösteriyor; tür kırılımı, temiz satırda rozet yokluğu, rozet–API tutarlılığı, yalnız görünür satır sorgusu, 100 sınırı, filtre değişiminde yeniden yükleme, rozetten dosya detayına gidiş ve API kapalıyken hiçbir satırın "uyarısız" gösterilmemesi doğrulandı. 32 sabit mock metni DOM'da yok; 1920×1080 açık/koyu ve 1366×768 koyu görünümde yatay taşma yok; console warning/error/exception 0.
- Ana ağaçta typecheck, lint, **1432 test** (+6 ortam-kapılı UI skip), build + bundle bütçesi, `npm audit --audit-level=moderate` (0 açık) ve `git diff --check` geçti.
- Repository dışındaki temiz kopyada fresh `npm ci` + typecheck + lint + tam test + build geçti; geçici kopya kaldırıldı.
- **Bilinen sınır:** Dosyalar ekranında API modunda gerçek sayfalama yoktur. Filtrelenmiş satır sayısı 100'ü aşarsa gösterge ilk 100 satır için yüklenir, kalan satırlar "bilinmiyor" gösterilir ve tablo altında bu durum yazılır. Gerçek sayfalama ayrı bir pakettir.

## Paket 51 doğrulama sonucu

- Gerçek PostgreSQL üzerinde 100 / 1.000 / 5.000 açık dosya hacimleri ölçüldü; görev, takip ve evrak durumları deterministik karışık dağıtıldı (5.000 dosyada 3.250 görev, 35.750 belge). Tam sayılar ve yöntem: `PERFORMANCE_NOTES.md`.
- **N+1 yok:** sorgu sayısı dosya sayısından bağımsız ve sabit (4 sorgu; açık dosya yoksa 1). Ölçüm bunu 100 → 5.000 dosyada doğruladı.
- Kanıtlanan darboğaz belge sorgusuydu (5.000 dosyada soğuk SQL süresinin ~%76'sı). Sebep sorgu planı değil, binlerce elemanlı `case_id = ANY($2::uuid[])` dizi parametresiydi.
- Uygulanan optimizasyon: belge ve görev sorgularında dosya kimliği dizisi yerine `cases` tablosuna `lifecycle_status='open'` join'i; yalnız length için tutulan `caseIds` dizisi kaldırıldı. Küme birebir aynıdır.
- Sonuç: 5.000 açık dosyada ısınmış toplam süre **382 ms → ~180-190 ms (~%51)**, iki bağımsız örnekte tutarlı. 1.000 dosyada ~74 ms → ~40-50 ms.
- Süreler tek geliştirici makinesinde ölçülmüştür ve koşumlar arası oynaklık gözlenmiştir (1.000 dosyada bir koşumun ısınmış medyanı soğuktan yüksek çıktı). Bu yüzden manşet sayı iki örnekle raporlandı.
- İş kuralları, sıralama, dedupe davranışı ve 200 sınırı değiştirilmedi; cache, materialized view, background worker, yeni tablo veya migration eklenmedi. Paket 49 davranış testleri 10/10 değişmeden geçti.
- Regresyon koruması süreye değil algoritmik sınırlara dayanır (`operational-alerts-scaling.test.ts`, 6 test): sorgu sayısı 25 ve 400 dosyada aynı ve 4; en büyük parametre yükü hacimden bağımsız ve 10 elemandan küçük; boş organization tek sorgu; hacim altında 200 sınırı, mükerrerlik yokluğu, sıralama ve tenant sınırı korunur. Testin gerçekten koruduğu doğrulandı: eski sorgu geri konduğunda parametre yükü iddiası 401 ≠ 26 ile düşüyor.
- Ana ağaçta typecheck, lint, **1407 test** (+6 ortam-kapılı UI skip), build + bundle bütçesi, `npm audit --audit-level=moderate` (0 açık) ve `git diff --check` geçti.
- Repository dışındaki temiz kopyada fresh `npm ci` + typecheck + lint + tam test + build geçti; geçici kopya kaldırıldı.

## Paket 50 doğrulama sonucu

- Durum Panosu uyarı özeti mevcut `GET /api/v1/operational-alerts` ucunu paylaşılan `useOperationalAlerts` hook'u üzerinden kullanır. Yeni endpoint, tablo, migration veya ikinci türetim mantığı eklenmedi.
- Toplam sayaç yalnız API `totalCount` alanından okunur; tür dağılımı veri katmanındaki `countOperationalAlertsByType` ile tek yerde sayılır ve bileşene gömülmez.
- Pano ayrıntılı liste render etmez: özet + en kritik ilk 3 uyarı gösterilir. 200 uyarılı senaryoda önizlemenin 3 satırda kaldığı ve tam listenin render edilmediği UI testiyle doğrulandı.
- Toplam rozeti ve tür kartları Bildirimler ekranına, önizleme satırı ilgili dosya detayına gider.
- Uyarı yoksa nötr boş durum gösterilir; hata halinde sıfır yerine açık hata durumu render edilir ve mock'a düşülmez. Özet yalnız API modunda çalışır, mock modda uç hiç çağrılmaz.
- UI testleri 15/15 geçti (sayaç kaynağı, tür özeti, önizleme sınırı, üç ayrı gezinme yolu, nötr boş durum, hata ve oturum hatası, tek istek, mock modu).
- Chrome/CDP smoke (`scripts/package50-browser-smoke.mjs`) geçti: DOM sayacı API `totalCount` ile eşit; tür sayıları API dağılımıyla birebir; önizleme 3 satırda; tür kartı ve toplam rozeti Bildirimler'e, önizleme dosya detayına gitti; görevler kapatılıp evrak tamamlanınca nötr boş durum göründü; API kapatıldığında sıfır gösterilmedi ve mock'a düşülmedi. 32 sabit mock metni DOM'da bulunmadı; 1366×768 açık/koyu ve 1920×1080 koyu görünümde yatay taşma yok; console warning/error/exception 0.
- İstek mükerrerliği ölçüldü: uyarı ucu 2, Durum Panosu ucu 2 istek. Eşitlik, özetin pano verisinden fazla istek üretmediğini gösterir; 1 yerine 2 olması React StrictMode'un geliştirme modunda effect'leri iki kez çalıştırmasındandır ve mevcut bütün hook'lar için geçerli, üretim build'ini etkilemeyen bir davranıştır.
- Ana ağaçta typecheck, lint, **1401 test** (+6 ortam-kapılı UI skip), build + bundle bütçesi, `npm audit --audit-level=moderate` (0 açık) ve `git diff --check` geçti.
- Repository dışındaki temiz kopyada fresh `npm ci` + typecheck + lint + tam test + build geçti; geçici kopya kaldırıldı.

## Paket 49 doğrulama sonucu

- `operational-alert` domain modülü uyarıları mevcut kaynak veriden deterministik türetir: gecikme kararı `classifyCaseTaskDueDate`, eksik evrak `evaluateDocumentRequirements` sonucundaki `missing` durumundan gelir. Yeni eşik veya kural tanımlanmadı.
- Mükerrerlik `dedupeKey` ile kapalıdır (`overdue_task:{caseId}:{taskId}`, `overdue_follow_up:{caseId}`, `missing_required_document:{caseId}:{requirementCode}`); sıralama önem → kaynak tarih → dosya → anahtar ile deterministiktir ve sonuç `MAX_OPERATIONAL_ALERTS`(200) ile sınırlıdır.
- Evrak etiketleri `email-draft.ts` içindeki özel kopyadan alınıp `DOCUMENT_REQUIREMENT_LABELS` olarak tek kaynağa taşındı; e-posta taslakları aynı haritayı kullanır, ikinci bir etiket seti oluşmadı.
- `GET /api/v1/operational-alerts` salt okunurdur: yalnız oturumun organization'ındaki `lifecycle_status='open'` dosyaları kapsar, durum değiştirmez ve audit yazmaz. Yeni tablo, migration, kuyruk veya arka plan işçisi eklenmedi.
- UI'da Bildirimler API modunda gerçek uyarıları gösterir; sayaç yalnız API sonucundan hesaplanır, boş sonuç gerçek boş durum olarak görünür, hata halinde mock'a düşülmez. Okundu/ertelendi/silindi kontrolü sunulmaz. Mevzuat karantinada kaldı.
- Gerçek PostgreSQL API testi 10/10: 401; audit yazmama; geciken görev/takip ve eksik evrak türetimi; temiz, kapalı ve tamamlanmış kayıtların uyarı üretmemesi; tenant sınırı; mükerrerlik yokluğu; sayaç eşitliği ve determinizm; serbest notun gövdeye ve audit'e sızmaması; boş organization için gerçek boş sonuç.
- Chrome/CDP smoke (`scripts/package49-browser-smoke.mjs`) geçti: gerçek üç uyarı; DOM sayacının API `totalCount` ile eşitliği; yanıtta mükerrer anahtar yokluğu; okundu-durumu kontrolü bulunmaması; tür filtresi; dosya detayına gidiş; Mevzuat karantinası; serbest notun DOM ve audit'e sızmaması; salt okunur ucun audit yazmaması; API kapatıldıktan sonra mock fallback ve bayat uyarı olmaması. 32 sabit mock metni DOM'da bulunmadı. 1366×768 açık/koyu ve 1920×1080 koyu görünümde yatay taşma yok; console warning/error/exception 0.
- Ana ağaçta typecheck, lint, **1386 test** (+6 ortam-kapılı UI skip), build + bundle bütçesi, `npm audit --audit-level=moderate` (0 açık) ve `git diff --check` geçti.
- Repository dışındaki temiz kopyada fresh `npm ci` + typecheck + lint + tam test + build geçti; geçici kopya kaldırıldı.

## Paket 18 doğrulama sonucu

- `0010_case_reference_enrichment` mevcut satırları koruyan nullable `expert_user_id`, `loss_date`, `notification_date` alanlarını ve servis/sigorta aktiflik bayraklarını ekler; LocalDate alanları PostgreSQL `date` kullanır.
- Oturumlu ve organization-kapsamlı dört salt-okunur uç yalnız aktif sigorta/servis/kullanıcıları ve gerçek `expert` rolündeki aktif kullanıcıları döndürür. Pasif veya tenant-dışı referans create/update sırasında alan bazlı reddedilir.
- Case create/update/read ve merkezi audit güvenli alan özetleri yeni alanları taşır; optimistic locking korunur. İhbar tarihi hasar tarihinden önce olamaz.
- API modundaki create/edit formları gerçek referans uçlarını kullanır; sahte fallback yoktur. Pasif mevcut ilişki yalnız değiştirme/temizleme için güvenli açıklamayla görünür.
- Gerçek PostgreSQL migration up/repeat/down-up/constraint testleri 25/25; API entegrasyonu 132/132; canlı API smoke 1/1 ve audit sızıntı sayısı 0 geçti.
- Ana ağaçta typecheck, lint, **676 test** (+6 ortam-kapılı UI skip; canlı Paket 18 testi ayrıca 1/1), build, audit (0 açık) ve diff-check geçti. Domain/contracts/database/API/File Agent çalışma alanlarında skip yoktur.
- Repository dışındaki temiz kopyada fresh `npm ci`, güvenli process ortamındaki `_test` PostgreSQL bağlantısıyla typecheck, lint, 676 test ve build geçti; geçici kopya kaldırıldı.
- Codex Browser bootstrap'ındaki `globalThis.process = processShim` satırı izole araç ortamında uygulama açılmadan `Cannot redefine property: process` verdi; repository kaynaklarında veya Vite bundle'ında `process` yeniden tanımı yoktur. Uygulama kodu değiştirilmeden kurulu Chrome, dependency eklemeyen DevTools protokolü harness'ıyla doğrulandı.
- Gerçek Chrome smoke: API login; yalnız aktif tenant sigorta/servis/kullanıcı/eksper listeleri; Trafik create; `expertUserId`/`lossDate`/`notificationDate` server ve detay formu; ikinci gerçek eksper ve tarihlerle update; stale 409 + reload; pasif ve tenant-dışı referans reddi; API hata halinde mock fallback olmaması geçti. 1366×768 açık/koyu ve 1920×1080 koyu görünümde yatay/dikey body overflow yok, form `overflow-y:auto` politikasını koruyor; console warning/error/exception 0; server ve Chrome süreçleri kapatıldı.

## Paket 17 doğrulama sonucu

- API modunda “Yeni Dosya” formu mevcut `CaseCommandPort` ile POST create ucuna bağlandı. Plaka kanonik gönderilir; payload değişmedikçe aynı Idempotency-Key tekrar kullanılır; gönderim sürerken ikinci istek engellenir. Ofis numarası ve caseId yalnız backend sonucundan gösterilir ve yeni dosya detayına gidilir.
- Dosya Detayı gerçek API modunda desteklenen temel alanları `expectedVersion` ile PATCH eder; yeni version UI state'ine alınır. 409 çakışması güvenli açıklama + “Güncel Veriyi Yükle” sunar. Plaka, tür, ofis no ve lifecycle salt okunurdur; close/reopen yoktur.
- Referans liste uçları olmadığı için sahte seçenek üretilmez: oturum kullanıcısı gerçek sorumlu seçeneğidir; servis/sigorta yalnız açıkça “kimlik” olarak sınırlı giriş alır ve tenant dışı referans alan bazlı reddedilir. Ayrı eksper, hasar tarihi ve ihbar tarihi mevcut Case contract'ında olmadığı için disabled açıklama olarak gösterilir ve gönderilmez.
- Mock Yeni İhbar prototipi değişmedi. API 401/404/validation/409/5xx/ağ hatalarında mock fallback veya ham teknik hata yoktur. Yeni dependency, migration, IPC, File Agent ya da fiziksel dosya yazımı eklenmedi; başarılı create/update audit'i mevcut API transaction'ında oluşur.
- Gerçek PostgreSQL + canlı API/Vite tarayıcı: login; Trafik/Kasko create; idempotent replay; alan bazlı tenant reddi; update; haricî update sonrası stale conflict; reload; tekrar update; logout 401; API kesintisinde mock fallback olmaması geçti. DB'de replay kopyası 1, create audit 4, update audit 5, sızıntı 0 görüldü.
- Tarayıcı görünümü 1366×768 ve 1920×1080 açık/koyu temada gövde taşması olmadan doğrulandı; form modalı footer ve iç scroll erişimini korudu.
- Ana ağaç: typecheck, lint, **662/662 test** (+5 ortam-kapılı UI canlı skip; canlı create/update testi ayrıca 2/2), build, audit (0 açık) ve diff-check geçti. Domain/contracts/database/API/File Agent testlerinde skip yok.
- Temiz kopya: repository dışı, `.git`/`node_modules`/`dist` olmadan fresh `npm ci` + typecheck + lint + 662 test + build geçti; geçici klasör güvenli biçimde kaldırıldı.

## Paket 16 doğrulama sonucu

- Dosya Detayı > Evrak ve Fotoğraf, `CaseDocumentsDataPort` üzerinden sürümlü requirements, tüm sayfalardaki belge sürümü ve fotoğraf metadata'sını okur. API hatasında mock fallback yok; mock prototipin 12/108 fotoğraf davranışı değişmedi.
- Trafik/Kasko/Olay/Rüculu Kasko grupları; present/missing/control_required/not_applicable; alternatif grup gerekçesi ve `2026.07.14.1` kural sürümü görünür. pending/failed/missing fiziksel durumları ayrıdır; doğrulama kanıtı eksik ready reddedilir.
- Güvenlik: yalnız güvenli göreli konum gösterilir; mutlak/UNC/traversal yol adapter sınırında reddedilir. Belge içeriği, hash veya secret UI'ye taşınmaz. Database/contracts/API/IPC/dependency/veri yazma yolu değişmedi.
- Gerçek PostgreSQL + canlı API: adapter login sonrası requirements/documents/detail/photos uçlarını geçti; değerlendirme snapshot sayısı 0, evaluation-audit sayısı 0, audit sızıntı sayısı 0 kaldı.
- Tarayıcı e2e: login; Trafik; rüculu Kasko; rücu belirsizliği; ready/pending/failed/missing; tenant 404; logout sonrası 401; 1366×768 açık/koyu ve 1920×1080 koyu görünüm/scroll kontrolü geçti.
- Ana ağaç: typecheck, lint, **651/651 test** (+5 ortam-kapılı UI canlı skip; canlı Paket 16 testi ayrıca 1/1), build, audit (0 açık) ve diff-check geçti. Domain/contracts/database/API/File Agent testlerinde skip yok.
- Temiz kopya: repository dışı, `.git`/`node_modules`/`dist` olmadan fresh `npm ci` + typecheck + lint + 651 test + build geçti; geçici klasör güvenli biçimde kaldırıldı.

## Paket 15 doğrulama sonucu

- Kural sürümü: `2026.07.14.1`; domain motoruna tarih ve rule set sürümü dışarıdan enjekte edilir, API etkin DB sürümünü seçer.
- Gerçek PostgreSQL: 0009 ileri migration, tekrar güvenliği, down/up geri dönüşü ve CHECK/unique kısıtları geçti.
- Canlı HTTP smoke: login; Trafik/Kasko/rüculu Kasko/rücu belirsizliği; ready/pending/failed; Zabıt/KTT/Beyan; Tramer; tenant 404; 401; response/audit sızıntısı; GET için snapshot/audit yazılmaması geçti.
- Ana ağaç: typecheck, lint, 637/637 test (+4 UI env-kapılı skip), build, audit (0 açık) ve diff-check geçti. Domain/contracts/database/API testlerinde skip yok.
- Temiz kopya: `.git`, `node_modules` ve `dist` olmadan fresh `npm ci` + typecheck/lint/test/build geçti.

## Kabul edilen kapsam

- Durum Panosu
- Dosyalar ve sağ hızlı detay
- Dosya Detayı: Özet, Operasyon, Evrak ve Fotoğraf, İşçilik, Ağır Hasar, Değer Kaybı, Raporlar ve Ücretler, E-postalar, Geçmiş
- Kapanan Dosyalar
- Raporlar ve Ücretler
- Mevzuat ve AI Yardımcısı
- Bildirimler
- Yönetim
- Ayarlar
- Açık/gerçek siyah koyu tema, kompakt/rahat yoğunluk ve daraltılabilir menü
- Normalize genel arama, dosya filtreleri, sıralama, panel/modal ve klavye etkileşimleri
- 1366×768 ve 1920×1080 masaüstü görünümleri

## UAT kapanışı

- Nihai sonuç: **Kabul**
- `UAT-ISSUE-001` — Üst genel arama: **Kapatıldı**
  - Gerçek ofis tekrar testinde `34mpa764` ile Dosyalar ekranına geçildi ve `34 MPA 764` bulundu.
- `UAT-ISSUE-002` — Normalize Dosyalar araması: **Kapatıldı**
  - Gerçek ofis tekrar testinde `34mpa764` bulundu; `ahmet akşam` sorgusu farklı alanlarda AND mantığıyla doğru dosyayı buldu.
- Açık Kritik/Yüksek UAT kaydı: 0

## Test ve build sonuçları

- `npm run typecheck`: Başarılı — UI + domain + contracts + database + API
- `npm run lint`: Başarılı
- `npm run test`: Başarılı — UI 33/33 (+2 env-kapılı canlı smoke ayrı koşuldu, 2/2); domain 257/257; contracts 73/73; database 22/22; API 55/55; **toplam 440/440 (+2 canlı)**
- `npm run build`: Başarılı — UI: Vite 8.1.4, 1.594 modül; JS 354,56 kB (gzip 102,26 kB), CSS 49,16 kB (gzip 8,77 kB). Domain, contracts ve API: ESM JavaScript ve declaration çıktısı üretildi.
- `npm run schema --workspace @hasarbotu/contracts`: Başarılı — self-contained; 6 deterministik JSON Schema `dist/json-schema` altına üretildi (Git'e commit edilmez). Golden fixture'lar `test/fixtures/json-schema` altında commit'lidir.
- `npm audit --audit-level=moderate`: Başarılı — 0 güvenlik açığı
- Temiz checkout (repo dışı kopya, node_modules+dist yok): `npm ci` + typecheck/lint/test/build + API paket-adı import + inject health + gerçek start/health/graceful-stop — 9/9 exit 0
- API runtime smoke (`127.0.0.1:3100`): `GET /health` 200 contracts-uyumlu gövde; bilinmeyen route güvenli `not_found` 404; loglarda secret yok; SIGINT ile tek graceful kapanış; port sonrasında boş

## Git baseline güvenliği

- `node_modules`, `dist`, build/coverage çıktıları, loglar, geçici dosyalar ve cache dışlandı.
- `.env`, yerel ayarlar, credential/secret klasörleri ve özel anahtar uzantıları dışlandı.
- IDE/işletim sistemi gereksiz dosyaları dışlandı; repository'ye özel `.cursor` kuralı takip edildi.
- Kaynak kodu, testler, proje/UAT belgeleri, agent talimatları ve Stitch tasarım referansı baseline kapsamına alındı.
- Gerçek müşteri verisi veya secret bulunmadı.
- Remote eklenmedi ve push yapılmadı.

## UI baseline tarihsel sınırları

- Aşağıdaki maddeler yalnız `v0.1.0-ui-baseline` etiketinin tarihsel kabul kapsamıdır; güncel Paket 42 durumunu anlatmaz.
- Baseline kabulü yalnız UI-first prototipi kapsıyordu.
- Baseline anında backend, Electron, PostgreSQL, pCloud, Gmail, gerçek AI ve dosya sistemi entegrasyonları bulunmuyordu.
- Mock mevzuat yanıtı gerçek hukuki değerlendirme değildir.
- Baseline davranışı sonraki geliştirmelerde referans olarak korunmalıdır.

## Tarihsel sonraki görev

Bu kayıt UI baseline sonrasındaki tarihsel Paket 04 önerisidir; Paket 04–38 ilerlemesi aşağıdaki güncel paket bölümlerinde kayıtlıdır.

## Altyapı mimarisi planlama durumu

### Dal ve baseline

- Çalışma dalı: `architecture/infrastructure-foundation`
- Dal başlangıcı: annotated `v0.1.0-ui-baseline` etiketi
- Kabul edilmiş UI kaynak kodunda değişiklik: Yok
- Commit/push: Yapılmadı
- Kalıcı ürün kararı: Alınmadı; bütün yeni teknoloji/seçim önerileri açık karar kapısı olarak bırakıldı.

### Tamamlanan altyapı belgeleri

- `INFRASTRUCTURE_BLUEPRINT.md`: hedef bileşenler, güven sınırları, on uçtan uca akış ve açık kararlar
- `REPOSITORY_STRUCTURE_PLAN.md`: mevcut repository denetimi, hedef workspace ağacı ve sekiz geri alınabilir geçiş aşaması
- `API_CONTRACT_PLAN.md`: 19 kaynak grubu için endpoint, hata, yetki, audit, idempotency ve concurrency planı
- `DATABASE_MODEL_PLAN.md`: PostgreSQL kavramsal tablo/ilişki, anahtar, indeks, saklama ve transaction planı
- `FILE_STORAGE_AND_AGENT_PLAN.md`: göreceli yol, rootKey, staging/hash, tek yazıcı File Agent, kuyruk/lease/recovery planı
- `DEPLOYMENT_AND_OPERATIONS_PLAN.md`: geçici Windows 11 merkezi, LAN/TLS/servis/sağlık ve kalıcı sunucu geçişi
- `AUDIT_SECURITY_AND_BACKUP_PLAN.md`: auth/RBAC, sır, audit, PII maskeleme, yedek/restore ve felaket kurtarma
- `INFRASTRUCTURE_IMPLEMENTATION_PLAN.md`: tek mimari değişiklikli 23 sıralı uygulama paketi

### Mevcut repository denetimi

- Proje React + TypeScript + Vite tek uygulamasıdır; TypeScript strict yapılandırması korunmaktadır.
- BrowserRouter tabanlı rotalar ve component seviyesinde state kullanılır; global state kütüphanesi yoktur.
- Tema, yoğunluk ve menü tercihleri localStorage; aktif dosya sekmesi sessionStorage kullanır.
- Özellikler doğrudan `src/mocks` verilerine bağlıdır; gerçek API/adapter katmanı bulunmaz.
- Kaynakta fetch/axios/WebSocket, Electron IPC, PostgreSQL, pCloud, Gmail, AI veya gerçek dosya sistemi erişimi bulunmaz.
- Ana geçiş riski, `CaseRecord` içindeki UI gösterim alanları ile domain alanlarının karışması ve feature'ların doğrudan mock importlarıdır.

### Hedef mimari özeti

- Web UI ve ilerideki ince Electron kabuğu yalnız Merkezi API sözleşmesini tüketir.
- Merkezi API kimlik, yetki, iş kuralları, transaction, integration ve audit sınırıdır.
- PostgreSQL ana iş verisi ve iş kuyruğunun kaynağıdır.
- File Agent, tanımlı depolama kökünde kritik fiziksel işlemlerin tek yazıcısıdır.
- Veritabanında `rootKey + relativePath` saklanır; mutlak `P:\` yol kaynak doğruluğu değildir.
- Gmail, AI ve mevzuat entegrasyonları ayrı adapter/servis sınırındadır; kullanıcı onayı gerektiren kararları kendiliğinden kesinleştiremez.
- UI geçişi `Feature UI -> application query/command -> DataPort -> MockDataAdapter | HttpApiAdapter` sınırıyla kademeli yapılır.

### Açık kararlar ve bilinen riskler

- API framework, SQL/query aracı, migration ve runtime validation teknolojileri henüz onaylanmadı.
- npm workspaces kademeli monorepo için öneridir; kalıcı karar değildir.
- Geçici Windows servis sarmalayıcısı, TLS otoritesi, PostgreSQL barındırma ve kalıcı sunucu işletim sistemi açık karardır.
- Oturum modeli, parola hash parametreleri, rol matrisi, audit saklama/bütünlük düzeyi açık karardır.
- RPO/RTO, PostgreSQL PITR ihtiyacı ve pCloud'dan bağımsız fiziksel dosya yedeği ürün/operasyon kararı gerektirir.
- pCloud eşitleme tek başına yedek kabul edilmez; uygulama fiziksel dosya yedeğini otomatik yönetmez.
- UI adapter ayrımında yükleme/hata durumları, DTO/domain sızıntısı ve CSS/route regresyonu baseline testleriyle korunmalıdır.

### Bu planlama turunun kalite durumu

- `npm run typecheck`: Başarılı — exit code 0.
- `npm run lint`: Başarılı — exit code 0.
- `npm run test`: Başarılı — 2 test dosyası, 26/26 test; exit code 0.
- `npm run build`: Başarılı — Vite 8.1.4, 1.594 modül; JS 354,56 kB (gzip 102,26 kB), CSS 49,16 kB (gzip 8,77 kB); exit code 0.
- `npm audit --audit-level=moderate`: Başarılı — 0 güvenlik açığı; exit code 0.
- Runtime/iş mantığı, dependency, IPC, veri modeli ve veri yazma yolu değişikliği: Yok; bu tur yalnız planlama belgeleridir.
- Yapısal belge denetimi: 8/8 zorunlu belge; 10 mimari bileşen; 10 uçtan uca akış; 19 API kaynak grubu; 25/25 zorunlu veritabanı tablosu; 23/23 uygulama paketi ve paket başına 9/9 zorunlu alan.
- Git doğrulaması: Dal `architecture/infrastructure-foundation`; HEAD, `main` ve annotated `v0.1.0-ui-baseline` aynı `ca29f2149643dfad7b115971753b8fb2ac4f9339` commit'inde; commit sayısı 1; remote 0; commit/push yok.
- Fark doğrulaması: `src` altında fark yok; yalnız 8 yeni altyapı belgesi ile `IMPLEMENTATION_PLAN.md` ve `PROJECT_STATUS.md` değişti.
- `git diff --check`: Exit code 0; whitespace hatası yok. Windows çalışma kopyası için beklenen LF -> CRLF uyarıları raporlandı.

## Paket 01 — npm workspace temeli

### Uygulanan yapı

- Root uygulama repository kökünde bırakıldı; `src`, routing, mock veri ve UI yapılandırmaları taşınmadı veya değiştirilmedi.
- Root `package.json` dosyasına yalnız `apps/*`, `services/*`, `packages/*` workspace desenleri eklendi; `private: true` korundu.
- İlk gerçek workspace paketi `packages/config` altında `@hasarbotu/config@0.0.0` olarak oluşturuldu.
- Config paketi private, ESM uyumlu ve runtime dependency içermiyor.
- `packages/config/tsconfig/base.json`, gelecekteki Node/browser paketlerinin ortam özel ayarlarla genişletebileceği ortak tabanı sağlıyor.
- Mevcut root tsconfig dosyaları ortak tabana bağlanmadı; boş `apps` veya `services` paketleri oluşturulmadı.
- `.gitignore` içindeki köklenmemiş `node_modules/`, `dist/`, `build/`, `coverage/`, log, cache, `.env` ve secret kuralları workspace altlarını da kapsadığı için tekrar kural eklenmedi.

### Lockfile ve dependency sonucu

- `npm install`: Başarılı; npm bir workspace linki ekledi ve 230 paketi denetledi.
- `package-lock.json`, root workspaces alanını, `packages/config` kaydını ve `node_modules/@hasarbotu/config` bağlantısını içeriyor.
- Root runtime dependency ve devDependency listeleri değişmedi.
- Önceden mevcut lockfile paket sürümlerinde değişiklik/yükseltme: 0.
- Yeni harici dependency: Yok.

### Doğrulama sonucu

- `npm ls --workspaces --depth=0`: Başarılı — `@hasarbotu/config@0.0.0 -> .\packages\config`.
- `npm run typecheck`: Başarılı.
- `npm run lint`: Başarılı.
- `npm run test`: Başarılı — 2 test dosyası, 26/26 test.
- `npm run build`: Başarılı — Vite 8.1.4, 1.594 modül; JS 354,56 kB, CSS 49,16 kB.
- `npm audit --audit-level=moderate`: Başarılı — 0 güvenlik açığı.
- `git diff --check`: Başarılı; yalnız Windows çalışma kopyası LF -> CRLF uyarıları var.
- `npm run dev -- --host 127.0.0.1 --port 4173 --strictPort` ve UI smoke: Başarılı — HTTP 200; başlık `HasarBotu V2`, ana başlık `Operasyon Durumu`, 8 navigasyon bağlantısı, prototip etiketi görünür, belge yatay taşması ve konsol warning/error yok.
- Smoke testi sonrasında tarayıcı sekmesi kapatıldı ve 4173 portundaki Vite süreci durduruldu.

### Etki ve sınırlar

- `src` dosyası değişikliği: Yok.
- UI runtime/iş mantığı değişikliği: Yok.
- IPC, backend, API, PostgreSQL, Electron, File Agent, domain modeli veya gerçek veri yazma yolu değişikliği: Yok.
- Paket 01 planlama commit'i: `564b267794e49ab92e2c257198d58846bd1a010c`.
- Paket 01 uygulama değişiklikleri `chore: establish npm workspace foundation` mesajlı ayrı commit'te tutulmaktadır.

## Paket 02 — ortak domain çekirdeği

### Uygulanan yapı

- `packages/domain`, `@hasarbotu/domain@0.0.0` adlı private, ESM ve `sideEffects: false` workspace paketi olarak oluşturuldu.
- Paket runtime dependency içermez; React, Vite, Electron, browser API, Node dosya sistemi, ağ, API veya veritabanı import etmez.
- On iki branded kimlik, kararlı makine hata kodlu `ParseResult`, `traffic/casco`, `open/closed`, on operasyon aşaması ve Trafik değer kaybı zorunluluğu eklendi.
- `OfficeCaseNumber`, ayrı ihbar/hasar numaraları, kanonik plaka/arama anahtarı, `UtcDateTime`, `LocalDate`, `EntityVersion` ve presentation alanı içermeyen `CaseCore` eklendi.
- `CaseCore.followUpAt`, UI mocklarında saat bulunması ve `DATABASE_MODEL_PLAN.md` içindeki `follow_up_at timestamptz` nedeniyle `UtcDateTime` olarak modellendi. *(Tarihsel kayıt: HB-2026-005 sertleştirme kararı bu alanı `followUpDate?: LocalDate` olarak değiştirdi.)*
- Optional alanlar bulunmayan alan/`undefined` politikasıyla tanımlandı; `exactOptionalPropertyTypes` ile açık `undefined` ve `null` atamaları engellendi.
- UI henüz domain paketini tüketmiyor; `src` dosyalarında fark yok.

### Belge ve mevcut UI model farkı

- Mevcut UI `CaseRecord.status`, `Açık`, `Beklemede`, `Gecikmiş` ve `Kontrol Bekliyor` değerlerini aynı alanda tutuyor. Son üç değer yaşam döngüsü değil, operasyon/takip sunumudur.
- Ortak domain `CaseStatus` yalnız belgelerce doğrulanmış minimum yaşam döngüsü kodlarını `open` ve `closed` olarak tutar. Kapatılan UI kayıtları hâlen ayrı mock modeldedir; bu görevde UI değiştirilmedi.
- Mevcut UI'nin on Türkçe `CaseStage` değeri ürün belgelerindeki on aşamayla eşleşir. Domain aynı anlamları dil bağımsız İngilizce kodlarla taşır; Türkçe etiket eşlemesi ileride presentation/adaptör katmanında yapılacaktır.

### Test, build ve dependency sonucu

- Domain workspace typecheck: Başarılı.
- Domain workspace test: Başarılı — 8 dosya, 132/132 deterministik test.
- Domain workspace build: Başarılı — `dist` altında ESM JavaScript, `.d.ts` ve `.d.ts.map` üretildi; `dist` Git tarafından ignore ediliyor.
- Root kalite komutları UI ve domain'i kapsıyor; UI testleri bir kez, domain testleri bir kez çalışıyor.
- Root test sonucu: 26 UI + 132 domain = 158/158.
- Root UI build boyutları baseline ile aynı kaldı.
- `npm install`: Bir yerel workspace linki eklendi; harici paket eklenmedi veya mevcut dependency sürümü yükseltilmedi.
- `npm audit --audit-level=moderate`: 0 güvenlik açığı.
- UI smoke: HTTP 200; `HasarBotu V2`, `Operasyon Durumu`, 8 navigasyon bağlantısı ve `UI Prototip · Mock Veri` doğrulandı; belge yatay taşması ve konsol warning/error yok; sekme kapatıldı ve 4173 portu boş bırakıldı.

### Açık kararlar ve sonraki sınır

- Dış kimliklerin gelecekte UUID veya ULID olması Paket 02'de kararlaştırılmadı.
- `CaseStatus` için `open/closed` dışındaki olası yaşam döngüsü değerleri belge kararı olmadan eklenmedi.
- API DTO biçimleri, unknown alan politikası, genel runtime validation kütüphanesi ve OpenAPI üretimi Paket 03'e bırakıldı.
- Backend, IPC, PostgreSQL, Electron, File Agent ve gerçek veri yazma yolu değişmedi veya eklenmedi.

## Paket 03 — sözleşmeler ve doğrulama

### Uygulanan yapı

- `packages/contracts`, `@hasarbotu/contracts@0.0.0` adlı private, ESM ve `sideEffects: false` workspace paketi olarak oluşturuldu. Kaynak düzeni `src/common`, `src/health` ve sürümlü `src/v1/cases`'tir.
- Runtime doğrulama yalnız Zod 4 (`zod@4.4.3`) ile yapılır; yeni runtime dependency yalnız `zod` ve workspace `@hasarbotu/domain`'dir.
- Ortak primitive şemaları (ayrı `caseId`/`userId`/`serviceId`/`insurerId` kimlikleri, `CaseType`, `CaseStatus`, `CaseStage`, `OfficeCaseNumber`, ihbar/hasar no, plaka, `UtcDateTime`, `LocalDate`, `EntityVersion`), `ok`/`data`/opsiyonel `meta` başarı zarfı ve `ok`/`error` hata zarfı, kararlı hata modeli ve güvenli `zodErrorToApiError` dönüştürücüsü eklendi.
- Sayfa tabanlı pagination (`page`=1, `pageSize`=25, maksimum 100), sıralama, `/health` yanıtı (`status: ok|degraded`, `service`, `version`, `checkedAt`), sürümlü `/api/v1` read-only Cases sorgu/liste/detay sözleşmeleri ve route sabitleri eklendi.
- Domain↔DTO dönüşümü saf mapper'larla açık yapılır: opsiyonel ilişkiler domainde `undefined`, wire'da tutarlı `null`; domain `followUpAt` alanı wire'da `followUpDate` olarak taşınır.
- Public object şemaları `strict`'tir; kontrolsüz coercion (`z.coerce`) kullanılmaz; hata nesnesi ham girdi taşımaz.
- Zod 4 yerleşik `z.toJSONSchema` ile 6 deterministik JSON Schema `dist/json-schema` altına üretilir; `dist` Git tarafından ignore edilir.

### followUp alanı kararı

- **Güncel durum (HB-2026-005 ile değişti):** Takip günlük tarihtir. Domain `CaseCore.followUpDate?: LocalDate` taşır; `followUpAt` kaldırılmıştır. Wire `followUpDate: string | null` (LocalDate) ve query `followUpFrom`/`followUpTo` LocalDate'tir; timezone dönüşümü yapılmaz.
- Tarihçe: Paket 02/03 turlarında bu alan `UtcDateTime` olarak modellenmişti (HB-2026-003/004); sertleştirme turundaki ürün kararı bunu geçersiz kıldı.

### Test, build ve dependency sonucu

- Contracts workspace typecheck/test/build/schema: Başarılı.
- Contracts test: 8 dosya, 48/48 test. Root test: 26 UI + 132 domain + 48 contracts = 206/206; mevcut 158 korundu.
- Contracts build: `dist` altında ESM JavaScript, `.d.ts` ve `.d.ts.map` üretildi; JSON Schema `dist/json-schema` altına 6 dosya olarak üretildi; ikisi de Git tarafından ignore edilir.
- `npm install`: 2 paket eklendi (`zod` ve bağımlılığı); mevcut lockfile sürümlerinde yükseltme yok. Root `prepare` scripti install sonrası domain→contracts build sırasını garanti eder.
- `npm audit --audit-level=moderate`: 0 güvenlik açığı.
- Root UI build boyutları baseline ile aynı kaldı; `npm run dev` davranışı değişmedi.
- UI smoke: HTTP 200; `HasarBotu V2`, 8 navigasyon bağlantısı ve pano içeriği doğrulandı; konsolda yalnız Vite/React bilgi mesajları, warning/error yok; sekme kapatıldı ve 4173 portu boş bırakıldı.

### Etki ve sınırlar

- `src` (UI) ve `packages/domain` kaynak değişikliği: Yok.
- Çalışan HTTP sunucusu, veritabanı, auth, Electron, File Agent, UI adaptörü ve yazma endpoint'i: Oluşturulmadı.
- `version` taşıma yöntemi (`If-Match`/body), idempotency uygulaması, authentication ve tam OpenAPI üretimi Paket 04+'a bırakıldı.
- Remote eklenmedi; push/merge/tag yapılmadı.

## Proje çapında sertleştirme turu (2026-07-11)

### Uygulanan düzeltmeler

- Takip tarihi semantiği: domain `followUpDate?: LocalDate`; `followUpAt` kaldırıldı; wire ve query LocalDate; timezone dönüşümü yok (HB-2026-005).
- Kimlik güvenliği: domain + wire kimlikleri 1..128 güvenli ASCII; `/`, ters bölü, `..`, boşluk, kontrol karakteri reddi — kimlik dosya yolu olamaz.
- Referans numaraları: max 128, kontrol/backslash reddi, en az bir alfasayısal; `11/18882475` desteklenir; path olarak kullanılamayacağı belgelendi.
- Plaka max 32; `page` 1..10.000; NaN/Infinity/ondalık/string/boolean sayı alanlarında testli reddedilir.
- `unrecognized_keys` hataları reddedilen alan ADLARINI güvenli biçimde raporlar (max 10 anahtar, 64 karakter kırpma, kontrol temizliği; değer asla taşınmaz).
- `zod` tam `4.4.3` pinlendi; lockfile doğrulandı; başka dependency yükseltilmedi.
- JSON Schema/runtime paritesi: ifade edilebilir kurallar pattern/min/max ile şemada; runtime-only kurallar `x-hasarbotu-runtime-validation` metadata'lı; JSON Schema tek başına güvenlik sınırı değildir (README'de belgeli).
- Golden JSON Schema fixture'ları commit'lendi; regresyon testi eklendi; güncelleme yalnız açık `schema:fixtures` script'iyle.
- Root `typecheck`/`test`/`build` dist artıklarından bağımsızlaştırıldı; `build:packages` domain→contracts sırasını tekilleştirir; `npm run dev` değişmedi.

### Doğrulama

- 350/350 test (26 UI + 257 domain + 67 contracts); bütün kapılar exit 0; temiz worktree'de `npm ci` + tüm kapılar + paket-adı import smoke geçti.
- UI davranış denetimi (değişiklik yapılmadan): 1366×768 taşmasız (açık/koyu), üst arama `34mpa764` → `/dosyalar?q=...` tek doğru satır, Hızlı Bakış + Escape, tema persist, konsol temiz.
- Ayrıntılı bulgu/kanıt: `PROJECT_WIDE_AUDIT.md`.

## Paket 04 — merkezi API iskeleti (2026-07-12)

### Uygulanan yapı

- `services/api` altında `@hasarbotu/api@0.0.0`: private, ESM, `sideEffects: false`, `engines >=24 <25`. Runtime dependency yalnız `@hasarbotu/contracts` ve tam pin `fastify@5.10.0`; dev araçları tam pin `tsx@4.23.0` ve `@types/node@24.13.3`.
- `buildApp` (saf fabrika, port dinlemez, clock/log enjekte edilebilir) ile `startServer` (config → listen → SIGINT/SIGTERM tek-kapanışlı graceful shutdown) ayrıldı; import otomatik sunucu başlatmaz.
- Config sınırı: `HOST=127.0.0.1`, `PORT=3100` (açık parser, 1..65535), `LOG_LEVEL`, `NODE_ENV`; geçersiz config'te başlatma yok; hata çıktısı ortam değeri taşımaz; dotenv yok.
- Güvenli varsayımlar: `trustProxy:false`, body limit 1 MiB, request timeout 30 sn, Fastify-üretimi request ID, yapısal log redaksiyonu (authorization/cookie/set-cookie/x-api-key).
- `GET /health` contracts şemasıyla parse edilerek döner (`hasarbotu-api`, paket sürümü, Clock adapterlı `checkedAt`); gerçek DB kontrolü yok. 404 ve beklenmeyen hatalar contracts failure envelope ile (`not_found`/`internal_error` + gerçek requestId); ham exception/stack sızmaz.
- Root scriptler: `dev` değişmedi; `dev:api` eklendi; typecheck/test/build zincirleri domain → contracts → api sırasını deterministik kurar; testler tek sefer koşar.
- UI `src` değişmedi; ayrıntılı mimari `API_RUNTIME_FOUNDATION.md`.

## Paket 04.5 — kasko poliçe analizi ve iş kuralları (2026-07-12, yalnız dokümantasyon)

- Yeni belgeler: `CASCO_POLICY_ANALYSIS_PLAN.md` (uçtan uca poliçe işleme + analiz hattı + muafiyetli dosya akışı), `CASCO_POLICY_CANONICAL_MODEL.md` (kanonik alanlar + 14 `policy_*` veri kavramı + izlenebilirlik), `CASCO_POLICY_SCENARIO_RULES.md` (senaryo kural yapısı + dört durumlu kapsam sonucu + AI sekiz bölümlü cevap standardı).
- Bağlayıcı iş kuralları HB-2026-007 ile kayıtlı: poliçenin tamamı karar kaynağıdır; "muafiyetsiz" alanı koşullu kloz muafiyetini dışlamaz; çelişkide sessiz seçim yok; AI tahmin yürütmez ("poliçede açık hüküm bulunamadı"); değer kaybında mevzuat/ofis kuralı ayrımı; parça bedeli KDV hariç + iskontosuz ve izlenebilir; muafiyetli dosyada sekiz adımlı akış (tedarik/mobil onarım engeli dahil).
- Güncellenen belgeler: DOMAIN_RULES, PRODUCT_REQUIREMENTS, DATABASE_MODEL_PLAN (§4.1 policy kavramları; §5.5/5.5a), API_CONTRACT_PLAN (§9), SECURITY_AND_AI_POLICY, TESTING_AND_ACCEPTANCE (+2 yayın engelleyici, +5 kasko poliçe senaryosu), DECISION_LOG, INFRASTRUCTURE_IMPLEMENTATION_PLAN, IMPLEMENTATION_PLAN.
- Runtime kodu, API, domain paketi, package.json, lockfile ve migration değişmedi; test sayısı 379/379 korunuyor.

## Ana yol haritası mutabakatı (2026-07-12, yalnız dokümantasyon)

- Harici ana yol haritası DOCX'i (12 Temmuz 2026, 33 bölüm) repo kararlarıyla uçtan uca karşılaştırıldı; sonuç `MASTER_ROADMAP_ALIGNMENT.md`: 21 güncelleme işlendi (G1-G21), 7 nokta eleştirel değerlendirmeyle karara bağlandı veya açık bırakıldı (K1-K7).
- Öne çıkanlar: beş durumlu kapsam sonucu; mini/mobil onarım ayrımı; muafiyet akışında geçici durdurma + maliyet paylaşımı seçeneği; 26 `policy_*` veri kavramı; dokuz bölümlü AI cevabı; AI varsayılan-kapalı bütçe politikası; fiziksel dosyaların bağımsız yedek kapsamına alınması; 12 zorunlu kasko senaryo testi; ilk sigorta şirketi Türkiye Sigorta.
- **Açık ürün kararı (Paket 05 öncesi):** dosya durumu (`open/closed` vs 4'lü liste) ve aşama seti (K1/K2) — domain kodu bilinçli olarak değiştirilmedi.
- Karar kaydı HB-2026-008; runtime kodu/dependency değişmedi; 379/379 test korunuyor.

## Paket 05 — PostgreSQL ve migration temeli (2026-07-12)

- **PostgreSQL 17.10** ofis Windows 11 makinesine servis olarak kuruldu (kullanıcı onaylı); Türkçe locale initdb hatası `UTF8 + ICU tr-TR` manuel cluster ile çözüldü. Roller: `hasarbotu_app`→`hasarbotu`, `hasarbotu_test`→`hasarbotu_test`; şifreler yalnız `%USERPROFILE%\.hasarbotu\` altında.
- Yeni workspace `packages/database` (`@hasarbotu/database`): tam pin `pg@8.22.0` + `node-pg-migrate@8.0.4`; açık DATABASE_URL parser'ı (değer sızdırmaz, `redactDatabaseUrl` maskeler), pg.Pool fabrikası, sınırlı süreli sağlık kontrolü, programatik+CLI migration koşucusu, **UUIDv7** üreteci (kullanıcı onaylı; kimlik üretimi persistence katmanında).
- İlk migration: `organizations` (uuid PK, unique+biçim kısıtlı `code`, `version>=1`); `pgmigrations` durum tablosu.
- Entegrasyon kanıtları (gerçek DB): boş DB ileri migration; tekrar güvenliği (0 adım); sıra uyuşmazlığı reddi; hatalı migration'ın transaction'la iz bırakmadan geri alınması; kısıt ihlalleri (23505/23514); sağlık kontrolü. Test kapısı: `TEST_DATABASE_URL` zorunlu `_test` soneki — üretim DB'si testte reddedilir.
- API: opsiyonel `DATABASE_URL` ile health gerçek DB ping'inden `ok`/`degraded` üretir (canlı kanıt: doğru port→ok, yanlış port→degraded; loglarda şifre 0 eşleşme); havuz graceful shutdown'da kapanır; URL yokken Paket 04 davranışı korunur.
- Yedek/geri yükleme smoke: `pg_dump`→ayrı DB'ye `pg_restore`→satır eşitliği (2=2) doğrulandı; geçici DB/dump temizlendi. Operasyon kaydı: `DATABASE_OPERATIONS.md`; karar: HB-2026-009.

## Paket 06 — kullanıcılar, roller ve oturum (2026-07-12)

- Kimlik: e-posta+şifre, Argon2id (m=19456, t=2, p=1); tekdüze 401 + zamanlama eşitleme (enumeration koruması).
- Oturum: sunucu taraflı, iptal edilebilir; token yalnız SHA-256 hash'iyle saklanır; TTL 12 saat; hb_session çerezi HttpOnly+SameSite=Strict (+prod Secure); logout idempotent 204.
- Koruma: hesap kilidi 5 hata/15 dk (DB kalıcı + audit) ve IP başına 10/dk login sınırı (429 rate_limited + Retry-After).
- Şema 0002: users (lower(email) unique), 6 rol kataloğu + user_roles, sessions, append-only audit_events; audit'e ham parola/token/e-posta yazılmaz.
- Contracts: auth login/logout/session şemaları + rate_limited kodu; golden fixture seti 8 şema. Auth yalnız DATABASE_URL'li API'de kayıtlı; aksi halde güvenli 404.
- Kanıt: gerçek DB üzerinde 14 uçtan uca auth testi (login/cerez/session/logout-revoke/kilit/429/404) + audit satırları. Karar: HB-2026-011.

## Paket 07 — dosyalar salt okunur API (2026-07-12)

- Migration 0003: cases (lifecycle_status open|closed + workflow_stage; office_year/sequence/number çift benzersiz; plate_normalized indeksli; follow_up_date date) + service_centers + insurers; planlanan indeksler kuruldu.
- GET /api/v1/cases ve /:caseId: oturum zorunlu (401), tenant kapsamlı (yabancı org 404), contracts sorgusu birebir (filtreler, çok-kelimeli AND arama, NULLS LAST sıralama, pageInfo), yanıtlar şema-parse'lı; endpoint salt okunurdur.
- Kanıt: 9 uçtan uca test (401/filtreler/aralık/arama/sıralama/sayfalama/strict-400/detay-404-400-tenant) + canlı HTTP smoke (login → ?search=34mpa764 → kanonik gövde). Karar: HB-2026-012.

## Paket 08 — UI mock/API adapter ayrımı (2026-07-12)

- `src/data` DataPort sınırı: MockDataAdapter (varsayılan), HttpApiAdapter (salt okunur Cases API + DTO→CaseRecord eşleme), güvenli fallback sarmalayıcısı, `useCases` kancası (ilk render daima mock ile özdeş; `hasarbotu-data-source=api` opt-in).
- Dosyalar/Dosya Detayı porta bağlandı; Dashboard/Kapanan/Raporlar kademeli plan gereği mock'ta. Vite dev proxy `/api`→3100 (SameSite=Strict çerez aynı-origin). Durum çipi/takip görüntüsü türetilmiş görünüm (HB-2026-010).
- Kanıt: 26 baseline UI testi değişmeden; +7 veri katmanı testi; canlı API smoke 2/2 (oturumla gerçek eşleme, oturumsuz 401→fallback); tarayıcıda varsayılan mod baseline ile özdeş, api modunda oturumsuz fallback aynı 12 satır, konsolda yalnız info. Karar: HB-2026-013.

## Paket 09 — dosya yazma uçları (2026-07-13)

- Contracts: `caseCreateRequestSchema` (strict; `caseType`, `plate`, `workflowStage` default `new_notification`, opsiyonel ihbar/hasar no + sorumlu/servis/sigorta/takip) ve `caseUpdateRequestSchema` (zorunlu `expectedVersion` + nullable-opsiyonel alanlar + en az bir alan kuralı). Ofis numarası, `lifecycle_status`, plaka ve dosya türü komutla DEĞİŞTİRİLEMEZ. `IDEMPOTENCY_KEY_HEADER` sabiti; golden JSON Schema hedefi 8 → 10.
- Migration 0004: `office_counters` (firma+yıl PK, yıl 2000-9999, `last_sequence>=0`) ve `idempotency_keys` (org+scope+key benzersiz, saklanan yanıt gövdesi + durum).
- Kritik işlem modeli tek transaction: referans kontrolü → ofis numarası UPSERT ... RETURNING → kayıt → A1 audit → idempotency kaydı → COMMIT. Ofis numarası firma+yıl sayacından monoton atanır; başarısız transaction sayacı TÜKETMEZ ve numara ASLA yeniden dağıtılmaz. Güncelleme `SELECT ... FOR UPDATE` + `expectedVersion` ile optimistic locking (uyuşmazlıkta 409 `version_conflict`). Audit yalnız güvenli özet taşır (ofis no/tür, değişen alan adları/sürüm); plaka/PII yazılmaz.
- POST `/api/v1/cases`: oturum zorunlu, `Idempotency-Key` zorunlu (yoksa 400), aynı anahtar+aynı gövde saklanan yanıtı aynen döner, aynı anahtar+farklı gövde 409 `idempotency_conflict`. PATCH `/api/v1/cases/:caseId`: oturum zorunlu, tenant kapsamlı (yabancı org 404), bilinmeyen referans 400.
- Kanıt: 9 uçtan uca gerçek-DB write testi (201+sıralı ofis no+audit; idempotent tekrar kopyasız; farklı gövde 409; anahtar zorunlu; eşzamanlı 5 oluşturma benzersiz+sıralı; geçersiz referans 400 + sayaç tüketilmez rollback; güncelleme sürüm+temizleme+audit; bayat sürüm 409 + veri ezilmez; sınırlar 400/404/401/strict). Canlı HTTP smoke 7/7 (login → create → replay → idempotency_conflict → bayat 409 veri korunur → doğru sürüm 200 → anahtarsız 400). Karar: HB-2026-015.

## Test ve build sonuçları (Paket 09)

- `npm run typecheck`: Başarılı — UI + domain + contracts + database + API.
- `npm run lint`: Başarılı.
- `npm run test` (TEST_DATABASE_URL ile): Başarılı — UI 39/39 (+2 env-kapılı skip); domain 257/257; contracts 75/75; database 22/22 (0004 migration + `idempotency_keys` + `office_counters` doğrulandı); API 64/64 (9 write testi dahil); **toplam 457/457 (+2 skip)**.
- `npm run build`: Başarılı — Vite 8.1.4, 1.599 modül; JS 358,00 kB (gzip 103,49 kB), CSS 49,16 kB (gzip 8,77 kB); 4 workspace paketi ESM+declaration üretti.
- `npm audit --audit-level=moderate`: Başarılı — 0 güvenlik açığı.
- `git diff --check`: Exit 0; yalnız beklenen LF→CRLF uyarıları.
- Canlı yazma smoke: gerçek TCP dinleyici + gerçek `fetch` ile 7/7 senaryo geçti.

## Paket 10 — UI oturum yönetimi ve gerçek API entegrasyonu (2026-07-13)

- İki mod ayrımı (baseline korunur): `mock` (varsayılan) oturum kapısız demo kaynağıdır ve UI baseline'i aynen render eder; `api` mod gerçek oturum gerektirir. Mock, api hatasını maskelemez; sahte oturum uydurulmaz (HB-2026-014/016).
- Oturum sınırı `AuthPort` (`src/data/authPort.ts`): bootstrap/login/logout gerçek `/api/v1/auth/*` uçlarına bağlanır. Oturum HttpOnly çerezle sunucuda tutulur; parola/token UI'da saklanmaz. `SessionProvider` (`src/app/session.tsx` + `sessionContext.ts`) açılışta bootstrap eder; `LoginPage` yalnız api modda ve oturum yoksa/sona erdiyse gösterilir; korumalı rotalar yalnız kimlikli oturumda açılır.
- 401 güvenli akışı: veri katmanı api modda 401 gördüğünde oturum `expired` olur ve "Oturumunuz sona erdi" notuyla login'e dönülür (`useCases` → `reportUnauthorized`). Login hataları ayrımlı: geçersiz kimlik / rate limit (Retry-After) / servis kullanılamıyor. Topbar api modda gerçek kullanıcı + çıkış düğmesi gösterir; mock modda "UI Prototip · Mock Veri" baseline'i korunur.
- Yazma sınırı `CaseCommandPort` (`src/data/commandPort.ts`): create (Idempotency-Key) + update (`expectedVersion`) Paket 09 uçlarına bağlanır; hata eşlemesi (unauthorized/validation/unknown_reference/version_conflict/idempotency_conflict/not_found/unavailable). Onaylı prototipte create/update ekranı olmadığından yeni ekran tasarlanmadı — yalnız komut sınırı + güvenli altyapı kuruldu. Mock komut adapteri demo modda yazma yapmaz.
- Kapsam dışı (uygulanmadı): Google girişi, şifre sıfırlama, e-posta gönderimi, fiziksel klasör işlemleri, case close/reopen, File Agent, poliçe motoru, UI yeniden tasarımı. Karar: HB-2026-016.

### Test ve build sonuçları (Paket 10)

- `npm run typecheck`: Başarılı — UI + domain + contracts + database + API.
- `npm run lint`: Başarılı — 0 uyarı (oturum context/kanca ayrı modülde; fast-refresh temiz).
- `npm run test` (TEST_DATABASE_URL ile): Başarılı — UI 70/70 (+4 env-kapılı canlı skip); domain 257/257; contracts 75/75; database 22/22; API 64/64; **toplam 488/488 (+4 skip)**. Yeni: +31 UI testi (authPort, commandPort, SessionProvider, App oturum kapısı).
- `npm run build`: Başarılı — Vite 8.1.4, 1.604 modül; JS 364,54 kB (gzip 105,46 kB), CSS 50,93 kB (gzip 9,00 kB).
- `npm audit --audit-level=moderate`: Başarılı — 0 güvenlik açığı. `git diff --check`: Exit 0.
- Gerçek API uçtan uca (canlı server + seed'li test DB): `auth.live.test.ts` login → bootstrap → liste → create → update → logout → çıkış sonrası 401; 2/2.
- Tarayıcı uçtan uca (Vite dev + `/api` proxy → gerçek API): api modda login kapısı → seed'li gerçek dosya listesi (34 MPA 764 / 06 ABC 123) → Topbar "Operatör Kullanıcı" + "Oturumu kapat" → çıkış → tekrar login; konsolda hata yok.

## Paket 11 — merkezi audit altyapısı (2026-07-13)

- Tek merkezi `AuditService.record(executor, event)` mevcut `audit_events` tablosuna yazar (paralel sistem yok). Alanlar tabloya birebir: organizationId, actorUserId, action, entityType, entityId, requestId, occurredAt, redaksiyonlu details (eski/yeni değer veya güvenli özet). `record` executor (havuz/transaction istemcisi) aldığından audit ilgili iş yazımıyla **atomik** yazılır.
- Migration 0005: `audit_events` üzerinde `BEFORE UPDATE/DELETE` trigger'ı ile **append-only** veritabanı seviyesinde zorlanır; kiracı/varlık sorgu indeksleri eklendi. Uygulamada güncelleme/silme ucu yoktur.
- Redaksiyon (`src/audit/redact.ts`): parola/token/cookie/session/hash/apiKey/kart/IBAN/tam poliçe metni/özel anahtar alan ADına göre `[redacted]`; aşırı uzun metin kırpılır; derinlik/eleman sınırı. `summarizeChange` güvenli eski/yeni özet.
- Merkeze taşınan olaylar: login (başarılı/başarısız/rate-limit/kilit), logout (oturum iptaliyle atomik) ve case create/update. `store.insertAudit` kaldırıldı; auth yazımları `withTransaction` ile atomik.
- Salt-okunur sorgu API'si `GET /api/v1/audit-events`: oturum + **yönetici** rolü (aksi halde 403), kiracı-kapsamlı, strict filtre (action/actorUserId/entityType/entityId/tarih aralığı) + sınırlı sayfalama. Yazma ucu yok.
- Retention/export yalnız plan (`AUDIT_SECURITY_AND_BACKUP_PLAN.md` §6.5). Kapsam dışı: UI audit ekranı, case close/reopen, File Agent, SIEM, üretim migration çalıştırması. Karar: HB-2026-017.

### Test ve build sonuçları (Paket 11)

- `npm run typecheck`: Başarılı — UI + domain + contracts + database + API.
- `npm run lint`: Başarılı — 0 uyarı.
- `npm run test` (TEST_DATABASE_URL ile): Başarılı — UI 70/70 (+4 skip); domain 257/257; contracts 77/77 (golden 12); database 22/22 (0005 dahil); API 81/81; **toplam 507/507 (+4 skip)**. Yeni: +17 API testi (append-only reddi, redaksiyon, atomik rollback, merkezi olaylar, sorgu filtre/pagination, kiracı izolasyonu, 401/403) + redaksiyon birim testleri.
- `npm run build`: Başarılı — Vite 8.1.4, 1.604 modül; 4 workspace paketi ESM+declaration.
- `npm audit --audit-level=moderate`: Başarılı — 0 güvenlik açığı. `git diff --check`: Exit 0.
- Gerçek PostgreSQL güvenlik testleri: append-only UPDATE/DELETE reddi, redaksiyon DB round-trip, parola/oturum-token sızıntısı 0, kiracı izolasyonu.
- Canlı HTTP güvenlik smoke (çalışan server + seed'li test DB): admin sorgu 200 + olaylar, kiracı kapsamı, parola sızmaz, action filtresi, yönetici-olmayan 403, oturumsuz 401, append-only UPDATE/DELETE reddi — 7/7.

## Paket 12 — depolama referansı ve güvenli göreli yol temeli (2026-07-13)

- Konum modeli yalnız mantıksal `storageRootKey` + POSIX `relativePath`. Mutlak `P:\`, sürücü harfi veya UNC yolu DB/API/audit/log'a ASLA girmez; cihaz→mutlak eşleme yalnız yerel File Agent/config'te.
- Domain `parseRelativePath` (güvenlik sınırı): traversal `..`, absolute, sürücü ön eki, UNC/backslash, kontrol karakteri, Windows yasak karakter/aygıt adı, boş segment ve segment başı/sonu boşluk/nokta reddi; Türkçe ad ve iç boşluk geçerli. +35 birim testi.
- Migration 0006: `storage_roots` (org+key benzersiz, slug CHECK, mutlak yol kolonu YOK), `case_locations` (vaka başına tek, `version` optimistic lock, composite FK ile kök org'da, `(org,root,path)` benzersiz, `relative_path` güvenlik CHECK'i), `case_location_history` (append-only trigger + CHECK).
- API (oturum + kiracı kapsamlı): `GET /storage-roots`; `GET/PUT /cases/:caseId/location` (PUT optimistic locking, ilk atama v1, uyuşmazlık 409, bilinmeyen/pasif kök 400 unknown_reference, yabancı org 404); `GET .../location/history` (sınırlı pagination). Atama tek transaction'da güncel konum + append-only geçmiş + merkezi audit (Paket 11) atomik. `verificationStatus` istekle set edilemez; atamada `pending` (fiziksel doğrulama File Agent'ta, bu pakette YOK).
- pCloud/`P:\BARAN GLOBAL EKSPERTİZ` mevcut kök olarak belgelendi (`FILE_STORAGE_AND_AGENT_PLAN.md` §2); mantıksal rootKey sayesinde başka disk/NAS köküne geçiş yalnız yerel config değişikliğidir. Kapsam dışı: gerçek klasör oluşturma/taşıma, File Agent, P: tarama, close/reopen, Electron, fiziksel yükleme, UI. Karar: HB-2026-018.

### Test ve build sonuçları (Paket 12)

- `npm run typecheck`: Başarılı. `npm run lint`: Başarılı — 0 uyarı.
- `npm run test` (TEST_DATABASE_URL ile): Başarılı — UI 70/70 (+4 skip); domain 292/292 (+35 storage-path); contracts 81/81 (golden 16); database 22/22 (0006 dahil); API 93/93 (+12 storage); **toplam 558/558 (+4 skip)**.
- `npm run build`: Başarılı — Vite 1.604 modül; 4 workspace paketi ESM+declaration. `npm audit`: 0 açık. `git diff --check`: Exit 0.
- Gerçek PostgreSQL güvenlik testleri: DB CHECK traversal/mutlak/backslash reddi, geçmiş append-only UPDATE/DELETE reddi, kiracı izolasyonu, audit'te mutlak yol 0.
- Canlı HTTP güvenlik smoke (çalışan server + seed'li test DB): roots + atama/değiştirme/optimistic-lock + traversal/sürücü/bilinmeyen-kök reddi + geçmiş + audit-no-absolute + DB savunması — 10/10.

## Paket 13 — belge, belge sürümü ve fotoğraf metadata temeli (2026-07-13)

- Model (Migration 0007): `documents` (mantıksal slot, optimistic `version`), `document_versions` (immutable kayıtlı gerçek + doğrulama durumu + önceki sürüm ilişkisi), `photos` (bağımsız kayıt); org/case tenant izolasyonu, UUIDv7. Alanlar: orijinal ad, güvenli gösterim adı, uzantı, MIME, byte boyutu, SHA-256 (beyan), storageRootKey + güvenli göreli yol (mutlak yol yok), belge türü + kaynak türü.
- Durum modeli `pending|ready|failed|missing`; kayıt daima `pending`. Registration `status`/doğrulama alanlarını içermez — istemci `ready`'yi belirleyemez. DB CHECK `ready`'yi yalnız `hash_verified AND size_verified AND verified_at` iken mümkün kılar. `content_hash` istemci beyanıdır, doğrulanmış değil.
- `metadata_append_guard` trigger'ı DELETE'i ve kayıtlı gerçeklerin değişmesini reddeder; yalnız doğrulama alanları ileride File Agent tarafından ayrıcalıklı yolla güncellenebilir (belgelendi: `FILE_STORAGE_AND_AGENT_PLAN.md` §2.2).
- Registration sınırı (oturum + zorunlu Idempotency-Key): `POST /cases/:caseId/documents` (yeni belge veya mevcut belgeye `documentId`+`expectedVersion` ile yeni sürüm, optimistic locking, 409), `POST /cases/:caseId/photos`. `extension` sunucu tarafından addan türetilir + MIME tutarlılığı doğrulanır (uyuşmazlık 400); tehlikeli ad reddi; kategori uzantıyla eşleşmeli. Aynı hash tespit edilir (vaka içi id + diğer vaka sayısı) ama vakalar arası SESSİZ birleştirme yok.
- Salt-okunur liste/detay (`GET /cases/:caseId/documents`, `GET /documents/:id` sürümlerle, `GET /cases/:caseId/photos`, `GET /photos/:id`), oturum + kiracı kapsamlı. Her kayıt merkezi audit (Paket 11); mutlak yol hiçbir yanıta/audit'e girmez. Kapsam dışı: gerçek yükleme/kopyalama/silme, içerik okuma, PDF/foto AI, OCR, thumbnail, File Agent, close/reopen, UI. Karar: HB-2026-019.

### Test ve build sonuçları (Paket 13)

- `npm run typecheck`: Başarılı. `npm run lint`: Başarılı — 0 uyarı.
- `npm run test` (TEST_DATABASE_URL ile): Başarılı — UI 70/70 (+4 skip); domain 301/301 (+9 file-metadata); contracts 86/86 (golden 21); database 22/22 (0007 dahil); API 105/105 (+12 document metadata); **toplam 584/584 (+4 skip)**.
- `npm run build`: Başarılı. `npm audit`: 0 açık. `git diff --check`: Exit 0.
- Gerçek PostgreSQL güvenlik testleri: `ready` doğrulama olmadan DB CHECK ile reddedilir; kayıtlı gerçekler immutable + DELETE yasak (trigger); traversal relative_path DB CHECK reddi; MIME/uzantı uyuşmazlığı ve tehlikeli ad reddi; kiracı izolasyonu; audit'te mutlak yol 0.
- Canlı HTTP güvenlik smoke (çalışan server + seed'li test DB): kayıt/sürüm/idempotency/MIME-uyuşmazlık/traversal/duplicate/foto/okuma/ready-guard/audit-no-absolute doğrulandı (idempotency deep-equal vitest testiyle de teyit edildi).

## Paket 14 — File Agent kontrol katmanı ve doğrulama protokolü (2026-07-13)

- Ayrı workspace `services/file-agent` (@hasarbotu/file-agent): yalnız domain+contracts'a bağlı, **DB bağımlılığı yok**; agent yalnız API üzerinden çalışır. Yerel config `storageRootKey → mutlak root` eşlemesini tutar (yalnız cihazda); mutlak yol API/DB/audit/log'a gitmez.
- Migration 0008: `agents` (cihaz kimliği, secret yalnız SHA-256 hash, enable/disable, last_seen) + `jobs` (PostgreSQL kuyruğu; `FOR UPDATE SKIP LOCKED` claim, lease/heartbeat/timeout recovery, attempt/backoff/`dead_letter`, güvenli payload — mutlak yol CHECK'i).
- İş türleri `verify_document`/`verify_photo`/`verify_case_location`, metadata kaydıyla aynı transaction'da kuyruğa eklenir. Path çözümünde traversal/drive/UNC + `realpath` ile symlink/junction kaçışı reddedilir.
- Doğrulama: agent GERÇEK dosyadan SHA-256'yı STREAMING hesaplar (dosya belleğe alınmaz), boyutu gerçek dosyadan alır, yalnız gözleneni raporlar; **sunucu** beyanla karşılaştırır → eşleşme `pending→ready`, uyuşmazlık `failed` (ready olmaz), yok `missing`, erişim hatası retry/`dead_letter`. Metadata + iş + audit atomik; sürüm yarışında eski sürüm ezilmez; sonuç idempotent. Agent istemci beyanı hash'ini doğrulanmış saymaz.
- Güvenlik: secret/mutlak yol/ham hata API yanıtına taşınmaz; agent yalnız kendi org + atanmış işiyle sınırlı; `x-agent-secret` log'da redakte; testler yalnız sentetik geçici dosya. Kapsam dışı: dosya/klasör oluşturma-taşıma-silme, upload, thumbnail/OCR/AI, Electron, UI agent ekranı, LAN/TLS, üretim migration. Karar: HB-2026-020.

### Test ve build sonuçları (Paket 14)

- `npm run typecheck`: Başarılı. `npm run lint`: Başarılı — 0 uyarı.
- `npm run test` (TEST_DATABASE_URL ile): Başarılı — UI 70/70 (+4 skip); domain 301/301; contracts 89/89 (golden 24); database 22/22 (0008 dahil); API 120/120 (+15 agent iş kuyruğu + 3 uçtan uca); file-agent 12/12 (path/verifier, symlink/junction escape); **toplam 614/614 (+4 skip)**.
- `npm run build`: Başarılı — 5 workspace paketi (domain/contracts/database/api/file-agent). `npm audit`: 0 açık. `git diff --check`: Exit 0.
- Gerçek PostgreSQL + geçici dosya sistemi testleri: lease yarışı (SKIP LOCKED), süresi dolan lease recovery, retry→dead_letter, hash/size doğrulama, symlink/junction escape, sürüm yarışı, idempotent sonuç, kiracı izolasyonu, güvenlik sızıntısı taraması.
- Canlı HTTP güvenlik smoke (gerçek agent + çalışan server + geçici dosyalar; JSON semantik karşılaştırma): eşleşme→ready, uyuşmazlık→failed, missing, idempotent, payload/audit mutlak-yol-yok, yanlış secret 401 — 7/7.

## Paket 19 — Güvenli Case çalışma klasörü oluşturma (2026-07-14)

- `notificationDate` ve kanonik plakadan `YYYY/Ay YYYY/PLAKA` planı üretilir; aynı ay/plaka için `-2`, `-3` deterministik ayrılır. Plan ve preview dosya sistemine yazmaz.
- Migration 0011; provisioning rezervasyonu/durumlarını, tek aktif provisioning işi kısıtını ve workspace iş türünü ekler. Plan/approve/status API'leri oturum, tenant ve Idempotency-Key sınırlarıyla korunur.
- File Agent yalnız yerel root eşlemesiyle, bileşen bazlı ve idempotent biçimde ana klasör ile `EVRAK`, `HASAR`, `OLAY YERİ`, `ONARIM`, `DEĞER KAYBI` alt klasörlerini oluşturur. Traversal, drive, UNC, symlink/junction/reparse ve root escape reddedilir; silme, taşıma veya yeniden adlandırma yoktur.
- Başarılı fiziksel doğrulama; verified case location, append-only history, job/provisioning durumu ve merkezi audit'i tek transaction'da kesinleştirir. Bayat location/version sonucu `stale` olur ve mevcut konumu ezmez. API, audit ve loglarda mutlak yol/secret bulunmaz.
- Dosya Detayı API modunda aktif root, preview, açık onay, ilerleme ve güvenli retry gösterir. Mock modunda fiziksel işlem veya API hatasında mock fallback yoktur. Karar: HB-2026-025.

### Test ve build sonuçları (Paket 19)

- `npm run typecheck`, `npm run lint`, `npm run build` ve `git diff --check`: başarılı. `npm audit --audit-level=moderate`: 0 güvenlik açığı.
- `npm run test` (`hasarbotu_test`): UI 104 (+6 ortam-koşullu skip), domain 315, contracts 102, database 26, API 137, file-agent 20; **toplam 704 başarılı, 6 skip**. Migration 0011 ileri/tekrar/rollback-yeniden-ileri ve constraint kontrolleri gerçek PostgreSQL'de geçti.
- Gerçek geçici dosya sistemi/API testleri: plan yazmasızlığı, açık onay, eşzamanlı onay, `-2/-3`, partial/retry, stale location, tenant/401, reparse/root escape ve sızıntı kontrolleri geçti.
- Gerçek tarayıcı smoke: Codex Browser bootstrap'ındaki repository dışı `Cannot redefine property: process` hatası nedeniyle kurulu Chrome DevTools Protocol ile login → preview → approve → ready ve reload kalıcılığı; 401/404/409/ağ-no-fallback; 1366×768 ve 1920×1080 açık/koyu tema, overflow ve console kontrolleri geçti.
- Repository dışı temiz kopya: başlangıçta `node_modules`/`dist` yok; fresh `npm ci` sonrası gerçek PostgreSQL ile typecheck, lint, 704 test (+6 skip) ve build geçti; kopya kaldırıldı.

## Paket 20 — Güvenli File Agent taşıma ve yeniden adlandırma altyapısı (2026-07-14)

- Migration 0012, mevcut PostgreSQL `jobs` kuyruğuna bağlı `case_file_operations` saga/reservation kaydını ekledi. Aynı vaka için tek aktif operation, aynı case-insensitive hedef için tek rezervasyon ve idempotency DB kısıtlarıyla zorlanır; source/destination yalnız logical rootKey + relativePath'tir.
- Oturum/tenant/Idempotency-Key korumalı plan/read/approve/cancel API'leri yalnız case'in doğrulanmış mevcut location'ını ve `expectedLocationVersion` snapshot'ını kullanır. Plan filesystem'e yazmaz, açık onay öncesi job yoktur; overwrite/merge, arbitrary source ve mutlak yol yoktur.
- File Agent same-volume atomik rename, case-only operation-specific geçici rename ve restart/replay recovery uygular. Farklı root veya EXDEV; operation-specific staging, streaming SHA-256/size manifest, tam doğrulama ve atomik publish kullanır.
- Server Agent başarısını ownership/lease, operation/job version, current location, destination reservation ve manifest özetiyle yeniden doğrular. Location switch + history + operation/job + merkezi audit atomiktir. Cross-root source cleanup yalnız switch sonrası ayrı işte; retry edilebilir bekleme `cleanup_pending`, kaynak değişimi/kısmi veya belirsiz durum `manual_recovery_required` olur.
- UI, IPC, dependency, close/reopen, genel delete/quarantine/upload, üretim migration ve gerçek `P:\` işlemi eklenmedi. Yalnız sentetik geçici root'lar kullanıldı. Karar: HB-2026-026.

### Test ve build sonuçları (Paket 20)

- `npm install`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm audit --audit-level=moderate` ve `git diff --check`: başarılı; audit 0 açık.
- `npm run test` (`hasarbotu_test`): UI 104 (+6 ortam-koşullu skip), domain 315, contracts 110, database 27, API 146, file-agent 37; **toplam 739 başarılı, 6 skip**. Kritik database/API/File Agent testlerinde skip yoktur.
- Gerçek PostgreSQL: migration 0012 ileri/tekrar/rollback-yeniden-ileri; path/idempotency/tek aktif case/destination reservation/case-insensitive location constraint kontrolleri geçti.
- Gerçek sentetik filesystem: same-volume ve case-only rename; cross-root + EXDEV staged-copy; streaming manifest/hash; no-overwrite; disk-full/locked/corrupt-copy; cleanup retry/partial/manual recovery; source-change ve DB finalize kesintisi recovery testleri geçti.
- Canlı TCP API + gerçek Agent protokolü smoke: login → plan/preview → approve → claim → same-volume ready → cross-root cleanup_pending/ready → semantic idempotent replay → stale 409 → tenant 404 → 401; response/audit/DB mutlak-yol ve secret sızıntısı 0.
- Repository dışı temiz kopya: başlangıçta `node_modules`/`dist` yok; fresh `npm ci` ardından gerçek test DB ile typecheck, lint, 739 test (+6 UI skip) ve build geçti; kopya kaldırıldı.

## Sonraki önerilen görev (güncel)

Paket 20 tamamlandıktan sonra yalnız kullanıcı tarafından ayrıca tanımlanacak Paket 21'e geçilmelidir; bu çalışma içinde close/reopen veya başka özellik başlatılmamıştır.

## Paket 21 — Güvenli case close/reopen yaşam döngüsü (2026-07-14)

- Lifecycle `open | closed` olarak kilitlendi; closed case `closed` workflow stage ile, reopen ise izin verilen açık stage ile atomik kesinleşir. Aynı `caseId` ve ofis numarası korunur.
- Migration 0013; lifecycle operation/snapshot modeli, append-only history, case closed/reopened metadata'sı, tek aktif operation ve destination reservation kısıtlarını ekler.
- Close/reopen planı filesystem'e dokunmaz. Server belge gereksinimlerini ve kapalı/açık logical destination'ı üretir; onay mevcut Paket 20 operation ve job queue'suna bağlanır.
- Normal kapanış eksik/control_required kapanış gereksiniminde blocked olur. Eksiklerle kapatma zorunlu gerekçe, server snapshot'ı ve merkezi audit ile açıkça ayrılır.
- Case detayındaki gerçek API modalı preview, onay, ilerleme, conflict reload, cleanup ve manual recovery durumlarını gösterir; API modunda mock fallback yapmaz.
- Gerçek `P:\` veya müşteri verisi kullanılmaz; üretim migration çalıştırılmaz. Karar: HB-2026-027.

### Doğrulama durumu (Paket 21)

- Domain 319, contracts 116, gerçek PostgreSQL database 28, gerçek PostgreSQL/API 150 ve UI 108 test geçti; UI paketinde 6 ortam-koşullu skip vardır.
- Root typecheck, lint, 758 test (+6 yalnız UI ortam skip'i), build, `npm audit` (0 açık) ve diff-check geçti; kritik PostgreSQL/API/File Agent testlerinde skip yoktur.
- Gerçek tarayıcı + canlı TCP API + gerçek Agent + sentetik filesystem: normal close preview→approve→closed, reopen gerekçe/stage→approve→open; aynı case/ofis no, 1366×768 açık-koyu ve 1920×1080 koyu tema, yatay taşma 0 ve console warning/error 0. Semantik idempotent replay, stale 409, tenant 404, rol 403, 401, iki append-only history ve audit/path leak 0 doğrulandı.
- Repository dışı kopyada başlangıçta `node_modules`/`dist` yoktu; fresh `npm ci` ardından gerçek test DB ile typecheck, lint, aynı 758 test (+6 UI skip) ve build geçti; kopya kaldırıldı.

## Sonraki önerilen görev (güncel)

Paket 21'in bütün kapıları ve atomik commit'i tamamlandıktan sonra durulmalıdır; sonraki paket bu çalışma kapsamında değildir.

## Paket 22 — Servis profili ve sigorta şirketi anlaşma modeli (2026-07-14)

- Servis profili `authorized | private | glass | mobile | other` olarak ayrıştırıldı; yetkili servis niteliği sigorta şirketi anlaşmasına eşitlenmedi. Migration 0014 mevcut `yetkili/özel` kayıtları geriye uyumlu dönüştürür, fakat hiçbir eski servise sessiz anlaşma seed'i eklemez.
- `insurer_service_agreements`; tenant, sigorta şirketi, servis, durum, etkin tarih aralığı, desteklenen işlem, kaynak referansı, insan onayı ve optimistic version taşır. Tenant bileşik foreign key'leri ve tarih/onay/operasyon kısıtları DB tarafında zorlanır.
- Saf domain değerlendirmesi hasar veya poliçe LocalDate'i ve işlem bağlamıyla `eligible | not_eligible | control_required` üretir; kural sürümü `2026.07.14.1`'dir. Case read/create/update, referans API'leri ve güvenli audit özetleri bu sonucu taşır.
- Paket 21 kapanış evrakı katmanı `2026.07.14.2`'ye geçti: Teslim İbra ve Temlik ile Taahhütname, yetkili servis veya ilgili sigorta şirketi/tarihte insan onaylı anlaşma varsa değerlendirilir; bilinmeyen eski ilişki `control_required` olur.
- Create/edit UI gerçek referans listesindeki servis türünü, sigorta şirketine özel anlaşma sonucunu, gerekçeyi ve kural sürümünü gösterir. Pasif ve tenant dışı referanslar listelenmez; API kesintisinde mock fallback yapılmaz. Servis CRUD, poliçe AI/muafiyet hesaplaması, File Agent fiziksel işlemi ve üretim migration çalıştırması eklenmedi. Karar: HB-2026-028.

### Doğrulama durumu (Paket 22)

- `npm install`, root typecheck, lint, build ve `git diff --check` başarılı; `npm audit --audit-level=moderate` 0 açık verdi.
- `npm run test` gerçek `hasarbotu_test` PostgreSQL ile: UI 108 (+6 ortam-koşullu skip), domain 323, contracts 118, database 29, API 152, file-agent 37; **toplam 767 başarılı, 6 skip**. Kritik DB/API testi skip kalmadı.
- Migration 0014 ileri/tekrar/rollback-yeniden-ileri ve profil backfill'i; sessiz anlaşma olmaması; tenant/tarih/operasyon/insan onayı kısıtları gerçek PostgreSQL'de geçti.
- Gerçek tarayıcı + canlı API: login, aktif referans filtresi, Traffic create, servis profili read, tarihsel anlaşma `eligible/agreed`, farklı sigortacıda `control_required`, optimistic edit sürüm 1→3, API kesintisinde no-fallback ve audit sızıntı taraması geçti. 1366×768 koyu/açık ve 1920×1080 açık temada yatay/dikey sayfa taşması ve console warning/error yoktu.
- Repository dışı kopyada başlangıçta `.git`/`node_modules`/`dist` yoktu; fresh `npm ci` ardından typecheck, lint, aynı 767 test (+6 UI skip), build ve audit geçti; kopya kaldırıldı.

## Sonraki önerilen görev (güncel)

Paket 22'nin atomik commit'i tamamlandıktan sonra durulmalıdır; sonraki paket bu çalışma kapsamında değildir.

## Paket 23 — Kanıtlı Kasko poliçe analiz çekirdeği (2026-07-14)

- Migration 0015; tenant-kapsamlı analiz/sürüm, sınırlı kaynak referansı, teminat, muafiyet, servis/parça, ikame araç, istisna, conflict, scenario rule/evaluation tablolarını ekler. Approved/superseded sürüm ve kanıtlar append-only/immutable korunur.
- Saf domain motoru 12 kanonik senaryoyu kaynak, öncelik, etkin tarih, servis anlaşması ve belge doğrulama facts'iyle deterministik değerlendirir; kaynak/onay/çelişki belirsizliğinde fail-closed kalır. Kural sürümü `2026.07.14.1`'dir.
- Tenant-kapsamlı API kontrollü sentetik/manual import, yeni sürüm, approve/reject, conflict çözümü ve scenario evaluate uçlarını merkezi rol/idempotency/audit sınırında sunar. PDF/OCR/AI veya upload yoktur.
- Kasko vaka detayındaki gerçek API görünümü analiz sürümü, kaynak sayfa/madde, teminat/muafiyet/servis/parça/ikame araç, conflict ve scenario sonucunu gösterir; API hatasında mock fallback yapmaz. Mock prototip değişmez.
- Karar: HB-2026-029. Ana çalışma ağacında `npm install`, typecheck, lint, 815 PASS / 6 mevcut UI-baseline skip, build, 0-vulnerability moderate audit ve diff-check geçti. Migration 0015 ileri/tekrar/rollback-reapply, constraint, tenant, ready-source, versioning ve immutable approval kontrolleri gerçek `_test` PostgreSQL üzerinde geçti.
- Gerçek TCP API smoke; login, sentetik import/idempotent replay, conflict çözümü, approve/supersede, koşullu muafiyet ve sigortacıya özel servis bağlamlı scenario, stale 409, tenant 404, role 403, 401, audit ve sızıntı kontrollerini geçti.
- Kurulu Codex Browser yoluyla gerçek API/UI; kaynak sayfa-madde, approved sürüm, muafiyet/servis/parça/ikame araç, conflict alanı ve scenario sonucunu gösterdi. API kesintisinde güvenli hata/no-mock-fallback, 1366×768 açık+koyu ve 1920×1080 koyu tema, overflow ile console warning/error kontrolleri geçti.
- Repository dışı, `.git`/`node_modules`/`dist` içermeyen kopyada fresh `npm ci`, typecheck, lint, aynı 815 PASS / 6 baseline skip ve build geçti. Gerçek müşteri poliçesi, üretim migration, OCR/AI ve gerçek `P:\\` kullanılmadı.

## Paket 24 — Güvenli Kasko PDF metin çıkarımı (2026-07-14)

- `pdfjs-dist@6.1.200` exact pinli, izole ve kaynak sınırlı File Agent worker’ı; doğrulanmış Kasko PDF’ini agent-owned temp kopyadan sayfa/segment bazında çıkarır. OCR/AI/poliçe yorumu yoktur.
- Migration 0016 extraction/page/segment snapshot’larını, exact parser+normalizasyon sürümünü, chunk sırasını, Unicode code point locator’larını ve Paket 23 source-reference FK/guard bağını ekler. Mutlak path kolonu yoktur.
- Tenant/oturum/RBAC/idempotency kapsamlı API create/list/detail/pages/segments/cancel/source-reference uçları mevcut queue, Agent lease/heartbeat/result ve merkezi AuditService’i kullanır; response/audit tam metin, root veya secret taşımaz.
- Kasko vaka detayında doğrulanmış PDF seçimi, extraction durumu, parser/rule sürümü, raw/normalize sayfa metni, deterministik segment ve kaynak referansı görünür. API modunda fallback yok; mock modda fiziksel işlem yapılmaz.
- Gerçek PostgreSQL 0016 up/repeat/down/reapply ve constraint kontrolleri; gerçek TCP API + File Agent claim/chunk/finalize/source-reference/analysis bağlantısı; sentetik metinli, image-only, mixed, encrypted, malformed, limit, timeout ve junction testleri geçti. Parser worker kapanışı sonuç dönmeden önce beklenir; tekrar regresyonu varsayılan fork havuzunda art arda 3 kez geçti.
- Gerçek tarayıcıda API login → sentetik Kasko vaka → Evrak ve Fotoğraf → hazır extraction → sayfa/segment → exact source locator akışı geçti. Başarılı akışta console warning/error 0; API kesintisinde mock fallback yerine güvenli servis hatası; 1366×768 ve 1920×1080 açık/koyu temada document yatay taşması 0 ve modül iç scrollbar erişilebilir kaldı.
- Ana çalışma ağacında 857 test geçti; 6 skip yalnız mevcut ortam-koşullu UI testleridir, kritik PostgreSQL/API/File Agent/PDF testi skip değildir. `npm install`, typecheck, lint, build, moderate audit (0 açık) ve diff-check geçti. Repository dışı fresh `npm ci` kopyasında aynı 857/6 sonucu, typecheck, lint ve build geçti; geçici kopya kaldırıldı.

## Paket 25 — Yerel ve güvenli poliçe OCR hattı (2026-07-15)

- Migration 0017; exact OCR identity/run/page/block/line/word, immutable evidence, tenant/extraction/page/geometri guard ve Paket 23 OCR locator bağını ekler. Paket 24 text katmanı değişmez.
- File Agent `tesseract.js@7.0.0`, `@tesseract.js-data/tur|eng@1.0.0` ve `@napi-rs/canvas@1.0.2` exact pinleriyle local render/preprocess/isolated OCR çalıştırır. Model byte size + SHA-256 doğrulanır; runtime network/model download yoktur.
- Domain/contracts/API; render/preprocess/normalizer/locator versioning, raw/normalized OCR, Unicode range, render-pixel block/line/word geometri, reading-order, çok sinyalli quality, PDF/OCR composite ve fail-closed source locator sağlar.
- Kasko detay UI’si gerçek API OCR geçmişi/progress, motor/dil/profile, iki metin katmanı, quality/reading order, low-confidence sayaç, geometri ve source-reference gösterir. API modunda mock fallback, mock modda fiziksel OCR yoktur.
- Gerçek PostgreSQL'de migration 0017 ileri/tekrar/rollback-yeniden-ileri; exact identity, tenant, immutable evidence, geometri/range ve Paket 23 OCR locator kısıtları geçti. Gerçek API + Agent smoke; login, image-only kaynak, idempotent create/retry, claim/heartbeat/chunk/finalize, source reference, stale/tenant/rol/401 ve response/audit sızıntı kontrollerini geçti.
- Sentetik gerçek OCR testleri Türkçe, İngilizce ve karma dil; döndürülmüş, düşük kontrastlı ve iki sütunlu sayfaları; yalnız seçili sayfa, hash/size, path/reparse, limit, timeout/crash ve temp cleanup sınırlarını geçti. PDF/OCR birleştirmesi eş metni tekilleştirir, farklı metni conflict/control_required tutar; blok/satır/kelime kanıtı page-bound geometri ve Unicode code-point aralığı taşır.
- Gerçek tarayıcıda API login → Kasko vaka → Evrak ve Fotoğraf → yerel OCR tetikleme/idempotent replay → hazır sonuç → raw/normalize/PDF karşılaştırma → kalite/okuma sırası → blok/satır/kelime → source reference geçti. API kesintisinde mock fallback olmadı; 1366×768 ve 1920×1080 açık/koyu temalarda yatay taşma 0, iç kanıt kaydırması erişilebilir ve console warning/error 0'dı.
- Ana çalışma ağacında UI 146 (+6 ortam-koşullu skip), domain 355, contracts 155, database 34, API 164 ve File Agent 53 olmak üzere **907 test geçti, 6 skip** kaldı. `npm install`, typecheck, lint, build, moderate audit (0 açık) ve diff-check geçti; kritik PostgreSQL/API/File Agent/OCR testi skip değildir.
- Repository dışındaki `.git`/`node_modules`/`dist` içermeyen kopyada fresh `npm ci`, gerçek `_test` PostgreSQL ile typecheck, lint, aynı 907/6 sonucu ve build geçti; geçici kopya kaldırıldı. Üretim migration, gerçek `P:\`, müşteri poliçesi, cloud OCR/AI ve Paket 26 çalıştırılmadı.

## Paket 26 — Kanıtlı AI orchestration çekirdeği (2026-07-15)

- Migration 0018; organization provider policy, immutable source bundle/item, extraction run, kanonik candidate/source link, conflict proposal ve append-only usage ledger yapılarını ekler. Mutlak yol, secret, binary, full prompt veya raw provider response kolonu yoktur.
- API-owned provider sınırı timeout/cancellation ve boyut limitlidir. Uygulama varsayılanında registry boş ve AI kapalıdır; yalnız testte beş deterministik provider enjekte edilir. Network, AI SDK, background service veya File Agent kullanılmaz.
- Yalnız ready/verified documentVersion’a bağlı Paket 24 PDF segmenti ile Paket 25 ready/partial/control OCR satırı, stabil sourceAnchor üzerinden deterministik ve immutable bundle’a alınır. Tarihsel kaynak ancak açık seçimle kullanılır.
- Strict structured output ve server-side evidence doğrulaması; anchor üyeliğini, kaynak kalitesini, original/numeric/date eşleşmesini ve PDF/OCR conflict warning’lerini fail-closed değerlendirir. Genel muafiyetsiz adayı koşullu muafiyeti silmez.
- Kasko detayındaki “AI Alan Adayları” paneli plan/bütçe/provider durumu, source kalite uyarısı, salt-okunur candidate ve conflict bilgisini gösterir; accept/edit/reject/promotion sunmaz ve API hatasında mock fallback yapmaz.
- Karar: HB-2026-032. Paket 27 human review/promotion; Paket 28 gerçek provider ve PII payload güvenliği sınırıdır.

### Doğrulama durumu (Paket 26)

- Ana çalışma ağacında `npm install`, typecheck, lint, gerçek `_test` PostgreSQL kullanan **952 başarılı / 6 mevcut ortam-koşullu UI skip**, build, 0-vulnerability moderate audit ve diff-check geçti. Migration 0018 ileri/tekrar/rollback-reapply, tenant/immutable bundle/source/candidate/usage constraint'leri ile deterministic provider API smoke doğrulandı.
- Gerçek API tarayıcı smoke'unda login, Kasko kaynak seçimi, provider-disabled ve budget preview, açık start onayı, 5 kanıt-bağlı candidate, conflict/control-required, idempotent replay, no-fallback ve audit/sızıntı kontrolleri geçti. 1366×768 açık/koyu ile 1920×1080 koyu temada yatay taşma ve console error/warning yoktu; iç çalışma alanı scroll'u erişilebilirdi.
- Repository dışındaki `.git`/`node_modules`/`dist` içermeyen kopyada fresh `npm ci`, güvenli process ortamındaki `_test` PostgreSQL bağlantısıyla typecheck, lint, aynı 952/6 test sonucu ve build geçti; geçici kopya kaldırıldı. İlk clean-copy denemesindeki assertion dışı Vitest worker kapanması ikinci tam temiz geçişte tekrarlanmadı.

## Paket 27 — AI adayı insan incelemesi ve Paket 23 taslak promotion (2026-07-15)

- Candidate provider gerçekleri immutable bırakıldı; kabul, kanıtla sınırlı düzenleme, gerekçeli red ve kontrol gerekir kararları append-only review sürümleri olarak eklendi.
- Migration 0019; review geçmişi, Paket 23 AI fact provenance’ı, promotion item/conflict geçmişi ve tenant/anchor/immutable DB guard’larını ekler.
- Promotion önizlemesi bütün aday kararlarını ve deterministic review-set hash’ini doğrular. Yalnız kabul/düzenleme adayları kaynak sayfa/anchor ve conflict’leri korunarak yeni Paket 23 sürümüne taşınır; insan onayı daima pending kalır.
- Kasko detayındaki AI Alan Adayları paneli gerçek accept/edit/reject/control ve açık promotion onayı sunar. Paket 23 görünümü taşınan insan-onaylı taslak gerçekleri kaynaklarıyla gösterir; API modunda mock fallback yoktur.
- Karar: HB-2026-033. Gerçek cloud provider, provider secret/PII payload politikası ve otomatik analiz onayı eklenmedi; File Agent/job/IPC/dependency değişmedi.

### Doğrulama durumu (Paket 27)

- Ana çalışma ağacında `npm install`, typecheck, lint, gerçek `_test` PostgreSQL kullanan **965 başarılı / 6 mevcut ortam-koşullu UI skip**, build, 0-vulnerability moderate audit ve diff-check geçti. Kritik PostgreSQL/API/File Agent/Paket 27 testi skip değildir.
- Migration 0019 ileri/tekrar/rollback-reapply, sequential append-only review, tenant/source-anchor bütünlüğü, immutable provider fact, approved fact guard ve atomik promotion/rollback kontrolleri gerçek PostgreSQL'de geçti. API akışı; dört review eylemi, stale/idempotency, source/conflict korunması ve audit sızıntı sınırını doğruladı.
- Gerçek API tarayıcı smoke'unda login, Kasko AI aday paneli, sırasıyla red→kabul ve control_required→düzenleme, promotion preview/onay, yeni `draft/pending` Paket 23 sürümü ve tekrar promotion blokajı geçti. 1366×768 açık/koyu ile 1920×1080 koyu temada yatay sayfa taşması ve başarılı akışta console warning/error yoktu; API kesintisinde mock fallback yerine güvenli bağlantı hatası gösterildi.
- Windows'ta iç içe gerçek PDF/OCR `worker_threads` testlerini uzun root zincirinde kararsız kapatan Vitest `forks` havuzu yalnız API/File Agent test harness'inde `threads` olarak sabitlendi; runtime, File Agent protokolü, IPC, dependency ve fiziksel yazma yolu değişmedi.
- Repository dışındaki `.git`/`node_modules`/`dist` içermeyen kopyada fresh `npm ci`, güvenli process ortamındaki `_test` PostgreSQL bağlantısıyla typecheck, lint, aynı 965/6 test sonucu ve build geçti; geçici kopya kaldırıldı.

## Paket 28 — Güvenli gerçek AI sağlayıcısı pilot sınırı (2026-07-15)

- Provider-neutral Paket 26 adapter sınırına ilk gerçek dış sağlayıcı olarak OpenAI Responses API eklendi. Adapter native `fetch`, süre/çıktı sınırı, strict JSON Schema, `store:false`, boş tool listesi ve güvenli hata kodları kullanır; AI SDK veya yeni runtime dependency eklenmedi.
- Dış sağlayıcıya yalnız seçilmiş PDF/OCR source-anchor metni gider. `policy-ai-pii-redaction/1.0.0` e-posta, telefon, kimlik, adres, plaka, kişi adı ve benzeri PII adaylarını kararlı placeholder’larla maskeler; binary, File Agent/root, mutlak yol, session, secret ve tüm case dump’ı payload’a alınmaz.
- Provider anahtarı yalnız API process environment’ından okunur; DB, contracts, response, audit, log veya UI modeline girmez. Eksik/yarım config güvenli biçimde provider’ı kaydetmez. Organization policy varsayılan kapalı, allow-list ve monthly/per-request hard stop mevcut sınırda kalır.
- Migration 0020; run üzerinde immutable privacy/retention/pricing özeti, usage ledger üzerinde gerçek token sayaçları ve pricing sürümü ekler. Raw request/response, tam prompt, kaynak metni veya secret kolonu yoktur.
- Gerçek provider adayları Paket 26’nın server-side anchor/evidence doğrulamasından ve Paket 27’nin append-only review akışından geçmeden Paket 23 taslağına taşınamaz. Promotion otomatik approval üretmez.
- Yerel ortamda `OPENAI_API_KEY` bulunmadığından ücretli cloud çağrısı yapılmadı. Wire-format, strict output, maliyet, redaksiyon, audit sızıntısı ve review/promotion zinciri sentetik local HTTP cevabı ile doğrulandı; gerçek dış ağ pilotu deployment secret/retention onayına bağlıdır.
- Ana çalışma ağacında `npm install`, typecheck, lint, gerçek `_test` PostgreSQL kullanan **975 başarılı / 6 mevcut ortam-koşullu UI skip**, build, 0-vulnerability moderate audit ve diff-check geçti. Migration 0020 ileri/tekrar/rollback-reapply, immutable privacy alanları, token/pricing constraint'leri ve tenant sınırları gerçek PostgreSQL'de doğrulandı.
- Gerçek API/tarayıcı smoke'unda Kasko vaka, dış provider planı, PII redaksiyon özeti, bütçe/retention uyarısı, açık gönderim onayı, secret olmadığı için güvenli `provider_disabled`, no-fallback ve mevcut sentetik wire run'ının review→Paket 23 promotion görünümü geçti. 1366×768 açık/koyu in-app tarayıcıda, 1920×1080 açık tema kurulu Chrome/CDP ile doğrulandı; yatay sayfa taşması ve console warning/error yoktu.
- Repository dışındaki `.git`/`node_modules`/`dist` içermeyen kopyada fresh `npm ci`, güvenli process ortamındaki `_test` PostgreSQL bağlantısıyla typecheck, lint, aynı 975/6 test sonucu ve build geçti; geçici kopya kaldırıldı.

## Paket 29 — Gerçek Gemini ücretsiz-katman sentetik pilotu ve transaction recovery (tamamlandı, 2026-07-16)

- Migration 0021 durable provider-call receipt ekler. Provider çağrısı artık açık PostgreSQL transaction içinde yapılmaz; çağrı rezervasyonu önce commit edilir, doğrulanmış canonical response ayrı transaction'da kaydedilir ve candidate/usage finalize ayrı atomik adımdır.
- Provider cevabı sonrası finalize kesintisi, aynı receipt'ten ikinci provider çağrısı olmadan tamamlanır. Network/timeout sonucu bilinmiyorsa `AI_PROVIDER_OUTCOME_UNKNOWN` fail-closed olur ve otomatik retry yapılmaz; tahmini maliyet hard-stop hesabında rezerve kalır.
- Gemini GenerateContent request'i birincil stable `gemini-3.5-flash`, strict JSON Schema, tools/cached content kapalı ve official endpoint ile sınırlıdır. 3.5 ve 2.5 fallback aynı `responseMimeType/responseJsonSchema` payload'ını kullanır; hatalı `responseFormat` ve model-bazlı payload ayrımı kaldırılmıştır. HTTP 503 için 500/1500 ms bounded backoff uygulanır; üç deneme tükenirse sentetik pilot yalnız bir kez stable ücretsiz `gemini-2.5-flash` modeline geçer. Auth/kota/schema/evidence hatasında fallback yoktur. Secret yalnız header'dadır; güvenli provider response/request kimlikleri receipt'te tutulur; raw response/prompt/source/PII/secret/path tutulmaz.
- 4xx teşhisi yalnız HTTP/status ile sabit neden ve izinli alan sınıflarını test/yerel pilotta gösterir; provider message/description veya ham body saklanmaz. Kullanıcı verisinden serbest diagnostic token üretilmez.
- `PROVIDER_TIMEOUT` kök nedeni, sekiz ardışık schema probe'u ile gerçek extraction'ın aynı 120 saniyelik deadline'ı tüketmesiydi. Başarılı canlı yol artık yalnız tek `provider_wire` probe'u çalıştırır; yalnız bu probe 4xx ile reddedilirse minimal nesne→envelope→scalar candidate→wire tanısı dört bounded aşamada çalışır. Enum/sayısal/dizi/açıklama constraint probe'ları normal canlı yolda çalışmaz. Timeout güvenli kodu `provider_wire`, `backoff` veya `extraction` aşamasını açıklar.
- Üretim wire şeması yalnız object/array/string/number, `properties`, `required` ve `items` kullanır; enum/adet/uzunluk/sayısal sınırlar strict server-side Zod ve evidence katmanında fail-closed kalır. Değişken değer `normalizedValueJson` olarak taşınıp adapter'da parse edilir.
- `scalar_candidate` HTTP 200 cevabı daha önce tek genel `GEMINI_SCHEMA_PROBE_RESPONSE_INVALID` koduna düşüyordu. Preflight’ın 512 output-token sınırı thinking modelinde `MAX_TOKENS` üretebiliyor; ayrıca parser `content.parts.length === 1` şartıyla thought-summary/signature metadata veya bölünmüş text part cevabını reddediyordu. Preflight bütçesi 4096 token'a çıkarıldı; ortak bounded parser thought part'larını atlar, boş signature metadata'yı kabul eder, birden fazla text part'ı sırayla birleştirir ve finish reason/JSON/envelope hatasını ayrı güvenli kodlar.
- `PILOT_STRUCTURED_OUTPUT_INVALID` akışı provider wire JSON'unu ve `normalizedValueJson` dönüşümünü geçmiş, ancak sade Gemini şemasında bulunmayan canonical enum/biçim kuralları modele aktarılmadığı için strict runtime contract'ta durmuştur. Adapter artık server-owned schema version, candidate limiti, izinli category listesi ve canonical alan/anchor biçimini trusted output contract olarak system instruction'a ekler; wire şema sade kalır ve Zod/evidence kontrolü gevşetilmez. Yerel pilot reddi ham değer/Zod mesajı yerine yalnız sabit alan yolu + issue sınıfı verir.
- Güncel hedefli API typecheck/lint ve preflight/adapter/fallback/canonical-output testleri **26/26** geçti. Gerçek `_test` PostgreSQL API paketi **215/215**; ana çalışma ağacında typecheck, lint, **1014 başarılı / 6 mevcut ortam-koşullu UI skip**, build, moderate audit (0 açık) ve diff-check geçti.
- Pilot secret kabulü provider biçimini regex ile tahmin etmez; çevre boşluklarını temizler, boş veya 4096 karakter üstü değeri reddeder ve gerçek format doğrulamasını Gemini API'ye bırakır.
- `policy-ai-pilot-quality/1.0.0` küçük sentetik sette alan recall/precision, exact source anchor ve originalValue kanıt doğruluğunu integer basis-point ile ölçer. Ücretsiz katmanın ürün geliştirme retention davranışı nedeniyle canlı pilot gerçek müşteri verisini fail-closed reddeder.
- Gerçek PostgreSQL migration zinciri 42/42, domain 370/370, contracts 179/179 ve API 215/215 test geçti. Finalize hata enjeksiyonu, outcome-unknown no-retry ve 503 tükenmesi sonrası `AI_PROVIDER_UNAVAILABLE` finalized/idempotent replay senaryoları geçmiştir.
- Başarılı yetkili sentetik Gemini pilotu kullanıcı tarafından doğrulandı. Codex process'ine provider secret aktarılmadığı için çağrı tekrar edilmedi; secret repository, log, audit veya test çıktısına taşınmadı.
- Pilot sonrasında ana çalışma ağacında `npm install`, typecheck, lint, gerçek `_test` PostgreSQL ile **1014 başarılı / 6 mevcut ortam-koşullu UI skip**, build, moderate audit (0 açık) ve diff-check yeniden geçti. Repository dışı yeni fresh `npm ci` kopyasında aynı 1014/6, typecheck, lint ve build yeniden geçti.

## Paket 30 — Dosya detayında kullanıcı kontrollü Kasko poliçe analiz akışı (2026-07-16)

- Kasko `Evrak ve Fotoğraf` alanındaki Paket 24 PDF, Paket 25 OCR, Paket 26 plan/start, Paket 27 insan review/promotion ve Paket 23 analiz görünümü tek yönlendirilmiş çalışma alanında birleştirildi.
- Kullanıcı doğrulanmış PDF/OCR source parçalarını seçebilir; boş seçim planı engeller ve yalnız seçilen source kimlikleri mevcut plan API’sine gönderilir. Plan ve provider start ayrı eylem/idempotency ve açık dış gönderim onayı sınırını korur.
- Candidate kanıt dialogu belge/documentVersion, extraction, sayfa, sourceAnchor, bounded excerpt, kalite/warning ve hash özetini gösterir; mutlak yol, binary, secret, ham provider output veya tam belge metni göstermez.
- Accept/edit/reject/control ve promotion mevcut Paket 27 API’sini kullanır. Başarılı promotion aynı dosya detayındaki Paket 23 görünümünü otomatik yeniler; yeni sürüm `draft`, kaynak kapsamı `complete`, insan onayı `pending` olarak ve sayfa/bölüm/madde kanıtlarıyla görünür. Otomatik analiz approval eklenmedi.
- Yeni migration, endpoint, contract/JSON Schema, dependency, File Agent işi, IPC veya fiziksel veri yazma yolu yoktur. Karar: HB-2026-036.

### Doğrulama durumu (Paket 30)

- Ana çalışma ağacında `npm install`, typecheck, lint, gerçek `hasarbotu_test` PostgreSQL ile **1015 başarılı / 6 mevcut ortam-koşullu UI skip**, build, moderate audit (0 açık) ve diff-check geçti. Dağılım: UI 156/6; domain 370; contracts 179; database 42; API 215; file-agent 53.
- Gerçek PostgreSQL/API regresyonunda migration 0001–0021 zinciri, review→promotion→policy-analysis detail, tenant/RBAC/idempotency/audit ve immutable provenance testleri skip edilmedi.
- Gerçek Chrome/CDP smoke’unda login → Kasko dosya → kaynak seçimi → plan/start → dört kanıtlı aday → kanıt dialogu → dört kabul → promotion → aynı ekranda Paket 23 taslağı tamamlandı. DB sonucu: 1 run, 4 candidate, 4 append-only review, 1 promotion, 1 analiz, 4 AI fact ve 4 source reference; analiz `draft/complete/pending`.
- 1366×768 açık/koyu ve 1920×1080 koyu temada yatay taşma yoktu; `case-module` ve candidate alanındaki dikey scroll erişilebilirdi. Görsel kontrol kabul edilen dense-functional masaüstü yönünü korudu. Uygulama exception/console warning yoktu; Chrome’un otomatik ve uygulama dışı `favicon.ico` isteği 404 üretti.
- API response/audit taramasında mutlak/UNC yol, sentetik parola, provider secret kalıbı, full prompt/system contract veya provider output sızıntısı bulunmadı.
- Repository dışı `.git`/`node_modules`/`dist` içermeyen fresh kopyada `npm ci`, typecheck, lint, gerçek `_test` PostgreSQL ile aynı **1015/6**, build yeniden geçti; kopya güvenle kaldırıldı.
- Build mevcut büyük chunk uyarısını sürdürür: ana JS 534.55 kB (gzip 143.26 kB). Paket 30 işlevini engellemez; ileride ayrı performans/code-splitting paketiyle ele alınmalıdır.

## Paket 31 — Gemini production/deployment güvenlik kapısı (2026-07-16)

- API composition, Gemini’yi yalnız açık `GEMINI_POLICY_PROVIDER_ENABLED=true`, güvenli process secret’ı ve izinli model ile provider registry’ye kaydeder. Bayrak kapalıyken veya yokken çekirdek API normal başlar; eksik/kısmi opt-in fail-closed config hatasıdır.
- Secret biçimi regex ile tahmin edilmez; trim, boş değer ve 4096 karakter üst sınırı uygulanır. Secret hiçbir provider descriptor, contract, API response, UI state, audit veya log alanına girmez.
- Yeni oturum korumalı `GET /api/v1/ai/providers`, server deployment durumu ile organization enabled/allow-list/bütçe durumunu ayrı ve güvenli özetler. Endpoint salt okunurdur ve audit gürültüsü üretmez.
- Kasko AI paneli Gemini/OpenAI için “sunucuda yapılandırıldı”, “organization policy kapalı” ve “izin verilmedi” durumlarını ayırır; yalnız yapılandırılmış provider seçilebilir. API modunda mock fallback yoktur.
- Production composition otomatik model/provider fallback yapmaz. Paket 29’un 503 sonrası `gemini-2.5-flash` fallback’i yalnız sentetik pilot runner kapsamındadır.
- Migration, dependency, File Agent, IPC veya fiziksel veri yazma yolu değişmedi. Karar: HB-2026-037.

### Doğrulama durumu (Paket 31)

- Ana çalışma ağacında `npm install`, typecheck, lint, gerçek `hasarbotu_test` PostgreSQL ile **1022 başarılı / 6 mevcut ortam-koşullu UI skip**, build, moderate audit (0 açık) ve diff-check geçti. Dağılım: UI 156/6; domain 370; contracts 181; database 42; API 220; file-agent 53.
- Gerçek PostgreSQL/API testinde authenticated provider availability, 401, organization policy kapalı/açık, configured/unconfigured provider, call-ready bileşimi, salt-okunur GET’te audit sayısının değişmemesi, secret sızıntısı olmaması ve boş registry ile Cases detail’in çalışması doğrulandı.
- Gerçek Chrome/CDP smoke’unda API login, Kasko case, Gemini/OpenAI deployment rozetleri, provider seçimi, organization policy disabled görünümü, çekirdek Paket 23 analiz read’i ve no-fallback doğrulandı. 1366×768 açık/koyu ile 1920×1080 koyu temada yatay taşma yoktu; iç scroll erişilebilirdi ve kararlı sayfada console warning/error/exception 0’dı.
- Browser composition testinde Gemini sentetik server-only secret ile registry’ye alındı; availability yalnız `gemini-2.5-flash` ve güvenli descriptor gösterdi, secret response/DOM/log’a taşınmadı. Organization policy kapalı olduğu için provider çağrısı oluşmadı; çekirdek uygulama çalışmaya devam etti.
- Repository dışı `.git`/`node_modules`/`dist`/`coverage` içermeyen fresh kopyada `npm ci`, typecheck, lint, aynı gerçek `_test` PostgreSQL ile **1022/6**, build yeniden geçti ve geçici kopya güvenle kaldırıldı.
- Build mevcut büyük chunk uyarısını sürdürür: ana JS 540.15 kB (gzip 144.79 kB). `npm ci` ayrıca mevcut `glob@11.1.0` deprecation uyarısını gösterir; moderate audit 0 açıktır. Bunlar Paket 31 güvenlik işlevini engellemez ancak ayrı dependency/performance bakımında ele alınmalıdır.

## Paket 32 — 01.07.2026 Trafik değer kaybı domain/API çekirdeği (2026-07-16)

- Resmî Gazete 33278 değişikliği ve SEDDK 2026/11 Ek-1.1 kaynakları `2026.07.01.1` kural sürümüne bağlandı. Eski Ek-1 `%19 × hasar × km` formülü uygulanmıyor.
- Saf domain motoru kaza öncesi/onarım sonrası piyasa değer farkını ve kusur baz puanını safe integer minor-unit ile taslaklıyor; eksik dönem, araç, hasar, geçmiş hasar, kusur, piyasa kanıtı, emsal ve kaynak çelişkilerini ayrı kodlarla döndürüyor.
- Migration 0022; case başına assessment, immutable version snapshot, append-only evidence/comparable/approval events ve approved-version guard ekliyor.
- Tenant ve oturum korumalı API; read/version list, draft version create, submit, approve ve reject akışlarını idempotency ve optimistic locking ile sunuyor. Kasko case reddediliyor; yalnız ready/verified documentVersion kabul ediliyor.
- Ağır/tam hasar `not_applicable`, piyasa farkı sıfır `no_value_loss` taslağıdır; ikisi de insan onayı olmadan kesinleşmez.
- UI, AI, ilan toplama/web scraping, SBM dış entegrasyonu, rapor/PDF üretimi, File Agent, IPC ve yeni dependency eklenmedi. Karar: HB-2026-038.
- Ana çalışma ağacında `npm install`, typecheck, lint, gerçek `hasarbotu_test` PostgreSQL ile **1050 başarılı / 6 mevcut ortam-koşullu UI skip**, build, moderate audit (0 açık) ve diff-check geçti. Dağılım: UI 156/6; domain 379; contracts 191; database 43; API 228; file-agent 53.
- Migration 0022 ileri/tekrar/rollback-reapply; tenant/constraint/immutable history, API 401/403/404, ready document evidence, idempotent draft, stale conflict, submit→approve/reject ve audit/response sızıntı sınırı gerçek PostgreSQL’de geçti. Gerçek TCP smoke login→draft→replay→submit→approve akışını tamamladı.
- Repository dışındaki yeni kopyada normal fresh `npm ci`, process-scope `_test` bağlantısıyla typecheck, lint, aynı **1050/6** test ve build yeniden geçti. UI değişmediği için Paket 32’ye özel tarayıcı senaryosu eklenmedi; mevcut UI baseline testleri korundu.
- Build’in mevcut büyük chunk uyarısı sürüyor: ana JS 540.15 kB (gzip 144.79 kB). `npm ci`, mevcut `glob@11.1.0` deprecation uyarısını verdi; moderate audit 0 açıktır.

## Paket 33 — Trafik değer kaybı gerçek dosya detayı entegrasyonu (2026-07-16)

- Dosya Detayı > Değer Kaybı gerçek API modunda Paket 32 current/version/create/submit/approve/reject uçlarına DataPort/hook sınırıyla bağlandı; API hatasında mock fallback yoktur.
- Trafik çalışma alanı araç/kusur/parça/piyasa girdisi, 3+3 emsal, güvenli kaynak, ready/verified document metadata ve kullanıcı tarafından tek tek seçilen kanıt alanlarını sürümlü taslağa gönderir.
- Server taslağı minor-unit tutar, rule version `2026.07.01.1`, gerekçe/resmî kaynak, belirsizlik ve submit uygunluğuyla gösterilir. Her düzeltme yeni version; geçmiş görünür ve append-only server modeline dokunulmaz.
- Submit açık teyit; approve/reject mevcut rol ve insan inceleme teyidi/gerekçesiyle çalışır. Control-required belirsizlik submit’i kapalı tutar.
- Mock moddaki kabul edilmiş Değer Kaybı prototipi değişmedi. API Kasko vakada sahte Trafik hesabı üretmez. Migration, endpoint, domain formülü, dependency, File Agent, IPC veya fiziksel dosya yazma yolu değişmedi. Karar: HB-2026-039.
- Ana ağaçta `npm install`, typecheck, lint, gerçek `hasarbotu_test` PostgreSQL ile **1060 başarılı / 6 mevcut ortam-koşullu UI skip**, build, moderate audit (0 açık) ve diff-check geçti. Dağılım: UI 166/6; domain 379; contracts 191; database 43; API 228; file-agent 53. Paket 33 adapter/component testleri 19/19; gerçek Trafik Değer Kaybı API testi 8/8 ve skip edilmedi.
- Gerçek Chrome/CDP smoke: API login; incomplete draft/control-required; ready/verified belge ve alan-bazlı kanıt seçimi; 3+3 emsal; ikinci version; 7.500.000 minor-unit kusur sonrası taslak; version history; submit; expert/admin human approval; API kesintisinde no-fallback geçti. DB’de 2 version, 9 evidence, 6 comparable, 2 approval event ve güvenli audit zinciri doğrulandı.
- 1366×768 açık/koyu ve 1920×1080 koyu temada body yatay taşması yoktu; emsal tablosu kendi iç scroll’unu korudu. JavaScript console warning/error ve exception 0’dı. Chrome resource günlüğündeki kayıtlar beklenen bootstrap/boş-assessment 401/404 ve mevcut favicon 404’üdür.
- Repository dışı `.git/node_modules/dist/coverage` içermeyen kopyada fresh `npm ci`, typecheck, lint, aynı gerçek `_test` PostgreSQL ile **1060/6** test ve build yeniden geçti. `npm ci` mevcut `glob@11.1.0` deprecation uyarısını verdi; audit 0 açıktır.
- Build mevcut büyük chunk uyarısını sürdürür: ana JS 575,64 kB (gzip 152,99 kB). Paket 33 işlevini engellemez; ayrı performans/code-splitting bakımında ele alınmalıdır.

## Paket 34 — Trafik değer kaybı nihai rapor önizleme ve çıktı (2026-07-16)

- İnsan onaylı `approved/superseded` Trafik değer kaybı sürümü; vaka kimliği, araç/hasar, hesap, 3+3 emsal, doğrulanmış kanıtlar, belirsizlikler, resmî kural kaynakları, kural sürümü ve isteğe bağlı kullanıcı notuyla deterministik `traffic-value-loss-final-report/1.0.0` snapshot’ına dönüştürülür. Onaysız veya kanıt bağlantısı bozuk sürüm fail-closed reddedilir.
- Yazmasız preview ile açık kullanıcı teyitli final üretim ayrıdır. Generate; `expectedAssessmentVersion`, preview hash ve `Idempotency-Key` kullanır. Migration 0023 version başına tek `ready/pdf` raporu, content/PDF SHA-256, byte-size, tenant FK, mutlak yol reddi ve append-only guard ile saklar.
- API-owned A4/çok sayfalı PDF renderer gömülü Liberation Sans fontlarını kullanır. Download aynı immutable snapshot’tan PDF’yi yeniden üretir ve saklı hash/byte-size ile doğrular. PDF binary, mutlak yol veya fiziksel case klasörü DB/audit’e yazılmaz; File Agent ve IPC kullanılmaz.
- Dosya Detayı > Değer Kaybı alanında kaynaklar, emsaller, hesap, belirsizlikler ve kural sürümü gösterilen nihai önizleme; açık onay; tek final PDF durumu ve indirme bağlandı. API/network hatasında mock fallback yoktur; download hata mesajı güvenli no-fallback durumunu maskelemez.
- Ana ağaçta typecheck, lint, gerçek `hasarbotu_test` PostgreSQL ile **1.074 başarılı / 6 mevcut ortam-koşullu UI skip**, build, moderate audit (0 açık) ve diff-check geçti. Dağılım: UI 168/6; domain 381; contracts 197; database 45; API 230; file-agent 53.
- Migration 0023 ileri/tekrar/rollback-reapply; approved-source, tek rapor, tenant, mutlak yol, append-only ve immutable constraint’leri gerçek PostgreSQL’de geçti. Gerçek API testi preview’ın yazmamasını, 403/401/404 sınırlarını, stale hash’i, idempotent generate/replay’i, PDF cevabını ve güvenli tek audit olayını doğruladı.
- PDF görsel kapısında A4 iki/üç sayfalı sentetik çıktı Poppler ile render edildi; Türkçe karakterler, başlık/altbilgi, sayfa numarası ve taşma görsel olarak doğrulandı. Gerçek Chrome/CDP smoke login → onaylı Trafik sürümü → preview → açık teyit → final → 186.927 bayt `%PDF-1.4` browser fetch → no-fallback akışını tamamladı.
- 1366×768 açık önizleme, 1366×768 koyu final ve 1920×1080 koyu final görünümünde yatay taşma yoktu; modül içi dikey scroll erişilebilirdi. JavaScript console warning/error/exception 0’dı; yalnız mevcut favicon ve boş workspace-plan için üç beklenen 404 resource kaydı görüldü.
- Repository dışındaki `.git/node_modules/dist/coverage/tmp` içermeyen kopyada process çalışma dizini ayrıca doğrulanarak fresh `npm ci`, typecheck, lint, gerçek `_test` PostgreSQL ile aynı **1.074/6** test ve build yeniden geçti; geçici kopya kaldırıldı.
- Build mevcut büyük chunk uyarısını sürdürüyor: ana JS 591,47 kB (gzip 155,70 kB). Yeni API direct dependency’leri `@napi-rs/canvas@1.0.2` ve `pdfjs-dist@6.1.200` lockfile’da sabittir; audit 0 açıktır. Üretim migration’ı ve gerçek müşteri verisi kullanılmadı.

## Paket 35 — Frontend güvenli lazy-loading ve code-splitting (2026-07-16)

- Dosya Detayı route’u `React.lazy` ile uygulama kabuğundan ayrıldı. Evrak/Fotoğraf, PDF metin, OCR, Kasko poliçe analizi ve Trafik değer kaybı gerçek API modülleri ayrıca sekme düzeyinde dinamik import edildi; mock prototip davranışı ve ana navigasyon eager kaldı.
- Uygulama kabuğundaki mevcut `Suspense` ve `ErrorBoundary` korunurken dosya-detayı sekmelerine güvenli iç loading durumu eklendi. Reddedilen lazy import’un fatal hata sınırı ve yeniden yükleme eylemiyle yakalandığı regresyon testi eklendi.
- `npm run build` artık üretim UI build’i sonrasında başlangıç JS grafiğini, her JS chunk’ını ve altı zorunlu lazy modülün gerçekten ayrı/başlangıç dışı olduğunu doğrular. Sınır Vite’ın 500.000 bayt uyarı eşiğidir ve aşım build’i başarısız yapar.
- Paket 34 tabanındaki 591,47 kB tek giriş JS’i 281.355 bayt giriş chunk’ına düştü. `index.html` tarafından başlangıçta kullanılan JS grafiği 420.291 bayttır; en büyük chunk 500.000 baytın altındadır ve Vite büyük chunk uyarısı kalkmıştır.
- Gerçek Chrome/CDP production smoke’unda ilk yüklemede altı ağır chunk istenmedi; Trafik/Kasko vaka sekmeleri açıldıkça doğru chunk’lar tek tek yüklendi. Route geçişinde boş ekran oluşmadı; 1366×768 açık/koyu ve 1920×1080 koyu temada yatay taşma, chunk 404 veya console warning/error görülmedi.
- Ana ağaçta typecheck, lint, gerçek `hasarbotu_test` PostgreSQL ile **1.075 başarılı / 6 mevcut ortam-koşullu UI skip**, build+bütçe kapısı, moderate audit (0 açık) ve diff-check geçti. Dağılım: UI 169/6; domain 381; contracts 197; database 45; API 230; file-agent 53.
- Repository dışı `.git/node_modules/dist/coverage/tmp` içermeyen fresh kopyada `npm ci`, typecheck, lint, aynı gerçek `_test` PostgreSQL ile **1.075/6** test ve build+bütçe kapısı yeniden geçti; kopya kaldırıldı.
- Yeni dependency, migration, API/contract, IPC, File Agent veya veri yazma yolu değişikliği yoktur. `npm ci` mevcut `glob@11.1.0` deprecation uyarısını vermeye devam eder; moderate audit 0 açıktır.

## Paket 36 — Durum Panosu gerçek API entegrasyonu (2026-07-16)

- Oturum ve organization kapsamlı `GET /api/v1/dashboard`; açık vaka çekirdeğini sorumlu, sigorta, servis, takip tarihi, mevcut belge metadata’sı, Paket 15 evrak değerlendirmesi, bekleyen insan onayları ve operasyon kurtarma/hata durumlarıyla tek salt-okunur snapshot’ta birleştirir.
- Saf domain öncelik motoru `dashboard-priority/1.0.0`; manuel kurtarma → operasyon hatası/blokajı → gecikmiş takip → insan onayı → eksik/kontrol evrakı → bugün/atanmamış/yaklaşan takip sırasını deterministik uygular. Aynı girdiler aynı skor, sinyal ve sıra sonucunu üretir.
- UI gerçek API modunda summary, sorumlu, işlem gereksinimi, öncelik ve serbest arama filtrelerini kullanır; kart tıklaması/Enter gerçek `/dosyalar/:caseId` detayına gider. Loading, gerçek boş, 401 ve ağ/API hatası ayrı gösterilir; API hatasında mock fallback yoktur. Mock moddaki kabul edilmiş 12 kayıtlı prototip korunur.
- Dashboard GET snapshot veya audit yazmaz. Mevcut tablolar okunur; migration, yeni dependency, IPC, File Agent işi veya fiziksel/veritabanı yazma yolu eklenmedi. Response mutlak yol, belge içeriği, secret ve ham müşteri belgesi taşımaz.
- Ana ağaçta gerçek `hasarbotu_test` PostgreSQL ile **1.090 başarılı / 6 mevcut ortam-koşullu UI skip** geçti. Dağılım: UI 175/6; domain 385; contracts 200; database 45; API 232; file-agent 53. Paket 36 gerçek dashboard API testi 2/2 ve skip edilmedi.
- Gerçek Chrome/CDP smoke: API login; 5 açık vaka; geciken 1, bugün 1, eksik evraklı 1, bekleyen insan onayı 1 ve işlem gereken 4 özeti; onay/işlem filtreleri; arama; dosya detayına geçiş; API kesintisinde no-fallback; 1366×768 açık/koyu ve 1920×1080 koyu görünüm geçti. Body yatay taşma yok, workflow panosu kendi `overflow-x:auto` kaydırmasını koruyor ve kararlı ekranda console warning/error/exception 0.
- Repository dışı `.git/node_modules/dist/coverage/tmp` içermeyen fresh kopyada `npm ci`, typecheck, lint, aynı gerçek `_test` PostgreSQL ile **1.090/6** test ve build/bundle bütçesi yeniden geçti. `npm ci` mevcut `glob@11.1.0` deprecation uyarısını verdi; moderate audit ana ağaçta 0 açıktır.

## Paket 37 — Case notları, görevler ve takip geçmişi (2026-07-16)

- Migration `0024_case_notes_tasks`; organization/case kapsamında append-only `case_notes`, optimistic `case_tasks`, append-only `case_task_events` ve `case_follow_up_history` tablolarını ekler. Not ve geçmiş fiziksel olarak güncellenemez/silinemez; görev yalnız `open → completed|cancelled` geçişi yapar.
- Gerçek Operasyon API’si; workspace read, idempotent not/görev create ve expectedVersion kullanan tamamla/iptal komutlarını sağlar. Görev tamamlamada sonuç notu, iptalde gerekçe zorunludur; atanan kullanıcı aktif ve aynı organization içinde olmalıdır.
- Case `followUpDate` create/update transaction’ı aynı anda append-only takip geçmişi yazar. Takip güncellemesi mevcut Case optimistic locking sınırını kullanır.
- Dosya Detayı > Operasyon sekmesi API modunda gerçek not, görev, görev sonucu/iptali ve takip geçmişini gösterir; 401/403/404/409/ağ durumlarında mock fallback yapmaz. Mock prototip ayrı ve değişmeden kalır.
- Dashboard priority `dashboard-priority/1.1.0` oldu. Geciken, bugün ve yaklaşan açık görevler takip tarihinden ayrı sinyal ve sayaç olarak agregasyona katılır.
- Merkezi audit yalnız not türü, görev kimliği/durumu/sürümü ve güvenli sayaçları taşır; not metni, görev başlığı, sonuç/iptal açıklaması audit’e kopyalanmaz.
- Ana ağaçta gerçek `hasarbotu_test` PostgreSQL ile **1.119 başarılı / 6 mevcut ortam-koşullu UI skip** geçti. Dağılım: UI 185/6; domain 388; contracts 209; database 47; API 237; file-agent 53. Migration 0024 ileri/tekrar/rollback-yeniden-ileri, tenant/append-only/geçiş kısıtları ve Operasyon API testi skip edilmedi.
- Gerçek Chrome/CDP smoke: API login; not ekleme; görev oluşturma/tamamlama; geciken açık görevin Dashboard önceliğine yansıması; takip tarihi güncelleme ve geçmiş; API kesintisinde no-fallback geçti. 1366×768 açık/koyu ve 1920×1080 koyu görünümde yatay taşma yok; console/runtime yalnız senaryoda beklenen ve açıkça izin verilen 401/404 ağ kayıtlarını taşıdı.
- Build başlangıç JavaScript grafiğini 440.912 baytta tuttu; en büyük chunk 286.664 bayt ve Operasyon dahil **7 lazy modül** ayrı kaldı. Moderate audit 0 açıktır.
- Repository dışı `.git/node_modules/dist/coverage/tmp` içermeyen fresh kopyada `npm ci`, typecheck, lint, aynı gerçek `_test` PostgreSQL ile **1.119/6** test ve build/bundle bütçesi yeniden geçti; geçici kopya kaldırıldı.

## Paket 38 — Production doğruluğu ve case navigasyonu sertleştirme (2026-07-16)

- Production frontend mock override kabul etmez; production API geçerli `DATABASE_URL` olmadan başlamaz. Development/test mock ve DB’siz health uyumluluğu korunur.
- Cases adapter bütün açık/kapalı pagination sayfalarını okur ve ortak contracts Zod şemalarıyla runtime doğrular. Dosya Detayı doğrudan detail endpoint’ini kullandığı için kapalı vaka ve ilk 100 kayıt dışındaki vaka açılır.
- API modunda bilinmeyen evrak tamlığı, tahmini hasar ve bağlı olmayan İşçilik/Ağır Hasar/Rapor/E-posta/Geçmiş/Asistan içerikleri mock veya başarılı gerçek gibi gösterilmez.
- Kapanan Dosyalar gerçek closed case listesini kullanır. Kapanış gerekçesi/ücreti henüz API’de yoksa bilinmeyen gösterilir. Raporlar ekranı API modunda mock toplamları fail-closed gizler.
- Pending/failed Zabıt yanında ready KTT/Beyan varsa olay belgesi alternatifi karşılanır; Zabıt adayının fiziksel durumu metadata’da korunurken overall gereksiz `control_required` olmaz.
- Ana ağaçta gerçek `hasarbotu_test` PostgreSQL ile **1.132 başarılı / 6 mevcut ortam-koşullu UI skip** geçti. Dağılım: UI 194/6; domain 390; contracts 209; database 47; API 239; file-agent 53.
- Gerçek Chrome/CDP smoke: login; 101 açık case’in iki API sayfasından eksiksiz yüklenmesi; kapalı case direct detail; bağlı olmayan modüllerde mock olmaması; gerçek Kapanan Dosyalar; Raporlar fail-closed; API kesintisinde no-fallback geçti. 1366×768 açık/koyu ve 1920×1080 koyu görünümde yatay taşma ve beklenmeyen console warning/error yoktu.
- Build başlangıç JavaScript grafiğini **446.764 bayt** tuttu; en büyük chunk 289.707 bayt ve 7 zorunlu lazy modül ayrı kaldı. Contracts runtime doğrulaması API çağrısında lazy yüklenir. Moderate audit 0 açıktır.
- Repository dışı `.git/node_modules/dist/coverage` içermeyen fresh kopyada `npm ci`, typecheck, lint, aynı gerçek `_test` PostgreSQL ile **1.132/6** test ve build/bundle bütçesi yeniden geçti.
- Yeni migration, endpoint, IPC, File Agent veya veri yazma yolu eklenmedi. Root UI yalnız mevcut workspace `@hasarbotu/contracts` paketini runtime dependency olarak tüketir.

## Paket 39 — Kapanma ücreti ve dönem raporu gerçek API entegrasyonu (2026-07-16)

- `closure-fee/1.0.0` saf domain kuralı yalnız kapalı case ve `ready + hashVerified + sizeVerified + verifiedAt` nihai ekspertiz raporu kaynağını kabul eder. Para safe integer minor-unit ve `TRY`'dir.
- Migration `0025_closure_fees_reports`; case başına tek optimistic aggregate, current pointer ve append-only `control_required → approved | corrected` version geçmişi ekler. Düzeltme eski onaylı sürümü değiştirmez.
- Tenant/oturum/RBAC/idempotency korumalı ücret API'si manuel aday, açık onay ve gerekçeli düzeltmeyi merkezi audit ile atomik tamamlar. Salt-okunur fee/list/report çağrıları audit yazmaz.
- `GET /api/v1/reports/case-summary`, `open_created_closed_finalized` dönem temeliyle vaka dağılımını ve yalnız güncel onaylı/düzeltilmiş ücret toplamını döndürür; aday tutar kesin toplama girmez.
- Dosya Detayı > Raporlar ve Ücretler gerçek aday/onay/düzeltme ve sürüm geçmişini; Kapanan Dosyalar approved/control-required/unknown ayrımını; ana Raporlar ekranı dönem/servis/sorumlu filtrelerini gerçek API'yle gösterir. API modunda mock fallback yoktur.
- Ana ağaçta `npm install`, typecheck, lint, gerçek `hasarbotu_test` PostgreSQL ile **1.156 başarılı / 6 mevcut ortam-koşullu UI skip**, build/bundle, moderate audit (0 açık) ve diff-check geçti. Dağılım: UI 199/6; domain 393; contracts 218; database 49; API 244; file-agent 53.
- Migration 0025 ileri/tekrar/rollback-reapply; tenant, amount/shape/path, current pointer ve append-only kısıtları gerçek PostgreSQL'de geçti. Paket 39 gerçek API testi 5/5 ve skip edilmedi.
- Gerçek Chrome/CDP smoke: login; verified final report; 485.000 minor-unit aday; `control_required`; açık kullanıcı onayı; onaylı aylık toplam ve Kapanan Dosyalar tutarı; audit sızıntı kontrolü; API kesintisinde no-fallback geçti. 1366×768 açık/koyu ve 1920×1080 koyu görünümde yatay taşma ve beklenmeyen console warning/error yoktu.
- Build başlangıç JavaScript grafiğini **458.876 baytta** tuttu; en büyük chunk 296.930 bayt ve Kapanma Ücreti dahil **7 lazy modül** ayrı kaldı.
- Repository dışı `.git/node_modules/dist/coverage` içermeyen kopyada fresh `npm ci`, typecheck, lint, aynı gerçek `_test` PostgreSQL ile **1.156/6** test ve build/bundle yeniden geçti. `npm ci` mevcut `glob@11.1.0` deprecation uyarısını verdi; audit açığı yoktur.
- Yeni harici dependency, IPC, File Agent işi, PDF/OCR/AI çıkarımı veya fiziksel dosya yazma yolu eklenmedi. Üretim migration çalıştırılmadı.

## Paket 40 — Değer kaybı kapanış özeti entegrasyonu (2026-07-16)

- `traffic-value-loss-closure/1.0.0` saf evaluator; yalnız current insan onaylı Trafik assessment version ve aynı version immutable final report varsa `present`, diğer Trafik durumlarında `control_required`, Kasko’da `not_applicable` döndürür.
- Case close planı değer kaybını `module` gereksinimi olarak mevcut requirement snapshot’a alır. Assessment/report kimliği, version, result, minor-unit tutar ve rule version append-only lifecycle history’de korunur; eski snapshot’lar nullable alanla okunur.
- `GET /api/v1/traffic-value-loss/closure-summaries` tenant/oturum kapsamlı kapalı case özetini döndürür. Aylık case summary yalnız kapanmış, güncel onaylı+raporlu Trafik sonucunu toplar; hesaplamayı yeniden çalıştırmaz ve GET audit yazmaz.
- Kapanış önizlemesi, Kapanan Dosyalar ve Raporlar gerçek değer kaybı durum/tutar/rule/report verisini gösterir. API modunda mock fallback yoktur.
- Ana ağaçta `npm install`, typecheck, lint, gerçek `hasarbotu_test` PostgreSQL ile **1.162 başarılı / 6 mevcut ortam-koşullu UI skip**, build/bundle, moderate audit (0 açık) ve diff-check geçti. Dağılım: UI 199/6; domain 396; contracts 221; database 49; API 244; file-agent 53.
- Paket 40 hedefli gerçek PostgreSQL/API doğrulaması: lifecycle close/reopen 5/5; kapanma ücreti/rapor/değer kaybı özeti 5/5; kritik DB/API testi skip edilmedi.
- Gerçek Chrome/CDP smoke: login; açık Trafik case close preview; onaylı/raporlu ₺2.450 değer kaybı özeti; kapanma ücreti akışı; aylık toplam; Kapanan Dosyalar; audit sızıntı kontrolü ve API kesintisinde no-fallback geçti. 1366×768 açık/koyu ve 1920×1080 koyu görünümde yatay taşma ve beklenmeyen console warning/error yoktu.
- Build başlangıç JavaScript grafiğini **462.166 baytta** tuttu; en büyük chunk 299.340 bayt ve **7 lazy modül** ayrı kaldı.
- Repository dışı `.git/node_modules/dist/coverage` içermeyen kopyada fresh `npm ci`, typecheck, lint, aynı gerçek `_test` PostgreSQL ile **1.162/6** test ve build/bundle yeniden geçti. `npm ci` mevcut `glob@11.1.0` deprecation uyarısını verdi; audit açığı yoktur.
- Yeni migration, dependency, IPC, File Agent işi veya fiziksel dosya yazma yolu eklenmedi. Üretim migration çalıştırılmadı.

## Paket 41 — Kullanıcı kontrollü e-posta taslak çekirdeği (2026-07-16)

- `email-draft-template/1.0.0` saf domain builder; 11 Türkçe e-posta türünü deterministik üretir. Recipient otomatik tahmin edilmez; en az bir normalize `to`, benzersiz `to/cc` ve açık insan kontrolü zorunludur.
- Migration `0026_email_draft_core`; tenant-kapsamlı aggregate, immutable draft version/recipient/attachment ve append-only Gmail handoff geçmişi ekler. Composite FK ve trigger’lar current/previous version’ın aynı draft zincirinde olmasını zorlar.
- Preview salt okunur ve audit yazmaz. Create/revise/handoff; Idempotency-Key, expected version, RBAC, kapalı-case kilidi ve merkezi audit ile atomiktir. Audit subject/body/recipient/revision metni veya Gmail URL’si taşımaz.
- Ek seçimi yalnız current `ready + hashVerified + sizeVerified + verifiedAt` documentVersion/photo metadata’sıdır. Fiziksel dosya okunmaz; path response/audit/Gmail URL’sine girmez ve ekler Gmail’de manuel seçilir.
- Dosya Detayı > E-postalar API modunda preview, kullanıcı recipient/subject/body kontrolü, verified ekler, açık save/revision onayı, sürüm geçmişi ve ayrı harici veri çıkışı onaylı Gmail web handoff sunar. Handoff her zaman `not_sent`; otomatik gönderim/doğrulama yoktur. Mock prototip ayrı korunur ve API hatasında fallback yapılmaz.
- Ana çalışma ağacında `npm install`, typecheck, lint, gerçek `hasarbotu_test` PostgreSQL ile **1.191 başarılı / 6 mevcut ortam-koşullu UI skip**, build/bundle, moderate audit (0 açık) ve diff-check geçti. Dağılım: UI 205/6; domain 400; contracts 232; database 51; API 250; file-agent 53.
- Migration 0026 ileri/tekrar/rollback-reapply, tenant/composite draft-version FK, recipient/attachment shape, current pointer ve append-only kısıtları gerçek PostgreSQL’de geçti. Paket 41 gerçek API testi 6/6 ve kritik DB/API testi skip edilmedi.
- Gerçek Chrome/CDP smoke: login; yazmasız preview; verified ön rapor önerisi; açık kayıt onayı; immutable sürüm 2; açık Gmail veri çıkışı; güvenli compose URL; `not_sent`; audit sızıntı kontrolü ve API kesintisinde no-fallback geçti. 1366×768 açık/koyu ve 1920×1080 koyu görünümde yatay taşma ve beklenmeyen console warning/error yoktu.
- Build başlangıç JavaScript grafiğini **466.306 baytta** tuttu; en büyük chunk 299.225 bayt ve E-posta dahil **8 lazy modül** ayrı kaldı.
- Repository dışı `.git/node_modules/dist/coverage/tmp` içermeyen kopyada fresh `npm ci`, typecheck, lint, aynı gerçek `_test` PostgreSQL ile **1.191/6** test ve build/bundle yeniden geçti; geçici kopya kaldırıldı. `npm ci` mevcut `glob@11.1.0` deprecation uyarısını verdi; audit açığı yoktur.
- Yeni harici dependency, OAuth/API secret, provider network çağrısı, File Agent işi, IPC veya fiziksel dosya yazma yolu eklenmedi. Gmail API/incoming sync ve AI taslak ayrı sonraki kapsamdır; üretim migration çalıştırılmadı.

## Paket 42 — Kanıtlı AI e-posta metin önerisi (2026-07-16)

- Paket 41 deterministik preview’ı üzerine `email-ai-draft/1.0.0` planı eklendi. External payload PII-minimize edilir; office no/plaka/recipient dışarı çıkmaz ve güvenli konu kimliği yalnız server tarafında eklenir.
- Organization e-posta AI opt-in/allow-list’i varsayılan kapalıdır. Plan provider çağrısı veya audit yazmaz; start güncel preview/case hash, zorunlu Idempotency-Key, ortak integer budget hard-stop ve açık egress onayı ister.
- Migration 0027 immutable suggestion run, durable provider receipt ve ortak `ai_usage_ledger` için `policy_analysis | email_draft` module ayrımı ekler. Provider cevabı sonrası finalize kesintisi ikinci çağrı olmadan recover edilir; belirsiz network sonucu otomatik retry yapmadan `outcome_unknown` kalır.
- Strict server doğrulaması schema dışı, PII/placeholder, URL ve filesystem path içeren çıktıyı taslak önerisi yapmaz. Full prompt/raw output/PII/secret/path audit/log/DB’ye yazılmaz.
- Dosya Detayı > E-postalar alanı privacy/bütçe planını, prompt-injection uyarısını, egress onayını ve insan incelemeli öneriyi gösterir. “Öneriyi uygula” yalnız form state’ini değiştirir, save onayını sıfırlar; recipient/ek ve Paket 41 kayıt/handoff sınırları değişmez.
- Yeni dependency, Gmail OAuth/API, incoming sync, otomatik kayıt/gönderim, File Agent, IPC veya fiziksel dosya erişimi eklenmedi. Üretim migration çalıştırılmadı.
- Ana çalışma ağacında typecheck, lint, gerçek `hasarbotu_test` PostgreSQL ile **1.223 başarılı / 6 mevcut ortam-koşullu UI skip**, build/bundle, moderate audit (0 açık) ve diff-check geçti. Dağılım: UI 209/6; domain 406; contracts 241; database 53; API 261; file-agent 53 (Paket 41'e göre +32; DB/API/domain/contracts/file-agent'ta skip yok).
- Migration 0027 tekil ve 0026→0021 ile kademeli rollback-reapply gerçek PostgreSQL'de geçti. Paket 42 email-AI API testleri plan salt-okunurluğunu, RBAC/tenant/kapalı-case sınırını, PII-minimize strict doğrulama + idempotent replay'i, geçersiz çıktının raw saklamadan fail-closed olmasını, bütçe hard-stop'un çağrıdan önce çalışmasını, receipt ile finalize kurtarmayı, belirsiz network sonucunda `outcome_unknown`'u ve audit/receipt/log sızıntısızlığını doğruladı; Gemini adapter secret-header, sınırlı backoff ve unknown/response-received ayrımı dahil. Kritik DB/API testi skip edilmedi.
- Gerçek Chrome/CDP smoke (13/13 senaryo): login; provider kapalıyken çağrı yok ve plan state yazmaz; PII-minimize egress (office no/plaka/recipient/PII dışarı çıkmaz, güvenilmeyen talimat ve URL yalnız veri olarak korunur); açık egress onayı; strict öneri; "Öneriyi uygula" yalnız form state'ini değiştirip save onayını sıfırlar; `ai_assisted` provenance (suggestion run + `email_draft` usage ledger) DB'de doğrulandı; bütçe hard-stop çağrıyı engeller; audit sızıntısı yok; API kapatılınca mock fallback yok; console temiz. 1366×768 açık/koyu ve 1920×1080 koyu görünümde yatay taşma yoktu.
- Build başlangıç JavaScript grafiğini **466.311 baytta** tuttu (Paket 41'e göre +5 bayt); en büyük chunk 299.225 bayt ve E-posta AI paneli dahil **8 lazy modül** ayrı kaldı.
- Repository dışı `.git/node_modules/dist/coverage/tmp` içermeyen kopyada fresh `npm ci` (0 açık), typecheck, lint, aynı gerçek `_test` PostgreSQL ile **1.223/6** test ve build/bundle yeniden geçti; geçici kopya kaldırıldı.

## Paket 43 — Kullanıcı kontrollü İşçilik çekirdeği (2026-07-17)

- v0.7 İşçilik’in ilk dilimi: `labor-sheet/1.0.0` saf domain; parça/işçilik satır kalemlerini (kalem, işlem etiketi, minor-birim parça/işçilik tutarı) deterministik doğrular ve toplamı hesaplar. En az bir kalem, satır başına en az bir pozitif tutar; işlem taksonomisi ve tutar dağıtımı sonraki dilimlere bırakıldı.
- Migration 0028; case başına tek `labor_sheets` aggregate, immutable `labor_sheet_versions` ve child `labor_sheet_items` ekler. Case-başına-tek-föy unique, sürüm zinciri guard’ı ve append-only trigger’ları DB seviyesinde zorlanır; tutarlar bigint minor birimdir.
- Read salt okunur ve audit yazmaz. Create/revise; Idempotency-Key, optimistic version (create’de case, revise’da föy sürümü), RBAC (`admin/expert/case_manager/secretary`), kapalı-case kilidi ve merkezi audit ile atomiktir. Audit yalnız kalem sayısı, parça/işçilik/genel toplam minor ve source type taşır; satır açıklaması/işlem metni taşımaz.
- Dosya Detayı > İşçilik sekmesi API modunda gerçek föye bağlanır: kullanıcı kalemleri girer/düzenler, açık onayla oluşturur/revize eder, immutable sürüm geçmişini görür. Mock İşçilik prototipi ayrı korunur ve API hatasında fallback yapılmaz. AI önerisi ve güvenli Excel yazımı bu pakette yoktur.
- Yeni dependency, AI/provider çağrısı, Gmail, Excel yazımı, File Agent, IPC veya fiziksel dosya erişimi eklenmedi. Üretim migration çalıştırılmadı.
- Ana çalışma ağacında typecheck, lint, gerçek `hasarbotu_test` PostgreSQL ile **1.257 başarılı / 6 mevcut ortam-koşullu UI skip**, build/bundle, moderate audit (0 açık) ve diff-check geçti. Dağılım: UI 213/6; domain 418; contracts 250; database 55; API 268; file-agent 53 (Paket 42'ye göre +34; DB/API/domain/contracts/file-agent'ta skip yok).
- Migration 0028 tekil ve 0027→0021 ile kademeli rollback-reapply gerçek PostgreSQL'de geçti. 0028 kısıt testi case-başına-tek-föy unique'ini, her iki tutarı sıfır satırın CHECK reddini, sürüm/satır append-only'sini, yanlış previous ile sürüm zinciri guard reddini ve aggregate silme yasağını doğruladı. Paket 43 gerçek API testi 7/7: 401/tenant-404/salt-okunur/boş föy; create + toplam + idempotent replay; ikinci föy 409; revise + immutable sürüm 1 + version conflict; geçersiz satır alan hatası; kapalı case reddi; audit'te satır metni sızıntısı yok. Kritik DB/API testi skip edilmedi.
- Gerçek Chrome/CDP smoke (8/8 senaryo): login; boş föy durumu; kullanıcı kontrollü kalem girişi + açık onayla kayıt; DB'de sheet/version/item provenance; düzeltmede immutable sürüm 2; audit yalnız güvenli sayı/toplam metadata; API kapatılınca mock fallback yok; console temiz. 1366×768 açık/koyu ve 1920×1080 koyu görünümde yatay taşma yoktu.
- Build başlangıç JavaScript grafiğini **469.250 baytta** tuttu; en büyük chunk 299.199 bayt ve İşçilik dahil **9 lazy modül** bundle guard'ında zorunlu kılınarak ayrı kaldı.
- Repository dışı `.git/node_modules/dist/coverage/tmp` içermeyen kopyada fresh `npm ci` (0 açık; bilinen `glob@11.1.0` deprecation uyarısıyla), typecheck, lint, aynı gerçek `_test` PostgreSQL ile **1.257/6** test ve build/bundle yeniden geçti; geçici kopya kaldırıldı.

## Paket 44 — Kanıtlı AI işçilik önerisi (2026-07-17)

- Paket 43 çekirdeği üzerine `labor-ai-draft/1.0.0` planı eklendi (HB-2026-050). Girdi bounded hasar tarifi + mevcut föy kalemleridir; external payload PII-minimize edilir, plaka/ofis numarası dışarı çıkmaz ve hasar tarifi ham metni DB/audit/log'a yazılmaz.
- Organization işçilik AI opt-in/allow-list'i varsayılan kapalıdır. Plan provider çağrısı veya audit yazmaz; start güncel case/föy sürümü + plan hash, zorunlu Idempotency-Key, üç modüllü ortak `ai_usage_ledger` (`policy_analysis | email_draft | labor_sheet`) hard-stop'u ve açık egress onayı ister. Her modülün ay-içi hesabı diğer modüllerin aktif receipt rezervasyonlarını da sayar.
- Migration 0029 immutable suggestion run, durable provider receipt, `ai_provider_policies` labor opt-in kolonları ve `labor_sheet_versions` üzerinde `ai_assisted` + `labor_ai_suggestion_run_id` provenance'ını ekler. Provider cevabı sonrası finalize kesintisi ikinci çağrı olmadan recover edilir; belirsiz network sonucu otomatik retry yapmadan `outcome_unknown` kalır.
- Strict server doğrulaması schema dışı, Paket 43 kalem/tutar sınırı ihlali, PII/placeholder, URL ve filesystem path içeren çıktıyı öneri yapmaz; ham provider çıktısı saklanmaz. Gemini adapter mevcut server-only secret sınırını, secret-header ve sınırlı 503 backoff'unu kullanır.
- İşçilik editörü privacy/bütçe planını, prompt-injection uyarısını, egress onayını ve insan incelemeli kalem önerisini gösterir. "Öneriyi uygula" yalnız düzenleme satırlarını değiştirir ve kayıt onayını sıfırlar; açık onayla kaydedilen sürüm `ai_assisted` provenance taşır. Mock prototip ve API hatasında no-fallback sınırı değişmedi.
- Ana çalışma ağacında typecheck, lint, gerçek `hasarbotu_test` PostgreSQL ile **1.286 başarılı / 6 mevcut ortam-koşullu UI skip**, build/bundle, moderate audit (0 açık) ve diff-check geçti. Dağılım: UI 214/6; domain 426; contracts 259; database 57; API 277; file-agent 53 (Paket 43'e göre +29; kritik testlerde skip yok).
- Migration 0029 tekil ve 0028→0021 ile kademeli rollback-reapply gerçek PostgreSQL'de geçti; 0029 kısıt testi labor policy allow-list CHECK'ini, terminal run immutability'sini, run bağı olmayan `ai_assisted` sürüm reddini ve run bağı olmayan `labor_sheet` usage reddini doğruladı. Paket 44 gerçek API testi 9/9: plan salt-okunur + kapalı provider çağrısız; RBAC/tenant/kapalı-case; strict öneri + idempotent replay; stale plan 409; geçersiz çıktı raw saklamadan fail-closed; bütçe hard-stop çağrıdan önce; `outcome_unknown` no-retry; ai_assisted provenance + geçersiz run reddi; audit/run sızıntısızlığı.
- Gerçek Chrome/CDP smoke (13/13 senaryo): login; provider kapalıyken çağrı yok ve plan state yazmaz; PII-minimize egress (tarifteki ad/e-posta redakte, plaka/ofis no dışarı çıkmaz, injection metni yalnız veri); açık egress onayı; insan incelemeli öneri; "öneriyi uygula" yalnız form state + onay sıfırlama; DB'de `ai_assisted` + run + `labor_sheet` usage provenance; bütçe hard-stop; audit sızıntısız; API kapatılınca fallback yok; console temiz. 1366×768 açık/koyu ve 1920×1080 koyu görünümde yatay taşma yoktu.
- Build başlangıç JavaScript grafiğini **469.250 baytta** tuttu; AI paneli lazy İşçilik chunk'ında kaldı ve **9 zorunlu lazy modül** korundu.
- Repository dışı temiz kopyada fresh `npm ci` (0 açık), typecheck, lint, aynı gerçek `_test` PostgreSQL ile **1.286/6** test ve build/bundle yeniden geçti; geçici kopya kaldırıldı.
- Yeni dependency, Excel yazımı, öğrenme sözlüğü, Gmail, File Agent, IPC veya fiziksel dosya erişimi eklenmedi. Üretim migration çalıştırılmadı.

## Paket 45 — Kullanıcı kontrollü PERT değerlendirme çekirdeği (2026-07-18)

- v0.8 PERT’in ilk dilimi (HB-2026-051): `pert-assessment/1.0.0` saf domain; DOMAIN_RULES’taki dokuz süreç durumu, minor-birim ekonomik veriler ve türetilmiş hasar/rayiç oranı (eşik/otomatik karar yok). AI önerisi, eksper kanaati ve merkez kararı ayrı alanlardır; kanaat zorunlu gerekçeli, merkez kararı yalnız karar durumlarıyla birebir eşleşir.
- v0.7’nin kalan güvenli Excel yazımı dilimi bilinçli ertelendi: yeni major dependency, gerçek ofis Excel şablon bilgisi ve ilk fiziksel içerik-yazma yolu kullanıcı onayı ister.
- Migration 0030; case başına tek `pert_assessments` aggregate ve immutable `pert_assessment_versions` ekler. Karar tutarlılığı, sürüm zinciri ve append-only kısıtları DB seviyesinde zorlanır.
- Read salt okunur ve audit yazmaz. Create/revise; Idempotency-Key, optimistic version, RBAC (`admin/expert/case_manager` — sekreterlik salt okunur), kapalı-case kilidi ve merkezi audit ile atomiktir. Audit yalnız durum/kanaat/karar kodu, oran ve sürüm taşır; gerekçe/not serbest metni taşımaz.
- Dosya Detayı > Ağır Hasar sekmesi API modunda gerçek değerlendirmeye bağlandı; API modunda bağlı olmayan son dosya modülü kapandı. Mock prototip ayrı korunur ve API hatasında fallback yapılmaz.
- Ana çalışma ağacında typecheck, lint, gerçek `hasarbotu_test` PostgreSQL ile **1.311 başarılı / 6 mevcut ortam-koşullu UI skip**, build/bundle, moderate audit (0 açık) ve diff-check geçti. Dağılım: UI 218/6; domain 432; contracts 266; database 59; API 283; file-agent 53 (Paket 44'e göre +25; kritik testlerde skip yok).
- Migration 0030 tekil ve 0029→0021 ile kademeli rollback-reapply gerçek PostgreSQL'de geçti; 0030 kısıt testi case-başına-tek-değerlendirme unique'ini, gerekçesiz kanaat ve tutarsız merkez kararı CHECK reddini, sürüm append-only'sini ve aggregate silme yasağını doğruladı. Paket 45 gerçek API testi 6/6: 401/tenant-404/sekreterlik yazma reddi; create + oran türetme + idempotent replay + ikinci değerlendirme 409; gerekçesiz kanaat ve karar uyuşmazlığı 400; kanaat→merkez kararı ayrı sürümler + immutable geçmiş + stale 409; kapalı case reddi; audit'te serbest metin sızıntısı yok.
- Gerçek Chrome/CDP smoke (10/10 senaryo): login; boş değerlendirme durumu; kullanıcı kontrollü oluşturma; türetilmiş %77 oran (eşiksiz); ayrı eksper kanaati; ayrı merkez kararı alanı; immutable sürüm 2; audit sızıntısız; API kapatılınca fallback yok; console temiz. 1366×768 açık/koyu ve 1920×1080 koyu görünümde yatay taşma yoktu.
- Build başlangıç JavaScript grafiğini **472.166 baytta** tuttu; en büyük chunk 299.204 bayt ve PERT dahil **10 zorunlu lazy modül** ayrı kaldı.
- Repository dışı temiz kopyada fresh `npm ci` (0 açık), typecheck, lint, aynı gerçek `_test` PostgreSQL ile **1.311/6** test ve build/bundle yeniden geçti; geçici kopya kaldırıldı.
- Yeni dependency, AI/provider çağrısı, SBM/dış veri, Excel yazımı, File Agent, IPC veya fiziksel dosya erişimi eklenmedi. Üretim migration çalıştırılmadı.

## Paket 46 — İşçilik öğrenme sözlüğü (2026-07-18)

- v0.7'nin öğrenme sözlüğü dilimi (HB-2026-052): `labor-dictionary/1.0.0` saf domain; Türkçe duyarlı (küçük harf + aksan ayrıştırma) normalize anahtar, alt dize araması ve kullanım sayısı → son kullanım → Türkçe alfabetik deterministik sıralama. AI yoktur.
- **Yeni tablo/migration yoktur**: sözlük yalnız kullanıcıların açık onayla kaydettiği föylerin güncel sürümlerindeki kalemlerden organization kapsamında türetilen salt okunur read-model'dir; eski sürüm kalemleri sayılmaz.
- `GET /api/v1/labor-dictionary` oturum zorunlu, tenant kapsamlı, 200 kayıt sınırlı ve audit yazmayan uçtur. Sorgu/limit strict doğrulanır.
- İşçilik editöründe öneriler yalnız `datalist` olarak sunulur; seçimde işlem ve son tutarlar **yalnız boş alanlara** yazılır, kullanıcının girdiği değer ezilmez, satır otomatik eklenmez ve Paket 43'ün ayrı kayıt onayı olmadan föy oluşmaz. Sözlük yalnız düzenleme açıkken yüklenir; hata halinde liste boş kalır, akış engellenmez ve mock fallback yapılmaz.
- Ana çalışma ağacında typecheck, lint, gerçek `hasarbotu_test` PostgreSQL ile **1.330 başarılı / 6 mevcut ortam-koşullu UI skip**, build/bundle, moderate audit (0 açık) ve diff-check geçti. Dağılım: UI 219/6; domain 440; contracts 271; database 59; API 288; file-agent 53 (Paket 45'e göre +19).
- Paket 46 gerçek API testi 5/5: 401 + salt okunur çağrının audit yazmaması; kullanım sayısı ve son tutarların türetilmesi; tenant izolasyonu; aksan duyarsız arama + limit + geçersiz limit 400; yalnız güncel föy sürümünün sayılması (revize sonrası eski kalem sözlükten düşer).
- Gerçek Chrome/CDP smoke (9/9 senaryo): login; onaylı föylerden türetilen datalist; tenant sızıntısı yok; öneri yalnız boş alanları doldurur; kullanıcının yazdığı işlem ezilmez; otomatik kayıt yok; salt okunur uç audit yazmaz; API kapatılınca fallback yok; console temiz. 1366×768 açık/koyu ve 1920×1080 koyu görünümde yatay taşma yoktu.
- Build başlangıç JavaScript grafiğini **472.166 baytta** tuttu (değişmedi); 10 zorunlu lazy modül korundu.
- Repository dışı temiz kopyada fresh `npm ci` (0 açık), typecheck, lint, aynı gerçek `_test` PostgreSQL ile **1.330/6** test ve build/bundle yeniden geçti; geçici kopya kaldırıldı.
- `CaseDetailPage.api.test.tsx` içindeki `waitFor` varsayılan 1 sn'lik ölü hattı 15 sn'ye çıkarıldı: contracts paketi büyüdükçe ilk dinamik import + Zod şema kurulumu bu süreyi aşıyordu. Test hâlâ gerçek yükleme sonucunu doğrular; kapsam daralmadı.
- Yeni tablo/migration, dependency, AI çağrısı, Excel yazımı, File Agent, IPC veya fiziksel dosya erişimi eklenmedi. Üretim migration çalıştırılmadı.

## Paket 47 — API modunda kimlik ve yönetim listelerinde mock yasağı (2026-07-18)

- Denetimde iki gerçek ihlal bulundu ve kapatıldı (HB-2026-053): (1) Yönetim ekranı API modunda da mock kullanıcı/servis listesi gösteriyordu; (2) sol menü kullanıcı kartı gerçek oturumda bile sabit kodlu prototip kimliği ("Ömer Faruk Kaya · Eksper") gösteriyordu. İkincisi kimin oturum açtığını yanlış gösterdiği için daha ağırdı.
- Yönetim'in Kullanıcılar/Servisler sekmeleri API modunda yalnız **mevcut** referans uçlarından beslenir; yeni tablo, migration, endpoint veya sözleşme eklenmedi.
- Gerçek referans sözleşmesinde karşılığı olmayan mock sütunları (telefon, atanmış dosya, açık dosya) gösterilmez — uydurulmuş sütun veya sahte sayı eklenmedi. Eksper rolü `experts` referansından türetilir; servis türü/anlaşma/aktiflik sürümlü değerlendirmeden gelir.
- Sol menü kimliği gerçek oturumdan gelir (`displayName` + rol kodlarının Türkçe etiketleri, baş harf avatarı). API modunda oturum yoksa "Oturum bekleniyor / Kimlik doğrulanmadı" gösterilir; prototip kimliği yalnız mock modda kalır. API modunda mock "Yeni Kayıt" butonu gizlenir (gerçek yazma yolu yoktur).
- Belge Kuralları ve Erişim ve Yetki sekmeleri mock kayıt değil kilitli proje kurallarının statik özetidir; her iki modda korunur.
- Ana çalışma ağacında typecheck, lint, gerçek `hasarbotu_test` PostgreSQL ile **1.339 başarılı / 6 mevcut ortam-koşullu UI skip**, build/bundle, moderate audit (0 açık) ve diff-check geçti. Dağılım: UI 228/6; domain 440; contracts 271; database 59; API 288; file-agent 53 (Paket 46'ya göre +9 UI testi).
- Gerçek Chrome/CDP smoke (11/11 senaryo): login; API modunda gerçek kullanıcı/servis; mock kullanıcı ve servis sızıntısı yok; eksper rolü türetildi; tenant izolasyonu; uydurulmuş sütun yok; salt okunur görünüm audit yazmaz (yalnız beklenen `auth.*`); API kapatılınca fallback yok; console temiz. 1366×768 açık/koyu ve 1920×1080 koyu görünümde yatay taşma yoktu.
- Build başlangıç JavaScript grafiğini **476.645 baytta** tuttu; 10 zorunlu lazy modül korundu.
- Repository dışı temiz kopyada fresh `npm ci` (0 açık), typecheck, lint, aynı gerçek `_test` PostgreSQL ile **1.339/6** test ve build/bundle yeniden geçti; geçici kopya kaldırıldı.
- Yeni tablo/migration/endpoint/sözleşme, dependency, AI çağrısı, Excel yazımı, File Agent, IPC veya fiziksel dosya erişimi eklenmedi. Bildirimler ve Mevzuat ekranları hâlâ mock prototiptir ve ayrı kapsamdır.

## Paket 48 — API modunda mock karantinası (2026-07-18)

- HB-2026-054: backend'i henüz kurulmamış ekranlar API modunda mock içeriğe düşmez; örnek kayıt yerine ne olduğunu açıkça söyleyen boş durum gösterilir. Bu, Paket 47'deki kuralın backend'i bulunmayan ekranlara uygulanmasıdır.
- Bildirimler API modunda "Bildirim altyapısı henüz etkin değil.", Mevzuat "Mevzuat kaynak kütüphanesi henüz yapılandırılmadı." gösterir. Ortak `BackendUnavailableState` bileşeni eklendi.
- Mock gövdeleri ayrı bileşenlere alındı ve API modunda **hiç render edilmez** — örnek kayıtlar DOM'a girmez, yalnız CSS ile gizlenmez. Yalnız mock veriyle anlamlı yüzeyler (okunmamış sayacı, "Tümünü Okundu İşaretle", filtreler, mock soru–cevap, "6 yerel mock kaynak" rozeti) API modunda sunulmaz.
- **Sahte veri kaynağı üretilmedi**: yeni tablo, migration, endpoint, domain modeli veya boş dönen sahte adapter eklenmedi. Bildirim olay modeli ve mevzuat kaynak kütüphanesi modeli bilinçli olarak kapsam dışıdır ve ayrı ürün kararı bekler.
- Ana çalışma ağacında typecheck, lint, gerçek `hasarbotu_test` PostgreSQL ile **1.345 başarılı / 6 mevcut ortam-koşullu UI skip**, build/bundle, moderate audit (0 açık) ve diff-check geçti. Dağılım: UI 234/6; domain 440; contracts 271; database 59; API 288; file-agent 53 (Paket 47'ye göre +6 UI testi).
- Gerçek Chrome/CDP smoke (8/8 senaryo): login; iki ekranda dürüst boş durum; mock kaynak dosyasından okunan **32 sabit örnek metnin** hiçbiri API modunda DOM'da yok; mock'a özgü kontrol yüzeyleri yok; API kapatıldıktan sonra da mock sızıntısı yok; console temiz. 1366×768 açık/koyu ve 1920×1080 koyu görünümde yatay taşma yoktu.
- Build başlangıç JavaScript grafiğini **478.065 baytta** tuttu; 10 zorunlu lazy modül korundu.
- Repository dışı temiz kopyada fresh `npm ci` (0 açık), typecheck, lint, aynı gerçek `_test` PostgreSQL ile **1.345/6** test ve build/bundle yeniden geçti; geçici kopya kaldırıldı.

## HB-011 — Kaynak bazlı yetki matrisi (2026-07-28)

- HB-2026-102: yetkilendirme "oturum var mı" seviyesinden **kaynak bazlı rol matrisine** taşındı. Mevcut rol/API/UI yetki boşlukları haritalandı; bulunan gerçek boşluklar kapatıldı.
- **Yazma boşlukları (gerçek kusur).** Dört uç yalnız `requireSession` kullanıyordu: `read_only` rolü bile fiziksel klasör kurulumu/taşıma planlayabiliyor, dosya konumu atayabiliyor ve evrak/fotoğraf kaydı girebiliyordu. `file-operations`, `workspace` ve `storage` (konum atama) artık `admin|expert|case_manager` (case-lifecycle ile aynı kritik-işlem sınırı); `documents` artık `admin|expert|case_manager|secretary` (not/görev ile aynı clerical sınıf).
- **Mali görünürlük.** `GET /fees` ve `GET /cases/:caseId/fee` `admin|expert|case_manager|accounting` ister; `secretary`/`read_only` 403 alır. Aylık case-summary raporu tüm rollere açık kalır ama mali alanlar maskelenir: tutarlar `null`, `pendingFees` boş, yeni `includesFinancials:false`. UI tutar yerine "Gizli" gösterir ve **uydurulmuş ₺0,00 üretmez**; operasyonel sayaçlar değişmeden görünür.
- **Gerçek rol atama.** Önce rol değişikliği yalnız doğrudan `user_roles` SQL mutasyonuyla mümkündü. `GET /api/v1/users` + `PATCH /api/v1/users/:userId/roles` eklendi: admin-only, tenant kapsamlı, `users.version` ile optimistic lock, `user.roles_changed` audit kaydı. Yönetim > Kullanıcılar sekmesi admin oturumunda gerçek rol tablosunu gösterir; admin olmayan rollerde mevcut salt-okunur referans görünümü değişmeden kalır.
- **Son-yönetici garantisi**: bir admin kendi admin rolünü kaldıramaz (`user_self_lockout_blocked`, 409). Admin rolü yalnız bir admin tarafından kaldırılabildiği ve aktör kendini kaldıramadığı için organizasyon hiçbir zaman sıfır yöneticide kalamaz. Oturum canlı JOIN ile çözüldüğü için yükseltme **ve** düşürme bir sonraki istekte anında etkilidir; bayat yetki taşınmaz.
- "Erişim ve Yetki" sekmesindeki muğlak özet ("Kritik İşlem → Kullanıcı onayı"), sunucuda gerçekten uygulanan kapıları yansıtan **15 satırlık kaynak bazlı matrisle** değiştirildi. Matris yetki vermez; yalnız yürürlükteki kapıyı görünür kılar.
- Sertleştirme: rol INSERT'ünün satır sayısı istenen rol sayısıyla karşılaştırılır; sözleşme enum'u ile `roles` tablosu ayrışırsa işlem geri alınır ve **gerçekte verilmemiş bir yetki verilmiş gibi raporlanmaz**.
- **Yeni tablo/migration YOK**; mevcut `users`/`roles`/`user_roles` (0002) kullanıldı. Yeni dependency, AI çağrısı, Excel yazımı, File Agent, IPC veya fiziksel dosya erişimi eklenmedi. Kullanıcı oluşturma/silme/pasifleştirme kapsam dışıdır.
- `caseSummaryReportResponse` sözleşmesi kırıcı değişti (`includesFinancials` zorunlu; iki tutar alanı nullable); JSON schema fixture'ları güncellendi.
- Ana çalışma ağacında typecheck, lint (0 error / 2 mevcut warning, değişmedi), gerçek `hasarbotu_test` PostgreSQL ile **2.105 başarılı / 6 mevcut ortam-koşullu UI skip**, build/bundle ve moderate audit (0 açık) geçti. Dağılım: UI 379/6; domain 759; contracts 324; database 74; API 491; file-agent 78.
- Yeni `permission-matrix-uat-e2e.test.ts` gerçek PostgreSQL ile koşuldu (**skip edilmedi**): admin-only liste, gerçek PATCH ile yetki yükseltme, canlı oturum yansıması, sürüm çakışması, self-lockout, tenant izolasyonu (capraz-org PATCH 404) ve dört write-role boşluğunun kapandığı tek akışta doğrulandı. `reports-fees-uat-e2e.test.ts` maskeleme + tenant izolasyonunu birlikte doğrulayacak şekilde güncellendi.
- Build başlangıç JavaScript grafiğini **426.065 baytta** tuttu; 10 zorunlu lazy modül korundu.
- **Doğrulanamayan:** gerçek Chrome/CDP tarayıcı smoke bu pakette çalıştırılmadı; UI davranışı yalnız component testleriyle doğrulandı. Değer kaybı tazminat tutarı bilinçli olarak "mali alan" sayılmadı (modül okumaları tüm rollere açık) ama rapordaki toplamı maskelenir; bu asimetrinin genişletilmesi ayrı ürün kararıdır.

## D1 — Masaüstü kabuğu için loopback aynı-origin köprüsü (2026-07-28)

- HB-2026-103: Electron kabuğuna geçmeden önceki mimari kilit. Renderer'ın göreceği origin sayısı **bire** indirilir: masaüstü main process'i `127.0.0.1`'de bir loopback HTTP köprüsü açar, aynı `host:port` hem UI build çıktısını hem `/api/*` isteklerini karşılar ve `/api/*` sunucu-sunucu API origin'ine iletilir. Tarayıcı API origin'ini hiç görmez.
- **Reddedilen seçenekler:** (1) API'ye CORS + CSRF token eklemek — bugünkü CSRF koruması tamamen `SameSite=Strict` + aynı-origin varsayımına dayanıyor; CORS açmak bu korumayı bırakıp yerine yeni altyapı kurmak ve HB-011'de sıkılaştırılan yetki hattına yeni saldırı yüzeyi eklemek olurdu. (2) API'nin static UI sunması — `@fastify/static` eklemeyi ve API'yi UI sunucusuna dönüştürmeyi gerektirirdi.
- Seçilen yol UI sözleşmesine, **28 HTTP adapter'ın `baseUrl` kullanımına**, oturum çerezi politikasına ve API'ye hiç dokunmaz. Paket 21'in geri alma stratejisi ("desktop paketini kaldır, web dağıtımını kullan") aynen geçerli kalır.
- **Gerçek kanıt** (gerçek PostgreSQL + gerçek API + gerçek login), `desktop-bridge-same-origin-e2e.test.ts` 5/5: köprü üzerinden login 200 ve `Set-Cookie` nitelikleri (`SameSite=Strict; HttpOnly; Path=/`) korunuyor — API'nin doğrudan ürettiği çerezle **nitelik nitelik aynı**; çerezi veren ve taşıyan istekler aynı scheme+host+port'ta; oturumlu `GET /auth/session` gerçek kullanıcıyı çözüyor; HB-011 admin-only `GET /users` kapısı köprüden geçiyor; ne köprü ne API `access-control-*` üretiyor; çerezsiz istek 401 kalıyor.
- BrowserRouter derin yolu `index.html`'e düşüyor, **eksik varlık dosyası 404 kalıyor** (bozuk build sessizce HTML dönmüyor). Traversal denemeleri ham HTTP yoluyla (istemci normalizasyonu atlanarak) kök dışındaki dosyanın içeriğini hiçbir durumda döndürmüyor; olumlu kontrol aynı yolla kök içindeki dosyanın döndüğünü kanıtlıyor. Loopback dışı `Host` 403; API erişilemezken 502 ve ham hata metni yok.
- **Bulunan ve düzeltilen gerçek kusur:** `resolveAssetPath` sürücü önekini tüm dizgede arıyordu; URL yolu daima `/` ile başladığı için `/C:/Windows` kaçıyordu. Kontrol segment bazına alındı — `path.resolve` bir `C:` segmentini sürücüye göreli sayıp kökten çıkabilirdi. Birleştirme sonrası containment denetimi zaten ikinci savunma katmanıydı.
- Yeni `packages/desktop-bridge` workspace'i: **runtime dependency yok**, yalnız Node yerleşikleri, **Electron import edilmez** ve iş mantığı içermez (ADR-Q06 ince kabuk). `services/api`'ye yalnız devDependency olarak eklendi (mevcut `@hasarbotu/file-agent` precedent'i ile aynı).
- **Bu pakette Electron dependency'si, `apps/desktop` ve paketleme YOKTUR.** UI, contracts, API runtime kodu ve migration değişmedi; yeni tablo/migration/endpoint/sözleşme yok.
- Ana çalışma ağacında typecheck, lint (0 error / 2 mevcut warning, değişmedi), gerçek `hasarbotu_test` PostgreSQL ile **2.120 başarılı / 6 mevcut ortam-koşullu UI skip**, build/bundle ve moderate audit (0 açık) geçti. Dağılım: UI 379/6; domain 759; contracts 324; database 74; desktop-bridge 10; API 496; file-agent 78 (HB-011'e göre +15: 10 köprü politika testi + 5 gerçek e2e).
- Build başlangıç JavaScript grafiği **426.065 baytta değişmedi**; 10 zorunlu lazy modül korundu (köprü frontend bundle'ına girmez).
- **GERÇEK TARAYICI KANITI (HB-2026-104, aynı gün tamamlandı — D2'ye bırakılmadı):** `scripts/d1-bridge-browser-smoke.mjs` gerçek Chrome/CDP + **gerçek üretim UI build çıktısı (`dist`)** + gerçek köprü + gerçek API + gerçek PostgreSQL + gerçek login ile koştu, **10 kontrol PASS**. Vite dev proxy'si devrede **değil**: köprü dağıtım biçiminin ta kendisi ölçüldü.
  - Çerezin **tarayıcının kendi kaydındaki** nitelikleri (`Network.getAllCookies`): `sameSite=Strict`, `httpOnly=true`, `path=/`, host-only `127.0.0.1`, `secure=false` (düz loopback), TTL 43.199 s. `document.cookie` çerezi görmüyor — HttpOnly'yi tarayıcı uyguluyor.
  - Aynı-origin `/api/v1/auth/session` 200 ve gerçek kullanıcı; çerezin gönderildiği tarayıcının **istek kaydından** doğrulandı (`requestWillBeSentExtraInfo.associatedCookies`, blockedReasons boş). API'ye bağlı `/dosyalar` ekranı gerçek veriyi köprüden geçerek render etti.
  - Tarayıcı **API origin'ine hiç istek atmadı**: gözlenen 28 isteğin 28'i köprü origin'ine, 0'ı API authority'sine. Hiçbir yanıtta `access-control-*` görülmedi.
  - **SameSite=Strict'in gerçek tarayıcı davranışı:** aynı hedef URL, aynı çerez, aynı sunucu; değişen tek şey başlatıcının site'ı. Aynı-site başlatıcı → çerez gönderildi, 200; **çapraz-site başlatıcı (`http://localhost:{port}` sayfası) → 401 `unauthorized` ve Chrome gerekçeyi `blockedReasons: ["SameSiteStrict"]` olarak bildirdi.** CSRF korumasının SameSite üzerine kurulmasının ve CORS'un reddedilmesinin doğrudan kanıtı.
  - Eksik varlık gerçek tarayıcıda da 404: `index.html` favicon bildirmediği için Chrome `/favicon.ico` istedi, köprü uzantılı yolu SPA kabuğuna düşürmedi.
  - Betik `npm test` kapsamına **alınmadı** (Chrome test bağımlılığı değil; repo genelindeki `router-v8`/`packageNN-browser-smoke` precedent'iyle aynı) ve üretim kodunda **hiçbir değişiklik gerektirmedi**.
- **Açık kalan:** üretimde `cookieSecure` değeri (düz loopback HTTP mi, köprüde TLS sonlandırma mı) D2/Paket 22 dağıtım kararıdır; smoke düz HTTP loopback'i ölçer ve çerezde `secure=false` olduğunu açıkça kaydeder.

## D2 — İnce Electron kabuğu iskeleti (2026-07-28)

- HB-2026-105: `apps/desktop` workspace'i kuruldu. Kabuk **yalnız üç şey** yapar: D1 köprüsünü başlatır, güvenli bir `BrowserWindow` açar ve `src/main/security.ts`teki kararları Electron API'lerine bağlar. **İş mantığı yok, `ipcMain` handler'ı yok** (ADR-Q06 ince kabuk; Paket 21 geri alma stratejisi aynen geçerli).
- **Preload allowlist'i kasıtlı olarak ayrıcalıksız:** renderer'a yalnız iki **veri** alanı açılır (`isDesktopShell`, `platform`). Fonksiyon yok, IPC kanalı yok, `ipcRenderer` yok. İzin ve yeni-pencere allowlist'leri de açık ama **boş** dizilerdir.
- **Güvenlik ayarları:** `nodeIntegration=false`, `contextIsolation=true`, `sandbox=true`, `webSecurity=true`, `webviewTag=false`. CSP `default-src 'none'` ile başlar; `script-src`/`style-src`/`connect-src` yalnız `'self'`; **`unsafe-inline`/`unsafe-eval` yok** (`style-src` dahil). CSP yalnız doküman yanıtlarına yazılır; `/api/*` JSON yanıtları değiştirilmez, köprünün şeffaflığı ve `set-cookie` aktarımı korunur.
- **Yapılandırma sınırı** `services/api/src/config.ts` sözleşmesini izler (açık parser, geçersiz değerde başlatma yok, hata mesajında ortam değeri yok). Ek kural: `HASARBOTU_API_ORIGIN` için düz `http` **yalnız loopback**'te kabul edilir; uzak API `https` olmalıdır (Paket 22 LAN dağıtımında oturum çerezi düz metin geçemez).
- **Gerçek kanıt** (gerçek Electron 43 + gerçek Chromium + gerçek API + gerçek PostgreSQL + gerçek login), `apps/desktop/test/electron-shell-e2e.test.ts` **6/6**. Koşum aracı üretim kabuğunun ta kendisini (`startDesktopShell`) başlatır; **ürün kodunda test kancası yoktur**.
  - Gerçek renderer ayarları `getLastWebPreferences()` ile okundu ve beklenen güvenli değerlerde çıktı; tek pencere, yüklenen adres köprünün loopback origin'i.
  - Renderer'da Node yok: `require`, `process`, `module`, `Buffer`, `global`, `__dirname`, `ipcRenderer` sayfada `undefined`. Preload yüzeyi tam olarak `['isDesktopShell','platform']`; sayfanın değiştirme denemesi değeri değiştirmedi.
  - **Login → SameSite oturum zinciri tarayıcının kendi çerez kavanozuyla:** `document.cookie` çerezi hiçbir aşamada görmedi (HttpOnly'yi Chromium uyguluyor), buna rağmen sonraki `/auth/session` isteği **200** döndü ve gerçek kullanıcıyı (`roles: ['admin']`) çözdü. HB-011 admin-only `/users` kapısı da kabuktan geçti.
  - **CSP gerçekten uygulanıyor:** inline script çalışmadı (`script-src-elem` ihlali); dış ağ çıkışı engellendi (`connect-src` ihlali) — XSS olsa bile veri dışarı sızamaz.
  - **Kapılar tuttu:** `window.open` `null` döndü ve ikinci pencere açılmadı; `Notification.requestPermission()` `denied`; sayfa başlatmalı uzak gezinme engellendi, adres değişmedi.
  - **Gerçek üretim UI build'i (`dist`) aynı kabukta açıldı:** login ekranı render edildi, gerçek form gerçek API'ye gönderildi, `.app-shell` render edildi (hata yok). Chromium'un kendi çerez kaydında `httpOnly=true`, `sameSite=strict`, `path=/`, `secure=false` (düz loopback). Üretim UI'ı bu CSP altında **hiçbir ihlal üretmedi**.
- **Üretim giriş noktası elle smoke edildi:** gerçek pencere "HasarBotu V2" başlığıyla açıldı; `HASARBOTU_API_ORIGIN` uzak düz-http verildiğinde süreç 1 ile çıktı ve stderr yalnız alan adı + kural yazdı (değer sızmadı).
- **Bulunan ve düzeltilen gerçek kusur:** ESM giriş noktasında **üst düzey `await app.whenReady()` uygulamayı kilitliyor** — Electron, giriş modülünün değerlendirmesi bitmeden `ready` yaymıyor. Başlatma `app.whenReady().then(bootstrap)` içine alındı; `main.ts` ve koşum aracı bu kuralı belgeleyen uyarı taşıyor.
- **Bağımlılık:** `electron@43.2.0` **yalnız devDependency** (paketleyici bundle eder); tek runtime dependency `@hasarbotu/desktop-bridge`. Kök `build:packages`/`typecheck`/`test` zincirlerine eklendi.
- **Kapsam dışı (kullanıcı talimatı):** code signing, installer, otomatik güncelleme. Ayrıca renderer'dan Node/fs erişimi, doğrudan PostgreSQL ve harici bağlantıyı varsayılan tarayıcıya devretme bu pakette yok. UI, contracts, API runtime kodu, migration ve adapter sözleşmeleri değişmedi.
- Ana çalışma ağacında typecheck, lint (0 error / 2 mevcut warning, değişmedi), gerçek `hasarbotu_test` PostgreSQL ile **2.146 başarılı / 6 mevcut ortam-koşullu UI skip**, build/bundle ve moderate audit (0 açık) geçti. Dağılım: UI 379/6; domain 759; contracts 324; database 74; desktop-bridge 10; API 496; file-agent 78; desktop 26 (D1'e göre +26).
- Build başlangıç JavaScript grafiği **426.065 baytta değişmedi**; kabuk frontend bundle'ına girmez.
- **Doğrulanamayan:** Windows installer/paketleme smoke'u çalıştırılmadı (kapsam dışı); kabuk yalnız paketlenmemiş çalıştırma ile doğrulandı. Üretimde `cookieSecure` değeri Paket 22 dağıtım kararı olarak açık kalmaya devam ediyor.

## D3 — openExternal allowlist, güvenli indirme, API hazırlık ve sürüm uyum kapısı (2026-07-28)

- HB-2026-106: D2 iskeletine dört saf politika modülü eklendi (`external.ts`, `downloads.ts`, `compatibility.ts`, `readiness.ts` + `gate.ts`). Kabukta **hâlâ iş mantığı yok**; karar/bağlama ayrımı genişledi.
- **openExternal allowlist:** uzak navigasyon/`window.open` artık koşulsuz reddedilmiyor, önce host allowlist'ine soruluyor. Allowlist yalnız repository'de **gerçekten kullanılan** beş host'u içerir: `mail.google.com` (Gmail compose) ve Değer Kaybı kural kaynakları (`resmigazete.gov.tr`, `seddk.gov.tr` ve `www.` varyantları). Yalnız `https`, kimlik bilgisiz, kontrol karakteri/satır sonu yok, 16 KB üst sınırı (aşan **kısaltılmaz, reddedilir**). İzin verilen hedef bile Electron içinde **hiçbir yeni pencere açmaz** — işletim sistemi tarayıcısına devredilir.
- **Güvenli indirme yönetimi:** indirme kabuğun **kendi origin'inden** başlamalı (UI'ın rapor PDF/envanter Excel akışları `blob:{kabuk-origin}/...` biçimindedir); yabancı origin'den gelen indirme iptal edilir. Sunucudan gelen dosya adı (`content-disposition`) işletim sistemi için güvenli hâle getirilir (yol ayırıcıları/yasak karakterler, Windows ayrılmış cihaz adları, uzantı korunarak uzunluk sınırı). Kabuk kaydetme yolunu **kendisi seçmez**; yalnız kaydetme kutusuna güvenli ön ad verir.
- **API hazırlık + sürüm uyum kapısı:** kabuk pencereyi açmadan önce API'nin `/health` yanıtını **sunucu-sunucu** sorgular (köprü üzerinden değil — `/health` sürümlü tabanın dışındadır). Uyum kuralı: servis kimliği ve ana sürüm birebir; ana sürüm `0` iken ikincil sürüm de birebir (semver `0.x` serisinde kırıcı değişiklik ikincil sürümle taşınır). Erişilemez/uyumsuz/sağlıksız API'de pencere **açılmaz**; kullanıcıya Türkçe, ham hata taşımayan bir kapı (Yeniden dene / Kapat) gösterilir — mahsur kalma yok, sonsuz döngü yok.
- **Gerekçe:** kabuk ve API ayrı dağıtılır (Paket 22); sürümleri kaçınılmaz olarak ayrışır. Harici bağlantı/indirme için sınırsız izin, CSP'nin `connect-src 'self'` ile kapattığı ağ çıkışını başka bir kapıdan yeniden açardı.
- **Gerçek kanıt:** `external.test.ts` allowlist'i UI'ın kendi Gmail compose biçimine ve `packages/domain`'deki gerçek mevzuat kaynak listesine karşı doğruladı (sabit kopya değil). `downloads.test.ts` gerçek Türkçe rapor adlarını koruyor, traversal/yasak karakter/ayrılmış ad/enjeksiyon senaryolarını kapsıyor. `compatibility.test.ts` API'nin kendi yayımladığı `API_SERVICE_NAME`/`API_VERSION`'a karşı doğrulandı. `readiness-integration.test.ts` **gerçek `buildApp()` Fastify sunucusuna karşı** 9 senaryo (hazır, sağlıksız, erişilemez, zaman aşımı, sözleşmesiz gövde, yanlış servis, uyumsuz sürüm, HTTP hatası). `gate.test.ts` sonsuz döngüye girmeme dâhil kullanıcı akışlarını kapsıyor.
- **`electron-shell-e2e.test.ts` gerçek Electron 43 + Chromium, 10/10:** `window.open` hiçbir hedef için (allowlist'teki dâhil) Electron penceresi açmadı; yalnız allowlist'teki Gmail bağlantısı işletim sistemine devredildi, diğeri hiçbir biçimde devredilmedi. Kabuk origin'inden başlatılan gerçek indirme tamamlandı; **gerçek bir HTTP sunucusunun** ürettiği yabancı origin indirmesi iptal edildi.
- **Elle smoke:** gerçek API (3100) açıkken pencere gerçekten açıldı ("HasarBotu V2"); uyumsuz sürüm (9.9.9) bildiren gerçek bir stub sunucuya karşı pencere açılmadı, yalnız "HasarBotu V2 — Sunucu denetimi" başlıklı kapı penceresi göründü.
- **Bağımlılık:** `@hasarbotu/contracts` artık `apps/desktop`'ın runtime dependency'si (yalnız `healthResponseSchema`/`HEALTH_ROUTE` için; yeni sözleşme/alan eklenmedi). UI, API runtime kodu, migration ve adapter sözleşmeleri değişmedi.
- Ana çalışma ağacında typecheck, lint (0 error / 2 mevcut warning, değişmedi), gerçek `hasarbotu_test` PostgreSQL ile **2.221 başarılı / 6 mevcut ortam-koşullu UI skip**, build/bundle **426.065 baytta değişmedi** ve moderate audit (0 açık) geçti. Dağılım: desktop 75 (D2'ye göre +49).
- **Kapsam dışı (kullanıcı talimatı):** paketleme, code signing, otomatik güncelleme.
- **Doğrulanamayan:** Windows installer/paketleme smoke'u bu pakette yok; openExternal/indirme testleri paketlenmemiş çalıştırma ile doğrulandı. Paket 22 dağıtım kararları (`cookieSecure`, code signing, otomatik güncelleme) hâlâ açık.

## D4 — File Agent kök sağlık probu, STORAGE_UNAVAILABLE, manuel drift tespiti, Windows yol uzunluğu sınırı (2026-07-28)

- HB-2026-107: `services/file-agent`e dört tamamlayıcı yetenek eklendi (FILE_STORAGE_AND_AGENT_PLAN §7/§11/§15). `apps/desktop`ı **değil**, `services/file-agent`i etkiler.
- **Kök sağlık probu (yeni `root-health.ts`):** yalnız `lstat` yeterli sayılmaz — pCloud gibi senkron köklerde bağlantı koparsa dizin listeleme son önbelleklenmiş hâliyle başarılı görünebilir. Kökün **gerçekten yazılabilir** olduğu sabit adlı (`.hasarbotu-health-probe.tmp`) küçük bir dosya yazıp **silinerek** doğrulanır. Salt-okuma doğrulama işlerinde (`verifier.ts`) yazma probu atlanır (`verifyWritable:false`) — köke gereksiz trafik yüklenmez.
- **STORAGE_UNAVAILABLE:** probun başarısız olduğu her yerde sunucuya raporlanan hata kodu her zaman sabit `storage_unavailable` dizgesidir; hiçbir sunucu tarafı "nonRetryable" listesinde değildir, mevcut backoff/retry mekanizmasına **sunucu tarafında hiçbir değişiklik olmadan** retryable olarak akar.
- **PENDING_STORAGE — yeni migration/sözleşme YOK:** `agent.ts`da proaktif bir kapı eklendi — `runOnce`, `client.claim()`i çağırmadan önce yapılandırılmış tüm köklerin hafif (yazma probu olmayan) sağlığını kontrol eder; herhangi biri erişilemezse o döngüde **hiçbir iş claim edilmez**, işler PostgreSQL'de sessizce `pending` kalır (PENDING_STORAGE'ın doğal, şema değişikliği gerektirmeyen karşılığı).
- **Bulunan ve düzeltilen gerçek kusur:** önceden, uzun bir `P:\` kesintisinde her iş tekrar tekrar claim edilip anında başarısız olarak attempt bütçesini (varsayılan 5) tüketir ve kesinti bitmeden `dead_letter`a düşerdi. Artık kesinti boyunca hiçbir attempt harcanmaz.
- **Kademeli koruma:** dış kapı bilinçli olarak hafif tutuldu (kök tamamen kayıpken hem okuma hem yazma durur; kök "görünür ama salt-okunur" nadir durumunda okuma işleri claim edilmeye devam eder). Fiziksel (yazma) yürütücülerin her biri (`workspace-provisioner.ts`, `file-operation-executor.ts` — kaynak VE hedef kök, `labor-workbook-executor.ts`'in `apply` yolu) kendi girişinde ayrıca tam (yazma-kanıtlı) probu çalıştırır — ikinci savunma katmanı.
- **Manuel drift tespiti:** `atomic_rename` stratejisinde hedef önceden zaten doluysa, eskiden yalnız genel ve yanlış biçimde yeniden-denenebilir sayılan `destination_exists` dönüyordu (staged_copy aynı durumda zaten manifest karşılaştırması yapıyordu — tutarsızlık). Artık atomic_rename de aynı karşılaştırmadan geçer: içerik kaynakla **eşleşiyorsa** zaten test edilmiş `recovered_existing_destination` yoluna girer; **eşleşmiyorsa** kaynak bırakılır (silinmez) ve yeni `manual_drift_detected` koduyla `manual_recovery_required` fazına girilir — kullanıcıdan manuel doğrulama ister, sessizce yeniden denemez.
- **Windows toplam yol uzunluğu sınırı:** `resolveUnderRoot` (tüm fiziksel/doğrulama yollarının tek çözüm noktası) artık klasik Windows `MAX_PATH` sınırını (259 kullanılabilir karakter) da doğrular; aşan yol `windows_path_too_long` ile reddedilir. Sınır fonksiyon parametresiyle geçersiz kılınabilir; ofis dağıtımında Windows uzun yol desteğinin açılıp açılmayacağı **henüz kararlaştırılmadı**, karar verilene kadar koruyucu (klasik) değer kullanılır.
- **Kapsam dışı (bilinçli, belgelenmiş):** `pdf-text-extractor.ts`/`policy-ocr-extractor.ts` aynı kök-ENOENT yanlış sınıflandırma kalıbını paylaşır ama bu pakette değiştirilmedi (okuma-ağırlıklı AI işleri, zaten sunucu tarafında retryable). İşçilik yazım modülünün türetilmiş geçici/kilit dosya adlarının (`.hasarbotu-write.lock` vb.) uzunluğu ayrıca kontrol edilmiyor — tabana çok yakın nadir bir kenar durum.
- **Gerçek kanıt (gerçek geçici filesystem + gerçek PostgreSQL/API e2e'ler dâhil, mock fs yok):** 24 yeni test — kök sağlığı (8), yol uzunluğu (4), doğrulama false-missing düzeltmesi (2), workspace (2), file operation kök-erişilemezlik + idempotent-eşleşme (4), işçilik yazımı kök koruması (2, yeni dosya), agent döngüsü fail-closed (2 yeni + 1 güncellenmiş).
- `services/api`'nin 496 testi (gerçek PostgreSQL, `runOnce`/`executeFileOperation` kullanan gerçek e2e'ler dâhil) **değişikliksiz** geçti — sunucu tarafında hiçbir kod değişmedi.
- Ana çalışma ağacında typecheck, lint (0 error / 2 mevcut warning, değişmedi), gerçek `hasarbotu_test` PostgreSQL ile **2.225 başarılı / 6 mevcut ortam-koşullu UI skip** (file-agent 78→102, +24), build/bundle **426.065 baytta değişmedi** ve moderate audit (0 açık) geçti.
- **Açık kalan:** Paket 22 dağıtım kararı olarak Windows uzun yol desteği (LongPathsEnabled) açılıp açılmayacağı; açılırsa `DEFAULT_MAX_ABSOLUTE_PATH_LENGTH` tek noktadan güncellenecektir.

## D5 — ADR-Q08 kilidi (WinSW), P:\ görünürlük bulgusu, Faz A servis dağıtım paketi (2026-07-29)

- HB-2026-108: ADR-Q08 **WinSW** ile kilitlendi. NSSM'in resmi kararlı sürümü 2014'te dondu (2017 "ön-sürüm" bile hâlâ önerilir, resmi `nssm.cc/download`'dan doğrulandı); Görev Zamanlayıcı SCM sağlık/bağımlılık semantiğinden yoksun. WinSW aktif bakımlı (v2.12.0, 2025-01-28), `<depend>` ile bağımlılık sırasını deklaratif ifade eder.
- **Kritik bulgu (ölçülüp doğrulandı):** mevcut `P:\` bir pCloud SANAL sürücüsüdür (`net use` boş, `DriveType=2`, `VolumeName=pCloud Drive`), oluşturan `pCloud.exe` süreci etkileşimli kullanıcı oturumundadır (Session 1). Microsoft'un MS-DOS aygıt ad alanı belgelemesine göre bu tür bir eşleme yalnız oluşturan oturumun görebileceği "Local" ad alanına girer — **hiçbir Windows servisi (hangi hesapla çalışırsa çalışsın) bunu göremez**. Bu, servis sarmalayıcı/hesap seçimiyle **çözülemeyecek** bir mimari kısıttır.
- **Çözüm:** pCloud'u "Senkronize Klasör" moduna geçirmek (sürücü harfi değil, düz NTFS dizini). Veritabanı zaten yalnız `rootKey` + göreli yol tuttuğu için bu **yalnız File Agent'ın yerel `HASARBOTU_AGENT_ROOTS` değerinin güncellenmesidir** — kod/migration/API değişmez.
- **Başlangıç sırası doğrulandı:** PostgreSQL (`NT AUTHORITY\NetworkService`, gecikmesiz Auto-start) → API (`<depend>postgresql-x64-17</depend>`) → File Agent (`<depend>hasarbotu-api</depend>`). Kod incelemesiyle doğrulandı: bu SCM sırası bir **iyileştirmedir, tek koruma değildir** — API Postgres hazır olmadan da `/health` `degraded` ile çökmeden başlar; File Agent'ın `runLoop`u (D4) API hazır olmadan da çökmeden bekler/yeniden dener.
- **Teslim edilen artefaktlar** (`deploy/windows-service/`): iki makineden bağımsız WinSW XML şablonu (secret/mutlak yol yok, roll-by-size log, artan gecikmeli restart, `<depend>` zinciri); `install-services.ps1` (Planla→Önizle→Onay→Uygula modeli, `-Apply` olmadan hiçbir değişiklik yapmaz, gerçek kurulum yalnız yükseltilmiş oturumda çalışır); `probe-p-drive-system-context.ps1` (herhangi bir sürücünün SYSTEM bağlamından görünürlüğünü geçici, kendi kendini temizleyen bir Görev Zamanlayıcı göreviyle ölçer); `scripts/check-windows-service-configs.mjs` (`npm run check:deploy`, yeni dependency eklenmeden yapısal doğrulama); kapsamlı `docs/RUNBOOK_FAZ_A_WINDOWS_SERVICE_DEPLOYMENT.md`.
- **Gerçek kurulum bu pakette yapılmadı** (kullanıcı talimatı). Kanıt: config doğrulayıcı kasıtlı bozulmuş XML'i doğru yakaladı; her iki `.ps1` sözdizimi geçerli; `install-services.ps1` sentetik dizin yapısıyla üç senaryoda test edildi (plan-only başarılı/dosya oluşmadı; `-Apply` + yükseltme yok → açıkça durdu; eksik `dist/index.js` → açıkça durdu); `probe-p-drive-system-context.ps1` yükseltilmemiş oturumda açık hatayla durdu, hiçbir görev oluşturmadı.
- Ana çalışma ağacında typecheck, lint (0 error / 2 mevcut warning, değişmedi), gerçek `hasarbotu_test` PostgreSQL ile **2.225 başarılı / 6 mevcut ortam-koşullu UI skip** (değişmedi — D5 uygulama testi eklemedi), build/bundle **426.065 baytta değişmedi** ve moderate audit (0 açık) geçti.
- **Doğrulanamayan (HB-2026-108 sınırı — HB-2026-110 ile kapatıldı, aşağıya bakın):** SYSTEM bağlamında P:\ görünürlüğünün birebir ampirik kanıtı bu geliştirme ortamında yönetici yükseltmesi bulunmadığı için alınamamıştı.

## D6 BAŞARIYLA TAMAMLANDI — gerçek servis hesabı + LSA + ACL + WinSW kurulumu bu makinede gerçekten kuruldu (HB-2026-119, 2026-07-29)

- Kullanıcı, SCM kimlik bilgisi adımı için `sc.exe config`e (yalnız bu dar adımda) dönülmesini onayladı — geri kalan her şey (hesap/LSA/ACL/WinSW kurulumu) doğrudan Win32 API ile kaldı. **Gerçek 12. `-Apply` denemesi ilk seferde tam başarılı oldu.**
- **Bu makinede (DESKTOP-EFN2G33) gerçek ve kalıcı olarak kuruldu, bağımsız salt-okunur sorgularla doğrulandı:**
  - Hesap `svc-hb-fileagent` (Enabled, "Users" grubunda değil).
  - LSA hakları — `SeServiceLogonRight`, `SeDenyInteractiveLogonRight`, `SeDenyRemoteInteractiveLogonRight` — üçü de doğrudan `LsaEnumerateAccountRights` sorgusuyla True.
  - ACL: depolama kökünde tam olarak 3 ACE (Administrators:Full, `DESKTOP-EFN2G33\user`:Modify [pCloud], `svc-hb-fileagent`:Modify); uygulama dizininde 2 ACE (Administrators:Full, svc-hb-fileagent:ReadAndExecute); log dizininde 2 ACE (Administrators:Full, svc-hb-fileagent:Modify). Başka hiçbir ACE yok.
  - WinSW servisi `hasarbotu-file-agent` kurulu — **`sc.exe qc` ile doğrulandı: START_TYPE=DISABLED, Status=Stopped.** Servis hiçbir zaman başlatılmadı.
- **Çözülemeyen ilginç not:** `sc.exe config` ilk denemede çalıştı ama doğrudan `ChangeServiceConfigW` P/Invoke'u 11 denemede de aynı hatayla (87/1057) başarısız olmuştu — `sc.exe`nin kendi iç çağrısının neden farklı bir sonuç verdiği bulunamadı, düşük öncelikli açık bir araştırma notu olarak kaydedildi.
- **Açık kalan (ayrı, onaylanmış gelecekteki adımlar):** servisi etkinleştirme/başlatma, `HASARBOTU_AGENT_ROOTS` ortam değişkeninin gerçek yeni köke güncellenmesi, gerçek pCloud→NTFS veri geçişi (hedef hâlâ boş test klasörü).
- `npm run check:deploy` geçti, `npm audit` 0 açık.

## D6 devamı — kullanıcının önerdiği 3 hipotez de test edilip elendi, kök neden hâlâ açık (HB-2026-118, 2026-07-29)

- Kullanıcının önerdiği üç hipotez sırayla gerçek `-Apply` ile (toplam 11 deneme) test edildi: **(b) parola karakter kümesi** (Base64 → alfanumerik+güvenli-özel-karakter, kalıcı tutuldu) — aynı Win32 87 hatası, elendi. **(a) "Users" grubu üyeliği** (geçici olarak çıkarma adımı atlandı) — yine aynı hata, elendi; çıkarma adımı geri konuldu. **(c) yerel güvenlik politikası çelişkisi** (`secedit /export`, salt-okunur) — `SeDenyServiceLogonRight` politikada hiç tanımlı değil, çelişki yok, elendi.
- **Kök neden hâlâ bulunamadı.** Toplam 11 gerçek `-Apply` denemesi, hepsi atomik rollback ile güvenle geri alındı — hiçbir kalıcı hesap/ACL/servis kalmadı.
- Kullanıcıya iki seçenek sunuldu: (1) yalnız bu tek adım için `sc.exe config`e geri dönmek, (2) D6'yı bu haliyle bırakıp araştırmayı ertelemek.
- Yalnız `.ps1` değişti (parola karakter kümesi kalıcı olarak değişti — zararsız). `npm run check:deploy` geçti, `npm audit` 0 açık.

## D6 devamı — ChangeServiceConfigW kök nedeni hâlâ açık: zamanlama hipotezi kesin elendi, iki farklı deterministik hata kodu bulundu

- Kullanıcının "reviewed script içinde denemeye devam et" yönlendirmesiyle 3 ek gerçek `-Apply` denemesi yapıldı (toplam 9), hepsi atomik rollback ile güvenle geri alındı. **`lpServiceStartName` parametresi sonucu değiştiriyor:** açık `.\svc-hb-fileagent` → her zaman Win32 87 (ERROR_INVALID_PARAMETER); `$null` (MSDN'e göre "hesap adı değişmiyor") → her zaman Win32 1057 (ERROR_INVALID_SERVICE_ACCOUNT — "hesap adı geçersiz veya parola geçersiz"). **Zamanlama/yayılma hipotezi kesin olarak elendi:** her iki varyant 5×2 saniye gecikmeyle tekrar denendi, sonuç her seferinde birebir aynı kaldı — gerçek, kalıcı bir mantık sorunu, geçici bir yarış durumu değil.
- **Test edilmemiş kalan olasılıklar (gelecek araştırma için):** yerel güvenlik politikasında dolaylı bir `SeDenyServiceLogonRight` grup üyeliği; parolanın Base64 karakterlerinin (`+`/`/`/`=`) SCM tarafında reddedilmesi; hesabın "Users" grubundan çıkarılmış olmasının SCM doğrulamasında beklenmeyen bir ön koşulu ihlal etmesi.
- Yalnız `.ps1` değişti (çağrı açık hesap adına döndürüldü, gereksiz gecikmeli-tekrar mantığı kaldırıldı). Gerçek hesap/ACL/servis/veri kalıcı olarak değişmedi. `npm run check:deploy` geçti, `npm audit` 0 açık.

## D6 — GERÇEK -Apply bu makinede çalıştırıldı: 3 gerçek kusur bulunup düzeltildi, atomik rollback 6 kez doğrulandı; SON adım hâlâ açık (HB-2026-118, 2026-07-29)

- Kullanıcı onayıyla D6'nın gerçek `-Apply`'ı DESKTOP-EFN2G33'te çalıştırıldı. İki eksik ön koşul kullanıcıya soruldu ve onaylandı: boş test hedef klasörü (`C:\HasarBotuStorage\BARAN GLOBAL EKSPERTİZ`, gerçek veri taşınmadı) ve WinSW-x64.exe'nin resmi GitHub release'inden (v2.12.0, SHA256 doğrulandı) indirilmesi. **Mimari karar:** `-FileAgentAppDir` için deponun kendi `services/file-agent` dizini KULLANILMADI (ACL kilidi git çalışma ağacını etkilerdi) — RUNBOOK'un kendi örnek deseniyle tutarlı, depo dışında ayrı bir dağıtım dizini (`C:\HasarBotu\services\file-agent`, `dist/` kopyalandı) kullanıldı.
- **Gerçekten bulunan ve düzeltilen 3 kusur (her biri gerçek -Apply çalıştırmasında ortaya çıktı, her seferinde atomik rollback doğru şekilde hiçbir iz bırakmadan geri aldı):** (1) hesap adı `svc-hasarbotu-fileagent` 23 karakter — Windows SAM sınırı 20; `svc-hb-fileagent`e kısaltıldı + `[ValidateLength(1,20)]` eklendi. (2) Hesap açıklaması 102 karakter — Windows sınırı 48; kısaltıldı. (3) WinSW XML'deki `<domain>%COMPUTERNAME%</domain>` genişletilmedi (WinSW literal metin olarak okudu, hesabı bulamadı — Win32 1332); `<domain>.</domain>`e (yerel makine için standart Windows kısaltması) düzeltildi.
- **Bu düzeltmelerden sonra:** hesap oluşturuldu, LSA hakları verildi, 3 ACL de gerçekten uygulandı, WinSW ikilisi kopyalandı, XML doğru render edildi, **WinSW servis kurulumu gerçekten BAŞARILI oldu**.
- **Hâlâ çözülemeyen son adım:** `ChangeServiceConfigW` (SCM'ye parola aktarımı) `ERROR_INVALID_PARAMETER` (Win32 87) ile başarısız oluyor. `dwServiceType`i açıkça `SERVICE_WIN32_OWN_PROCESS` yapma denemesi işe yaramadı (gerçek servisin zaten bu tipte olduğu `sc.exe qc` ile doğrulandı). Bağımsız bir P/Invoke tanı denemesi (reviewed script dışında, rollback korumasız) Claude Code'un otomatik mod güvenlik sınıflandırıcısı tarafından ENGELLENDİ — bu sınıra uyuldu, aşılmaya çalışılmadı; oluşturulan tek kullanımlık tanı hesabı/servisi hemen temizlendi.
- **Gerçek kanıt:** 6 ayrı gerçek `-Apply` çalıştırması, her birinde atomik rollback başarıyla devreye girdi (4. çalıştırmadan itibaren gerçek bir WinSW servisinin `uninstall` ile kaldırılması dahil); her çalıştırma sonrası gerçek hesap/servis yok, depolama kökü ACL'i orijinal (miras açık) haline döndüğü doğrulandı.
- Kalıcı kalan (zararsız, amaçlı): `C:\Tools\WinSW-x64.exe`, boş `C:\HasarBotuStorage\BARAN GLOBAL EKSPERTİZ` test klasörü, `C:\HasarBotu\services\file-agent\dist\` kopyası. **Gerçek servis hesabı, ACL kilidi veya WinSW servisi kalıcı olarak KURULMADI.**
- `npm run check:deploy` geçti, `npm audit` 0 açık. **Açık kalan:** `ChangeServiceConfigW`in 87 hatasının kök nedeni kullanıcı yönlendirmesi olmadan çözülemedi.

## D6 — sc.exe kaldırıldı, doğrudan ChangeServiceConfigW; tam zincir failure-injection testi (HB-2026-117, 2026-07-29)

- SCM'ye parola aktarımında `sc.exe config` **kaldırıldı** — çocuk süreç başlatıp parolayı `password=` komut satırı argümanı olarak taşıması (çalıştığı kısa sürede başka bir sürecin argv'yi okuyabilmesi riski) yerine, doğrudan Win32 SCM API'si (`OpenSCManagerW`/`OpenServiceW`/`ChangeServiceConfigW`/`CloseServiceHandle`, `advapi32.dll`) bu sürecin içinden çağrılıyor. Parola yalnız `Marshal.SecureStringToGlobalAllocUnicode` ile geçici, yönetilmeyen bir arabelleğe çözülüp API'ye ham `IntPtr` olarak geçiyor; çağrı biter bitmez `Marshal.ZeroFreeGlobalAllocUnicode` ile **önce sıfırlanıp sonra** serbest bırakılıyor (yönetilen bir `string` hiç oluşturulmuyor).
- **Testte bulunan ve düzeltilen iki gerçek P/Invoke kusuru:** (1) `OpenSCManagerW`'a `lpDatabaseName` için `$null` geçmek — MSDN "ServicesActive"e düşeceğini söylese de — bu ortamda `ERROR_INVALID_NAME (123)` ile başarısız oluyordu; açıkça `'ServicesActive'` vermek düzeltti. (2) `SERVICE_NO_CHANGE = 0xFFFFFFFF` PowerShell'de önce `Int32(-1)` olarak ayrıştırılıp P/Invoke `uint` parametrelerine geçirilemiyordu; `[uint32]::MaxValue` ile düzeltildi. İkisi de gerçekten çalıştırılarak bulundu.
- **Gerçek test kapsamı (hiçbir hesap/ACL/servis değiştirmeden):** SCM P/Invoke'u gerçek bir servise (`Spooler`) karşı salt-okunur erişimle (`SERVICE_QUERY_STATUS`) açılıp kapandı; aynı salt-okunur handle `ChangeServiceConfigW`'a verildiğinde Windows'un kendisi `ACCESS_DENIED (5)` ile reddetti (çökme değil — imzanın doğru olduğunun kanıtı); `Spooler` hiç değişmedi. Parola marshaling round-trip'i izole doğrulandı.
- **Kullanıcının özellikle istediği tam zincir failure-injection testi:** hesap+LSA hakları adımları mock (gerçek hesap/hak oluşturmadan), depolama/uygulama-dizini/log ACL'leri + WinSW ikili kopyalama + XML render+kimlik enjeksiyonu ise **gerçek fonksiyonlarla** scratch klasörlerde/gerçek commit'li şablona karşı çalıştırıldı — 7 adım başarıyla tamamlandıktan sonra "WinSW install başarısız" kasıtlı enjekte edildi; `Invoke-Rollback` tüm 7 adımı tam ters sırayla geri aldı, gerçek dosya/ACL durumu (miras dahil) birebir orijinaline döndüğü doğrulandı.
- **Kasıtlı test edilmeyen:** `SERVICE_CHANGE_CONFIG` yetkili bir handle'la gerçek bir servise karşı `ChangeServiceConfigW`'ın başarılı çağrısı — D6'nın gerçek yürütülmesinde kanıtlanmalı.
- Yalnız `.ps1`/RUNBOOK değişti; `npm run check:deploy` geçti, `npm audit` 0 açık. İşlem sonunda gerçek hesap/klasör/servis yok, `Spooler` etkilenmedi — teyit edildi.

## D6 — Gerçek uygulama akışı ATOMIK hale getirildi (HB-2026-116, 2026-07-29, gerçek Apply hâlâ çalıştırılmadı)

- `setup-file-agent-service-account.ps1`in `-Apply` akışı atomik hale getirildi: hesap + LSA hakları + ACL + **gerçek WinSW servis kurulumu** tek işlemdir; herhangi bir adım başarısız olursa tamamlanmış tüm adımlar ters sırayla **geri alınır**. Servis her zaman `Disabled` kurulur, **hiçbir zaman başlatılmaz**. Kullanıcı talimatıyla gerçek `-Apply` bu pakette de çalıştırılmadı.
- **Parola:** artık operatörden alınmıyor — betik `-Apply` sırasında kriptografik RNG ile bir kez üretir, yalnız `SecureString` olarak bellekte tutar, hesaba ve SCM'ye aktarır (bkz. HB-2026-117: artık `sc.exe` değil, doğrudan `ChangeServiceConfigW` Win32 API'si); **hiçbir dosyaya/log'a/repository'ye yazılmaz**. İşlem bittikten sonra parolayı bilen hiçbir kayıt kalmaz (kasıtlı — rotasyon = betiği tekrar çalıştırmak).
- **Atomiklik:** `Stack[scriptblock]` tabanlı geri-alma — hesap (yeni oluşturulduysa silinir), LSA hakları (`LsaRemoveAccountRights`), ACL (değişiklikten önce yakalanan orijinal ACL aynen geri yazılır, miras durumu dahil), WinSW ikili/XML/servis kurulumu (silinir/`uninstall`). Bir geri-alma adımı başarısız olsa bile diğerleri yine de denenir (best-effort).
- **Bulunan ve düzeltilen gerçek kusur:** `Write-Error 'mesaj'; exit N` deseni, `$ErrorActionPreference='Stop'` altında `Write-Error`in terminating sayılması yüzünden `exit N`e hiç ulaşmıyordu — gerçek çıkış kodu her zaman `1` oluyordu, belgelenen `2` değil. Gerçekten çalıştırılarak (`-WinSwExe` verilmeden `-Apply` çağrısı) bulundu; `-ErrorAction Continue` ile düzeltildi ve tekrar test edilip doğru kod döndüğü doğrulandı. Aynı deseni taşıyan diğer scriptlerin (`probe-p-drive-system-context.ps1`, `install-services.ps1`) kontrolü ayrı bir takip maddesi.
- **Gerçek test kapsamı (hesap/ACL/servis/veri oluşturmadan):** parola üretici fonksiyon (SecureString, 44 karakter, iki farklı çağrıda farklı değer); WinSW render fonksiyonu gerçek şablona karşı scratch hedefte (Türkçe metin doğru, yer tutucular doğru çözüldü); rollback yığını dummy scriptblock'larla ters-sıra + best-effort davranışı; ACL geri-alma deseni bir scratch klasörde gerçek uygulanıp gerçek geri alınarak (miras durumu dahil birebir orijinale dönüldüğü) doğrulandı; `-Apply` hem `-WinSwExe` olmadan hem de gerçek bir mevcut Windows servisine (`Spooler`, salt-okunur, dokunulmadı) karşı güvenle `exit 2` verdiği doğrulandı.
- **Kasıtlı test edilmeyen (kullanıcı talimatı):** gerçek hesap/LSA hakkı/WinSW `install`/`sc.exe config`/`Set-Service -StartupType Disabled` çağrıları ve gerçek bir hata enjekte edilerek tam rollback zincirinin kanıtlanması — D6'nın gerçek yürütülmesinde yapılmalı.
- Yalnız `.ps1`/RUNBOOK değişti; `npm run check:deploy` geçti, `npm audit` 0 açık; TS/JS değişmediği için typecheck/lint/test/build gerekmedi. İşlem sonunda gerçek hesap/klasör/servis yok — teyit edildi.

## D6 — File Agent servis hesabı plan/preview/apply betiği (HB-2026-114, 2026-07-29)

- HB-2026-113'ün kararı gerçek bir araca dönüştürüldü: `deploy/windows-service/setup-file-agent-service-account.ps1` — `install-services.ps1` ile aynı Planla→Önizle→Onay→Uygula modeli. **Gerçek hesap oluşturulmadı, gerçek ACL değiştirilmedi, gerçek servis kurulmadı, veri taşınmadı** — kullanıcı talimatı.
- Dört alan hem doğrulanır hem (yalnız `-Apply` ile) uygulanır: hesap varlığı, `SeServiceLogonRight` (kendi LSA `LsaAddAccountRights`/`LsaEnumerateAccountRights` P/Invoke'u — WinSW `allowservicelogon`a bağımlı değil), `SeDenyInteractiveLogonRight`/`SeDenyRemoteInteractiveLogonRight`, NTFS ACL (`FileSystemAccessRule` ile programatik, `icacls` metin ayrıştırma değil). WinSW `<serviceaccount>` kimliği eklenir ama **`<password>` asla yazılmaz** — gerçek parola servis kurulduktan sonra ayrı bir `sc.exe config` adımıyla (yalnız bellekte) ayarlanır.
- **Testte bulunan ve düzeltilen iki gerçek kusur:** (1) ACL karşılaştırması yanlış-negatif üretiyordu (.NET `FileSystemAccessRule` "Allow" kuralları için `Synchronize` bitini otomatik ekliyor; karşılaştırma artık aynı kurucuyla üretilmiş bir referans kuralla yapılıyor). (2) WinSW XML okuma/yazma HB-2026-110 ile **aynı kusur sınıfını** taşıyordu (`Get-Content -Raw` + `$xml.OuterXml` → Türkçe mojibake + biçimlendirmenin tamamen kaybı); düzeltme: açık UTF-8 okuma + `XmlWriterSettings` ile girintili yazma.
- **Gerçek test kapsamı (hiçbir yeni hesap/ACL oluşturmadan):** önizleme modu sentetik dizinlere karşı çalıştırıldı; ACL uygula/doğrula fonksiyonları bir scratch klasöre karşı **mevcut** kullanıcı hesabıyla (Modify + ReadAndExecute + kasıtlı yanlış-hak negatif testi) gerçekten test edildi; WinSW kimlik ekleme/doğrulama gerçek şablonun **sentetik kopyasına** karşı test edildi (parola-tespit negatif testi dahil); `-Apply` parolasız çağrıldığında güvenle `exit 2` verdiği doğrulandı.
- **Kasıtlı test edilmeyen:** `New-LocalUser` ile gerçek hesap oluşturma ve `LsaAddAccountRights` ile gerçek hak verme — yalnız kod incelemesiyle doğrulandı; D6'nın gerçek yürütülmesinde ampirik doğrulama gerekir.
- Yalnız yeni `.ps1` dosyası + RUNBOOK değişti; `npm run check:deploy` geçti, `npm audit --audit-level=moderate` 0 açık; TS/JS değişmediği için typecheck/lint/test/build gerekmedi.

## D6 servis hesabı kararı (HB-2026-113, 2026-07-29, yalnız PLAN — henüz uygulanmadı)

- D6 (WinSW servis kurulumu) başlamadan önce File Agent'ın hangi hesap altında çalışacağı kararlaştırıldı: WinSW varsayılanı LocalSystem **yerine** adanmış yerel `svc-hasarbotu-fileagent` hesabı. Kod/hesap/ACL/veri **değiştirilmedi** — yalnız `DEPLOYMENT_AND_OPERATIONS_PLAN.md` §2.3 ve RUNBOOK'a yeni **§2c** eklendi.
- Dört bileşen: (1) adanmış hesap (`New-LocalUser`, rastgele parola, "Users" grubundan çıkarılmış), (2) "Log on as a service" hakkı (WinSW `allowservicelogon` birincil, LSA `LsaAddAccountRights` yedek — D6'da doğrulanmalı), (3) **zorunlu** etkileşimli/RDP oturum yasağı (`SeDenyInteractiveLogonRight`/`SeDenyRemoteInteractiveLogonRight`), (4) hedef klasörde yalnız **Modify** (Tam Denetim değil) + uygulama dizininde Read+Execute/`logs`ta Modify.
- Bu, HB-2026-112'nin `NT AUTHORITY\SYSTEM:(OI)(CI)F` ACL planını **süpersede eder** (RUNBOOK'ta çapraz referansla işaretlendi).
- **Reddedilen alternatif (kayıtlı):** Windows Virtual Service Account (`NT SERVICE\...`, parola yönetimi gerektirmez) — kullanıcının "ayrı yerel hesap" talebi net olduğu için birincil plan olarak seçilmedi, D6'da yeniden değerlendirilebilir.
- Yalnız `docs/DEPLOYMENT_AND_OPERATIONS_PLAN.md` ve `docs/RUNBOOK_FAZ_A_WINDOWS_SERVICE_DEPLOYMENT.md` değişti; `.ps1`/`.xml` dosyası etkilenmediği için gate çalıştırma gerekmedi. **Açık kalan:** D6'nın kendisi (gerçek hesap oluşturma, LSA hakları, ACL uygulama, WinSW şablonuna `<serviceaccount>` ekleme, parola rotasyon prosedürü) ayrı, açıkça onaylanmış bir uygulama görevi.

## NTFS senkron klasör geçişi — dry-run planı (HB-2026-112, 2026-07-29, yalnız PLAN)

- Kullanıcı isteğiyle `C:\HasarBotuStorage\BARAN GLOBAL EKSPERTİZ` hedefine geçiş için `docs/RUNBOOK_FAZ_A_WINDOWS_SERVICE_DEPLOYMENT.md`e yeni bir **§2a Dry-run doğrulama planı** eklendi. **Gerçek veri taşıma veya WinSW kurulumu yapılmadı** — yalnız salt-okunur ölçüm + prosedür yazıldı.
- **Kapasite (gerçek ölçüm, salt-okunur):** kaynak `P:\BARAN GLOBAL EKSPERTİZ` = 6.258 dosya, 603 klasör, ~8,64 GB. Hedef `C:\` boş alan ~726 GB — kapasite sorun değil (önerilen 3× pay ~26 GB). **Düzeltme (HB-2026-115):** bu makine (DESKTOP-EFN2G33) GERÇEK ofis/dağıtım makinesidir (önceki "geliştirme/test" nitelemesi yanlıştı) — yukarıdaki sayılar zaten gerçek üretim verisidir, tekrar ölçüm gerekmez.
- **ACL tasarımı (planlandı, uygulanmadı):** HB-2026-111'in `Everyone: tüm haklar` bulgusunu düzeltecek şekilde, yeni kökte `icacls /inheritance:d` + yalnız `NT AUTHORITY\SYSTEM` (WinSW varsayılan servis hesabı) ve `BUILTIN\Administrators`e açık grant planlandı. Açık mimari not: File Agent bugün LocalSystem altında çalışıyor; adanmış, düşük yetkili bir servis hesabına geçiş ayrı, henüz karara bağlanmamış bir öneri.
- **Hash karşılaştırma:** bu ölçekte istatistiksel örnekleme yerine tam SHA-256 karşılaştırması önerildi (iki aşama: sayı/boyut eşitliği, sonra göreli-yol eşleştirilmiş tam hash). Karşılaştırma çıktısı repository'ye commit edilmeyecek (gerçek dosya adları müşteri verisi izi taşıyabilir).
- **`HASARBOTU_AGENT_ROOTS` değişimi + rollback:** rootKey değişmez, yalnız makine ortam değişkeni güncellenip servis yeniden başlatılır (DB değişmez). Rollback tek adımdır: değişkeni eski `P:\` değerine döndür + yeniden başlat; eski `P:\` en az 14 gün silinmeden tutulur.
- **Bulunan ve düzeltilen gerçek kusur:** RUNBOOK §4'teki `HASARBOTU_AGENT_ROOTS` örneğinde klasör adı yanlış yazılmıştı (`EKSPERTIZ` düz I, gerçek klasör `EKSPERTİZ` noktalı Türkçe İ) — harfiyen kopyalanırsa gerçek bir yol uyuşmazlığına yol açardı. Düzeltildi.
- Yalnız `docs/RUNBOOK_FAZ_A_WINDOWS_SERVICE_DEPLOYMENT.md` değişti. Uygulama kodu, WinSW şablonları, migration, gerçek ortam değişkenleri değişmedi. **Açık kalan:** plan kullanıcı onayı olmadan yürütülmeyecek; servis hesabı kararı (LocalSystem vs adanmış hesap) ayrıca verilmeli (bkz. HB-2026-113/114/115 — verildi).

## D5 düzeltme #2 — Gerçek SYSTEM çalıştırması: iki kök kusur bulundu ve düzeltildi; P:\ SYSTEM'den GÖRÜNÜYOR (HB-2026-110, 2026-07-29)

- Bu makinede ilk kez yönetici yükseltmesiyle probe **gerçekten** çalıştırıldı; `LastTaskResult=1`, sonuç/log dosyası hiç oluşmadı, konsol Türkçe metni bozuktu (bildirilen semptomla birebir).
- **Kök kusur 1 (LastTaskResult=1'in asıl nedeni):** `$innerLines` dizisinde `'...' + $DriveLetter + '...'` biçimindeki `+` string birleştirmesi, Windows PowerShell 5.1'in `@(...)` dizi literalinde değişkenin etrafına gerçek CRLF ekleyerek tek satırı üç geçersiz satıra bölmesine yol açıyordu; üretilen iç betik `Start-Transcript`e bile ulaşamadan parser hatasıyla çöküyordu (log tamamen yoktu). Düzeltme: o satır, dizideki diğer satırların zaten kullandığı güvenli çift-tırnak interpolasyon kalıbına çevrildi (`+` birleştirme yok).
- **Kök kusur 2 (asıl "UTF-8 bozuk" nedeni — HB-2026-109 yanlış katmanı düzeltmişti):** her iki `.ps1` dosyası da UTF-8 BOM'suzdu. PowerShell 5.1, BOM'suz betikleri sistem ANSI kod sayfasıyla (tr-TR → Windows-1254) okur; Türkçe karakterler konsola yazılmadan önce **parse anında** bozuluyordu — `[Console]::OutputEncoding` bu katmanı hiç etkilemez. İzole BOM'lu/BOM'suz ikili test kesin kanıtladı. Düzeltme: her iki dosya UTF-8 BOM ile yeniden yazıldı (içerik tek bayt değişmedi).
- **Gerçek SYSTEM sonucu (ilk kez ölçüldü):** düzeltme sonrası `LastTaskResult=0`, dört ayrı gerçek çalıştırma başarılı; `whoami=nt authority\system`, `Oturum=0`, `Get-PSDrive/Test-Path/Win32_LogicalDisk/Dizin listeleme=True` → **"P:\ SYSTEM bağlamından GÖRÜNÜYOR ve listelenebiliyor."**
- **Önemli:** bu sonuç HB-2026-108'in teorik varsayımıyla (SYSTEM'den görünmeyeceği) **çelişiyor**. Tek makinelik ampirik veri; D5'in "senkron klasöre geç" kararını geri almak bu paketin kapsamı dışında — gerçek bir mimari karar, kullanıcı onayı gerektirir. Veri taşıma/servis kurulumu bu paket kapsamında yapılmadı.
- **Kanıt:** düzeltme öncesi 3 gerçek çalıştırmada `LastTaskResult=1` + dosya yok tekrarlandı; üretilen iç betik izole çalıştırılıp parser hatası (`MissingEndParenthesisInExpression`) doğrulandı; düzeltme sonrası 4 gerçek çalıştırma `LastTaskResult=0`; UTF-8 doğru çıktı 3 farklı yakalama yöntemiyle (Bash pipe, doğrudan PowerShell, `Start-Process -RedirectStandardOutput`) doğrulandı; her iki dosya `Parser::ParseFile` ile 0 hata; `npm run check:deploy` geçti; `npm audit --audit-level=moderate` 0 açık. Yalnız iki `.ps1` değişti, TS/JS kaynağı değişmediği için typecheck/lint/test/build gerekmedi.
- **Açık kalan (DÜZELTİLDİ, HB-2026-115):** bu satır önceden "ofis dağıtım makinesinde bağımsız doğrulama" istiyordu — DESKTOP-EFN2G33 zaten GERÇEK ofis/dağıtım makinesidir, ayrı doğrulama gerekmez. D5 kararının (senkron klasör geçişi gerekli mi) yeniden değerlendirilmesi HB-2026-111'de yapıldı.

## D5 yeniden değerlendirmesi — gerçek yazma/silme, ACL, pCloud oturum bağımlılığı kanıtı; NİHAİ ÖNERİ DEĞİŞMEDİ, gerekçe düzeltildi (HB-2026-111, 2026-07-29)

- Kullanıcı isteğiyle D5 yeniden değerlendirildi: `probe-p-drive-system-context.ps1`e geriye dönük uyumlu, varsayılanı değiştirmeyen `-IncludeWriteAndAclProbe` anahtarı eklendi (kapalıyken çıktı HB-2026-110 ile birebir aynı — doğrulandı). Reboot/logoff, veri taşıma, WinSW kurulumu yapılmadı.
- **Yazma/silme (gerçek SYSTEM):** `writeTestOk=True`, `deleteTestOk=True` — SYSTEM P:\ kökünde gerçekten dosya oluşturup doğrulayıp silebiliyor (yalnız kendi geçici işaretçisi, gerçek veri değil).
- **ACL — kritik bulgu:** `Get-Acl P:\` → Owner=`Everyone`, tek ACE `Everyone: -1 (Allow)` (tüm haklar, adlandırılmış `FullControl`un [2032127] bile üstünde). **En-az-yetki değil** — makinede çalışan herhangi bir hesap/süreç P:\ üzerinde tam denetime sahip.
- **GLOBAL ad alanı — HB-2026-108'in temel varsayımını çürüten kanıt:** `\\?\GLOBALROOT\GLOBAL??\P:\` doğrudan (oturuma özel DosDevices tablosunu atlayarak) sınandı → `Directory.Exists=True`. Sürücü harfi **GLOBAL** (makine geneli) ad alanında kayıtlı, HB-2026-108'in varsaydığı oturuma özel "Local" `DefineDosDevice` DEĞİL.
- **Kök neden — EldoS CBFS sürücüsü:** `fltmc instances`/`sc qc bfs` P:'e bağlı `bfs.sys`i ("Aracılık Dosya Sistemi" = EldoS Callback File System, `cbfs20.sys` ailesi) ortaya çıkardı — "FSFilter Virtualization" grubunda, **AUTO_START**, önyüklemede kendiliğinden yüklenen gerçek bir çekirdek sürücüsü, yalnız `FltMgr`e bağımlı. Bu yüzden sürücü harfi global — basit bir oturuma-özel eşleme değil.
- **pCloud etkileşimli oturum bağımlılığı (mimari kanıt, canlı öldürme testi YAPILMADI — kullanıcının gerçek oturumunu bozmamak için bilinçli tercih):** CBFS'in amacı gerçek G/Ç'yi kayıtlı bir **kullanıcı modu callback işleyicisine** (`pCloud.exe`, Oturum 1'de sıradan bir uygulama, **Windows servisi DEĞİL** — `Get-Service`de "pcloud" yok) devretmektir. Sürücü harfi global olsa da gerçek okuma/yazma bu işleyicinin çalışıyor olmasına bağımlıdır.
- **NİHAİ ÖNERİ: NTFS senkron klasör önerisi geçerliliğini koruyor — gerekçe düzeltildi.** Eski gerekçe ("SYSTEM göremez") çürütüldü. Yeni gerekçe: (1) **kullanılabilirlik** — File Agent (Windows servisi, insansız 7/24) çalışması için, kendisi bir servis OLMAYAN, yalnız bir kullanıcı oturum açtığında çalışan `pCloud.exe`ye bağımlı olmak kırılgan; (2) **ACL/en-az-yetki** — `Everyone: tüm haklar` gerçek müşteri verisi için savunulabilir bir sınır sağlamıyor; NTFS senkron klasör normal, servis hesabına özel NTFS ACL'lerine izin verir.
- Yeni anahtar kapalıyken (varsayılan) betik çıktısı değişmedi (doğrulandı). `Parser::ParseFile` 0 hata, `npm run check:deploy` geçti, `npm audit --audit-level=moderate` 0 açık; TS/JS değişmediği için typecheck/lint/test/build gerekmedi.
- **Açık kalan (DÜZELTİLDİ, HB-2026-115):** bu satır önceden "ofis makinesinde ayrı doğrulama" istiyordu — gereksiz, çünkü ölçüm zaten gerçek ofis/dağıtım makinesinde (DESKTOP-EFN2G33) yapıldı. NTFS senkron klasöre geçişin kendisi (uygulama, veri taşıma, File Agent kök değişikliği) bu paketin kapsamında değil — ayrı, açıkça onaylanmış bir görev.

## D5 düzeltme — SYSTEM P: probu zaman aşımı, ProgramData konumu, tanılama, UTF-8 (HB-2026-109, 2026-07-29)

- `probe-p-drive-system-context.ps1` dört noktada düzeltildi (hedefli düzeltme, yeniden tasarım değil): (1) sabit 20 sn bekleme → `-TimeoutSeconds` (varsayılan 90, 20–600 ayarlanabilir) + `Get-ScheduledTask` durumuna bakan akıllı döngü; (2) sonuç/log/iç betik artık kullanıcı profiline değil **`C:\ProgramData\HasarBotu\probe\`**e yazılıyor (makine genelinde her hesabın eriştiği konum); (3) **`LastTaskResult`/`LastRunTime` ve görev eylem log içeriği ekrana raporlanıyor** — önceden bir hata olsa bile hiçbir iz kalmıyordu; (4) **UTF-8 Türkçe karakter düzeltmesi**: konsol `OutputEncoding` UTF-8'e ayarlanıyor + dosyalar `[System.IO.File]::WriteAllText(..., UTF8Encoding($false))` ile açıkça BOM'suz yazılıyor/okunuyor.
- Yalnız Görev Zamanlayıcı **kaydı** (geçici görev) her durumda kaldırılıyor; sonuç JSON'u, iç betik ve log dosyası artık **silinmiyor** — zaman damgalı, kalıcı audit kanıtı olarak `ProgramData`da birikiyor.
- **Bulunan gerçek hata (kod incelemesiyle, çalıştırmadan önce yakalandı):** ilk taslakta `cmd /c ... > log 2>&1` ile dış yönlendirme denendi, Türkçe/boşluklu yollarla iç içe tırnaklama riski fark edilip kullanılmadı; bunun yerine iç betiğin kendisi `Start-Transcript` ile kendi çıktısını yazıyor.
- **Kanıt:** her iki `.ps1` sözdizimi geçerli; yükseltmesiz oturumda betik **hiçbir dosya/dizin yan etkisi bırakmadan** (ProgramData dizini dahi oluşmadan) açık hatayla durdu; UTF-8 BOM'suz round-trip + konsol görüntü düzeltmesi gerçek bir sentetik yazma/okuma/görüntüleme testiyle doğrulandı (Türkçe metin `İĞÜŞÖÇ` dahil round-trip eşleşti, ilk 3 bayt BOM değildi, ekranda doğru göründü).
- **Doğrulanamayan (HB-2026-108 ile aynı, yeni değil):** bu ortamda yönetici yükseltmesi hâlâ yok; SYSTEM bağlamında gerçek çalıştırma (asıl zaman aşımı senaryosunun kendisi) yapılamadı. Ofis makinesinde yükseltilmiş oturumda çalıştırılıp `C:\ProgramData\HasarBotu\probe\` altındaki sonuç paylaşılmalı.
- Typecheck, lint (0 error / 2 mevcut warning), gerçek `hasarbotu_test` PostgreSQL ile **2.225 başarılı / 6 mevcut ortam-koşullu UI skip** (değişmedi), build/bundle 426.065 bayt (değişmedi), moderate audit (0 açık) geçti.
