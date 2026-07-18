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

## 2026-07-14 — HB-2026-025: Paket 19 güvenli Case çalışma klasörü provisioning

Karar:

1. Çalışma klasörü yolu `notificationDate` ve kanonik plakadan deterministik olarak `YYYY/Ay YYYY/PLAKA` üretilir. Aynı org/root/ay/plaka rezervasyonları PostgreSQL advisory lock altında `PLAKA`, `PLAKA - 2`, `PLAKA - 3` sırasıyla ayrılır. DB, API ve audit yalnız `storageRootKey + relativePath` taşır; mutlak kök yalnız Agent yerel config’indedir.
2. Plan/preview dosya sistemine yazmaz. Zorunlu `Idempotency-Key` ve açık kullanıcı onayı sonrasında tek `provision_case_workspace` işi kuyruğa alınır. Vaka başına tek provisioning rezervasyonu ve provisioning hedefi başına tek aktif job DB unique kısıtlarıyla zorlanır.
3. Fiziksel işlem yalnız File Agent’da, eklemeli ve idempotenttir: ana klasör ile `EVRAK`, `HASAR`, `OLAY YERİ`, `ONARIM`, `DEĞER KAYBI` eksikse oluşturulur; mevcut doğru dizin başarıdır. Kısmi hatada hiçbir klasör silinmez/taşınmaz/yeniden adlandırılmaz; güvenli hata koduyla retry yapılır.
4. Domain traversal/drive/UNC denetimine ek olarak Agent her mevcut/oluşturulan bileşeni `lstat + realpath` ile doğrular; symlink/junction/reparse point ve root dışı çözüm reddedilir. Ham OS hatası, mutlak yol ve agent secret yanıt/audit/log’a taşınmaz.
5. Durum akışı `planned → approved → queued → applying → verifying → ready`; `failed/cancelled/stale` güvenli terminal/ara durumları desteklenir. `ready` yalnız Agent beş alt klasörü fiziksel olarak doğruladıktan sonra oluşur. Case location başka işlemce oluşturulmuş/değişmişse eski job `stale` olur ve sonucu yazmaz.
6. Başarılı sonuçta verified `case_locations` kaydı, append-only location history, provisioning `ready`, job sonucu ve merkezi audit aynı transaction’da kesinleşir. Audit yalnız actor/request/job/agent kimlikleri ile güvenli logical path özetini taşır.
7. Dosya Detayı’ndaki sınırlı panel yalnız API modunda aktif root listesini, plan preview’ını, açık onayı ve durumu gösterir; 401/404/conflict/ağ hatası mock ile maskelenmez. Mock modda fiziksel işlem yoktur.

