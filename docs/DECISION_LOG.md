# HasarBotu V2 — Karar Günlüğü

Bu dosya, kilitlenmiş ürün kararlarını tekrar etmez. Yalnız geliştirme sırasında eklenen veya değişen kalıcı kararları; tarih, gerekçe ve etkisiyle kaydeder.

## 2026-07-10 — HB-2026-001: Yarı otonom geliştirme ve aşamalı kalite kapıları

Karar:

- Geliştirme işleri küçük ve test edilebilir aşamalara ayrılır.
- Her uygulama aşamasından sonra typecheck, lint, test ve build çalıştırılır.
- Tamamlanan aşamalar `IMPLEMENTATION_PLAN.md` içinde işaretlenir.
- Her görev sonunda `PROJECT_STATUS.md` güncellenir.
- Yeni kalıcı kararlar bu günlükte tarih ve gerekçeyle tutulur.

Gerekçe:

Kullanıcı, kesintisiz fakat kanıtlanabilir ilerleme sağlayan yarı otonom çalışma düzenini kalıcı proje yöntemi olarak belirledi.

Etkisi:

- Testler başarısızken görev tamamlanmış sayılmaz.
- Hatalar önce yerel olarak araştırılır ve yeniden doğrulanır.
- Backend, Electron veya gerçek veri entegrasyonu için mevcut UI-first sınırları değişmez.

Kaynak: 2026-07-10 tarihli kullanıcı talimatı.

## 2026-07-11 — HB-2026-002: Paket 01 npm workspace geçiş sınırları

Karar:

1. Workspace yöneticisi yalnız npm workspaces olacaktır.
2. Turborepo, Nx, pnpm, Yarn veya başka monorepo aracı eklenmeyecektir.
3. Kabul edilmiş React/Vite UI bu pakette repository kökünde kalacaktır.
4. `src`, `public`, `index.html` ve mevcut UI yapılandırmaları `apps/web` altına taşınmayacaktır.
5. UI kaynak kodu, routing, mock veri ve kullanıcı davranışları değiştirilmeyecektir.
6. Backend, API, PostgreSQL, Electron, File Agent veya gerçek domain modeli bu pakete eklenmeyecektir.
7. TypeScript project references mevcut root uygulamaya bu pakette zorla uygulanmayacaktır.
8. Root `dev`, `typecheck`, `lint`, `test` ve `build` komut adları ve mevcut kullanımları korunacaktır.
9. Yeni ücretli servis veya gereksiz dependency eklenmeyecektir.
10. Remote eklenmeyecek ve push yapılmayacaktır.

Gerekçe:

Kabul edilmiş `v0.1.0-ui-baseline` davranışını koruyarak repository yapısını düşük riskli, küçük ve geri alınabilir bir ilk altyapı paketiyle npm workspace kullanımına hazırlamak.

Etkisi:

- Root uygulama workspace üyesi olmadan mevcut konumunda çalışmaya devam eder.
- İlk gerçek workspace paketi yalnız runtime dependency içermeyen `@hasarbotu/config` paketidir.
- Boş `apps` veya `services` paketleri oluşturulmaz.
- Root TypeScript yapılandırmalarının ortak tabana bağlanması ve UI'nin `apps/web` altına taşınması sonraki bağımsız paketlere bırakılır.

Kaynak: 2026-07-11 tarihli Paket 01 kullanıcı talimatı.

## 2026-07-11 — HB-2026-003: Paket 02 ortak domain çekirdeği sınırları

Karar:

1. Ortak çekirdek `packages/domain` altında private ESM `@hasarbotu/domain@0.0.0` paketi olacak ve harici runtime dependency içermeyecektir.
2. Domain makine kodları dil bağımsızdır: dosya türü `traffic/casco`, doğrulanmış yaşam döngüsü `open/closed` ve ürün belgelerindeki on aşama İngilizce kodlarla tutulur.
3. UI'daki `Beklemede`, `Gecikmiş` ve `Kontrol Bekliyor` değerleri yaşam döngüsü statüsü sayılmaz; presentation/operasyon ayrımı sonraki adaptör çalışmasında korunur.
4. Kimlikler branded string tiplerdir; boş değer reddedilir fakat UUID/ULID biçimi veya üretimi bu pakette zorunlu değildir.
5. Tarih-saat yalnız kanonik `Z` son ekli UTC ISO string, yalnız tarih `YYYY-MM-DD` string taşır; domain sınırında `Date` veya `null` kullanılmaz.
6. Ofis dosya numarası `YYYY/N`, yıl `2000..9999`, sıra 1'den başlayan pozitif güvenli tam sayıdır. Bu aralık dinamik sistem saati bağımlılığı olmadan dört haneli modern kayıt biçimini korur.
7. Entity version 1'den başlayan pozitif güvenli tam sayıdır; güvenli sınırdaki artırım `overflow` sonucu verir.
8. Normal girdi hataları ham değer veya kullanıcı metni taşımayan kararlı `ParseResult` kodlarıyla döner; genel runtime validation ve DTO katmanı Paket 03'e bırakılır.
9. Takip bilgisi mevcut UI'da saat içerdiği ve veritabanı planında `timestamptz` olduğu için `CaseCore.followUpAt` UTC tarih-saat olarak tanımlanır.

Gerekçe:

Kabul edilmiş UI baseline'ını ve mock davranışını değiştirmeden; UI, gelecek API ve veri kalıcılığı tarafından ortak kullanılabilecek küçük, deterministik ve altyapıdan bağımsız bir domain sınırı kurmak.

Etkisi:

- UI `src` modelleri bu pakette taşınmaz veya domain'e bağlanmaz.
- Türkçe etiket, badge, renk, CSS, tablo hücresi ve birleşik sunum alanları domain'e sızmaz.
- Trafik dosyasında değer kaybı zorunluluğu saf kuraldır; Kasko için zorunlu değildir.
- Backend, API, PostgreSQL, Electron, File Agent, IPC ve gerçek veri yazma yolu oluşmaz.
- Dış kimlik biçimi, ek yaşam döngüsü statüleri ve API validation teknolojisi açık karar olarak kalır.

Kaynak: 2026-07-11 tarihli Paket 02 kullanıcı talimatı.

## 2026-07-11 — HB-2026-004: Paket 03 sürümlü sözleşmeler ve runtime doğrulama sınırları

Karar:

1. Sözleşme sınırı `packages/contracts` altında private, ESM, `sideEffects: false` `@hasarbotu/contracts@0.0.0` paketidir. Kaynak düzeni `src/common`, `src/health` ve sürümlü `src/v1/cases`'tir.
2. Runtime doğrulama yalnız Zod 4 ile yapılır (kurulan sürüm `zod@4.4.3`). Yeni runtime dependency yalnız `zod` ve workspace `@hasarbotu/domain`'dir.
3. Wire DTO'ların kaynağı Zod şemalarıdır; TypeScript tipleri `z.infer` ile türetilir. Domain brand'leri doğrudan DTO çıktısı yapılmaz.
4. Domain tipleri ile JSON DTO aynı şey değildir; dönüşüm yalnız `v1/cases/mappers.ts` içindeki saf mapper'larla açık yapılır. Domainde opsiyonel ilişki `undefined`/alan yokluğu, wire DTO'da tutarlı `null` ile temsil edilir.
5. Public object şemaları `strict`'tir: bilinmeyen alan reddedilir ve kontrolsüz coercion kullanılmaz (`z.coerce` yok).
6. API sürümü `v1`, route tabanı `/api/v1`; health route sürümlü tabanın dışında `/health`'tir. `/health` sözleşmesi `status` (`ok`/`degraded`), `service`, `version` ve `checkedAt` alanlarını taşır; gerçek servis/veritabanı sağlık kontrolü uygulanmaz.
7. Kararlı, dil bağımsız API hata kodları: `validation_error`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `version_conflict`, `idempotency_conflict`, `service_unavailable`, `internal_error`. Başarı zarfı `ok: true`, `data` ve opsiyonel `meta`; hata zarfı `ok: false`, `error`. `zodErrorToApiError`, yalnız alan yolu ve kararlı kod taşır; ham request, stack trace, SQL mesajı, mutlak dosya yolu, parola, token, kişisel veri veya Zod serbest mesajı hata nesnesine sızmaz.
8. Sayfa tabanlı pagination: `page` varsayılan 1, `pageSize` varsayılan 25, maksimum 100. Sıralama alanları `updatedAt`, `followUpDate`, `officeCaseNumber`, `plate`; yön `asc`/`desc`.
9. `CaseCore.followUpAt` alanı `UtcDateTime`'dır (HB-2026-003 madde 9); bu yüzden `LocalDate` koşullu yeniden adlandırması uygulanmadı. Domain paketi değiştirilmedi. Wire sözleşmesi bu değeri `followUpDate` alanında (UtcDateTime) taşır; mapper `followUpAt` ↔ `followUpDate` dönüşümünü açık yapar.
10. JSON Schema, Zod 4 yerleşik `z.toJSONSchema` ile deterministik üretilir; çıktı `packages/contracts/dist/json-schema` altındadır ve Git'e commit edilmez. Ek OpenAPI dependency eklenmez.
11. Contracts, domain'i built `dist` üzerinden tükettiği için root `prepare` scripti install sonrası domain ve contracts'ı sırayla build eder; böylece `typecheck`/`test` derleme sırasına bağlı kalmaz. `npm run dev` davranışı değişmez.

