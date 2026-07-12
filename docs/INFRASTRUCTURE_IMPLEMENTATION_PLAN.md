# HasarBotu V2 Altyapı Uygulama Planı

## 1. Amaç ve yürütme kuralları

Bu plan, kabul edilmiş `v0.1.0-ui-baseline` sürümünden gerçek altyapıya geçişi küçük, test edilebilir ve geri alınabilir paketlere böler. Paket 01, 2026-07-11 tarihinde kabul ölçütleriyle uygulanmıştır; sonraki paketler ayrı görev ve karar kapılarıyla yürütülür.

Her paket için bağlayıcı çalışma düzeni:

- Başlamadan ilgili açık karar kapısı kapatılır; öneri sessizce kalıcı karara çevrilmez.
- Paket tek ana mimari değişiklik yapar.
- Kabul edilmiş UI görünümü ve mevcut mock çalışma yolu korunur.
- Kullanıcı değişiklikleri geri alınmaz; çalışma ağacı ve baseline farkı kaydedilir.
- Typecheck, lint, unit/component/contract testleri, build ve kapsamına göre güvenlik/audit çalışır.
- Başarısız kalite kapısıyla paket tamamlanmış sayılmaz.
- Geri alma veri kaybetmeden yapılabiliyor olmalıdır; migration için ileri düzeltme gerektiğinde bu açıkça belirtilir.
- Commit/push/release ayrı kullanıcı yetkisi ister.

## 2. Paket sırası ve bağımlılık haritası

```text
01 Repository -> 02 Domain -> 03 Contracts -> 04 API -> 05 PostgreSQL
                                           -> 06 Auth -> 07 Cases Read
07 -> 08 UI Adapter -> 09 Cases Write -> 10 Audit -> 11 File Metadata
11 -> 12 File Agent -> 13 Documents/Photos
09 -> 14 Notes/Tasks -> 15 Notifications -> 16 Value Loss -> 17 Heavy Damage
10 -> 18 Gmail -> 19 Legislation -> 20 Reports/Fees
08+20 -> 21 Electron -> 22 Office LAN -> 23 Migration/Production Acceptance
```

Sonraki tek mantıklı görev Paket 02'dir. Sonraki paketler, önceki paketin kabul kanıtı olmadan başlatılmaz.

## 3. Uygulama paketleri

### Paket 01 — Repository/workspace temeli

- **Durum:** Tamamlandı ve doğrulandı — 2026-07-11. npm workspaces etkin, root UI yerinde, `@hasarbotu/config` kayıtlı, 26/26 test ve UI smoke testi başarılı.
- **Amaç:** Mevcut tek Vite uygulamasını davranışını değiştirmeden kademeli workspace yapısına hazırlamak.
- **Kapsam:** Yerel npm workspaces kararı; kök script uyumluluğu; `apps`, `services`, `packages` dizin kabuğu; ortak TS/ESLint yapılandırma stratejisi. İlk adımda UI taşınmayabilir.
- **Kapsam dışı:** API, veritabanı, Electron, domain modeli ve UI refactor.
- **Ön koşullar:** Monorepo aracı ve kök script stratejisi onayı; temiz baseline farkı.
- **Değişen alanlar:** Kök `package.json`, lockfile, tsconfig/eslint yapılandırmaları ve boş/README düzeyi workspace tanımları.
- **Testler:** Mevcut 26 UI testi; workspace paket keşfi; kökten ve web paketinden script çalıştırma testi.
- **Kalite kapıları:** Typecheck, lint, test, build ve audit yeşil; `dist` çıktısı davranışı korunmuş.
- **Geri alma:** Workspace tanımları ve yapılandırma referanslarını kaldır; mevcut tek uygulama scriptlerine dön. Veri değişikliği yoktur.
- **Kabul:** UI kaynak/rota/görsel davranışı değişmeden kök komutlar çalışır ve sonraki paketler için dizin sınırı hazırdır.

### Paket 02 — Domain tipleri

- **Amaç:** Trafik/Kasko dosya kurallarını UI gösterim tiplerinden bağımsız saf domain paketine almak.
- **Kapsam:** Case kimliği, dosya türü, ofis numarası, durum, takip tarihi ve değer kaybı zorunluluğu gibi saf tip/kurallar.
- **Kapsam dışı:** DTO, ağ çağrısı, veri kalıcılığı ve komponent taşıma.
- **Ön koşullar:** Paket 01; domain adları ve kimlik biçimi açık kararlarının onayı.
- **Değişen alanlar:** `packages/domain`; yalnız gerekli web import adaptasyonları.
- **Testler:** Trafik/Kasko kısıtı, plakanın benzersiz olmaması, ofis numarası biçimi, trafik değer kaybı zorunluluğu saf birim testleri.
- **Kalite kapıları:** Strict TypeScript; dış bağımlılığı olmayan domain; mevcut UI test/build yeşil.
- **Geri alma:** Web'in mevcut yerel tiplerine dön; paket bağımsız olduğundan veri etkisi yoktur.
- **Kabul:** Domain paketi React, API ve veritabanı bilmeden kuralları temsil eder.
- **Gerçekleşen sonuç (2026-07-11):** Tamamlandı. `@hasarbotu/domain@0.0.0` dış runtime dependency olmadan oluşturuldu; UI `src` koduna bağlanmadı. UI'daki `Beklemede/Gecikmiş/Kontrol Bekliyor` sunum durumları yaşam döngüsüne alınmadı; domain yalnız doğrulanmış `open/closed` durumlarını ve belgelerdeki on aşamayı taşır. 132 domain testi ile mevcut 26 UI testi geçti; sonraki paket Paket 03'tür.

