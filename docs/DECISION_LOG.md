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

## 2026-07-18 — HB-2026-057: Operasyonel uyarı performansı — önce ölç, sonra kanıtlanan darboğazı düzelt

Karar:

1. Performans işi **ölçümle başlar**. Gerçek PostgreSQL üzerinde 100 / 1.000 / 5.000 açık dosya hacimleri, karışık görev-takip-evrak dağılımıyla oluşturulur; toplam süre, SQL sorgu sayısı, sorgu süreleri, kural değerlendirme süresi ve dönen kayıt sayısı ölçülür. Soğuk ve ısınmış koşumlar ayrı raporlanır.
2. Ölçüm altyapısı **üretim koduna enstrümantasyon eklemez**: `pool.query` ölçüm betiğinde sarmalanır, kural süresi toplam − SQL olarak bulunur.
3. Ölçüm sonucu: N+1 yoktur (sorgu sayısı hacimden bağımsız, 4). Tek kanıtlanan darboğaz belge sorgusudur ve sebebi sorgu planı değil, binlerce elemanlı `case_id = ANY($2::uuid[])` dizi parametresidir.
4. Yalnız bu darboğaz düzeltilir: belge ve görev sorguları dosya kimliği dizisi yerine `cases` tablosuna `lifecycle_status='open'` join'i kullanır. Küme birebir aynıdır (kimlikler zaten aynı sorgudan geliyordu). İş kuralları, sıralama, dedupe davranışı ve 200 sınırı **değişmez**.
5. Cache, materialized view, background worker, yeni kalıcı tablo ve migration bu paketin kapsamı dışındadır ve eklenmez.
6. Performans regresyonu **kararsız süre eşiğine dayandırılmaz**. Koruma algoritmik sınırlarladır: sorgu sayısının hacimden bağımsızlığı, sorgu parametre yükünün hacimden bağımsızlığı, 200 sınırı, mükerrerlik yokluğu, sıralama ve tenant sınırı. Testin gerçekten koruduğu, eski sorgu geri konarak doğrulanır.
7. Ölçüm sonuçları gerçek sayılarla `PERFORMANCE_NOTES.md` içine yazılır. Süreler makineye bağlıdır ve oynaklık gözlendiyse tek örnek yerine birden çok örnek raporlanır.

Etkisi:

- `scripts/package51-alert-performance.mjs` ölçüm koşumu ve `services/api/test/operational-alerts-scaling.test.ts` regresyon testi eklenir; `PERFORMANCE_NOTES.md` açılır.
- 5.000 açık dosyada ısınmış süre ~382 ms → ~180-190 ms. Maliyet okuma anındadır ve doğrusal büyür; çok daha büyük hacimler yeniden ölçüm gerektirir.

## 2026-07-18 — HB-2026-058: Dosya satırı uyarı göstergesi ve `caseIds` filtresi

Karar:

1. Satır göstergesi için **yeni endpoint açılmaz**. Mevcut `GET /api/v1/operational-alerts` ucuna isteğe bağlı `caseIds` filtresi eklenir.
2. **Yanlış negatif yasağı:** genel liste `MAX_OPERATIONAL_ALERTS` (200) ile kırpıldığı için satır göstergesi bu listeden okunamaz. Düşük önemli uyarısı olan dosyalar kırpılmış listede hiç görünmez ve satır yanlışlıkla "uyarı yok" derdi. Bu yüzden filtreli çağrı, dosya başına özeti **kırpmadan önce** hesaplar (`deriveOperationalAlerts` + `summarizeOperationalAlertsByCase`) ve `caseSummaries` alanında döndürür.
3. Filtre yalnız Dosyalar ekranındaki görünür satır kimliklerini taşır. Üst sınır sözleşme seviyesinde `MAX_OPERATIONAL_ALERT_CASE_FILTER` = 100'dür; kimlikler UUID biçiminde, tekil ve en az bir tane olmalıdır. Sınır aşımı, mükerrer veya biçimsiz kimlik 400 döner.
4. **Tenant ve RBAC istemciden gelen kimliklere güvenmez.** Filtre kapsamı yalnız daraltır; erişim kararı her zaman sunucudaki `organization_id` + `lifecycle_status='open'` koşuluyla verilir. Yabancı, kapalı veya var olmayan kimlik ne uyarı ne özet üretir — özete hiç girmez.
5. İstemci "özet yok" durumunu **"uyarı yok" olarak yorumlamaz**: özeti dönmeyen satır "bilinmiyor" gösterilir. Uyarısı olmayan satırda dikkat çekici rozet yerine sessiz işaret kullanılır. Hata halinde tüm satırlar uyarısız gösterilmez; göstergenin yüklenemediği açıkça yazılır.
6. Yalnız görünür satırlar sorulur ve liste filtresi, sıralaması veya sayfalaması değiştiğinde yeniden yüklenir. Mock modda gerçek uyarı çağrısı yapılmaz.
7. Dosyalar ekranında API modunda gerçek sayfalama henüz yoktur; filtrelenmiş satır sayısı 100'ü aşarsa gösterge ilk 100 satır için yüklenir ve kalan satırlar "bilinmiyor" gösterilir. Bu durum tabloda açıkça belirtilir.
8. Yeni tablo, migration, cache, kalıcı bildirim durumu veya ikinci kural motoru eklenmez.

Etkisi:

- Domain'e `dedupeAndSortOperationalAlerts`, `buildOperationalAlerts`, `deriveOperationalAlerts` ve `summarizeOperationalAlertsByCase` eklenir; `collectOperationalAlerts` davranışı (200 kırpma) birebir korunur.
- Sözleşmeye `operationalAlertsQuerySchema` ve isteğe bağlı `caseSummaries` eklenir; filtresiz çağrının yanıtı değişmez.
- UI'da `CaseRowAlertBadge` ve Dosyalar tablosunda "Uyarı" sütunu (yalnız API modunda) eklenir.

## 2026-07-18 — HB-2026-059: Dosyalar ekranında sunucu tarafı sayfalama

Karar:

1. Yeni endpoint açılmaz. Mevcut `GET /api/v1/cases` ucu kullanılır; sözleşmesi zaten `page`, `pageSize` (üst sınır 100), arama, tür, durum, aşama, sorumlu, servis ve takip aralığı filtreleri ile sıralama alanlarını taşımaktadır. Yanıt `items` + `pageInfo{page,pageSize,totalItems,totalPages}` biçimindedir.
2. **`pageInfo.totalItems` alanı `totalCount` olarak yeniden adlandırılmadı.** Alan zaten istenen bilgiyi taşıyor; kararlı sözleşmeyi ve golden fixture'ları yalnız adlandırma için değiştirmek işlevsel kazanç sağlamazdı. İstemci portu bu değeri `totalCount` adıyla dışa verir.
3. Filtreleme, sıralama ve sayfalama **sunucuda ve sayfalamadan önce** uygulanır. Sıralama eşit değerlerde `id` ile deterministiktir; plaka araması boşluksuz (`plate_normalized`) eşleşir ve çok terimli arama AND davranışını korur. Tenant sınırı hem sonuçlara hem toplam sayıma aynı `organization_id` koşuluyla uygulanır. Geçersiz `page`/`pageSize` sözleşme seviyesinde 400 döner.
4. UI, API modunda **bütün listeyi çekmez**. `useCases` yalnız mock prototipi besler (`enabled: false` ile api modunda okuma yapmaz); ekran `useCasePage` ile yalnız aktif sayfayı okur.
5. Sayfa boyutu `CASES_PAGE_SIZE` = 50'dir ve operasyonel uyarı `caseIds` sınırının (100) altındadır. Satır uyarı isteği yalnız aktif sayfa kimliklerini gönderir; böylece normal kullanımda "bilinmiyor" uyarı durumu kalmaz (Paket 52'deki bilinen sınır kapanır).
6. Filtre, arama veya sıralama değişince sayfa 1'e döner. Son sayfadaki kayıtlar silinir veya filtre dışı kalırsa istemci geçerli son sayfaya çekilir; kelepçeleme **istenen** sayfa ile yapılır, yüklenmiş eski sayfa ile değil (aksi halde uçuştaki sayfa değişimi geri alınırdı).
7. UI durum filtresi sunucu alanlarına eşlenir: "Kapalı" → `status=closed`, "Gecikmiş" → `status=open` + `followUpTo=dün`. Takip filtresi tarih aralığına çevrilir. Bu eşleme saf `casesQuery.ts` modülündedir; bileşen iş kuralı taşımaz.
8. API modunda sorumlu ve servis filtreleri **kimlik bazlıdır** ve seçenekler gerçek referans uçlarından gelir; sayfalanmış listeden türetilemezler. Sunucunun sıralayamadığı sütunlar (şirket, aşama, eksik evrak, sorumlu) API modunda tıklanabilir sunulmaz — tıklama sessizce yutulmaz.
9. Mock moddaki prototip davranışı (istemci filtresi ve sahte sayfalama) korunur. API hatasında eski sayfa veya mock kayıt gösterilmez.
10. Yeni tablo veya migration yoktur.

Etkisi:

- `CasesDataPort.listCasePage`, `useCasePage`, `casesQuery.ts` ve `CaseReferenceFilters` eklenir; `useCases` isteğe bağlı `enabled` alır.
- Dosyalar ekranı artık ofis hacmiyle ölçeklenir ve satır uyarı göstergesi tam kapsamlıdır.

## 2026-07-18 — HB-2026-060: AI işçilik dağıtımı taksonomisi ve domain sınırı (Paket 54, dilim 1)

Karar:

1. **Taksonomi iki AYRI yapıdır** (kullanıcı kararı). Hiçbir sigorta şirketi veya Excel sütun adı bu pakete bağlanmaz; şablon profilleri ileride kanonik türleri gerçek sütunlara eşler.
   - **Kanonik operasyon türleri** (`labor-operation-types/1.0.0`): `repair`, `replace`, `remove_install`, `paint`, `consumable`, `calibration`, `related_operation`, `other`. Satır tutarı bu türlere dağıtılır; bir satır bir veya birden fazla tür taşıyabilir. `other` kullanımı her zaman `controlRequired=true` üretir.
   - **Ekonomik karşılaştırma kovaları**: `repair_labor`, `new_part_or_ownership`, `remove_install`, `paint_and_consumable`, `calibration`, `related_operations`. Bunlar yalnız onarım–değişim karşılaştırması içindir ve **işçilik kategorisi sayılmaz**.
2. Onarım–değişim karşılaştırması tek başına parça bedeline bakmaz: `remove_install`, `paint_and_consumable`, `calibration` ve `related_operations` her iki senaryoda da ortaktır; fark `repair_labor` ile `new_part_or_ownership` arasındadır. Bildirilen toplamlar `computeEconomicTotals` ile kovalardan **deterministik hesaplanır**; sağlayıcının kendi aritmetiği kabul edilmez.
3. **Şemada bulunmayan kanıt kanalları uydurulmaz.** Araç marka/model/model yılı/şasi prefix/motor alanı, parça/malzeme kodu ve yapısal hasar bölgesi alanı bu repository'de YOKTUR (`cases` yalnız plaka + tür taşır; `labor_sheet_items` yalnız açıklama/işlem/parça tutarı/işçilik tutarı). Bu kanallar `EVIDENCE_MISSING_VEHICLE_IDENTITY`, `EVIDENCE_MISSING_PART_CODE`, `EVIDENCE_MISSING_DAMAGE_REGION` kodlarıyla işaretlenir ve ilgili satır `controlRequired=true` olur. Kullanıcı kuralı korunur: satır sessizce boş bırakılmaz, en makul aday üretilir ama kontrol zorunlu kalır.
4. `controlRequired` **sunucu tarafında yeniden hesaplanır**; sağlayıcının `false` demesi yeterli değildir. Zorunlu kılan durumlar: `other` türü, eksik kanıt kodu, çelişki kodu, `LABOR_ALLOCATION_CONTROL_CONFIDENCE_THRESHOLD` (0.6) altı güven, `insufficient_evidence` kanaati.
5. Çıktı doğrulaması strict'tir: föydeki her satır tam olarak bir kez kapsanmalı, satır tahsis toplamı satırın parça+işçilik toplamına **eşit** olmalı (aritmetik tutarsızlık belirsizlik değil, geçersiz çıktıdır), aynı operasyon türü bir satırda tekrarlanamaz, PII placeholder/URL/dosya yolu/PII içeren metin reddedilir.
6. Kanıt snapshot hash'i (`buildLaborAllocationEvidenceHash`) föy sürümünü ve tüm kanıtları kapsar; kaynak değişirse hash değişir ve eski öneri stale sayılır.
7. Dış sağlayıcıya plaka, ofis numarası, vaka/organization/föy kimliği çıkmaz; serbest metinler PII minimizasyonundan geçer.

Etkisi:

- `packages/domain/src/labor-allocation-ai.ts` eklenir (saf modül, 23 test). Runtime davranışı değişmez; tablo, migration, endpoint veya UI eklenmez.
- Kalan dilimler açıktır: sözleşme + fixture, migration 0031 (immutable run/line kayıtları + `ai_usage_ledger` modül genişletmesi), API store/routes/provider harness, UI önizleme ve satır bazlı kabul/ret, Chrome smoke.

## 2026-07-18 — HB-2026-061: AI işçilik dağıtımı uçtan uca (Paket 54, dilim 2)

Karar:

1. Öneri **föy sürümünden ayrı aggregate'tir**: `labor_allocation_runs` + `labor_allocation_line_suggestions`. `labor_sheet_versions` bu tablolara bağlanmaz ve öneri föyü kendiliğinden değiştirmez.
2. **Append-only ve sürüm zinciri DB seviyesinde korunur**: run kimliği immutable, terminal run değiştirilemez/silinemez, satır sonuçları hiç güncellenemez/silinemez, satırlar yalnız `running` run'a eklenebilir ve `review_required` geçişinde bildirilen `line_count` gerçek satır sayısıyla trigger'da doğrulanır.
3. **Tekrar koruması yalnız BAŞARILI sonuçlara uygulanır** (`review_required` üzerinde kısmi unique indeks). İlk tasarımda kimlik tuple'ı tüm statülerde tekildi; bu, sağlayıcı kapalıyken oluşan bir çalıştırmanın analiz anahtarını kalıcı olarak kilitlemesine ve sağlayıcı sonradan açıldığında yeniden denenememesine yol açıyordu. Gerçek PostgreSQL testi bu hatayı yakaladı ve tasarım düzeltildi.
4. Sağlayıcı çıktısı **domain doğrulamasından geçmeden hiçbir satır yazılmaz**. Doğrulama başarısızsa run `failed` olur, satır tablosu boş kalır.
5. **Gizli fallback yoktur**: sağlayıcı hatası `failed`, sonucu bilinmeyen çağrı `outcome_unknown`, bütçe aşımı `budget_blocked`, politika kapalı `provider_disabled` üretir; hiçbirinde kural tabanlı yedek sonuç uydurulmaz. Her sonuç `ai_usage_ledger` üzerinde `labor_allocation` modülüyle kaydedilir.
6. `apply-preview` ucu **föyü revize etmez**; yanıt sözleşme seviyesinde `applied: false` literalidir. Stale kaynak föy sürümü hem analizde hem önizlemede reddedilir.
7. Deterministik harness sıfır olmayan sembolik maliyet üretir; aksi halde bütçe kapısı sıfır maliyet yüzünden sessizce atlanır ve hiç sınanmazdı.
8. UI satır bazlı kabul/ret, `control_required` filtresi, "kontrol gerekli olanlar hariç tümünü seç", gerekçe/güven/kanıt/çelişki kodu görünümü sunar. Tüm satırlar kontrol gerekliyse toplu seçim butonu **devre dışıdır**: kontrol gerekli satır sessizce seçilemez.

Etkisi:

- Migration 0031, `v1/labor-allocation-ai` sözleşmesi, API store/routes/provider harness ve `LaborAllocationAiModule` eklenir; Paket 54 dilim 1'deki domain modülü artık runtime tarafından tüketilir.
- Excel yazımı, şablon profilleri, otomatik eksper onayı ve kullanıcı onayı olmadan föy revizyonu kapsam dışıdır.

## 2026-07-18 — HB-2026-062: Gerçek Gemini işçilik dağıtım adaptörü (Paket 55)

Karar:

1. **Üç ayrı kapı zorunludur ve hiçbiri diğerinin yerine geçmez:**
   - Deployment opt-in: `GEMINI_LABOR_ALLOCATION_PROVIDER_ENABLED=true` + `GEMINI_API_KEY`. Poliçe analizi açık diye dağıtım egress'i kendiliğinden açılmaz; ayrı bayraktır.
   - Organization opt-in: `ai_provider_policies.labor_allocation_enabled` ve izin listesi. Politika satırı yoksa sağlayıcı **hiç çağrılmaz** ve makbuz bile oluşmaz.
   - Kullanıcı opt-in: dış sağlayıcı seçiliyken `confirmedEgress` olmadan istek 409 döner.
2. **Credential asla PostgreSQL'e yazılmaz.** Anahtar yalnız süreç ortamından okunur ve yalnız `x-goog-api-key` başlığında taşınır; istek gövdesine, DTO'ya, log'a veya audit'e girmez. Payload testi bunu doğrular.
3. Dışarı yalnız domain katmanında normalize edilmiş, PII-minimize kanıt paketi çıkar. Plaka, organization/case/sheet kimliği, e-posta ve dosya yolu bu pakette zaten yoktur; test bunu gövde üzerinden ayrıca doğrular.
4. Gemini'den `responseMimeType: application/json` + `responseJsonSchema` ile yapılandırılmış çıktı istenir. Wire şeması enum ve sayısal sınır taşımaz: dönen veri **yine** domain doğrulamasından (satır kapsaması, tahsis toplamı eşitliği, ekonomik tutarlılık) ve PII/URL/path taramasından geçer. Prompt ve wire şeması bu kontrollerin yerine geçmez.
5. **Kontrollü retry yalnız geçici hatalarda**: 429 ve 5xx. Kalıcı hata (401/403/400/404/422), geçersiz JSON, eksik kullanım verisi ve timeout retry üretmez. Ağ kesintisi ve timeout `outcome_unknown` olarak işaretlenir; tekrar denenmez.
6. Mükerrer maliyet koruması: her dış çağrı için `labor_allocation_provider_receipts` kaydı açılır (`client_request_id` organization içinde tekil) ve `ai_usage_ledger` girdisi yazılır. Gerçek model adı/sürümü, prompt sürümü, token kullanımı ve tahmini maliyet saklanır; ham prompt ve ham yanıt saklanmaz.
7. **Deterministik harness üretimde sessizce devreye giremez.** Yalnız `LABOR_ALLOCATION_ALLOW_DETERMINISTIC_PROVIDERS=true` ile kayda girer ve bu bayrak `NODE_ENV=production` altında config aşamasında reddedilir.
8. Sistem talimatı sözlüğü ve onaylı örnekleri **kanıt** olarak verir, otomatik doğru olduklarını söylemez. Araç kimliği, parça kodu ve hasar bölgesi bulunmadığı açıkça belirtilir; uydurulmaması ve eksik kanıt kodlarının korunması istenir. Modelin yüksek güven bildirmesi `control_required` zorunluluğunu kaldıramaz — bu sunucu tarafında yeniden hesaplanır (HB-2026-060).
9. Gerçek Gemini smoke'u **isteğe bağlı ve manueldir**; CI ve standart test kuşağı gerçek API anahtarı istemez.

Etkisi:

- `gemini-provider.ts`, `provider-output-schema.ts`, config opt-in'leri, `createLaborAllocationProviderRegistry` ve mock HTTP test kuşağı eklenir.
- Bir tip hatası testle yakalandı: sağlayıcı makbuzunda `run_id` (uuid) ve `request_id` (text) aynı parametreyi paylaşınca PostgreSQL tip çıkaramıyordu; ayrı parametreye ayrıldı.

## 2026-07-19 — HB-2026-063: AI kanıt zenginleştirme (Paket 56)

Karar:

1. **Üç eksik kanıt kanalı birlikte kapatılır.** Yalnız araç kimliği eklemek yetmez: `detectMissingEvidence` araç, parça kodu ve hasar bölgesi eksikliklerinin her biri için ayrı kod üretir ve `requiresControl` bunların her birini `control_required` sebebi sayar. Tek kanal kapatılsaydı bütün satırlar yine kontrol gerekli kalır, paket ölçülebilir bir sonuç üretmezdi.
2. `detectMissingEvidence` **sabit kod listesi döndürmeyi bırakır**; kodlar gerçek plan bağlamından türetilir. Böylece kanıt doldukça kod gerçekten düşer ve düşüş ölçülebilir.
3. **Araç profili dosya düzeyinde, versiyonlu ve kullanıcı kontrollüdür** (`case_vehicle_profiles` + immutable `case_vehicle_profile_versions`). Otomatik belge çıkarımı bu dilimin dışındadır; ilk kayıt gerekçe istemez, sonraki her sürüm gerekçe ister.
4. **Tam şasi numarası hiçbir katmanda tutulmaz.** Alan yalnız 3–11 karakterlik prefix kabul eder (`MAX_VEHICLE_CHASSIS_PREFIX_LENGTH = 11`); 17 karakterlik VIN'in girilmesi UI, sözleşme ve DB CHECK seviyesinde imkânsızdır. `toOutboundVehicleProfile` ayrıca `evidenceReference` alanını dışarı çıkan pakete koymaz.
5. **Parça kodu ile hasar bölgesi işçilik satırında nullable alanlardır**; eski föy sürümleri null kalır ve değişmeden okunur. Saf işçilik satırında (`partAmountMinor = 0`) parça kodu zorunlu sayılmaz; `partAmountMinor > 0` olup kod yoksa eksik kanıt üretilir.
6. **Kullanıcı girdisi ile sözlük önerisi ayrıştırılır**: `part_code_source` yalnız `user_entered` veya `dictionary_suggested` olabilir ve kod ile kaynak DB CHECK'inde birlikte null ya da birlikte dolu zorunludur. AI kanıt alanı üretmez; öneri editöre uygulanırken kullanıcının girdiği kod ve bölge korunur.
7. Hasar bölgesi **uydurma geniş enum'a bağlanmaz**; sınırlandırılmış ve normalize edilmiş serbest metindir (en çok 80 karakter, kontrol karakteri yok). Şirket Excel kolonlarına bağlanmaz.
8. Yeni alanlar **kanıt snapshot hash'ine dahildir**: kaynak alanlar değişince hash değişir ve eski öneri stale sayılır. Föy kaydedildiğinde AI dağıtım modülü UI'da yeniden kurulur; kullanıcı revize edilmiş föyün üstünde eski öneriyle çalışmaya devam edemez.
9. **Kanıt dolması `control_required` zorlamasını kaldırmaz.** Sunucu tarafı yeniden hesaplama (HB-2026-060) korunur; modelin yüksek güven bildirmesi de kaldıramaz.

