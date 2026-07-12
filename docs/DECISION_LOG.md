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