### Paket 03 — Sözleşmeler ve doğrulama

- **Amaç:** UI ile gelecekteki API arasındaki sürümlü DTO ve runtime doğrulama sınırını kurmak.
- **Kapsam:** `/api/v1` istek/yanıt şemaları, hata zarfı, sayfalama, tarih/para serileştirme ve doğrulama kütüphanesi kararı.
- **Kapsam dışı:** Çalışan HTTP sunucusu ve UI'dan gerçek istek.
- **Ön koşullar:** Paket 02; doğrulama kütüphanesi ve OpenAPI üretim yönü onayı.
- **Değişen alanlar:** `packages/contracts`, sözleşme testleri ve yalnız gereken domain map'leri.
- **Testler:** Geçerli/geçersiz DTO, unknown alan politikası, UTC tarih, hata sözleşmesi ve geriye uyumluluk fixture testleri.
- **Kalite kapıları:** Sözleşmeler strict; domain/DTO ayrımı açık; typecheck/lint/test/build/audit yeşil.
- **Geri alma:** Contracts paketi ve tüketilmeyen referansları kaldır; UI mockları etkilenmez.
- **Kabul:** İstemci ve sunucu aynı runtime doğrulanan sözleşmeyi kullanabilir.
- **Gerçekleşen sonuç (2026-07-11):** Tamamlandı. `@hasarbotu/contracts@0.0.0` private ESM paketi Zod 4 (`zod@4.4.3`) ile `src/common` + `src/health` + sürümlü `src/v1/cases` düzeninde kuruldu; yeni runtime dependency yalnız `zod` ve workspace `@hasarbotu/domain`'dir. Sürümlü `/api/v1` read-only Cases sözleşmeleri (sorgu, liste yanıtı, detay param/yanıtı), `/health` yanıtı (`status: ok|degraded`, `service`, `version`, `checkedAt`), `ok`/`data`/opsiyonel `meta` başarı zarfı ve `ok`/`error` hata zarfı, kararlı hata modeli ve güvenli `zodErrorToApiError` dönüştürücüsü eklendi. Public şemalar strict; coercion yok; hata nesnesi ham girdi/hassas veri taşımaz. Domain↔DTO dönüşümü saf mapper'larla açık; `undefined`↔`null` ve `followUpAt`↔`followUpDate` köprülendi. Zod 4 yerleşik `z.toJSONSchema` ile 6 deterministik JSON Schema `dist/json-schema` altına üretildi (Git'e commit edilmez). UI `src` ve domain kaynağı değişmedi; 48 sözleşme testi eklendi ve mevcut 158 test korundu (toplam 206). Sonraki paket Paket 04'tür.
- **Sertleştirme güncellemesi (2026-07-11, HB-2026-005):** Proje çapında sertleştirme turu Paket 03 çıktısını güncelledi: `followUpDate?: LocalDate` (domain `followUpAt` kaldırıldı; bu turda domain kaynakları da değişti), kimlik/referans/plaka/pagination sınırları, güvenli unknown-key raporu, zod tam `4.4.3` pin, JSON Schema paritesi + `x-hasarbotu-runtime-validation`, golden fixture regresyonu ve dist-bağımsız root komutlar. Toplam test 350/350. Ayrıntı: `PROJECT_WIDE_AUDIT.md`.

### Paket 04 — API iskeleti ve sağlık uçları

- **Amaç:** İş özelliği eklemeden merkezi API çalışma ve sağlık sınırını kurmak.
- **Kapsam:** Framework kararı, yapılandırma doğrulama, request/correlation ID, standart hata katmanı, liveness/readiness/version uçları ve güvenli kapanış.
- **Kapsam dışı:** Veritabanı, auth, dosya işlemi ve gerçek domain endpoint'i.
- **Ön koşullar:** Paket 03; API framework ve log kütüphanesi kararı.
- **Değişen alanlar:** `services/api`, ortak config/testing paketleri, kök scriptler.
- **Testler:** Sağlık yanıtları, eksik config ile fail-fast, hata sızıntısı, correlation ID ve kapanış entegrasyon testleri.
- **Kalite kapıları:** UI kalite kapıları korunur; API test/build; dependency audit; secret/log taraması geçer.
- **Geri alma:** API workspace'ini kaldır; web bağımsız mock modunda kalır.
- **Kabul:** API veritabanı olmadan başlar, sağlık verir ve kontrollü kapanır.
- **Paket 04.5 planlama notu (2026-07-12, HB-2026-007):** Kasko poliçe analizi ve iş kuralları yalnız dokümantasyon olarak işlendi (`CASCO_POLICY_*` belgeleri); `policy_*` veri kavramları Paket 05+ değerlendirme listesine eklendi. Paket 05 şema tasarımı bu kavramların normalizasyon derinliğini karar kapısı olarak ele almalıdır.
- **Ana yol haritası mutabakatı (2026-07-12, HB-2026-008):** 12 Temmuz 2026 yol haritası revizyonu belgelerle hizalandı (`MASTER_ROADMAP_ALIGNMENT.md`): kavram listesi 26'ya çıktı, beş durumlu kapsam sonucu ve maliyet paylaşımı eklendi, yedekleme kapsamı fiziksel dosyaları içerecek şekilde güncellendi. **Paket 05 kabul kapısına eklenenler:** poliçe/muafiyet/maliyet paylaşımı/kaynak referansı/AI kullanımı/yedekleme kavramları veri modelinde daraltılmadan karşılanmalı; dosya durumu ve aşama seti kararı (K1/K2) şema tasarımından önce çözülmeli.
- **Gerçekleşen sonuç (2026-07-12):** Tamamlandı. `services/api` altında `@hasarbotu/api@0.0.0` kuruldu: Node 24 LTS (`engines >=24 <25`), tam pin `fastify@5.10.0` (+ dev: `tsx@4.23.0`, `@types/node@24.13.3`); ek plugin/DB/auth/log-pretty dependency'si yok. `buildApp`/`startServer` ayrımı, açık PORT parser'lı config sınırı, yapısal log redaksiyonu, `trustProxy:false`, 1 MiB body limit, 30 sn timeout uygulandı. `GET /health` contracts şemasıyla doğrulanarak döner; 404/beklenmeyen hatalar contracts failure envelope'larıyla güvenli (`requestId` gerçek Fastify ID). SIGINT/SIGTERM tek-kapanışlı graceful shutdown gerçek HTTP smoke'ta kanıtlandı (health 200 → kapanış → port boş). 29 API testi eklendi; toplam 379/379. Temiz checkout'ta (repo dışı kopya) `npm ci` + tüm kapılar + import/inject/canlı smoke 9/9 geçti. UI `src` değişmedi. Karar kaydı HB-2026-006; mimari `API_RUNTIME_FOUNDATION.md`. Sonraki paket Paket 05'tir.

### Paket 05 — PostgreSQL ve migration temeli

- **Amaç:** Sürümlü şema yönetimi ve güvenli veritabanı bağlantı katmanını kurmak.
- **Kapsam:** PostgreSQL sürüm kararı, migration/SQL erişim aracı, bağlantı havuzu, `schema_migrations`, ilk çekirdek kimlik/organizasyon kabuğu ve test veritabanı.
- **Kapsam dışı:** Üretim dosya tablolarının tamamı, UI verisi ve otomatik production migration.
- **Ön koşullar:** Paket 04; ORM/query builder ve migration aracı; firma modeli; ID ve RPO kararları.
- **Değişen alanlar:** API persistence katmanı, migration dizini, test DB yapılandırması ve operasyon dokümanı.
- **Testler:** Boş DB ileri migration, aynı migration tekrar güvenliği, sürüm uyuşmazlığı, transaction rollback ve temiz DB entegrasyon testi.
- **Kalite kapıları:** Migration deterministik; prod bağlantısı testte kullanılamaz; tüm repo kapıları ve yedek/geri yükleme smoke testi yeşil.
- **Geri alma:** Uygulanmamış migration dosyası kaldırılır; uygulanmış şemada veri kayıplı down yerine onaylı ileri düzeltme planı kullanılır.
- **Kabul:** API DB hazır oluşunu güvenli ölçer; temiz test DB tek komutla kurulup doğrulanır.
- **Gerçekleşen sonuç (2026-07-12):** Tamamlandı. PostgreSQL 17.10 ofis makinesine servis olarak kuruldu (kullanıcı onaylı; Türkçe locale initdb hatası UTF8+ICU tr-TR manuel cluster ile çözüldü — `DATABASE_OPERATIONS.md`). `packages/database` (`@hasarbotu/database`): tam pin `pg@8.22.0` + `node-pg-migrate@8.0.4`, açık/sızıntısız DATABASE_URL parser'ı + redaksiyon, pool fabrikası, sınırlı süreli sağlık kontrolü, programatik/CLI migration koşucusu ve UUIDv7 üreteci (HB-2026-009; kimlik üretimi persistence katmanında). İlk migration `organizations` kabuğu; durum `pgmigrations`. Gerçek DB kanıtları: boş DB ileri migration, tekrar güvenliği, sıra uyuşmazlığı reddi, transaction rollback (iz yok), kısıt ihlalleri, sağlık kontrolü; test kapısı `_test` soneki zorunlu — üretim bağlantısı testte reddedilir. API health opsiyonel `DATABASE_URL` ile gerçek ping'ten `ok`/`degraded` üretir (canlı kanıtlı); havuz graceful shutdown'da kapanır. Yedek→ayrı DB'ye geri yükleme→satır eşitliği smoke'u geçti. Kapılar: 404/404 test, audit 0, temiz checkout. Sonraki paket Paket 06'dır; K1/K2 kararı Paket 07 cases şemasını bloklamaya devam eder.

### Paket 06 — Kullanıcılar, roller ve oturum

- **Amaç:** Merkezi kimlik doğrulama ve sunucu taraflı yetkilendirme temelini kurmak.
- **Kapsam:** Users/roles/user_roles/sessions; parola hash; login/logout/me; cookie/CSRF; hesap pasifleştirme ve temel RBAC.
- **Kapsam dışı:** Dış kimlik sağlayıcı, Gmail OAuth ve ayrıntılı tüm modül izinleri.
- **Ön koşullar:** Paket 05; SEC-Q01–Q04 kararları ve başlangıç rol matrisi.
- **Değişen alanlar:** Domain/contracts/API auth modülü, DB migration, web login adapter'ı ve test yardımcıları.
- **Testler:** Doğru/yanlış giriş, rate limit, logout, timeout, pasif hesap, rol reddi, CSRF ve secret sızıntısı testleri.
- **Kalite kapıları:** Parola/token loglanmaz; UI mock dev yolu kontrollü kalır; tüm kalite ve güvenlik testleri yeşil.
- **Geri alma:** Özellik bayrağıyla API oturumu devre dışı bırak; migration verisini silmeden modülü geri al.
- **Kabul:** Yetkisiz kaynaklar reddedilir, oturum iptal edilebilir ve her kullanıcı ayırt edilir.

### Paket 07 — Dosyalar salt okunur API

- **Amaç:** Cases liste/detay verisini ilk gerçek, salt okunur API kaynağı olarak sunmak.
- **Kapsam:** Cases ve gerekli araç/party/service referans tabloları; liste, filtre, sıralama, sayfalama ve detay endpoint'leri; anonim seed.
- **Kapsam dışı:** Dosya oluşturma/güncelleme, belge erişimi ve UI adapter değişimi.
- **Ön koşullar:** Paket 06; case veri modeli ve filtre sözleşmesinin onayı.
- **Değişen alanlar:** DB migrations, API case query katmanı, contracts/domain map'leri.
- **Testler:** Tüm arama alanları, sorumlu/servis/takip filtresi, sıralama, tenant/rol kapsamı, N+1 ve geçersiz ID testleri.
- **Kalite kapıları:** Salt okunur endpoint DB'ye yazmaz; planlanan indeksler kullanılır; kontrat ve entegrasyon testleri yeşil.
- **Geri alma:** Endpoint ve query modülünü kaldır; ek tabloları veri kaybı olmadan kullanım dışı bırak.
- **Kabul:** Anonim seed üzerinde mevcut UI'nin ihtiyaç duyduğu dosya listesi ve detayı sözleşmeye uygun döner.

### Paket 08 — UI mock/API adapter ayrımı

- **Amaç:** Kabul edilmiş UI'yi değiştirmeden veri kaynağını değiştirilebilir adapter sınırına taşımak.
- **Kapsam:** `DataPort`, MockDataAdapter, HttpApiAdapter, query durumları ve feature'ların doğrudan mock importlarının kaldırılması; varsayılan güvenli mock modu.
- **Kapsam dışı:** Yazma komutları, UI redesign, Electron ve kalıcı kullanıcı verisi.
- **Ön koşullar:** Paket 07; adapter sözleşmesi ve ortam seçimi onayı.
- **Değişen alanlar:** `apps/web` veri/application katmanı, feature importları, mock fixture'lar ve component testleri.
- **Testler:** Mock ve API adapter contract eşitliği; loading/error/empty; bütün navigasyon ve kabul edilmiş görsel etkileşim regresyonu.
- **Kalite kapıları:** 1366×768 ve 1920×1080 açık/koyu görsel kontroller; 26+ test; build/audit yeşil; route/etiket değişmez.
- **Geri alma:** Adapter seçimini MockDataAdapter'a sabitle; doğrudan mock importlarına geri dönmeden API adapter'ı devreden çıkar.
- **Kabul:** Aynı UI mock veya API kaynağıyla çalışır; görünüm ve iş akışı baseline ile tutarlıdır.

### Paket 09 — Dosya yazma komutları

- **Amaç:** Case oluşturma ve güvenli alan güncellemelerini API üzerinden kalıcılaştırmak.
- **Kapsam:** Create/update; ofis numarası transaction'ı; optimistic locking; idempotency; durum/takip alanı ve UI komut adapter'ı.
- **Kapsam dışı:** Fiziksel klasör oluşturma/taşıma, kapanış, belge ve AI işlemi.
- **Ön koşullar:** Paket 08; alan yetki matrisi, ofis numarası ve concurrency kararı.
- **Değişen alanlar:** Domain command kuralları, contracts, API service/repository, DB migration/index, web mutation adapter.
- **Testler:** Eşzamanlı ofis numarası, stale version 409, idempotent tekrar, Trafik/Kasko doğrulama, yetki ve transaction rollback.
- **Kalite kapıları:** Yazma audit hazırlığı/correlation taşır; UI hata geri bildirimi; tüm kapılar ve DB entegrasyon testleri yeşil.
- **Geri alma:** UI yazmaları mock/disabled moda al; endpoint'i kapat; veriyi silme.
- **Kabul:** Yetkili kullanıcı dosya oluşturup güncelleyebilir; çakışma veri ezmeden görünür olur.

### Paket 10 — Audit altyapısı

- **Amaç:** Kritik ve kalıcı işlemler için merkezi, salt eklemeli audit kanıtı kurmak.
- **Kapsam:** `audit_events`, olay şeması, maskeleme, actor/request/idempotency bağları ve yönetici salt okunur sorgusu.
- **Kapsam dışı:** Uzun süreli dış arşiv ve hash zinciri (karar bekler).
- **Ön koşullar:** Paket 09; audit saklama/erişim/maskeleme kararları.
- **Değişen alanlar:** Domain/contracts, API middleware/service, DB migration, test matcher'ları.
- **Testler:** Success/rejected/failed olayları, önce/sonra izin listesi, secret/PII maskeleme, değiştirilemezlik ve transaction birlikteliği.
- **Kalite kapıları:** Audit yazılamıyorsa kritik işlem fail-closed; log/audit sızıntı taraması ve tüm kapılar yeşil.
- **Geri alma:** Yeni özellikleri kapat; mevcut audit kayıtlarını koru; tabloyu silme.
- **Kabul:** Dosya yazımının kim/ne/zaman/sonuç kanıtı hassas veri çoğaltmadan sorgulanır.

### Paket 11 — Dosya meta verisi

- **Amaç:** Fiziksel içeriğe dokunmadan belge/fotoğraf meta verisi ve göreceli yol modelini kurmak.
- **Kapsam:** Documents/document_versions/photos/storage_roots metadata; rootKey; relative path doğrulama; hash/durum alanları.
- **Kapsam dışı:** Gerçek yükleme, klasör oluşturma ve File Agent çalıştırma.
- **Ön koşullar:** Paket 10; göreceli yol, sürümleme ve saklama kararları.
- **Değişen alanlar:** Domain/contracts, DB migrations, API metadata query/command iskeleti.
- **Testler:** Path traversal, mutlak yol reddi, rootKey kapsamı, version/hash uniqueness, soft delete ve tenant yetkisi.
- **Kalite kapıları:** DB'de mutlak P:\ yolu yok; kaynak kod güvenlik taraması ve tüm kapılar yeşil.
- **Geri alma:** Metadata endpoint'lerini kapat; tabloları ve veriyi koru.
- **Kabul:** Fiziksel dosya olmadan güvenli göreceli konum ve sürüm bilgisi temsil edilir.

### Paket 12 — File Agent iskeleti

- **Amaç:** Kritik fiziksel dosya işlemlerinin tek yazıcısı için dayanıklı servis ve iş kuyruğu sınırını kurmak.
- **Kapsam:** Windows service yaşam döngüsü; PostgreSQL job queue; lease/heartbeat; idempotency; staging/quarantine; health; no-op/test operasyonu.
- **Kapsam dışı:** Üretim belge yükleme, kapanış klasör taşıma ve pCloud API.
- **Ön koşullar:** Paket 11; queue/lease, servis sarmalayıcısı ve storage root kararları.
- **Değişen alanlar:** `services/file-agent`, job migration/contracts, API job producer ve test dosya sistemi fixture'ı.
- **Testler:** Tek sahip lease, crash recovery, tekrar iş, kök kesintisi, traversal, cross-volume simülasyonu ve servis kapanışı.
- **Kalite kapıları:** Test kökü dışına yazma engeli; fail-closed; audit/correlation; tüm repo ve güvenlik kapıları yeşil.
- **Geri alma:** İş üretimini durdur; Agent'ı kapat; bekleyen işler DB'de korunur.
- **Kabul:** No-op/test işi tek kez güvenli yürür, çökme sonrası durum kaybolmaz.

### Paket 13 — Belge ve fotoğraf akışı

- **Amaç:** Belge/fotoğraf yükleme, sürümleme, listeleme ve kontrollü erişimi File Agent üzerinden tamamlamak.
- **Kapsam:** Staging upload, boyut/tür doğrulama, SHA-256, atomik kesinleştirme, document version, thumbnail/önizleme politikası ve UI adapter.
- **Kapsam dışı:** OCR/AI, gerçek Excel yazma ve toplu klasör taşıma.
- **Ön koşullar:** Paket 12; dosya boyutu/türü, virüs tarama ve duplicate kararları.
- **Değişen alanlar:** Web, contracts, API, DB, File Agent ve güvenli test fixture'ları.
- **Testler:** Normal fotoğraf ve 108 fotoğraf stres senaryosu, duplicate, kesinti, hash uyuşmazlığı, erişim reddi, Escape/panel regresyonu.
- **Kalite kapıları:** Dosya içeriği API belleğinde sınırsız tutulmaz; yarım dosya görünmez; performans ve tüm kapılar yeşil.
- **Geri alma:** Yeni yüklemeyi devre dışı bırak; tamamlanmış metadata/dosyayı silme; kuyrukları kontrollü boşalt.
- **Kabul:** Yetkili kullanıcı belge/fotoğrafı güvenli yükler ve UI'da görür; başarısız işlem yarım kayıt bırakmaz.

### Paket 14 — Notlar ve görevler

- **Amaç:** Dosyaya bağlı not, görev, sorumlu ve takip bilgisini gerçek kalıcı akışa taşımak.
- **Kapsam:** Notes/tasks CRUD, atama, durum/tarih, özet görünümü ve audit.
- **Kapsam dışı:** E-posta gönderme, otomatik bildirim kural motoru ve AI not üretimi.
- **Ön koşullar:** Paket 10 ve 09; düzenleme/silme ve geçmiş politikası.
- **Değişen alanlar:** Domain/contracts, DB migrations, API modülü, web adapters/components.
- **Testler:** Yetki, sahiplik, tarih/zaman dilimi, optimistic locking, soft delete, dosya özetinde görünürlük.
- **Kalite kapıları:** Trafik/Kasko davranışı bozulmaz; audit ve tüm UI/API kapıları yeşil.
- **Geri alma:** Yazmayı kapat; mevcut not/görevleri salt okunur koru.
- **Kabul:** Not/görev detayda ve özette tutarlı; takip tarihi UTC saklanıp yerel gösterilir.

### Paket 15 — Bildirimler

- **Amaç:** Belgelerde tanımlı operasyon bildirimlerini sunucu taraflı türetip kullanıcı durumuyla sunmak.
- **Kapsam:** Eksik evrak, geçen takip, onay, değer kaybı ve ağır hasar bildirimleri; okunmuş durumu; ilgili dosya bağlantısı.
- **Kapsam dışı:** Push/e-posta/SMS ve gerçek zamanlı WebSocket zorunluluğu.
- **Ön koşullar:** Paket 14; bildirim kural sürümü ve polling/SSE kararı.
- **Değişen alanlar:** Domain rule definitions, DB notifications, API query/command, web adapter.
- **Testler:** Her bildirim türü, duplicate önleme, okunmuş kullanıcı kapsamı, ilgili dosyaya geçiş ve zaman sınırı.
- **Kalite kapıları:** Kural deterministik/sürümlü; UI mevcut kabul testleri ve tüm kapılar yeşil.
- **Geri alma:** Üretim işini durdur; bildirimleri salt okunur tut; UI mock fallback mümkün.
- **Kabul:** Beş bildirim türü doğru dosyaya bağlanır ve kullanıcı bazında okunur işaretlenir.

### Paket 16 — Değer kaybı

- **Amaç:** Trafikte zorunlu, Kasko'da isteğe bağlı değer kaybı sürecini kalıcı ve onaylı hale getirmek.
- **Kapsam:** Assessment sürümü/durumu, girdiler, sonuç/gerekçe, belge referansı, kullanıcı onayı ve audit.
- **Kapsam dışı:** AI'nın sonucu kesinleştirmesi, dış kurum başvurusu ve gerçek dosya yazma.
- **Ön koşullar:** Paket 15; formül/kural sürümü ve onay yetkisi kararı.
- **Değişen alanlar:** Domain, contracts, DB, API ve web çalışma alanı adapter'ı.
- **Testler:** Trafikte zorunlu, Kasko'da zorunlu değil, sürüm/çakışma, onaysız kesinleşmeme ve audit kaynakları.
- **Kalite kapıları:** AI yalnız öneri; kritik işlem standardı; tüm kalite/güvenlik kapıları yeşil.
- **Geri alma:** Yeni assessment yazımını kapat; sürümleri ve audit'i koru.
- **Kabul:** İş kuralı iki dosya türünde doğru uygulanır ve kullanıcı onayı olmadan kesin sonuç oluşmaz.

### Paket 17 — Ağır hasar

- **Amaç:** Ağır hasar/PERT incelemesini sürümlü, kaynaklı ve kullanıcı onaylı iş akışına taşımak.
- **Kapsam:** Heavy damage assessment, fotoğraf/belge referansı, kanaat/gerekçe, kontrol listesi, onay ve audit.
- **Kapsam dışı:** Otomatik PERT kararı, ihale/harici servis entegrasyonu.
- **Ön koşullar:** Paket 16; eşik/kural sürümü ve yetki kararı.
- **Değişen alanlar:** Domain/contracts, DB, API, web ağır hasar alanı.
- **Testler:** Taslak/onay, belge kaynağı, stale version, yetki, AI önerisinin kesinleşmemesi ve audit.
- **Kalite kapıları:** Kritik işlem akışı görünür; tüm repo/test/güvenlik kapıları yeşil.
- **Geri alma:** Yazmayı kapat; mevcut değerlendirmeleri salt okunur koru.
- **Kabul:** Kullanıcı kaynakları görür ve açık onay olmadan PERT kanaati kesinleşmez.

### Paket 18 — Gmail entegrasyonu

- **Amaç:** E-postaları güvenli biçimde almak, eşleştirme önerisi üretmek ve kullanıcı onayıyla dosyaya bağlamak.
- **Kapsam:** OAuth secret yönetimi, incremental sync, email metadata, güvenli gövde/ek politikası, match önerisi, kullanıcı onayı ve audit.
- **Kapsam dışı:** Kullanıcı onayı olmadan e-posta gönderme/bağlama ve genel e-posta istemcisi.
- **Ön koşullar:** Paket 10 ve 13; Gmail kapsamları, saklama, gönderme ve eşleştirme kararları; harici kimlik bilgisi.
- **Değişen alanlar:** Integration service/API, DB email tabloları, contracts ve web e-posta alanı.
- **Testler:** Token rotasyonu, pagination/dedup, rate limit, yanlış eşleşme reddi, ek güvenliği, kesinti ve audit.
- **Kalite kapıları:** OAuth/PII loglanmaz; Gmail kesintisi case işlemlerini bozmaz; tüm kapılar yeşil.
- **Geri alma:** Sync'i durdur ve token'ı iptal et; alınmış metadata saklama politikasına göre korunur.
- **Kabul:** E-posta önerisi kaynaklarıyla görünür, yalnız kullanıcı onayıyla dosyaya bağlanır.

### Paket 19 — Mevzuat kaynak sistemi

- **Amaç:** Mevzuat kaynaklarını sürümlü ve geçerlilik tarihli güvenilir referans sistemi olarak sunmak.
- **Kapsam:** Source/version, yayın/yürürlük, geçerli/eski ayrımı, içerik hash'i, etkinleştirme onayı ve kaynaklı mock/gerçek-olmayan AI cevap sınırı.
- **Kapsam dışı:** Otomatik web kazıma, hukuki karar verme ve kullanıcı onayı olmadan kural etkinleştirme.
- **Ön koşullar:** Paket 10; kaynak kabulü, sürümleme, içerik saklama ve AI sağlayıcı kararları.
- **Değişen alanlar:** Domain/contracts, DB, API, web mevzuat alanı ve ileride AI service portu.
- **Testler:** Tarih geçerliliği, sürüm çakışması, eski kaynak, kaynak referansı zorunluluğu, onaysız etkinleştirmeme.
- **Kalite kapıları:** Her cevap kaynak/sayfa/güven/kontrol uyarısı taşır; tüm güvenlik ve kalite kapıları yeşil.
- **Geri alma:** Yeni kaynak alımını kapat; onaylı sürümleri salt okunur koru.
- **Kabul:** Kullanıcı geçerli/eski kaynağı ayırt eder; cevap kesin hukuki görüş gibi sunulmaz.

### Paket 20 — Raporlar ve ücretler

- **Amaç:** Operasyon raporlarını ve kapanış ücretini ana veriden üretip kontrollü onaya bağlamak.
- **Kapsam:** Sayı/dağılım/ücret sorguları, tarih-sorumlu-servis filtresi, fee_records, final rapor `GENEL TOPLAM` kaynak referansı, önizleme/onay/audit.
- **Kapsam dışı:** Otomatik fatura, banka/muhasebe entegrasyonu ve kullanıcı onayı olmadan ücret kesinleştirme.
- **Ön koşullar:** Paket 13, 16, 17 ve 10; ücret kaynağı/kuralları ve kapanış yetkisi.
- **Değişen alanlar:** Domain/contracts, DB, API rapor sorguları/fee command, web rapor ve kapanan dosya adapters.
- **Testler:** Filtre/özet tutarlılığı, para hassasiyeti, final rapor kaynak sürümü, idempotent onay, yetki ve audit.
- **Kalite kapıları:** Ağır grafik dependency yok; sorgu performansı; tüm UI/API/DB kapıları yeşil.
- **Geri alma:** Ücret yazımını kapat; raporları salt okunur tut; onaylı kaydı silme.
- **Kabul:** Rapor özetleri ana veriyle tutarlı, ücret yalnız kaynak ve kullanıcı onayıyla kesinleşir.

### Paket 21 — Electron ince kabuğu

- **Amaç:** Kabul edilmiş web UI ve merkezi API sözleşmesini değiştirmeden güvenli masaüstü kabuğu sağlamak.
- **Kapsam:** Electron sürüm/paketleme kararı, BrowserWindow güvenliği, preload allowlist, güncelleme yönü, API endpoint yapılandırması ve masaüstü smoke test.
- **Kapsam dışı:** Renderer'dan Node/fs erişimi, doğrudan PostgreSQL, File Agent görevi ve otomatik güncellemenin zorunlu uygulanması.
- **Ön koşullar:** Paket 08 ve temel API akışları; Electron zamanlama, code signing ve dağıtım kararı.
- **Değişen alanlar:** `apps/desktop`, config/contracts ve paketleme testleri; `apps/web` yalnız ortam adapter'ı.
- **Testler:** `nodeIntegration=false`, context isolation, CSP, navigation/new-window engeli, preload API allowlist ve mevcut UI E2E.
- **Kalite kapıları:** Web build aynı kalır; renderer secret/Node görmez; dependency audit ve Windows paket smoke testi yeşil.
- **Geri alma:** Web dağıtımını kullan; desktop paketi bağımsız kaldırılır.
- **Kabul:** Aynı UI güvenli kabukta çalışır, API dışı ayrı iş mantığı içermez.

### Paket 22 — Ofis LAN dağıtımı

- **Amaç:** PostgreSQL, API ve File Agent'ı geçici merkezi Windows 11 bilgisayarında operasyonel olarak çalıştırmak.
- **Kapsam:** Hizmet hesapları, firewall/DNS/TLS, Windows service, otomatik başlangıç, log/health, UPS/reboot, yedek ve rollback runbook'u.
- **Kapsam dışı:** Kalıcı sunucu, yeni ürün özelliği ve pCloud'u tek yedek sayma.
- **Ön koşullar:** Paket 21; OPS ve BCK açık kararları; ofis cihazı/ağ/sertifika/backup hedefi.
- **Değişen alanlar:** Deployment config/templates, operasyon dokümanı ve kontrollü kurulum araçları; iş kodu değişmez.
- **Testler:** Temiz reboot, LAN erişim/red, TLS, servis bağımlılıkları, pCloud/internet kesintisi, DB restore ve rollback tatbikatı.
- **Kalite kapıları:** Üretim sırrı repo dışında; RPO/RTO kanıtı; güvenlik kontrol listesi ve tüm build/testler yeşil.
- **Geri alma:** DNS/endpoint'i önceki ortama çevir; hizmetleri durdur; DB/dosya tutarlılığı doğrulanmadan yazım açma.
- **Kabul:** Kullanıcı oturumu olmadan servisler çalışır, sağlık/backup görünür ve ofis kabul senaryoları geçer.

### Paket 23 — Migration ve üretim kabulü

- **Amaç:** Onaylı veriyi kontrollü aktararak sistemi üretime alma ve kalıcı sunucu geçiş yolunu kanıtlamak.
- **Kapsam:** V1/seed veri haritalama, dry-run, hata raporu, planla/önizle/onayla/uygula/doğrula/audit, mutabakat, kullanıcı kabulü ve cutover/rollback.
- **Kapsam dışı:** Belirsiz veriyi sessiz tahmin, kaynağı silme, otomatik pCloud yeniden düzenleme ve kalıcı sunucu tedariki.
- **Ön koşullar:** Paket 22; veri sahibi onayı, migration sözleşmesi, RPO/RTO, bakım penceresi ve rollback eşiği.
- **Değişen alanlar:** Ayrı migration aracı/paketi, doğrulama raporları, operasyon/UAT belgeleri; ürün runtime'ına geçici import kodu gömülmez.
- **Testler:** Anonim fixture dry-run, tekrar çalıştırma/idempotency, eksik/çakışan kayıt, ofis no/plaka, göreceli yol, satır/hash mutabakatı ve rollback provası.
- **Kalite kapıları:** Sıfır başarısız kritik test; tam typecheck/lint/test/build/audit; güvenlik, restore, 1366/1920 açık/koyu UAT ve veri sahibi imzası.
- **Geri alma:** Cutover öncesi kaynağı koru; hedef yazımı durdur; ayrışma yoksa endpoint'i geri çevir, varsa mutabakat planı olmadan geri açma.
- **Kabul:** Aktarım kanıtlı, auditli ve tekrar edilebilir; ofis kullanıcı kabulü ve operasyon devri tamamdır.

## 4. Paketler arası kalıcı kalite kapıları

Her pakette gerçek sonuca göre şu kanıtlar raporlanır:

1. Değişen dosyalar ve kullanıcı değişikliklerinden ayrımı.
2. Alınan ve açık kalan kararlar; ilgili decision log/ADR referansı.
3. Runtime, dependency, IPC, veri modeli ve veri yazma yolu etkisi.
4. Çalıştırılan komutlar ve gerçek exit/result bilgisi.
5. Otomatik test sayısı ve kapsamı.
6. İlgili güvenlik/audit/backup negatif testleri.
7. UI etkisi varsa 1366×768 ve 1920×1080 açık/koyu ekran kanıtı.
8. Migration/iş varsa dry-run, idempotency, rollback ve restore kanıtı.
9. Bilinen eksik, risk ve sonraki tek paket.

## 5. Baseline koruma kontrolü

- `v0.1.0-ui-baseline` etiketi değiştirilmez veya yeniden oluşturulmaz.
- İlk UI adapter paketine kadar `src` altındaki kabul edilmiş kodda gerekçesiz değişiklik yapılmaz.
- UI taşınırken git geçmişini koruyan mekanik taşıma ve küçük import düzeltmeleri ayrı tutulur.
- Her UI etkili pakette rota, Türkçe etiket, tema, menü, tablo/drawer, focus, Escape ve overflow testleri korunur.
- Mock adapter, gerçek API yeterli kabul testini geçene kadar geliştirici/UAT geri dönüş yolu olarak tutulur; üretimde gizli fallback yapılmaz.
