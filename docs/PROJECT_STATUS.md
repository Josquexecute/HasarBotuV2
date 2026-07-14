# HasarBotu V2 — Proje Durumu

Son güncelleme: 2026-07-14

## Mevcut sürüm ve aşama

- Sürüm: `0.1.0-ui-baseline`
- Aşama: Paket 18 — Referans Veriler ve Case Çekirdeği Zenginleştirme
- Durum: **Kod, PostgreSQL/API, gerçek Chrome tarayıcı ve temiz checkout kalite kapıları geçti; commit hazırlığı tamamlandı**
- Git: Yerel repository, `foundation/package-18-reference-case-core` dalı, remote yok
- Baseline commit mesajı: `chore: freeze accepted UI prototype baseline`
- Baseline tag: `v0.1.0-ui-baseline`

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

## Bilinen sınırlar

- Kabul yalnız UI-first prototipi kapsar.
- Backend, Electron, PostgreSQL, pCloud, Gmail, gerçek AI ve dosya sistemi entegrasyonları bulunmaz.
- Mock mevzuat yanıtı gerçek hukuki değerlendirme değildir.
- Baseline davranışı sonraki geliştirmelerde referans olarak korunmalıdır.

## Sonraki önerilen görev

`INFRASTRUCTURE_IMPLEMENTATION_PLAN.md` içindeki Paket 04'ü ayrı görev olarak uygulamak: iş özelliği eklemeden merkezi API iskeletini ve sağlık uçlarını `@hasarbotu/contracts` sözleşmelerini tüketerek kurmak.

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

## Sonraki önerilen görev (güncel)

Paket 19 tamamlandıktan sonra yalnız kullanıcı tarafından ayrıca tanımlanacak sonraki pakete geçilmelidir; bu çalışma içinde başka özellik başlatılmamıştır.
