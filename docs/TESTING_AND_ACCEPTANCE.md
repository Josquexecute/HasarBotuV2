# HasarBotu V2 — Test ve Kabul Kriterleri

## Genel

### Paket 18 — Referans veriler ve Case çekirdeği kabulü

- Dört referans GET ucu oturum ister, session organization'ı dışına çıkmaz ve yalnız aktif kayıt döndürür; eksper yalnız gerçek `expert` rolündeki aktif kullanıcıdır.
- `expertUserId`, `lossDate`, `notificationDate` create/update/read sözleşmelerinde ve audit güvenli özetinde bulunur. Tarihler LocalDate'tir; ihbar tarihi hasar tarihinden önce olamaz.
- Pasif/tenant-dışı/role uygun olmayan referans alan bazlı reddedilir. Mevcut pasif ilişki okunabilir; yeniden atanamaz. Optimistic locking ve idempotency regresyona uğramaz.
- API UI formları gerçek katalogları gösterir; yükleme, 401 ve ağ/5xx halinde mock seçenek üretmez. Mock prototip değişmez.
- Gerçek PostgreSQL'de 0010 up/repeat/down-up, mevcut kayıt korunumu ve constraint; gerçek API'de tenant/active/role/create/update/read/audit; tarayıcıda create/edit ve 1366×768/1920×1080 açık-koyu doğrulanmalıdır.
- Paket 18 tarayıcı kanıtı: kurulu Chrome ile gerçek API login→aktif referanslar→Trafik create→zengin alanları server/detayda okuma→ikinci gerçek eksper ve LocalDate update→stale 409/reload; pasif/tenant-dışı reddi ve API kesintisinde no-fallback geçti. 1366×768 açık/koyu ile 1920×1080 koyuda body overflow yok, form scrollbar politikası korundu ve console warning/error/exception 0 kaldı.

### Paket 17 — Yeni İhbar ve temel dosya düzenleme UI kabulü

- API modunda Trafik/Kasko oluşturma gerçek POST ucunu kullanır; plaka kanonik, ofis numarası server kaynaklıdır. Aynı payload retry'sı aynı Idempotency-Key'i kullanır ve çift submit tek komuttur.
- Başarı yeni caseId detayına yönlenir ve server ofis no/caseId sonucu görünür. Validation/unknown-reference alan bazlı; 401/404/409/5xx/ağ hataları güvenli ve mock fallback olmadan gösterilir.
- Düzenleme yalnız Case update contract alanlarını ve `expectedVersion`'ı gönderir; yeni version saklanır. Stale version 409'da yeniden yükleme sunulur; plaka/tür/ofis no/lifecycle değiştirilemez, close/reopen yoktur.
- Referans endpoint'i olmayan kataloglar sahte kayıtla doldurulmaz. Contract dışı eksper, hasar tarihi ve ihbar tarihi disabled görünür ve payload'a yazılmaz.
- Gerçek PostgreSQL/API testinde Traffic/Kasko create, idempotent replay, update/stale/reload, tenant reddi ve merkezi audit doğrulanır; audit'te teknik/secret sızıntısı yoktur.
- Canlı Vite/browser akışı login→create→edit→conflict→reload→edit→logout; ağ kesintisinde mock fallback yok; 1366×768 ve 1920×1080 açık/koyu taşma kontrolü geçmelidir.

### Paket 15 — koşullu evrak motoru kabulü

- `ready` yalnız doğrulanmış File Agent metadata'sı ile mevcut sayılır; pending/failed kontrol gerektirir.
- Zabıt/KTT/Beyan alternatif grubu, Tramer koşulu ve rüculu Kasko belirsizliği deterministik domain testleriyle doğrulanır.
- API oturum zorunluluğu, tenant 404'ü ve yanıtta/audit'te mutlak yol veya belge içeriği bulunmaması gerçek PostgreSQL + canlı HTTP testinde doğrulandı.
- Salt-okunur GET değerlendirmesinin `document_rule_evaluations` snapshot'ı veya audit olayı yazmadığı DB sayaçlarıyla doğrulandı.