Ölçülen sonuç (Paket 56 tarayıcı smoke'u, gerçek PostgreSQL + deterministik sağlayıcı):

- Üç kanal boşken satır başına 5 eksik kanıt kodu: `APPROVED_HISTORY`, `DAMAGE_REGION`, `EXPERT_BASELINE`, `PART_CODE`, `VEHICLE_IDENTITY`.
- Araç profili, parça kodu ve hasar bölgesi kullanıcı tarafından girildikten sonra 2 kod kalır: `APPROVED_HISTORY`, `EXPERT_BASELINE`.
- `control_required` satır sayısı 1 → 1: kod sayısı düşse de sunucu zorlaması kalkmaz.

Etkisi:

- Migration 0032, `v1/case-vehicle-profile` sözleşmesi, araç profili store/routes, Özet sekmesinde `CaseVehicleProfileModule` ve işçilik editöründe parça kodu / hasar bölgesi sütunları eklenir.
- Kalan iki kod (`APPROVED_HISTORY`, `EXPERT_BASELINE`) organizasyon içi onaylı geçmiş ve eksper sonucu kanalları doldukça düşer; bu kanallar Paket 56 kapsamında değildir.

## 2026-07-19 — HB-2026-064: Eksper baseline entegrasyonu (Paket 57)

Karar:

1. **Baseline = aynı dosyanın önceki onaylı föy sürümüdür.** Yeni kaynak tablo açılmaz; `labor_sheet_versions` zaten immutable ve yalnız açık kullanıcı onayıyla (`confirmed: true`) oluşur. AI önerileri ayrı aggregate'te (`labor_allocation_*`) durduğu için baseline'a karışmaları yapısal olarak imkânsızdır.
2. **Satır eşleştirmesi yalnız açıklamaya dayanmaz.** Açıklama ve işlem birlikte aday kümesini kurar; parça kodu ve hasar bölgesi YALNIZ iki tarafta da doluysa ayırt edici sayılır (eski sürümlerde bu alanlar null'dır ve tek taraflı değer eşleşmeyi bozmamalıdır).
3. **Eşleşme yalnız KARŞILIKLI TEK olduğunda kabul edilir.** Bir güncel satırın tek adayı varsa ve o baseline satırının da tek adayı o satırsa eşleşir; aksi halde `ambiguous` sayılır ve baseline yokmuş gibi davranılır. Belirsiz eşleşme sessizce "en yakın" satıra bağlanmaz.
4. **`EVIDENCE_MISSING_EXPERT_BASELINE` yalnız HER satır belirsizlik olmadan eşleştiğinde düşer.** Eksik kanıt kodları plan bazlıdır ve bütün satırlara taşınır; bir satırın baseline'ı yokken kodu kaldırmak o satır için baseline varmış gibi davranmak olurdu. Bu, `EVIDENCE_MISSING_PART_CODE` kanalındaki mevcut "herhangi bir satırda eksikse kod vardır" kuralıyla tutarlıdır.
5. **Çelişki SUNUCUDA hesaplanır.** Karşılaştırma tutar büyüklüğüne değil parça payı ORANINA bakar: kullanıcı föyü meşru biçimde revize edip tutarları değiştirebilir, ama eksperin onayladığı parça/işçilik dengesinden belirgin sapma kontrol gerektirir. Eşik `LABOR_BASELINE_PART_RATIO_TOLERANCE = 0.2` olarak `labor-baseline-comparison/1.0.0` kuralına bağlıdır ve sabit koda gömülmez. Model çelişkiyi bildirmese de `CONFLICT_EXPERT_BASELINE_DISAGREEMENT` düşmez.
6. **Baseline otomatik doğru sayılmaz.** Karşılaştırma hangi tarafın haklı olduğunu söylemez, yalnız farkı ölçüp insana taşır. UI farkı gösterir, otomatik kabul yoktur.
7. Baseline seçimi run kimliğinin parçasıdır ve trigger ile immutable'dır; sonradan değiştirilebilseydi saklanan öneri başka bir kanıta aitmiş gibi gösterilebilirdi. Satır karşılaştırması da öneriyle birlikte immutable saklanır ve alanlar DB CHECK'inde ya tamamen dolu ya tamamen boştur ("baseline yok ama çelişki var" kaydı imkânsızdır).
8. Baseline kanıt snapshot hash'ine dahildir (mevcut `buildLaborAllocationEvidenceHash` zaten `expertBaseline` alanını hash'ler); baseline değişince eski öneri stale sayılır.
9. Tenant sınırı sorgunun kendisinde uygulanır; organization dışındaki onaylı sonuçlar hiçbir koşulda okunmaz.

**Provenance düzeltmesi (kapsam dışı ama aynı sınıf hata):** `approvedHistory` kanalı `labor_allocation_line_suggestions` üzerinden okuyordu; yani yalnız `control_required=false` işaretlenmiş HAM AI çıktısını "kullanıcı onaylı geçmiş" diye geri besliyordu. Kimse o satırları onaylamamıştı ve bu, modelin kendi çıktısını kanıt olarak gördüğü bir kendi kendini pekiştirme döngüsüydü. Dağıtım önerilerinin föye uygulandığını gösteren bir bağ şemada bulunmadığı için (Paket 54 bilinçli olarak `applied: false` bıraktı) bu kanalın gerçek onaylı kaynağı henüz yoktur; uydurmak yerine boş bırakıldı. `EVIDENCE_MISSING_APPROVED_HISTORY` dürüst biçimde üretilmeye devam eder. Bu **daraltıcı** bir değişikliktir: kanıt genişletmez, uydurma kanıtı kaldırır.

Ölçülen sonuç (Paket 57 tarayıcı smoke'u, gerçek PostgreSQL + deterministik sağlayıcı):

- Tek föy sürümü varken satır başına 5 eksik kanıt kodu; baseline kanalı açık.
- Föy revize edilip sürüm 1 baseline olduğunda 4 kod kalır: **yalnız** `EVIDENCE_MISSING_EXPERT_BASELINE` düşer, `VEHICLE_IDENTITY`, `PART_CODE`, `DAMAGE_REGION` ve `APPROVED_HISTORY` bağımsız kalır.
- Ekonomik şekil belirgin saptığı senaryoda `CONFLICT_EXPERT_BASELINE_DISAGREEMENT` sunucuda zorlanır, satır kontrol gerekli kalır ve toplu seçim butonu devre dışıdır.

Etkisi:

- Migration 0033, `labor-baseline` domain modülü, baseline yükleyici, run/satır düzeyinde baseline sözleşme alanları ve AI önizlemesinde karşılaştırma görünümü eklenir.
- `EVIDENCE_MISSING_APPROVED_HISTORY` kanalı hâlâ açıktır ve gerçek bir "onaylanmış dağıtım" kaydı eklenene kadar açık kalacaktır.

## 2026-07-19 — HB-2026-065: Onaylı AI dağıtımını föye uygulama (Paket 58)

Karar:

1. **Uygulama AYRI bir aggregate'tir**: `labor_allocation_applications` + immutable `labor_allocation_applied_lines`. Öneri aggregate'i (`labor_allocation_*`) ile föy aggregate'i (`labor_sheet_*`) birbirine doğrudan bağlanmaz; provenance ikisinin arasında durur.
2. **Tek transaction**: föy sürümü, satır snapshot'ları ve provenance birlikte kesinleşir. Herhangi bir adım başarısızsa hiçbiri uygulanmış sayılmaz. Gerçek PostgreSQL testleri geçersiz satır ve stale sürüm senaryolarında geriye ne uygulama ne föy sürümü kaldığını doğruluyor.
3. **Değişmezler DB seviyesinde**: bir hedef föy sürümü yalnız bir uygulamaya (partial unique index), bir run yalnız bir BAŞARILI uygulamaya (partial unique index) bağlanabilir; `completed` durumu hedef sürüm olmadan CHECK ile imkânsız; tamamlanmış uygulama ve satır snapshot'ları trigger ile değiştirilemez.
4. **Ters yön deferred constraint trigger ile kapatıldı**: `ai_allocation_applied` etiketli bir föy sürümü, commit anında tamamlanmış bir uygulama kaydına bağlı olmak ZORUNDADIR. Böylece "AI uygulandı" etiketi provenance'sız kalamaz.
5. **Yeni kaynak türü `ai_allocation_applied`**. Uygulanan sürümü `manual_revision` diye etiketlemek Paket 57'de kapatılan provenance yalanının aynısı olurdu.
6. **Föy sürümü oluşturmanın tek uygulaması** `labor/sheet-version.ts`e çıkarıldı; kullanıcı revizyonu ve AI uygulaması aynı yardımcıyı kullanır. İkinci kopya bırakılsaydı sürüm zinciri ve kanıt alanı kuralları zamanla ayrışırdı.
7. **Kısmi seçim föyü budamaz**: seçilmeyen satırlar mevcut hallerini korur ve "reddedildi" sayılır. Kanıt alanları (parça kodu, hasar bölgesi) kullanıcının föydeki girdisidir; AI uygulaması bunları değiştirmez.
8. **Kullanıcı öneriyi düzenleyebilir**; önerilen ve uygulanan değerler AYRI snapshot'lanır ve `modified` bayrağı DB CHECK'inde snapshot'larla tutarlı olmak zorundadır ("değişmedi" deyip farklı değer saklanamaz).
9. **`approvedHistory` artık gerçek provenance'tan beslenir.** Yalnız `completed` uygulama kayıtları okunur; ham öneri, önizleme ve reddedilen satırlar kanıt değildir. Öğrenme örneği **uygulanan** değerdir (`applied_*` sütunları), AI'nin ilk önerisi değil.
10. **Geçmiş için eşleştirme kuralı baseline'dan FARKLIDIR.** Baseline tek bir föydür ve karşılıklı-tek eşleşme gerektirir. Geçmiş ise bir HAVUZDUR: aynı kalemin defalarca onaylanmış olması belirsizlik değil, tutarlı kanıttır. Belirsizlik, eşleşen kayıtların BİRBİRİYLE ÇELİŞMESİDİR — aynı kalem/işlem için farklı operasyon türü kümeleri onaylanmışsa tek doğru cevap yoktur ve geçmiş kullanılmaz. İlk uygulamada karşılıklı-tek kuralı denendi ve kanalın ikinci uygulamadan sonra kalıcı olarak kapanmasına yol açtığı testle görüldü; kural havuz semantiğine düzeltildi.
11. **Geçmiş otomatik doğru kabul edilmez**: öneri geçmişten ayrışıyorsa `CONFLICT_HISTORY_DISAGREEMENT` SUNUCUDA zorlanır (model bildirmese de düşmez) ve satır kontrol gerekli olur.
12. **Mevcut run kendi girdisine geçmiş olamaz**; domain tarafında ayrıca dışlanır.
13. UI: kontrol gerekli satırlar varsayılan olarak seçili gelmez, AI önerisi ile uygulanacak nihai değer yan yana durur, değiştirilen satır işaretlenir, onay modalı kaynak run ile kaynak/hedef sürümü gösterir ve modal açılması föyü değiştirmez.
14. Audit kaydına ham kalem açıklaması ve tutar yazılmaz; yalnız sayımlar ve sürüm numaraları.

Ölçülen sonuç (Paket 58 tarayıcı smoke'u, gerçek PostgreSQL + deterministik sağlayıcı):

- Uygulama öncesi satır başına 5 eksik kanıt kodu; `EVIDENCE_MISSING_APPROVED_HISTORY` dahil.
- Kullanıcı satırı seçip açıkça onayladıktan sonra BAŞKA bir dosyada yapılan yeni analizde 4 kod kalır: **yalnız** `EVIDENCE_MISSING_APPROVED_HISTORY` düşer; `VEHICLE_IDENTITY`, `PART_CODE`, `DAMAGE_REGION` ve `EXPERT_BASELINE` bağımsız kalır.
- Onay modalı açıkken föy sürümü sayısı değişmez; yalnız açık onaydan sonra sürüm 2 oluşur ve `ai_allocation_applied` olarak etiketlenir.

Etkisi:

- Migration 0034, `labor-allocation-apply` domain modülü, `POST .../apply` ve `GET .../labor-allocation-applications` uçları, uygulama provenance görünümü eklenir.
- Paket 54'te bilinçli bırakılan `applied: false` boşluğu kapanır; `apply-preview` ucu önizleme olarak korunur.
- Gerçek Gemini smoke'u üretimde sağlayıcı açılmadan önce zorunlu release kapısı olarak AÇIK kalmaya devam eder.

## 2026-07-19 — HB-2026-066: Gerçek Gemini release kapısı KAPANDI (Paket 59)

Karar ve sonuç:

HB-2026-062'de tanımlanan zorunlu release kapısı, gerçek API anahtarıyla ve P56–P58 sonrası GERÇEK akış (policy opt-in → bütçe → egress onayı → analyze → immutable kayıt → ledger/makbuz) üzerinden ölçüldü ve **kapandı**. Üç kapı ölçümü, iki senaryo (çıplak kanıt / zengin kanıt) ve iki modelde (birincil `gemini-3.5-flash`, fallback `gemini-2.5-flash`):

1. **`responseJsonSchema` gerçek API tarafından kabul edildi mi?** Evet — dört koşunun dördünde HTTP 200.
2. **Tüm satırlar eksiksiz döndü mü?** Evet — 2/2 satır, doğru sıra, dört koşuda da.
3. **`control_required` ve doğrulama hata oranı:** doğrulama hatası **0/2** (her modelde), kontrol oranı **4/4**. Model her satırda 0.9 güven bildirdi; sunucu zorlaması (HB-2026-060) güvene bakmadan kontrolü korudu.

Ek doğrulama: P56–P58 kanıt kanalları gerçek modelle uçtan uca çalışıyor — çıplak senaryoda satır başına 5 eksik kanıt kodu, zengin senaryoda (araç profili + parça kodu + hasar bölgesi + baseline) yalnız `EVIDENCE_MISSING_APPROVED_HISTORY`. Makbuzlar gerçek token kullanımıyla `finalized`, ledger'da koşu başına bir satır.

İlk gerçek temasın bulduğu üç kusur ve düzeltmeleri (domain güvenlik kuralları DEĞİŞMEDİ):

1. **Kapalı küme boşluğu → `AI_OUTPUT_SCHEMA_INVALID`.** Wire şeması literal sürümleri, kanaat sözlüğünü ve çelişki/eksik kanıt kodlarını `type: string` bırakıyordu; model bilemeyeceği değeri uyduruyordu. HB-2026-062'nin "wire şeması enum taşımaz" tercihi revize edildi: kapalı kümeler artık şemada enum, parasal alanlar `integer`. Domain doğrulaması aynen yerinde; şema yalnız uyum oranını yükseltir, kontrolün yerine geçmez.
2. **Dinamik düşünme bütçesi → 30 sn policy tavanında `AI_PROVIDER_TIMEOUT`.** Görev şemaya bağlı mekanik dağıtımdır; `thinkingConfig: { thinkingBudget: 0 }` eklendi (izinli model kümesi flash ailesi; ikisi de 0'ı destekliyor). Policy tavanı (0018, 30 sn) GEVŞETİLMEDİ.
3. **Türetilebilir toplamlar → `AI_OUTPUT_ECONOMIC_INVALID`.** Model önermediği senaryonun toplamına formül yerine 0 yazıyordu. Domain kuralı toplamları zaten kovalardan türetip sağlayıcı aritmetiğini reddettiği için, türetilebilir sayıyı modelden istemek yalnız hata modu ekliyordu: `repairTotalMinor`/`replaceTotalMinor` wire sözleşmesinden çıkarıldı, adaptör bunları modelin KENDİ kovalarından `computeEconomicTotals` ile hesaplar. Bu fallback değildir: içerik uydurulmaz, kova geçersizse dokunulmaz ve domain reddeder.

Sürümleme sınırı netleştirildi: `LABOR_ALLOCATION_PROMPT_TEMPLATE_VERSION` dışarı çıkan kanıt bağlamının YAPISINI, sağlayıcı sürümü ise sağlayıcıya özgü wire sözleşmesini (JSON şeması + sistem talimatı) sürümler. Bağlam yapısı değişmediği için domain sürümleri sabit kaldı (DB pinleri geçerli, migration yok); sağlayıcı sürümü `gemini-generate-content/1.1.0` oldu ve run kimliğine girer. Sistem talimatı P56 sonrası gerçeğe uyarlandı: kanıt kanalları "yok" değil "olmayabilir"; eksik kanıt uydurulmaz.

Windows `UV_HANDLE_CLOSING` çökmesi: yakalanmamış hata Node'u zorla çıkışa götürüp kapanan libuv async handle'larıyla yarışıyordu. Manuel smoke betiği artık hataları yakalayıp sınıflandırılmış raporlar, undici global dispatcher'ını kapatır ve `process.exit` yerine doğal çıkış kullanır.

Güvenlik: anahtar yalnız `.env.local`tan süreç ortamına okunur (dosya `.gitignore`'da üç desenle ignore, takip edilmiyor); hiçbir log/commit/DB kaydına girmez. Ham model çıktısı log'a yazılmaz; teşhis yalnız YAPISAL rapor üretir (anahtar adları, kapalı küme değerleri, uzunluklar). Fresh checkout kopyası `.env*` dosyalarını dışlar. Opt-in olmadan betik atlanır; CI anahtar istemez.

Etkisi: üretimde `GEMINI_LABOR_ALLOCATION_PROVIDER_ENABLED` açılmadan önceki zorunlu ölçüm tamamlandı. Kapı, wire sözleşmesi değişirse (provider sürüm artışı) yeniden koşulmalıdır.

## 2026-07-19 — HB-2026-067: Excel şablon profilleri (Paket 60)

Karar:

1. **Hiçbir sigorta şirketinin kolon seti ürüne gömülmez.** Sütunlar ve eşleme tamamen kullanıcı verisidir; şemanın sabitlediği tek şey kanonik operasyon türü kümesidir (HB-2026-060). Testlerde yalnız sentetik sütun adları kullanılır.
2. **Profiller organizasyon düzeyinde, sürümlü ve immutable'dır** (0032 araç profili kalıbı): aggregate + append-only sürüm zinciri. İlk kayıt gerekçe istemez, sonraki her sürüm ister. Sigorta şirketi bağlantısı composite FK ile AYNI organizasyona kilitlenir.
3. **Eşleme kanonik tür kümesini TAM kapsamak zorundadır**; `null` "bilerek eşlenmedi" demektir. Eksik veya fazla anahtar hem sözleşme hem DB CHECK seviyesinde reddedilir. CHECK içinde subquery kullanılamadığı için fazla-anahtar kuralı `(mapping - ARRAY[...]) = '{}'::jsonb` ile ifade edildi.
4. **Projeksiyon SALT OKUNURDUR ve dosyaya yazmaz.** Yanıt `written: false` literalini taşır: sözleşme seviyesinde "Excel'e yazıldı" iddiası imkânsızdır. xlsx dependency ve fiziksel yazım bu pakette YOKTUR ve ayrı deployment/ürün kararıdır.
5. **Kaynak yalnız TAMAMLANMIŞ uygulama provenance'ıdır** (HB-2026-065). Ham AI önerisi ve önizleme projekte edilmez.
6. **Dürüstlük kuralı — sayı uydurulmaz.** Paket 58'de kullanıcı tutarı değiştirerek uyguladıysa (`modified`) tür bazlı dağılım artık doğrulanmış değildir; bu satır için sütun tutarı ÜRETİLMEZ, satır `manual_entry_required` işaretlenir ve yalnız uygulanan toplam referans olarak korunur. Değiştirilmemiş satırda dahi dağılım toplamı uygulanan toplamı tutmuyorsa satır projekte edilmez; sessiz düzeltme yapılmaz.
7. **Eşlenmemiş türe düşen tutar hiçbir sütuna yazılmaz** ve satır incelemeye düşer; sütun toplamlarına karışmaz.
8. Yazma yetkisi yalnız `admin` rolündedir (şablon profili yapılandırmadır); okuma tüm rollere açıktır.

Ölçülen sonuç (Paket 60 tarayıcı smoke'u, gerçek PostgreSQL):

- Profil tanımlanmadan önce ekran sahte profil göstermiyor ve "önceden gömülü değildir" notunu veriyor.
- Kullanıcı kendi sütunlarını (`ISCILIK`, `PARCA`) ve 8 türden 3'ünün eşlemesini tanımlıyor; eşlenmeyenler `null` olarak saklanıyor.
- Değiştirilmemiş satır kullanıcının sütunlarına düşüyor; **değiştirilen satır `—` gösteriyor ve "Manuel giriş gerekli" olarak işaretleniyor** — hücrede uydurma tutar yok.
- Projeksiyon föy sürümü sayısını değiştirmiyor (salt okunur doğrulandı).

Etkisi:

- Migration 0035, `v1/labor-excel-profile` sözleşmesi, profil CRUD + projeksiyon uçları, Yönetim'de "Excel Şablonları" sekmesi ve İşçilik'te projeksiyon önizlemesi eklenir.
- Yeni modül **lazy** yüklenir: doğrudan import başlangıç JavaScript grafiğini 504.045 bayta çıkarıp bütçe kapısını düşürmüştü. Bütçe yükseltilmedi; projedeki lazy kalıbı uygulandı (495.584 bayt).
- v0.7'nin kalan son dilimi **güvenli Excel yazımıdır** ve xlsx dependency + gerçek ofis şablonu + fiziksel yazma kararı gerektirir.

## 2026-07-19 — HB-2026-068: Büyük föy yük ölçümü ve deterministik chunking (Paket 61)

Önce ölçüldü, sonra karar verildi. Gerçek Gemini (`gemini-3.5-flash`), gerçek `analyze` akışı, sentetik föyler:

| Satır | Süre | Sağlayıcı çağrısı | Kapsama | Doğrulama |
|---|---|---|---|---|
| 10 | 9,7 sn | 1 | 10/10 | geçti |
| 25 | 20,3 sn | 1 | 25/25 | geçti |
| 50 | 30,0 sn | 1 | **0/50** | **AI_PROVIDER_TIMEOUT** |
| 100 | 30,0 sn | 1 | **0/100** | **AI_PROVIDER_TIMEOUT** |

Ölçülen doğrusal davranış: satır başına ~0,81 sn ve ~307 çıktı token'ı. Çıktı KESİLMESİ gözlenmedi (`finishReason` hep STOP veya çağrı hiç tamamlanmadı); darboğaz süredir.

Karar kuralı gereği (timeout ve eksik satır ölçüldü) aynı pakette **kontrollü chunking** geliştirildi:

1. **30 sn'lik politika tavanı YÜKSELTİLMEDİ.** Tavan çağrı başınadır; iş bölündü.
2. `LABOR_ALLOCATION_CHUNK_SIZE = 20` ölçüme dayanır: 25 satır tavanın %68'ini kullandı; 20 satır ~16 sn (%55) ve model yavaşladığında marj bırakır. Sabit sürümlüdür (`labor-allocation-chunking/1.0.0`).
3. Gruplar deterministiktir: satır sırasına göre, içerikten bağımsız, çakışmasız ve boşluksuz. Her satır yalnız bir gruptadır.
4. **Dosya bağlamı her gruba taşınır** (araç profili, baseline, sözlük, onaylı geçmiş, hasar tarifi); yalnız satır alt kümesi değişir.
5. Her grup **domain doğrulamasından AYRI** geçer. Baseline ve geçmiş eşlemeleri grup yerel sırasına çevrilir.
6. Birleştirme sunucuda ve deterministiktir: grup içi 1..k sırası global sıraya eşlenir. **Eksik, tekrarlı veya kapsama dışı tek satır bile TÜM run'ı düşürür**; kısmi sonuç kaydedilmez.
7. **Gizli tek-çağrı fallback YOKTUR.** Bir grup düşerse sonraki gruplara geçilmez ve hiçbir satır kaydedilmez.
8. Her alt çağrı kendi sağlayıcı makbuzunu üretir; makbuz kimlikleri plan hash'inden deterministik türetilir (sözleşmedeki 64-hex kısıtı gevşetilmedi). **Ledger bütün alt çağrıların gerçek toplamını taşır.**

Chunking sonrası ölçüm — tüm boyutlar tam kapsama ve sıfır doğrulama hatası:

| Satır | Süre | Çağrı | Kapsama | Doğrulama | Ledger (giriş/çıkış token) |
|---|---|---|---|---|---|
| 10 | 10,4 sn | 1 | 10/10 | geçti | 1.162 / 3.322 |
| 25 | 22,5 sn | 2 | 25/25 | geçti | 3.178 / 7.928 |
| 50 | 43,9 sn | 3 | 50/50 | geçti | 6.884 / 15.872 |
| 100 | 84,6 sn | 5 | 100/100 | geçti | 12.275 / 31.138 |

11 sağlayıcı çağrısının hiçbirinde timeout, retry veya çıktı kesilmesi olmadı (`finishReason` hepsinde STOP) — bu, her çağrının 30 sn'lik **çağrı başına** tavana uyduğunun doğrudan kanıtıdır. Toplam duvar saati (43,9 / 84,6 sn) chunk'lı run'da meşru biçimde tavanı aşar; politika tek çağrıyı sınırlar, toplam süreyi değil. İlk ölçüm betiği bu ikisini karıştırıyordu ve kontrol doğru semantiğe çekildi.

Yan bulgular ve düzeltmeleri:

- **`finishReason` görünmüyordu.** Her eksik çıktı tek bir generic koda düşüyor, "model token sınırına çarptı" ile "yanıt başka nedenle bozuk" ayırt edilemiyordu. `finishReason` kapalı enum olarak yakalandı (içerik değildir) ve çıktı kesilmesi ayrı `AI_PROVIDER_RESPONSE_TRUNCATED` koduyla raporlanıyor. Retry sayısı da yapısal teşhise eklendi.
- **Ledger gerçek kullanımı taşımıyordu:** `output_characters` sabit 0 geçiliyor, token sütunları hiç doldurulmuyordu. Artık gerçek çıktı karakteri ve token sayıları yazılıyor (DB kısıtı gereği token alanları birlikte null ya da birlikte dolu).
- **Gizli bir TDZ hatası bulundu:** `finalize` closure'ı `providerUsage`'ı kendisinden sonra tanımlanan `let` üzerinden okuyordu; eski kod bundan yalnız ternary kısa devresi sayesinde kazara kaçınıyordu. Bildirim closure'dan öncesine taşındı.
- Gerçek sağlayıcıyla teyit koşusu **sağlayıcı kotasına takıldı** (429). Bu ortamsaldır; kontrollü retry (2 deneme) ve no-fallback davranışı doğru çalıştı, run temiz biçimde `failed` oldu ve hiçbir satır kaydedilmedi. Chunking değişmezleri kotadan bağımsız olarak deterministik sağlayıcıyla CI kuşağında korunuyor.

Etkisi: `labor-allocation-chunking` domain modülü, chunk döngüsü, teşhis alanları ve yük ölçüm betiği eklendi. Migration YOKTUR; domain doğrulaması ve tam satır kapsaması şartı gevşetilmedi.

## 2026-07-20 — HB-2026-069: AI analiz ilerlemesi ve dayanıklılık (Paket 62)

Bağlam: Paket 61 chunking'i getirdi ve 100 satırlık föy 5 alt çağrıda ~85 saniye sürüyor. Analiz senkron çalıştığı için istek boyunca UI donuk kalıyordu; kullanıcı ne kadar ilerlendiğini göremiyor, sayfadan ayrılırsa sonucu kaybediyordu.

Karar:

1. **Analiz asenkron koşar.** `POST .../labor-allocation-ai` koşuyu `queued` durumunda yaratıp hemen döner; yürütme sunucuda devam eder. Kullanıcı sayfadan ayrılabilir; döndüğünde aktif koşu bulunur ve ilerleme kaldığı yerden görünür.
2. **İlerleme MEVCUT kayıtlardan türetilir.** İkinci paralel ilerleme sistemi kurulmadı: tamamlanan grup sayısı sağlayıcı makbuzlarından (`result_kind='success'`) sayılır, işlenen satır sayısı chunk planından çarpılır. Migration 0036 yalnız türetilemeyen alanları ekler: toplam satır/grup sayısı, grup boyutu, iptal isteği ve ilerleme zaman damgası.
3. **Sahte yüzde ve tahmini kalan süre YOKTUR.** UI yalnız `3/5 grup`, `60/100 satır` ve gerçekten geçen süreyi gösterir. İlerleme çubuğu bilerek eklenmedi; tamamlanmamış grubun içindeki durum bilinmediği için doldurulacak yüzde uydurma olurdu.
4. **Aynı föy sürümü için çift başlatma engellenir.** Aktif koşu varken yeni istek `ANALYSIS_ALREADY_RUNNING` (409) alır.
5. **İptal denenir, başarı iddia edilmez.** `cancel_requested` ara durumdur; koşu ancak gerçekten durdurulduğunda `cancelled` olur. Sağlayıcı çağrısı dönüş yolundayken kesinlik yoksa durum uydurulmaz.
6. **Başarısız ve iptal edilmiş koşular kısmi öneri sızdırmaz.** Migration 0036 trigger'ı başarısız/iptal durumundaki koşunun öneri satırı taşımasını veritabanı seviyesinde yasaklar; ayrıca `cancel_requested`'tan geriye dönüş ve terminal koşunun mutasyonu engellenir.
7. **Yeniden deneme yeni ve izlenebilir koşudur.** Önceki koşu kaydı değişmez; makbuz kimlikleri artık plan hash'i yerine `runId`'den türetilir (aynı föy için ikinci denemenin makbuz çakışmasına düşmesi böyle giderildi).
8. **Son koşu gizlenmez.** Aktif koşu yoksa EN SON koşu gösterilir; başarısız son deneme sessizce saklanıp yerine eski bir öneri tazeymiş gibi sunulmaz.

Etkisi: Migration 0036, asenkron yürütme ve iptal kaydı, `readRun`/`cancel` uçları, ilerleme paneli. Domain doğrulaması, PII sınırı, bütçe kapısı ve tam satır kapsaması şartı gevşetilmedi.

## 2026-07-20 — HB-2026-070: Çoklu Excel profil seçimi (Paket 63)

Bağlam: Paket 60 profil altyapısını kurdu ama dosya ekranı `profiles[0]` ile listedeki İLK profili körü körüne seçiyordu. Bu, başka bir sigorta şirketinin şablonunu sessizce kullanabilecek bir seçim hatasıydı ve fiziksel yazıma geçmeden kapatılması gerekiyordu.

Karar:

1. **Aday kümesi sunucuda süzülür.** Organizasyon sınırı sorguda, sigorta şirketi ve aktiflik kuralı domain fonksiyonunda (`selectLaborExcelProfileCandidates`) uygulanır. İstemcinin gönderdiği `profileId` doğrulanmadan kullanılmaz: projeksiyon ucu pasif profili `PROFILE_INACTIVE`, yabancı şirket profilini `PROFILE_INSURER_MISMATCH` ile 409 döner.
2. **Öneri seçim yerine geçmez.** Dosyanın şirketine bağlı TEK aktif profil varsa ön-seçili gelir ama kullanıcı onaylamadan projeksiyon üretilmez. Birden fazla aday varsa hiçbir şey ön-seçili olmaz ve önizleme düğmesi kilitlidir.
3. **Genel profil adaydır ama ASLA otomatik önerilmez.** P60 hiçbir şirkete bağlı olmayan profili modellemişti; onu aday dışı bırakmak o tasarımı işlevsiz kılardı. Ancak öneri yalnız şirkete bağlı tek aktif profille yapılır — genel profil seçimi her zaman kullanıcıya bırakılır.
4. **Pasifleştirme silme değildir.** Migration 0037 aggregate üzerinde durum tutar; pasif profil yeni projeksiyonda seçilemez ama kaydı okunabilir kalır. Durum değişikliği profil SÜRÜMÜ üretmez (içerik değişmiyor) ama aggregate sürümünü artırır ki eşzamanlı düzenleme çakışması yakalansın. Pasifleştirme gerekçe ister; DB CHECK "pasif ama kim/ne zaman bilinmiyor" durumunu imkânsız kılar.
5. **Otomatik profil önerisi ile gerçek şablon eşleşmesi AYRI şeylerdir.** Aday yanıtı `templateVerified: false` literalini taşır ve UI açıkça "profil önerisidir, şablon eşleşmesi değildir" der. Gerçek Excel dosyası okunana kadar başka bir iddiada bulunulmaz.
6. **Hedef sayfa ve kimlik doğrulama kuralı modele girdi; hücre koordinatı GİRMEDİ.** Yazımdan önce hangi kimliklerin (plaka, dosya numarası) doğrulanacağı sürümlü profil bilgisidir. "Nerede bulunacağı" bilerek modellenmedi: gerçek şablon okunmadan hücre konumu uydurmak yanlış güven yaratır. Geometri, şablon ilk kez okunduğunda modele girecek.
7. **Profil değişince eski projeksiyon gösterilmez.** Profil seçimi değişirse projeksiyon temizlenir; profil sürümü değişmiş veya profil aday olmaktan çıkmışsa mevcut projeksiyon bayat olarak işaretlenir ve sayıların güvenilmez olduğu söylenir.
8. **Smoke'un diş taşıdığı ölçüldü.** Paket 62'de teşhis kodunun kendisi ürünün işini yaparak sahte yeşil ürettiği için, bu paketin smoke'u kasıtlı bir kırılmayla sınandı: aktiflik filtresi devre dışı bırakıldığında smoke `AFTER_DEACTIVATION_COUNT_2` ile düştü. Betikteki hiçbir teşhis kodu tıklama veya seçim yapmaz; yalnız okur.

Etkisi: Migration 0037, aday ve durum uçları, projeksiyon sıkılaştırması, profil seçim paneli. Hâlâ hiçbir Excel dosyası okunmaz veya yazılmaz.

## 2026-07-20 — HB-2026-071: Gerçek şablon keşfi ve workbook yamalama temeli (Paket 64, 1. dilim)

Bağlam: Fiziksel `.xlsx` yazımına geçmeden önce gerçek sürücü salt okunur tarandı. Keşif, varsayılan klasör düzenini ve "İŞÇİLİK.xlsx şablondur" beklentisini çürüttü.

Ölçülen keşif sonucu (hiçbir dosya değiştirilmedi):

1. **Ay klasörü büyük/küçük harf tutarlı DEĞİL.** Aynı ay için `REFERANS SİGORTA\TEMMUZ 2026` (büyük) ve `TÜRKİYE SİGORTA\Temmuz 2026` (baş harf) birlikte var. Bu yüzden ay klasörü adı ÜRETİLMEZ; mevcut dizinler arasında Türkçe harf duyarsız eşleşme aranır. Eşleşme yoksa açık hata; eski düzene sessiz fallback yok.
2. **Belgelenmemiş bir seviye var:** kapanan dosyalar `<Ay Yıl>\KAPALI <AY> <YIL>\<PLAKA>` altında duruyor. Plaka klasörü hem doğrudan hem bu seviyede aranır.
3. **Örnek vakada (`47ACA535`) hiç `.xlsx` yok.** Yazılacak workbook mevcut değil.
4. **Tüm sürücüde gerçek işçilik şablonu TEK örnek:** 20 workbook / 26 sheet tarandı, imza eşleşmesi tam olarak 1 (`41-17855116 İşçilik Dağılımı.xlsx`, sheet `Main sheet`, A1:N6, F–M operasyon sütunları, N formüllü toplam).
5. **`İŞÇİLİK.xlsx` adlı iki dosya şablon DEĞİL** — ad-hoc parça listeleri (operasyon başlığı yok). Dosya adına güvenen bir seçim tam olarak yanlış dosyaları seçerdi; ayırt edici olan İÇERİK imzasıdır.
6. Boş şablon dosyası hiçbir yerde yok; mevcut tek örnek doldurulmuş ve adı vakaya özel.

Kararlar:

1. **Eksik workbook oluşturulmaz.** Kullanıcı kararı: yalnız var olan dosya doldurulur, yoksa yazım açık hatayla bloklanır. HasarBotu müşteri klasöründe kendiliğinden dosya yaratmaz.
2. **Bağımlılık: `fflate` (0 bağımlılık, MIT, saf JS) + kendi cerrahi OOXML yamalayıcımız.** `exceljs` reddedildi: 9 doğrudan bağımlılık (üç ayrı zip yığını) ve nesne modeli kurup workbook'u YENİDEN üretmesi, modellemediği özellikleri (grafik, pivot, koşullu biçimlendirme, veri doğrulama) sessizce düşürür. Yamalama yaklaşımında dokunulmayan her ZIP girdisi **byte-birebir** korunur ve bu doğrulanabilir.
3. **Formüllü hücreye YAZILMAZ.** Toplam sütunu formüllüdür; sabit sayıya çevrilmez, plan `cell_has_formula` ile reddedilir. Yamalanan hücreler yüzünden bayat kalan formül sonucu için sahte toplam yazmak yerine workbook'a `fullCalcOnLoad` bayrağı konur.
4. **Sınır dışı tek hücre tüm planı düşürür**; kısmi yazım yoktur.

Gerçek şablona karşı salt okunur doğrulama (dosya diske yazılmadı, kaynak SHA256 değişmedi): imza doğrulandı, F2/M2/L3 yamalandı, N2 (formül) reddedildi, **11 ZIP girdisinin 9'u byte-birebir aynı kaldı** — yalnız hedef sheet ve recalc bayrağı değişti.

Bu dilimin kapsamı: bağımlılık, yol çözümleyici ve workbook geometrisi/yamalama temeli. Fiziksel yazım hattı (File Agent, yedek, geçici dosya, güvenli replace), geometri profil migration'ı, sözleşme/API/UI ve Chrome smoke bir sonraki dilimdedir. **Hiçbir fiziksel yazım yapılmadı.**

## 2026-07-20 — HB-2026-072: İşçilik dağıtım kategorisi ekseni (Paket 64 semantik düzeltme)

Bağlam: Paket 64 keşfi gerçek şablonun F–M sütunlarını ortaya çıkardı: Kaporta, Mekanik, Elektrik, Döş/Kilit, Cam, Kalibrasyon, Onarım, Boya. Paket 60–63 profil modeli bu sütunları kanonik OPERASYON TÜRÜNE eşliyordu. Bu yanlış eksendi.

Tespit:

1. **Operasyon türü ile Excel işçilik sütunu aynı eksen değildir.** Operasyon türü işlemin NE OLDUĞUNU söyler (onarım/değişim/sökme-takma). Excel sütunu işi HANGİ BRANŞIN yaptığını söyler. `remove_install` hem kaporta hem mekanik altında olabilir; `replace` bir işçilik sütunu değildir, parça bedelidir.
2. `calibration`, `repair` ve `paint` adlarının iki sette de geçmesi ayrımı gizliyordu — hata tam olarak buradan doğmuştu.

Karar:

1. `labor-operation-types/1.0.0` AI gerekçelendirmesi ve onarım/değişim karşılaştırması için KORUNDU; ekonomik kovalar da ayrı kaldı.
2. Yeni sürümlü sınır: `labor-allocation-categories/1.0.0` — bodywork, mechanical, electrical, upholstery_lock, glass, calibration, repair, paint. Kodlar kararlı ve dil bağımsız; Türkçe etiketler UI katmanında.
3. Profil eşlemesi kategori eksenine taşındı ve şema `labor-excel-profile/2.0.0` oldu. **Eski 1.0.0 kayıtları sessizce yeniden yorumlanmadı**: migration 0038'in CHECK kısıtı sürüme göre dallanır, 1.0.0 satırları operasyon türü anahtarlarıyla olduğu gibi kalır ve okunabilir. Fiziksel yazım yalnız 2.0.0 ile yapılır; kural `isProfileWritable` ile tek noktadan zorlanır ve sözleşme `writable` alanını taşır.
4. **Kategori operasyon türünden UYDURULMAZ.** `deriveCategoryFromOperation` yalnız tek anlamlı türleri eşler (paint, calibration, repair); geri kalanlar `null` döner. Sıfır olmayan tek bir belirsiz tutar TÜM satırı düşürür ve satır `manual_entry_required` olur.
5. **Ölçülen dürüst sonuç:** mevcut AI çıktısı `remove_install` gibi branş bilgisi taşımayan türler ürettiği için şu anda hiçbir satır otomatik projekte EDİLEMİYOR (projeksiyon 0, manuel 2). Bu bir gerileme değil, önceki davranışın yanlış eksende tutar üretmiş olduğunun kanıtı. Excel'e otomatik aktarım, satır bazında kategori dağıtımı eklenene kadar açılmayacak.
6. Migration geri alma, 2.0.0 satırı varsa sessiz veri kaybı yerine açık hata verir.

Dosya numarası kapsamı kontrol edildi: `office_number` yalnız `(organization_id, office_number)` kapsamında tekil, `insurer_claim_number` üzerinde hiç unique kısıt yok. **Global tekillik hatası bulunmadı ve eklenmedi.**

Ayrıca `fflate` koruma iddiası doğru adlandırıldı: dokunulmayan OOXML part içerikleri byte-birebir korunur; tüm ZIP dosyasının binary olarak aynı kaldığı İDDİA EDİLMEZ.

## 2026-07-20 — HB-2026-073: AI kategori dağılımı doğrulama çekirdeği (Paket 64 ara dilim, 1. parça)

Ürün kararı alındı: **AI satır bazında işçilik dağıtım kategorilerini ve tutarlarını KENDİSİ üretecek.** Kullanıcı seçimi ana yöntem değil, yalnız inceleme ve düzeltme yoludur. Kural tabanlı dağıtıcıya dönülmeyecek.

Bu parça, her şeyin üzerine oturacağı doğrulama çekirdeğini kurar:

1. `labor-category-allocation/1.0.0` sürümlü sınırı eklendi. Kategori tutarı operasyon türünden TÜRETİLMEZ; modelin kendi çıktısıdır. Mevcut `deriveCategoryAmounts` yalnız eski kayıtların okunmasına hizmet eder ve yeni akışta kullanılmaz.
2. **Sekiz kategori eksiksiz gelmeli.** Sessiz eksik anahtar `category_keys_incomplete` ile reddedilir; bilinmeyen anahtar `category_keys_unknown` ile reddedilir. Kullanılmayan kategori `0` taşır.
3. **Toplam sunucuda yeniden hesaplanır** ve satırın İŞÇİLİK tutarına tam eşit olmalıdır. Sağlayıcının kendi toplam alanı wire'da hiç taşınmaz. Parça tutarı toplama dahil edilmez — parçayı ekleyen model çıktısı `category_total_mismatch` ile düşer.
4. Negatif tutar, küsurat, gerekçesizlik, aralık dışı güven ve bilinmeyen çelişki kodu ayrı kodlarla reddedilir.
5. **Modelin yüksek güveni sunucu zorlamasını KALDIRAMAZ:** `categoryControlRequired` çelişki kodu varsa 0.99 güvende bile `true` döner; eşik altı güven de kontrolü zorlar.

Kapsam: yalnız domain doğrulama çekirdeği ve testleri. Wire şeması, prompt, provider sürüm artışı, migration, apply transaction, UI ve **gerçek Gemini smoke bu parçada YOKTUR**; sıradaki parçadadır. Paket, gerçek 2 satırlı Gemini schema smoke geçmeden tamamlanmış sayılmayacak.

## 2026-07-20 — HB-2026-074: Kategori dağılımı wire şeması, prompt ve sürüm artışı (Paket 64 ara dilim, 2. parça)

Kapsam: wire şeması, sistem talimatı, sürüm artışları ve gerçek Gemini kapısı. Migration/persistence, apply transaction, UI ve Chrome smoke bu parçada YOKTUR.

1. **Wire şemasına `categoryAllocation` eklendi.** Sekiz kategori de `required`; kullanılmayan kategori 0 taşır. **Toplam alanı bilerek İSTENMEZ** — sunucu toplamı sekiz kategoriden kendisi hesaplar ve satırın YALNIZ işçilik tutarıyla karşılaştırır.
2. **Talimat iki ekseni açıkça ayırır:** `allocations` işin ne olduğunu, `categoryAllocation` hangi branşın yaptığını söyler. Modele bunların dönüştürülemez olduğu, `remove_install` işinin parçaya göre kaporta veya mekanik olabileceği ve parça bedelinin kategori toplamına girmemesi gerektiği açıkça söylenir. Gizli kural tabanlı fallback eklenmedi.
3. **Sürümler yükseldi:** `labor-allocation-ai/2.0.0`, `labor-allocation-suggestion/2.0.0`, `gemini-generate-content/1.2.0`.
4. **Migration 0039** çalışma zamanı hatasını çözdü: 0031/0036 talimat ve çıktı sürümünü TEK literale sabitliyordu, yeni koşular yazılamıyordu. Kısıt gevşetilip serbest metne çevrilmedi; YALNIZ iki sürüme açıldı. Eski koşular 1.0.0 ile okunmaya devam eder.
5. **Döngüsel bağımlılık önlendi:** `labor-allocation-categories` artık `labor-allocation-ai`'den yalnız TİP alır; `AMBIGUOUS_OPERATION_TYPES` operasyon türleriyle aynı dosyaya taşındı. Aksi halde P57'deki çalışma zamanı döngüsü tekrarlanırdı.
6. Deterministik test harness'ı da sözleşmeye uyan kategori çıktısı üretir. Bu bir kural tabanlı dağıtıcı DEĞİLDİR ve üretim yolunda kullanılmaz.

**Gerçek Gemini kapısı — ölçülen sonuç:**

- İlk koşuda kapı GEÇTİ: `responseJsonSchema` HTTP 200 ile kabul edildi, istenen/dönen satır sayısı eşit, domain doğrulama hatası 0/2, `control_required` 4/4 (sunucu zorlaması korunuyor), PII/URL/path taraması temiz.
- Aynı koşuda iki kusur bulunup düzeltildi: (a) smoke betiği P62'den beri asenkron olan analizi beklemiyordu; (b) `isValidLineShape` yeni `categoryAllocation` anahtarını fazladan anahtar sayıp reddediyordu.
- **Sonraki iki teyit koşusu `AI_PROVIDER_TIMEOUT` verdi.** Kategori ekseni yanıtı büyüttüğü için çağrı süresi 30 sn'lik ÇAĞRI BAŞINA tavanın sınırına geldi. Tavan ÖLÇÜLMEDEN yükseltilmedi (HB-2026-068 kuralı). Bu, paketin tamamlanmasından önce ölçülmesi gereken açık risktir.

Paket bu nedenle TAMAMLANMIŞ SAYILMIYOR: kararlı geçen 2 satırlık kapı, migration/persistence, apply transaction, UI ve Chrome smoke kalan işlerdir.

## 2026-07-20 — HB-2026-075: Kategori dağılımı latency ölçümü (Paket 64 ara dilim, 3. parça)

Açık release kapısı artık şema uyumluluğu DEĞİL, 30 sn'lik çağrı tavanı altında tekrarlanabilir gecikmedir. Önce ölçüldü.

Ölçüm düzeneği genişletildi: aynı boyut için ardışık tekrar (`GEMINI_LOAD_REPEATS`), varsayılan ölçek `1,2,5,10,20`, çağrı başına süre/retry/finishReason/token/karakter ve kategori yapısı. Ham prompt, ham yanıt, plaka, dosya kimliği, yol ve anahtar KAYDEDİLMEZ. Ölçüm betiği de P62'den beri asenkron olan analizi beklemiyordu; bu düzeltildi.

**Gerçek Gemini, 2 satır, 5 ardışık tekrar:**

| # | Kapsama | Doğrulama | En uzun çağrı | Çıktı token | Çıktı karakter |
|---|---|---|---|---|---|
| 1 | tam | geçti | 17.755 ms | 965 | 3.201 |
| 2 | tam | geçti | 23.535 ms | 997 | 3.315 |
| 3 | — | `AI_PROVIDER_TIMEOUT` | 30.015 ms | — | — |
| 4 | — | `AI_PROVIDER_TIMEOUT` | 30.011 ms | — | — |
| 5 | — | `AI_PROVIDER_TIMEOUT` | 30.009 ms | — | — |

**Kapı KAPANMADI: 2/5 başarı, 3 timeout.** Ölçütler 5 ardışık başarı ve hiçbir başarılı çağrının 25 sn'yi aşmaması istiyordu; ikisi de sağlanmadı. Başarılı çağrılar bile 17–23 sn ile tavana bitişik.

Kanıtlanan darboğaz: **iki satır için ~1.000 çıktı token ve ~3.300 karakter.** Çıktı hacmi süreyi domine ediyor; girdi 841 token ile sabit ve küçük.

Ölçümün bilinen sınırı dürüstçe kaydedilir: `categoryCompleteLineCount` başarılı koşularda da 0 okundu çünkü kategori alanı henüz API yanıt DTO'sunda taşınmıyor. Domain doğrulaması geçtiği için kategori verisi geçerliydi; metrik yanlış yerden okuyordu. Kategori persistence'ı eklendiğinde bu metrik gerçek değeri gösterecek.

Tavan ÖLÇÜLMEDEN yükseltilmedi ve timeout sonrası gizli adaptif chunk küçültme EKLENMEDİ. Sıradaki iş, kanıtlanan darboğazı hedefleyen çıktı şeması küçültmesidir: satır düzeyinde tek gerekçe/güven/kanıt/kod listesi, gerekçelere açık `maxLength`, sıfır tutarlı kategoriler için ayrı metin istenmemesi.

## 2026-07-20 — HB-2026-076: Wire çıktısı küçültüldü; A/B ölçümü kota nedeniyle yapılamadı (Paket 64 ara dilim, 4. parça)

Önceki parçada "çıktı hacmi süreyi domine ediyor" ifadesi fazla kesin yazılmıştı. Bu bir HİPOTEZDİR; sağlayıcı değişkenliğinden ayırmak A/B ölçümü gerektirir ve o ölçüm bu parçada TAMAMLANAMADI.

Yapılan küçültme (yalnız sağlayıcı WIRE katmanı; domain ve kalıcı sözleşme şeması bozulmadı):

1. `categoryAllocation` nesnesi `categoryAmounts`'a indirildi: yalnız sekiz tam sayı. Kategori ekseni için AYRI `reasoning`, `confidence`, `evidenceRefs` ve `conflictCodes` artık İSTENMİYOR.
2. Satırın tek `reasoning`, `confidence` ve `evidenceRefs` alanı her iki ekseni de kapsıyor. Adaptör bunları domain modelindeki kategori alanına taşıyor — **uydurma yok**, taşınan değerler modelin kendi ürettiği satır düzeyi değerleri.
3. Çelişki kodları tek listede toplandı; adaptör `CATEGORY_` ön ekine göre iki eksene AYRIŞTIRIYOR ve hiçbir kod kaybolmuyor.
4. Talimattaki kategori bölümü tekrarları kaldırıldı; gerekçe 160, not 120 karakterle ve kanıt listesi 3 öğeyle sınırlandı. `maxLength` wire şemasına EKLENMEDİ: P59 ölçümü bu anahtarın Gemini `responseJsonSchema` alt kümesinde riskli olduğunu kaydetmişti, o bulgu korundu.
5. Sağlayıcı sürümü `gemini-generate-content/1.3.0`.

**Ölçüm sonucu: yapılamadı.** Küçültme sonrası 2 satır × 5 tekrar koşusunun tamamı `AI_PROVIDER_RATE_LIMITED` (429) döndü; ücretsiz katman kotası önceki ölçümlerle tükenmişti. Çağrılar ~2,7 sn'de temiz düştü, kontrollü retry ve **no-fallback davranışı doğru çalıştı**, hiçbir uydurma sonuç üretilmedi ve run temiz biçimde `failed` oldu.

Bu nedenle:

- Küçültmenin gecikmeye etkisi ÖLÇÜLMEDİ ve iyileşme İDDİA EDİLMİYOR.
- A/B (eski wire / kategori wire / küçültülmüş wire) karşılaştırması yapılmadı.
- 2 satırlık tekrarlanabilir kapı KAPANMADI.
- Model karşılaştırmasına geçilmedi; sıra önce küçültmenin ölçülmesinde.

Kota yenilendiğinde sıra: (a) küçültülmüş wire ile 2 satır × 5 tekrar, (b) A/B karşılaştırması, (c) kapı kapanırsa yeni güvenli chunk boyutu ölçümü. P61'deki 20 satır kararı geçersiz sayılmaya devam ediyor.

## 2026-07-20 — HB-2026-077: Ölçüm betiğine kota koruması (Paket 64 ara dilim, 5. parça)

Kota tükendiği için latency kapısı ölçülemiyor. Bu parça gerçek çağrı HARCAMADAN uygulanabilen tek işi yapar: ölçüm betiğinin boşa çağrı yakmasını engeller.

1. `GEMINI_LOAD_MAX_CALLS` (varsayılan 12) tek koşumda izin verilen toplam sağlayıcı çağrısını sınırlar.
2. İlk `AI_PROVIDER_RATE_LIMITED` sonucunda kalan tekrarlar ÇALIŞTIRILMAZ.
3. **Erken durdurma başarı sayılmaz:** `RUN_STOPPED_*` ve `INCOMPLETE_PLAN_n/m` açık başarısızlık olarak raporlanır. Aksi halde "kota bitti ama ok:true" gibi sahte bir yeşil üretilebilirdi.
4. `Retry-After` sağlayıcı tarafından güvenli biçimde yüzeye çıkarılmıyor; **tahmin ÜRETİLMEZ**, yokluğu `retryAfterAvailable: false` ile açıkça raporlanır.
5. Üretim davranışı değişmedi; koruma yalnız ölçüm betiğindedir.

Doğrulandı: korumalı koşu ilk 429'da durdu, planlanan 5 çağrı yerine **1 çağrı** harcadı ve `ok: false` döndü.

Kapı durumu değişmedi: küçültülmüş wire (`gemini-generate-content/1.3.0`) ölçülemedi, A/B yapılmadı, 2 satırlık tekrarlanabilir kapı AÇIK. Kota yenilendiğinde ilk ve tek iş: 2 satır × en fazla 5 çağrı, ilk timeout/429'da dur.

## 2026-07-20 — HB-2026-078: Kategori dağılımı kalıcılaştırma (Paket 64 ara dilim, 6. parça)

Gemini latency kapısı AÇIK kalmaya devam ediyor; bu parça onu kapanmış saymaz. Şema geçerliliği zaten kanıtlanmıştı (gerçek API HTTP 200 ile kabul etti, domain doğrulaması geçti), açık olan yalnız gecikmedir ve gecikme veri modelini etkilemez. Bu yüzden persistence kapıyı beklemeden yapıldı.

Migration 0040:

1. `labor_allocation_line_suggestions`: `proposed_category_amounts`, `category_schema_version`, `category_confidence`, `category_conflict_codes`.
2. `labor_allocation_applied_lines`: `proposed_category_amounts`, `applied_category_amounts`, `category_modified`, `category_schema_version`.
3. **Sekiz anahtar tamlığı, fazla anahtar yasağı, negatif olmayan tam sayı ve TOPLAM EŞİTLİĞİ veritabanı CHECK'inde durur.** Önerilen toplam öneri satırının, uygulanan toplam UYGULANAN satırın işçilik tutarına eşit olmalıdır. Uygulama katmanı atlansa bile tutarsız dağılım yazılamaz.
4. `category_modified` bayrağı GERÇEĞİ söylemek zorundadır: CHECK, bayrağı `proposed <> applied` ile karşılaştırır.
5. Alanlar birlikte null veya birlikte dolu olmak zorundadır; yarım provenance imkânsızdır.

**Uydurma yasağı — ölçülen davranış:** kullanıcı işçilik tutarını değiştirdiyse önerilen dağılım artık o satırı açıklamıyordur. Sayıları ölçekleyip "uygulanan dağılım buymuş" gibi sunmak uydurma olurdu; bunun yerine kategori provenance'ı BİLİNMİYOR bırakılır (dört alan da null) ve satır ileride manuel girişe düşer. Test bunu doğruluyor.

**Append-only gerçeği:** ilk yazdığım CHECK testleri UPDATE kullanıyordu ve başarısız oldu — çünkü her iki tablo da immutable ve guard trigger CHECK'ten ÖNCE devreye giriyor (`23001`). Testler gerçeğe uyarlandı; CHECK ayrıca doğrudan INSERT ile sınandı. Bu, kısıtın zayıf değil FAZLADAN korumalı olduğunu gösteriyor.

Geriye dönük uyumluluk: alanlar NULL kabul eder, eski kayıtlar okunabilir kalır ve sessizce "kategori dağılımı varmış" gibi yeniden yorumlanmaz. Gerçek kategori provenance'ı olmayan kayıtlar fiziksel Excel yazımına uygun sayılmayacak.

**Bu parça UI'ı İÇERMEZ.** Kategori inceleme/düzeltme ekranı, approved category history okuması ve profil 2.0.0 projeksiyonunun applied kategorilere bağlanması sonraki dilimdedir. Paket tamamlanmış DEĞİLDİR.

## 2026-07-20 — HB-2026-080: Kategori dağıtımı paketi kapanış kararları (Paket 64)

Karar:

1. **Excel sütunları operasyon türü değil işçilik dağıtım kategorisi (branş)
   eksenindedir.** İki eksen farklı soruları cevaplar: "iş neydi" ile "işi hangi
   branş yaptı". İlk tasarım bunları aynı sayıyordu; düzeltildi.
2. **Kategori tutarları yalnız AI'nin ürettiği öneriden veya kullanıcının
   onayladığı applied provenance'tan gelir; operasyon türünden TÜRETİLMEZ.**
   Türetme, kimsenin onaylamadığı bir dağılımı Excel'e yazmak olurdu.
3. **Kullanıcının düzelttiği applied dağılım güvenilir NİHAİ kaynaktır.** Satır
   düzeltildi diye projeksiyondan düşmez; düzeltme, dağılımı güvenilir kılan
   şeydir.
4. **İşçilik tutarı değişip kategori dağılımı yeniden girilmezse provenance
   BİLİNMİYOR kalır.** Otomatik ölçekleme yapılmaz; satır manuel girişe düşer.
5. **Projeksiyon yalnız completed applied kategori provenance'ı ve yazılabilir
   profil 2.0.0 ile üretilir.** Ham öneri, apply-preview, reddedilen satır,
   başarısız/iptal uygulama, eski profil ve bayat önizleme kaynak olamaz.
6. **Null, kısmi veya uyuşmayan kategori verisi YARIM Excel satırı üretmez.**
   Eşlenen kısmı yazıp gerisini bırakmak, Excel'de eksik satırı tam satır gibi
   gösterirdi; satır bütün olarak manuel girişe düşer.
7. **Çelişki karşılaştırması mutlak tutar değil kategori PAYI üzerindendir.**
   Fiyat revizyonu meşrudur; anlamlı olan işin branşlar arasında kaymasıdır.
   Tolerans `LABOR_CATEGORY_SHARE_TOLERANCE = 0.2`.
8. **History ve baseline çelişki kodlarını SUNUCU zorlar.** Model kodu üretmese
   bile gerçek karşılaştırma ayrışma gösteriyorsa kod basılır; modelin
   bildirdiği kodlar korunur, biri diğerini ezmez ve tekrarlanmaz. Çelişki tek
   başına `control_required` yapar.

Gerekçe: paket boyunca tekrar eden tek risk, eksik veriyi makul görünen bir
sayıyla doldurma eğilimiydi. Yukarıdaki kararların hepsi aynı ilkeyi farklı
noktalarda uygular: bilinmeyen bilinmiyor kalır.

Etki: `labor-allocation-categories/1.0.0`, `labor-category-allocation/1.0.0`,
`labor-excel-profile/2.0.0`, migration 0040–0041, `gemini-generate-content/1.3.0`.

**Açık kapılar (paket kapandı ama bunlar kapanmadı):**

- **Gemini 5/5 latency release kapısı AÇIK.** Kontrollü ölçüm 21.07.2026 10:15
  görevindedir; o zamana kadar yeni gerçek Gemini çağrısı yapılmaz.
- **Production Gemini provider açılışı KAPALI.** Release kapısı geçmeden
  açılmaz.
- **Fiziksel `.xlsx` yazımı HENÜZ UYGULANMADI.** Projeksiyon salt okunurdur.
- **File Agent OOXML güvenli yazım hattı sonraki pakettir.**
- **Gerçek workbook yoksa OLUŞTURULMAZ; hata verilir.** Şablon uydurmak,
  sigorta şirketinin beklediği biçimi tahmin etmek olurdu.

## 2026-07-21 — HB-2026-081: Sürücüde iki klasör düzeni bir arada desteklenir

Bağlam: fiziksel klasör yapısı sadeleştirildi. Güncel dosyalar sigorta şirketi
klasörü olmadan duruyor:

- Yalın: `<kök>\<yıl>\<Ay YYYY>\<PLAKA>` — örn. `2026\Temmuz 2026\47ACA535`
- Eski/arşiv: `<kök>\<yıl>\<Sigorta Klasörü>\<Ay YYYY>\<PLAKA>`

Karar:

1. **Sigorta klasörü seviyesi ZORUNLU DEĞİLDİR.** Çözümleyici iki düzeni de
   arar; yokluğu hata sayılmaz.
2. **Kapanan dosyalar ay klasörünün İÇİNDEKİ `KAPALI <AY> <YIL>` klasöründedir**
   ve bu her iki düzende geçerlidir.
3. **Klasör adı üretilip birebir denenmez; mevcut dizinler listelenip Türkçe
   harf duyarsız eşleştirilir.** Aynı ay için sürücüde hem `TEMMUZ 2026` hem
   `Temmuz 2026` görüldüğü için üretim tabanlı eşleştirme yanlış negatif verirdi.
4. **Birden fazla fiziksel konum eşleşirse otomatik seçim YAPILMAZ.** İki düzende
   birden ya da hem aktif hem kapalı konumda bulunursa `case_folder_ambiguous`
   döner ve bulunan TÜM konumlar raporlanır. Yanlış klasöre yazmak, bulamamaktan
   pahalıdır.
5. **Hangi fiziksel yolun seçildiği açıkça raporlanır** — sürücüde okunan gerçek
   adlarla, üretilmiş adlarla değil. Fiziksel sigorta klasörü adının ekrandaki
   şirket adıyla aynı olduğu VARSAYILMAZ; okunur.
6. Aynı plakanın ` - 2`, ` - 3` ekli kardeşleri AYRI vakalardır ve kendi klasör
   adlarıyla çözümlenir; plakadan tahmin edilmez.

Etki: `case-folder-path/2.0.0` (`lookupCaseFolder`). Bu modülün henüz tüketicisi
yoktur; File Agent OOXML yazım hattı paketinde kullanılacaktır. Halihazırda
çalışan `buildCaseWorkspaceBasePath` zaten yalın düzeni üretiyordu ve
değiştirilmedi.

## 2026-07-21 — HB-2026-082: Gemini gecikme release kapısı GEÇTİ (kapatıldı)

Kontrollü ölçüm 21.07.2026 10:15 sonrası çalıştırıldı ve **5/5 geçti**. Açık
kapılardan biri (HB-2026-080) kapandı.

Ölçüm koşulu: `GEMINI_LOAD_LINE_COUNTS=2`, `GEMINI_LOAD_REPEATS=5`,
`GEMINI_LOAD_MAX_CALLS=5`, `scripts/package61-gemini-load-smoke.mjs`.

Sonuç:

- Model: `gemini-3.5-flash`
- Provider: `gemini-generate-content/1.3.0`
- 5/5 başarılı çağrı; 429/timeout **0**
- En yüksek çağrı süresi **3534 ms** (25 sn eşiğinin ~7× altında)
- Her çağrıda 2/2 satır kapsaması
- Her satırda sekiz kategori tam; kategori toplamı = işçilik tutarı
- Domain doğrulama hatası **0**
- Usage metadata ve ledger tutarlı; receipt `finalized`
- PII / URL / fiziksel yol sızıntısı **0**
- Chunking sinyalleri (truncation/timeout/coverage-gap) hepsi false

**Bu sonuç production provider'ı OTOMATİK AÇMAZ.** Production enablement ayrı bir
deployment kararıdır ve şunlara bağlı kalır: deployment flag + organization
policy (`ai_provider_policies.labor_allocation_allowed_provider_ids`). Ölçüm,
gerçek sağlayıcının doğru çalıştığını kanıtlar; onu üretimde açmaz.

**Hâlâ açık:** production Gemini provider açılışı (deployment kararı) ve
**fiziksel `.xlsx` yazımı** (henüz uygulanmadı; Paket 65A/65B kapsamı).

## 2026-07-23 — HB-2026-083: Paket 66 Commit #1 bölünmüş provenance ve kaynak snapshot sınırı

Karar:

1. Snapshot identity `real-market-analysis/2026-07-01/1.0.0`; kaynak workbook
   SHA-256
   `81d3ae870cd5569b13371ec8b4de081a9a4e3e15098f7454f5d0cdcd3708c424`.
2. Workbook'un kanıtladığı `Tablolar!C3:C16` grup kodu sırası
   `A,A,B,B,C,C,C,D,D,D,Ç,E,F,Ç` olarak `source_workbook` provenance'ıyla
   korunur.
3. Araç adı → grup mapping provenance'ı BÖLÜNMÜŞTÜR. Yalnız TAKSİ→A,
   MİNİBÜS→B ve OTOBÜS→B `source_workbook` sayılır. Kalan 11 eşleşme
   `product-decisions.json` içinde açık `product_decision` kaydıdır.
4. Ürün kararı kayıtları workbook hücresi gibi sunulamaz ve
   `source_workbook` olarak yeniden etiketlenemez. Görev DOCX'i
   `source_workbook` değildir; orphan sharedStrings araç mapping'i üretmez.
5. `source_vehicle_name_column_incomplete` zorunlu anomalidir. F12/Z2
   validasyon listeleri, cached `#NAME?`/`#DIV/0!`, ters yaş tablosu, satır
   27/79 artığı, gizli Sheet1, kullanılmayan sigortacı ve piyasa katsayı
   tabloları, `YEAR(C13)`, M18/M19, unwired J11 ve SONRADAN EKLENENLER
   anomalileri kaybolmaz.
6. Altı aktif parça tablosu yalnız workbook'tan programatik çıkarılır.
   Placeholder ve sigortacı satırları dışlanır. SONRADAN EKLENENLER global
   aktif kural değildir.
7. Canonical snapshot dinamik timestamp taşımaz. Harici tam dosya yolu,
   workbook/DOCX/ham XML/scratch dosyası repository artefaktına girmez.
8. Commit #1 yalnız extractor/schema/snapshot/manifest/test/dokümantasyondur.
   Mevcut Paket 32 hesap davranışı, API, UI, persistence, migration ve
   fiziksel Excel yazımı AKTİVE EDİLMEZ; sonraki commit/paketlere geçilmez.

Gerekçe: Workbook gerçeğiyle ürün sahibinin tamamlayıcı kararını aynı provenance
etiketinde birleştirmek, kaynak kanıtını olduğundan daha güçlü gösterirdi.
Bölünmüş kayıt; eksikliği, kararı ve kaynağı ayrı ayrı denetlenebilir tutar.

Etki: `ooxml-readonly-extractor/1.0.0`,
`value-loss-rule-snapshot/1.0.0`,
`value-loss-product-decisions/1.0.0`,
`value-loss-rule-manifest/1.0.0`.

## 2026-07-23 — HB-2026-084: Paket 65A salt-okunur File Agent workbook preflight

Karar:

1. Paket 65A fiziksel Excel yazmaz. Daha önceki saf OOXML/immutable plan source
   çekirdeğini gerçek File Agent salt-okunur preflight'ına bağlar.
2. ZIP merkezi dizini arşiv açılmadan okunur. Entry count, compressed ve
   uncompressed toplam, compression ratio, şifreleme, duplicate ve zip-slip
   kapıları geçmeden `unzipSync` çalışmaz. ZIP64 normal ofis `.xlsx` girdisi
   için gerekli değildir ve fail-closed reddedilir.
3. Hedef worksheet part adı tahmin edilmez; package/workbook relationship
   zincirinden çözülür. Sheet görünür değilse veya header/identity içerik
   imzası uyuşmazsa plan kaynağı üretilemez.
4. Makro/VBA, dijital imza, embedded object ve external link yalnız part adına
   bakılarak değil relationship XML'leri de incelenerek reddedilir.
5. Mutlak storage root Agent process'inden çıkmaz. Kaynak güvenli göreli yolla
   çözülür, symlink/root escape reddedilir ve çözülmüş güvenli gerçek yol
   üzerinden okunur.
6. Kaynak iki kez okunur; hash veya boyut değişirse preflight başarısızdır.
   Expected hash/size verildiyse uyuşmazlık sessizce güncel kabul edilmez.
7. Paket 65B; job kuyruğu, migration, contracts/API/UI, explicit approval,
   backup, temp, verify, atomik replace, rollback ve gerçek kopya smoke'unu
   ayrı kritik işlem olarak uygular. Paket 65A bunların hiçbirini aktive etmez.

Gerekçe: File Agent'ın gerçek arşivi doğrudan açması, saf domain limitlerinin
zip-bomb öncesi uygulanmadığı anlamına gelirdi. Preflight'ın yazımdan ayrı ve
salt-okunur kalması plan/onay/uygula sınırını korur.

Etki: `labor-workbook-preflight/1.0.0`,
`labor-workbook-agent-preflight/1.0.0`.

## 2026-07-23 — HB-2026-085: Paket 65B güvenli workbook fiziksel yazım çekirdeği

Karar:

1. Fiziksel yazım File Agent içinde iki ayrı çağrıdır: salt-okunur preview
   immutable plan hash'i üretir; apply yalnız aynı hash'e bağlı açık kullanıcı
   onayıyla ilerler. Apply, 65A preflight'ını lock altında yeniden çalıştırır.
2. Bu dilimdeki tek izinli fiziksel hedef doğrulanmış worksheet üzerindeki
   `D2:D1048576` hücreleridir. `H–N`, diğer sütunlar, imza hücreleri ve formüllü
   hücreler fail-closed reddedilir. Değer inline string yazılır; sharedStrings,
   formül cache'i ve diğer OOXML part'ları değiştirilmez.
3. Kaynak yanında zaman damgalı `.bak.xlsx` `COPYFILE_EXCL` ile oluşturulur ve
   byte-for-byte doğrulanır. Geçici `.xlsx` aynı dizinde yazılıp fsync edilir;
   yalnız hedef worksheet part'ının beklenen D hücre yamalarıyla değiştiği ve
   diğer bütün part'ların byte içeriğinin korunduğu doğrulanır.
4. Temp workbook 65A preflight'ından tekrar geçmeden replace yapılmaz. Kaynak
   replace öncesi yeniden okunur; aynı-workbook exclusive lock ikinci Agent
   yazımını engeller. Replace aynı volume atomik rename ile yapılır.
5. Replace sonrası doğrulama veya completed audit kaydı başarısızsa backup'tan
   aynı dizindeki recovery temp üzerinden atomik rollback yapılır. Başarısız
   sonuç başlangıç byte'larının korunup korunmadığını açıkça taşır.
6. Audit olayı plan hash, göreli workbook yolu, hedef sheet, D hücre adresleri,
   kullanıcı/onay zamanı, başlangıç/sonuç SHA-256, backup basename ve kapalı
   güvenli hata kodu taşır. Mutlak yol, hücre değerleri ve ham hata taşımaz.
7. Mevcut model D hücre değerlerini ve satır eşlemesini üretmediği için bunlar
   uydurulmadı. PostgreSQL operation/job, contracts/API/UI entegrasyonu ayrı
   runtime dilimidir; bu karar yalnız çağrılabilir fiziksel çekirdeği açar.

Gerekçe: Tam workbook nesne modeliyle yeniden üretim hedef dışı hücre ve
özellikleri sessizce değiştirebilir. Cerrahi OOXML yamalama + part karşılaştırma,
backup, temp doğrulama, atomik replace ve rollback zinciri hedef dışı içeriğin
korunduğunu ölçülebilir kılar.

Etki: `labor-workbook-write-plan/2.0.0`,
`labor-workbook-write/1.0.0`.

## 2026-07-24 — HB-2026-086: Paket 65B approved runtime apply zinciri

Karar:

1. Workbook'a yazılabilen tek değer current İşçilik revision'ına bağlı,
   tamamlanmış uygulamanın approved/final minor-unit değeridir. AI proposed değer
   yazılmaz; kullanıcı düzeltmesinde proposed/final ve manuel değişiklik bilgisi
   ayrı korunur.
2. Satır eşleme fuzzy değildir. Kullanıcının preview isteğindeki immutable
   source-row referansı D hücresine çevrilir; part code/source ve operation type
   zorunlu kanıttır. File Agent exact row XML hash'ini plan gözlemine bağlar.
3. Düzeltilmemiş AI `control_required`/eksik-evidence satırı job üretmeden
   bloklanır. Kullanıcının açık final değer/kategori düzeltmesi workbook apply
   snapshot'ı için çözüm sinyalidir; eski öneri provenance'ı silinmez.
4. API yalnız immutable operation ve mevcut `jobs` queue kaydı üretir. Fiziksel
   preview/apply yalnız File Agent'ta, tenant kapsamlı lease altında çalışır.
5. Approval; operation version, plan hash, approved snapshot hash, current
   revision/profile/application durumuna bağlıdır. Replay tek apply job döndürür.
6. Lock job/agent/zaman/start hash metadata'sı taşır. Yaşına bakılarak otomatik
   silinmez; yetkili recovery ürün sözleşmesi bulunmadığından fail-closed kalır.
7. UI mevcut İşçilik çalışma alanında satır eski/yeni, toplam, provenance,
   manuel değişiklik, conflict, açık onay, job, backup ve sonuç durumunu gösterir;
   API modunda mock fallback yoktur.
8. Audit hücre değerini veya mutlak yolu taşımaz; organization/case/revision/job,
   actor, göreli referans, plan/start/result hash, hücre adresi ve backup basename
   taşır.

Gerekçe: Writer çekirdeğinin güvenliği ancak değer kaynağı, exact satır kimliği,
onay ve job sonucu aynı immutable zincirde doğrulanırsa runtime'da korunabilir.
Parça adına dayalı tahmin veya API'den doğrudan filesystem yazımı bu zinciri
kırardı.

Etki: `labor-workbook-apply/1.0.0`, migration `0044`,
`preview_labor_workbook_apply`, `apply_labor_workbook`.

## 2026-07-25 — HB-2026-087: Üretim dependency advisory'lerinin lockfile içinde çözülmesi

Karar:

1. Dependency advisory'leri yalnız mevcut semver aralığı içinde lockfile
   yenilemesiyle çözülür. `package.json` değiştirilmez, `overrides` eklenmez,
   `npm audit fix` / `--force` çalıştırılmaz ve yeni dependency alınmaz.
2. Paket 65B'yi bloke eden iki bulgu bu yolla kapatıldı: `fast-uri`
   3.1.3 → 3.1.4 ve 4.1.0 → 4.1.1; `find-my-way` 9.6.0 → 9.7.0. Her ikisi de
   `fastify@5.10.0` transitive zincirindedir ve `fastify` sürümü sabit kalmıştır;
   Fastify major yükseltmesi gerekmedi.
3. Aynı yenileme `postcss` 8.5.16 → 8.5.23 (dev, `vite@8.1.4`) ve
   `brace-expansion` 5.0.7 → 5.0.8 (üretimde `node-pg-migrate` → `glob` →
   `minimatch@10`) bulgularını da kapatır. `nanoid` 3.3.15 → 3.3.16 aynı aralıkta
   yan güncellemedir.
4. Advisory bastırma, ignore listesi veya audit seviyesini düşürme kabul edilmez;
   vulnerable sürüm dependency ağacından gerçekten kalkmalıdır.
5. Semver-major yükseltme gerektiren advisory otonom kapatılmaz. Kalan iki küme
   kullanıcıya sorulmuş ve **2026-07-25'te her ikisi de ayrı pakete
   alınmıştır**; dependency bakım commit'i kapsamında yükseltilmezler:
   - `eslint@9.39.4` → `minimatch@3.1.5` → `brace-expansion@1.1.16` (5 high,
     yalnız dev). `minimatch@3` `^1.1.7` ister ve advisory `<=5.0.7` olduğundan
     yamalı 1.x yayımlanmamıştır. Bildirilen düzeltme `eslint@10.8.0`'dır.
     `brace-expansion@1` CJS `main`, `@5` ise `exports` haritalı dual paket
     olduğundan override ile zorlanması uyumsuz yerleştirme sayılır.
   - `react-router@7.18.1` ← `react-router-dom@7.18.1` (tam pin) ← kök `^7.1.1`
     (2 high, üretim UI). Advisory `7.12.0 - 8.2.0`; yamalı tek sürüm
     `react-router@8.3.0`, `react-router-dom@8.x` yok. Düzeltme v8 major geçişi
     ve 22 kaynak dosyada import taşıması demektir.
6. Kalan bulguların kapsamı belgelenir: `brace-expansion@1` yalnız lint
   araç zincirinde, `react-router` bulgusu ise RSC modunda geçerlidir. Repository
   Vite SPA'sıdır; RSC ve react-router sunucu runtime'ı kullanılmaz. Bu kapsam
   notu bulguyu kapatmaz, yalnız aciliyetini sınıflandırır.

Gerekçe: Güvenlik kapısı gerçek dependency değişikliğiyle kapanmalıdır; ancak
major yükseltme lint kuralları veya üretim yönlendirme davranışı gibi kabul
edilmiş davranışları değiştirebileceğinden dependency bakımının kapsamı dışındadır
ve ayrı kullanıcı kararı gerektirir.

Etki: yalnız `package-lock.json`. Kod, şema, migration, API sözleşmesi ve UI
davranışı değişmedi; Paket 65B ve Paket 66 invariantları korunur.

Kullanıcı kararı (2026-07-25): `react-router` v8 geçişi ve `eslint` 10
yükseltmesi ayrı paketlere alınmıştır. Her ikisi de kendi tam regresyonuyla
yürütülecektir; `react-router` paketi ayrıca gerçek tarayıcı smoke'u gerektirir.
Bu iki high bulgu o paketler kapanana kadar bilinen ve kapsamı belgelenmiş açık
bulgu olarak kalır. Audit kapısı bu nedenle `7 high / 0 critical` ile açıktır ve
bu durum PASS sayılmaz. `react-router` kümesi HB-2026-088 ile kapatılmıştır.

## 2026-07-25 — HB-2026-088: UI yönlendirmesi React Router v8'e taşındı

Karar:

1. Üretim UI advisory'si (GHSA-qwww-vcr4-c8h2) gerçek dependency değişikliğiyle
   kapatılır. `react-router-dom` kaldırılır ve doğrudan dependency olarak
   `react-router@^8.3.0` kullanılır. Advisory ignore edilmez, audit seviyesi
   düşürülmez ve kabul edilmiş risk olarak kapatılmaz.
2. Geçiş yalnız import belirteci düzeyindedir. 22 dosyada
   `from 'react-router-dom'` → `from 'react-router'` değişir; route tanımları,
   URL sözleşmesi, bileşen ve hook kullanımı aynı kalır.
3. Kullanılan API yüzeyi (`BrowserRouter`, `MemoryRouter`, `Routes`, `Route`,
   `NavLink`, `useNavigate`, `useLocation`, `useParams`, `useSearchParams`) v8'de
   değişmemiştir. `RouterProvider` v8'de `react-router/dom`'a taşınmıştır ancak
   bu repository declarative router kullandığından etkilenmez.
4. v8 breaking change'lerinin tamamı Framework mode, data router, `meta`/
   `useMatches` ve Cloudflare eklentisi kapsamındadır; HasarBotu Vite SPA'sı
   bunların hiçbirini kullanmaz. RSC, SSR veya server runtime eklenmez.
5. Route yolları ve URL sözleşmesi korunur: `/`, `/dosyalar`,
   `/dosyalar/:caseId`, `/kapanan-dosyalar`, `/raporlar-ve-ucretler`,
   `/mevzuat-ve-ai`, `/bildirimler`, `/yonetim`, `/ayarlar` ve `*` catch-all.
   Dosya içi sekmeler route değil bileşen durumudur; nested route ve `Outlet`
   kullanılmaz.
6. Sürüm aralığı `^8.3.0`'dır. Yamalı ilk sürüm 8.3.0 olduğundan alt sınır
   advisory sınırının üstündedir. Kurulu `react`/`react-dom` 19.2.7, v8'in
   `>=19.2.7` peer koşulunu karşılar; React sürümü bu pakette değiştirilmez.
7. Geçiş `scripts/router-v8-browser-smoke.mjs` ile gerçek Chrome/CDP, gerçek API
   ve gerçek PostgreSQL üzerinde doğrulanır. Smoke yeni E2E dependency'si
   eklemez; mevcut CDP altyapısını kullanır.

Gerekçe: Advisory yalnız v8'de yamalıdır ve `react-router-dom@7` v7'yi tam sürüm
pinlediğinden aralık içinde çözüm yoktur. Uyumsuz override yerleştirmek yerine
upstream'in öngördüğü paket birleşmesi uygulanmıştır; kullanılan API yüzeyi
değişmediği için geçiş davranış riski taşımaz.

Etki: `package.json`, `package-lock.json`, 22 UI dosyasının import satırı ve yeni
`scripts/router-v8-browser-smoke.mjs`. Route/URL sözleşmesi, Paket 65B, Paket 66
ve Paket 40 davranışları değişmedi. Audit `7 high` → `5 high / 0 critical`.

## 2026-07-25 — HB-2026-089: ESLint 10 yükseltmesi ve React Compiler kurallarının kapsamı

Karar:

1. Kalan dev-only advisory kümesi `eslint@10.8.0` yükseltmesiyle kapatılır.
   `eslint@10` doğrudan `minimatch@^10.2.5`'e bağlı olduğundan `minimatch@3.1.5`
   ve yamalı sürümü bulunmayan `brace-expansion@1.1.16` ağaçtan tamamen kalkar.
   Advisory ignore edilmez, audit seviyesi düşürülmez.
2. Yükseltme kümesi: `eslint@^10.8.0`, `@eslint/js@^10.0.1`,
   `eslint-plugin-react-hooks@^7.1.1`, `eslint-plugin-react-refresh@^0.5.3`.
   `typescript-eslint` ve `globals` değişmez. `eslint-plugin-react-hooks@7.1.1`
   ESLint 10 peer'ini taşıyan ilk sürüm olduğundan v5 → v7 sıçraması zorunludur.
3. Flat config korunur. `.eslintrc` ve `eslint-env` kullanılmadığından ESLint
   10'un bunlara ilişkin breaking change'leri etkisizdir.
4. **Lint kapsamı değiştirilmez.** ESLint 9.39.4 ve 10.8.0 altında ölçülen dosya
   sayısı aynıdır (1.407 dosya, 670 workspace `dist` dosyası dahil). Workspace
   `dist` klasörlerinin lint edilmesi bu paketten önce de mevcuttur ve kapsam
   değişikliği sayılacağı için bu pakette düzeltilmez.
5. `eslint:recommended`'a eklenen kuralların bulduğu üç gerçek kusur
   (`no-useless-assignment` ×2, `preserve-caught-error` ×1) **kod düzeltilerek**
   giderilir; kural devre dışı bırakılmaz veya seviyesi düşürülmez.
6. `eslint-plugin-react-hooks` v7'nin `recommended` seti 2 kuraldan 16 kurala
   çıkar. Paket öncesi lint sözleşmesi birebir korunur: `rules-of-hooks` error,
   `exhaustive-deps` warn. Yeni 14 React Compiler kuralı **kapatılmaz**;
   `eslint.config.js` içinde `REACT_COMPILER_RULES_PENDING_ADOPTION` listesiyle
   adlarıyla sayılarak `warn` seviyesinde açık bırakılır. Böylece bulgular
   görünür kalır, yeni ihlaller anında raporlanır ve kapı bloke olmaz.
7. Bu kuralların `error` seviyesine çıkarılması ve mevcut 34 uyarının giderilmesi
   ayrı "React Compiler kural adaptasyonu" paketidir. Uyarıların çoğu
   `src/data` veri çekme hook'larındaki `set-state-in-effect` desenidir; yükleme
   durumu kullanıcıya görünür olduğundan tam UI testi ve gerçek tarayıcı smoke'u
   gerektirir.

Gerekçe: Advisory'nin tek gerçek çözümü ESLint 10'dur ve bu, uyumluluk zinciri
nedeniyle react-hooks v7'yi de zorunlu kılar. v7'nin getirdiği yeni kural setini
sessizce kapatmak lint sözleşmesini gizlice gevşetir; hepsini `error` yapmak ise
dependency güvenlik paketini veri katmanı refactor'üne dönüştürürdü. `warn`
seviyesi ikisinin de tuzağına düşmeden bulguyu görünür ve izlenebilir tutar.

Etki: `package.json`, `package-lock.json`, `eslint.config.js` ve üç gerçek kusur
düzeltmesi (`services/api/src/policy-ai/store.ts`,
`services/api/src/workspace/store.ts`,
`services/file-agent/test/pdf-text-extractor.test.ts`). Runtime davranışı,
şema, API sözleşmesi ve UI değişmedi. Audit `5 high` → **0 bulgu (her seviyede)**.

## 2026-07-25 — HB-2026-090: React Compiler kurallarının aşamalı benimsenmesi

Karar:

1. `eslint-plugin-react-hooks` v7'nin getirdiği 14 Compiler kuralından **13'ü**
   override edilmez ve upstream `recommended` seviyesinde çalışır: 11 kural
   `error` (`config`, `error-boundaries`, `gating`, `globals`, `immutability`,
   `preserve-manual-memoization`, `purity`, `refs`, `set-state-in-render`,
   `static-components`, `use-memo`), 2 kural (`incompatible-library`,
   `unsupported-syntax`) upstream'in kasıtlı tercihiyle `warn`. Bu 13 kuralda
   ihlal yoktur. Upstream'in `warn` tercihi `error`'a zorlanmaz.
2. Paket öncesi lint sözleşmesi korunur: `rules-of-hooks` error,
   `exhaustive-deps` warn.
3. `preserve-manual-memoization` bulgusu gerçek kusurdur ve giderilmiştir.
   `useTrafficValueLoss.preview` `useCallback`'i `assessment?.version`
   bildiriyordu; React Compiler bunu `assessment` olarak çıkarımladığı için
   memoization'ı koruyamıyor ve bileşenin tamamını optimizasyon dışı bırakıyordu.
   Sürüm `assessmentVersion` primitifine indirgendi. Çağrıya giden değer
   (`assessment?.version ?? 0`) aynıdır; davranış değişmemiştir.
4. `set-state-in-effect` **kapatılmaz**, `warn` seviyesinde açık kalır. 33
   bulgunun tamamı tek tek incelenmiştir ve hiçbiri davranışsal kusur değildir:
   - 23 bulgu async yükleme öncesi durum sıfırlamasıdır. Senkron sıfırlama
     kaldırılırsa yeni anahtar için eski veri gösterilir. Bütün adapter
     kimlikleri `useMemo`/`useState` ile kararlıdır (sonsuz yeniden istek yok);
     her fetch `cancelled` muhafazası taşır (yarış durumu yok).
   - 5 bulgu anahtar değişiminde fail-closed sıfırlamadır. `approvedIdentity`
     render sırasında kimlik karşılaştırmasıyla hesaplandığından bayat onay
     frame'i oluşmaz; `promotionApproved` ise sunucuda `reviewSetHash` ile
     bağlıdır (`services/api/src/policy-ai/review-store.ts:381` uyuşmazlığı
     reddeder) ve istemci idempotency kimliği aynı hash'i içerir.
   - 3 bulgu yeni seçenek listesine karşı yakınsayan seçim mutabakatıdır.
   - 2 bulgu saat okuması ve fetch sonrası sayfa kelepçelemesidir. `Date.now()`
     render'a taşınırsa `react-hooks/purity` ihlal edilir.
5. Bu 33 bulgunun render sırasında türetilmesi `src/data` hook'larının state
   şeklinin yeniden kurulmasını gerektirir. Bu, dependency/lint paketlerinin
   kapsamı dışıdır ve ayrı "veri katmanı yükleme durumu türetmesi" paketine
   bırakılmıştır. O paket tamamlandığında kural `error` seviyesine çıkarılır.

Gerekçe: Kuralları toplu biçimde `error` yapmak, gerçek bir kusur bulunmadığı
halde veri katmanını yeniden yazmayı zorunlu kılardı; toplu biçimde kapatmak ise
13 kuralın gerçek koruma değerini kaybettirirdi. Kural bazında kanıta dayalı
ayrım, korumayı en yüksek seviyede tutarken davranış riskini sıfırda bırakır.

Etki: `eslint.config.js` ve `src/data/useTrafficValueLoss.ts`. Runtime davranışı,
route/URL sözleşmesi, Paket 65B, Paket 66 ve Paket 40 davranışları değişmedi.
Lint `0 error / 34 warning` → `0 error / 33 warning`.

## 2026-07-25 — HB-2026-091: Lint kapsami uretilmis ciktiyi disliyor

Karar:

1. Flat config global ignore deseni `['dist', 'coverage']` yerine
   `['**/dist/**', '**/coverage/**']` olur. Yalin `dist`
   deseni config dosyasinin dizinine gore cozuldugu icin yalniz kok `dist/`i
   disliyor, workspace `dist` klasorlerini disarida birakmiyordu.
2. Kaynak lint kapsami DEGISMEZ. Degisiklik oncesi ve sonrasi lint edilen kaynak
   dosya listesi cikarilip karsilastirilmistir: her ikisi de 737 dosyadir ve
   listeler birebir aynidir.
3. Kural seviyeleri bu pakette degistirilmez. Bulgu sayisinin sabit kalmasi
   (0 error / 33 warning) `dist` icinde saklanan bir bulgu olmadigini ve kural
   gevsetmesi yapilmadigini kanitlar.
4. Kapsam disi kalan 670 uretilmis dosya: `services/api/dist` 270,
   `packages/contracts/dist` 250, `packages/domain/dist` 100,
   `services/file-agent/dist` 36, `packages/database/dist` 14.

Gerekce: Build ciktisi kaynak kod degildir; lint edilmesi sure ve gurultu
maliyeti disinda deger uretmez. Desen duzeltmesi kapsam daraltmasi degil, en
bastan amaclanan davranisin dogru ifade edilmesidir.

Etki: yalniz `eslint.config.js`. Lint edilen dosya 1.407 -> 737, sure
14.373 ms -> 11.257 ms. Kaynak kapsami, kural seviyeleri, runtime davranisi ve
bulgu sayisi degismedi.

## 2026-07-25 — HB-2026-092: Veri hooklarinda anahtarli yukleme durumu turetmesi

Karar:

1. Veri cekme hooklarinda yuklenen veri, ait oldugu ISTEK ANAHTARI ile birlikte
   tek bir state nesnesinde tasinir. Anahtar degisince yukleme durumu RENDER
   sirasinda turetilir; efekt icinde senkron `setState` kullanilmaz.
2. Bu yalniz lint uyarisini kaldirmaz; iki gercek iyilestirme saglar:
   - Bayat veri frame'i ortadan kalkar. Onceden anahtar degistiginde bir render
     eski veriyi yeni anahtarla gosteriyordu.
   - Yaris durumuna karsi ikinci savunma olusur: yanit kendi anahtariyla yazilir,
     gec donen onceki istek anahtari tutmadigi icin yok sayilir.
3. Donusum toplu yapilmaz. 1. dilimde 7 hook ayri ayri incelenip donusturuldu:
   `useCase`, `useCaseDocuments`, `useCaseOperations`, `useEmailDrafts`,
   `useLabor`, `usePert`, `useCasePage`.
4. Kasitli ve belgelenmis davranis farki: ayni anahtar icin onceden yuklenmis
   veri, hook yeniden etkinlestiginde `loading` flash'i olmadan gorunur ve efekt
   yine de yeniden okur. Baska bir case'in verisi hicbir kosulda gosterilmez.
5. Cok state dilimli hooklar (`usePolicyOcr` 16, `useReportsFees` 12,
   `usePolicyPdfText` 11, `useTrafficValueLoss` 10) sonraki dilime birakilir;
   bunlarda anahtar tek istek degil birbirine bagli kaynak zinciridir.
6. Iki bulgu bu kuralla GIDERILEMEZ ve kalici istisna adayidir:
   `LaborAllocationAiModule` saat okumasi (`Date.now()` render'a tasinirsa
   `react-hooks/purity` ihlal edilir) ve `CasesPage` fetch sonrasi sayfa
   kelepcelemesi (`totalPages` ancak yanittan sonra bilinir). Bu nedenle
   `set-state-in-effect` kurali `error` seviyesine ancak dosya bazli istisna
   tanimlandiktan sonra cikarilabilir.

Gerekce: Anahtari state icinde tasimak, yukleme durumunu turetilebilir kilar ve
senkron sifirlamayi gereksizlestirir. Boylece kural ihlali ortadan kalkarken
bayat veri ve yaris durumu korumasi zayiflamaz, aksine guclenir.

Etki: 7 hook dosyasi. Route/URL sozlesmesi, Paket 65B, Paket 66 ve Paket 40
davranislari degismedi. `set-state-in-effect` 33 -> 26.

## 2026-07-25 — HB-2026-093: Orta karmasiklikta veri hooklarinda anahtarli turetme (2. dilim)

Karar:

1. HB-2026-092 deseni dort orta karmasiklikta hook'a uygulanir:
   `useOperationalAlerts`, `usePolicyAnalysis`, `usePolicyAi`,
   `useTrafficValueLossReports`. Her biri ayri incelenip ayri dogrulanmistir.
2. Istek anahtarlari acikca tanimlanmistir: sirasiyla
   `caseIdKey#reloadToken`, `caseId#requestVersion#refreshToken`,
   `caseId#version` ve `caseId#requestVersion`.
3. Yalniz yukleme degil, ayni veriye yazan BUTUN yollar anahtar korumali hale
   gelir. `usePolicyAi`'de `plan`, `start`, `review`, `promote` ve `fail`;
   `useTrafficValueLossReports`'ta `load`, `run`, `clearPreview`,
   `previewReport` ve `generateReport`; `usePolicyAnalysis`'te `evaluate` hata
   yolu. Boylece gec donen bir mutasyon sonucu daha yeni bir istegin state'ini
   ezemez.
4. `usePolicyAi`'de `plan` ve `start` iyimser sonucu, hemen ardindan gelen surum
   artisinin anahtarina yazar. Bu, Paket 23 akisindaki iyimser frame'i birebir
   korur; aksi halde iyimser sonuc hic gorunmeden `loading`'e duserdi.
5. `useOperationalAlerts`'te filtre istenip gorunur satir olmadigi durum
   (`caseIdKey === ''`) cagri yapilmadan `ok`/bos donmeye devam eder.
6. `useTrafficValueLossReports`'ta rapor onizlemesi de anahtarli state icinde
   tasinir. Teorik olarak hook devre disi birakilip ayni anahtarla yeniden
   etkinlestirilirse onceki onizleme yeniden gorunebilir; bu yol iki kez
   kapalidir: Paket 66 immutable revision nedeniyle onay durumu degisimi yeni
   version id uretir ve panel `version?.id` degisiminde onizlemeyi temizler;
   ayrica sunucu `report-store.ts:235` uretilen icerigin hash'i `previewHash`
   ile uyusmazsa `preview_mismatch` ile reddeder.
7. Bu dilimde `eslint-disable`, kural istisnasi veya `eslint.config.js`
   degisikligi yapilmaz. Kapsam disi birakilan `usePolicyOcr`, `useReportsFees`,
   `usePolicyPdfText`, `useTrafficValueLoss`, `LaborAllocationAiModule` ve
   `CasesPage` dosyalarina dokunulmaz.

Gerekce: Orta karmasikliktaki hooklarda anahtar tek ve acikca tanimlanabilir
oldugundan desen guvenle uygulanabilir. Cok durumlu dort hookta anahtar tek
istek degil birbirine bagli kaynak zinciri oldugundan ayri dilime birakilmistir.

Etki: 4 hook dosyasi. Loading, error, retry, empty ve fail-closed davranislari
degismedi. Paket 23, Paket 65B, Paket 66 ve Paket 40 davranislari korunur.
`set-state-in-effect` 26 -> 22.

## 2026-07-25 — HB-2026-094: Cok durumlu veri hooklarinda anahtarli turetme (3. dilim)

Karar:

1. Dort cok durumlu hook toplu degil, dort ayri atomik commit ile donusturulur:
   `usePolicyPdfText`, `useReportsFees`, `usePolicyOcr`, `useTrafficValueLoss`.
   Paket 66 acisindan en kritik olan `useTrafficValueLoss` sona birakilir.
2. Anahtarlama hook basina gerektigi kadar yapilir, mekanik olarak tum dilimlere
   uygulanmaz:
   - `usePolicyPdfText` ve `usePolicyOcr`'da yalniz yukleme durumu (ve OCR'da
     ayrica secili extraction'a bagli PDF sayfa listesi) anahtarlanir.
     Kaynak/extraction/run/element dilimleri orijinalde de yukleme suresince
     onceki degerlerini korur; anahtarlanmalari davranis degisikligi olurdu.
     Yaris korumasi her anahtar degisiminde yeniden calisan efektin `cancelled`
     bayragiyla saglanir.
   - `useReportsFees` dort bagimsiz hook icerir. Iki liste hook'unun degisen
     istek anahtari yoktur; yalniz `enabled` ve port yetenegi kapisi vardir ve
     bunlar render sirasinda turetilir.
   - `useTrafficValueLoss`'ta yukleme kapsamindaki butun dilimler tek anahtarli
     nesnede tasinir ve butun yazicilar anahtar korumalidir.
3. `useReportsFees` liste hooklarinin baslangic durumu 'idle' yerine 'loading'
   olur; ilk okumadan onceki kisa 'idle' frame'i kalkar. Devre disiyken donen
   deger yine 'idle'dir.
4. Bundle butce kapisi bu dilimde gercekten kirildi (500.125 bayt / 500.000).
   Butce YUKSELTILMEZ. Cozum, eklenen kodun runtime maliyetini dusurmektir:
   modul duzeyi bos-durum fabrikasi ve sabitleri, tekrar eden anahtar korumali
   kapanislarin tek `patch` yardimcisinda toplanmasi, ifade govdeli sarmalayici.
   Sonuc 499.997 bayttir.
5. `eslint-disable`, kural istisnasi veya `eslint.config.js` degisikligi yoktur.
   Kapsam disi birakilan `LaborAllocationAiModule` ve `CasesPage` dosyalarina
   dokunulmaz.

Gerekce: Bu hooklarda anahtar tek istek degil birbirine bagli kaynak zinciridir.
Butun dilimleri mekanik olarak anahtarlamak, orijinalde kasitli olarak korunan
ara verileri silerdi. Anahtarlama yalnizca yukleme durumunun turetilebilmesi
icin gereken en dar kapsamda uygulanmistir.

Etki: dort hook dosyasi ve bir bundle boyut duzeltmesi. Loading, error, retry,
empty ve fail-closed davranislari degismedi. Paket 23, Paket 40, Paket 65B ve
Paket 66 davranislari korunur. `src/data` icinde `set-state-in-effect` kalmadi;
toplam 22 -> 14.

Kalan risk: baslangic JavaScript grafigi 500.000 baytlik butcenin 3 bayt
altindadir. `src/data` barrel'i butun veri hooklarini baslangic grafigine
cektigi icin, bu hooklarin cogu yalniz lazy `CaseDetailPage` icinde kullanilsa
da butceye yazilmaktadir. Sonraki her ekleme bu kapiyi kirabilir; barrel
bolunmesi ayri bir teknik temizlik konusudur.

## 2026-07-25 — HB-2026-095: src/data barrel'i kaldirildi, dogrudan modul importuna gecildi

Karar:

1. `src/data/index.ts` barrel'i kaldirilir ve butun tuketiciler dogrudan modul
   importu kullanir (`../../data/<modul>`).
2. Gerekce olcumle tespit edilmistir: barrel'den hem baslangic grafigindeki
   sayfalar hem de lazy `CaseDetailPage` alt agaci import ettigi icin bundler
   birlesik bir paylasilan chunk uretiyordu. 129.686 baytlik `data-*.js`
   baslangic grafigine giriyor ve yalniz lazy sayfalarda kullanilan hooklar da
   oraya yaziliyordu.
3. Donusum mekanik degil dogrulanabilir yapildi: sembol -> modul eslemesi
   barrel'in kendisinden uretildi, tip-only importlar `import type` olarak
   korundu, sonuc typecheck ile dogrulandi. 66 dosyada 66 import ifadesi
   degisti.
4. Iki test dosyasindaki `vi.mock('../../data', ...)` cagrisi gercek modul
   `../../data/useDashboard` hedefine cevrildi; stub davranisi aynidir.
5. Bundle butcesi YUKSELTILMEZ (500.000). Baslangic grafigi 499.997 -> 412.566
   bayt; boslugu 3 bayttan 87.434 bayta cikti. Baslangic asset sayisi 16 -> 2.
6. Runtime davranisi, route yapisi, API sozlesmeleri ve hook imzalari
   degismez. Yeni dependency eklenmez. Circular dependency uyarisi olusmadi.

Gerekce: Her seyi re-export eden bir barrel, lazy sinirlarini bundler acisindan
gorunmez kilar. Dogrudan modul importu, lazy bolunmeyi gercekten etkili hale
getirir ve baslangic grafigini yalnizca gercekten gereken kodla sinirlar.

Etki: 66 kaynak dosyasinda import satirlari, silinen `src/data/index.ts` ve iki
test mock hedefi. `set-state-in-effect` sayisi degismedi (14).

## 2026-07-25 — HB-2026-096: set-state-in-effect error seviyesine cikarildi, iki kanitli istisna

Karar:

1. `eslint-plugin-react-hooks` v7'nin 14 Compiler kuralinin TAMAMI upstream
   `recommended` seviyesinde calisir. `set-state-in-effect` dahil hicbiri global
   olarak override EDILMEZ; kural `error` seviyesindedir.
2. Modul seviyesindeki 14 bulgunun 12'si giderildi. Donusum toplu degil, dort
   mantiksal grupta dort ayri commit ile yapildi ve her modul ayri test edildi.
3. Kuralin gercek kapsami olculdu: efektten dogrudan cagrilan bir fonksiyonun
   icindeki setState'ler de -- await konumundan bagimsiz olarak -- ihlal
   sayiliyor. Bu nedenle `useEffect(() => { void load() })` deseni yalniz
   `setStatus('loading')` kaldirilarak cozulmuyor; ilk okuma efekt icine
   alinmali ve durum yalniz async geri cagrilarda yazilmalidir.
4. Uc modulde (`CaseVehicleProfileModule`, `LaborExcelProfilesModule`,
   `LaborAllocationAiModule`) donusum sirasinda `cancelled` muhafazasi EKLENDI;
   onceden yoktu ve case degisiminde ucustaki yanit yeni case'in verisini
   ezebiliyordu.
5. Onay bayraklari artik kimlik degistiginde AYNI render'da duser. Onceden
   sifirlama efekte bagli oldugu icin bir frame boyunca bayat onay
   gorunebiliyordu; bu fail-closed acidan istenmeyen bir aralikti.
6. Kaynak secimi mutabakatinda gercek kusur bulundu ve duzeltildi: kural her
   render'da uygulandiginda kullanicinin son kaynagi kaldirmasi geri aliniyor ve
   plan butonu yanlislikla etkin kaliyordu. Mutabakat artik yalniz kaynak
   listesi kimligi degistiginde uygulanir.
7. Iki bulgu baska turlu cozulemez ve dosya kapsamli istisna olarak `warn`
   birakilir. Kodda `eslint-disable` yorumu KULLANILMAZ; istisna yalniz
   `eslint.config.js` icinde dosya listesi ve gerekcesiyle tanimlanir:
   - `src/features/cases/LaborAllocationAiModule.tsx`: gecen sure sayaci.
     Deger `Date.now()` ile olculur; render'a tasinirsa `react-hooks/purity`
     ihlal edilir. Ilk olcum efektte senkron yazilmazsa sayac bir saniye boyunca
     yanlis deger gosterir.
   - `src/features/cases/CasesPage.tsx`: fetch sonrasi sayfa kelepcelemesi.
     `totalPages` ancak yanit geldikten sonra bilinir. Render'da turetmek
     istenen sayfayi kalici olarak duzeltmedigi icin toplam sayfa sayisi yeniden
     buyudugunde kullaniciyi beklenmedik bir sayfaya siciratir; pagination
     davranisi korunmalidir.

Gerekce: Kuralin koruma degeri ancak `error` seviyesinde gercek olur. Kalan iki
bulgu icin genel gevsetme yerine kapsami dosya ve gerekce ile sinirlanmis
istisna secildi; boylece yeni ihlaller repo genelinde derhal hata olarak duser.

Etki: 10 modul dosyasi ve `eslint.config.js`. Runtime davranisi degismedi;
pagination, onay akislari, Paket 62 kosu secimi, Paket 23 promotion ve Paket 66
deger kaybi davranislari korundu. `set-state-in-effect` 14 -> 2 (ikisi de
kanitli istisna, 0 error).

## 2026-07-26 — HB-2026-097: HB-2026-096 kaynak secimi kusuru icin dogrudan regresyon testi

Karar:

1. HB-2026-096 madde 6'daki kaynak-secimi kusuru (mutabakat kuralinin her
   render'da uygulanip kullanicinin sifira indirdigi secimi geri almasi) o
   sirada hedefli bir testle yakalanip duzeltilmisti, ancak kalici test
   dosyasina ayri, adlandirilmis bir vaka olarak girmemisti.
2. `PolicyAiCandidatesModule.test.tsx`'e dogrudan regresyon vakasi eklendi:
   >=2 kaynakli bir workspace'te secim sifira indirilir, sonra kimlik
   degismeden ("Kaynaklari Yenile") yeniden yuklenir; secimin bos kalmasi ve
   plan butonunun devre disi kalmasi dogrulanir.
3. Testin kusuru gercekten yakaladigi kanitlandi: `ApiPanel` icindeki kimlik
   kisayolu (`sourceSelection.key === availableSourceIdentity`) gecici olarak
   `false` ile degistirildi, yeni test (ve mevcut bir baska test) kirmizi
   oldu; kisayol aynen geri getirilip (component dosyasinda net diff yok)
   yeniden yesile donuldu.

Gerekce: Bir kez elle yakalanip duzeltilen bir kusurun kalici koruyucusu
olmadan tekrar surunmesi riski vardir; regresyon testi bu riski kapatir.

Etki: Yalniz `src/features/cases/PolicyAiCandidatesModule.test.tsx` (+1 vaka,
47 satir). Uretim kodu degismedi. Ana agacta typecheck, lint (0 error / 2
warning, degismedi), gercek `hasarbotu_test` PostgreSQL ile 2.051 basarili / 6
ortam-kosullu UI skip (+1), build/bundle 412.643 bayt (degismedi), `npm audit`
0 bulgu.

## 2026-07-27 — HB-2026-098: EmailDraftApiModule secim turetmesi icin dogrudan regresyon testi; kusur bulunamadi

Karar:

1. HB-2026-096'nin 2. grubunda `EmailDraftApiModule`in `selectedDraftId`
   turetmesi de "secim mutabakati" kapsamindaydi ancak kalici testte ayri bir
   vaka olarak yoktu. Once turetme yeniden incelendi: `explicitDraftId !== ''
   ? explicitDraftId : drafts[0]?.id`. PolicyAiCandidatesModule'daki gibi bir
   "mevcut olanlari koru, yoksa tumunu sec" mutabakat mantigi YOKTUR; tek bir
   boolean-benzeri kisayoldur ve `explicitDraftId`'yi sifirlayan hicbir kod
   yolu bulunmamaktadir. Yapisal olarak PolicyAiCandidatesModule sinifi
   kusura acik degildir.
2. Gercek bir kusur KANITLANAMADI; bu nedenle uretim kodu DEGISTIRILMEDI.
3. Yine de kalici regresyon testi eklendi:
   `EmailDraftApiModule.test.tsx`'e 2 taslakli bir workspace'te ikinci taslak
   acikca secilir, sonra secimle ilgisiz bir mutasyon (Gmail handoff)
   `workspace.reload()` tetikler; iki taslak taze nesnelerle ayni kimlikle
   geri gelir. Acik secimin ilk taslaga donmedigi dogrudan doğrulanir.
4. Testin gercekten kusur yakaladigi kanitlandi: turetme satiri gecici olarak
   `workspace.data?.drafts[0]?.id ?? ''`e (her zaman ilk taslak) sabitlendi,
   yeni test kirildi, sonra satir aynen geri getirilip (component dosyasinda
   net diff yok) yeniden yesile donuldu.

Gerekce: Bir mekanizmanin "yapisal olarak kusura acik degil" diye
degerlendirilmesi, kalici bir regresyon koruyucusunun yerini tutmaz; ileride
turetme yanlislikla PolicyAiCandidatesModule'daki gibi bir mutabakat/reset
deseniyle degistirilirse test derhal kirilir.

Etki: Yalniz `src/features/cases/EmailDraftApiModule.test.tsx` (+1 vaka).
Uretim kodu degismedi (component dosyasinda sifir net diff). Ana agacta
typecheck, lint (0 error / 2 warning, degismedi), gercek `hasarbotu_test`
PostgreSQL ile 2.052 basarili / 6 ortam-kosullu UI skip (+1), build/bundle
412.643 bayt (degismedi), `npm audit` 0 bulgu.

## 2026-07-27 — HB-2026-099: CaseDetailPage fail-closed override turetmesi icin dogrudan regresyon testi; kusur bulunamadi

Karar:

1. HB-2026-096'nin 2. grubunda `CaseDetailPage`in yerel `caseOverride`
   turetmesi de kalici testte ayri bir vaka olarak yoktu. Turetme:
   `overrideKey = \`${caseId}#${baseItem?.version ?? ''}\``,
   `caseOverride = override.key === overrideKey ? override.value : null`.
2. RTL'nin `act()` sarmali, testte bir efektin "ayni render'da" mi yoksa "bir
   sonraki tikte" mi calistigini ayirt etmeyi engeller (her iki durumda da
   `await user.click(...)` donene kadar efektler zaten akmis olur); bu yuzden
   tek-frame'lik kanit RTL ile DOGRUDAN kanitlanamaz. Bunun yerine turetme
   FORMULUNUN kendisi test edildi: sürüm degisince override GERCEKTEN
   dusuyor mu?
3. Gercek bir kusur KANITLANAMADI; uretim kodu DEGISTIRILMEDI.
4. Kalici regresyon testi eklendi: `CaseDetailPage.api.test.tsx`'e tam sayfa
   (`MemoryRouter`) uzerinden, "Temel Bilgileri Duzenle" ile uygulanan yerel
   override'in (asama: Yeni Ihbar -> Hasar Tespiti, surum 4 sabit) "Tek
   Dosyayi Yenile" sunucudan FARKLI bir surum (6, asama: Parca ve Iscilik)
   getirdiginde eski override'a degil taze sunucu verisine dondugunu
   dogrudan doğrulayan bir vaka eklendi.
5. Testin gercekten kusur yakaladigi kanitlandi: `overrideKey` gecici olarak
   surum bilgisini dislayacak sekilde (yalniz `caseId`) degistirildi, yeni
   test kirildi, sonra satir aynen geri getirilip (component dosyasinda net
   diff yok) yeniden yesile donuldu.

Gerekce: HB-2026-098 ile ayni: yapisal degerlendirme kalici testin yerini
tutmaz. Surum tabanli fail-closed gecersiz kilma, ileride "yalniz caseId
yeterli" gibi bir sadelestirmeyle yanlislikla kaldirilirsa test derhal kirilir.

Etki: Yalniz `src/features/cases/CaseDetailPage.api.test.tsx` (+1 vaka).
Uretim kodu degismedi (component dosyasinda sifir net diff). Ana agacta
typecheck, lint (0 error / 2 warning, degismedi), gercek `hasarbotu_test`
PostgreSQL ile 2.053 basarili / 6 ortam-kosullu UI skip (+1), build/bundle
412.643 bayt (degismedi), `npm audit` 0 bulgu.

## 2026-07-27 — HB-2026-100: TrafficValueLossReportPanel anahtarli form state icin dogrudan regresyon testi; kusur bulunamadi

Karar:

1. HB-2026-096'nin 2. grubunun son ogesi `TrafficValueLossReportPanel`in
   `ReportFormState` (`note`/`confirmed`/`message`, anahtar `version?.id`)
   turetmesiydi; kalici testte hic vakasi yoktu (bileşenin hicbir test
   dosyasi da yoktu).
2. Turetme once yapisal olarak incelendi:
   `form.key === formKey ? form : blank` (okuma) ve
   `patchForm` icinde `prev.key === formKey ? prev : blank` (yazma).
   PolicyAiCandidatesModule'daki "mevcutlari koru, yoksa tumunu sec" tarzi
   bir mutabakat/fallback mantigi YOKTUR; CaseDetailPage'in override
   deseniyle ayni yapidadir (anahtar-korumali oku/yaz).
3. Stale-async-yazma senaryosu (bir surumde baslatilan preview, baska
   surume gecildikten SONRA tamamlanip eski anahtarla yazması) ayrica
   degerlendirildi: yazma `prev.key === (yazmanin baglandigi ESKI
   formKey)` kontrolunu YAPAR ve eski anahtarla eslesirse yazar, ancak
   GORUNTULEME anindaki GUNCEL formKey ile eslesmedigi surece EKRANDA
   GORUNMEZ (ayni CaseDetailPage/EmailDraftApiModule'de kabul edilen risk
   sinifi: yalniz kullanici AYNI anahtara GERI donerse gorunur olabilir,
   bu da PolicyAiCandidatesModule'daki "ayni kimlik = ayni onay, dogrudur"
   gerekcesiyle tutarlidir). Bu, mevcut kalibin kabul edilen davranisidir;
   yeni/farkli bir kusur degildir.
4. Gercek bir kusur KANITLANAMADI; uretim kodu DEGISTIRILMEDI.
5. Sifirdan `TrafficValueLossReportPanel.test.tsx` eklendi (bileşenin ilk
   testi), iki vaka: (a) surum degisince not/onay/mesajin ayni render'da
   bosa dondugu, (b) surum ayni kalirken (yeni prop referansi, ayni
   `version.id`) ilgisiz bir render'in girilen notu ve onay kutusunu
   SIFIRLAMADIGI.
6. Testlerin gercekten kusur yakaladigi iki AYRI bozulmayla kanitlandi:
   once okuma anahtar kontrolu devre disi birakildi (yalniz vaka (a)
   kirildi), sonra `patchForm`in `prev`i koruma kontrolu devre disi
   birakildi (HER IKI vaka da kirildi — art arda `setNote`/`setConfirmed`
   cagrilari birbirini ezdi). Her ikisinde de satir aynen geri getirilip
   (component dosyasinda net diff yok) yeniden yesile donuldu.

Gerekce: HB-2026-098/099 ile ayni: yapisal degerlendirme kalici testin
yerini tutmaz. Bu kapaniyla HB-2026-096 2. grubundaki dort turetmenin
(PolicyAiCandidatesModule x2, EmailDraftApiModule, CaseDetailPage,
TrafficValueLossReportPanel) tamami kalici, dogrudan regresyon testine
sahip oldu.

Etki: Yalniz yeni `src/features/cases/TrafficValueLossReportPanel.test.tsx`
(+2 vaka). Uretim kodu degismedi (component dosyasinda sifir net diff). Ana
agacta typecheck, lint (0 error / 2 warning, degismedi), gercek
`hasarbotu_test` PostgreSQL ile 2.055 basarili / 6 ortam-kosullu UI skip
(+2), build/bundle 412.643 bayt (degismedi), `npm audit` 0 bulgu.

## 2026-07-27 — HB-2026-101: Dosya Envanteri Migration 0042 — araç sahibi capture, gercek API/export, kullanici onayli kapsam

Karar:

1. Case inventory export domain cekirdegi (2026-07-21) tek basina
   yetersizdi: migration, API, xlsx yazici ve UI yoktu; migration numaralari
   0041->0043 arasinda kasitli bir bosluk (0042) birakmisti.
2. On inceleme 16 sutunun 12'sinin mevcut tablolardan (cases/insurers/
   users/service_centers) turetilebilecegini, ancak UC sutunun (araç sahibi
   ad/telefonu, servis ili, eksper rapor no) hicbir tabloda karsiligi
   olmadigini gosterdi. Araç sahibi PII-gated iki gercek sutun tasidigi
   (domain zaten `includePhones` ayrimini tasarlamisti) icin bu, gercek bir
   urun karari geregiydi; diger ikisi (servis ili, rapor no) dusuk riskliydi
   (PII degil, domain'in mevcut "Eksik" politikasiyla dogru sekilde
   karsilanir).
3. Kullaniciya soruldu: araç sahibi verisi icin (a) yeni minimal capture
   ekle, (b) daima "Eksik" birak, (c) baska kaynaga bagla. Kullanici (a)'yi
   sectii. Servis ili ve eksper rapor no icin AYRI onay istenmedi; bunlar
   PII tasimiyor ve domain'in "eksik bilgi tahmin edilmez" ilkesiyle zaten
   dogru sekilde ele aliniyordu (yeni tablo/capture eklenmedi).
4. Migration 0042 (`case_vehicle_owner_sets` + `case_vehicle_owners`):
   TAM surum zinciri (case_vehicle_profile_versions gibi) BILINCLI OLARAK
   kurulmadi -- orantisiz olurdu. Liste tek seferde degistirilir; eski
   `set_version` satirlari asla silinmez/guncellenmez (append-only guard
   trigger), `current_set_version` optimistic locking icin kullanilir. Bu,
   ayri bir tarihce tablosu olmadan dogal bir denetim izi verir.
5. xlsx yazici sifirdan minimal OOXML uretir (Paket 65A/65B'nin surgical
   patch akisindan FARKLI: var olan dosyayi duzenlemez). `fflate` zaten
   `file-agent`'ta onayli/kullanimda olan bir bagimliliktir; `services/api`
   paketine de eklendi (yeni ekosistem bagimliligi degil, mevcut kullanimin
   genisletilmesi). Bes parcali standart yapi, `inlineStr` hucreler
   (paylasilan string tablosu yok, daha az hareketli parca).
6. Export SALT SAYIM donen bir onizleme (`/api/v1/case-inventory`, PII
   tasimaz) ile gercek dosyayi ureten bir indirme (`/api/v1/case-inventory/
   export`) olarak ikiye ayrildi. Telefon sutunlari yalniz admin/expert/
   case_manager oturumunda uretilir (digerlerinde HIC uretilmez, gizlenmez).
   Her export merkezi audit'e (`case_inventory.exported`) satir sayisi/rol/
   filtre ile duser; PII audit'e yazilmaz.
7. Veritabani entegrasyon test dosyasinin (`packages/database/test/
   integration.test.ts`) mevcut kademeli rollback/reapply testleri migration
   ADLARINI VE SAYILARINI sabit koddu; 0042'nin 0041-0043 arasina girmesi
   44 ayri assertion'i (array icerigi + rollback count) guncelleme
   gerektirdi. Hepsi dogrulandi; gercek PostgreSQL'de 58/58 gecti.

Gerekce: Envanter export'unun PII sutunlari gercek veri tasimadan
(daima "Eksik") sevk edilmesi, ozelligi anlamsizlastirir ve dogruluk
ilkesini (uydurulmus/varsayilmis veri yok) ihlal ederdi; bu yuzden yeni
capture ayri bir "kucuk teknik karar" degil, kullanicinin onaylamasi
gereken gercek bir urun karariydi.

Etki: Yeni migration 0042; yeni contracts (`case-vehicle-owners`,
`case-inventory`); yeni API modulleri (`case-vehicle-owners`,
`case-inventory` + xlsx yazici); yeni UI (`CaseVehicleOwnersModule`,
`CaseInventoryExportPanel`) ve veri portlari; `services/api`'ye `fflate`
bagimliligi eklendi. `packages/database/test/integration.test.ts` mevcut
44 assertion guncellendi (davranis degil, migration sirasi). Ana agacta
typecheck, lint (0 error / 2 warning, degismedi), gercek `hasarbotu_test`
PostgreSQL ile 2.080 basarili / 6 ortam-kosullu UI skip (+25), build/bundle
417.187 bayt (butce 500.000), `npm audit` 0 bulgu. Gercek Chrome/CDP smoke:
gercek case olusturma, araç sahibi kaydi (PostgreSQL round-trip), Dosya
Envanteri paneli ve gercek export istegi (200, konsol temiz) dogrulandi;
kalici dev DB'sine uygulanan migration ve smoke verisi temizlendi.

## 2026-07-28 - HB-2026-102: HB-011 kaynak bazli yetki matrisi - gercek rol atama ucu, write-role bosluk kapanisi, mali gorunurluk

Karar: Yetkilendirme "oturum var mi" seviyesinden kaynak bazli role
matrisine tasindi. Uc alanda gercek bosluk haritalandi ve kapatildi:

1. YAZMA BOSLUKLARI (gercek kusur). Dort uc yalniz `requireSession`
   kullaniyordu; `read_only` rolu bile fiziksel klasor kurulumu/tasima
   planlayabiliyor, dosya konumu atayabiliyor ve evrak/fotograf kaydi
   girebiliyordu. AGENTS.md ss.7 bunlari "kritik islem" sayar.
   - `file-operations`, `workspace`, `storage` (case-location):
     `admin|expert|case_manager` (case-lifecycle COMMAND_ROLES ile ayni sinir).
   - `documents` (evrak/fotograf): `admin|expert|case_manager|secretary`
     (case-operations not/gorev ile ayni clerical sinif).

2. MALI GORUNURLUK. `GET /fees` ve `GET /cases/:caseId/fee` artik
   FINANCIAL_READ_ROLES (`admin|expert|case_manager|accounting`) ister;
   `secretary`/`read_only` 403 alir. Aylik case-summary raporu HERKESE
   acik kalir (operasyonel sayaclar is icin gerekli) ama mali alanlar
   maskelenir: `approvedFeeTotalMinor` ve `approvedValueLossTotalMinor`
   `null`, `pendingFees` bos, yeni `includesFinancials:false`. UI tutar
   yerine "Gizli" gosterir; uydurulmus 0 URETILMEZ.

3. ROL ATAMA UCU. Once rol degisikligi yalnizca dogrudan `user_roles` SQL
   mutasyonuyla mumkundu; gercek bir atama API'si/UI'i yoktu.
   `GET /api/v1/users` + `PATCH /api/v1/users/:userId/roles` eklendi
   (admin-only, tenant kapsamli, `users.version` ile optimistic lock,
   `user.roles_changed` audit kaydi). Yonetim > Kullanicilar sekmesi admin
   oturumunda gercek rol tablosunu gosterir.

Gerekce: Rol tablosu ve `requireAnyRole` altyapisi zaten vardi; eksik olan
kaynak-uc eslemesiydi. Yazma bosluklari teorik degil gercekti - UAT testi
403 beklentisiyle bunlari dogrudan kanitliyor. Mali gorunurlukte raporu
tumden kapatmak yerine maskeleme secildi: sekreterin dosya sayilarina
ihtiyaci var, firma gelirine yok.

Kapsam sinirlari (bilincli):
- Deger kaybi tazminat tutari mali alan SAYILMADI; modul okumalari tum
  rollere acik kalir. Sinir "firma geliri (kapanma ucreti) mali veridir,
  dosya sonucu degildir" seklinde cizildi. Rapordaki deger kaybi TOPLAMI
  yine de maskelenir (toplu mali raporlama sinifinda). Bu asimetri
  bilerek birakildi; genisletilmesi ayri urun karari gerektirir.
- Kullanici olusturma/silme/pasiflestirme eklenmedi; yalniz rol atamasi.
- Yeni tablo veya migration YOK; mevcut `users`/`roles`/`user_roles`
  (migration 0002) kullanildi. Yeni dependency yok.

Guvenlik notlari (overlay ss.1/2/8 karsisinda dogrulandi):
- Her sorgu `organization_id` tasir; capraz tenant PATCH 404 doner.
- `roles` girdisi `roleCodeSchema` enum'u; tum SQL parametreli.
- Son-yonetici garantisi: bir admin KENDI admin rolunu kaldiramaz
  (`user_self_lockout_blocked`, 409). Admin rolu yalnizca bir admin
  tarafindan kaldirilabildigi ve aktor kendisini kaldiramadigi icin
  organizasyon hicbir zaman sifir yoneticide kalamaz.
- Oturum canli JOIN ile cozuldugu (`findActiveSession`, `u.status='active'`)
  icin hem yukseltme hem dusurme bir sonraki istekte aninda etkilidir;
  bayat yetki tasinmaz. UAT testi bunu gercek oturumla kanitlar.
- Sertlestirme: rol INSERT'unun satir sayisi istenen rol sayisiyla
  karsilastirilir. Sozlesme enum'u ile `roles` tablosu ayrisirsa islem geri
  alinir; GERCEKTE verilmemis bir yetki verilmis gibi RAPORLANMAZ.
- Audit `details` yalniz rol kodu ve surum tasir; PII ve fiziksel yol yok
  (UAT testi dogrudan assert eder).

Etki: Yeni contracts `v1/users` ve `user_self_lockout_blocked` hata kodu;
yeni API modulu `services/api/src/users`; yeni UI portu `usersPort` +
`useUsers` kancasi; Yonetim'de gercek rol atama tablosu; "Erisim ve Yetki"
sekmesindeki mugalak ozet, sunucudaki gercek kapilari yansitan 15 satirlik
kaynak bazli matrisle degistirildi. `caseSummaryReportResponse` sozlesmesi
kirici degisti (`includesFinancials` zorunlu; iki tutar alani nullable) -
JSON schema fixture'lari guncellendi. Ana agacta typecheck, lint
(0 error / 2 mevcut warning, degismedi), gercek `hasarbotu_test` PostgreSQL
ile 2.105 basarili / 6 ortam-kosullu UI skip, build/bundle 426.065 bayt
(butce 500.000, 10 lazy modul), `npm audit --audit-level=moderate` 0 bulgu.
Yeni UAT testi `permission-matrix-uat-e2e.test.ts` gercek PostgreSQL ile
kosuldu (skip EDILMEDI); `reports-fees-uat-e2e.test.ts` maskeleme + tenant
izolasyonunu birlikte dogrulayacak sekilde guncellendi.

Dogrulanamayan: Gercek Chrome/CDP tarayici smoke bu pakette CALISTIRILMADI;
UI davranisi yalniz component testleriyle dogrulandi.

## 2026-07-28 - HB-2026-103: D1 masaustu kabugu icin loopback ayni-origin koprusu (Electron oncesi mimari kilit)

Karar: Electron kabugunda renderer'in gordugu origin sayisi **bire**
indirilecektir. Masaustu main process'i 127.0.0.1'de bir loopback HTTP
koprusu acar; ayni host:port hem UI build ciktisini hem `/api/*`
isteklerini karsilar ve `/api/*` sunucu-sunucu API origin'ine iletilir.
Tarayici API origin'ini HIC gormez. Bu, bugun Vite dev proxy'sinin
(`vite.config.ts`) sagladigi davranisin uretimdeki karsiligidir.

Reddedilen iki secenek:

1. **API'ye CORS + CSRF token eklemek.** Bugun CSRF korumasi tamamen
   `SameSite=Strict` + ayni-origin varsayimina dayanir
   (`services/api/src/auth/cookies.ts`). CORS acmak bu korumayi gonullu
   olarak birakip yerine yeni bir CSRF altyapisi kurmak demekti; HB-011'de
   yeni siklastirilan yetki hattina yeni saldiri yuzeyi eklerdi.
2. **API'nin static UI sunmasi.** `@fastify/static` yok, eklenmesi
   gerekirdi; API'yi UI sunucusuna donusturur ve web/desktop dagitimini
   birbirine baglardi.

Gerekce: Kopru secenegi UI sozlesmesine, 28 HTTP adapter'in `baseUrl`
kullanimina, oturum cerezi politikasina ve API'ye HIC dokunmaz. Geri alma
stratejisi ("desktop paketini kaldir, web dagitimini kullan",
INFRASTRUCTURE_IMPLEMENTATION_PLAN Paket 21) aynen gecerli kalir.

Kanit (gercek PostgreSQL + gercek API + gercek login):
`services/api/test/desktop-bridge-same-origin-e2e.test.ts` 5/5 gecti.
- Gercek login kopru uzerinden 200; `Set-Cookie` nitelikleri
  (`SameSite=Strict; HttpOnly; Path=/`) korunuyor ve API'nin DOGRUDAN
  urettigi cerezle nitelik nitelik AYNI (kopru cerezi yeniden yazmiyor).
- Cerezi VEREN istek ile onu TASIYAN istek ayni scheme+host+port'ta;
  tarayicinin `SameSite=Strict` cerezi gondermesinin dayanagi budur.
- Oturumlu `GET /auth/session` gercek kullaniciyi cozuyor; HB-011 admin-only
  `GET /users` kapisi koprüden geciyor.
- Ne kopru ne API `access-control-*` uretiyor (CORS acilmadi).
- Cerezsiz istek 401 kaliyor (kopru kimlik uydurmuyor).
- BrowserRouter derin yolu `index.html`'e dusuyor; EKSIK varlik dosyasi 404
  kaliyor (bozuk build sessizce HTML donmuyor).
- Traversal denemeleri (ham HTTP yoluyla, istemci normalizasyonu atlanarak)
  kok DISINDAKI dosyanin icerigini hicbir durumda dondurmuyor; olumlu
  kontrol ayni yolla kok icindeki dosyanin dondugunu kanitliyor.
- Loopback disi `Host` 403; API erisilemezken 502 ve ham hata metni yok.

Kapsam siniri: Bu pakette Electron dependency'si, `apps/desktop` ve
paketleme YOKTUR (kullanici talimati). Gercek Chrome/CDP ile tarayicinin
SameSite kararinin gozlenmesi D2'ye birakildi; bu testte tarayici
CALISTIRILMADI ve taklit EDILMEDI - kararin dayandigi iki olgu (origin
birligi + nitelik korunumu) dogrudan kanitlandi.

Bulunan ve duzeltilen gercek kusur: `resolveAssetPath` surucu onekini tum
dizgede ariyordu; URL yolu daima `/` ile basladigi icin `/C:/Windows`
KACIYORDU. Kontrol segment bazina alindi (`path.resolve` bir `C:` segmentini
surucuye goreli sayip kokten cikabilirdi). Birlestirme sonrasi containment
denetimi zaten ikinci savunma katmani olarak duruyordu.

Etki: Yeni `packages/desktop-bridge` workspace'i (runtime dependency YOK,
yalniz Node yerlesikleri; Electron import edilmez). `services/api`'ye yalniz
devDependency olarak eklendi (mevcut `@hasarbotu/file-agent` devDependency
precedent'i ile ayni). Kok `build:packages`/`typecheck`/`test` zincirlerine
eklendi. UI, contracts, API runtime kodu ve migration DEGISMEDI. Ana agacta
typecheck, lint (0 error / 2 mevcut warning, degismedi), gercek
`hasarbotu_test` PostgreSQL ile 2.120 basarili / 6 ortam-kosullu UI skip,
build/bundle 426.065 bayt (degismedi) ve `npm audit --audit-level=moderate`
0 bulgu gecti.

Acik kalan: uretim masaustu kurulumunda `cookieSecure` degeri (duz loopback
HTTP mi, koprude TLS sonlandirma mi) D2/Paket 22 dagitim karari.

## 2026-07-28 - HB-2026-104: D1 kopru kanitinin GERCEK TARAYICI ile tamamlanmasi

Karar: HB-2026-103'te (D1) "D2'ye birakildi" denen tek dogrulama boslugu -
tarayicinin `SameSite=Strict` kararinin GERCEKTEN gozlenmesi - D2'ye
BIRAKILMADAN kapatildi. Tarayici kaniti, mevcut Chrome/CDP smoke
precedent'iyle ayni bicimde ELDE TUTULAN bir betikle saglanir
(`scripts/d1-bridge-browser-smoke.mjs`); `npm test` kapsamina ALINMAZ.

Gerekce: Chrome bir test bagimliligi degildir ve repo genelinde tarayici
kaniti (router-v8, package37-66) daima ayri betikle uretilmistir. Bu betigin
digerlerinden farki, dev sunucusu KULLANMAMASIDIR: kopru gercek uretim UI
build ciktisini (`dist`) sunar, yani dagitim biciminin ta kendisi test edilir.
Vite dev proxy'si devrede DEGILDIR.

Kanit (gercek Chrome + gercek uretim build + gercek kopru + gercek API +
gercek PostgreSQL + gercek login), 10 kontrol PASS:

1. Renderer TEK origin yukler; dokuman `dist/index.html`'den gelir
   (`import.meta.env.PROD` oldugu icin veri kaynagi zorunlu olarak `api`).
2. Gercek login formu gercek oturum acar.
3. Cerezin TARAYICININ KENDI kaydindaki nitelikleri (`Network.getAllCookies`):
   `sameSite=Strict`, `httpOnly=true`, `path=/`, host-only `127.0.0.1`,
   `secure=false` (duz loopback), TTL 43.199 s (12 saat).
4. `document.cookie` cerezi GORMEZ - HttpOnly'yi tarayici uygular.
5. Ayni-origin `/api/v1/auth/session` 200 doner ve gercek kullaniciyi cozer;
   cerezin gonderildigi yanit govdesinden DEGIL, tarayicinin istek kaydindan
   (`Network.requestWillBeSentExtraInfo.associatedCookies`, blockedReasons
   BOS) dogrulanir.
6. API'ye bagli ekran (`/dosyalar`) gercek veriyi kopruden gecerek render eder.
7. Tarayici API origin'ine HIC istek atmaz: gozlenen 28 istegin 28'i kopru
   origin'ine, 0'i API authority'sine gitti.
8. Tarayici hicbir yanitta `access-control-*` gormedi (CORS acilmadi).
9. **SameSite=Strict'in gercek tarayici davranisi.** Ayni hedef URL, ayni
   cerez, ayni sunucu; degisen tek sey baslaticinin site'i:
   - ayni-site baslatici (`http://127.0.0.1:{port}` sayfasi) -> cerez
     gonderildi -> 200, gercek e-posta govdede;
   - capraz-site baslatici (`http://localhost:{port}` sayfasi; kopru
     `policy.ts` geregi bu Host'u da kabul eder ve `localhost` ile `127.0.0.1`
     AYRI site'lardir) -> ayni URL'ye ust duzey gezinme -> 401 `unauthorized`,
     ve Chrome cerezi tutma gerekcesini `blockedReasons: ["SameSiteStrict"]`
     olarak BILDIRDI.
   Bu, CSRF korumasinin `SameSite=Strict` uzerine kurulmasinin ve CORS
   acmanin neden reddedildiginin dogrudan tarayici kanitidir.
10. Eksik varlik gercek tarayicida da 404 kalir: `index.html` favicon
    bildirmedigi icin Chrome `/favicon.ico` istedi ve kopru uzantili yolu SPA
    kabugu ile karsilamadi (404, iki gozlem).

Etki: YALNIZ yeni bir dogrulama betigi eklendi. Uretim kodu, UI, contracts,
API, migration, adapter sozlesmeleri ve kopru davranisi DEGISMEDI. CORS/CSRF
altyapisi eklenmedi; API static UI sunmuyor.

Acik kalan (HB-2026-103'ten devam): uretim masaustu kurulumunda `cookieSecure`
degeri (duz loopback HTTP mi, koprude TLS sonlandirma mi) D2/Paket 22 dagitim
kararidir. Bu smoke duz HTTP loopback'i olcer ve cerezde `secure=false`
oldugunu ACIKCA kaydeder.

## 2026-07-28 - HB-2026-105: D2 ince Electron kabugu iskeleti (apps/desktop)

Karar: Masaustu kabugu `apps/desktop` workspace'i olarak, ADR-Q06 "ince
shell" kuralina bagli kalarak kuruldu. Kabuk YALNIZ uc sey yapar: D1
koprusunu baslatir, guvenli bir `BrowserWindow` acar ve `security.ts`teki
kararlari Electron API'lerine baglar. Kabukta is mantigi YOKTUR ve
`ipcMain` handler'i KAYDEDILMEZ.

Preload allowlist'i KASITLI OLARAK AYRICALIKSIZDIR: renderer'a yalniz iki
VERI alani acilir (`isDesktopShell`, `platform`). Hicbir fonksiyon, hicbir
IPC kanali ve `ipcRenderer`'in kendisi acilmaz. Gerekce: UI verisini bugun
oldugu gibi goreli `/api/...` uzerinden alir (HB-2026-103); kabuga bir cagri
yuzeyi eklemek Paket 21'in geri alma stratejisini ("desktop paketini kaldir,
web dagitimini kullan") zayiflatir. Izin ve yeni-pencere allowlist'leri de
acik ama BOS dizilerdir; sessizce genislemezler.

Yapilandirma siniri `services/api/src/config.ts` sozlesmesini izler: acik
parser, sessiz coercion yok, gecersiz degerde BASLATMA YOK, hata mesajinda
ortam DEGERI tasinmaz. Ek kural: `HASARBOTU_API_ORIGIN` icin duz `http`
YALNIZ loopback'te kabul edilir; uzak API `https` olmalidir. Ofis LAN'inda
(Paket 22) oturum cerezi agda duz metin gecemeyecegi icin bu kural kabukta
uygulanir ki yanlis yapilandirma sessizce uretime sizmasin.

CSP `default-src 'none'` ile baslar; `script-src`/`style-src`/`connect-src`
yalniz `'self'`. `unsafe-inline` ve `unsafe-eval` YOKTUR - `style-src` dahil.
React'in `style={{...}}` prop'u CSSOM uzerinden yazdigi icin etkilenmez ve
gercek uretim UI build'i bu politika altinda TEK BIR ihlal uretmedi. CSP
yalniz dokuman yanitlarina yazilir; `/api/*` JSON yanitlari degistirilmez ki
koprunun seffafligi ve `set-cookie` aktarimi bozulmasin.

Kanit (gercek Electron 43 + gercek Chromium + gercek API + gercek PostgreSQL
+ gercek login), `apps/desktop/test/electron-shell-e2e.test.ts` 6/6 -
kosum aracı uretim kabugunun ta kendisini (`startDesktopShell`) baslatir,
urun kodunda test kancasi YOKTUR:

1. `getLastWebPreferences()` ile gercek renderer ayarlari: `nodeIntegration`
   false, `contextIsolation` true, `sandbox` true, `webSecurity` true,
   `webviewTag` false. Yuklenen adres koprunun loopback origin'i, tek pencere.
2. Renderer'da Node yok: `require`, `process`, `module`, `Buffer`, `global`,
   `__dirname` ve `ipcRenderer` sayfada `undefined`.
3. Preload yuzeyi tam olarak `['isDesktopShell','platform']`; fonksiyon alani
   YOK; sayfanin degistirme denemesi degeri degistirmedi.
4. GERCEK LOGIN ZINCIRI, tarayicinin kendi cerez kavanozuyla: `document.cookie`
   cerezi HICBIR asamada gormedi (HttpOnly'yi Chromium uyguluyor), buna ragmen
   SONRAKI `/auth/session` istegi 200 dondu ve gercek kullaniciyi (`roles:
   ['admin']`) cozdu. HB-011 admin-only `/users` kapisi da kabuktan gecti.
5. CSP gercekten uygulaniyor: inline script CALISMADI ve ihlal
   `script-src-elem` olarak raporlandi; dis ag cikisi engellendi ve
   `connect-src` ihlali raporlandi (XSS olsa bile veri disari sizamaz).
6. Kapilar gercek Chromium'da tutuyor: `window.open` `null` dondu ve ikinci
   pencere ACILMADI; `Notification.requestPermission()` `denied`; sayfa
   baslatmali uzak gezinme engellendi ve adres degismedi.
7. GERCEK URETIM UI BUILD'i (`dist`) ayni kabukta acildi: login ekrani render
   edildi, gercek form gercek API'ye gonderildi, `.app-shell` render edildi
   (hata mesaji yok). Chromium'un KENDI cerez kaydinda `httpOnly=true`,
   `sameSite=strict`, `path=/`, `secure=false` (duz loopback). Uretim UI'i bu
   CSP altinda hicbir ihlal uretmedi.

Ayrica uretim giris noktasi (`dist/main/main.js`) elle smoke edildi: gercek
pencere "HasarBotu V2" basligiyla acildi; `HASARBOTU_API_ORIGIN` uzak bir
duz-http degeri verildiginde surec 1 ile cikti ve stderr yalniz alan adi +
kural yazdi (deger sizmadi).

Bulunan ve duzeltilen gercek kusur: **ESM giris noktasinda ust duzey
`await app.whenReady()` uygulamayi kilitliyor.** Electron, giris modulunun
degerlendirmesi bitmeden `ready` olayini yaymaz; ilk yazim bu yuzden sessizce
asili kaldi (gercek Electron 43 ile gozlendi, uc bagimsiz kosumda dogrulandi).
Baslatma `app.whenReady().then(bootstrap)` icine alindi ve hem `main.ts` hem
kosum araci bu kurali belgeleyen bir uyari tasiyor.

Etki: Yeni `apps/desktop` workspace'i. `electron@43.2.0` YALNIZ devDependency
(paketleyici tarafindan bundle edilir); tek runtime dependency
`@hasarbotu/desktop-bridge`. Kok `build:packages`/`typecheck`/`test`
zincirlerine eklendi. UI, contracts, API runtime kodu, migration, adapter
sozlesmeleri ve kopru davranisi DEGISMEDI; yeni tablo/endpoint/sozlesme yok.

Kapsam disi (kullanici talimati): code signing, installer, otomatik guncelleme.
Ayrica renderer'dan Node/fs erisimi, dogrudan PostgreSQL ve harici baglantiyi
varsayilan tarayiciya devretme bu pakette YOK.

Acik kalan (HB-2026-103/104'ten devam): uretimde `cookieSecure` degeri (duz
loopback HTTP mi, koprude TLS sonlandirma mi) Paket 22 dagitim kararidir. D2
duz HTTP loopback ile calisti ve Chromium'un cerezi `secure=false` olarak
kaydettigini acikca dogruladi.

## 2026-07-28 - HB-2026-106: D3 - openExternal allowlist, guvenli indirme, API hazirlik ve surum uyum kapisi

Karar: D2 iskeletine dort saf politika modulu eklendi; kabukta HALA is
mantigi YOKTUR, yalniz karar+baglama ayrimi genisledi.

**openExternal allowlist** (`src/main/external.ts`): kabuk artik uzak
navigasyon/`window.open` denemesini koşulsuz reddetmiyor - once host
allowlist'ine soruyor. Allowlist YALNIZ repository'de GERCEKTEN kullanilan
bes host'u icerir: `mail.google.com` (e-posta hazirlama Gmail compose,
`src/data/emailDraftPort.ts`) ve Deger Kaybi kural kaynaklari
`resmigazete.gov.tr`/`www.resmigazete.gov.tr`/`seddk.gov.tr`/`www.seddk.gov.tr`
(`packages/domain/src/traffic-value-loss.ts`). Yalniz `https`, kimlik
bilgisiz, kontrol karakteri/satir sonu YOK, 16 KB ust siniri (asan KISALTILMAZ,
REDDEDILIR). Izin verilen hedef bile Electron icinde HICBIR yeni pencere
ACMAZ - isletim sistemi tarayicisina DEVREDILIR; boylece uzak icerik kabugun
icine hicbir zaman girmez.

**Guvenli indirme yonetimi** (`src/main/downloads.ts`): `will-download`
kapida iki karar var. (1) Indirme kabugun KENDI origin'inden mi basladi -
UI'in rapor PDF/envanter Excel akislari `URL.createObjectURL` + `<a
download>` kullandigi icin `blob:{kabuk-origin}/...` bicimindedir; yabanci
origin'den gelen HER indirme IPTAL edilir. (2) Sunucudan gelen dosya adi
(`content-disposition`) isletim sistemi icin guvenli hale getirilir: yol
ayiricilari/yasak karakterler `_`ye cevrilir, Windows ayrilmis cihaz adlari
onceklenir, uzunluk UZANTI KORUNARAK sinirlanir. Kabuk kaydetme YOLUNU
KENDISI SECMEZ (`setSavePath` cagrilmaz); yalniz kaydetme kutusuna guvenli
bir on ad verilir - kullanici onayi olmadan diske hicbir sey yazilmaz.

**API hazirlik + surum uyum kapisi** (`src/main/readiness.ts`,
`compatibility.ts`, `gate.ts`): kabuk PENCEREYI ACMADAN ONCE API'nin
`/health` yanitini SUNUCU-SUNUCU sorgular (koprü uzerinden DEGIL - `/health`
surumlu `/api/v1` tabaninin disindadir ve kopru yalniz `/api/*` iletir).
Yanit contracts semasiyla dogrulanir. Uyum kurali: servis kimligi birebir,
ana surum birebir; ana surum `0` iken ikincil surum de birebir (semver `0.x`
serisinde kirici degisiklik ikincil surumle tasinir). Yama surumu ve on surum
etiketi uyumu ETKILEMEZ. Sunucu erisilemez/uyumsuz/saglik durumu `degraded`
ise pencere ACILMAZ; kullaniciya Turkce, ham hata metni/yol/deger TASIMAYAN
bir iletisim kutusu (Yeniden dene / Kapat) gosterilir - kullanici MAHSUR
KALMAZ, sonsuz donguye de girilmez (deneme ust siniri).

Gerekce: kabuk ve API AYRI dagitilir (kullanicinin makinesi vs. ofis
sunucusu, Paket 22); surumleri kacinilmaz olarak ayrisir. Uyumsuz bir ciftin
sessizce calismasi hatayi kullaniciya "veri yanlis" olarak gosterir. Harici
baglanti ve indirme icin sinirsiz izin, CSP'nin `connect-src 'self'` ile
kapattigi ag cikisini baska bir kapidan yeniden acardi; bu yuzden ikisi de
DAR ve GERCEK kullanima gore olculu allowlist'tir.

Kanit (birim + gercek API + gercek Electron/Chromium):

- `external.test.ts`: allowlist UI'in KENDI ureticisine (`buildGmailWebComposeUrl`
  bicimi) ve `packages/domain`teki GERCEK mevzuat kaynak listesine karsi
  dogrulandi - sabit kopya degil. Sema/kimlik bilgisi/kontrol karakteri/
  uzunluk/normalizasyon testleri.
- `downloads.test.ts`: gercek rapor adlari (Turkce, tarih, dosya numarasi
  icerenler) oldugu gibi korunuyor; traversal, Windows yasak karakter,
  ayrilmis cihaz adi, kontrol karakteri/baslik enjeksiyonu ve uzunluk+uzanti
  senaryolari.
- `compatibility.test.ts`: uyum kontrolu API'nin KENDI yayimladigi
  `API_SERVICE_NAME`/`API_VERSION`e karsi dogrulandi.
- `readiness-integration.test.ts`: GERCEK `buildApp()` Fastify sunucusuna
  karsi - hazir/uyumlu, saglik-disi (`healthDependencyCheck: false`),
  erisilemez, zaman asimi, sozlesmeye uymayan govde, HTML donen yanlis
  adres, yanlis servis, uyumsuz surum, HTTP hata kodu.
- `gate.test.ts`: senaryolu prob ile kullanicinin yeniden deneyip sonunda
  gecmesi, kapatmayi secmesi ve sonsuz donguye GIRMEMESI.
- `electron-shell-e2e.test.ts` (gercek Electron 43 + Chromium, 10/10):
  `window.open` HICBIR hedef icin (allowlist'teki dahil) Electron penceresi
  ACMADI; yalniz allowlist'teki Gmail compose bagalantisi isletim sistemine
  DEVREDILDI, digeri hicbir bicimde devredilmedi. Kabuk origin'inden
  baslatilan gercek indirme TAMAMLANDI; GERCEK bir HTTP sunucusunun ürettigi
  yabanci origin indirmesi IPTAL edildi (`state: 'cancelled'`).
- Elle smoke: gercek API (3100) acikken pencere GERCEKTEN acildi (baslik
  "HasarBotu V2"); uyumsuz surum (9.9.9) bildiren gercek bir stub sunucuya
  karsi pencere ACILMADI, yalniz "HasarBotu V2 — Sunucu denetimi" baslikli
  kapi penceresi goruldu.

Etki: `apps/desktop` icinde 5 yeni saf modul + main.ts/shell.ts baglama
degisikligi. `@hasarbotu/contracts` artik `apps/desktop`in runtime
dependency'si (yalniz `healthResponseSchema`/`HEALTH_ROUTE` icin - yeni
sozlesme veya alan EKLENMEDI). UI, API runtime kodu, migration ve adapter
sozlesmeleri DEGISMEDI. Paketleme, code signing ve otomatik guncelleme bu
pakette YOKTUR (kullanici talimati).

Ana calisma agacinda typecheck, lint (0 error / 2 mevcut warning,
degismedi), gercek `hasarbotu_test` PostgreSQL ile **2.221 basarili / 6
mevcut ortam-kosullu UI skip**, build/bundle 426.065 bayt (degismedi) ve
moderate audit (0 acik) gecti. Dagilim: desktop 75 (D2'ye gore +49).

Acik kalan: Windows installer/paketleme smoke'u bu pakette YOK (kapsam
disi); openExternal/indirme testleri paketlenmemis calistirma ile
dogrulandi. Paket 22 dagitim kararlari (cookieSecure, code signing,
otomatik guncelleme) hala acik.

## 2026-07-28 - HB-2026-107: D4 - File Agent kok saglik probu, STORAGE_UNAVAILABLE, manuel drift tespiti ve Windows yol uzunlugu siniri

Karar: `services/file-agent`e dort ilgili, birbirini tamamlayan D4 yetenegi
eklendi (FILE_STORAGE_AND_AGENT_PLAN.md §7, §11, §15 acik maddeleri).

**Kok saglik probu** (yeni `root-health.ts`): yalniz `lstat` YETERLI
SAYILMAZ - pCloud gibi senkron koklerde baglanti koparsa dizin listeleme
cogu zaman son onbelleklenmis haliyle BASARILI gorunur. Kokun GERCEKTEN
yazilabilir oldugu sabit adli (`.hasarbotu-health-probe.tmp`) kucuk bir
dosya yazip SILEREK dogrulanir. Salt-okuma dogrulama iclerinde
(`verifier.ts`) yazma probu ATLANIR (`verifyWritable:false`) - koke gereksiz
yazma/silme trafigi yuklenmez; yalniz varlik/tur (dizin miyim, reparse point
miyim) dogrulanir.

**STORAGE_UNAVAILABLE**: probun basarisiz oldugu HER yerde sunucuya
raporlanan hata kodu HER ZAMAN sabit `storage_unavailable` dizgesidir; kokun
NEDEN erisilemez oldugu (`RootHealthResult.code`: `root_missing`,
`root_not_a_directory`, `root_reparse_point_rejected`, `root_not_writable`,
`root_probe_failed`) yalniz yerel tani amaclidir, sunucuya/audit'e tasinmaz.
Bu kod HICBIR sunucu tarafi "nonRetryable" listesinde degildir; mevcut
backoff/retry mekanizmasina (§9) hicbir server-side degisiklik olmadan
RETRYABLE olarak akar.

**PENDING_STORAGE**: yeni bir DB sutunu/migration/API sozlesmesi
EKLENMEDI. Bunun yerine `agent.ts`da PROAKTIF bir kapi eklendi:
`runOnce`, `client.claim()`i cagirmadan ONCE yapilandirilmis TUM koklerin
HAFIF (yazma probu OLMAYAN) saglik kontrolunden gecer. Herhangi biri
erisilemezse o dongude HICBIR iş claim EDILMEZ ve `{kind:
'storage_unavailable'}` doner; `runLoop` bunu `no_work` gibi ele alip normal
poll araligiyla bekler ve `onCycleError('storage_unavailable')` ile bildirir.
Boylece PostgreSQL `jobs` tablosunda isler sessizce `pending` KALIR - bu,
"PENDING_STORAGE" durumunun DOGAL, sema degisikligi gerektirmeyen karsiligidir.

Bu kapi, bulunan GERCEK bir kusuru da onler: onceden, uzun bir `P:\`
kesintisinde her iş TEKRAR TEKRAR claim edilip ANINDA basarisiz olarak
attempt butcesini (varsayilan 5) tuketir ve kesinti biterse bile is zaten
`dead_letter`a dusmus olurdu. Artik kesinti boyunca HICBIR attempt
harcanmaz.

Kapi bilincli olarak HAFIF (lstat-tabanli, yazma OLMAYAN) tutuldu: "yeni
fiziksel isleri fail-closed durdur" talebi ozellikle YAZMA islerini
hedefler; kok TAMAMEN kayipken (en yaygin gercek arizada - surucu/mount
kaybi) hem okuma hem yazma isleri dogru sekilde durur, ama kok "gorunur ama
salt-okunur/yer tutucu" gibi DAHA NADIR bir durumda salt-okuma dogrulama
isleri claim edilmeye devam edebilir; bu isler kendi (READ, yazma probu
olmayan) kontrolunden GECER. Fiziksel (yazma) yurutucülerin HER BIRI
(`workspace-provisioner.ts`, `file-operation-executor.ts` - kaynak VE hedef
kok, `labor-workbook-executor.ts`'in yalniz `apply` yolu) KENDI GIRISINDE
AYRICA tam (yazma-kanitli) probu calistirir - claim sonrasi kok cokerse
ikinci savunma katmanidir.

**Manuel drift tespiti** (`file-operation-executor.ts`): `atomic_rename`
stratejisinde hedef, agent bu isi HENUZ hic denemeden once zaten
doluysa, onceden yalniz genel ve YANLIS bicimde yeniden-denenebilir sayilan
`destination_exists` donuyordu (staged_copy stratejisi ayni durumda ZATEN
manifest karsilastirmasi yapiyordu, atomic_rename yapmiyordu - tutarsizlik).
Simdi atomic_rename de ayni manifest karsilastirmasindan gecer: icerik
KAYNAKLA EsLESIYORSA (onceki basarili ama ack'lenmemis deneme YA DA
kullanicinin Explorer ile ayni sonucu ureten bir tasimasi - ikisi
filesystem'den AYIRT EDILEMEZ) zaten test edilmis
`recovered_existing_destination` yoluna girer; ESLESMIYORSA kaynak
BIRAKILIR (silinmez/taşınmaz) ve YENI, adiyla anilan `manual_drift_detected`
kodu ile `manual_recovery_required` fazina girilir - kullanicidan MANUEL
dogrulama ister, sessizce yeniden denemez (FILE_STORAGE_AND_AGENT_PLAN §7).

**Windows toplam yol uzunlugu siniri** (`path-resolver.ts`):
`resolveUnderRoot` - TUM fiziksel/dogrulama yollarinin TEK cozum noktasi -
artik klasik Windows `MAX_PATH` sinirini (260 karakter NULL DAHIL, yani 259
kullanilabilir) da dogrular; asan yol `windows_path_too_long` ile
REDDEDILIR. Sinir fonksiyon parametresiyle gecersiz kilinabilir (varsayilan
degismez) - ofis dagitiminda Windows uzun yol destegi
(`LongPathsEnabled`, >32.767) acilip acilmayacagi HENUZ KARARLASTIRILMADI
(bkz. DEPLOYMENT_AND_OPERATIONS_PLAN.md "uzun yol" acik notu); acik karar
verilene kadar KORUYUCU (klasik) deger kullanilir. `.hasarbotu-staging/
{jobId}` gibi turetilmis goreli yollar da AYNI cozum noktasindan gectigi
icin otomatik kapsanir. Kapsam DISI (belgelenmis kalan risk): bir taban
yola SONRADAN eklenen sabit soneklerin (iscilik yazim modulunun
`.hasarbotu-write.lock`/`.hasarbotu-{token}.tmp.xlsx` gecici/kilit adlari)
AYRICA yeniden kontrolu - taban yol zaten sinirin cok yakininda olan nadir
bir kenar durum.

Kapsam disi (bilinc olarak, ayni kok-ENOENT yanlis siniflandirma
kalibini paylasan ama bu pakette DEGISTIRILMEYEN): `pdf-text-extractor.ts`
ve `policy-ocr-extractor.ts` (AI/OCR okuma-agirlikli isler; "yeni fiziksel
isleri" kapsamina girmiyor, ayrica sunucu tarafinda zaten RETRYABLE).

Kanit (gercek gecici filesystem, gercek PostgreSQL + gercek API ile e2e'ler
DAHIL, hicbir mock fs YOK): 24 yeni test - `root-health.test.ts` (8: saglikli
kok, kok kayip/dosya/reparse-point, verifyWritable:false yazma denemez,
enjekte edilmis yazma/lstat hatalari, silme basarisizligi sagligi
degistirmez), `path-resolver.test.ts` (+4: sinirin tam altinda/ustunde,
parametreyle gecersiz kilma, staging yolu da kapsanir), `verifier.test.ts`
(+2: kok tamamen kayipken YANLIS "missing" DEGIL "storage_unavailable";
kok saglikliyken gercek "missing" davranisi DEGISMEDI), `workspace-
provisioner.test.ts` (+2), `file-operation-executor.test.ts` (+3 kok
erisilemezlik + guncellenmis 1 mevcut test + yeni 1 idempotent-eslesme
testi), `labor-workbook-executor.test.ts` (yeni dosya, 2), `agent-loop.test.ts`
(+2, 1 guncellendi: sentetik `C:\synthetic` gercek gecici dizine cevrildi ki
API-kapali senaryosu D4 kapisiyla KARISMASIN).

`services/api`nin 496 testi (gercek PostgreSQL, `runOnce`/`executeFileOperation`
kullanan gercek e2e'ler dahil) DEGISIKLIKSIZ gecti - server tarafinda hicbir
kod degismedi.

Etki: Yalniz `services/file-agent` degisti (yeni `root-health.ts` + 5 dosyada
entegrasyon). API, contracts, UI, migration ve is akisi sozlesmeleri
DEGISMEDI; yeni tablo/sutun/route yok. Ana calisma agacinda typecheck, lint
(0 error / 2 mevcut warning, degismedi), gercek `hasarbotu_test` PostgreSQL
ile **2.225 basarili / 6 mevcut ortam-kosullu UI skip** (file-agent 78→102,
+24), build/bundle 426.065 bayt (degismedi) ve moderate audit (0 acik) gecti.

Acik kalan: Paket 22 dagitim karari olarak Windows uzun yol destegi
(LongPathsEnabled) acilip acilmayacagi; acilirsa `resolveUnderRoot`in tek
sabiti (`DEFAULT_MAX_ABSOLUTE_PATH_LENGTH`) guncellenecektir. PDF/OCR
yurutucülerindeki ayni kok-ENOENT yanlis siniflandirma kalibi bu pakette
DUZELTILMEDI (yukarida belirtildigi gibi bilincli kapsam disi).

## 2026-07-29 - HB-2026-108: D5 - ADR-Q08 kilidi (WinSW), P:\ gorunurluk bulgusu ve Faz A servis dagitim paketi

Karar: ADR-Q08 (Windows servis yonetimi) **WinSW** ile kilitlendi. Ayrica
D5 arastirmasi sirasinda gercek bir mimari kisit olculup dogrulandi:
mevcut `P:\` pCloud SANAL surucusu, servis sarmalayici SECIMINDEN
BAGIMSIZ olarak hicbir Windows servisinden GORULEMEZ. Bu paket hem karari
hem bu bulgunun COZUMUNU (config + runbook + otomatik dogrulama olarak)
teslim eder. **Gercek kurulum bu pakette YAPILMADI** (kullanici talimati);
tum artefaktlar sentetik/kum havuzu ortamda dogrulandi.

**P:\ bulgusu (olculup dogrulandi):** `net use` BOS (klasik SMB paylasimi
DEGIL); `Get-CimInstance Win32_LogicalDisk` `DriveType=2`
(cikarilabilir/sanal aygit), `VolumeName=pCloud Drive`; olusturan
`pCloud.exe` sureci etkilesimli kullanici oturumunda (Session 1), servis
degil. Microsoft'un resmi belgelemesi
([Defining an MS-DOS Device Name](https://learn.microsoft.com/en-us/windows/win32/fileio/defining-an-ms-dos-device-name)):
LocalSystem OLMAYAN bir surecin olusturdugu aygit adi yalniz o oturumun
AuthenticationID'sinin gorebilecegi "Local" MS-DOS aygit ad alanina girer;
Global ad alanina yalniz LocalSystem yazabilir. Bu, servis hesabi
SECIMIYLE (SYSTEM/NetworkService/ozel hesap fark etmez) COZULEMEYECEK bir
kisittir. SYSTEM baglaminda birebir ampirik dogrulama, bu gelistirme
ortaminda yonetici yukseltmesi bulunmadigi icin YAPILAMADI (kayitli, acik
kalan tek nokta); bunun yerine tekrar kullanilabilir, kendi kendini
temizleyen bir prob araci (`probe-p-drive-system-context.ps1`) teslim
edildi — ofis makinesinde Adim 2.5 olarak ilk calistirma BU sonucu
kesinlestirecektir.

**Cozum: pCloud'u "Senkronize Klasor" moduna gecirmek** (sürücü harfi
DEGIL, duz NTFS dizini) — veritabani semasi zaten yalniz `rootKey` +
goreli yol tuttugu icin (`FILE_STORAGE_AND_AGENT_PLAN.md` §2) bu YALNIZ
File Agent'in yerel `HASARBOTU_AGENT_ROOTS` degerinin guncellenmesidir;
kod/migration/API degismez.

**WinSW secimi gerekcesi:** NSSM'in resmi karali surumu 2014-08-31'de
dondu, Windows 10+ icin bile yalniz 2017-04-26 "on-surum" onerilir
(nssm.cc/download, dogrudan resmi kaynaktan dogrulandi — bir arama motoru
ozetinin "2.25/VS2026" iddiasi resmi kaynakla CELISTIGI icin
KULLANILMADI). Gorev Zamanlayici SCM saglik/bagimlilik semantiginden
yoksundur. WinSW aktif bakimli (guncel karali surum v2.12.0, 2025-01-28),
`<depend>` ile bagimlilik sirasini deklaratif ifade eder, config repo'da
versiyonlanabilir XML'dir.

**Baslangic sirasi:** PostgreSQL (bu makinede zaten kurulu,
`NT AUTHORITY\NetworkService`, `DEPENDENCIES: RPCSS`, gecikmesiz
Auto-start) -> API (`<depend>postgresql-x64-17</depend>`) -> File Agent
(`<depend>hasarbotu-api</depend>`). Kod incelemesiyle dogrulandi: bu SCM
sirasi bir IYILESTIRMEDIR, TEK korumadir DEGILDIR — `services/api/src/
server.ts` Postgres havuzunu TEMBEL kurar ve Postgres hazir olmadan da
`/health` `degraded` ile cokmeden baslar; `services/file-agent/src/
agent.ts`in `runLoop`u (D4) API hazir olmadan da cokmeden bekler/yeniden
dener.

**Teslim edilen artefaktlar** (`deploy/windows-service/`):
- `hasarbotu-api.winsw.xml`, `hasarbotu-file-agent.winsw.xml`: makineden
  bagimsiz SABLONLAR (`__NODE_EXE__`/`__APP_DIR__` yer tutuculari);
  secret/DATABASE_URL/mutlak `P:\`/gelistirici yolu ICERMEZ; roll-by-size
  log dondurme (10 MB x 8 dosya), artan gecikmeli restart (10/30/60 sn,
  1 saatte sifirlanir), `<depend>` zinciri.
- `install-services.ps1`: PLANLA -> ONIZLE -> ONAY -> UYGULA modeli
  (AGENTS.md §7). `-Apply` verilmeden HICBIR degisiklik yapmaz; ancak
  GERCEK kurulum (`-Apply`) YALNIZ yukseltilmis oturumda calisir — plan
  gorunumu yukseltme GEREKTIRMEZ (operator once guvenle onizler).
- `probe-p-drive-system-context.ps1`: herhangi bir surucu harfinin SYSTEM
  baglamindan gorunurlugunu, gecici/kendi kendini temizleyen bir Gorev
  Zamanlayici gorevi ile olcer.
- `scripts/check-windows-service-configs.mjs` (`npm run check:deploy`):
  iki WinSW sablonunun yapisal dogrulugunu (etiket dengesi, gerekli
  elemanlar, dogru `<depend>` zinciri, secret/mutlak yol SIZINTISI YOK)
  otomatik kanitlar; yeni dependency EKLENMEDI (AGENTS.md §8).
- `docs/RUNBOOK_FAZ_A_WINDOWS_SERVICE_DEPLOYMENT.md`: sahip/on kosul/
  komut/beklenen cikti/durdurma olcutu/dogrulama/audit kaniti alanlariyla
  (DEPLOYMENT_AND_OPERATIONS_PLAN.md §5 sablonu) tam prosedur.

**Kanit (gercek kurulum OLMADAN):**
- `check-windows-service-configs.mjs` GECTI; kasitli BOZULMUS bir XML'e
  karsi da dogrulandi (etiket dengesi hatasini DOGRU yakaladi, sonra
  orijinal dosya geri yuklendi).
- Her iki `.ps1` dosyasi `[System.Management.Automation.Language.Parser]`
  ile sozdizimi GECERLI bulundu.
- `install-services.ps1` SENTETIK bir dizin yapisiyla UC senaryoda test
  edildi: (1) tum on kosullar saglanmis + yukseltme YOK -> yalniz plan
  basariyla gosterildi, HICBIR dosya olusmadi; (2) `-Apply` VAR ama
  yukseltme YOK -> acikca durdu (exit 1), HICBIR dosya olusmadi;
  (3) `dist\index.js` eksik -> acikca durdu (exit 1). Hicbir gercek
  WinSW kurulumu/servis kaydi YAPILMADI.
- `probe-p-drive-system-context.ps1` yukseltilmemis oturumda calistirildi:
  acik, eylemsel hata mesajiyla exit 2 ile durdu; HICBIR Gorev
  Zamanlayici gorevi olusturulmadi (`Get-ScheduledTask` sonrasinda
  dogrulandi).

Etki: Yeni `deploy/windows-service/` dizini + `scripts/
check-windows-service-configs.mjs` + yeni runbook. Kok `package.json`a
yalniz `check:deploy` betigi eklendi (ana `build`/`test` zincirlerine
DAHIL EDILMEDI — bu bir uygulama testi degil, dagitim artefakti
dogrulamasidir). Uygulama kodu, sema, contracts, migration DEGISMEDI. Ana
calisma agacinda typecheck, lint (0 error / 2 mevcut warning, degismedi),
gercek `hasarbotu_test` PostgreSQL ile **2.225 basarili / 6 mevcut
ortam-kosullu UI skip** (degismedi — D5 uygulama testi eklemedi),
build/bundle 426.065 bayt (degismedi) ve moderate audit (0 acik) gecti.

Acik kalan: SYSTEM baglaminda P:\ gorunmezliginin birebir ampirik
kaniti ofis makinesinde (yonetici erisimiyle) `probe-p-drive-system-
context.ps1` ile ALINMALIDIR — mevcut kanit cok yuksek guvenle ayni
sonuca isaret eden GOZLEM + resmi Microsoft davranis belgesidir, ancak
SYSTEM baglaminda dogrudan calistirilmis DEGILDIR. WinSW ikili dosyasinin
butunluk dogrulamasi (checksum/imza) operator kararina birakildi. TLS
(OPS-Q03) ve izleme (OPS-Q05) bu paketin kapsami DISINDADIR.

## 2026-07-29 - HB-2026-109: D5 duzeltme - SYSTEM P: probu zaman asimi, ProgramData konumu, tanilama ve UTF-8 duzeltmesi

Karar: `probe-p-drive-system-context.ps1` (HB-2026-108) dort noktada
duzeltildi; koklu bir yeniden tasarim DEGIL, ayni betigin GUVENILIRLIGINI
artiran hedefli bir degisiklik.

**1. Zaman asimi:** sabit 20 saniyelik bekleme suresi, gercek ortamda ILK
SYSTEM baglamli Gorev Zamanlayici calismasinin (surec baslatma + olasi
AV taramasi) her zaman bu kadar hizli bitmeyebilecegini hesaba katmiyordu.
`-TimeoutSeconds` parametresiyle varsayilan 90 saniyeye cikarildi (20-600
araliginda ayarlanabilir) ve bekleme dongusu artik yalniz sonuc dosyasinin
VARLIGINA degil, `Get-ScheduledTask`in `State -eq 'Ready'` (gorev GERCEKTEN
bitti) durumuna da bakiyor - bu, "dosya henuz olusmadi ama gorev de
bitti" (kalici hata) durumunu erken yakalar.

**2. Konum: `C:\ProgramData\HasarBotu\probe`.** Onceki surum sonuc/betik
dosyalarini CAGIRAN (yonetici) oturumun kullanici profiline (`$env:TEMP`)
yaziyordu; SYSTEM baglamindaki gorev bu MUTLAK yola erisebilse de, iki
farkli guvenlik baglami arasinda gereksiz bir bagimliliktir ve zaman
asimi ayiklamasini zorlastirir (hicbir log YOKTU). ProgramData makine
genelinde her hesabin eristigi standart konumdur.

**3. Tanilama: `LastTaskResult` ve eylem ciktisi RAPORLANIYOR.** Onceki
surumde bir hata olsa bile HICBIR IZ kalmiyordu, yalniz "zaman asimi"
goruluyordu. Ic betik artik kendi TUM ciktisini/istisnalarini
`Start-Transcript` ile bir log dosyasina yazar; dis betik hem bu log
icerigini hem `Get-ScheduledTaskInfo`nin `LastTaskResult`/`LastRunTime`
degerlerini EKRANA yazdirir - basarili VEYA basarisiz her calistirmada.
Yalniz Gorev Zamanlayici KAYDI (gecici gorev) her durumda kaldirilir;
sonuc JSON'u, ic betik ve log dosyasi ARTIK SILINMEZ - zaman damgali
(`probe-result-<yyyyMMdd-HHmmss>.json`) kalici audit kaniti olarak
`ProgramData`da birikir.

**4. UTF-8 Turkce karakter sorunu:** PowerShell 5.1 konsolunda Turkce
karakterler (`Yönetici` -> `YÃ¶netici` gibi) bozuk gorunuyordu. Iki katmanli
duzeltme: (a) `[Console]::OutputEncoding`/`$OutputEncoding` betik
basinda acikca UTF-8'e (BOM'suz) ayarlanir - konsol GORUNTUSUNU duzeltir;
(b) sonuc/log/ic betik dosyalari `Set-Content -Encoding utf8` (BOM'LU,
PowerShell 5.1 varsayilani) yerine `[System.IO.File]::WriteAllText(...,
UTF8Encoding($false))` ile acikca BOM'SUZ UTF-8 yazilir/okunur - dosya
icerigi konsol kod sayfasindan TAMAMEN bagimsiz, guvenilir sekilde
dogru kalir. Bu ayrim GERCEK bir sentetik testle dogrulandi: Turkce metin
(`İĞÜŞÖÇ` dahil) round-trip yazilip okundu (esitlik TRUE), dosyanin ilk
3 bayti BOM DEGIL, ve konsol kodlamasi ayarlandiktan sonra metin EKRANDA
DOGRU goruntulendi.

Yukseltme kontrolu, HERHANGI bir dosya/dizin yan etkisinden (ProgramData
dizini olusturma DAHIL) ONCE yapilacak sekilde yeniden siralandi - "yukseltme
yoksa hicbir iz birakma" ilkesi korundu; sentetik testle dogrulandi
(yukseltilmemis oturumda `C:\ProgramData\HasarBotu` OLUSMADI).

**Bulunan gercek hata:** ilk tasarimda dis komut satirinda `cmd /c ... >
log 2>&1` ile stdout/stderr yonlendirmesi denendi, ancak betik yolundaki
Turkce/bosluklu karakterlerle IC ICE tirnaklama riski fark edildi ve
KULLANILMADI; bunun yerine ic betigin KENDISI `Start-Transcript` ile
kendi ciktisini yazar - dis komut satiri SADE kalir, tirnaklama riski
YOK. Bu, kod incelemesi sirasinda (gercek calistirma OLMADAN) fark edilip
duzeltildi.

Kanit (gercek makinede, GERCEK kurulum/veri tasima OLMADAN):
- Her iki `.ps1` (bu dosya + `install-services.ps1`, etkilenmedi)
  `[System.Management.Automation.Language.Parser]` ile sozdizimi GECERLI.
- Yukseltilmemis oturumda betik acik, eylemsel hatayla durdu; `C:\
  ProgramData\HasarBotu` dizini OLUSMADI (dogrulandi).
- UTF-8 BOM'suz round-trip + konsol goruntu duzeltmesi GERCEK bir sentetik
  yazma/okuma/goruntuleme testiyle dogrulandi (yukarida detay).
- Bu oturumda YINE yonetici yukseltmesi YOK; SYSTEM baglaminda GERCEK
  calistirma (asil zaman asimi senaryosunun kendisi) hala YAPILAMADI -
  bu HB-2026-108'in acik kalan tek maddesiyle AYNI kisittir, yeni bir
  kisit degildir. Ofis makinesinde yukseltilmis oturumda calistirilip
  `C:\ProgramData\HasarBotu\probe\` altindaki sonuc dosyasi paylasilmalidir.

Etki: Yalniz `deploy/windows-service/probe-p-drive-system-context.ps1` ve
ilgili RUNBOOK/README pasajlari degisti. `install-services.ps1`, WinSW XML
sablonlari, `check-windows-service-configs.mjs` DEGISMEDI. Uygulama kodu
DEGISMEDI. Typecheck, lint (0 error / 2 mevcut warning), gercek
`hasarbotu_test` PostgreSQL ile **2.225 basarili / 6 mevcut ortam-kosullu
UI skip** (degismedi), build/bundle 426.065 bayt (degismedi) ve moderate
audit (0 acik) gecti.

## 2026-07-29 - HB-2026-110: D5 probu GERCEK SYSTEM calistirmasiyla iki kok kusur bulundu ve duzeltildi; P:\ SYSTEM'den GORUNUYOR

Karar: Bu ofis/gelistirme makinesinde ilk kez yonetici yukseltmesiyle
`probe-p-drive-system-context.ps1` GERCEKTEN calistirildi (HB-2026-108/109
BUNU YAPAMAMISTI). Calistirma `LastTaskResult=1`, sonuc/log dosyasi HIC
OLUSMAMIS ve konsolda Turkce karakterler bozuk (mojibake) olarak basladi —
kullanicinin bildirdigi ile BIREBIR ayni. Kok neden analiziyle HB-2026-109'un
DUZELTMEDIGI iki AYRI gercek kusur bulundu:

**1. Array-literal `+` birlestirme kusuru (LastTaskResult=1'in asil nedeni).**
`$innerLines` dizisinde tek bir eleman `'...' + $DriveLetter + '...'`
bicimindeki string birlestirmeyle olusturuluyordu. Windows PowerShell 5.1,
bu ifadeyi `@(...)` dizi literali icinde TEK bir string olarak degil,
`$DriveLetter`in etrafina GERCEK CRLF ekleyerek UC AYRI parcaya bolerek
degerlendiriyor (ampirik olarak izole edilip dogrulandi — bkz. kanit).
Sonuc: uretilen ic betik dosyasi `Get-PSDrive -Name` / `P` / ` -ErrorAction
SilentlyContinue)` uc satira bolunmus GECERSIZ PowerShell iceriyordu; ic
betik `Start-Transcript`in ilk satirina bile ulasamadan parser hatasiyla
COKUYOR, bu yuzden log dosyasi HIC OLUSMUYORDU (yalniz bos degil, TAMAMEN
YOKTU). Duzeltme: o tek satir, dizideki DIGER tum satirlarin zaten kullandigi
GUVENLI kaliba (double-quote interpolasyon, `+` birlestirme YOK) cevrildi:
`"  \`$result.psDriveVisible = [bool](Get-PSDrive -Name $DriveLetter
-ErrorAction SilentlyContinue)"`.

**2. Kaynak dosya UTF-8 BOM eksikligi (asil "PowerShell 5.1 UTF-8 bozuk"
nedeni — HB-2026-109 YANLIS katmani duzeltmisti).** HB-2026-109
`[Console]::OutputEncoding`/`$OutputEncoding`i (KONSOL/PIPE ciktisi) duzeltti,
ancak asil kusur SATIR OKUMA asamasindaydi: her iki `.ps1` dosyasi da BOM'suz
kaydedilmisti. Windows PowerShell 5.1 (.NET Framework), BOM'suz betik
dosyalarini `Encoding.Default`e (bu makinede tr-TR sistem ANSI kod sayfasi,
Windows-1254) gore okur — betik icindeki Turkce karakter iceren string
literalleri KONSOLA YAZILMADAN COK ONCE, PARSE ANINDA yanlis kod sayfasiyla
cozulup BOZULUYORDU. `[Console]::OutputEncoding` bu asamayi ETKILEMEZ (o
zaten dogru cozulmus .NET string'lerin GORUNTULENMESINI kontrol eder,
KAYNAGIN nasil okundugunu degil). Izole testle kesin kanitlandi: aynı Turkce
metni iceren iki betik, BOM'suz ve BOM'lu, birebir ayni ortamda calistirildi
— BOM'suz `SYSTEM baÄŸlamÄ±ndan ... Ä°ÄÃœÅÃ–Ã‡` (mojibake), BOM'lu `SYSTEM
bağlamından ... İĞÜŞÖÇ` (dogru). Duzeltme: her iki dosya da (`probe-p-drive-
system-context.ps1`, `install-services.ps1` — ikisi de Turkce icerik tasiyor
ve BOM'suzdu) UTF-8 BOM ile yeniden yazildi; ICERIK TEK BAYT BILE DEGISMEDI
(git diff yalniz ilk satira BOM ekledigini ve yukaridaki tek satirlik
concat duzeltmesini gosteriyor).

**Gercek SYSTEM sonucu (bu makinede, ilk kez GERCEKTEN olculdu):** duzeltme
sonrasi `LastTaskResult=0`, log/sonuc dosyalari OLUSTU, konsol Turkce metni
DOGRU: `whoami=nt authority\system`, `Oturum=0`, `Get-PSDrive=True`,
`Test-Path=True`, `Win32_LogicalDisk=True`, `Dizin listeleme=True` ->
**"P:\ SYSTEM bagliminda GORUNUYOR ve listelenebiliyor."**

**ONEMLI - HB-2026-108'in varsayimiyla CELISIYOR:** HB-2026-108, Microsoft'un
"Local" MS-DOS ad alani belgelemesine dayanarak P:\'in SYSTEM'den
GORUNMEYECEGINI teorik olarak sonuclandirmis ve buna dayanarak "pCloud'u
Senkronize Klasor moduna gecirme" cozumunu onermisti. Bu makinedeki GERCEK
olcum bunun TERSINI gosteriyor. Bu, TEK bir gelistirme makinesindeki
ampirik veridir; ofis dagitim makinesinde pCloud'un ayni surum/ayarla
(ozellikle "tum kullanicilar icin surucu harfi" tipi makine-geneli ayarlar
farkli davranabilir) DOGRULANMADAN D5'in senkron-klasor-gecis kararini
GERI ALMAK bu paketin kapsami DISINDADIR — bu gercek bir mimari/urun karari
olup KULLANICI ONAYI gerektirir. Bu paket kapsaminda veri tasima veya
servis kurulumu YAPILMADI (kullanici talimati).

Kanit (bu makinede, gercek yonetici yukseltmesiyle, GERCEK calistirma):
- Duzeltme ONCESI: `LastTaskResult=1`, `probe-result-*.json` ve
  `probe-log-*.log` HIC OLUSMADI (üç ayrı gerçek çalıştırmada tekrarlandı).
- Uretilen ic betik dogrudan calistirilarak izole edildi: PowerShell parser
  tam olarak `Get-PSDrive -Name` / `P` / ` -ErrorAction SilentlyContinue)`
  satir bolunmesini rapor etti (`MissingEndParenthesisInExpression`).
- Minimal izole test: `@('X', 'A' + $Var + 'B', 'Y')` GERCEK bir `.ps1`
  dosyasindan `-File` ile calistirildiginda 3 degil 5 (veya baglama gore
  daha az/coklu, tutarli sekilde YANLIS) eleman uretiyor — kusur PowerShell
  5.1'in kendisinde, arac zincirinde degil.
- Duzeltme SONRASI: ayni makinede DORT ayri gercek SYSTEM calistirmasi
  `LastTaskResult=0` ve dogru log/sonuc dosyalariyla basarili oldu.
- UTF-8: BOM'suz/BOM'lu izole ikili test yukarida aciklandigi gibi kesin
  ayrimi gosterdi; duzeltme sonrasi GERCEK SYSTEM calistirmasinin konsol
  ciktisi (Bash pipe VE dogrudan PowerShell VE `Start-Process`
  `-RedirectStandardOutput` ile) UC FARKLI yakalama yontemi ile de dogru
  Turkce karakterler gosterdi.
- `[System.Management.Automation.Language.Parser]::ParseFile` her iki
  duzeltilmis dosyada da 0 hata verdi.
- `npm run check:deploy` gecti (WinSW XML'leri etkilenmedi). `npm audit
  --audit-level=moderate`: 0 acik. Bu degisiklik yalniz iki `.ps1` dosyasini
  etkiledigi icin typecheck/lint/test/build calismasi GEREKMEDI (TS/JS
  kaynagi degismedi); bu, degisikligin kapsamiyla TUTARLIDIR.

Etki: Yalniz `deploy/windows-service/probe-p-drive-system-context.ps1` ve
`deploy/windows-service/install-services.ps1` degisti (BOM eklendi;
`install-services.ps1`de icerik DEGISMEDI, yalniz BOM). Uygulama kodu,
WinSW XML sablonlari, migration, API/contracts DEGISMEDI. Gercek kurulum
veya veri tasima bu paket kapsaminda YAPILMADI.

Acik kalan: D5'in "pCloud senkron klasore gec" onerisi, bu bulguyla
yeniden degerlendirilmeyi HAK EDIYOR ama bu KULLANICI KARARI. Ofis
dagitim makinesinde de ayni probun calistirilip sonucun (muhtemelen ayni
pCloud surumu/ayariyla) DOGRULANMASI onerilir.

## 2026-07-29 - HB-2026-111: D5 yeniden degerlendirmesi - gercek yazma/silme, ACL, pCloud oturum bagimliligi kaniti; NIHAI ONERI DEGISMEDI (gerekce degisti)

Karar: HB-2026-110'un "P:\ SYSTEM'den GORUNUYOR" bulgusu uzerine, kullanici
acikca D5'in yeniden degerlendirilmesini istedi: gercek SYSTEM yazma/silme
probu, ACL/en-az-yetki durumu ve pCloud'un etkilesimli kullanici oturumuna
bagimliligi kanitlanmali. Reboot/logoff, veri tasima, WinSW kurulumu
YAPILMADI (kullanici talimati). `probe-p-drive-system-context.ps1`e geriye
donuk UYUMLU, varsayilani DEGISTIRMEYEN yeni bir anahtar eklendi:
`-IncludeWriteAndAclProbe` (kapatildiginda mevcut RUNBOOK adimlari BIREBIR
ayni davranir). Bu anahtarla SYSTEM baglaminda UC ek kanit toplaniyor: (1)
kokte sabit adli kucuk bir dosya yazip okuyup SILEREK gercek yazma/silme
yetenegi (gercek musteri verisine DOKUNULMADAN); (2) `Get-Acl` ile kok ACL'i;
(3) `\\?\GLOBALROOT\GLOBAL??\<Harf>:\` NT ad alani yolu dogrudan sinanarak
surucu harfinin GLOBAL mi yoksa oturuma-ozel "Local" ad alaninda mi oldugu.

**Sonuc 1 - Yazma/silme (GERCEKTEN test edildi, SYSTEM baglaminda):**
`writeTestOk=True`, `deleteTestOk=True`. SYSTEM, P:\ kokunde gercekten
dosya olusturup icerigini dogrulayip silebiliyor (yalniz kendi urettigi
gecici isaretci `.hasarbotu-system-p-probe-writetest-<stamp>.tmp`; gercek
veriye dokunulmadi).

**Sonuc 2 - ACL / en-az-yetki (KRITIK bulgu):** `Get-Acl P:\` ->
Owner=`Everyone`, tek ACE: `Everyone: -1 (Allow)` (`-1` = 0xFFFFFFFF, tum
bitler acik — adlandirilmis `FullControl` degerinin [2032127] bile
USTUNDE, sentetik/sanal dosya sistemlerinde tipik olan "sinirsiz" bir
maskedir). **Bu, en-az-yetki DEGIL** — makinede calisan HERHANGI bir
hesap/surec (SYSTEM'e ozel bir kisitlama YOK, ozel bir grant da YOK,
"Everyone" tum haklara sahip) P:\ uzerinde tam denetime sahip. Windows'un
kendi ACL mekanizmasi burada HICBIR erisim sinirlamasi UYGULAMIYOR.

**Sonuc 3 - GLOBAL ad alani (HB-2026-108'in TEMEL varsayimini CURUTEN kanit):**
`globalNamespaceEntryExists=True`. `\\?\GLOBALROOT\GLOBAL??\P:\`
(oturuma-ozel DosDevices tablosunu TAMAMEN atlayan, dogrudan NT nesne
yoneticisi kok ad alanina giden resmi Win32 `GLOBALROOT` onekiyle) `P:`
GERCEKTEN bulundu ve listelenebilir cikti (`Directory.Exists=True`).
Bu, surucu harfinin `\GLOBAL??` (makine geneli) ad alaninda kayitli
oldugunu DOGRUDAN ve KESIN olarak kanitlar — HB-2026-108'in varsaydigi
oturuma-ozel "Local" `DefineDosDevice` DEGIL.

**Neden global? Kok neden bulundu — EldoS CBFS surucusu:** `fltmc instances`
P:'e baglı bir "bfs" minifiltre gosterdi; `Win32_SystemDriver`/`sc qc bfs`
bunun `bfs.sys` ("Aracilik Dosya Sistemi" = EldoS **Callback File System**)
oldugunu, "FSFilter Virtualization" yukleme sirasi grubunda, **AUTO_START**
(onyuklemede kendiliginden yuklenen) bir cekirdek surucusu oldugunu ve
yalniz `FltMgr`e bagimli oldugunu gosterdi (ayni ailenin ikinci surucusu
`cbfs20.sys` da yuklu/calisiyor). `QueryDosDevice("P:")` -> ham NT hedefi
`\Device\{GUID}#0#0` — CBFS'in tipik cihaz adlandirma bicimi. `Win32_LogicalDisk`:
`FileSystem=exFAT`, gercek bir `HarddiskVolume` DEGIL (sentetik/sanal
birim). Cekirdek surucusu MAKINE GENELINDE (oturumdan bagimsiz) yuklu
oldugu icin surucu harfi de GLOBAL kaydediliyor — HB-2026-108'in "her
sanal surucu istemcisi oturuma-ozel DefineDosDevice kullanir" genellemesi
BU pCloud kurulumu icin YANLIS cikti.

**Sonuc 4 - pCloud etkilesimli oturum bagimliligi (mimari kanit, CANLI
oldurme testi YAPILMADI):** CBFS'in TUM amaci, cekirdek surucunun gercek
G/C (okuma/yazma/listeleme) isteklerini KAYDOLMUS bir KULLANICI MODU
geri-cagirma (callback) isleyicisine devretmesidir — bu isleyici burada
`pCloud.exe`dir (Oturum 1'de calisan, Windows SERVISI OLMAYAN, sıradan
etkilesimli bir surec; `Get-Service`de "pcloud" adinda hicbir servis YOK,
yalniz cekirdek suruculeri servis olarak kayitli). Surucu harfinin kendisi
GLOBAL olsa da, SYSTEM'in bugun basarili sekilde okuyup yazabilmesi,
`pCloud.exe`nin O ANDA Oturum 1'de calisiyor ve callback'lere yanit
veriyor OLMASINA baglidir — cagri GLOBAL sembolik baglantidan gecse de,
sonunda AYNI kayitli isleyiciye yonlendirilir. Kullanicinin acikca
yasakladigi reboot/logoff YAPILMADAN VE `pCloud.exe`yi durdurup canli
oturumu KESINTIYE UGRATMADAN bu bagimliligin dogrudan "surucuyu kapat,
basarisiz oldugunu goster" testi BILINCLI olarak YAPILMADI (kullanicinin
gercek, calisan masaustu oturumunu bozma riski); bunun yerine YUKARIDAKI
mimari kanit zinciri (CBFS = callback mimarisi + pCloud.exe servis DEGIL +
sadece Oturum 1'de calisan sıradan bir uygulama) kullanildi. Bu, dogrudan
olcum degil ama COK GUCLU, spesifik teknik kaniti bir cikarimdir.

**NIHAI ONERI (kullanicinin istedigi karar): NTFS senkronize klasor
onerisi GECERLILIGINI KORUYOR — ancak HB-2026-108'in gerekcesi YANLIS,
duzeltilmis gerekce asagida:**

YANLIS (eski) gerekce: "SYSTEM surucu harfini GOREMEZ." Bu artik CURUTULDU
— SYSTEM GORUYOR, okuyor, yaziyor, siliyor.

DOGRU (yeni) gerekce, iki bagimsiz nedenle:
1. **Kullanilabilirlik/dayaniklilik:** P:\ uzerindeki GERCEK G/C, Windows
   SERVISI OLMAYAN, sadece bir insan oturum actiginda baslayan sıradan bir
   masaustu uygulamasina (`pCloud.exe`) baglidir. Insansiz/kesintisiz 7/24
   calismasi gereken bir Windows servisinin (File Agent), kendi calismasi
   icin BASKA, servis-olmayan, oturuma bagli bir uygulamanin ayakta
   kalmasina GUVENMESI kirilgan bir mimaridir — ozellikle sunucu
   yeniden baslatildiginda otomatik oturum acma yoksa veya pCloud
   uygulamasi coker/guncellenirse File Agent sessizce bozulur.
2. **ACL/en-az-yetki:** `Everyone: -1 (tum haklar)` gercek musteri
   verisi (EVRAK/HASAR/OLAY YERI/ONARIM/DEGER KAYBI) icin savunulabilir
   bir erisim sinirlamasi SAGLAMIYOR; makinede calisan HERHANGI bir surec
   veri okuyup degistirip silebilir. NTFS senkron klasore gecis, dosyalarin
   normal NTFS ACL'leriyle (servis hesabina ozel, denetlenebilir izinlerle)
   korunmasini SAGLAR — bu, AGENTS.md §6/§7'nin AI/kritik islem
   sinirlarindan BAGIMSIZ, temel dosya sistemi katmaninda eksik olan bir
   savunma katmanidir.

Kanit (bu makinede, gercek SYSTEM calistirmasiyla, veri tasima/kurulum
OLMADAN):
- `writeTestOk=True`, `deleteTestOk=True` (gecici isaretci dosya,
  gercek veri degil).
- `Get-Acl P:\`: Owner=Everyone, `Everyone: -1 (Allow)`, tek ACE,
  `IsInherited=False`. `[int][System.Security.AccessControl.FileSystemRights]::FullControl`
  = 2032127 (karsilastirma icin) — ACE degeri (-1) bunun da OTESINDE.
- `[System.IO.Directory]::Exists('\\?\GLOBALROOT\GLOBAL??\P:\')` = True
  (hem SYSTEM baglaminda hem normal yukseltilmis oturumdan bagimsiz
  olarak dogrulandi).
- `Get-CimInstance Win32_SystemDriver`/`sc qc bfs`: `bfs.sys` = EldoS
  Callback File System, `FSFilter Virtualization`, `AUTO_START`, yalniz
  `FltMgr`e bagimli; `cbfs20.sys` da yuklu. `fltmc instances`: "bfs" P:'e
  bagli en ust ornek. `QueryDosDevice("P:")` -> `\Device\{GUID}#0#0`.
- `Get-Process`: `pCloud.exe` yalniz Oturum 1'de, sıradan bir kullanici
  sureci olarak calisiyor; `Get-Service` sorgusunda "pcloud" adinda HICBIR
  Windows servisi YOK.
- `net use` bos (SMB/network mapping DEGIL); `Win32_LogicalDisk`:
  `FileSystem=exFAT`, `DriveType=2` (sentetik/sanal birim, gercek
  `HarddiskVolume` DEGIL).
- Yeni `-IncludeWriteAndAclProbe` anahtari KAPALIYKEN (varsayilan) betik
  cikisi HB-2026-110 ile BIREBIR ayni kaldi (geriye-donuk uyumluluk
  dogrulandi, ayrica calistirilarak).
- `[System.Management.Automation.Language.Parser]::ParseFile`: 0 hata.
  `npm run check:deploy`: gecti. `npm audit --audit-level=moderate`:
  0 acik. Yalniz `.ps1` dosyasi degistigi icin typecheck/lint/test/build
  GEREKMEDI (TS/JS kaynagi degismedi).

**Bilerek YAPILMAYAN (kullanici kisitlamasi + ihtiyat):** `pCloud.exe`nin
canli oturumda durdurulup P:\'in GERCEKTEN erisilemez hale gelip
gelmedigini gozlemleyen dogrudan "kill-test" — kullanicinin gercek,
calisan masaustu oturumunu kesintiye ugratacagi icin YAPILMADI. Bu, D5
sonucunu DEGISTIRMEZ (yukaridaki mimari kanit zaten yeterince guclu) ama
istenirse acik bir kullanici onayiyla ayri bir adim olarak yapilabilir.

Etki: Yalniz `deploy/windows-service/probe-p-drive-system-context.ps1`
degisti (yeni opsiyonel `-IncludeWriteAndAclProbe` anahtari, varsayilan
davranis DEGISMEDI). `install-services.ps1`, WinSW sablonlari, uygulama
kodu, migration, API/contracts DEGISMEDI. Gercek kurulum veya veri tasima
bu paket kapsaminda YAPILMADI.

Acik kalan: Ofis dagitim makinesinde ayni derin probun calistirilip ACL/
surucu mimarisinin (ayni EldoS CBFS surumu mu, farkli bir pCloud yapilandirmasi
mi) DOGRULANMASI onerilir — farkli bir pCloud surumu/ayari FARKLI bir ACL/
ad-alani sonucu verebilir. NTFS senkron klasore GECISIN KENDISI (uygulama,
veri tasima, File Agent kok degisikligi) bu paketin kapsaminda DEGIL;
ayri, acikca onaylanmis bir gorev olarak planlanmalidir.

## 2026-07-29 - HB-2026-112: NTFS senkron klasor gecisi icin dry-run plani (yalniz PLAN, veri tasima/WinSW kurulumu YOK)

Karar: Kullanicinin istegiyle `C:\HasarBotuStorage\BARAN GLOBAL EKSPERTIZ`
hedefine gecis icin somut bir dry-run plani hazirlandi ve RUNBOOK'a
`§2a. Dry-run dogrulama plani` olarak eklendi. Reboot/logoff, GERCEK veri
tasima veya WinSW kurulumu YAPILMADI — yalniz salt-okunur olcum (kapasite,
mevcut dosya/klasor sayisi) ve ACL/hash/rollback PROSEDURU yazildi.

**Kapasite (bu makinede, salt-okunur olculdu, GERCEK veri):** Kaynak
`P:\BARAN GLOBAL EKSPERTIZ` = 6.258 dosya, 603 klasor, ~8,64 GB. Hedef
`C:\` = ~726 GB bos alan. Kapasite SORUN DEGIL (onerilen 3x pay = ~26 GB,
mevcut bos alanin cok altinda). **Ihtiyat:** bu, GELISTIRME/test pCloud
hesabinin verisidir; ofis uretim hesabinin gercek hacmi FARKLI (muhtemelen
daha buyuk) olabilir, GERCEK gecisten once ofis makinesinde
TEKRAR OLCULMELIDIR.

**ACL tasarimi (planlandi, UYGULANMADI):** HB-2026-111'in bulgusu
(`P:\`de `Everyone: tum haklar`) duzeltilecek sekilde, yeni kok C:\'den
miras alinan genis `BUILTIN\Users`/`Authenticated Users` haklarini
DEVRALMAYACAK; `icacls /inheritance:d` + yalniz `NT AUTHORITY\SYSTEM`
(WinSW varsayilan servis hesabi) ve `BUILTIN\Administrators`e acik grant
planlandi. **Acik mimari not:** File Agent bugun LocalSystem altinda
calisiyor (WinSW sablonunda `<serviceaccount>` YOK); LocalSystem zaten
makine genelinde genis yetkiye sahip oldugu icin klasor ACL'i tek basina
tam en-az-yetki SAGLAMAZ — adanmis, dusuk yetkili bir servis hesabina
gecis AYRI, henuz karara baglanmamis bir oneri olarak kaydedildi.

**Dosya/hash karsilastirma metodolojisi:** Bu olcekte (6.258 dosya/8,64 GB)
istatistiksel ornekleme YERINE TAM SHA-256 karsilastirmasi onerildi
(hesaplama maliyeti dusuk). Iki asama: (A) dosya sayisi + toplam boyut
esitligi (ucuz, ilk gecis kapisi), (B) her dosyanin goreli-yol eslesmis
SHA-256'si (tam kanit). Karsilastirma ciktisi (yalniz goreli yol + hash,
ICERIK DEGIL) `C:\ProgramData\HasarBotu\probe\`e zaman damgali yazilacak,
REPOSITORY'YE COMMIT EDILMEYECEK (gercek dosya adlari musteri verisi izi
tasiyabilir).

**HASARBOTU_AGENT_ROOTS degisimi:** rootKey (`baran-global-primary`)
DEGISMEZ, yalniz makine ortam degiskeninin degeri `P:\BARAN GLOBAL
EKSPERTIZ` -> `C:\HasarBotuStorage\BARAN GLOBAL EKSPERTIZ` olarak
guncellenecek + File Agent servisi yeniden baslatilacak (ortam degiskeni
yalniz surec baslarken okunur). Veritabaninda HICBIR satir degismez
(`FILE_STORAGE_AND_AGENT_PLAN.md` §2).

**Rollback plani:** Tek geri donus adimi ayni ortam degiskenini eski
P:\ degerine dondurup servisi yeniden baslatmaktir (DB degismez). Eski
`P:\` surucusu geciften sonra EN AZ 14 gun (oneri) DEGISTIRILMEDEN
salt-okunur referans olarak tutulur; silinmesi AYRI, acikca onaylanmis
bir adimdir.

**Bulunan ve duzeltilen gercek kusur (RUNBOOK icinde, calistirmadan once):**
mevcut §4'teki `HASARBOTU_AGENT_ROOTS` ornek degerinde klasor adi yanlis
yazilmisti (`EKSPERTIZ` duz `I`, gercek klasor `EKSPERTİZ` noktali Turkce
`İ` ile) — bu, harfi harfine kopyalanirsa GERCEK bir yol uyusmazligina
(dolayisiyla `storage_unavailable`) yol acardi. Duzeltildi.

Kanit: `Get-ChildItem -Recurse` ile gercek dosya/klasor sayisi ve toplam
boyut olculdu (salt-okunur, hicbir dosya tasinmadi/silinmedi/yazilmadi).
`Get-CimInstance Win32_LogicalDisk` ile C:\ bos alani olculdu. Hedef
`C:\HasarBotuStorage\BARAN GLOBAL EKSPERTİZ` bu olcum aninda HENUZ
OLUSTURULMAMISTI (`Test-Path`=False, dogrulandi) — plan gercekten
"dry-run", kismi/yarim bir gecis durumu YOK.

Etki: Yalniz `docs/RUNBOOK_FAZ_A_WINDOWS_SERVICE_DEPLOYMENT.md` degisti
(yeni §2a + §4 yazim hatasi duzeltmesi + Acik kalan guncellemesi).
Uygulama kodu, WinSW sablonlari, migration, API/contracts, gercek ortam
degiskenleri DEGISMEDI. Gercek kurulum veya veri tasima bu paket
kapsaminda YAPILMADI.

Acik kalan: Bu plan kullanicinin acik onayi olmadan YURUTULMEYECEKTIR.
Ofis dagitim makinesinde §2a.1 kapasite olcumu TEKRARLANMALI; File Agent
servis hesabi (LocalSystem vs adanmis hesap) kararı ayrica verilmelidir.

## 2026-07-29 - HB-2026-113: D6 servis hesabi karari (PLAN, henuz uygulanmadi) - File Agent icin adanmis yerel servis hesabi

Karar: D6 (WinSW/servis kurulumu paketi) baslamadan once, File Agent'in
hangi Windows hesabi altinda calisacagina dair BAGLAYICI bir karar
verildi ve somut prosedur olarak yazildi. Kod, hesap, ACL veya veri
DEGISTIRILMEDI — yalniz `DEPLOYMENT_AND_OPERATIONS_PLAN.md` §2.3 ve
`RUNBOOK_FAZ_A_WINDOWS_SERVICE_DEPLOYMENT.md` yeni §2c guncellendi.

**Karar:** File Agent, WinSW'nin varsayilani olan **LocalSystem** YERINE
adanmis, yerel bir servis hesabi (`svc-hasarbotu-fileagent`) altinda
calisacaktir. Bu, HB-2026-111/112'nin acik biraktigi "adanmis servis
hesabi" sorusunu CEVAPLAR — HB-2026-111 olcumu `P:\` uzerinde `Everyone:
tum haklar` VE File Agent'in bugun LocalSystem oldugunu (klasor ACL'inin
tek basina en-az-yetki SAGLAMADIGINI) gostermisti.

**Kararin dort somut bileseni (RUNBOOK §2c'de tam prosedur):**

1. **Adanmis yerel hesap:** `New-LocalUser` ile olusturulur, rastgele
   guclu parola (SecureString, hicbir zaman komut gecmisine/log'a
   yazilmaz), varsayilan "Users" grup uyeliginden CIKARILIR (gereksiz
   genel haklari tasimamasi icin).
2. **"Log on as a service" hakki:** WinSW'nin `<serviceaccount>`
   blogundaki `allowservicelogon: true` bunu OTOMATIK vermeyi dener
   (resmi WinSW ozelligi) — **D6 UYGULAMASINDA GERCEKTEN dogrulanmali**,
   bu pakette dogrulanmadi (yalniz plan). Yedek: LSA politika API'si
   (`advapi32.dll` LsaAddAccountRights, ek dependency GEREKTIRMEZ) ile
   `SeServiceLogonRight` elle verilir — yaklasim RUNBOOK'ta belgelendi,
   tam govde D6'da yazilip test edilecek.
3. **Etkilesimli/RDP oturumu YASAGI (ZORUNLU, opsiyonel degil):** ayni
   LSA API ile `SeDenyInteractiveLogonRight` + `SeDenyRemoteInteractiveLogonRight`.
4. **NTFS ACL — yalniz Modify:** hedef depolama kokunde (`icacls
   /inheritance:d` sonrasi) yalniz bu hesaba `(OI)(CI)M` (Modify — Tam
   Denetim/izin degistirme/sahiplik alma DEGIL) ve Administrators'a Full
   Control. Uygulama dizininde ayrica Read+Execute (+ yalniz `logs` alt
   dizininde Modify) — LocalSystem'in aksine bu erisim ACIKCA verilmelidir,
   kolayca gozden kacan bir adimdir.

**Bu karar §2a.2'yi (HB-2026-112) SUPERSEDE eder:** o plan LocalSystem
varsayimiyla `NT AUTHORITY\SYSTEM:(OI)(CI)F` grantligi tasarlamisti ve
kendisi zaten bunu "acik mimari not" olarak isaretlemisti. Artik gecerli
degil; RUNBOOK'ta capraz referansla isaretlendi.

**Reddedilen alternatif (kayit icin):** Windows'un **Virtual Service
Account**i (`NT SERVICE\hasarbotu-file-agent`, parola YONETIMI
gerektirmeyen, dogasi geregi etkilesimli oturum acamayan bir hesap turu)
teknik olarak daha az operasyonel yuk (parola rotasyonu YOK) getirirdi.
Kullanicinin acik talebi "ayri YEREL servis hesabi" oldugu icin bu
alternatif birincil plan olarak SECILMEDI; ancak D6 uygulamasinda ikinci
bir secenek olarak yeniden degerlendirilebilir (kullanici karari).

Kanit: Bu pakette GERCEK hesap olusturulmadi, ACL degistirilmedi, WinSW
XML sablonu degistirilmedi. `DEPLOYMENT_AND_OPERATIONS_PLAN.md`/`RUNBOOK`
degisiklikleri yalniz metin/prosedur; hicbir `.ps1`/`.xml` dosyasi
etkilenmedigi icin `Parser::ParseFile`/`check:deploy`/typecheck/lint/test/
build calistirilmasi GEREKMEDI (kod degismedi).

Etki: Yalniz `docs/DEPLOYMENT_AND_OPERATIONS_PLAN.md` ve
`docs/RUNBOOK_FAZ_A_WINDOWS_SERVICE_DEPLOYMENT.md` degisti. Uygulama
kodu, WinSW sablonlari, `install-services.ps1`, migration, API/contracts,
gercek hesap/ACL/ortam degiskeni DEGISMEDI.

Acik kalan: D6'nin KENDISI (gercek hesap olusturma, LSA haklari, ACL
uygulama, WinSW sablonuna `<serviceaccount>` ekleme, parola rotasyon
prosedurunun yazilmasi) AYRI, acikca onaylanmis bir uygulama gorevidir.
Virtual Service Account alternatifi kullanici tarafindan yeniden
degerlendirilebilir.

## 2026-07-29 - HB-2026-114: D6 - File Agent servis hesabi plan/preview/apply betigi yazildi ve test edildi (gercek hesap/ACL/servis kurulumu YOK)

Karar: HB-2026-113'un karari `deploy/windows-service/setup-file-agent-
service-account.ps1` olarak GERCEK bir arac haline getirildi.
`install-services.ps1` ile AYNI Planla->Onizle->Onay->Uygula modelini
kullanir. Kullanicinin acik talimatiyla bu pakette GERCEK hesap
olusturulmadi, GERCEK ACL degistirilmedi, GERCEK servis kurulmadi, veri
tasinmadi — yalniz betik yazildi ve GUVENLE test edilebilen kisimlari
GERCEKTEN test edildi.

**Dort dogrulama/uygulama alani (betigin kendisi hem PLAN hem APPLY
modunda calisir):**

1. Hesap varligi + "Users" grubu uyeligi.
2. `SeServiceLogonRight` (Log on as a service) — kendi LSA
   `LsaAddAccountRights`/`LsaEnumerateAccountRights` P/Invoke'u ile
   (ek dependency YOK, yalniz `advapi32.dll`); WinSW'nin
   `allowservicelogon`ina BAGIMLI DEGIL, bu yuzden davranisi
   ONGORULEBILIR.
3. `SeDenyInteractiveLogonRight`/`SeDenyRemoteInteractiveLogonRight`
   (etkilesimli/RDP oturum yasagi) — ayni LSA API.
4. NTFS en-az-yetki ACL — `icacls` metin ayrıştırma DEGIL,
   `System.Security.AccessControl.DirectorySecurity`/
   `FileSystemAccessRule` ile programatik (miras kesilir, yalniz hesaba
   Modify/Read+Execute ve Administrators'a FullControl).
5. WinSW `<serviceaccount>` kimligi (`<domain>`/`<user>`/
   `<allowservicelogon>`) — `<password>` elemani KASITLI OLARAK ASLA
   YAZILMAZ; gercek parola servis KURULDUKTAN SONRA
   `Set-FileAgentServiceLogonCredential` (`sc.exe config ... password=`,
   yalniz bellekte cozulur) ile ayarlanir — bu fonksiyon HAZIR ama bu
   betik tarafindan CAGRILMAZ (gercek servis yok).

**Test sirasinda BULUNAN VE DUZELTILEN iki gercek kusur:**

1. **ACL karsilastirma yanlis-negatif uretiyordu.** .NET
   `FileSystemAccessRule` kurucusu "Allow" kurallari icin `Synchronize`
   bitini OTOMATIK ekler (`Modify` -> gercekte `Modify, Synchronize`);
   `Test-LeastPrivilegeAcl` ham `$ExpectedRights.ToString()` ile
   karsilastirinca GERCEKTEN dogru uygulanmis bir ACL'i bile YANLIS
   olarak raporluyordu. Duzeltme: karsilastirma, AYNI kurucuyla
   olusturulmus bir REFERANS kuralin ToString()'iyle yapilir (kendi-
   tutarli). Gercek scratch-klasor testiyle BULUNDU (Modify uygulandi,
   Pass=False donuyordu) ve duzeltme sonrasi Pass=True + negatif test
   (yanlis hak = False) DOGRULANDI.
2. **WinSW XML okuma/yazma HB-2026-110 ile AYNI kusur sinifini
   tasiyordu.** `Get-Content -Raw` (varsayilan kodlama) + `$xml.OuterXml`
   kullanimi (a) gercek sablondaki Turkce yorumlari BOM'suz okurken
   sistem ANSI kod sayfasina (tr-TR) dusurup mojibake uretiyordu, (b)
   TUM bicimlendirmeyi (satir sonu/girinti) atip dosyayi TEK SATIRA
   COKERTIYORDU. Gercek sablonun bir SENTETIK kopyasina karsi test
   edilerek BULUNDU. Duzeltme: okuma `[System.IO.File]::ReadAllText(...,
   Encoding.UTF8)` ile acikca UTF-8; yazma `XmlWriterSettings`
   (`Indent=true`, UTF8 BOM'suz) ile GIRINTILI ve DOGRU Turkce karakterle.

**Kanit (bu makinede, gercek hesap/ACL/servis OLMADAN):**
- `[System.Management.Automation.Language.Parser]::ParseFile`: 0 hata
  (her iki duzeltmeden sonra da tekrar dogrulandi).
- Onizleme (Apply'siz) modu SENTETIK dizinlere (repo/hedef DISINDA,
  scratchpad) karsi GERCEKTEN calistirildi: mevcut durum + plan dogru
  raporlandi, HICBIR degisiklik yapilmadi.
- ACL uygula/dogrula fonksiyonlari bir SCRATCH klasore karsi MEVCUT
  (yeni OLUSTURULMAMIS) bir kullanici hesabiyla (`desktop-efn2g33\user`)
  gercekten calistirildi: Modify senaryosu Pass=True, ReadAndExecute
  senaryosu Pass=True, kasitli YANLIS beklenen-hak senaryosu Pass=False
  (dogru negatif).
- `Get-AccountRights` (salt-okunur LSA sorgusu) MEVCUT hesaplara
  (`NT AUTHORITY\NETWORK SERVICE`, geçerli kullanici, olmayan bir hesap)
  karsi calistirildi — hicbir hak DEGISTIRILMEDEN dogru/tutarli sonuc
  dondu.
- WinSW kimlik ekleme/dogrulama gercek `hasarbotu-file-agent.winsw.xml`
  SABLONUNUN bir SENTETIK kopyasina (repo'daki gercek dosya
  DEGISTIRILMEDI) karsi test edildi: ekleme oncesi Pass=False (eleman
  yok), sonrasi Pass=True, Turkce yorumlar DOGRU goruntulendi, XML
  GIRINTILI/okunabilir kaldi; kasitli eklenen `<password>` elemani
  DOGRU tespit edilip Pass=False raporlandi.
- `-Apply` yukseltme VARKEN ama `-ServiceAccountPassword` VERILMEDEN
  cagrildi: `exit 2`, hicbir hesap olusmadi (`Get-LocalUser` sonrasinda
  dogrulandi), hicbir ACL degismedi.
- `npm run check:deploy`: gecti (WinSW XML sablonlari ETKILENMEDI).
  `npm audit --audit-level=moderate`: 0 acik. Yalniz yeni bir `.ps1`
  dosyasi eklendigi/degistirildigi icin typecheck/lint/test/build
  GEREKMEDI (TS/JS kaynagi degismedi).

**Bilerek TEST EDILMEYEN (gercek hesap/ACL olusturmamak icin, kullanici
talimatiyla TUTARLI):** `New-LocalUser` ile GERCEK hesap olusturma ve
`LsaAddAccountRights` ile GERCEK hak verme/reddetme hicbir hesaba karsi
CAGRILMADI (yeni VEYA mevcut) — bunlar SADECE kod incelemesiyle
dogrulandi (standart, yaygin bilinen LSA P/Invoke deseni; ayni struct
duzeni/cagri sirasi coklu kamuya acik referansta kullanilir). D6'nin
GERCEK yurutulmesinde bu iki cagrinin ampirik dogrulanmasi GEREKIR.

Etki: Yalniz `deploy/windows-service/setup-file-agent-service-account.ps1`
(YENI dosya) ve `docs/RUNBOOK_FAZ_A_WINDOWS_SERVICE_DEPLOYMENT.md`
(§2c guncellendi + §7/Acik kalan) degisti. `install-services.ps1`,
WinSW sablonlari, uygulama kodu, migration, API/contracts, gercek
hesap/ACL/ortam degiskeni DEGISMEDI.

Acik kalan: `New-LocalUser`/`LsaAddAccountRights` cagrilarinin GERCEK
ortamda ampirik dogrulanmasi (D6'nin gercek yurutulmesi); parola
rotasyon prosedurunun yazilmasi; `install-services.ps1`e entegrasyon
(bu betigi WinSW kurulumundan ONCE otomatik cagirma) henuz yapilmadi —
hepsi ayri, acikca onaylanmis adimlardir.

## 2026-07-29 - HB-2026-115: KRITIK DUZELTME - DESKTOP-EFN2G33 gercek ofis/dagitim makinesidir (gelistirme/test varsayimi YANLISTI); ACL planina pCloud senkron hesabi eklendi

Karar: Kullanici, bu oturum boyunca (HB-2026-108'den HB-2026-114'e kadar,
ayrica onceki preview raporunda) TUTARLI bicimde tekrarlanan bir
VARSAYIMI duzeltti: **DESKTOP-EFN2G33 gercek ofis/dagitim makinesidir,
"gelistirme/test makinesi" DEGILDIR.** Bu, onceki entrylerin METNINDE
(prosedur/mantik DEGIL) yer alan gercek bir hatadir.

**Duzeltmenin kapsami ve ETKISI (ONEMLI - cogu bulgu GUCLENIYOR, zayiflamiyor):**
- HB-2026-108 ile HB-2026-114 arasindaki TUM ampirik olcumler (P:\
  SYSTEM'den gorunurluk/yazma/silme, GLOBAL ad alani kaniti, EldoS CBFS
  surucu bulgusu, ACL `Everyone: tum haklar`, kapasite olcumu — 6.258
  dosya/603 klasor/~8,64 GB, `setup-file-agent-service-account.ps1`in
  onizleme testleri) GERCEK PROOF makinesinde yapilmis GERCEK URETIM
  VERISIDIR — "gelistirme ortaminda olculdu, ofis makinesinde farkli
  cikabilir" seklindeki TUM ihtiyat notlari GECERSIZDIR ve kaldirildi
  (`RUNBOOK_FAZ_A_WINDOWS_SERVICE_DEPLOYMENT.md`, `PROJECT_STATUS.md`,
  `DEPLOYMENT_AND_OPERATIONS_PLAN.md`).
- `P:\BARAN GLOBAL EKSPERTIZ` altinda GOZLEMLENEN icerik (gercek is
  dosyalari, kimlik fotokopisi dahil gercek musteri/personel verisi)
  bu duzeltmeyle TUTARLIDIR — bu bir test/sentetik hesap DEGIL, gercek
  isletme verisidir. AGENTS.md'nin "gercek musteri verisi kullanma"
  ilkesi geregi bu veriye hicbir zaman icerik olarak ERISILMEDI/OKUNMADI,
  yalniz salt-okunur sayim/boyut olcumu yapildi ve HICBIR gercek dosya
  adi committed dokumana yazilmadi.
- DECISION_LOG'un ESKI entryleri (HB-2026-108...114) METIN OLARAK
  DEGISTIRILMEDI - bu, append-only audit kaydi ilkesiyle TUTARLIDIR
  (bkz. AGENTS.md, `case_location_history` deseni). Bu entry AUTORITER
  duzeltmedir; eski entrylerdeki "gelistirme makinesi" ifadeleri artik
  GECERSIZ sayilmalidir. `PROJECT_STATUS.md`/`RUNBOOK` gibi "canli"
  operasyonel belgelerde ise dogrudan duzeltme yapildi (yanlis bilginin
  operatoru yanlis yonlendirmesini onlemek icin).

**IKINCI, BAGIMSIZ VE KRITIK bulgu: ACL planinda pCloud senkron hesabi
EKSIKTI.** Kullanici sunu belirtti: `pCloud.exe` `DESKTOP-EFN2G33\user`
hesabiyla calisiyor (HB-2026-111'de zaten `Get-Process` ile GOZLEMLENMISTI
ama D6/HB-2026-113-114'un ACL tasarimina YANSITILMAMISTI). HB-2026-113/114
plani depolama kokune YALNIZ File Agent servis hesabina (`svc-hasarbotu-
fileagent`) Modify + Administrators'a Full Control veriyordu. **NTFS
senkron klasor moduna gecildiginde pCloud'un KENDISI bu klasore dosya
YAZAR** (senkronizasyon budur); servis hesabina grant vermek pCloud'a
HICBIR sey vermez. Miras kesilip Everyone/Users/Authenticated Users
kaldirildiginda pCloud'un kendi yazma erisimi de KOPARDI - senkronizasyon
SESSIZCE (hata mesaji olmadan, dosyalar basitce guncellenmeyerek)
durabilirdi. Bu, calistirilmadan ONCE kod incelemesiyle DEGIL, kullanicinin
mimari bilgisiyle YAKALANDI - onemli bir dogrulama katmanidir.

**Duzeltme (`setup-file-agent-service-account.ps1`):**
- Yeni parametre: `-PCloudSyncAccount` (varsayilan: bu oturumun kendisi,
  `$env:COMPUTERNAME\$env:USERNAME` — GERCEK kurulumda ACIKCA verilmelidir).
- `Test-LeastPrivilegeAcl`/`Set-LeastPrivilegeAcl` TEK hesap+hak yerine
  `[hashtable[]]$Grants` (coklu kimlik+hak) kabul edecek sekilde
  GENELLESTIRILDI; `New-AclGrant` yardimci fonksiyonu eklendi.
- Depolama koku artik UC grant aliyor: servis hesabi -> Modify,
  `-PCloudSyncAccount` -> Modify, Administrators -> Full Control.
  Uygulama dizini/loglar DEGISMEDI (pCloud oraya dokunmaz, yalniz
  File Agent servis hesabi).
- `Test-LeastPrivilegeAcl`e YENI bir kontrol eklendi: `$Grants`
  DISINDA baska HICBIR ACE olmamali (once yalniz "beklenen hesap
  eksik mi" kontrol ediliyordu, "beklenmeyen FAZLA hesap var mi"
  KONTROL EDILMIYORDU - coklu-hesap senaryosunda bu bosluk onemli
  hale geldi).

**Kanit (bu makinede, gercek hesap/ACL/veri OLMADAN):**
- `Parser::ParseFile`: 0 hata (refactor sonrasi tekrar dogrulandi).
- Coklu-hesap ACL mantigi bir SCRATCH klasore karsi IKI MEVCUT
  (yeni olusturulmamis) hesapla (`DESKTOP-EFN2G33\user` +
  `NT AUTHORITY\NETWORK SERVICE`, ikincisi gercek bir "ikinci hesap"
  temsilcisi olarak) GERCEKTEN test edildi: uygulama oncesi Pass=False
  (iki hesap da eksik), uygulama sonrasi Pass=True, UC ayri negatif
  test (beklenen ucuncu bir hesap eksik -> False; hesaplardan biri
  Grants listesinden CIKARILINCA "beklenmeyen fazla ACE" DOGRU
  tespit edildi -> False).
- `-Apply` verilmeden GERCEK hedef degerlerle (`C:\HasarBotuStorage\
  BARAN GLOBAL EKSPERTİZ`, `C:\HasarBotu\services\file-agent`, gercek
  commit'li WinSW sablonu — salt-okunur kontrol) yeniden onizleme
  calistirildi: plan artik UC grant'i (servis hesabi + `DESKTOP-
  EFN2G33\user` + Administrators) doguru gosteriyor; `git status`
  sablon dosyasinda DEGISIKLIK YOK; gercek hesap/klasor OLUSMADI.
- `npm run check:deploy` gecti; `npm audit --audit-level=moderate`
  0 acik. Yalniz `.ps1`/`.md` degistigi icin typecheck/lint/test/build
  GEREKMEDI.

Etki: `deploy/windows-service/setup-file-agent-service-account.ps1`
(coklu-hesap ACL destegi), `docs/RUNBOOK_FAZ_A_WINDOWS_SERVICE_DEPLOYMENT.md`
(§2/§2a/§2c/§7/Acik kalan makine-kimligi + ACL duzeltmesi),
`docs/PROJECT_STATUS.md` (ilgili "gelistirme makinesi" notlarinin
duzeltilmesi), `docs/DEPLOYMENT_AND_OPERATIONS_PLAN.md` (§2.3 D6
karari guncellendi) degisti. Uygulama kodu, WinSW sablonlari, migration,
API/contracts, gercek hesap/ACL/servis/veri DEGISMEDI.

Acik kalan: GERCEK kurulumda `-PCloudSyncAccount`in dogru hesaba
(muhtemelen `DESKTOP-EFN2G33\user`dan FARKLI, gercek operator/servis
hesabi olabilir) ACIKCA verilmesi operator sorumlulugudur - varsayilana
GUVENILMEMELIDIR. `New-LocalUser`/`LsaAddAccountRights`in gercek hesaba
karsi ampirik dogrulanmasi D6'nin gercek yurutulmesinde GEREKIR.

## 2026-07-29 - HB-2026-116: D6 gercek uygulama akisi ATOMIK hale getirildi - tek seferlik bellek-ici parola, hata halinde tam geri alma, servis Disabled kurulur (gercek Apply hala calistirilmadi)

Karar: Kullanicinin talimatiyla `setup-file-agent-service-account.ps1`in
`-Apply` akisi ATOMIK hale getirildi: hesap + LSA haklari + ACL + GERCEK
WinSW servis kurulumu TEK islem olarak uygulanir; herhangi bir adim
basarisiz olursa TAMAMLANMIS TUM adimlar ters sirayla GERI ALINIR. Servis
her zaman `Disabled` kurulur ve ASLA baslatilmaz. Bu pakette GERCEK
Apply YINE calistirilmadi (kullanici acikca yasakladi) - yalniz arac
degistirildi ve GUVENLE test edilebilen kisimlari test edildi.

**Parola guvenligi (HB-2026-116'nin ana talebi):** Onceki surumde parola
OPERATOR tarafindan uretilip `-ServiceAccountPassword` (SecureString)
parametresiyle VERILIYORDU. Artik betik parolayi KENDISI, `-Apply`
sirasinda BIR KEZ, `RandomNumberGenerator` ile (32 bayt) uretir; islem
boyunca YALNIZ SecureString olarak bellekte tutulur; hesaba
(`New-LocalUser`/`Set-LocalUser`) ve SCM'ye (`sc.exe config ...
password=`, TEK SEFERLIK komut satiri argumani) aktarilir; HICBIR
dosyaya/WinSW XML'ine/log'a/repository'ye YAZILMAZ. Islem bittikten
sonra parolayi bilen/hatirlayan HICBIR kayit KALMAZ - bu KASITLIDIR
(hesap yalniz "Log on as a service" icindir, hicbir insan interaktif
giris yapmaz). Rotasyon = betigi tekrar `-Apply` ile calistirmaktir
(mekanizma HAZIR, resmi bir "ne siklikta" prosedur henuz yazilmadi).

**Atomiklik (rollback):** `$undoStack` (`Stack[scriptblock]`) her basarili
adimdan SONRA o adimi geri alan bir scriptblock'u yigina ekler:
- Hesap YENI olusturulduysa: `Remove-LocalUser` (onceden VARSA, parolasi
  YENILENIR ama hesabin KENDISI silinmez - eski parola zaten bilinmiyordu,
  "geri alinacak eski hal" YOKTUR, kasitli).
- LSA haklari verildiyse: `LsaRemoveAccountRights` (P/Invoke, zaten
  tanimliydi, ilk kez KULLANILDI).
- ACL degistirildiyse: degisiklikten ONCE `Get-Acl` ile yakalanan orijinal
  ACL nesnesi, `Set-Acl` ile AYNEN geri yazilir (miras/`IsProtected`
  durumu DAHIL); `logs` dizini bu adimda YENI olusturulduysa TAMAMEN
  silinir.
- WinSW ikilisi/XML'i kopyalandiysa/render edildiyse: silinir; servis
  KURULDUYSA `<exe> uninstall`.
Basarisizlik durumunda `Invoke-Rollback` yigindaki TUM adimlari POP
ederek (LIFO - ters sira) calistirir; bir geri alma adimi basarisiz
olursa DIGERLERI yine de denenir (best-effort, birbirini ENGELLEMEZ).

**Servis her zaman Disabled:** GERCEK `<exe> install` + SCM kimlik
bilgisi ayarlandiktan HEMEN SONRA `Set-Service -StartupType Disabled`
cagrilir; betik HICBIR ZAMAN `Start-Service` cagirmaz. Servisi
etkinlestirme/baslatma bu betigin KAPSAMI DISINDA, ayri onaylanmis bir
adimdir.

**Bulunan ve duzeltilen gercek kusur (gercekten calistirilarak BULUNDU):**
`Write-Error 'mesaj'; exit N` deseni, script-genelinde
`$ErrorActionPreference = 'Stop'` iken `Write-Error`in TERMINATING
sayilmasi nedeniyle `exit N` satirina HIC ULASMIYORDU - gercek cikis kodu
her zaman PowerShell'in kendi genel hata kodu (`1`) oluyordu, belgelenen
`N` (ör. `2`) DEGIL. Bu, `-Apply` icin `-WinSwExe` verilmeden cagirma
testinde GERCEKTEN yakalandi (beklenen `2`, gozlemlenen `1`). Duzeltme:
ilgili tum `Write-Error` cagrilarina `-ErrorAction Continue` eklendi
(yalniz o cagri icin global tercihi gecersiz kilar); tekrar test edilip
dogru kod (`2`) dondugu DOGRULANDI. Bu kusur muhtemelen `probe-p-drive-
system-context.ps1`/`install-services.ps1`deki BENZER desenlerde de
mevcuttur (henuz elle DOGRULANMADI - ayri, kucuk bir takip maddesi).

**Yapisal degisiklik:** `Invoke-Rollback` fonksiyonu ana akisin ERKEN
`exit`lerinden (ör. `-Apply` verilmemisse) BAGIMSIZ test edilebilmesi
icin fonksiyon tanimlari bolumune tasindi (daha once main-flow icinde,
try blogundan hemen once tanimliydi - bu haliyle dot-source ile izole
TEST EDILEMIYORDU; gercekten denenip BULUNDU).

Kanit (bu makinede, GERCEK hesap/ACL/servis/veri OLMADAN):
- `Parser::ParseFile`: 0 hata (her degisiklikten sonra tekrar dogrulandi).
- Onizleme modu GERCEK hedef degerlerle (`C:\HasarBotuStorage\BARAN
  GLOBAL EKSPERTİZ`, `C:\HasarBotu\services\file-agent`, gercek WinSW
  sablonu) yeniden calistirildi: plan artik WinSW kurulum + Disabled
  adimlarini da gosteriyor; HICBIR degisiklik yapilmadi.
- `New-ServiceAccountPassword`: gercekten cagrildi, `SecureString` tipi
  dogrulandi, uretilen deger 44 karakter (32 bayt base64), IKI ayri
  cagri FARKLI deger uretti (rastgelelik saglandi).
- `New-RenderedWinSwConfig`: gercek commit'li sablona karsi SCRATCH bir
  hedefe calistirildi - Turkce metin DOGRU (mojibake YOK), `__NODE_EXE__`/
  `__APP_DIR__` yer tutucular DOGRU deger'e cozuldu (`<executable>C:\
  Program Files\nodejs\node.exe</executable>` vb.), sablonun KENDISI
  DEGISMEDI.
- `Invoke-Rollback` sahte (dummy) scriptblock'larla izole test edildi:
  4 eleman TERS sirayla (4,3,2,1) calisti; bir eleman kasitli `throw`
  ettiginde DIGER ikisi yine de calisti (best-effort dogrulandi).
- ACL geri-alma deseni bir SCRATCH klasorde GERCEK uygulandi: orijinal
  ACL (`SYSTEM/Administrators/user: FullControl`, miras ACIK) yakalanip
  kilitlendi (`user: Modify`), sonra rollback closure cagrilarak BIREBIR
  orijinal ACL'e (ayni 3 ACE + `IsProtected=False`) DONULDUGU dogrulandi.
- `-Apply` `-WinSwExe` verilmeden cagrildi: `exit 2`, hicbir degisiklik
  yok (duzeltme ONCESI yanlislikla `exit 1` veriyordu - BULUNUP
  duzeltildi).
- `-Apply` GERCEK, onceden kurulu bir Windows servisine (`Spooler`)
  `-ServiceName` ile isaret ederek cagrildi: `exit 2`, `Spooler`e
  HICBIR sekilde dokunulmadi (yalniz salt-okunur `Get-Service`).
- `npm run check:deploy` gecti (WinSW XML sablonlari ETKILENMEDI);
  `npm audit --audit-level=moderate`: 0 acik. Yalniz `.ps1`/`.md`
  degistigi icin typecheck/lint/test/build GEREKMEDI.
- Islem sonunda: gercek hesap YOK, `C:\HasarBotuStorage\...` YOK,
  `C:\HasarBotu` YOK, `hasarbotu-file-agent` servisi YOK (hepsi
  dogrulandi).

**Bilerek TEST EDILMEYEN (kullanicinin acik talimatiyla - "henuz apply
calistirma"):** Gercek `-Apply` akisinin TAM UCTAN UCA calistirilmasi
(gercek hesap olusturma, gercek LSA hakki verme, gercek WinSW `install`,
gercek `sc.exe config`, gercek `Set-Service -StartupType Disabled`) VE
kasitli bir hata enjekte edip GERCEK rollback'in butun zinciri (hesap+
haklar+ACL+servis) dogru geri aldigini kanitlama - bunlar D6'nin gercek
yurutulmesinde, acik kullanici onayiyla YAPILMALIDIR.

Etki: Yalniz `deploy/windows-service/setup-file-agent-service-account.ps1`
ve `docs/RUNBOOK_FAZ_A_WINDOWS_SERVICE_DEPLOYMENT.md` (§2c tamamen
yeniden yazildi + §7/Acik kalan guncellendi) degisti. `install-services.ps1`,
WinSW sablonlari, uygulama kodu, migration, API/contracts, gercek hesap/
ACL/servis/veri/ortam degiskeni DEGISMEDI.

Acik kalan: D6'nin gercek yurutulmesi (kullanici onayiyla) tam uctan uca
akisi ve rollback'i ampirik olarak kanitlamalidir; parola rotasyon
SIKLIGI/sorumlusu resmi bir prosedur olarak yazilmali;
`probe-p-drive-system-context.ps1`/`install-services.ps1`deki benzer
`Write-Error; exit N` desenlerinin AYNI kusuru tasiyip tasimadigi ayrica
kontrol edilmelidir (kucuk, dusuk-risk bir takip maddesi).

## 2026-07-29 - HB-2026-117: sc.exe kaldirildi, dogrudan ChangeServiceConfigW (Win32 API) kullanildi; tam atomik zincir failure-injection ile test edildi (gercek Apply hala calistirilmadi)

Karar: Kullanicinin talimatiyla SCM parola aktariminda `sc.exe config`
KALDIRILDI - `sc.exe` bir COCUK SUREC baslatir ve parolayi `password=`
KOMUT SATIRI ARGUMANI olarak tasir; bu, sürec calistigi kisa sure
boyunca WMI `Win32_Process`/denetim araclari gibi baska bir surecin
komut satirini okuyabilmesi anlamina gelir. Yerine dogrudan Win32 SCM
API'si (`advapi32.dll`: `OpenSCManagerW`/`OpenServiceW`/
`ChangeServiceConfigW`/`CloseServiceHandle`) bu surecin ICINDEN cagrilir
- HICBIR cocuk surec olusturulmaz, parola HICBIR ZAMAN bir komut
satirinda gorunmez.

**Parola bellek guvenligi:** `Marshal.SecureStringToGlobalAllocUnicode`
ile SecureString GECICI, YONETILMEYEN (unmanaged, .NET GC/heap DISINDA)
bir arabellege cozulur; `ChangeServiceConfigW`'a bu arabellegin HAM
POINTER'i (`IntPtr`) gecer - yonetilen bir `string` ASLA olusturulmaz
(immutable oldugu ve guvenle sifirlanamayacagi icin). API cagrisi biter
bitmez `Marshal.ZeroFreeGlobalAllocUnicode` cagrilir - bu, .NET'in
BELGELENEN API garantisidir: yalniz `FreeHGlobal` (serbest birakma)
DEGIL, ONCE icerigi sifirlar SONRA serbest birakir.

**Test sirasinda GERCEKTEN calistirilarak bulunan VE duzeltilen iki
P/Invoke kusuru:**
1. **`OpenSCManagerW` NULL `lpDatabaseName` ile basarisiz oluyordu.**
   MSDN, `lpDatabaseName=NULL` gecildiginde varsayilan "ServicesActive"
   veritabanina baglanildigini soyler. Bu ortamda GERCEKTEN test edildi:
   NULL gecmek `ERROR_INVALID_NAME` (Win32 kod 123) ile basarisiz
   oluyordu; acikca `'ServicesActive'` string'i vermek ise basarili
   oldu (handle GERCEKTEN gecerli donuyor). Izole minimal repro ile
   (bu betikten BAGIMSIZ, salt Add-Type + tek cagri) DOGRULANDI - bu
   PowerShell/.NET marshaling katmaninin bir ozelligi, betigin kendi
   mantik hatasi degil, ama pratik sonucu AYNI: acikca 'ServicesActive'
   verilmeli.
2. **`SERVICE_NO_CHANGE` sabiti (`0xFFFFFFFF`) P/Invoke `uint`
   parametrelerine GECIRILEMIYORDU.** PowerShell 5.1, `0xFFFFFFFF`
   hex literalini once `Int32 (-1)` olarak ayristirir; bu deger
   `ChangeServiceConfigW`'in `uint dwServiceType`/`dwStartType`/
   `dwErrorControl` parametrelerine baglanmaya calisilinca "Deger bir
   UInt32 icin cok buyuk ya da cok kucuktu" hatasiyla BASARISIZ oluyordu
   - GERCEKTEN cagrilarak BULUNDU. `[uint32]0xFFFFFFFF` (acik cast)
   dahi AYNI hatayi veriyor (once Int32 -1'e ayristirilip SONRA araligi
   asan bir UInt32 cast'i deneniyor); dogru cozum `[uint32]::MaxValue`
   (doğrudan .NET statik alani, isaretsiz bit deseni ile).

**Tam atomik zincir - failure-injection testi (kullanicinin ozellikle
istedigi):** Gercek hesap/ACL/servis OLUSTURMADAN, hesap+LSA haklari
adimlari MOCK (yalniz sira/log dogrulamasi) birakildi; depolama koku
ACL'i, uygulama dizini ACL'i, log dizini olusturma+ACL'i, WinSW ikili
"kopyalama", WinSW XML render+kimlik enjeksiyonu ise GERCEK fonksiyonlarla
(`Set-LeastPrivilegeAcl`, `New-RenderedWinSwConfig`,
`Set-WinSwServiceAccountIdentity`) SCRATCH klasorlerde/gercek commit'li
sablona karsi calistirildi. Yedi adim BASARIYLA tamamlandiktan SONRA
"WinSW install basarisiz" KASITLI olarak `throw` ile enjekte edildi.
`Invoke-Rollback` TUM yedi adimi TAM TERS SIRAYLA geri aldi (do/undo
log'u kanitladi); GERCEK dogrulama: WinSW ikili/XML dosyalari silindi,
log dizini kaldirildi, depolama VE uygulama dizini ACL'leri (miras/
`IsProtected` durumu DAHIL) BIREBIR orijinaline dondu, `$undoStack`
bosaldi.

**Test sirasinda GORULEN ama SCRIPT KUSURU OLMAYAN bir arac-katmani
garipligi:** Test komutlarinda `'C:\Program Files\nodejs\node.exe'`
(bosluklu, GERCEK bir yol AMA test icin sadece PLACEHOLDER string
olarak kullaniliyordu) GECTIGINDE, PowerShell arac cagrisi katmaninda
"Remove-Item on system path 'C:\Program' is blocked" hatasi ALINDI - bu,
GERCEK script kodunda degil, bu oturumun kendi arac-cagirma katmaninin
bosluklu yol string'lerini nasil ilettigiyle ilgili bir ARTEFAKT olarak
teshis edildi (bosluksuz bir test yolu kullanilinca kayboldu; script'in
KENDI `New-RenderedWinSwConfig`/ACL fonksiyonlari bosluklu GERCEK
yollarla daha once BASKA testlerde zaten basariyla calistirilmisti).
Kayda gecirildi ama script'te HICBIR degisiklik gerektirmedi.

Kanit (bu makinede, GERCEK hesap/ACL/servis/veri OLMADAN):
- `Parser::ParseFile`: 0 hata (her duzeltmeden sonra tekrar dogrulandi).
- SCM P/Invoke plumbing'i GERCEK bir servise (`Spooler`) karsi SALT-OKUNUR
  erisimle (`SERVICE_QUERY_STATUS`, `SERVICE_CHANGE_CONFIG` DEGIL) test
  edildi: `OpenSCManagerW`/`OpenServiceW` GECERLI handle'lar dondu,
  `CloseServiceHandle` ikisini de basariyla kapatti.
- Negatif test: ayni salt-okunur handle `ChangeServiceConfigW`'a
  gecirildi - Windows'un KENDISI `ACCESS_DENIED` (Win32 kod 5) ile
  REDDETTI (crash/access violation DEGIL - bu, P/Invoke imzasinin
  struct/parametre duzeninin DOGRU oldugunun kanitidir); `Spooler`
  HICBIR sekilde degismedi (calisir durumda kaldigi ayrica dogrulandi).
- Parola marshaling round-trip'i izole dogrulandi: bilinen bir metin
  SecureString'e alinip `SecureStringToGlobalAllocUnicode` ile
  cozulup `PtrToStringUni` ile GERI OKUNDU (birebir eslesti),
  `ZeroFreeGlobalAllocUnicode` hatasiz cagrildi.
- Tam zincir failure-injection testi: 7 adim ileri (hesap/haklar mock,
  ACL x3 + WinSW kopyalama + XML render GERCEK), 1 enjekte hata, 7 adim
  ters-sirali geri alma - TUMU basarili, GERCEK dosya/ACL durumu
  birebir orijinaline dondugu dogrulandi.
- `npm run check:deploy` gecti (WinSW XML sablonlari ETKILENMEDI);
  `npm audit --audit-level=moderate`: 0 acik. Yalniz `.ps1`/`.md`
  degistigi icin typecheck/lint/test/build GEREKMEDI.
- Islem sonunda: gercek hesap YOK, hedef klasor YOK, `hasarbotu-file-agent`
  servisi YOK, `Spooler` etkilenmedi (hepsi dogrulandi).

**Bilerek TEST EDILMEYEN (kullanicinin acik talimatiyla - "henuz apply
calistirma"):** Gercek `SERVICE_CHANGE_CONFIG` hakli bir handle'la
GERCEK bir servise karsi `ChangeServiceConfigW`'in BASARILI cagrisi
(yani GERCEKTEN bir servisin oturum acma kimlik bilgisini degistirmek)
hicbir servise karsi (yeni VEYA mevcut) denenmedi - bu, D6'nin gercek
yurutulmesinde, gercek `hasarbotu-file-agent` servisine karsi ampirik
olarak kanitlanmalidir.

Etki: Yalniz `deploy/windows-service/setup-file-agent-service-account.ps1`
ve `docs/RUNBOOK_FAZ_A_WINDOWS_SERVICE_DEPLOYMENT.md` (§2c + §7/Acik
kalan guncellendi) degisti. `install-services.ps1`, WinSW sablonlari,
uygulama kodu, migration, API/contracts, gercek hesap/ACL/servis/veri/
ortam degiskeni DEGISMEDI.

Acik kalan: D6'nin gercek yurutulmesi (kullanici onayiyla) `ChangeServiceConfigW`'in
GERCEK bir servise karsi basarili cagrisini ve tam uctan uca akisi
ampirik olarak kanitlamalidir.