Gerekçe:

`API_CONTRACT_PLAN.md` taslağını, domain/UI sınırlarını bozmadan, istemci ve sunucunun aynı runtime doğrulanan sürümlü sözleşmeyi kullanabileceği somut ve strict bir başlangıç sınırına dönüştürmek. Taslaktaki `{ items, pageInfo }` ve UPPER_SNAKE hata kodları bu pakette `page`/`pageSize` ve kararlı küçük-harf kodlarla somutlaştırıldı.

Etkisi:

- UI `src` ve `packages/domain` kaynakları değişmedi; sözleşmeler henüz UI veya çalışan bir HTTP sunucusu tarafından tüketilmiyor.
- Çalışan API sunucusu, veritabanı, auth, Electron, File Agent, UI adaptörü ve yazma endpoint'i bu pakette oluşturulmadı.
- Read-only `GET /api/v1/cases` ve `GET /api/v1/cases/:caseId` sözleşmeleri, health ve hata zarfı ile birlikte Paket 04 API iskeleti için hazır sınırdır.

Kaynak: 2026-07-11 tarihli Paket 03 kullanıcı talimatı.

## 2026-07-11 — HB-2026-005: Proje çapında sertleştirme kararları

Karar:

1. Takip tarihi günlük tarihtir: `CaseCore.followUpDate?: LocalDate` (`YYYY-MM-DD`). `followUpAt` kaldırılmıştır ve kullanılmayacaktır. Bu karar HB-2026-003 madde 9'u ve HB-2026-004 madde 9'u **geçersiz kılar**. `lastInterventionAt`, `createdAt`, `updatedAt` `UtcDateTime` kalır. Wire DTO alanı `followUpDate: string | null`; query `followUpFrom`/`followUpTo` LocalDate; UtcDateTime dönüşümü veya gizli timezone varsayımı yapılmaz.
2. Internal kimlikler dosya yolu olamaz: kırpma sonrası 1..128 karakter, güvenli ASCII kümesi (`A-Z a-z 0-9 . _ -`); `/`, ters bölü, `..`, boşluk ve kontrol karakterleri hem domain parser'larında hem wire şemalarında reddedilir. Case ID biçimi UUID/ULID'e henüz kilitlenmez.
3. `NotificationFormNumber` ve `InsurerClaimNumber`: en çok 128 karakter; kontrol karakteri ve ters bölü reddi; en az bir alfasayısal zorunlu; `11/18882475`, `F-2026-0977` gibi gerçek biçimler desteklenir; bu değerler hiçbir zaman path olarak kullanılmaz (README'lerde belgeli).
4. `PlateNumber` en çok 32 karakterdir; kanonik biçim ve arama anahtarı davranışı değişmez.
5. Pagination: `page` 1..10.000, `pageSize` 1..100; ondalık, string, boolean, NaN ve Infinity reddedilir; coercion yoktur.
6. `zod` tam `4.4.3` sürümüne sabitlenir; caret kullanılmaz. Başka dependency yükseltilmez.
7. Runtime doğrulama ile yayımlanan JSON Schema arasında sessiz semantik fark bırakılmaz: ifade edilebilir kurallar pattern/min/max/length olarak şemaya taşınır; yalnız runtime'da doğrulanabilen kurallar şemada `x-hasarbotu-runtime-validation` metadata'sıyla açıkça işaretlenir. JSON Schema hiçbir yerde tek başına güvenlik sınırı olarak tanımlanmaz.
8. JSON Schema regresyon kanıtı golden fixture'larla sağlanır: `packages/contracts/test/fixtures/json-schema` commit'lidir; üretilen şemalar testte semantik karşılaştırılır; fixture güncellemesi yalnız açık `schema:fixtures` script'iyle yapılır. `dist/json-schema` üretim artefaktı Git'e eklenmez.
9. `unrecognized_keys` hataları reddedilen alan ADLARINI raporlar: en çok 10 anahtar, anahtar başına 64 karakter, kontrol karakterleri temizlenir; ham değer asla taşınmaz; hata zarfı strict kalır.
10. Root `typecheck`/`test`/`build` komutları mevcut `dist` artıklarına güvenmez: domain, bağımlı adımlardan önce build edilir; `build:packages` domain→contracts sırasını tekilleştirir; `npm run dev` davranışı değişmez.
11. UI baseline yalnız gerçek hata/erişilebilirlik sorunu durumunda değiştirilebilir; bu turda `src` altında değişiklik yapılmamıştır. OpenAPI, API server, PostgreSQL, auth, Electron ve File Agent kapsam dışı kalmıştır.

Gerekçe:

Paket 03 sonrası incelemelerde kanıtlanan sorunları (şema/runtime sapması, sınırsız kimlikler, derin sayfalama, artefakt regresyon boşluğu, dist bağımlılığı) Paket 04 API iskeletine taşımadan kapatmak ve takip tarihi semantiğini ürün gerçeğine (günlük takip) sabitlemek.

Etkisi:

- Domain ve contracts testleri genişledi: 26 UI + 257 domain + 67 contracts = 350 test.
- `DATABASE_MODEL_PLAN.md` takip alanı `follow_up_date date` olarak güncellendi; migration henüz yoktur.
- Ayrıntılı bulgu/kanıt listesi `PROJECT_WIDE_AUDIT.md` içindedir.

Kaynak: 2026-07-11 tarihli proje çapında sertleştirme kullanıcı talimatı.

## 2026-07-12 — HB-2026-006: Paket 04 merkezi API iskeleti kararları

Karar:

1. API runtime Node.js 24 LTS'tir; root ve API paketi `engines: >=24 <25` taşır.
2. Framework tam sürüm `fastify@5.10.0`'dır. Ek Fastify plugin'i veya runtime dependency eklenmez: `pino-pretty`, Swagger/OpenAPI, CORS, cookie, JWT, ORM ve database paketi bu pakette yoktur.
3. API paketi `services/api` altında private, ESM, `sideEffects: false` `@hasarbotu/api@0.0.0`'dır. Runtime dependency yalnız `@hasarbotu/contracts` (workspace) ve `fastify`'dır.
4. Geliştirme koşucusu tam pin `tsx@4.23.0`; `@types/node` tam pin `24.13.3` (Node 24 uyumlu).
5. `@hasarbotu/contracts` API'nin dış HTTP sözleşme kaynağıdır; API domain/contracts invariant'larını yeniden tanımlamaz. Health yanıtı gönderilmeden önce contracts şemasıyla parse edilir.
6. Uygulama fabrikası (`buildApp`) ile sunucu yaşam döngüsü (`startServer`) ayrıdır. `buildApp` port dinlemez; testler gerçek TCP portu açmadan Fastify `inject` kullanır. Import otomatik sunucu başlatmaz; yalnız gerçek entrypoint başlatır.
7. Config sınırı: `HOST=127.0.0.1`, `PORT=3100`, `LOG_LEVEL=info`, `NODE_ENV=development` varsayılanları; PORT açık tam-sayı parser'ı ile 1..65535; geçersiz config'te sunucu başlatılmaz; hata çıktısı ortam değeri/secret taşımaz; dotenv kullanılmaz.
8. Güvenli varsayımlar: `trustProxy: false`; body limit 1 MiB; request timeout 30 sn; request ID Fastify üretir (istemci başlığına güvenilmez); log redaksiyonu (`authorization`, `cookie`, `set-cookie`, `x-api-key`) `buildApp` içinde yapısaldır ve dışarıdan devre dışı bırakılamaz.
9. 404 ve beklenmeyen hatalar contracts failure envelope ile döner (`not_found` / `internal_error` + gerçek `requestId`); ham exception mesajı, stack, path veya payload HTTP yanıtına taşınmaz. statusCode'lu 4xx çerçeve hataları durum kodunu koruyup `validation_error` koduyla sarılır.
10. Graceful shutdown SIGINT/SIGTERM'de tek-kapanış garantisiyle yapılır; kapanış hataları hassas veri sızdırmadan yapılandırılmış alanla loglanır.
11. Kapsam dışı: PostgreSQL, migration, authentication, session, kullanıcı/rol, Cases endpoint'leri, Electron, File Agent, Gmail, AI, LAN erişimi ve üretim deployment'ı. Health gerçek dependency kontrolü yapmaz ve `status` bu pakette hep `ok` döner.

Gerekçe:

İş özelliği eklemeden, sertleştirilmiş sözleşmeleri gerçek HTTP üzerinde tüketen, test edilebilir ve güvenli-varsayılanlı merkezi API çalışma sınırını kurmak (INFRASTRUCTURE_IMPLEMENTATION_PLAN Paket 04). Ayrıntılı mimari: `API_RUNTIME_FOUNDATION.md`.

Etkisi:

- Yeni workspace: `services/api`; root `typecheck`/`test`/`build` zincirleri domain → contracts → api sırasını deterministik kurar; `npm run dev` değişmedi; `npm run dev:api` eklendi.
- Test toplamı 379/379 (26 UI + 257 domain + 67 contracts + 29 API).
- Paket 05 (PostgreSQL bağlantı/migration) öncesi kabul koşulları `API_RUNTIME_FOUNDATION.md` §7'dedir.

Kaynak: 2026-07-12 tarihli Paket 04 kullanıcı talimatı.

## 2026-07-12 — HB-2026-007: Paket 04.5 kasko poliçe analizi ve iş kuralları

Karar:

1. Kasko poliçesi yalnız özet alanlardan ibaret değildir; belgenin tamamı kritik karar kaynağıdır ve uçtan uca işlenir (ürün/tür, araç/kullanım, teminatlar, limitler, genel + koşullu muafiyet/tenzil, özel şart/kloz, istisnalar, ikame araç, mini/mobil onarım, cam servisi, çekici, servis türü, parça türü, kıymet kazanma/eskime, pert geçmişi, rayiç/tazmin, istenen belgeler, aksesuar/LPG/elektrikli araç, prim borcu/mahsup, zeyil/yürürlük).
2. "Muafiyetsiz" genel alanı, özel kloz kaynaklı koşullu muafiyet bulunmadığı anlamına gelmez; klozlar ayrıca taranır.
3. Her poliçe kuralı senaryo yapısıyla modellenir: olay/trigger, koşullar, dört durumlu kapsam sonucu (kapsamda/şartlı/kapsam dışı/belirsiz), muafiyet/tenzil, limit, istisnalar, gerekli belgeler, servis şartı, parça türü şartı, yapılacak işlem, kaynak sayfa/başlık/kloz, çıkarım güveni ve insan onayı gereksinimi.
4. Belgeler (poliçe, ihbar föyü, diğer) çelişirse sistem sessizce seçim yapmaz; çelişkiyi gösterir ve çözüm kullanıcı onaylıdır.
5. Kasko AI cevabı sekiz bölümlü standardı izler (Sonuç, Gerekçe, Muafiyet/limit, Servis-parça şartı, İşlem, Kaynak sayfa/kloz, Çelişki/eksik, Güven); AI tahmin yürütmez, hüküm yoksa "poliçede açık hüküm bulunamadı" der.
6. Kanonik alanlar sigorta şirketinden bağımsızdır; şirketin orijinal alan adı ve madde metni korunur; kanonik alan ↔ kaynak metin bağı izlenebilirdir.
7. Kasko operasyonunda en az şunlar takip edilir: muafiyet var/yok; tür/oran/koşul; kapsam durumu; ikame araç; ürün/tür; servis ve parça şartı; kloz kaynaklı operasyon engeli.
8. Değer kaybında mevzuat zorunluluğu (Trafik zorunlu, Kasko isteğe bağlı) ile ofis operasyon kuralı (eksper talimatı: Kasko'da da çalışılır) ayrı alanlardır; ofis kuralı sürümlüdür.
9. Parça bedeli KDV hariç ve iskonto uygulanmamış bedel esasıyla hesaplanır; kaynak, tarih ve fiyat belgesi izlenebilirdir.
10. Muafiyetli dosya iş akışı sekiz adımla bağlayıcıdır: tedarik yok → mobil onarım yok → sorumluya bilgi → servise bilgi → servis değişikliği beklenir → değişmezse operasyon yok → portal notları → sorumlu onayıyla kapanış; bildirim/görev/portal notu/onay/kapanış olarak modellenir ve audit üretir.
11. Gelecek veri kavramları (`policy_documents` … `policy_human_approvals`, 14 kavram) `DATABASE_MODEL_PLAN.md` §4.1'e değerlendirme adayı olarak eklendi; SQL/migration üretilmedi.

Gerekçe:

Kasko dosyalarındaki kapsam/muafiyet kararları özet alanlarla verilemez; yanlış "muafiyetsiz" varsayımı tedarik/mobil onarım gibi geri alınamaz operasyon hatalarına yol açar. Kurallar, Paket 05+ veri ve AI tasarımına tek kaynaklık edecek biçimde belgelenmiştir.

Etkisi:

- Yeni belgeler: `CASCO_POLICY_ANALYSIS_PLAN.md`, `CASCO_POLICY_CANONICAL_MODEL.md`, `CASCO_POLICY_SCENARIO_RULES.md`.
- Runtime kodu, API, domain paketi, dependency ve migration değişmedi; görev yalnız dokümantasyon/planlamadır.
- Açık kararlar: kloz bölümleme yöntemi, güven ölçeği ve onay eşiği, ilk şirket kapsamı, `policy_*` normalizasyon derinliği, AI bütçe payı.

Kaynak: 2026-07-12 tarihli Paket 04.5 kullanıcı talimatı.

## 2026-07-12 — HB-2026-008: Ana yol haritası (12 Temmuz 2026) mutabakatı

Karar:

1. "HasarBotu V2 — Baştan Sona Ana Yol Haritası" (harici DOCX, 12 Temmuz 2026 revizyonu) güncel ana ürün planı olarak tanınır; belge repository'ye eklenmez, mutabakatı `MASTER_ROADMAP_ALIGNMENT.md` taşır. Belgenin kendi hükmü gereği çelişkide daha yeni tarihli ve açıkça onaylanmış DECISION_LOG kayıtları önceliklidir.
2. İşlenen güncellemeler (G1-G21, ayrıntı hizalama belgesinde): beş durumlu kapsam sonucu (`bilgi_yetersiz` + `kaynaklar_celiskili`); mini onarım (teminat) / mobil onarım (operasyon yöntemi) ayrımı; muafiyet akışının geçici durdurma + aksiyon seçenekleri (uygun serviste yeniden değerlendirme; serviste kalmada gerçek muafiyet/tenzil/maliyet paylaşımı; oran sabit kodlanmaz) olarak revizyonu; `policy_*` kavram listesinin 26'ya genişletilmesi (+`policy_pages/sections/cost_shares/service_rules/part_rules/required_documents/external_references/action_holds/portal_notes/decision_history`, `part_price_references`, `ai_usage_ledger`, `backup_runs`, `restore_test_runs`); harici web klozu arşivleme; dokuz bölümlü AI cevabı ve tam "Poliçede bu konuda açık ve doğrulanabilir bir hüküm bulunamadı." ifadesi; AI kaynak sırası; parça bedelinde liste/gerçek bedel/pay ayrımı; değer kaybı uygunluk ekseni + "Uygulanamaz (gerekçe zorunlu)" + ofis kuralının "hesaplamaya uygun TÜM Kasko dosyaları" kapsamı; kasko poliçe evrakında tüm sayfalar+zeyil zorunluluğu; ofis numarası ek kuralları (tekrar kullanılmaz, iptal dağıtılmaz, yeniden açılan korur); ücretli bulut AI varsayılan kapalı + yönetici etkinleştirme + model kademesi + maliyet defteri; fiziksel dosyaların bağımsız yedek kapsamına alınması (BitLocker'lı disk, 14g/8h/12a saklama, gerçek restore testleri) — ARCHITECTURE'daki eski "fiziksel klasörler yedek dışı" hükmü geçersiz; ilk sigorta şirketi önceliği Türkiye Sigorta; İbra+Taahhütname anlaşmalı/yetkili serviste zorunlu; 12 zorunlu anonim kasko senaryo testi.
3. Körü körüne uygulanmayan noktalar (K1-K7, hizalama belgesi §3): dosya durumu 4'lü listesi ile HB-2026-003 `open/closed` yaşam döngüsü çelişkisi ve aşama seti farkı **Paket 05 öncesi çözülecek açık ürün kararı** olarak bırakıldı (domain kodu değiştirilmedi); 7/24 bağlı yedek diskinin fidye yazılımı riski kayıtlı (çevrimdışı/immutable rotasyon önerisi); internet araştırması yalnız etiketli son sıra kaynak; Google girişi opsiyonel, e-posta+şifre tek başına yeterli; poliçe ham metni hassas veri sınıfı/saklama politikası şartıyla; "Değer Kaybı Oluşmaz" ad çakışması şema tasarımında çözülecek.

Gerekçe:

Yol haritası revizyonu, tamamlanmış paketlerle uyumlu ve büyük ölçüde repo kararlarını genişletiyor; ancak dosya durumu/aşama seti gibi noktalarda kilitli mimari kararlarla çelişiyor. Genişletmeler işlenirken çelişkiler sessizce çözülmedi, karar kapısına bağlandı.

Etkisi:

- Güncellenen belgeler: MASTER_ROADMAP_ALIGNMENT (yeni), CASCO_POLICY_* (3), DOMAIN_RULES, PRODUCT_REQUIREMENTS, DATABASE_MODEL_PLAN, API_CONTRACT_PLAN, SECURITY_AND_AI_POLICY, TESTING_AND_ACCEPTANCE, ARCHITECTURE, ROADMAP, PROJECT_STATUS, IMPLEMENTATION_PLAN, INFRASTRUCTURE_IMPLEMENTATION_PLAN.
- Runtime kodu, domain paketi, dependency ve migration değişmedi; 379/379 test korunuyor.
- Paket 05 kabul kapısına K1/K2 (durum/aşama seti kararı) eklendi.

Kaynak: 2026-07-12 tarihli ana yol haritası DOCX incelemesi kullanıcı talimatı.

## 2026-07-12 — HB-2026-009: Paket 05 PostgreSQL ve migration temeli kararları

Karar:

1. Veritabanı: **PostgreSQL 17** (17.10), geçici merkez olan ofis Windows 11 makinesine Windows servisi olarak kuruldu (kullanıcı onayı alındı). Türkçe locale initdb hatası nedeniyle cluster manuel `UTF8 + ICU tr-TR + locale=C` ile kuruldu (kayıt: `DATABASE_OPERATIONS.md`).
2. SQL erişimi ve migration: **pg@8.22.0 + node-pg-migrate@8.0.4** (tam pin; kullanıcı onaylı). ORM kullanılmaz; migration'lar `packages/database/migrations` altında sıralı ESM dosyalarıdır, her adım kendi transaction'ında koşar, durum `pgmigrations` tablosundadır.
3. Kimlik biçimi: **UUIDv7** (kullanıcı onaylı; HB-2026-005'teki açık karar kapandı). Üretim uygulama/persistence katmanındadır (`@hasarbotu/database` uuidv7); domain paketi kimlik üretmez, yalnız doğrular. DB kolonları `uuid` tipindedir; DB tarafında default üretim yoktur.
4. Yeni workspace: `packages/database` (`@hasarbotu/database`, private, ESM, sideEffects:false): açık `DATABASE_URL` parser'ı (değer/şifre hata mesajına yazılmaz; `redactDatabaseUrl` log maskeleme), pg.Pool fabrikası (güvenli varsayılanlar), sınırlı süreli sağlık kontrolü (yalnız kararlı neden kodu döner) ve programatik migration koşucusu.
5. Test güvenlik kapısı: entegrasyon testleri yalnız `TEST_DATABASE_URL` ile koşar ve veritabanı adı `_test` ile bitmek zorundadır (`assertTestDatabaseUrl`); üretim bağlantısı testte kullanılamaz. URL yoksa blok açıkça atlanır.
6. API health genişlemesi: `DATABASE_URL` opsiyoneldir; verilirse health sınırlı süreli gerçek DB ping'iyle `ok`/`degraded` üretir (HTTP 200 + gövde durumu; contracts şeması zaten `degraded` içerir). Verilmezse Paket 04 davranışı aynen korunur. Havuz graceful shutdown'da kapanır. HB-2026-006 madde 11'in "health gerçek dependency kontrolü yapmaz" hükmü bu paketle güncellenmiştir.
7. Roller/veritabanları: `hasarbotu_app`→`hasarbotu`, `hasarbotu_test`→`hasarbotu_test`; bütün şifreler kriptografik üretilip yalnız `%USERPROFILE%\.hasarbotu\` altında tutulur; repo'ya/log'a yazılmaz; dotenv kullanılmaz.
8. Üretimde veri kayıplı `down` yerine onaylı ileri düzeltme esastır; otomatik production migration yoktur. İlk çekirdek şema yalnız `organizations` (firma kabuğu: uuid PK, unique+biçim kısıtlı `code`, `version >= 1`); kullanıcı/rol tabloları Paket 06'dadır.

Gerekçe:

Paket 05 tanımı (sürümlü şema yönetimi + güvenli bağlantı katmanı + test DB) ve kullanıcının üç açık onayı (PostgreSQL 17 kurulumu, pg+node-pg-migrate, UUIDv7). Yol haritası gereği geçici üretim merkezi bu makinedir.

Etkisi:

- Root zincirler domain → contracts → database → api sırasına genişledi; `npm run dev` değişmedi.
- `DATABASE_MODEL_PLAN.md` §7'deki "ID türü ve migration aracı onayı" kapısı kapandı; firm tablosu kabuğu kuruldu; retention sınıfları hâlâ açık karardır.
- K1/K2 (dosya durumu/aşama seti) kararı hâlâ açıktır ve cases şemasını (Paket 07) bloklar; Paket 05 bu karara dokunmaz.

Kaynak: 2026-07-12 tarihli kullanıcı onayları (AskUserQuestion) ve Paket 05 talimatı.

## 2026-07-12 — HB-2026-010: Dosya yaşam döngüsü / iş akışı ayrımı (K1/K2 kapanışı)

Karar:

1. `lifecycleStatus` yalnız **`open | closed`** değerlerini alır (domain `CaseStatus` aynen korunur).
2. `workflowStage` **ayrı alandır** ve operasyon aşamalarını taşır (domain `CASE_STAGES` on kodu; "Kapalı" bir aşama değildir).
3. "Beklemede", "Kapanmaya Hazır", "Gecikmiş", "Kontrol Bekliyor" gibi durumlar **türetilmiş operasyon görünümleridir**: takip tarihi, aşama, görev ve eksik-evrak durumundan hesaplanır; veritabanında ayrı yaşam döngüsü kolonu olarak saklanmaz.

Gerekçe:

Ana yol haritasındaki 4'lü durum listesi ile HB-2026-003 yaşam döngüsü ayrımı çelişiyordu (MASTER_ROADMAP_ALIGNMENT K1/K2). Türetilmiş görünüm yaklaşımı hem UI ihtiyacını hem veri bütünlüğünü tek doğrulukla karşılar.

Etkisi:

- K1/K2 açık kararları kapandı; Paket 07 cases şeması `lifecycle_status` (open|closed) + `workflow_stage` kolonlarıyla tasarlanır.
- Domain/contracts kodunda değişiklik gerekmez; UI'daki Türkçe durum çipleri sunum katmanında türetilir.

Kaynak: 2026-07-12 tarihli kullanıcı talimatı.

## 2026-07-12 — HB-2026-011: Paket 06 kimlik, rol ve oturum kararları

Karar:

1. Kimlik doğrulama e-posta + şifredir; parola hash'i **Argon2id** (m=19456 KiB, t=2, p=1; parametreler hash içinde taşınır). Parola politikası 10..128 karakter. Google girişi, e-posta gönderimi ve şifre sıfırlama kapsam dışı kaldı.
2. Oturumlar **sunucu taraflı ve iptal edilebilirdir**: 256-bit rastgele token yalnız SHA-256 hash'iyle `sessions` tablosunda saklanır; mutlak TTL 12 saattir; logout iptali idempotenttir.
3. Çerez politikası: `hb_session`, HttpOnly + SameSite=Strict + Path=/; `Secure` yalnız production NODE_ENV'de (yerel HTTP loopback'te kapalı). İmzalı çerez gerekmez (opak token, sunucu tarafı arama).
4. Brute-force koruması iki katmandır: hesap bazında **5 başarısız girişte 15 dk kilit** (DB'de kalıcı, `auth.account_locked` audit'li) + login yolunda IP başına **dakikada 10 deneme** sabit-pencere sınırı (429 `rate_limited` + Retry-After). `rate_limited` kodu contracts hata kataloğuna eklendi.
5. Dış görünüm tekdüzedir: bilinmeyen e-posta, yanlış parola, kilitli veya pasif hesap aynı 401 `unauthorized` cevabını verir (user-enumeration ve zamanlama koruması: bilinmeyen kullanıcıda sahte Argon2 doğrulaması yapılır); ayrıntılı neden yalnız audit'tedir.
6. Şema: `users` (küçük-harf global benzersiz e-posta, status active|disabled, failed_login_count, locked_until, version), sabit 6 kayıtlı `roles` kataloğu (admin, expert, case_manager, secretary, accounting, read_only), `user_roles` (çoktan-çoğa), `sessions`, append-only `audit_events` (ham parola/token/e-posta details'e yazılmaz). Migration `0002`; üretim DB'sine uygulama ayrı onaylı adımdır.
7. Auth uçları contracts'a eklendi: `POST /api/v1/auth/login`, `POST /api/v1/auth/logout` (204), `GET /api/v1/auth/session`; istek/yanıt şemaları strict; golden fixture seti 8 şemaya çıktı. Auth yalnız `DATABASE_URL` yapılandırılmış API'de kayıtlıdır; aksi halde uçlar güvenli 404 döner.
8. Yetkilendirme temeli: oturum çözümleme + rol kataloğu kuruldu; ilk aşamada herkes tam yetkili çalışır (DECISIONS), kaynak-bazlı permission matrisi ileri paketlerdedir.

Gerekçe: Paket 06 talimatı; oturum modeli/parola parametreleri açık kararları kapandı.

Etkisi: contracts +auth şemaları ve `rate_limited`; migration 0002; API auth modülü; toplam test 424/424. UI login ekranı ayrı pakettir.

Kaynak: 2026-07-12 tarihli Paket 06 kullanıcı talimatı.

## 2026-07-12 — HB-2026-012: Paket 07 cases okuma modeli kararları

Karar:

1. Migration 0003: `cases` tablosu HB-2026-010 ayrımıyla kurulur — `lifecycle_status` (open|closed) + `workflow_stage` (10 domain kodu; "Kapalı" aşama değildir). Türetilmiş operasyon görünümleri DB'de saklanmaz.
2. Ofis numarası üç kolonla saklanır: `office_year`, `office_sequence`, `office_number`; (org, yıl, sıra) ve (org, numara) benzersizdir. İptal edilen numaranın yeniden dağıtılmaması ve yeniden açılan dosyanın numarasını koruması uygulama kuralıdır (Paket 09+).
3. `plate_normalized` ayraçsız arama anahtarı kolon olarak saklanır ve indekslidir; `follow_up_date` yalnız `date` tipidir (HB-2026-005).
4. Referans tabloları minimal kuruldu: `service_centers` (yetkili|ozel, org içinde ad benzersiz) ve `insurers` (org içinde ad benzersiz).
5. Salt okunur Cases uçları oturum zorunludur; tenant kapsamı oturumdaki organizasyondur (başka organizasyonun dosyası 404 görünür). İlk aşamada tüm aktif kullanıcılar okuyabilir; permission matrisi ileri paketlerdedir.
6. Liste sorgusu contracts CasesQuery'yi birebir uygular: filtreler, çok-kelimeli AND arama (plate_normalized + ofis/ihbar/hasar no ILIKE), NULLS LAST sıralama, sayfa tabanlı pageInfo. Satırlar gönderilmeden önce contracts şemasıyla parse edilir; endpoint hiçbir yazma yapmaz.

Gerekçe: Paket 07 tanımı; case veri modeli ve filtre sözleşmesi Paket 03/05/06 kararlarının doğrudan uygulamasıdır.

Etkisi: DB tablo sayısı 10; API testleri 55'e, toplam 433'e çıktı. UI adapter değişimi (Paket 08) ve yazma uçları (Paket 09) kapsam dışı kaldı.

Kaynak: 2026-07-12 tarihli Paket 07 otonom devam talimatı.

## 2026-07-12 — HB-2026-013: Paket 08 DataPort sınırı kararları

Karar:

1. UI veri erişimi `src/data` altındaki `CasesDataPort` sınırından geçer: `MockDataAdapter` varsayılan ve güvenli fallback'tir; `HttpApiAdapter` salt okunur `GET /api/v1/cases` ucunu tüketir ve wire DTO'yu UI `CaseRecord` modeline saf eşleyicilerle çevirir.
2. İlk render HER ZAMAN mock veriyle eşdeğerdir (`useCases` kancası başlangıç durumu mock'tur); kaynak seçimi `hasarbotu-data-source` localStorage anahtarıyla opt-in `api` olur. Kabul edilmiş UI davranışı ve Ayarlar ekranı değiştirilmez.
3. Güvenli fallback zorunludur: API'ye ulaşılamaz veya oturum yoksa UI kırılmadan mock veriyle çalışır; konsola yalnız info seviyesinde not düşülür (warning/error yok — baseline konsol kapısı korunur).
4. UI durum çipi ve takip görüntüsü TÜRETİLMİŞ operasyon görünümleridir (HB-2026-010): `Gecikmiş` takip tarihi geçmişse türetilir; aşama kodları Türkçe etikete `src/data` eşleme tablosuyla çevrilir. API'de bulunmayan sunum alanları güvenli `—` ile doldurulur.
5. Tarayıcı-API erişimi aynı-origin Vite dev proxy'siyle (`/api` → `127.0.0.1:3100`) sağlanır; SameSite=Strict oturum çerezi bu yolla sorunsuz taşınır. CORS API'ye eklenmez (kapsam dışı korunur).
6. Kapsamdaki tüketiciler yalnız Dosyalar/Dosya Detayı yoludur; Dashboard/Kapanan/Raporlar mock'a doğrudan bağlı kalır (kademeli geçiş, plan gereği). Auth UI, yazma işlemleri, Electron ve File Agent kapsam dışıdır.

Gerekçe: INFRASTRUCTURE_IMPLEMENTATION_PLAN Paket 08 ve hedef mimarinin `Feature UI -> DataPort -> MockDataAdapter | HttpApiAdapter` sınırı; baseline UI regresyonsuz korunmalıdır.

Etkisi: 26 baseline UI testi değişmeden geçti; +7 veri katmanı testi ve 2 env-kapılı gerçek API smoke testi eklendi (canlı: oturumla gerçek liste eşlendi, oturumsuz 401→fallback). Toplam 442 (440 koşu + 2 canlı ayrı).

Kaynak: 2026-07-12 tarihli Paket 08 kullanıcı talimatı.

## 2026-07-12 — HB-2026-014: Paket 08 güvenlik düzeltmesi — sessiz mock fallback kaldırıldı

Karar (HB-2026-013 madde 3'ü geçersiz kılar):

1. API modunda hata durumunda MockDataAdapter'a **sessiz düşüş yoktur**; sahte veri gerçek API hatasını hiçbir zaman maskelemez.
2. Mock yalnız **açıkça seçilen** development/demo veri kaynağıdır (varsayılan kaynak olarak baseline davranışı sürer).
3. API modunda durumlar ayrışır ve UI'da açıkça gösterilir: **401 → oturum gerekli** (`unauthorized`); **ağ/5xx → servis kullanılamıyor** (`unavailable`); **gerçek boş liste → boş durum** (`ok` + boş). `HttpCasesError` sınıfı hata türünü taşır; `useCases` mock'a dönmez.
4. Dosyalar/Dosya Detayı api modunda role=alert/status ile Türkçe durum mesajı gösterir; mock modda hiçbir uyarı çıkmaz (baseline korunur).

Gerekçe: Sessiz fallback, oturum/servis sorunlarını sahte veriyle gizleyerek operasyonel yanlış karara yol açabilirdi (kullanıcı güvenlik talimatı).

Etkisi: `fallback.ts` kaldırıldı; +6 durum testi ve 3 bileşen testi; UI testleri 39/39; canlı smoke 2/2 (oturumla gerçek eşleme, oturumsuz `unauthorized` türü).

Kaynak: 2026-07-12 tarihli güvenlik düzeltmesi talimatı.

## 2026-07-12 — HB-2026-015: Paket 09 dosya yazma komutları kararları

Karar:

1. Yazma uçları: `POST /api/v1/cases` (oluşturma) ve `PATCH /api/v1/cases/:caseId` (güvenli alan güncellemesi). Oturum zorunlu, tenant kapsamlı; her başarılı yazma A1 audit üretir (`case.created` / `case.updated`; details yalnız güvenli özet taşır: ofis no + tür / değişen alan adları + sürüm geçişi — plaka/PII yazılmaz).
2. **Ofis numarası ataması** `office_counters` (firma+yıl) sayacından, oluşturma transaction'ı içinde `UPSERT ... RETURNING` ile yapılır: eşzamanlı güvenli, monoton, boşluksuz; başarısız transaction sayacı TÜKETMEZ; iptal/silinmede numara asla yeniden dağıtılmaz (HB-2026-008 G14 mekanik garantisi).
3. **Optimistic locking:** güncelleme `expectedVersion` zorunludur; `SELECT ... FOR UPDATE` + sürüm karşılaştırması; uyuşmazlıkta 409 `version_conflict` ve veri ezilmez; başarıda `version + 1`.
4. **Idempotency:** oluşturmada `Idempotency-Key` başlığı zorunludur (güvenli-ASCII 1..128). `idempotency_keys` (org+scope+key benzersiz) kaydı yanıtla birlikte AYNI transaction'da yazılır: aynı anahtar+aynı gövde → saklanan 201 aynen döner; aynı anahtar+farklı gövde → 409 `idempotency_conflict`; eşzamanlı yarışta unique ihlali yakalanıp saklanan yanıt okunur.
5. Değiştirilemezler: `lifecycle_status` (kapanış/yeniden açma ayrı kritik işlem), `plate` ve `caseType` (fiziksel klasör kimliği; File Agent kapsamı), ofis numarası (sunucu atar). Referans alanları (`responsibleUserId`/`serviceId`/`insurerId`) org-içi varlık kontrolünden geçer; org-dışı referans 400 `unknown_reference`.
6. Kritik işlem modeli uygulaması: doğrula → tek transaction'da uygula (numara+kayıt+audit+idempotency) → şema-doğrulanmış yanıt. UI önizleme/onay adımları UI komut adapter'ıyla birlikte ertelendi (madde 7).
7. **Bilinçli erteleme:** plan kapsamındaki "UI komut adapter'ı" bu pakete alınmadı — login UI yokken tarayıcıdan kimlikli yazma anlamlı değildir; UI yazmaları mock modda kalır (planın geri alma stratejisiyle uyumlu). Fiziksel klasör, PDF analizi, File Agent ve poliçe motoru kullanıcı talimatıyla kapsam dışıdır.

Gerekçe: INFRASTRUCTURE_IMPLEMENTATION_PLAN Paket 09 + kullanıcı talimatı; concurrency/idempotency kararları API_CONTRACT_PLAN §1'in somutlaştırmasıdır (version taşıma yöntemi: request body `expectedVersion` olarak KAPANDI).

Etkisi: Migration 0004 (`office_counters`, `idempotency_keys`); contracts +2 komut şeması (golden 10); API +11 uçtan uca yazma testi. `If-Match` alternatifi kapandı; kapanış/yeniden açma Paket 10+ kritik işlemidir.

Kaynak: 2026-07-12 tarihli Paket 09 kullanıcı talimatı.

## 2026-07-13 — HB-2026-016: Paket 10 UI oturum yönetimi ve gerçek API entegrasyonu

Karar:

1. **İki mod ayrımı (baseline korunur):** `mock` mod (varsayılan, HB-2026-014) açıkça seçilen demo veri kaynağıdır ve oturum kapısı YOKTUR — kabul edilmiş UI baseline'i aynen render edilir. `api` mod gerçek oturum gerektirir. Mod `getConfiguredDataSource()` (localStorage `hasarbotu-data-source`) ile belirlenir; mock, api hatasını HİÇBİR ZAMAN maskelemez ve sahte oturum uydurulmaz.
2. **Oturum sınırı (`AuthPort`):** `bootstrap` (`GET /api/v1/auth/session` → kullanıcı | 401 null), `login` (`POST /api/v1/auth/login`), `logout` (`POST /api/v1/auth/logout`). Oturum HttpOnly çerezle SUNUCU tarafında tutulur; parola/token UI state veya localStorage'da ASLA saklanmaz. Tarayıcıda çerez `credentials: 'include'` + aynı-origin Vite proxy ile taşınır.
3. **`SessionProvider` + gate:** api modda açılışta bootstrap; oturum yoksa/sona erdiyse `LoginPage`, yalnız kimlikli oturumda korumalı rotalar. Hatalar ayrımlı: `invalid_credentials` (401/400 tekdüze), `rate_limited` (429 + Retry-After), `unavailable` (ağ/5xx).
4. **401 güvenli akışı:** api modda veri katmanı 401 gördüğünde `reportUnauthorized()` çağrılır; oturum `expired` olur ve "Oturumunuz sona erdi" notuyla login ekranına dönülür. Bayat mock veri gösterilmez.
5. **`CaseCommandPort` (yazma sınırı):** `createCase` (Idempotency-Key üretir → `POST /api/v1/cases`) ve `updateCase` (`PATCH /api/v1/cases/:caseId`, `expectedVersion`); hata eşlemesi `unauthorized`/`validation`/`unknown_reference`/`version_conflict`/`idempotency_conflict`/`not_found`/`unavailable`. Mock komut adapteri demo modda HİÇBİR yazma yapmaz (çağrı reddedilir).
6. **Bilinçli erteleme / kapsam dışı:** Onaylı prototipte gerçek create/update EKRANI olmadığı için yeni kapsamlı ekran tasarlanmadı — yalnız komut sınırı + güvenli entegrasyon altyapısı kuruldu (kullanıcı talimatı). Google girişi, şifre sıfırlama, e-posta gönderimi, fiziksel klasör işlemleri, case close/reopen, File Agent ve poliçe motoru kapsam dışıdır. Dashboard/Kapanan/Raporlar kademeli plan gereği mock içerikte kalır (HB-2026-013).

Gerekçe: INFRASTRUCTURE_IMPLEMENTATION_PLAN Paket 08 tamamlayıcısı + Paket 06 auth + Paket 09 yazma uçları; MASTER_ROADMAP_ALIGNMENT G21 (e-posta+şifre birincil; Google girişi opsiyonel ek) ve K5 sınırı.

Etkisi: UI'da `src/data/authPort.ts`, `src/data/commandPort.ts`, `src/app/session.tsx` + `src/app/sessionContext.ts`, `src/features/auth/LoginPage.tsx`; App gate + Topbar oturum/çıkış; `useCases` 401→expired sinyali. +31 UI testi (authPort/commandPort/SessionProvider/App gate) + gerçek API ve tarayıcı uçtan uca smoke. Runtime API/DB/migration değişikliği YOK.

Kaynak: 2026-07-13 tarihli Paket 10 kullanıcı talimatı.

## 2026-07-13 — HB-2026-017: Paket 11 merkezi audit altyapısı

Karar:

1. **Tek merkezi audit yolu:** Yeniden kullanılabilir `AuditService.record(executor, event)` mevcut `audit_events` tablosuna (0002) yazar; PARALEL veya ikinci bir audit sistemi kurulmadı. Alanlar tabloya birebir: organizationId, actorUserId, action, entityType (`resource_type`), entityId (`resource_id`), requestId, occurredAt (`occurred_at`), redaksiyonlu `details`.
2. **Atomiklik:** `record` bir executor (havuz VEYA transaction istemcisi) alır; audit kaydı ilgili iş yazımıyla AYNI transaction'da yazılır. Case create/update zaten transaction içindeydi; login (başarılı: sayaç sıfırlama + oturum + audit; başarısız: sayaç artışı + audit + kilit audit) ve logout (oturum iptali + audit) `withTransaction` ile atomik hale getirildi — yarım iş/yarım audit kalmaz.
3. **Append-only (savunma-derinliği):** Migration 0005 `audit_events` üzerinde `BEFORE UPDATE/DELETE` trigger'ı ile satır değişikliğini/silmeyi veritabanı seviyesinde reddeder (`append-only`). Uygulama katmanında güncelleme/silme ucu yoktur; yalnız ekleme servisi yazar. Kiracı/varlık sorgu indeksleri eklendi.
4. **Redaksiyon:** `details` yazılmadan önce alan ADına göre redaksiyondan geçer: parola/token/cookie/authorization/session/hash/apiKey/kart/IBAN/SSN/tam poliçe metni/ham metin/özel anahtar `[redacted]` olur; aşırı uzun metin kırpılır; derinlik/eleman sayısı sınırlanır. `summarizeChange` güvenli eski/yeni değer özeti üretir (hassas alan değeri redakte). Gerçek DB testi + canlı smoke parola ve oturum token'ının audit'e sızmadığını doğrular.
5. **Merkeze taşınan olaylar:** `auth.login_succeeded` / `auth.login_failed` / `auth.login_rate_limited` / `auth.account_locked` / `auth.logout` ve `case.created` / `case.updated` artık tek merkezi katmandan yazılır (`store.insertAudit` kaldırıldı).
6. **Salt-okunur sorgu API'si:** `GET /api/v1/audit-events` oturum + **yönetici** rolü ister (aksi halde 403 `forbidden`), oturumdaki organizasyonla kiracı-kapsamlıdır (cross-tenant sızıntı yok), strict filtre (action/actorUserId/entityType/entityId/occurredFrom/occurredTo) + sınırlı sayfalama (pageSize ≤ 100) sağlar. Yazma/güncelleme/silme ucu YOKTUR.
7. **Retention/export yalnız PLAN:** saklama süresi, arşiv, imzalı dışa aktarma ve SIEM entegrasyonu `AUDIT_SECURITY_AND_BACKUP_PLAN.md` §6.5'te plan olarak belgelendi; bu pakette uygulanmadı. UI audit ekranı, case close/reopen, File Agent, SIEM ve üretim migration çalıştırması kapsam dışıdır.

Gerekçe: INFRASTRUCTURE_IMPLEMENTATION_PLAN özgün "Paket 10 — Audit altyapısı" + kullanıcı talimatı; AUDIT_SECURITY_AND_BACKUP_PLAN §6 (asgari alanlar, önce/sonra maskeleme, append-only bütünlük) somutlaştırması.

Etkisi: Migration 0005 (append-only trigger + indeksler); yeni `services/api/src/audit/*` (service/redact/query-store/routes) ve `src/db/executor.ts`; contracts +2 şema (`audit-events-query`/`audit-events-response`, golden 10→12); auth store executor parametreleri + `insertAudit` kaldırıldı. +17 API testi (append-only reddi, redaksiyon, atomik rollback, merkezi olaylar, sorgu filtre/pagination, kiracı izolasyonu, 401/403) + redaksiyon birim testleri + canlı HTTP güvenlik smoke 7/7.

Kaynak: 2026-07-13 tarihli Paket 11 kullanıcı talimatı.

## 2026-07-13 — HB-2026-018: Paket 12 depolama referansı ve güvenli göreli yol temeli

Karar:

1. **Konum modeli:** Dosya konumu yalnız MANTIKSAL `storageRootKey` + POSIX `relativePath` ile modellenir. Veritabanına mutlak `P:\`, sürücü harfi veya UNC yolu ASLA yazılmaz; cihaz→mutlak root eşlemesi yalnız yerel File Agent/config'te kalır (ARCHITECTURE + FILE_STORAGE_AND_AGENT_PLAN §1-2 somutlaştırması).
2. **Güvenli göreli yol doğrulaması (domain `parseRelativePath`):** Güvenlik sınırıdır ve şunları REDDEDER: traversal (`..` segmenti), POSIX absolute (`/…`), sürücü ön eki (`C:`/`P:`), UNC/backslash, kontrol karakteri (null dahil), Windows yasak karakterleri (`< > : " | ? *`), ayrılmış aygıt adları (CON/PRN/NUL/COM1-9/LPT1-9), boş segment/çift ayraç, segment başı/sonu boşluk ve segment sonu nokta. Türkçe adlar ve iç boşluk (`Temmuz 2026`, `DEĞER KAYBI`) geçerlidir. Sözleşme ayracı yalnız `/`.
3. **Veritabanı savunma-derinliği (Migration 0006):** `storage_roots` (org+root_key benzersiz, slug CHECK, MUTLAK YOL KOLONU YOK); `case_locations` (vaka başına tek, `version` optimistic lock, composite FK ile kök org'da olmalı, `(org,root,path)` benzersiz, `relative_path` üzerinde traversal/absolute/backslash/kontrol/yasak-karakter CHECK'i); `case_location_history` (append-only trigger + aynı path CHECK).
4. **API (oturum + kiracı kapsamlı):** `GET /storage-roots`; `GET/PUT /cases/:caseId/location` (PUT optimistic locking `expectedVersion` ile, ilk atamada version 1, uyuşmazlık 409, bilinmeyen/pasif kök 400 `unknown_reference`, yabancı org 404); `GET /cases/:caseId/location/history` (sınırlı pagination). Atama tek transaction'da: güncel konum + append-only geçmiş + merkezi audit (Paket 11) atomik. `verificationStatus` istekle set EDİLEMEZ; atamada `pending` başlar (fiziksel doğrulama File Agent işidir, bu pakette YOK).
5. **Mutlak yol sızıntısı yok:** API yanıtı, audit details ve loglar yalnız rootKey + göreli yol taşır. Gerçek DB + canlı smoke ile audit'te sürücü/backslash 0 doğrulandı.
6. **Taşınabilirlik:** pCloud/`P:\BARAN GLOBAL EKSPERTİZ` MEVCUT kök olarak belgelenir; mantıksal rootKey sayesinde başka disk/NAS köküne geçiş yalnız yerel config değişikliğidir (şema/veri değişmez). Kapsam dışı: gerçek klasör oluşturma/taşıma/rename, File Agent uygulaması, `P:` tarama, close/reopen, Electron, fiziksel yükleme, UI.

Gerekçe: INFRASTRUCTURE_IMPLEMENTATION_PLAN dosya depolama sırası + kullanıcı talimatı; FILE_STORAGE_AND_AGENT_PLAN §1-3 (kaynak doğruluk ayrımı, storage root profili, göreli yol standardı) temel alındı.

Etkisi: Migration 0006 (`storage_roots`, `case_locations`, `case_location_history` + `append_only_guard`); domain `storage-path.ts` (+35 birim testi); contracts storage primitives + `v1/storage` (+4 golden şema, 12→16); yeni `services/api/src/storage/*`; app.ts kayıt. +12 API testi (atama/optimistic-lock/tenant/unknown-root/traversal-red/geçmiş/audit-no-absolute/DB-CHECK/append-only) + canlı HTTP güvenlik smoke 10/10.

Kaynak: 2026-07-13 tarihli Paket 12 kullanıcı talimatı.

## 2026-07-13 — HB-2026-019: Paket 13 belge, belge sürümü ve fotoğraf metadata temeli

Karar:

1. **Model:** `documents` (mantıksal slot, optimistic `version`), `document_versions` (immutable kayıtlı gerçek + doğrulama durumu + `previous_version_id`) ve `photos` (bağımsız kayıt) tabloları (Migration 0007), org/case tenant izolasyonu, UUIDv7 kimlikler. Alanlar: orijinal ad, güvenli gösterim adı, uzantı, MIME, byte boyutu, SHA-256 (BEYAN), `storage_root_key` + güvenli göreli yol, belge türü (slug) + kaynak türü (enum). Yalnız METADATA; dosya içeriği yoktur.
2. **Durum + `ready` değişmezi:** `status ∈ {pending, ready, failed, missing}`; kayıt DAİMA `pending`. Registration şeması `status`/`hash_verified`/`size_verified`/`verified_at`'i İÇERMEZ — istemci/genel API `ready`'yi belirleyemez. Veritabanı CHECK'i `ready`'yi yalnız `hash_verified AND size_verified AND verified_at IS NOT NULL` iken mümkün kılar: fiziksel dosya doğrulanmadan `ready` OLUŞAMAZ. `content_hash` istemci BEYANIDIR ve doğrulanmış sayılmaz.
3. **Append-only + immutable:** `metadata_append_guard` trigger'ı `document_versions`/`photos` üzerinde DELETE'i ve kayıtlı gerçeklerin değişmesini reddeder; yalnız doğrulama alanları (status/hash_verified/size_verified/verified_at) ileride File Agent tarafından AYRICALIKLI yolla güncellenebilir (public API bu yolu sağlamaz). Geçiş mekanizması `FILE_STORAGE_AND_AGENT_PLAN.md` §2.2'de belgelendi.
4. **Registration sınırı + idempotency:** `POST /cases/:caseId/documents` (yeni belge veya mevcut belgeye `documentId`+`expectedVersion` ile yeni sürüm; optimistic locking, 409 conflict) ve `POST /cases/:caseId/photos`; her ikisi oturum + zorunlu `Idempotency-Key` (Paket 09 `idempotency_keys` yeniden kullanıldı; aynı anahtar+gövde replay, farklı gövde 409). `extension` istemciden ALINMAZ; sunucu addan türetir ve `mimeType` tutarlılığını doğrular (uyuşmazlık 400); tehlikeli dosya adı (ayraç/traversal/kontrol/aygıt-adı) reddedilir; kategori (document/photo) uzantıyla eşleşmelidir.
5. **Duplicate tespiti, birleştirme YOK:** aynı `content_hash` vaka içinde `sameCaseVersionId`/`sameCasePhotoId` ile raporlanır, diğer vakalarda `otherCaseCount` ile sayılır; ancak vakalar arası SESSİZ otomatik birleştirme yapılmaz (farklı vaka → farklı belge).
6. **Okuma + audit:** oturum + kiracı kapsamlı salt-okunur liste/detay (`GET /cases/:caseId/documents`, `GET /documents/:id` sürümlerle, `GET /cases/:caseId/photos`, `GET /photos/:id`). Her kayıt merkezi audit (Paket 11) üretir; audit details ve tüm yanıtlar yalnız göreli yol taşır — mutlak yol sızmaz. Kapsam dışı: gerçek yükleme/kopyalama/silme, içerik okuma, PDF/foto AI, OCR, thumbnail, File Agent, close/reopen, UI.

Gerekçe: INFRASTRUCTURE_IMPLEMENTATION_PLAN "Paket 11 — Dosya meta verisi" + kullanıcı talimatı; FILE_STORAGE_AND_AGENT_PLAN §4-6 (dosya adı güvenliği, atomik kesinleştirme, hash/duplicate) temel alındı. `ready` yalnız güvenilir doğrulama sonrası ilkesi (§1, §14) DB CHECK + trigger ile mekanik olarak zorlandı.

Etkisi: Migration 0007 (`documents`, `document_versions`, `photos` + `metadata_append_guard`); domain `file-metadata.ts` (+9 birim testi); contracts `v1/documents` (+5 golden şema, 16→21); yeni `services/api/src/documents/*` + `src/db/idempotency.ts`; app.ts kayıt. +12 API testi (kayıt/sürüm/optimistic-lock/idempotency/MIME-uyuşmazlık/tehlikeli-ad/duplicate/kategori/tenant/okuma/ready-CHECK/immutable/append-only/audit-no-absolute) + canlı HTTP güvenlik smoke.

Kaynak: 2026-07-13 tarihli Paket 13 kullanıcı talimatı.

## 2026-07-13 — HB-2026-020: Paket 14 File Agent kontrol katmanı ve doğrulama protokolü

Karar:

1. **Ayrı File Agent workspace'i:** `services/file-agent` (@hasarbotu/file-agent). Yalnız `@hasarbotu/domain` + `@hasarbotu/contracts`'e bağlıdır; **veritabanı bağımlılığı YOKTUR**. Agent yalnız API üzerinden çalışır, doğrudan DB'ye yazmaz.
2. **Cihaz/agent kimliği (Migration 0008 `agents`):** kullanıcı oturumlarından ayrıdır. Ham secret 256-bit rastgeledir ve DB'de yalnız SHA-256 hash'i tutulur; ham secret DB/audit/log'a yazılmaz, yalnız kayıt yanıtında BİR kez döner. `x-agent-id`+`x-agent-secret` başlıklarıyla kimlik; `x-agent-secret` log'da redakte. Yönetici uçları: kayıt / enable-disable / liste; son görülme zamanı her istekte güncellenir. Devre dışı agent 403.
3. **PostgreSQL iş kuyruğu (Migration 0008 `jobs`):** claim `FOR UPDATE SKIP LOCKED` ile tektir (aynı işi iki agent alamaz). Lease + heartbeat + timeout sonrası geri kazanım; attempt her claim'de artar; `failed` sonuçta üstel backoff ile retry, `max_attempts` aşılınca `dead_letter`. Payload YALNIZ güvenli alanlar taşır (mantıksal rootKey + göreli yol + beyan hash/size); mutlak yol ASLA yazılmaz (CHECK ile de engellenir).
4. **İş türleri:** `verify_document`, `verify_photo`, `verify_case_location`. İşler ilgili metadata (belge sürümü/fotoğraf/konum) kaydı oluşturulurken AYNI transaction'da kuyruğa eklenir (atomik).
5. **Yerel root eşlemesi:** `storageRootKey → cihazdaki mutlak root` YALNIZ Agent'ın yerel config'indedir (env `HASARBOTU_AGENT_ROOTS`). API/DB/audit/log'a mutlak yol gönderilmez. `relativePath` domain doğrulamasından geçer, root altında birleştirilir ve **`realpath` ile symlink/junction kaçışı** reddedilir (traversal, drive/UNC, root dışı → `root_escape`/`unsafe_relative_path`).
6. **Doğrulama protokolü (atomik, yarış-korumalı):** Agent GERÇEK dosyadan SHA-256'yı STREAMING hesaplar (tüm dosya belleğe alınmaz), boyutu gerçek dosyadan alır ve YALNIZ gözleneni raporlar — istemci beyanına güvenmez. **Sunucu** gözleneni satırdaki beyanla karşılaştırır: eşleşme → `pending → ready`; uyuşmazlık → `ready` YAPILMAZ, metadata `failed` + güvenli neden (`hash_mismatch`/`size_mismatch`), iş `failed`; dosya yok → `missing`; erişim hatası → retry/`dead_letter`. Metadata güncelleme + iş durumu + merkezi audit tek transaction'dadır. Yarışta (metadata sürümü/durumu değişmişse) eski sürüm ÜZERİNE yazılmaz (stale-skip). Sonuç bildirimi idempotenttir (terminal iş yeniden bildirilince mevcut durum döner).
7. **Güvenlik:** secret/mutlak yol/ham hata detayı API yanıtına taşınmaz; agent yalnız kendi organizasyonu ve atanmış işiyle sınırlıdır; testler yalnız sentetik geçici dosya kullanır; dosya içeriği loglanmaz. Kapsam dışı: dosya/klasör oluşturma-taşıma-silme, upload, thumbnail/OCR/AI, Electron, UI agent ekranı, LAN/TLS, üretim migration.

Gerekçe: INFRASTRUCTURE_IMPLEMENTATION_PLAN "Paket 12 — File Agent iskeleti" + kullanıcı talimatı; FILE_STORAGE_AND_AGENT_PLAN §5-10 (atomik kesinleştirme, lock/lease, job queue, retry, recovery) ve §2.2 (Paket 13 doğrulama akışı) somutlaştırması.

Etkisi: Migration 0008 (`agents`, `jobs`); contracts `v1/agent` (+3 golden şema, 21→24); yeni `services/api/src/agent/*` (auth/store/routes/enqueue) + doc/photo/location kayıt akışına enqueue kancaları; app.ts kayıt + `x-agent-secret` redaksiyonu; yeni `services/file-agent` workspace'i (config/path-resolver/verifier/api-client/agent). +12 agent-side birim (path/verifier, symlink/junction escape) + +15 API testi (auth, SKIP-LOCKED, lease/heartbeat, expired recovery, retry/dead-letter, verify→ready atomik, mismatch, missing, sürüm yarışı, idempotency, tenant, security) + gerçek uçtan uca (agent+API+geçici dosya) + canlı HTTP güvenlik smoke 7/7.

Kaynak: 2026-07-13 tarihli Paket 14 kullanıcı talimatı.

## 2026-07-14 — HB-2026-021: Paket 15 koşullu evrak gereksinimi motoru

Karar:

1. Evrak mevcutluğu yalnız `ready` + hash/boyut + `verified_at` doğrulamasıyla belirlenir; `pending`/`failed` `control_required`, `missing` eksik sayılır. Genel API bu doğrulamayı değiştiremez.
2. Trafik ve Kasko olay belgesi Zabıt/KTT/Beyan alternatif grubudur. Zabıt varsa KTT, Beyan ve Tramer uygulanmaz; yoksa KTT veya Beyandan biri gerekir, Tramer zorunludur.
3. Kasko rücu ek belgeleri yalnız kesinleşmiş rücuda zorunludur. Rücu belirsizse kontrol gerekir; AI tahmini veya otomatik missing yoktur.
4. Kural seti ve sürümü migration seed + saf domain motorunda açıkça taşınır. GET değerlendirmesi snapshot veya audit yazmaz; salt-okunur her çağrıda audit gürültüsü oluşmaması için karar merkezi audit politikasına uygundur. İleride kalıcı snapshot gerekiyorsa sonuç + audit aynı transaction'da yazılacaktır.

Etkisi: `0009_document_requirement_rules`, saf domain değerlendirme motoru, tenant-kapsamlı GET `/api/v1/cases/:caseId/document-requirements`, contracts ve JSON Schema fixture'ı. Dosya içeriği/mutlak yol dönmez.

## 2026-07-14 — HB-2026-022: Paket 16 Evrak ve Fotoğraf gerçek API görünümü

Karar:

1. Dosya Detayı > Evrak ve Fotoğraf, `CaseDocumentsDataPort` üzerinden requirements + belge listesi/detayı + fotoğraf listesini okur. API modunda hata veya boş yanıt mock veriyle maskelenmez; 401, tenant-kapsamlı 404, ağ hatası, yükleniyor ve boş durumları ayrıdır. Mock modun kabul edilmiş fotoğraf stres görünümü değişmez.
2. Arayüz yalnız metadata gösterir. Mutlak/sürücü/UNC/traversal yol DataPort sınırında reddedilir; içerik, hash ve secret gösterilmez. `ready` metadata ancak hash/boyut ve doğrulama zamanı kanıtı da varsa "Fiziksel doğrulandı" gösterilir; pending/failed/missing ayrı rozetlerdir.
3. Trafik, Kasko, Olay Belgeleri/Tramer ve Rüculu Kasko grupları; alternatif grup gerekçesi ve `ruleSetVersion` mevcut iki sütunlu yoğun masaüstü yerleşiminde gösterilir. Yeni yazma, upload, sınıflandırma veya File Agent işlemi yoktur.
4. Veri kaynağı varsayılanı mock kalır. Açık localStorage seçimi önceliklidir; seçim yoksa dağıtım/dev ortamı `VITE_DATA_SOURCE=api` ile API modunu varsayılan yapabilir. API modu hiçbir koşulda mock fallback yapmaz.
5. Üç GET değerlendirmesi ve belge detay okumaları salt okunurdur. Paket 15 kararı korunur: UI çağrıları değerlendirme snapshot'ı veya `document_requirements.evaluated` audit olayı üretmez.

Etkisi: `src/data` içinde yeni document workspace port/HTTP adapter/hook; `DocumentPhotoApiModule`; güvenli metadata tabloları ve gerçek durum görünümleri; unit/integration/live adapter testleri. Database, contracts, API, IPC, dependency veya veri yazma yolu değişmez.

## 2026-07-14 — HB-2026-023: Paket 17 create/edit UI komut sınırı

Karar:

1. API modundaki Yeni İhbar formu yalnız mevcut `CaseCommandPort.createCase` komutunu kullanır. Plaka UI'da domain ile aynı kuralla kanonikleştirilir; ofis numarası istemciden alınmaz. Bir payload için üretilen Idempotency-Key ağ hatası/yeniden denemede korunur, form değişirse yeni anahtar üretilir; eşzamanlı ikinci submit senkron guard ile engellenir.
2. Temel düzenleme yalnız mevcut Case update contract alanlarını gönderir ve zorunlu `expectedVersion` taşır. Sunucunun döndürdüğü yeni `version` istemci state'ine alınır. `version_conflict` ham hata göstermeden açıklanır ve tek dosyayı yeniden yükleme akışı sunulur. Plaka, caseType, ofis numarası ve lifecycle değiştirilemez; close/reopen bu UI'da yoktur.
3. Kullanıcı/servis/sigorta liste endpoint'i bulunmadığından sabit sahte kayıtlar gerçek seçenek gibi sunulmaz. Oturum kullanıcısı gerçek sorumlu seçeneğidir; servis ve sigorta geçici olarak açıkça referans kimliği alanıdır ve server tenant kontrolüne tabidir. Ayrı eksper, hasar tarihi ve ihbar tarihi mevcut Case create/update contract'ında olmadığı için disabled açıklanır ve payload'a eklenmez.
4. Mock modun onaylı belge-seçimi prototipi aynen korunur. API modunda 401, 404, validation, tenant-dışı referans, 409, 5xx veya ağ hatası mock veriye düşmez; kullanıcıya güvenli Türkçe mesaj gösterilir. Başarılı create/update mevcut merkezi audit transaction'ını kullanır; Paket 17 yeni audit yolu, migration veya yazma endpoint'i eklemez.

Etkisi: `CaseCreateModal`, `CaseEditModal`, payload-sürümü/idempotency/alan-hatası UI yardımcıları; CaseRecord'ta opsiyonel komut metadata'sı; `useCases.reload`; gerçek API + tarayıcı testleri. Contracts, API, database, IPC ve dependency değişmez.

## 2026-07-14 — HB-2026-024: Paket 18 aktif referanslar ve Case çekirdeği

Karar:

1. Sigorta şirketi, servis, kullanıcı ve eksper seçenekleri ayrı organization-kapsamlı salt-okunur `/api/v1/references/*` uçlarından gelir. Yalnız aktif kayıtlar döner; eksper listesi `users + user_roles + roles(code=expert)` kaynak doğruluğunu kullanır. API modunda sabit seçenek veya mock fallback yoktur.
2. `expertUserId`, `lossDate` ve `notificationDate` Case domain/contracts/DB/create/update/read akışının nullable alanlarıdır. Tarihler `LocalDate`/PostgreSQL `date` taşır; saat ve timezone yoktur. İhbar tarihi hasar tarihinden önce olamaz.
3. Migration `0010` backward-compatible'dır: mevcut case satırları yeni nullable alanlarla korunur; mevcut servis ve sigorta kayıtları `is_active=true` varsayımıyla korunur. Üretim migration bu pakette çalıştırılmaz.
4. Yeni atamalarda referans aynı tenantta ve aktif olmalıdır; eksper ayrıca gerçek `expert` rolüne sahip olmalıdır. Pasif mevcut ilişki okunabilir kalır ancak yeniden atanamaz; UI değiştirme/temizleme olanağı verir.
5. Case update `expectedVersion` optimistic locking modelini değiştirmez. Create audit'i yalnız atanmış alan adları ve tarih alanı varlığı; update audit'i yalnız değişen alan adları ve sürüm geçişi taşır. İsim, e-posta, tarih değeri, parola veya secret audit'e yazılmaz.
6. Yol haritasındaki tarihsel “Paket 18 Gmail” başlığı yeniden numaralandırılmadı; bu kullanıcı talimatlı ek Paket 18, referans/Case çekirdeği kapsamıdır ve Gmail entegrasyonunu başlatmaz.

Etkisi: `0010` migration, dört contracts/JSON Schema referans cevabı, references API store/routes, Case DTO/komut alanları, gerçek referans DataPort/adapter/hook ve create/edit form bağlaması. Yeni dependency, IPC, File Agent veya fiziksel dosya işlemi yoktur.