### Paket 16 — Evrak ve Fotoğraf gerçek API kabulü

- Mock moddaki mevcut checklist ve 12/108 fotoğraf stres görünümü baseline testleriyle aynen korunur.
- API modunda requirements, belge sürümleri ve fotoğraf metadata'sı DataPort üzerinden okunur; gerçek boş, yükleniyor, 401, tenant 404 ve ağ hatası ayrı gösterilir, mock fallback yoktur.
- Trafik/Kasko/Olay/Rüculu Kasko grupları; present/missing/control_required/not_applicable; alternatif grup gerekçesi ve kural sürümü görünürdür.
- pending/failed/missing fiziksel durumları ayrı; ready yalnız hash+boyut+verifiedAt kanıtıyla fiziksel doğrulanmış gösterilir.
- Dosya adı, sürüm, MIME, boyut ve güvenli göreli konum görünür; mutlak yol, belge içeriği, hash veya secret görünmez.
- Gerçek PostgreSQL + çalışan API + Vite proxy tarayıcı akışında login, Trafik, rüculu Kasko, rücu belirsizliği, tenant 404 ve logout sonrası 401 doğrulanır. GET sonrası snapshot/evaluation-audit sayaçları değişmez.
- UI etkisi 1366×768 açık/koyu ve 1920×1080 koyu tema; iç scrollbar ve yatay metadata tablosu ile görsel olarak kontrol edilir.

### Paket 19 — güvenli Case çalışma klasörü kabulü

- Plan/preview çağrısı gerçek PostgreSQL’de rezervasyon ve güvenli özet üretir; sentetik filesystem’de hiçbir dizin oluşturmaz. Onaysız plan için provisioning job bulunmaz.
- Onay zorunlu `Idempotency-Key` taşır; replay ve eşzamanlı iki onay tek aktif işe ve tek fiziksel klasör yapısına dönüşür.
- File Agent yalnız sentetik geçici root’ta ana klasör + beş sabit alt klasörü oluşturur; mevcut/kısmi yapı idempotent tamamlanır, kısmi hatada silme yoktur ve retry eksikleri tamamlar.
- Traversal, drive, UNC, symlink/junction/reparse point; tenant dışı erişim; stale location; 401/404/409; mutlak yol/secret/ham hata sızıntısı negatif testleri geçmelidir.
- `ready` yalnız Agent fiziksel doğrulamasından sonra; verified case location + history + provisioning/job/audit aynı transaction’da oluşmalıdır.
- Gerçek tarayıcı smoke’unda API login → preview → açık onay → applying/verifying → ready; ağ hatasında no-fallback; 1366×768 açık/koyu ve 1920×1080 tema/overflow/console kontrolleri yapılmalıdır.

### Paket 20 — güvenli File Agent move/rename altyapısı kabulü