Etkisi: Migration `0011_case_workspace_provisioning`; workspace contracts/API/DataPort/UI; File Agent provisioning yürütücüsü ve job progress protokolü. Yeni dependency, IPC, upload, move/rename/delete, OCR/AI veya üretim `P:\` işlemi yoktur.

## 2026-07-14 — HB-2026-026: Paket 20 güvenli File Agent taşıma ve yeniden adlandırma altyapısı

Karar:

1. **Tek kuyruk, ayrı saga kaydı:** Fiziksel yürütme mevcut PostgreSQL `jobs` kuyruğunu, Agent kimliği/secret doğrulamasını, lease/heartbeat/retry/dead-letter semantiğini ve merkezi `AuditService`'i kullanır. `case_file_operations` ikinci kuyruk değildir; tekrar eden move/rename işlemlerinin hedef rezervasyonunu, beklenen location snapshot'ını, manifest özetini ve recovery/cleanup durumunu tutan saga kaydıdır. Paket 19'un tek-seferlik create-only provisioning kaydı bu yaşam döngüsünü güvenle temsil etmediği için kopyalanmamış, ayrı operasyon kimliği kullanılmıştır.
2. **Kritik işlem sınırı:** Plan ve preview yalnız metadata/rezervasyon üretir, filesystem'e dokunmaz. Zorunlu `Idempotency-Key`, açık onay ve güncel doğrulanmış `case_locations` sürümü olmadan job oluşmaz. Aynı vaka için tek aktif operasyon, aynı mantıksal hedef için tek rezervasyon ve case-insensitive hedef tekliği DB kısıtlarıyla zorlanır. Overwrite veya mevcut hedefle merge yoktur.
3. **Same-volume stratejisi:** Aynı root/filesystem için atomik `rename` kullanılır. Yalnız harf biçimi değişen Windows rename, operationId'ye bağlı ve root içinde doğrulanan geçici ad üzerinden iki adımda yürür. Agent kapanması veya DB finalize kesintisinde kaynak yok/hedef doğruysa hedef manifesti yeniden doğrulanır ve server finalize'ı idempotent tamamlar; belirsiz durumda kör geri taşıma yapılmaz.
4. **Cross-volume/EXDEV stratejisi:** Hedef root'ta operation-specific staging oluşturulur; kaynak ağaç streaming SHA-256 + byte size manifestiyle kopyalanır, staging birebir doğrulanır ve atomik olarak nihai hedefe publish edilir. Server hedef özetini, job ownership/lease'i, operation/location sürümünü ve rezervasyonu tekrar doğrulayıp location'ı transaction içinde değiştirir. Kaynak yalnız bu switch sonrası ayrı `cleanup_moved_workspace` işiyle ve hem kaynak hem hedef manifesti eşleşirse silinir.
5. **Recovery durumları:** Location switch tamamlanmış fakat kaynak temizlenmemişse `cleanup_pending` veri kaybı değildir ve güvenli retry yapılır. Kaynak apply/cleanup arasında değişmişse silinmez. Kısmi silme, manifest çelişkisi, operation/job sürüm çelişkisi veya belirsiz filesystem durumu `manual_recovery_required` üretir; otomatik/kör rollback yoktur. Retry yalnız tekrar güvenli aşamalarda yapılır.
6. **Mantıksal yol sınırı:** DB/API/audit/job payload yalnız `storageRootKey + relativePath`, manifest hash'i ve güvenli sayaçlar taşır. Mutlak root yalnız Agent yerel config'indedir. Traversal, drive/UNC/backslash, kontrol/Windows aygıt adları, symlink/junction/reparse point, root escape ve case-insensitive çakışma reddedilir; ham Windows hatası veya secret dışarı taşınmaz.
7. **Paket sınırı:** Son kullanıcı taşıma UI'si, case close/reopen, kapanan ay kuralı, genel delete/quarantine/upload, Electron IPC ve deployment eklenmedi. Paket 21 close/reopen, bu düşük seviyeli plan/approve/status saga API'sini iş kuralı hedefi üretmek için kullanacak; fiziksel yolu istemciden almayacaktır. Gerçek `P:\` üzerinde test yapılmadı; yalnız sentetik geçici root'lar kullanıldı.

Etkisi: Migration `0012_case_file_operations`; file-operation contracts ve tenant-kapsamlı plan/read/approve/cancel API'leri; mevcut Agent job protokolünde apply/cleanup sonuç özeti; File Agent atomic rename, staged-copy, manifest, cleanup ve recovery yürütücüsü. Yeni dependency, ikinci queue/audit, UI, IPC veya üretim migration yoktur.

## 2026-07-14 — HB-2026-027: Paket 21 güvenli case close/reopen yaşam döngüsü

1. **Kilitli lifecycle:** Case lifecycle yalnız `open | closed` değerlerini taşır; workflow stage ayrı kalır. Closed lifecycle yalnız `closed` stage ile, open lifecycle yalnız açık stage'lerle geçerlidir. Reopen yeni case üretmez; `caseId` ve ofis dosya numarası korunur.
2. **Kapanış kontrolü:** Paket 15 `2026.07.14.1` belge değerlendirmesine kapanışa özel `2026.07.14.1` katmanı eklenir. Ekspertiz raporu, ön rapor ve onarım görselleri temel; servis atanmışsa fatura, servis merkezi `yetkili` ise ayrıca Teslim İbra ve Temlik ile Taahhütname değerlendirilir. Yalnız fiziksel doğrulaması tamamlanmış `ready` metadata present sayılır; pending/failed `control_required` olur. Mevcut model anlaşmalı servis niteliğini ayrı taşımadığından bu koşul otomatik varsayılmaz.
3. **Normal / eksiklerle kapatma:** Normal kapanış missing veya control_required kapanış gereksiniminde blocked olur. `with_missing_requirements` yalnız açık kullanıcı seçimi ve zorunlu gerekçeyle ilerler; server'ın ürettiği requirement snapshot, actor ve zaman append-only geçmiş/audit içinde saklanır.
4. **Kapalı yol ve saga:** Hedef server tarafından mevcut doğrulanmış açık konum ve `notificationDate` ile `YYYY/Ay YYYY/KAPALI AY YYYY/workspace` biçiminde üretilir. İstemci serbest veya mutlak yol gönderemez. Plan/preview filesystem ve lifecycle'ı değiştirmez; approve mevcut Paket 20 file-operation/job queue katmanını kullanır.
5. **Kesinleştirme ve recovery:** Fiziksel hedef doğrulanmadan lifecycle closed/open olmaz. Location switch ile lifecycle/workflow/history/audit aynı merkezi transaction'da kesinleşir. Doğrulanmış hedef ve location switch sonrası kaynak temizliği bekliyorsa `cleanup_pending` görünür uyarıdır; filesystem/DB durumu belirsizse `manual_recovery_required` başarı sayılmaz ve kör rollback yapılmaz.
6. **Reopen:** Reopen yalnız closed case üzerinde, zorunlu gerekçe ve izin verilen açık workflow stage ile planlanır. Hedef son append-only kapanış kaydındaki doğrulanmış açık konumdur; çakışmada overwrite/merge veya sessiz alternatif yoktur.
7. **Yetki ve sınır:** Yalnız `admin`, `expert` ve `case_manager` close/reopen komutu verebilir; okuma tenant kapsamlı oturumla yapılır. Yeni dependency, IPC, ikinci queue/audit veya genel move/delete API eklenmedi. Üretim migration ve gerçek `P:\` testi yapılmadı; yalnız test DB ve sentetik geçici root kullanılır.

Etkisi: Migration `0013_case_close_reopen_lifecycle`; domain/contracts/API lifecycle plan/approve/read/cancel akışı; mevcut Paket 20 Agent finalize işlemine atomik lifecycle kesinleştirmesi; case detayında gerçek preview/onay/recovery UI'si ve append-only kapanış geçmişi.

## 2026-07-14 — HB-2026-028: Servis profili ve sigorta şirketine özel anlaşma ayrımı

1. `service_centers.service_type`, servisin temel niteliğini `authorized | private | glass | mobile | other` olarak taşır. `authorized` yalnız servis profilidir; hiçbir sigorta şirketiyle anlaşma sonucunu kendiliğinden üretmez.
2. Sigorta şirketine özel ilişki `insurer_service_agreements` içinde tenant, servis, sigortacı, yürürlük tarihleri, durum, desteklenen işlem kodları, kaynak referansı, insan onayı ve optimistic `version` ile tutulur. Aynı servis farklı sigortacılarda farklı sonuç verebilir.
3. Deterministik değerlendirme `2026.07.14.1` sürümündedir; sigortacı, `lossDate` veya ileride `policyDate`, işlem kodu ve kontrollü agreement facts dışarıdan verilir. İnsan onaylı, aktif, tarihte geçerli ve ilgili işlemi destekleyen kayıt `agreed` olur. Kayıt/tarih/onay belirsizliği `control_required`; açıkça tarih dışı, pasif, sonlandırılmış veya işlem dışı kayıt `not_agreed` olur.
4. Backward-compatible migration mevcut `yetkili/özel` profilleri `authorized/private` olarak taşır fakat hiçbir eski servis için sessiz anlaşma satırı üretmez. Legacy `center_type` expand/migrate uyumluluğu için geçici olarak korunur ve yeni profil alanıyla DB constraint üzerinden tutarlı tutulur.
5. Kapanış kuralı `2026.07.14.2` sürümüne çıkarılmıştır. Teslim İbra ve Temlik ile Taahhütname, servis yetkiliyse veya ilgili sigortacı/tarihte anlaşmalıysa uygulanır. Yetkili servis anlaşmalı diye etiketlenmez; özel serviste ilişki belirsizse bu evraklar otomatik `not_applicable` değil `control_required` olur.
6. Case read/create/update ve referans cevapları güvenli servis profili ile anlaşma değerlendirme özetini taşır. Create/update audit'i yalnız tür, sonuç, kural sürümü ve eşleşen agreement kimliklerini taşır; kaynak metni, kişisel veri veya secret içermez. Agreement yönetim CRUD'u bu pakette yoktur.

Etkisi: Migration `0014_service_agreements`; saf domain uygunluk sınırı; referans query/DTO ve Case DTO zenginleştirmesi; Paket 21 kapanış snapshot'ı; gerçek API form etiketleri. File Agent, IPC, fiziksel dosya yolu, yeni dependency veya üretim migration yoktur.

## 2026-07-14 — HB-2026-029: Kanıtlı Kasko poliçe analiz çekirdeği

1. Analiz şirket formatından bağımsız kanonik alanlarla tutulur; orijinal başlık/metin yalnız 1.000 karakteri aşmayan madde alıntısı, sayfa, bölüm, madde, locator ve SHA-256 kanıtıyla birlikte korunur. Tüm poliçe metni DB/audit/log'a alınmaz.
2. Kaynak referansı yalnız aynı tenant/vakadaki fiziksel olarak `ready`, hash+size doğrulanmış `documentVersion` olabilir. Ana kaynak `casco_policy` ve vaka Kasko olmalıdır; Traffic vaka reddedilir.
3. Analiz sürümleri `draft → … → approved → superseded` akışındadır. Approved ve superseded sürüm ile kanonik maddeleri immutable; düzeltme yeni `analysisVersion` üretir. Bir vaka/poliçe kaynağında yalnız bir aktif approved sürüm bulunur.
4. Poliçe, zeyil, özel/genel şart, ihbar föyü ve kontrollü dış kaynak çelişkileri ayrı kayıttır. Açık çelişki kesin sonuç ve onayı engeller; çözüm aktör/zaman/gerekçeyle ve merkezi audit ile kaydedilir.
5. Senaryo motoru kaynaklı kuralları öncelik ve etkin tarihle deterministik değerlendirir. Genel “muafiyetsiz” kural koşullu muafiyeti silmez; birden çok muafiyet kod bazında korunur. Kaynak/onay eksikliği veya çelişki `unknown/control_required` ve fail-closed operasyon tavsiyesi üretir.
6. Yetkili servis, sigortacıya özel anlaşma ve poliçeye uygun servis ayrı girdilerdir. Paket 22'nin tarihsel agreement sonucu senaryo facts içinde kullanılır; oran/tutar hardcode edilmez.
7. Bu pakette PDF/OCR/LLM, upload, gerçek tedarik durdurma, File Agent, Electron IPC ve üretim migration yoktur. Yalnız sentetik poliçe metadata'sı kullanılır; otomatik çıkarım sonraki, ayrı onaylı pakete bırakılır.

Etkisi: Migration `0015_casco_policy_analysis`; saf domain scenario/version/conflict sınırı; strict contracts ve tenant-kapsamlı API; Kasko vaka detayında salt okunur analiz/senaryo görünümü. Yeni dependency yoktur.

## 2026-07-14 — HB-2026-030: Güvenli Kasko PDF metin çıkarım hattı

1. Yalnız aynı tenant/vakadaki `casco_policy`, `application/pdf`, `ready + hashVerified + sizeVerified + verifiedAt` documentVersion çıkarılabilir. Traffic, pending, doğrulanmamış, farklı tenant ve source hash/size değişimi fail-closed reddedilir.
2. Parser `pdfjs-dist@6.1.200` olarak exact pinlenmiştir. Parser ve `pdf-text-normalization/1.0.0` sürümü her extraction kaydında/cevabında taşınır; documentVersion veya sürüm değişince eski çıktı sessizce değiştirilmez.
3. Parser, Agent’ın oluşturduğu tek kullanımlık temp kopyada, ayrı Node worker içinde 192 MB old-generation sınırı, 30 saniye timeout, sayfa/kaynak/çıktı limitleri ve ağ/shell çağrısı olmayan girişle çalışır. Temp içerik başarı, hata ve timeout sonunda temizlenir; symlink/junction/reparse bileşenleri reddedilir.
4. Raw metin güvenli kontrollerden arındırılarak sayfa bazında; normalize metin NFC ve sürümlü whitespace kuralıyla saklanır. Segmentler deterministik reading-order satırlarıdır; locator offsetleri sıfır tabanlı, half-open Unicode code point’tir.
5. Metin katmanı olmayan sayfa `image_only`, tamamı görselse extraction `ocr_required`, karışık/eksik sayfalar `partial` olur. Bu paket OCR, AI, poliçe yorumu veya otomatik analiz üretmez.
6. Agent sonucu koşulsuz kabul edilmez: lease/ownership, job ve extraction version, kaynak hash/size, chunk sırası, server-side yeniden normalizasyon/segmentasyon ve final manifest hash/sayaçları doğrulanır. Invalid veya stale sonuç metadata’yı kesinleştiremez.
7. Paket 23 source reference, yalnız ready/partial doğrulanmış extraction’ın text sayfasındaki exact bounded range’e bağlanabilir. Sayfa/segment/range FK ve DB trigger ile doğrulanır; tam belge metni audit/log’a yazılmaz.

Etkisi: Migration `0016_policy_pdf_text_extraction`; mevcut PostgreSQL job queue/File Agent genişlemesi; tenant ve RBAC kapsamlı extraction/read/cancel/source-reference API’leri; Kasko belge sekmesinde no-fallback metin/segment görünümü. Yeni dependency yalnız File Agent’ta exact `pdfjs-dist@6.1.200` (Apache-2.0); OCR/AI ve üretim migration kapsam dışıdır.

## 2026-07-15 — HB-2026-031: Tamamen yerel ve kanıtlı poliçe OCR katmanı

1. OCR motoru Node/Windows uyumlu `tesseract.js@7.0.0` (Apache-2.0) seçildi. Türkçe ve İngilizce `@tesseract.js-data/*@1.0.0` asset’leri `tessdata-4.0.0-full/1.0.0` kimliğiyle paketlenir; `tur` 8.063.205 bayt / `1a151a9aee3fe92ab46a3d8ed859273da970e1ac60b469a20cd0144c15ae84c9`, `eng` 10.923.060 bayt / `ed350f3752f81ee8f38769edc14d92d997dababe23b565c59879372cc46a2468` doğrulanmadan worker başlamaz.
2. Runtime model indirme, URL, telemetry, bulut OCR ve AI yasaktır. Asset’ler local package içinden operation-specific temp alana kopyalanır; Tesseract’a yalnız absolute local `langPath` verilir. Eksik/boyut/hash sapması fail-closed olur.
3. Paket 24 PDF raw/normalized katmanı immutable kalır. Paket 25 raw OCR, normalize OCR, blok/satır/kelime, render-pixel box ve sıfır tabanlı half-open Unicode code point locator’ı ayrı append-only sürümde tutar.
4. Identity documentVersion, extraction, sayfalar, source hash, dil seti, exact engine/language-data, render, preprocessing, normalization ve locator sürümüne bağlıdır. Aynı identity DB unique index ve idempotency ile tek sonuçtur; kalite retry’sı yalnız farklı `high_quality` render identity’si üretir.
5. `ready` teknik tamamlanmadır, onay veya poliçe yorumu değildir. `policy-ocr-quality/1.0.0` eşikleri ortalama güven, düşük güvenli kelime, okunamayan bölge, metin bütünlüğü ve okuma sırasını birlikte değerlendirir. Belirsizlik `low_confidence/control_required` ve insan kontrolüdür.
6. Tek sütun okuma sırası geometriyle deterministik; yan yana sütun adayı `ambiguous` olur. PDF ve OCR katmanları concatenate edilmez: aynı içerik `pdf_text_only`, ayrık içerik `combined_non_overlapping`, örtüşen farklı içerik `conflict_detected` olur.
7. Mevcut queue, Agent auth/lease/heartbeat/retry/dead-letter, safe path resolver ve AuditService kullanılır. API/server OCR çalıştırmaz; server Agent chunk’ını lease/version/hash/geometry/range/count ile yeniden doğrular.
8. Audit tam OCR metni, excerpt, görüntü/PDF binary, filename/path/root/temp path, model binary, secret, stdout/stderr, stack veya ham OS hatası taşımaz. Paket 26 yalnız doğrulanmış PDF/OCR locator’larını kullanabilir; OCR metni kendi başına onaylı analiz kaynağı değildir.

Etkisi: Migration `0017_policy_ocr_pipeline`; exact pinli beş File Agent dependency’si; saf OCR domain/strict contracts; tenant/RBAC/idempotency API; Kasko detayında no-fallback yerel OCR görünümü. Electron IPC, üretim migration, gerçek `P:\`, müşteri belgesi ve sonraki paket kapsam dışıdır.

## 2026-07-15 — HB-2026-032: Kanıtlı AI orchestration ve aday doğrulama sınırı

1. AI orchestration API servisinin sahip olduğu, süre ve boyut sınırları olan bir provider adapter arkasındadır. File Agent, job protokolü, root mapping, filesystem ve secret bu akışta kullanılmaz. Varsayılan registry boştur; yalnız testte enjekte edilen deterministik provider’lar vardır. HTTP/AI SDK/cloud provider eklenmez.
2. Provider’a yalnız aynı tenant/Kasko vaka içindeki doğrulanmış Paket 24 PDF segmentleri ve Paket 25 OCR satırları gönderilir. Server bunları stabil `sourceAnchorId` ile immutable, sıralı ve sürümlü source bundle’a bağlar. Provider sayfa, excerpt, hash veya locator üretse bile kanıt sayılmaz; gerçek kaynak server tarafından anchor üzerinden çözülür.
3. Poliçe metni güvenilmeyen veridir. Sistem extraction contract’ı, strict output schema ve source bundle ayrı request alanlarıdır. Belgedeki talimat, URL veya tool çağırma metni yalnız warning üretir; kaynak değiştirilmez ve hiçbir araç/ağ çağrısı doğurmaz.
4. Provider çıktısı strict schema, unknown alan, finite number, liste/string sınırı, candidate kimliği, anchor üyeliği ve kullanım sayaçları yönünden doğrulanır. Server ayrıca original/numeric/date değerlerini kaynakta arar; düşük OCR kalitesi provider confidence ile yükseltilemez. Geçersiz çıktı veya kanıt fail-closed `failed/rejected_evidence/control_required` olur.
5. Organization policy varsayılan `enabled=false`, monthly hard stop açıktır. Bütçe minor integer ile hesaplanır. Disabled veya budget blocked durumda provider çağrılmaz, fallback yapılmaz; append-only usage ledger yalnız güvenli sayaç ve kod taşır.
6. Exact run identity ve zorunlu `Idempotency-Key` ikinci run/provider çağrısını engeller. Kaynak değişimi eski bundle/run’ı değiştirmez ve stale/superseded sınırında kalır. Candidate çatışmaları sessiz çözülmez; yalnız conflict proposal saklanır.
7. Bu pakette accept/edit/reject, Paket 23 promotion/approval, gerçek provider, PII payload politikası veya operasyonel otomasyon yoktur. Human review/promotion Paket 27’ye; gerçek provider ve PII güvenliği Paket 28’e bırakılır.

## 2026-07-15 — HB-2026-033: AI adayı insan incelemesi ve Paket 23 taslak promotion sınırı

1. Provider candidate gerçekleri immutable kalır. Kullanıcı kararı `accepted | edited | rejected | control_required` olarak yeni, append-only bir review sürümü üretir; eski karar değiştirilmez veya silinmez.
2. Kabul, provider’ın kanıt durumunu yükseltmez. Düzenlenen değer, koşul ve istisnalar aynı source-anchor kümesi üzerinde server tarafından yeniden doğrulanır; kanıtı bulunmayan değişiklik kabul edilmez.
3. Promotion önizlemesi bütün adayların güncel insan kararını, deterministik review-set hash’ini, hedef analiz optimistic version’ını ve engel/uyarıları taşır. Bekleyen aday varken veya kabul edilebilir aday yokken promotion yapılmaz.
4. Yalnız `accepted` ve `edited` adaylar Paket 23 içinde yeni bir analiz sürümüne taşınır. Sonuç `draft`, `control_required` veya `conflict_detected` durumunda ve insan onayı `pending` olarak oluşturulur; hiçbir AI adayı otomatik onaylı poliçe kuralı veya operasyonel karar olmaz.
5. Promotion sourceAnchor, document/documentVersion, sayfa, bounded excerpt, provider kimliği ve review provenance’ını korur. Reddedilen ve kontrol gereken adaylar promotion dışı kalır fakat karar geçmişleri saklanır.
6. İki taşınan aday arasındaki conflict sessizce çözülmez; hem promotion provenance’ında hem Paket 23 conflict kaydında korunur. Paket 23 onay kuralları açık conflict’i fail-closed tutmaya devam eder.
7. Review ve promotion idempotency, tenant/RBAC, optimistic locking, merkezi transaction ve AuditService sınırındadır. Audit tam provider çıktısı, poliçe/OCR metni, uzun excerpt, kişisel veri, secret veya mutlak yol taşımaz.
8. Gerçek provider, provider secret’ı ve PII payload politikası hâlâ Paket 28 kapsamıdır. File Agent, job protokolü, filesystem ve dependency bu kararla değişmez.

Etkisi: Migration `0018_policy_ai_orchestration`; saf source-bundle/evidence/conflict domain’i; strict contracts; tenant/RBAC/idempotency/audit API’si ve Kasko detayında salt-okunur “AI Alan Adayları” paneli. Yeni dependency, IPC, File Agent değişikliği veya fiziksel veri yazma yolu yoktur.

## 2026-07-15 — HB-2026-034: Gerçek AI sağlayıcısı, PII ve secret güvenlik sınırı

1. İlk gerçek adapter `openai-responses/1.0.0` kimliğiyle provider-neutral API-owned orchestration katmanına eklenir. Yeni worker, File Agent işi, AI SDK veya genel amaçlı dış ağ katmanı oluşturulmaz.
2. Provider secret yalnız API process environment’ında bulunur. Eksik veya kısmi config fail-closed’tur; secret DB/API/audit/log/UI’ya yazılmaz ve istemciye gönderilmez.
3. Dış payload yalnız seçilmiş source-anchor metinlerinden oluşur. Server `policy-ai-pii-redaction/1.0.0` ile PII adaylarını kararlı placeholder’lara çevirir ve immutable payload hash/sayaç özeti tutar; PDF/görüntü binary’si, File Agent/root, mutlak yol, session ve tüm case/document dump’ı gönderilmez.
4. Responses isteği strict JSON Schema, `store:false`, tools kapalı, bounded input/output, timeout/cancellation ve client request digest kullanır. Provider’ın sayfa/excerpt/hash/locator beyanı kanıt değildir; anchor ve original/numeric/date kanıtı server tarafından yeniden doğrulanır.
5. Organization AI policy varsayılan kapalıdır. Provider allow-list, per-request ve monthly hard stop çağrıdan önce uygulanır; fiyatlar deploy edilen model için integer minor-unit/milyon-token config’i ve sürümüyle hesaplanır. Gerçek token kullanımının maliyeti append-only ledger’a yazılır, otomatik provider fallback yapılmaz.
6. `store:false` yalnız provider uygulama-state saklamasını kapatır; sıfır veri saklama garantisi sayılmaz. Gerçek pilot, organization onayı yanında sağlayıcıdaki Zero Data Retention/Modified Abuse Monitoring uygunluğunun deployment aşamasında ayrıca doğrulanmasını gerektirir.
7. Gerçek provider çıktısı da Paket 27 insan review’undan geçer; yalnız accepted/kanıtlı edited adaylar Paket 23’te yeni pending taslak sürüme taşınabilir. Otomatik approval veya operasyonel karar yoktur.
8. Yerel geliştirme ortamında gerçek provider secret’ı bulunmadığı için ücretli çağrı yapılmaz. Sentetik local wire test cloud extraction kalitesini veya dış retention yapılandırmasını kanıtlamaz.

Etkisi: Migration `0020_real_policy_ai_provider`; PII redaction domain’i, OpenAI Responses adapter’ı, privacy/usage contracts, güvenli API composition ve Kasko AI panelinde dış-payload özeti. Dependency, IPC, File Agent ve fiziksel veri yazma yolu değişmez.

## 2026-07-15 — HB-2026-035: Gerçek Gemini ücretsiz-katman pilotu ve provider-call recovery sınırı

1. Ücretli dış çağrı PostgreSQL transaction'ı açıkken yapılmaz. Çağrı kimliği, bütçe rezervasyonu ve güvenli request hash önce durable `ai_provider_call_receipts` kaydına commit edilir; provider bundan sonra çağrılır.
2. Alınmış ve strict doğrulanmış canonical yanıt, aday/usage finalize işleminden ayrı transaction'da receipt'e yazılır. Finalize transaction'ı kesilirse aynı receipt tekrar okunur ve ikinci provider çağrısı yapılmadan idempotent tamamlanır.
3. Network/timeout veya yanıtın alınıp alınmadığı bilinmeyen kesinti otomatik retry edilmez. Receipt `outcome_unknown`, run `AI_PROVIDER_OUTCOME_UNKNOWN` olur ve tahmini maliyet aylık hard-stop hesabında rezerve kalır. `X-Client-Request-Id` tanılama kimliğidir; provider idempotency garantisi sayılmaz.
4. Receipt yalnız provider/model/pricing kimliği, request/output hash'i, safe response/request kimlikleri, token/karakter/maliyet sayaçları ve kanonik doğrulanmış aday JSON'unu taşır. Full prompt, ham provider response, source text, PII, secret veya mutlak yol taşımaz; terminal kayıt immutable'dır.
5. Pilot kalite sürümü `policy-ai-pilot-quality/1.0.0` alan recall/precision, exact source-anchor ve bounded originalValue kanıt doğruluğunu integer basis-point ile ölçer. Yinelenen aday ikinci doğru eşleşme sayılmaz.
6. 2026-07-15 resmi model ve fiyatlandırma bilgisine göre ücretsiz katmanda structured output destekleyen en güçlü uygun stable model `gemini-3.5-flash` birincil modeldir. Bütün GenerateContent modelleri aynı structured-output wire contract'ını, `generationConfig.{responseMimeType,responseJsonSchema}`, kullanır; hatalı `responseFormat` ve model-bazlı payload ayrımı yoktur. Birincil model HTTP 503 döndürürse yalnız `provider_unavailable` sonucu için 500 ms ve 1500 ms beklemeli iki bounded retry yapılır; toplam üç deneme de 503 olursa sentetik pilot bir kez stable ücretsiz `gemini-2.5-flash` modeline geçebilir. Auth, kota, request, schema veya evidence hatasında fallback yoktur. Her iki egress de official `generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` sınırındadır.
7. 503 retry'ları aynı durable provider receipt/request kimliği altında çalışır. Yanıtın alındığı kesin olduğu için tükenme `AI_PROVIDER_UNAVAILABLE` olarak finalized olur; network/timeout sonucu belirsizliği gibi `outcome_unknown` sayılmaz. Backoff sırasında cancellation ve bütün primary/fallback zinciri için ortak bounded timeout korunur.
8. 4xx teşhisi yalnız HTTP kodu, kanonik provider status kodu, sabit neden sınıfı ve izinli alan sınıfından oluşur. Provider `message`/`description`, ham response body, payload veya secret DB/audit/log'a yazılmaz; kullanıcı verisinden serbest diagnostic token üretilmez. Güvenli teşhis yalnız adapter testi ve yerel sentetik pilot stderr'inde görünür.
9. Gemini ücretsiz katmanında gönderilen içerik sağlayıcının ürünlerini geliştirmek için kullanılabilir. Bu nedenle pilot sentetik veriyle sınırlıdır; gerçek müşteri verisi Gemini ücretsiz katmanına gönderilemez. Gerçek çağrı, secret bulunmayan ortamda yapılmaz ve paket PASS/commit sayılmaz.
10. Gemini provider şeması yalnız düz object/array/string/number alanları ile `properties`, `required` ve `items` taşır; recursive `anyOf`, schema-valued `additionalProperties`, enum ve provider-side bounds kullanılmaz. Değişken kanonik değer `normalizedValueJson` olarak gelir, adapter bellekte parse eder ve ancak mevcut strict Zod + bounded normalized-value + evidence doğrulamasından geçerse kanonik aday olur. Provider şeması son güven otoritesi değildir.
11. Sade wire schema nedeniyle provider'a görünmeyen server-owned output sözleşmesi system instruction içinde ayrı trusted JSON olarak verilir: exact schema version, maximum candidate, izinli category listesi ve candidate/canonical alan/anchor/confidence biçimleri. Bu bir doğrulama ikamesi değildir; strict runtime Zod ile evidence üyeliği fail-closed kalır. Canonical uyuşmazlık tanısı yalnız allowlist alan yolu ve sabit issue sınıfıdır; ham model değeri veya Zod mesajı değildir.
11. Canlı sentetik pilotun başarılı yolu yalnız tek üretim `provider_wire` probe'u ve gerçek extraction çağrısından oluşur. Wire probe 4xx ile reddedilirse extraction yapılmadan minimal nesne, envelope, scalar candidate ve wire aşamalarıyla dört bounded tanı çağrısı çalışır. Enum/numeric/array/legacy constraint probe'ları yalnız deterministik test/tanı kapsamındadır; normal canlı deadline'ı tüketmez. Timeout güvenli tanısı `provider_wire`, `backoff` veya `extraction` aşamasını belirtir; ham Google hata/timeout metni veya schema payload'ı kalıcılaştırılmaz.
12. GenerateContent REST cevabı tek text part varsayımıyla ayrıştırılmaz. Thought-summary işaretli part JSON çıktısına katılmaz; yalnız thought-signature metadata taşıyan boş part kabul edilir; kalan text part'ları sıralı ve bounded birleştirilir. Preflight 4096 output token kullanır. `MAX_TOKENS`, candidate/content/parts ve output JSON bozukluğu ayrı sabit safe code üretir; ham response veya thought signature saklanmaz.

Etkisi: Migration `0021_policy_ai_provider_recovery`; Gemini provider/retention enum genişlemesi; provider çağrısını DB transaction dışına alan durable receipt/recovery akışı; sentetik pilot kalite ölçümü ve fail-fast gerçek Gemini pilot komutu. Paket 28 OpenAI production adapter'ı değişmeden kalır. Yeni runtime dependency, IPC, File Agent veya fiziksel veri yazma yolu yoktur.

## 2026-07-16 — HB-2026-036: Dosya detayında kullanıcı kontrollü poliçe analiz akışı

1. Paket 24–29 yetenekleri yeni bir AI veya analiz motoru kurmadan, Kasko dosyasının mevcut `Evrak ve Fotoğraf` çalışma alanında tek bir yönlendirilmiş akış olarak birleştirilir.
2. Kullanıcı server tarafından keşfedilen doğrulanmış PDF/OCR parçalarından kullanılacak kaynakları açıkça seçer. Seçilmemiş kaynak plan isteğine girmez; boş seçimle plan başlatılamaz.
3. Plan ve dış sağlayıcı çağrısı ayrı kullanıcı eylemleridir. Dış gönderim, mevcut PII/retention/bütçe özeti ve case+bundle kimliğine bağlı açık onay olmadan başlatılmaz.
4. Candidate kanıt görünümü yalnız server çözümlü sourceAnchor, belge/documentVersion kimliği, extraction kimliği, sayfa, bounded excerpt, kalite/warning ve hash özetini gösterir. Mutlak yol, binary, secret, ham provider çıktısı veya tam poliçe metni gösterilmez.
5. Accept/edit/reject/control kararları ve promotion semantiği Paket 27 ile aynıdır. Yalnız accepted/edited adaylar açık onayla Paket 23 içinde yeni pending taslak sürüme uygulanır; bu işlem nihai analiz approval değildir.
6. Promotion transaction'ı başarıyla tamamlanınca dosya detayındaki Paket 23 analiz görünümü otomatik yenilenir. Kullanıcı aynı ekranda yeni analiz sürümünü, insan onay durumunu ve sayfa/bölüm/madde kanıtını görür; sayfa yenilemesi veya mock fallback gerekmez.
7. UI adımları kaynak seçimi → plan/start → insan incelemesi → taslağa uygulama olarak görünürdür. API/DB/contracts/audit semantiği değişmez; yeni migration, endpoint, dependency, File Agent işi, IPC veya fiziksel veri yazma yolu eklenmez.

## 2026-07-16 — HB-2026-037: Gemini production/deployment etkinleştirme kapısı

1. Gemini adapter’ının API runtime’a kaydı yalnız `GEMINI_POLICY_PROVIDER_ENABLED=true` açık opt-in’i ile yapılır. Bayrak yoksa veya `false` ise Gemini registry’ye girmez; API ve bütün çekirdek case/document/policy-analysis read akışları normal çalışır.
2. `GEMINI_API_KEY` yalnız API process environment’ından okunur. Anahtar biçimi regex ile tahmin edilmez; yalnız trim, boş olmama ve 4096 karakter güvenli üst sınırı uygulanır. Secret DB, contract, response, UI, audit veya log’a taşınmaz.
3. Deployment model seçimi açık ve allow-list tabanlıdır: `gemini-3.5-flash` veya `gemini-2.5-flash`. Production composition otomatik model/provider fallback yapmaz; Paket 29’daki 503 fallback yalnız sentetik pilot runner davranışıdır.
4. Provider’ın sunucuda kayıtlı olması ile organization AI policy’sinin açık/allow-list’te olması ayrı kapılardır. Çağrı hazırlığı yalnız `configured && organizationEnabled && providerAllowed` olduğunda true olur; per-request/monthly bütçe ve kullanıcı onayı sonraki mevcut kapılar olarak korunur.
5. Oturum gerektiren salt-okunur `GET /api/v1/ai/providers`, yalnız güvenli provider/model/version/retention/limit ve organization policy/bütçe özetini döndürür. Secret veya config ham değeri dönmez; salt-okunur durum sorgusu audit gürültüsü üretmez.
6. UI, Gemini/OpenAI deployment ve organization kullanılabilirliğini ayrı rozetlerle gösterir. Provider kapalı veya yapılandırılmamışsa mock fallback yapmaz; çekirdek uygulamanın çalışmaya devam ettiğini açıkça belirtir.
7. Gemini ücretsiz katmanının `free_tier_product_improvement` retention bilgisi görünür kalır. Bu deployment kapısı gerçek müşteri verisi gönderimine onay vermez; hukuki/retention/egress ve secret rotation onayı ayrıca gereklidir.

Etkisi: API composition/config, salt-okunur provider availability contract/endpoint ve Kasko AI paneli güncellendi. Migration, dependency, IPC, File Agent veya fiziksel veri yazma yolu değişmedi.

## 2026-07-16 — HB-2026-038: 01.07.2026 Trafik değer kaybı piyasa farkı ve insan onayı sınırı

1. 12.06.2026 tarihli 33278 sayılı Resmî Gazete değişikliğinin Madde 2, 6 ve 8 hükümleri esas alınır: 01.07.2026’da eski Ek-1 katsayı formülü kaldırılmıştır; değer kaybı kaza öncesi ve onarım sonrası ikinci el satış değeri farkı üzerinden eksperce belirlenir.
2. SEDDK 2026/11 Madde 4 ve Ek-1.1; geçmiş hasar, hasarlı/parça işlemleri, piyasa araştırması, araç özellikleri, kilometre/kullanım, kusur ve değer kaybı özetinin kanıt şablonudur.
3. İlk kural seti `traffic-value-loss-market-difference`, sürüm `2026.07.01.1`, yürürlük `2026-07-01` olarak sabitlenir. 01.07.2026 öncesi hasar bu sürümle kesinleştirilmez.
4. Brüt taslak `max(0, kaza öncesi değer - onarım sonrası değer)`, kusur uygulanmış taslak safe integer minor-unit ve `half_up_minor_unit` yuvarlama sürümüyle hesaplanır. Eski `%19`, hasar boyutu ve kilometre katsayısı kullanılmaz.
5. Son 30 gün, her iki değer tarafında en az üç emsal ve ±%10 kilometre kontrolü yasal formül değil, sürümlü ofis kanıt yeterliliği politikasıdır. Eksiklik `control_required` üretir.
6. Yalnız aynı tenant/case içindeki fiziksel olarak doğrulanmış documentVersion ve kontrollü market/SBM/eksper referansı kanıt olabilir. Kaynak çelişkisi sessiz çözülmez.
7. Taslak, `not_applicable` ve `no_value_loss` dahil bütün sonuçlar insan onayı gerektirir. `case_manager|expert|admin` taslak/submit; yalnız `expert|admin` approve/reject yapabilir.
8. Kanıt, emsal ve approval event geçmişi append-only; approved/superseded sürüm immutable’dır. Düzeltme yeni version üretir.

Etkisi: Migration `0022_traffic_value_loss_core`; saf domain evaluator; strict contracts/JSON Schema; tenant/RBAC/idempotency/audit API. UI, AI, web scraping, SBM entegrasyonu, File Agent ve yeni dependency yoktur.

## 2026-07-16 — HB-2026-039: Trafik değer kaybı kullanıcı çalışma alanı ve kanıt seçimi

1. Dosya Detayı > Değer Kaybı sekmesi gerçek API modunda Paket 32’nin mevcut read/version/submit/approve/reject uçlarını `TrafficValueLossDataPort` üzerinden kullanır. Yeni endpoint, migration, background iş veya paralel iş kuralı oluşturulmaz.
2. Kullanıcı formu araç, kusur, hasarlı parça, önceki hasar ve piyasa değerlerini taslak girdi olarak toplar. Her hesaplama mevcut sürümü değiştirmek yerine yeni immutable assessment version üretir; önceki sürümler aynı çalışma alanındaki geçmişte kalır.
3. Yalnız `ready + hashVerified + sizeVerified + verifiedAt` documentVersion kanıt seçimine açılır. Belge seçmek tek başına hiçbir alanı doğrulanmış saymaz; kullanıcı belgeyle desteklenen kanıt alanlarını tek tek işaretler. Adapter gerçek `contentHash` değerini yalnız API komut kanıtına taşır; hash, mutlak yol ve belge içeriği kullanıcıya gösterilmez.
4. Piyasa emsalleri kaza öncesi/onarım sonrası taraf, minor-unit tutar, kilometre, LocalDate, güvenli `https://` veya `ref:` kaynak ve kullanıcı doğrulama/çelişki bayrağıyla girilir. Kullanıcı gözlemi `control_required` kalır; doğrulanmış documentVersion yerine geçmez.
5. Belirsizlikler ve `canSubmitForApproval` sonucu server cevabından gösterilir. Bloklayan belirsizlik varken submit kapalıdır. Submit açık teyit ister; approve/reject yalnız mevcut rol sınırı içinde ve ayrı insan inceleme teyidi/gerekçesiyle yürür.
6. API hatasında mock fallback yoktur. Mock moddaki kabul edilmiş Değer Kaybı prototipi aynen korunur. Paket 33 yalnız Trafik vakayı gerçek çekirdeğe bağlar; Kasko için sahte hesaplama üretilmez ve destek dışı sınır açık gösterilir.
7. UI dense masaüstü düzenini, görünür iç scroll alanlarını, açık/koyu temayı ve 1366×768 ile 1920×1080 taşma sınırını korur. File Agent, IPC, fiziksel dosya erişimi, ilan scraping, SBM entegrasyonu, AI tahmini, rapor/PDF ve yeni dependency yoktur.

Etkisi: Trafik Değer Kaybı UI DataPort/adapter/hook’u; gerçek dosya detayında kanıt/emsal girişi, taslak, belirsizlik, geçmiş, submit ve insan onayı çalışma alanı. Paket 32 domain/API kural sürümü `2026.07.01.1` değişmez.

## 2026-07-16 — HB-2026-040: Onaylı Trafik değer kaybı nihai rapor snapshot ve PDF sınırı

1. Nihai rapor yalnız `humanApprovalStatus=approved` olan `approved | superseded` Trafik değer kaybı sürümünden üretilebilir. Draft, control-required, onay bekleyen veya reddedilmiş sürüm raporlanamaz.
2. Önizleme salt okunurdur; report veya audit kaydı yazmaz. Kullanıcı önizlemede kaynakları, emsalleri, hesaplamayı, belirsizlikleri, insan onayını ve `2026.07.01.1` kural sürümünü görmeden nihai çıktı oluşturamaz.
3. Önizleme içeriği deterministik canonical snapshot ve SHA-256 digest ile bağlanır. Nihai komut `expectedAssessmentVersion`, açık `confirmed=true`, önizleme digest’i ve zorunlu `Idempotency-Key` taşır; stale veya değişmiş önizleme 409 olur.
4. Her onaylı assessment version için en fazla bir immutable nihai rapor vardır. Düzeltme gerekiyorsa eski rapor veya approved version değiştirilmez; yeni hesap version’ı, insan onayı ve yeni rapor gerekir.
5. Migration 0023 yalnız logical snapshot, content/PDF digest’i, byte sayısı, şema/şablon/kural sürümü ve üretim actor/zamanını saklar. Mutlak path, müşteri belge binary’si, File Agent root’u veya secret saklanmaz.
6. PDF API service içinde, exact `@napi-rs/canvas@1.0.2` ve `pdfjs-dist@6.1.200` Liberation Sans fontlarıyla bellekte deterministik üretilir. File Agent, fiziksel case klasörü, IPC veya otomatik dosya yazma kullanılmaz.
7. PDF indirme endpoint’i snapshot’tan çıktıyı yeniden üretip saklanan byte size ve SHA-256 ile doğrular; uyumsuzluk başarı olarak sunulmaz.
8. Yalnız `traffic_value_loss.report_generated` merkezi audit olayı yazılır. Audit rapor metni, plaka, ilan URL’si, belge adı/içeriği, mutlak yol veya PDF binary’si değil; version ve güvenli sayaçları taşır.

Etkisi: Migration `0023_traffic_value_loss_reports`; saf rapor-content builder; strict preview/generate/read/PDF contracts; API-owned PDF renderer ve Dosya Detayı > Değer Kaybı kullanıcı kontrollü final çıktı paneli.

## 2026-07-16 — HB-2026-041: Frontend lazy-loading ve ölçülebilir başlangıç bundle bütçesi

1. Uygulama kabuğu, login, durum panosu ve dosya listesi başlangıç akışında eager kalır. Ağır Dosya Detayı route’u `React.lazy` ile ayrı chunk’tır.
2. Dosya Detayı içindeki gerçek API ağırlıklı Evrak/Fotoğraf, PDF metin, OCR, poliçe analiz çalışma alanı ve Trafik değer kaybı modülleri yalnız ilgili sekme açıldığında dinamik import edilir. Mock/demo görünümü fiziksel veya API işi başlatmadan mevcut davranışını korur.
3. Route seviyesinde mevcut `Suspense` ve uygulama `ErrorBoundary` sınırı korunur. Sekme düzeyi `Suspense`, modül gelene kadar güvenli Türkçe loading görünümü sunar; import reddi fatal hata sınırına gider ve boş çalışma alanı üretmez.
4. Production build başlangıç JS grafiği `dist/index.html` içindeki doğrudan script ve modulepreload referanslarından deterministik hesaplanır. Başlangıç grafiği ve her tekil JS chunk Vite uyarı sınırı olan 500.000 baytı aşarsa build fail-closed olur.
5. Build kapısı ayrıca altı beklenen lazy chunk’ın ayrı üretildiğini ve başlangıç preload grafiğine girmediğini doğrular. Böylece gelecekteki statik import regresyonu yalnız Vite uyarısı olarak kalmaz.
6. Paket 34 tabanındaki 591,47 kB giriş bundle’ı 281.355 bayt giriş chunk’ına, toplam başlangıç JS grafiği 420.291 bayta düşmüştür. Ağır modüller kullanıcı akışıyla on-demand yüklenir.

Etkisi: Yalnız frontend import/bundle sınırı, build script’i ve hata-sınırı regresyon testi değişti. Yeni dependency, backend/API, migration, contract, IPC, File Agent veya veri yazma yolu yoktur.

## 2026-07-16 — HB-2026-042: Durum Panosu salt-okunur snapshot ve sürümlü öncelik sırası

1. Durum Panosu organization kapsamlı, oturum gerektiren tek bir `GET /api/v1/dashboard` snapshot’ı kullanır. UI’ın vaka başına ayrı evrak/onay/operasyon sorguları yapması veya istemcide iş önceliği uydurması kabul edilmez.
2. Öncelik sırası `dashboard-priority/1.0.0` ile sürümlüdür: manuel kurtarma, operasyon hatası, operasyon blokajı, geciken takip, bekleyen insan onayı, eksik evrak, kontrol gereken evrak, bugün takip, sorumlu atanmamış ve yedi gün içindeki yaklaşan takip. Skor yalnız deterministik sıralama içindir; sonuç ayrıca açık sinyal kodlarını taşır.
3. Evrak sayıları yalnız Paket 15 motoru ve güncel documentVersion metadata’sından hesaplanır. Fiziksel doğrulaması tamamlanmamış `pending/failed` belge `present` sayılmaz; `control_required` olarak panoya yansır.
4. İnsan onayı sinyali mevcut lifecycle approval, Kasko poliçe analizi approval, incelenmemiş AI adayı ve Trafik değer kaybı approval kayıtlarından gelir. Operasyon sinyali mevcut workspace provisioning, file-operation ve lifecycle recovery durumlarından gelir; ikinci bir queue veya durum modeli kurulmaz.
5. Endpoint salt okunurdur; snapshot veya audit olayı yazmaz. Her pano yenilemesinde audit gürültüsü üretilmez. Tenant filtreleri bütün alt sorgularda server tarafında uygulanır.
6. API response yalnız logical vaka ve güvenli metadata özetlerini taşır. Mutlak yol, belge içeriği, raw excerpt, secret veya ham hata bulunmaz. Runtime contract strict’tir; UI bilinmeyen response alanlarında fail-closed davranır.
7. API modunda ağ/5xx/bozuk response mock veriye düşmez. Mock mod, kabul edilmiş prototip kayıtlarını ağ çağrısı yapmadan korur. Kart tıklaması ve Enter doğrudan gerçek dosya detayına gider.

Etkisi: Saf dashboard öncelik domain’i, strict contracts/JSON Schema, salt-okunur API agregasyonu ve gerçek API bağlı Durum Panosu UI’ı eklendi. Migration, dependency, IPC, File Agent veya veri yazma yolu değişmedi.

## 2026-07-16 — HB-2026-043: Case notu, görev sonucu ve takip geçmişi sınırı

1. İlk gerçek not modeli `internal | contact` türlerinde append-only kayıttır. Not düzenleme/silme ve revision zinciri bu pakette yoktur; düzeltme yeni notla yapılır.
2. Görev durumları `open | completed | cancelled` olarak kilitlenir. Gecikme ayrı durum değil, LocalDate son tarihten deterministik türetilen `overdue | today | upcoming | scheduled` sinyalidir.
3. Tamamlama sonuç notu, iptal gerekçesi olmadan yapılamaz. Terminal görev yeniden açılmaz veya ikinci terminal duruma geçmez; düzeltme yeni görevdir.
4. Not/görev create ile görev terminal komutları zorunlu Idempotency-Key kullanır. Görev geçişi `expectedVersion`; takip tarihi ise mevcut Case `expectedVersion` sınırıyla korunur.
5. `followUpDate` her değiştiğinde eski/yeni LocalDate, actor ve resulting case version append-only geçmişe aynı transaction içinde yazılır.
6. Yazma yetkisi ilk ürün rol modeliyle `admin | expert | case_manager | secretary` içindir. Diğer oturumlu roller salt-okunur; kapalı case Operasyon alanında salt-okunurdur.
7. Audit içerik deposu değildir. Not gövdesi/konusu, görev başlığı, sonuç notu ve iptal gerekçesi merkezi audit detayına kopyalanmaz.
8. Dashboard kuralı `dashboard-priority/1.1.0` ile geciken görev → geciken takip ve bugün/yaklaşan görev → ilgili takip sinyallerini ayrı taşır. Görev status’u UI tarafında tahmin edilmez.

Etkisi: Migration `0024_case_notes_tasks`; strict Case Operations contracts/JSON Schema; tenant/RBAC/idempotency/audit API; gerçek Dosya Detayı Operasyon UI’ı ve Dashboard görev sinyalleri. Yeni dependency, IPC, File Agent veya fiziksel dosya yazma yolu yoktur.

## 2026-07-16 — HB-2026-044: Production veri doğruluğu ve case navigasyonu fail-closed sınırı

Karar:

1. Production frontend veri kaynağı her zaman `api` olur. `localStorage` veya `VITE_DATA_SOURCE=mock`, production build’de gerçek veriyi mock ile değiştiremez; mock yalnız development/test/demo sınırıdır.
2. `NODE_ENV=production` API süreci geçerli `DATABASE_URL` olmadan başlamaz. DB’siz health-only çalışma yalnız development/test uyumluluğu için korunur.
3. Cases istemcisi ortak `@hasarbotu/contracts` Zod şemalarını runtime’da uygular. Şema dışı case type/stage veya eksik response alanı güvenli `unavailable` sonucudur; varsayılan case türü/aşaması üretilmez.
4. Açık ve kapalı case listeleri server pagination sayfalarını eksiksiz toplar. Dosya detayı liste içinde aranmaz; `GET /api/v1/cases/:caseId` doğrudan kullanılır.
5. API modunda liste/detail DTO’sunda bulunmayan evrak tamlığı, tahmini hasar, rapor, ücret, işçilik, PERT, e-posta veya genel geçmiş sonucu gerçekmiş gibi gösterilmez. Bağlı olmayan alan açıkça “henüz bağlı değil” durumudur; mock fallback yapılmaz.
6. Kapanan Dosyalar gerçek `status=closed` case listesini kullanır. Kapanış gerekçesi/ücreti için gerçek endpoint yoksa değer uydurulmaz. Raporlar ekranı da gerçek endpoint olmadan mock toplam göstermez.
7. Zabıt `pending/failed` olsa bile doğrulanmış KTT veya Beyan olay belgesi alternatif grubunu karşılıyorsa seçilmeyen Zabıt gereksinimi `not_applicable` olur. Fiziksel aday durumu `relatedDocumentStatuses` içinde korunur.
8. Contracts runtime paketi frontend başlangıç bundle’ına eager eklenmez; API çağrısı sırasında lazy yüklenir ve Paket 35’in 500.000 bayt başlangıç bütçesi korunur.

Gerekçe:

Paket 1–37 denetiminde API modunda bilinmeyen alanların `0` veya “tam” gibi gösterilebildiği, ilk 100 açık dosya dışındaki kayıtların görünmediği, kapalı dosya detayının listeye bağımlı olduğu ve production’ın mock/DB’siz başlayabildiği kanıtlandı. Operasyon uygulamasında bilinmeyen veri başarılı gerçek olarak sunulamaz.

Etkisi:

- Yeni backend endpoint’i, migration, File Agent işi, IPC veya fiziksel/veritabanı yazma yolu eklenmez.
- Root UI, mevcut Cases contracts paketini runtime dependency olarak kullanır; harici dependency eklenmez.
- Mock prototip development/demo modunda korunur; production ve API modu fail-closed davranır.

## 2026-07-16 — HB-2026-045: Kapanma ücreti ve dönem raporu kullanıcı onayı sınırı

Karar:

1. Kapanma ücreti yalnız lifecycle durumu `closed` olan case için ve aynı tenant/case içindeki `expert_report` türünde `ready + hashVerified + sizeVerified + verifiedAt` documentVersion kaynağıyla oluşturulabilir.
2. İlk kayıt `control_required` durumunda manuel adaydır. Aday tutar aylık kesin toplamda yer almaz; yalnız açık kullanıcı teyidiyle oluşan `approved` veya yeni sürüm olarak kaydedilen `corrected` tutar rapor toplamına girer.
3. Onaylanmış sürüm değiştirilmez. Düzeltme; güncel optimistic version, yeni tutar, doğrulanmış kaynak rapor/sayfa ve zorunlu gerekçeyle append-only yeni ücret sürümü üretir.
4. Para değerleri floating point değil safe integer minor-unit ve sabit `TRY` olarak saklanır. İlk kural sürümü `closure-fee/1.0.0`'dır.
5. Dönem raporu; açık vakaları `created_at`, kapanan vakaları `closed_at` üzerinden seçilen ayın yarı açık tarih aralığında sayar. Bu temel `open_created_closed_finalized` olarak response içinde görünür.
6. Salt-okunur ücret ve rapor GET çağrıları audit yazmaz. Aday, onay ve düzeltme; idempotency sonucu ve merkezi audit olayıyla aynı transaction içinde tamamlanır.
7. API modunda mock toplam veya ücret fallback'i yoktur. Kapanan Dosyalar yalnız onaylı/düzeltilmiş tutarı kesin ücret olarak gösterir; aday `Kontrol gerekli`, kayıt yoksa bilinmeyen kalır.
8. PDF metni okuma, OCR/AI ücret çıkarımı, Excel dışa aktarımı, genel muhasebe yönetimi, File Agent ve fiziksel dosya yazımı bu paketin kapsamı dışındadır.

Etkisi:

- Migration `0025_closure_fees_reports`; saf kapanma ücreti kaynak kuralı; strict contracts/JSON Schema; tenant/RBAC/idempotency/optimistic locking/audit API ve gerçek Dosya Detayı/Kapanan Dosyalar/Raporlar UI entegrasyonu eklendi.
- Yeni harici dependency, IPC, File Agent işi veya fiziksel dosya yazma yolu eklenmedi.

## 2026-07-16 — HB-2026-046: Trafik değer kaybı kapanış özeti fail-closed sınırı

Karar:

1. Trafik case kapanışında yalnız assessment aggregate’ının güncel sürümü `approved`, insan onayı `approved` ve aynı assessment version’a ait immutable nihai rapor mevcutsa değer kaybı gereksinimi `present` olur.
2. Assessment yoksa, güncel sürüm taslak/onay bekliyor/rejected/control-required ise, nihai rapor yoksa veya rapor sürümü/kuralı güncel hesapla uyuşmuyorsa sonuç `control_required` olur. Eski superseded rapor sessizce güncel sonuç sayılmaz.
3. Kasko case için Trafik değer kaybı kapanış özeti `not_applicable` olur. Bu paket Kasko değer kaybı hesabı veya ofis kuralı üretmez.
4. Kapanış planı; durum, gerekçe, hesap/rapor kimliği, assessment version, sonuç kodu, minor-unit tutar ve kural sürümlerini mevcut lifecycle `requirement_snapshot` JSONB’sine yazar. Snapshot lifecycle history’ye append-only kopyalanır; eski kayıtlar `valueLossSummary:null` ile backward-compatible okunur.
5. Normal kapanışta `control_required` değer kaybı mevcut `requirements_incomplete` blocker’ına katılır. Kullanıcı yalnız mevcut “Eksiklerle Kapat” yolu, zorunlu gerekçe ve açık onayla ilerleyebilir.
6. Kapanan Dosyalar tenant-kapsamlı salt-okunur kapanış özetinden gerçek değer kaybı durumunu gösterir. Aylık rapor yalnız kapanmış Trafik case’lerde güncel onaylı+raporlu minor-unit sonucu toplar; hesaplama yeniden çalıştırılmaz.
7. Salt-okunur özet/rapor çağrıları audit yazmaz. Plan/finalize audit’inde yalnız güvenli status/version/report kimliği bulunabilir; emsal, belge içeriği, plaka, mutlak yol veya secret bulunmaz.
8. Mevcut lifecycle JSONB snapshot ve Trafik değer kaybı tabloları yeterlidir; yeni migration/tablo, File Agent işi, IPC veya fiziksel dosya yazma yolu eklenmez.

Etkisi:

- `traffic-value-loss-closure/1.0.0` saf domain değerlendirmesi, strict contracts/JSON Schema, tenant-kapsamlı read endpoint’i ve lifecycle/report/UI entegrasyonu eklenir.
- v0.10 Kapanış kapsamındaki değer kaybı kapanış özeti tamamlanır; Kasko/dış emsal geliştirmesi v0.9’un ayrı açık kapsamıdır.

## 2026-07-16 — HB-2026-047: Kullanıcı kontrollü e-posta taslağı ve Gmail web handoff sınırı

Karar:

1. İlk gerçek e-posta çekirdeği sürümlü ve deterministik `email-draft-template/1.0.0` şablonlarını kullanır. Taslak nihai iletişim değildir; alıcı, konu, gövde ve ek seçimi kullanıcı tarafından açıkça kontrol edilmeden kaydedilmez.
2. Alıcı adresi case, servis, sigortacı veya kullanıcı metadata’sından tahmin edilmez. En az bir `to` adresi zorunludur; `to` ve `cc` adresleri normalize edilir, tekrar ve geçersiz biçim reddedilir.
3. Ek önerisi yalnız aynı tenant/case içindeki current `ready + hashVerified + sizeVerified + verifiedAt` documentVersion veya photo metadata’sından gelir. Fiziksel dosya okunmaz, Gmail URL’sine eklenmez ve mutlak yol taşınmaz; kullanıcı eki Gmail ekranında manuel seçer.
4. Preview salt okunurdur ve audit/snapshot yazmaz. Taslak oluşturma ve düzeltme zorunlu Idempotency-Key, optimistic version ve açık onay kullanır. Düzeltme eski sürümü değiştirmez; append-only yeni sürüm üretir.
5. Gmail web handoff otomatik gönderim değildir. Ayrı açık harici veri çıkışı onayı ister, yalnız compose alanlarını kullanıcı tarayıcısında açar ve kalıcı olarak `deliveryStatus=not_sent` semantiğini korur. Gönderildi/teslim edildi sonucu üretilmez.
6. Taslak subject/body/recipient içeriği vaka-kapsamlı iş verisidir; merkezi audit’e kopyalanmaz. Audit yalnız draft/version/provider, recipient/attachment sayıları, `not_sent`, actor ve requestId gibi güvenli metadata taşır.
7. Yazma ve handoff rolleri `admin | expert | case_manager | secretary`; diğer case erişimli roller salt okunurdur. Kapalı case e-posta geçmişi salt okunurdur.
8. Migration 0026 taslak aggregate’ı, immutable version/recipient/attachment/handoff geçmişini ve aynı draft içindeki composite version bağlarını DB seviyesinde zorlar. OAuth tokenı, provider message ID, secret, mutlak yol veya fiziksel dosya içeriği kolonu yoktur.
9. Bu paket Gmail OAuth/API, gelen e-posta senkronizasyonu, gönderim doğrulaması ve bulut AI ile metin üretimi yapmaz. Bunlar ayrı güvenlik/deployment kararları gerektirir; core uygulama bunlar olmadan çalışır.

Etkisi:

- Saf domain şablonları, strict contracts/JSON Schema, migration 0026, tenant/RBAC/idempotency/audit API, gerçek Dosya Detayı e-posta çalışma alanı ve ayrı lazy chunk eklenir.
- Yeni harici dependency, File Agent işi, IPC veya fiziksel dosya yazma yolu eklenmez.

## 2026-07-16 — HB-2026-048: PII-minimize, bütçe kontrollü AI e-posta önerisi

Karar:

1. AI e-posta katmanı Paket 41’in deterministik önizlemesini değiştirmez; yalnız konu eki ve mesaj gövdesi için ayrı bir öneri üretir. Alıcı, ek, kayıt ve Gmail handoff işlemlerine karar veremez.
2. Plan salt okunurdur. Provider çağrısı ancak organization `emailEnabled`, ayrı email provider allow-list, integer aylık/istek bütçesi, güncel case/preview hash ve açık harici veri çıkışı onayı birlikte sağlanırsa yapılır.
3. Dış payload; case/preview kimliği değil, PII-minimize edilmiş template body, bounded kullanıcı talimatı ve gereksinim kodlarıdır. Office number ve plaka provider’a gönderilmez; güvenli konu kimliği yalnız server tarafında doğrulanmış öneriye eklenir.
4. Belge veya kullanıcı talimatındaki prompt-injection metni güvenilmeyen veri olarak korunur ve provider system contract’ını değiştiremez. URL/tool talimatı yürütülmez; provider’a tool veya cached-content yetkisi verilmez.
5. Provider çıktısı minimal wire schema sonrası strict server doğrulamasından geçer. Unknown/eksik alan, PII/placeholder, URL, drive/UNC/traversal veya bounded sınır ihlali başarılı öneri sayılmaz; ham provider çıktısı saklanmaz.
6. Provider çağrısı DB transaction açıkken yapılmaz. Durable receipt önce commit edilir; doğrulanmış canonical çıktı ayrı kaydedilir; run/usage/audit finalize atomiktir. Cevap sonrası finalize kesintisi ikinci provider çağrısı olmadan recover edilir. Network sonucu belirsizse otomatik retry yoktur ve `outcome_unknown` fail-closed kalır.
7. `ai_usage_ledger`, `usageModule=policy_analysis | email_draft` ile ortak bütçe gerçeğidir. E-posta için ikinci bir bütçe/usage sistemi kurulmaz; aktif receipt rezervasyonları hard-stop hesabına katılır.
8. UI öneriyi yalnız düzenleme alanlarına uygular ve kayıt onayını sıfırlar. Kullanıcı recipient/subject/body/attachment kontrolünü tekrar yapıp Paket 41’in ayrı save onayını vermeden kalıcı taslak oluşmaz.
9. Gerçek Gemini adapter mevcut server-only secret/config sınırını kullanır. Organization e-posta opt-in’i varsayılan kapalıdır. Provider kapalı/yapılandırılmamış veya bütçe doluysa core case/e-posta akışı çalışır, mock fallback veya otomatik provider/model fallback yapılmaz.

Etkisi:

- Migration `0027_email_ai_suggestions`; saf email-AI privacy/output doğrulama domain’i; strict contracts/JSON Schema; tenant/RBAC/idempotency/recovery/audit API ve Paket 41 içinde sınırlı AI öneri paneli eklenir.
- Yeni dependency, Gmail OAuth/API, gelen e-posta sync, File Agent, IPC, fiziksel dosya erişimi veya otomatik gönderim yoktur.

## 2026-07-17 — HB-2026-049: Kullanıcı kontrollü İşçilik (parça ve işçilik) çekirdeği

Karar:

1. v0.7 İşçilik’in ilk dilimi yalnız kullanıcı kontrollü, deterministik parça/işçilik satır kalemleri çekirdeğidir. Bu paket AI önerisi, Excel şablon profili, güvenli Excel yazımı, öğrenme sözlüğü veya tutar dağıtımı üretmez; bunlar sonraki dilimlere ve kritik işlem modeline bırakılır.
2. Her case için tek bir İşçilik föyü aggregate’i tutulur. Föy sürümleri immutable ve append-only’dir; düzeltme eski sürümü değiştirmez, append-only yeni sürüm üretir.
3. Satır kalemi bir onarım işleminin `description` (kalem), `action` (işlem etiketi, bounded serbest metin), `partAmountMinor` ve `laborAmountMinor` alanlarını taşır. İşlem taksonomisi bu dilimde sabit enum değildir; normalize/öğrenme sözlüğü sonraki dilimdedir. Tutarlar TRY minor birimdir (bigint); negatif olamaz ve satır başına parça+işçilikten en az biri pozitif olmalıdır.
4. Föy en az bir kalem içerir, en çok 200 kalem; alan başına ve föy geneli tutar üst sınırı taşma/abuse sınırıdır, iş kuralı değildir. Toplamlar (parça/işçilik/genel) satır kalemlerinden saf domain fonksiyonuyla türetilir; ayrı denormalize kaynak tutulmaz.
5. Preview yoktur; veri kullanıcı tarafından girilir. Oluşturma ve düzeltme zorunlu Idempotency-Key, optimistic version (oluşturmada case sürümü, düzeltmede föy sürümü), açık onay ve kapalı-case kilidi kullanır. Yazma rolleri `admin | expert | case_manager | secretary`; diğer case erişimli roller salt okunurdur. Kapalı case föyü salt okunurdur.
6. Migration 0028 aggregate, immutable version/item ve aynı föy içindeki composite version bağlarını DB seviyesinde zorlar; case başına tek föy unique kısıtı, sürüm zinciri guard’ı ve append-only trigger’ları vardır.
7. Audit yalnız güvenli metadata taşır: föy/sürüm kimliği, kalem sayısı, parça/işçilik/genel toplam minor, source type, actor ve requestId. Satır açıklaması/işlem metni audit’e kopyalanmaz. Salt-okunur/GET çağrılar audit yazmaz.
8. UI Dosya Detayı > İşçilik sekmesi API modunda gerçek föye bağlanır; kullanıcı kalemleri girer/düzenler ve açık onayla kaydeder. Mock İşçilik prototipi ayrı korunur ve API hatasında fallback yapılmaz.

Etkisi:

- `labor-sheet/1.0.0` saf domain doğrulama/hesap katmanı, strict contracts/JSON Schema, migration 0028, tenant/RBAC/idempotency/audit API ve gerçek Dosya Detayı İşçilik çalışma alanı eklenir.
- v0.7 İşçilik AI’nın AI önerisi, Excel şablon profili ve güvenli Excel yazımı ayrı sonraki dilimlerdir; yeni harici dependency, AI/provider çağrısı, Gmail, Excel yazımı, File Agent işi, IPC veya fiziksel dosya yazma yolu eklenmez.

## 2026-07-17 — HB-2026-050: PII-minimize, bütçe kontrollü AI işçilik önerisi

Karar:

1. İşçilik AI katmanı Paket 43 çekirdeğinin kullanıcı kontrolünü değiştirmez; yalnız satır kalemi önerisi üretir. Föy kaydına, sürüme, kapanışa veya Excel’e karar veremez; öneri föye otomatik yazılamaz.
2. Öneri girdisi kullanıcının bounded hasar tarifi (en çok 2.000 karakter) ve mevcut föyün güncel kalemleridir. Benzer dosya taraması ve öğrenme sözlüğü bu dilimde yoktur; sonraki açık kapsamdır.
3. Plan salt okunurdur. Provider çağrısı ancak organization `laborEnabled`, ayrı labor provider allow-list, ortak integer bütçe, güncel case/föy sürümü + plan hash ve harici sağlayıcıda açık egress onayı birlikte sağlanırsa yapılır.
4. Dış payload PII-minimize edilmiş hasar tarifi, minimize kalem metinleri ve case türüdür. Plaka, ofis numarası veya başka vaka kimliği provider’a gönderilmez; hasar tarifi ham metni DB/audit/log’a yazılmaz, yalnız hash/karakter sayısı saklanır.
5. Kullanıcı tarifindeki prompt-injection metni güvenilmeyen veri olarak korunur ve provider system contract’ını değiştiremez. Provider çıktısı strict doğrulanır: bilinmeyen alan, Paket 43 kalem/tutar sınırı ihlali, PII/placeholder, URL veya dosya yolu içeren çıktı öneri sayılmaz; ham çıktı saklanmaz.
6. Durable receipt/finalize/recovery modeli HB-2026-048 §6 ile birebirdir: provider çağrısı transaction dışında, receipt önce; cevap sonrası kesinti ikinci çağrı olmadan recover edilir; belirsiz network sonucu otomatik retry olmadan `outcome_unknown` kalır.
7. `ai_usage_ledger` üç modüllü ortak bütçe gerçeğine genişler: `policy_analysis | email_draft | labor_sheet`. Her modülün ay-içi hesabı diğer modüllerin aktif receipt rezervasyonlarını da sayar; ayrı bütçe sistemi kurulmaz.
8. UI öneriyi yalnız düzenleme alanlarına uygular ve Paket 43 kayıt onayını sıfırlar. Açık onayla kaydedilen föy sürümü `ai_assisted` source ve `labor_ai_suggestion_run_id` provenance’ı taşır; e-postadan farklı olarak revize sürümlerinde de `ai_assisted` provenance’a izin verilir (gerekçe zorunluluğu korunur), çünkü editör hem oluşturma hem düzeltmede öneri uygulayabilir.
9. Gerçek Gemini adapter mevcut server-only secret/config sınırını kullanır. Organization işçilik opt-in’i varsayılan kapalıdır; provider kapalı/yapılandırılmamış veya bütçe doluysa çekirdek İşçilik akışı çalışır, mock veya provider fallback yapılmaz.

Etkisi:

- Migration `0029_labor_ai_suggestions`; saf labor-AI privacy/çıktı doğrulama domain’i; strict contracts/JSON Schema; tenant/RBAC/idempotency/recovery/audit API ve Paket 43 editöründe sınırlı AI öneri paneli eklenir.
- Yeni dependency, Excel yazımı, öğrenme sözlüğü, Gmail, File Agent, IPC, fiziksel dosya erişimi veya otomatik kayıt yoktur.

## 2026-07-18 — HB-2026-051: Kullanıcı kontrollü PERT/Ağır Hasar değerlendirme çekirdeği

Karar:

1. v0.8 PERT’in ilk dilimi yalnız kullanıcı kontrollü değerlendirme çekirdeğidir. Fotoğraf AI, AI PERT önerisi, dış rayiç kaynağı ve Excel yazımı bu pakette yoktur; sonraki açık kapsamdır. v0.7’nin kalan güvenli Excel yazımı dilimi, yeni major dependency (xlsx kütüphanesi), gerçek ofis Excel şablon bilgisi ve ilk fiziksel içerik-yazma yolu gerektirdiği için bilinçli olarak ertelendi; üçü de kullanıcı onayı isteyen kararlardır.
2. Süreç durumu DOMAIN_RULES/PERT’teki dokuz durumun dil bağımsız kodlarıdır: `review_not_started | data_missing | under_review | repair_indicated | pert_candidate | expert_opinion_issued | center_decision_pending | repair_decided | pert_decided`. Durum kullanıcı seçimidir; katı geçiş makinesi belgelenmediği için kodlanmaz.
3. AI önerisi, eksper kanaati ve merkez kararı ayrı alanlardır. Eşik veya otomatik sonuç sabit kodlanmaz: hasar/rayiç oranı yalnız türetilmiş tam sayı yüzdedir (yarım yukarı yuvarlanır), her iki değer pozitifken hesaplanır ve saklanmaz.
4. Eksper kanaati `repair | pert` + zorunlu bounded gerekçedir ve yalnız kanaat-sonrası durumlarla kaydedilebilir; kanaat yokken yalnız inceleme durumları geçerlidir. Merkez kararı `repair | pert` kanaatten ayrı kaydedilir, yalnız karar durumlarında bulunur ve durumla birebir eşleşmek zorundadır. Bu tutarlılık kuralları hem domain hem DB CHECK seviyesinde zorlanır.
5. Her case için tek değerlendirme aggregate’i tutulur; sürümler immutable ve append-only’dir. Oluşturma/düzeltme zorunlu Idempotency-Key, optimistic version, açık onay ve kapalı-case kilidi kullanır.
6. PERT kanaati eksper/yönetim işidir: yazma rolleri `admin | expert | case_manager`; sekreterlik dahil diğer case erişimli roller salt okunurdur.
7. Audit yalnız güvenli metadata taşır: durum/kanaat/karar kodları, türetilmiş oran, sürüm ve yapısal not var/yok bilgisi. Gerekçe, yapısal not veya merkez notu serbest metni audit’e kopyalanmaz. Salt-okunur çağrılar audit yazmaz.
8. UI Dosya Detayı > Ağır Hasar sekmesi API modunda gerçek değerlendirmeye bağlanır; ekonomik görünüm, üç ayrı karar alanı ve sürüm geçmişini gösterir. Mock prototip ayrı korunur ve API hatasında fallback yapılmaz.

Etkisi:

- `pert-assessment/1.0.0` saf domain doğrulama/oran katmanı, strict contracts/JSON Schema, migration 0030, tenant/RBAC/idempotency/audit API ve gerçek Dosya Detayı Ağır Hasar çalışma alanı eklenir; API modunda bağlı olmayan son dosya modülü kapanır.
- Yeni dependency, AI/provider çağrısı, SBM/dış veri kaynağı, Excel yazımı, File Agent, IPC veya fiziksel dosya erişimi eklenmez; üretim migration çalıştırılmaz.

## 2026-07-18 — HB-2026-052: İşçilik öğrenme sözlüğü türetilmiş read-model sınırı

Karar:

1. Öğrenme sözlüğü yeni bir gerçek kaynağı değildir. Yeni tablo, migration veya yazma yolu kurulmaz; sözlük yalnız kullanıcıların açık onayla kaydettiği föylerin **güncel (current) sürümlerindeki** satır kalemlerinden organization kapsamında türetilir. Eski/superseded sürüm kalemleri sözlüğe girmez.
2. Sözlük AI değildir ve AI çağrısı yapmaz. Öğrenme, kullanım sayısı ve en son kullanılan tutarların deterministik toplanmasından ibarettir.
3. Eşleştirme Türkçe duyarlıdır: küçük harf + aksan ayrıştırma ile normalize anahtar üretilir; kullanıcıya her zaman orijinal metin gösterilir. Arama alt dize eşleşmesidir; sıralama kullanım sayısı → son kullanım → Türkçe alfabetik olarak deterministiktir.
4. Endpoint salt okunurdur, oturum zorunludur, tenant kapsamı oturumdaki organization'dır ve audit yazmaz. Sonuç `MAX_LABOR_DICTIONARY_ENTRIES` (200) ile sınırlıdır.
5. UI'da öneri yalnız `datalist` olarak sunulur. Kullanıcı bir kalem seçtiğinde işlem ve son tutarlar **yalnız boş alanlara** doldurulur; kullanıcının yazdığı hiçbir değer ezilmez, hiçbir satır otomatik eklenmez ve Paket 43'ün ayrı kayıt onayı olmadan kalıcı föy oluşmaz.
6. Sözlük yalnız düzenleme açıkken ve API modunda yüklenir. Yükleme hatasında öneri listesi boş kalır; kullanıcı akışı engellenmez ve mock fallback yapılmaz.

Etkisi:

- `labor-dictionary/1.0.0` saf domain normalize/arama katmanı, strict contracts/JSON Schema, salt okunur tenant-kapsamlı endpoint ve İşçilik editöründe öneri datalist'i eklenir. v0.7'nin öğrenme sözlüğü dilimi kapanır.
- Yeni tablo/migration, dependency, AI çağrısı, Excel yazımı, File Agent, IPC veya fiziksel dosya erişimi eklenmez.

## 2026-07-18 — HB-2026-053: API modunda kimlik ve yönetim listelerinde mock yasağı

Karar:

1. "API modunda mock kayıt gösterilmez" kuralı yalnız dosya modüllerini değil, **uygulama kabuğunu ve ana ekranları** da bağlar. Denetimde iki ihlal bulundu ve kapatıldı: Yönetim ekranı API modunda mock kullanıcı/servis listesi gösteriyordu ve sol menü kullanıcı kartı gerçek oturumda bile sabit kodlu prototip kimliği ("Ömer Faruk Kaya · Eksper") gösteriyordu.
2. Yönetim'in Kullanıcılar ve Servisler sekmeleri API modunda yalnız mevcut referans uçlarından (`/references/users|experts|services|insurers`) beslenir. Yeni tablo, migration, endpoint veya sözleşme eklenmez.
3. Gerçek referans sözleşmesinde karşılığı olmayan mock sütunları (telefon, atanmış dosya sayısı, açık dosya sayısı) **gösterilmez**; uydurulmuş sütun veya türetilmiş sahte sayı eklenmez. Eksper rolü ayrı `experts` referansından türetilir.
4. Sol menü kimliği yalnız gerçek oturumdan gelir: `displayName` ve rol kodlarının Türkçe etiketleri. Oturum yoksa API modunda "Oturum bekleniyor / Kimlik doğrulanmadı" gösterilir; prototip kimliği yalnız mock modda kalır.
5. Yönetim'in Belge Kuralları ve Erişim ve Yetki sekmeleri mock kayıt değil, kilitli proje kurallarının statik özetidir; her iki modda korunur. "Yeni Kayıt" mock butonu API modunda gösterilmez (gerçek yazma yolu yoktur).
6. Referans görünümü salt okunurdur ve audit yazmaz; oturum açma auditleri (`auth.*`) bu kuralın dışındadır.

Etkisi:

- ManagementPage API modunda gerçek veriye bağlanır, Sidebar kimliği gerçek oturumdan gelir; mock prototip yalnız mock modda korunur ve API hatasında fallback yapılmaz.
- Yeni tablo/migration/endpoint/sözleşme, dependency, AI çağrısı veya fiziksel dosya erişimi eklenmez.

## 2026-07-18 — HB-2026-054: Backend'i olmayan ekranlarda mock karantinası ve dürüst boş durum

Karar:

1. Gerçek veri kaynağı henüz kurulmamış ekranlar API modunda **mock içeriğe düşmez**. Örnek kayıt göstermek yerine ne olduğunu açıkça söyleyen bir boş durum gösterilir. Bu, HB-2026-053'teki "API modunda mock kayıt gösterilmez" kuralının backend'i bulunmayan ekranlara uygulanmasıdır.
2. Bildirimler ve Mevzuat ekranları bu kapsamdadır. API modunda gösterilen metinler sabittir: Bildirimler için "Bildirim altyapısı henüz etkin değil.", Mevzuat için "Mevzuat kaynak kütüphanesi henüz yapılandırılmadı."
3. Mock içerik yalnız açıkça seçilmiş mock veri modunda çalışır. Prototip gövdeleri ayrı bileşenlere alınır ve API modunda hiç render edilmez; böylece örnek kayıtlar DOM'a hiç girmez (yalnız CSS ile gizlenmez).
4. Bu paket sahte veri kaynağı üretmez: yeni tablo, migration, endpoint, domain modeli veya "boş dönen" sahte adapter eklenmez. Bildirim olay modeli ve mevzuat kaynak kütüphanesi modeli bilinçli olarak kapsam dışıdır ve ayrı ürün kararı bekler.
5. Menü, sayfa başlığı ve görsel iskelet korunur; ancak yalnız mock veriyle anlamlı olan yüzeyler (okunmamış sayacı, "Tümünü Okundu İşaretle", filtreler, mock soru–cevap paneli, "6 yerel mock kaynak" rozeti) API modunda gösterilmez.
6. Regresyon koruması iki katmanlıdır: her ekran için veri kaynağı ayrımı ve mock sızıntısı birim testleri; ayrıca Chrome smoke'ta mock kaynak dosyasından okunan sabit metinlerin API modunda DOM'da bulunmadığı doğrulanır.

Etkisi:

- `BackendUnavailableState` ortak bileşeni eklenir; Bildirimler ve Mevzuat sayfaları veri kaynağına göre ayrılır.
- Yeni tablo/migration/endpoint/domain modeli/adapter, dependency veya AI çağrısı eklenmez; iki ekranın gerçek veri modeli sonraki paketlerin açık kapsamıdır.

## 2026-07-18 — HB-2026-055: Operasyonel bildirimler ilk dilimi (türetilmiş, salt okunur)

Karar:

1. Bildirimler ekranının ilk gerçek modeli **kalıcı mesaj kutusu değildir**. Uyarılar her istekte mevcut kaynak veriden (görev, takip tarihi, evrak kuralı sonucu) deterministik türetilen **salt okunur** bir listedir. Yeni `notification event` tablosu, kuyruk veya arka plan işçisi eklenmez.
2. İlk sürümde üç uyarı türü vardır: `overdue_task` (süresi geçmiş ve tamamlanmamış görev), `overdue_follow_up` (geçmiş takip tarihi), `missing_required_document` (mevcut belge kurallarına göre eksik zorunlu evrak). Eşik veya kural uydurulmaz: gecikme `classifyCaseTaskDueDate`, eksik evrak `evaluateDocumentRequirements` sonucundaki `missing` durumundan gelir.
3. Önem seviyesi mevcut veriden eşlenir: görev önceliği (`high|normal|low` → `high|medium|low`), takip gecikmesi `medium`, eksik zorunlu evrak `high`. Sıralama deterministiktir: önem → kaynak tarih (eski önce) → dosya → kararlı anahtar.
4. Mükerrerlik `dedupeKey` ile engellenir: `overdue_task:{caseId}:{taskId}`, `overdue_follow_up:{caseId}`, `missing_required_document:{caseId}:{requirementCode}`. Aynı dosya ve aynı sebep için tek uyarı üretilir.
5. Kapsam yalnız oturumun organization'ı ve `lifecycle_status='open'` dosyalardır. Uç salt okunurdur, durum değiştirmez ve **audit yazmaz** (`auth.*` oturum auditleri bu kuralın dışındadır).
6. Uyarı gövdesi serbest not veya belge içeriği taşımaz; yalnız görev başlığı (tek satıra indirgenmiş ve sınırlanmış) ile sabit evrak etiketleri kullanılır. Evrak etiketleri tek kaynaktan (`DOCUMENT_REQUIREMENT_LABELS`) gelir; e-posta taslakları da aynı kaynağı kullanır, rakip etiket seti oluşturulmaz.
7. Okundu, silindi, ertelendi ve kullanıcı bazlı tercih modeli bu dilimde **yoktur**; UI bu kontrolleri sunmaz. Sayaç yalnız gerçek API sonucundan hesaplanır, boş sonuç gerçek boş durum olarak gösterilir ve API kapalıyken mock'a düşülmez.
8. Mevzuat ekranı HB-2026-054 uyarınca karantinada kalmaya devam eder.

Etkisi:

- `operational-alert` domain modülü, `v1/operational-alerts` sözleşmesi ve `GET /api/v1/operational-alerts` salt okunur ucu eklenir; UI'da Bildirimler API modunda gerçek uyarıları gösterir.
- Yeni tablo, migration, kuyruk, worker, dependency veya AI çağrısı eklenmez; bildirim olay modeli (kalıcı, kullanıcı durumlu bildirim) hâlâ ayrı ürün kararıdır.

## 2026-07-18 — HB-2026-056: Durum Panosu operasyonel uyarı özeti

Karar:

1. Durum Panosu uyarı özeti **aynı** `GET /api/v1/operational-alerts` ucunu kullanır. Yeni endpoint, tablo, migration veya ikinci türetim mantığı eklenmez; pano kendi uyarı kuralını hesaplamaz.
2. Toplam sayaç yalnız API yanıtındaki `totalCount` alanından okunur. Tür dağılımı (`Geciken görev`, `Geciken takip`, `Eksik zorunlu evrak`) aynı yanıttaki uyarılar sayılarak bulunur; bu bir türetim değil, dönen listenin sayımıdır ve tek yerde (`countOperationalAlertsByType`, veri katmanı) durur.
3. Pano **ayrıntılı liste render etmez**: yalnız özet ve en kritik ilk `DASHBOARD_ALERT_PREVIEW_LIMIT` (3) uyarı gösterilir. Tam liste Bildirimler ekranındadır; toplam rozeti, tür kartları ve "Tüm uyarıları gör" oraya gider. Önizleme satırı ilgili dosya detayına gider.
4. Uyarı yoksa **nötr** boş durum gösterilir ("Açık operasyonel uyarı yok."); bu bir hata değildir. Hata halinde **sıfır gösterilmez**: ayrı ve açık hata durumu render edilir ve mock'a düşülmez.
5. Özet yalnız API modunda render edilir; mock modda hiç çağrılmaz ve gösterilmez (HB-2026-054 mock karantinası korunur).
6. Aynı veri için ek istek üretilmez: mevcut `useOperationalAlerts` hook'u ve `OperationalAlertDataPort` paylaşılır. React StrictMode geliştirme modunda her effect'i iki kez çalıştırdığı için smoke mutlak istek sayısı yerine mevcut Durum Panosu ucuyla karşılaştırma yapar; uyarı ucu pano ucundan fazla istek üretmemelidir.
7. Cache, istek birleştirme ve performans optimizasyonu bu paketin kapsamı dışındadır; ekranlar arası geçişte yeniden okuma kabul edilir.

Etkisi:

- `DashboardAlertSummary` bileşeni ve veri katmanında `countOperationalAlertsByType` + `DASHBOARD_ALERT_PREVIEW_LIMIT` eklenir.
- Yeni uç, tablo, migration, kuyruk, dependency veya AI çağrısı eklenmez; kalıcı bildirim durumu ve mevzuat hâlâ kapsam dışıdır.