- Plan gerçek PostgreSQL'de operation kimliği ve case-insensitive hedef rezervasyonu üretir; sentetik filesystem'e yazmaz. Onay yoksa job yoktur; plan/approve replay'i ikinci operation/job üretmez.
- Yalnız doğrulanmış mevcut Case location, güncel `expectedLocationVersion`, aktif tenant root ve güvenli göreli hedef kabul edilir. Aynı vaka ikinci aktif operation, aynı hedef ikinci case, mevcut hedef/merge, traversal/drive/UNC/backslash/Windows aygıt adı ve root hedefi reddedilir.
- Same-volume gerçek geçici dizinde atomik rename ve case-only iki aşamalı Windows rename doğrulanır. Agent/sonuç bildirimi kesintisinde mevcut doğru hedef recovery ile DB finalize edilir; eski location/version sonucu yeni konumu ezmez.
- `EXDEV` enjekte edilebilir filesystem adapter ile ve farklı gerçek geçici root'larla staged-copy doğrulanır. Her dosya streaming SHA-256/size manifestine katılır; staging/target manifest eşitliği olmadan location switch veya source cleanup yoktur.
- Location switch + history + operation/job + audit aynı transaction'dadır. Cross-root başarıdan sonra kaynak korunarak `cleanup_pending`; ayrı cleanup işi hedef ve kaynak manifestlerini yeniden doğruladıktan sonra `ready/completed` üretir. Cleanup retry güvenlidir; kaynak değişimi veya kısmi/çelişkili durum `manual_recovery_required` olur.
- Agent lease/ownership/organization ve operation/job version kontrolleri uygulanır. 401/404/409, tenant izolasyonu, cancel'ın yalnız uygulanmamış aşamada olması ve mutlak root/secret/ham OS hatası sızıntısının olmaması test edilir.
- File Agent birim testleri sentetik temp dizin ve fault-injection; API entegrasyonu gerçek PostgreSQL + sentetik filesystem; canlı smoke çalışan HTTP server + Agent ile yapılır. Gerçek müşteri verisi, gerçek `P:\` ve üretim migration kullanılmaz. Kritik DB/File Agent testi skip kalırsa paket PASS değildir.

Bir görev ancak:

- Kod derleniyorsa
- Type check geçiyorsa
- İlgili testler geçiyorsa
- Ana kullanıcı akışı çalışıyorsa
- Hata ve sınırlar raporlandıysa

tamamlandı sayılır.

## UI prototip kabulü

- Sol menü gerçek sayfa değiştirir
- Tema anahtarı çalışır
- Yoğunluk anahtarı çalışır
- Dosya seçimi sağ paneli günceller
- Çift tık tam dosyayı açar
- Dosya sekmeleri içerik değiştirir
- Kritik modal açılır/kapanır
- Filtre ve arama mock veride çalışır
- 1366×768 kırılmaz
- 1920×1080 alanı verimli kullanır
- Scrollbar görünür
- Açık ve koyu tema tutarlıdır
- Türkçe olmayan etiket kalmaz

## Domain regresyon test seti

Planlanan anonim örnekler:

- 10 Trafik
- 10 Kasko
- 5 PERT
- 5 Değer Kaybı
- 5 Kapanma Ücreti
- 5 İşçilik Excel'i
- Anonim Kasko poliçe senaryoları (aşağıdaki 12 zorunlu senaryo)

Zorunlu anonim Kasko senaryo testleri:

1. Genel alan muafiyetsizken özel klozun koşullu muafiyet doğurması
2. Poliçeye uygun servis değişikliğinde durdurmanın (engelin) kalkması
3. Serviste kalındığında poliçe kaynaklı maliyet paylaşımının uygulanması
4. Genel ve koşullu muafiyetlerin birlikte değerlendirilmesi
5. Mini onarım mevcutken mobil onarımın durdurulmuş olması (iki kavramın ayrı modellenmesi)
6. Trafik değer kaybının zorunlu, Kasko değer kaybının ofis kuralı olması
7. Pert Kasko dosyasında değer kaybının "Uygulanamaz" olması (gerekçeli)
8. İhbar fişi, poliçe ve zeyil çelişkisinin gösterilmesi (sessiz çözüm yok)
9. KDV hariç iskontosuz liste bedeli ile gerçek satın alma bedelinin ayrılması
10. AI kaynak bulamadığında kesin karar vermemesi ("açık ve doğrulanabilir hüküm bulunamadı")
11. AI bütçesi dolduğunda temel uygulamanın çalışmaya devam etmesi
12. Yedek var görünürken geri yükleme doğrulamasının başarısız olması (yedek kanıtı ≠ dosya varlığı)

Gerçek müşteri poliçesi veya gerçek poliçe PDF'i fixture olamaz.

## Kritik yayın engelleyiciler

- Yanlış vakaya veri yazma
- Yanlış plakaya Excel yazma
- Klasör kaybı
- Kapanma ücretini yanlış kesinleştirme
- Değer Kaybı kural sürümü karışıklığı
- Muafiyetli dosyada tedarik veya mobil onarım engelinin atlanması
- Poliçe çelişkisinin kullanıcıya gösterilmeden sessizce çözülmesi
- Audit kaybı
- Yetkisiz erişim
- Yedekten dönememe
- Kritik butonun tek tıkla geri alınamaz işlem yapması

## Test raporu

Her geliştirme paketinde:

- Çalıştırılan komut
- Sonuç
- Başarısız test
- Manuel doğrulama
- Ekran boyutu
- Bilinen risk

raporlanır.

### Paket 21 — case close/reopen kabulü

- Domain/contracts: open/closed-stage tutarlılığı, Türkçe kapalı ay yolu, kapanış gereksinim sürümü, ready/pending/failed semantiği, normal/eksiklerle close ve reopen stage doğrulaması.
- Gerçek PostgreSQL: migration 0013 ileri/tekrar/rollback-yeniden-ileri; lifecycle-stage constraint, idempotency, tek aktif operation, destination reservation ve append-only history.
- Gerçek API + sentetik filesystem + Agent: plan değişiklik yapmaz, onaysız job yok, close/reopen verified move sonrası atomik finalize, aynı case/ofis no, idempotent replay, stale/manual recovery, cleanup_pending, tenant 404, role 403, 401 ve sızıntı kontrolü.
- Gerçek tarayıcı: close preview→approve→closed ve reopen→approve→open; eksiklerle close gerekçesi; conflict reload; API modunda mock fallback olmaması; açık/koyu tema, 1366×768 ve 1920×1080 overflow/console kontrolü.
- Gerçek `P:\` ve müşteri verisi kullanılmaz; production migration çalıştırılmaz. Kritik DB/API/Agent/tarayıcı senaryosu skip ise paket PASS sayılmaz.
- Paket 21 uygulama sonucu: ana çalışma ağacı ve repository dışı fresh `npm ci` kopyasında 758 test geçti; 6 skip yalnız mevcut UI ortam-koşullu testleridir. Gerçek PostgreSQL migration/API/Agent testleri ve gerçek tarayıcı close/reopen smoke skip edilmedi.

### Paket 22 — servis profili ve sigortacı anlaşması kabulü

- Domain: aynı servis farklı sigortacı/tarih/işlemde deterministik sonuç verir; yetkili profil anlaşma sonucundan ayrıdır; kayıtsız veya insan onaysız ilişki `control_required` olur.
- Gerçek PostgreSQL: migration 0014 ileri/tekrar/rollback-yeniden-ileri; eski profil backfill'i; sessiz agreement seed'i olmaması; tenant FK, tarih aralığı, desteklenen işlem, human approval ve version kısıtları.
- Gerçek API: aktif/tenant referansları; sigortacı+LocalDate query; Case read/create/update servis profili; inactive/tenant dışı red; optimistic locking; güvenli merkezi audit; response/audit sızıntı kontrolü.
- Paket 21 regresyonu: authorized ve insurer-agreed özel servis kapanış evrakını uygular; authorized servis `agreed` diye etiketlenmez; bilinmeyen özel servis koşullu evrakı `control_required` yapar.
- Gerçek tarayıcı: create/edit formlarında Türkçe servis türü ve seçili sigortacı anlaşma sonucu; tarih/sigortacı değişiminde gerçek API yenilemesi; API hatasında mock fallback yok; 1366×768/1920×1080 açık-koyu ve overflow/console kontrolü.
- Üretim migration, gerçek `P:\`, servis yönetim CRUD'u, poliçe AI analizi ve muafiyet hesabı çalıştırılmaz. Kritik PostgreSQL/API/tarayıcı senaryosu skip ise paket PASS sayılmaz.

### Paket 23 — kanıtlı Kasko poliçe analiz kabulü

- Domain/contracts: kaynak validator, 12 scenario türü, determinism, precedence conflict, genel muafiyetsiz+koşullu muafiyet, çoklu deductible, fail-closed tavsiye, strict Zod/JSON Schema eşliği.
- Gerçek PostgreSQL: 0015 ileri/tekrar/rollback-reapply; Kasko+ready source, tenant bileşik FK, tek aktif approved, version geçmişi, approved/superseded immutability, append-only evidence/evaluation ve conflict approval blokajı.
- Gerçek API: login, sentetik import, idempotent replay, pre-approval control, conflict resolve, approve, scenario/source page-clause, stale 409, tenant 404, role 403, 401 ve audit/snapshot leak taraması.
- Gerçek tarayıcı: Kasko vaka, analiz sürümü/onay/kaynak sayfa-madde/conflict/senaryo; API kesintisinde no-fallback; 1366×768 ve 1920×1080 açık/koyu overflow ile console warning/error kontrolü.
- Gerçek müşteri verisi, PDF/OCR/AI, üretim migration ve gerçek `P:\` yoktur. Kritik PostgreSQL/API/domain/tarayıcı senaryosu skip ise Paket 23 PASS sayılmaz.

### Paket 24 — güvenli Kasko PDF metin çıkarım kabulü

- Domain/contracts: SHA-256 bilinen vektör, NFC/whitespace determinism, Unicode code point exact offset, segment/status/output hash ve strict Zod/52 golden JSON Schema eşliği.
- Gerçek sentetik PDF/File Agent: text, image-only, mixed, encrypted, malformed/non-PDF, changed hash/size, source/page/output limit, timeout/temp cleanup ve junction/reparse reddi; aynı input aynı output hash.
- Gerçek PostgreSQL: 0016 up/repeat/down/reapply; tenant/document/version FK, exact engine, identity, append-only page/segment, terminal immutability ve locator guard.
- Gerçek API: login, Kasko source/idempotent create, claim/heartbeat/chunk/finalize, pages/segments/source-reference, Paket 23 analysis locator, Traffic/tenant/RBAC/401 ve response/audit leak taraması.
- Gerçek tarayıcı: Kasko vaka Evrak ve Fotoğraf sekmesi, extraction status/parser/rule/page/segment/source locator; OCR/partial/failed/no-fallback; 1366×768 ve 1920×1080 açık/koyu overflow ve console kontrolü.
- Gerçek müşteri PDF’i, OCR/AI, üretim migration ve gerçek `P:\` kullanılmaz. Kritik DB/API/File Agent/PDF/tarayıcı senaryosu skip ise Paket 24 PASS sayılmaz.

### Paket 25 — yerel poliçe OCR kabulü

- Domain/contracts: raw/normalize determinism, Unicode code-point offset, geometry/reading order, çok sütun ambiguity, çok sinyalli quality, PDF/OCR duplicate/conflict ve 60 golden JSON Schema eşliği.
- Gerçek sentetik OCR/File Agent: tur, eng, tur+eng; rotated, düşük kontrast, iki sütun; local asset hash+size; yalnız seçili sayfa; render/output limit; source stale; traversal/reparse; timeout/crash/temp cleanup. Runtime URL/model download yolu fail-closed olmalıdır.
- Gerçek PostgreSQL 0017: up/repeat/down/reapply; exact identity; tenant/extraction/page FK; status/hash/confidence/count; page-bound box/range; immutable evidence/terminal run ve OCR source locator.
- Gerçek API: login, Kasko image-only, request/idempotent replay, Agent claim/heartbeat/chunk/finalize, page/element/source locator, Paket 23 analysis locator, Traffic/tenant/RBAC/401/stale ve audit/leak kontrolü.
- Gerçek tarayıcı: Kasko OCR-required sayfa; trigger/progress/ready-low confidence; raw/normalized OCR; Paket 24 karşılaştırma; element/locator; source reference; no-fallback; 1366×768 açık+koyu ve 1920×1080 koyu; overflow/console/focus.
- Gerçek müşteri belgesi, gerçek `P:\`, cloud/AI, üretim migration ve sonraki paket yoktur. Kritik PostgreSQL/API/File Agent/OCR/tarayıcı senaryosu skip ise Paket 25 PASS sayılmaz.
- Paket 25 uygulama sonucu: ana çalışma ağacı ve repository dışı fresh `npm ci` kopyasında 907 test geçti; 6 skip yalnız mevcut ortam-koşullu UI testleridir. Gerçek PostgreSQL migration/API, gerçek yerel OCR/File Agent ve gerçek tarayıcı senaryoları skip edilmedi; audit 0 açık ve tarayıcı console warning/error 0'dır.

### Paket 26 — AI orchestration kabulü

- Gerçek `_test` PostgreSQL’de migration 0018 up/repeat/down/reapply; tenant, exact identity, idempotency, immutable bundle/candidate, zorunlu source link, integer budget ve append-only usage test edilir.
- Beş deterministik provider; success, strict-schema failure, timeout, safe failure ve injection anchor attempt senaryolarını network/SDK olmadan çalıştırır.
- API smoke; login, Kasko/Traffic ayrımı, PDF+OCR bundle/hash, provider disabled, budget hard stop, start/replay, stale, evidence/conflict, tenant 404, rol 403, 401 ve audit/sızıntı kontrolünü kapsar.
- UI/browser; provider/bütçe planı, açık start onayı, source kalite/excerpt, candidate/conflict/control, no-fallback, 1366×768 açık-koyu ve 1920×1080 koyu tema, overflow ve console kontrolünü geçmelidir.
- Kritik PostgreSQL/API/provider/browser testi skip kalırsa Paket 26 PASS sayılmaz. Gerçek müşteri verisi, cloud provider, File Agent, gerçek `P:\` veya üretim migration kullanılmaz.

### Paket 27 — AI adayı insan incelemesi ve promotion kabulü

- Domain/contracts: dört review eylemi, aynı anchor’da edited evidence, deterministic review-set hash/readiness, strict Zod/JSON Schema eşliği ve stale version.
- Gerçek PostgreSQL 0019: up/repeat/down/reapply; sequential append-only review, accepted provider-fact eşitliği, tenant/source-anchor bütünlüğü, promotion provenance ve approved fact immutability.
- Gerçek API: accept/edit/reject/control, gerekçe ve evidence redleri; bütün adaylar incelenmeden promotion blokajı; idempotent promotion; yeni Paket 23 pending draft/control/conflict sürümü; source/conflict korunması; tenant/RBAC/401/409 ve güvenli audit.
- Gerçek tarayıcı: candidate kararları, düzenleme/gerekçe modalı, promotion preview/onay/sonuç, Paket 23 taslak fact ve kaynak sayfa/madde; no-fallback; 1366×768 açık-koyu ve 1920×1080 koyu overflow/console kontrolü.
- Gerçek müşteri verisi, cloud provider, File Agent, gerçek `P:\`, üretim migration veya otomatik Paket 23 approval yoktur. Kritik PostgreSQL/API/browser testi skip kalırsa Paket 27 PASS sayılmaz.
- Paket 27 uygulama sonucu: ana ağaç ve repository dışı fresh `npm ci` kopyasında 965 test geçti; 6 skip yalnız mevcut ortam-koşullu UI testleridir. Gerçek PostgreSQL migration/API, append-only review/promotion, kaynak/çatışma koruması ve gerçek tarayıcı akışı skip edilmedi; moderate audit 0 açık, başarılı tarayıcı akışında console warning/error 0'dı.

### Paket 28 — gerçek provider güvenlik pilotu kabulü

- Domain/config/adapter: deterministik PII redaction/hash; eksik config ve secret sızıntısı; strict Responses schema, tools kapalı, `store:false`, bounded response, timeout/safe error ve integer token cost.
- Gerçek PostgreSQL 0020: up/repeat/down/reapply; provider allow-list, immutable privacy facts, token/pricing constraints, append-only usage, tenant ve Paket 27→23 provenance.
- Gerçek API + sentetik local provider wire: provider-disabled, budget hard stop, redacted payload, secret yokluğu, strict candidate, server-side evidence, idempotent replay, review, promotion, audit/log sızıntı kontrolü.
- Tarayıcı: external provider privacy/bütçe önizlemesi, açık start onayı, aday/review/promotion görünümü, no-fallback; 1366×768 açık-koyu ve 1920×1080 koyu overflow/console kontrolü.
- Yetkili `OPENAI_API_KEY` ve onaylı retention ayarı olmadan gerçek ücretli dış ağ pilotu çalıştırılmaz ve PASS diye raporlanmaz. Kritik PostgreSQL/API/UI testi skip kalırsa Paket 28 tamamlanmış sayılmaz.
- Paket 28 uygulama sonucu: ana ağaç ve repository dışı fresh `npm ci` kopyasında **975 test geçti; 6 skip yalnız mevcut ortam-koşullu UI testleridir**. Gerçek PostgreSQL 0020 up/repeat/down/reapply, provider wire/API, strict-output/evidence, budget/redaction, append-only review→promotion ve tarayıcı senaryoları skip edilmedi; moderate audit 0 açık ve tarayıcı console warning/error 0'dı. Gerçek ücretli OpenAI çağrısı secret bulunmadığı için kapsamlı biçimde çalıştırılmadı ve PASS olarak sayılmadı.

### Paket 29 — gerçek Gemini ücretsiz-katman sentetik pilot kabulü

- Gerçek PostgreSQL 0021 up/repeat/down/reapply; tenant/run/actor FK, tek request/receipt, terminal immutability, bounded metadata ve secret/path/text kolon yokluğu doğrulanır.
- Provider çağrısı sırasında durable receipt başka bağlantıdan görünür olmalıdır; böylece dış çağrının açık DB transaction içinde olmadığı kanıtlanır.
- Provider cevabından sonra candidate finalize hata enjeksiyonu `response_recorded` bırakmalı; aynı idempotency replay tek provider çağrısıyla candidate/usage/final receipt üretmelidir.
- Network/timeout sonucu belirsiz external çağrı `AI_PROVIDER_OUTCOME_UNKNOWN` üretmeli, ikinci dispatch yapmamalı ve tahmini maliyeti hard-stop hesabında tutmalıdır.
- HTTP 503 iki bounded backoff ile toplam üç kez denenmelidir. Tükenme `AI_PROVIDER_UNAVAILABLE` ve finalized receipt üretmeli; idempotent replay yeni dispatch yapmamalıdır. Sentetik pilotta bundan sonra yalnız bir kez `gemini-2.5-flash` fallback yapılmalı; auth/kota/request/schema/evidence hatası fallback üretmemelidir.
- Küçük sentetik poliçe seti strict output, alan recall/precision, exact source-anchor, originalValue evidence, integer token maliyeti, official egress ve PII minimizasyonunu ölçmelidir.
- Canlı komut açık opt-in, birincil stable `gemini-3.5-flash`, 503-only stable ücretsiz `gemini-2.5-flash` fallback, process secret ve ücretsiz-katman retention açıklaması onayı yoksa çağrıdan önce non-zero çıkmalıdır. Kullanılan model/deneme sayıları, endpoint/header, no-tools/no-cache, PII redaction ve sıfır minor maliyet doğrulanmalıdır.
- Payload testi hem 3.5 hem 2.5 fallback için yalnız `responseMimeType/responseJsonSchema` gönderildiğini; `responseFormat` ve `responseSchema` bulunmadığını kanıtlamalıdır. Sentetik 4xx fixture yalnız kanonik HTTP/status ile sabit neden/izinli alan sınıflarını görünür kılmalı; message/description/ham body ve kullanıcıdan türetilen serbest token sızmamalıdır.
- Başarılı canlı yol yalnız üretim `provider_wire` probe'u ve ardından extraction çağrısı yapmalıdır. Wire probe 4xx ile reddedilirse extraction yapılmadan minimal nesne, envelope, scalar candidate ve wire aşamalarıyla bounded tanı çalışmalıdır. Timeout sonucu `provider_wire`, `backoff` veya `extraction` güvenli aşama kodunu taşımalı; ham timeout/provider ayrıntısı sızmamalıdır.
- Preflight en az 4096 output token kullanmalı; `MAX_TOKENS` genel invalid değil güvenli finish-reason kodu üretmelidir. REST response parser thought-summary part'ını JSON'a katmamalı, signature metadata taşıyan boş part'ı reddetmemeli ve sıralı text part'larını bounded biçimde birleştirmelidir. Unsupported binary/function part fail-closed kalmalıdır.
- Provider schema regresyonu `anyOf`, recursive object, schema-valued `additionalProperties`, enum ve provider-side bounds bulunmadığını; `normalizedValueJson` stringinin primitive/object canonical değere dönüştüğünü ve bozuk JSON'un `provider_response_invalid` ile fail-closed kaldığını doğrulamalıdır. Enum/uzunluk/adet/sayı sınırları ile gerçek kanıt kontrolleri server-side runtime contract'ta korunmalıdır.
- Gemini request testi sade wire şemaya rağmen trusted system instruction içinde exact schema version, candidate limiti, izinli category listesi ve canonical biçim kurallarının bulunduğunu kanıtlamalıdır. Canlı pilot canonical reddi full output, original value, anchor veya Zod mesajı sızdırmadan yalnız allowlist alan yolu ve issue sınıfını göstermelidir.
- Gerçek Gemini çağrısı, kalite/kaynak doğruluğu ve ücretsiz-katman retention/egress kontrolü tamamlanmadan Paket 29 PASS veya commit sayılmaz. Gerçek müşteri verisi kullanılamaz.

### Paket 30 — dosya detayında poliçe analiz akışı kabulü

- UI component/integration: doğrulanmış source listesi yüklenir; kullanıcı en az bir source seçmeden plan başlatamaz; plan gövdesi yalnız seçili source kimliklerini taşır.
- Plan ve start ayrı idempotency kimlikleri kullanır. Dış sağlayıcı için PII/retention/bütçe özeti ve case+bundle’a bağlı açık onay korunur.
- Candidate kanıt dialogu doğru belge/documentVersion, extraction, sayfa, sourceAnchor, bounded excerpt, kalite/warning ve hash bilgisini gösterir; Escape ve açık kapatma eylemi çalışır.
- Accept/edit/reject/control kararları mevcut Paket 27 API’sine gider. Promotion yalnız bütün adaylar incelendiğinde ve en az bir accepted/edited aday olduğunda etkinleşir.
- Promotion sonrası Paket 23 analiz listesi/detayı aynı dosya detayında otomatik yeniden okunur; yeni sürüm, pending insan onayı ve kaynak sayfa/bölüm/madde görünür olur.
- API/PostgreSQL regresyonu mevcut gerçek-DB AI review→promotion→policy-analysis detail zincirini, idempotency/tenant/RBAC/audit ve sızıntı sınırlarını yeniden çalıştırır. Paket 30 yeni migration veya endpoint eklemez.
- Gerçek tarayıcı: login → Kasko dosya → source seçimi → plan/start → candidate kanıtı → review → promotion → aynı ekranda yeni Paket 23 taslağı; API kesintisinde no-fallback; 1366×768 açık/koyu ve 1920×1080 tema, overflow ve console kontrolü.
- Kritik UI/API/PostgreSQL/tarayıcı testi skip kalırsa Paket 30 PASS sayılmaz. Gerçek müşteri belgesi, gerçek `P:\`, üretim migration veya otomatik analiz approval kullanılmaz.

### Paket 31 — Gemini deployment güvenlik kapısı kabulü

- Config testleri; opt-in yokken çekirdek başlangıcı, iki izinli model, key biçimi regex tahmini yapılmaması, trim/boş/4096 üst sınırı, eksik/kısmi config ve secret’sız hata mesajını doğrular.
- Contracts/API; authenticated provider availability, 401, runtime JSON Schema eşliği, configured/unconfigured ayrımı, organization enabled/allow-list, safe reason, no-secret ve salt-okunur sorguda audit sayısının değişmemesini doğrular.
- Gerçek PostgreSQL/API; provider kapalıyken Cases detail’in çalışmasını, organization policy kapalı/açık durumunu ve call-ready bileşimini gerçek `_test` DB üzerinde doğrular.
- UI/tarayıcı; gerçek login, Gemini/OpenAI deployment rozetleri, provider seçimi, core policy-analysis görünümü, no-fallback, 1366×768 açık/koyu ve 1920×1080 tema, overflow ve kararlı sayfada console warning/error kontrolünü geçmelidir.
- Paket 31 gerçek provider çağrısını tekrar etmez; Paket 29 canlı sentetik pilot kanıtı korunur. Secret test/repository/log/audit’e alınmaz. Kritik PostgreSQL/API/UI/tarayıcı testi skip kalırsa PASS sayılmaz.
