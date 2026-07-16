# HasarBotu V2 — Domain Kuralları

## Case çekirdeği referans ve tarih kuralları

- Sorumlu ve eksper ayrı kullanıcı ilişkileridir. Eksper yalnız aynı organization içindeki aktif ve `expert` rolüne sahip gerçek kullanıcı olabilir.
- Sigorta şirketi ve servis yeni atama anında aktif olmalıdır. Pasif mevcut ilişki tarihsel okumada korunur; yeni atama olarak kabul edilmez.
- `lossDate`, `notificationDate` ve `followUpDate` LocalDate'tir; saat/timezone taşımaz. `notificationDate`, `lossDate` değerinden önce olamaz.
- Referans ve tarih güncellemeleri Case `expectedVersion` optimistic locking kuralına tabidir.

## Durum Panosu öncelik kuralları

- Öncelik değerlendirmesi saf, deterministik ve sürümlüdür. Paket 37 sürümü `dashboard-priority/1.1.0` değeridir; değerlendirme tarihi dışarıdan LocalDate olarak verilir.
- Sinyal önceliği: `manual_recovery` → `operation_failed` → `operation_blocked` → `overdue_task` → `overdue_follow_up` → `human_approval` → `missing_documents` → `document_control_required` → `task_due_today` → `follow_up_today` → `unassigned` → `upcoming_task` → `upcoming_follow_up`.
- Yaklaşan takip, değerlendirme tarihinden sonraki yedi takvim günü içindeki takip tarihidir. Tarih bulunmaması yaklaşan/geciken takip üretmez.
- Evrak sinyali Paket 15 değerlendirmesinden gelir. Yalnız fiziksel doğrulamalı `ready` present olabilir; `pending/failed` kontrol gerektirir.
- Aynı girdiler aynı sinyal, birincil gerekçe, skor ve sıralama sonucunu üretmelidir. Eşitlikte takip tarihi, güncelleme zamanı ve caseId deterministik bağlayıcıdır.
- `requiresAction`; recovery/hata/blokaj, geciken/bugün/yaklaşan görev veya takip, insan onayı, eksik/kontrol evrakı veya sorumlu eksikliği varsa true olur. Normal açık vaka sahte uyarı üretmez.

## Trafik dosyası evrakları

### Paket 15 — doğrulanmış metadata ile koşullu evrak değerlendirmesi

- `ready` yalnız File Agent hash, boyut ve zaman doğrulamasıyla mevcut sayılır. `pending` ve `failed` mevcut değildir; `control_required` döner. `missing` eksik döner.
- Zabıt, KTT ve Beyan olay belgesi alternatif grubudur. Zabıt varsa KTT/Beyan ve Tramer `not_applicable`; zabıt yoksa KTT veya Beyandan en az biri gerekir ve Tramer ayrıca zorunludur.
- Rüculu Kasko ek gereksinimleri yalnız `recourse_status=confirmed` iken zorunludur. `unknown` ise otomatik eksik yerine `control_required` döner; AI tahmini kullanılmaz.
- Kural seti kod tabanında sürümlüdür (`2026.07.14.1`); değerlendirme kullanılan sürümü açıkça taşır.

Her zaman zorunlu:

- M Trafik Poliçe
- S Trafik Poliçe
- SBM Ağır Hasar
- M Ruhsat
- S Ruhsat
- M Ehliyet
- S Ehliyet

Olay belgesi:

- Zabıt varsa KTT ve Beyan gerekmez.
- Zabıt yoksa KTT veya Beyandan en az biri zorunludur.

Tramer:

- Zabıt yoksa Tramer Sonucu zorunludur.
- Zabıt varsa Tramer Sonucu zorunlu değildir.

## Kasko dosyası evrakları

Her zaman zorunlu:

- Kasko Poliçe — poliçenin tüm sayfaları ve varsa zeyilleri bulunmalıdır; yalnız özet sayfası yeterli değildir. Poliçe hasar tarihinde geçerli olmalı; sürüm, zeyil ve çelişki kontrolü yapılır.
- SBM Ağır Hasar
- K Ruhsat
- K Ehliyet

Olay belgesi:

- Zabıt varsa KTT ve Beyan gerekmez.
- Zabıt yoksa KTT veya Beyandan en az biri zorunludur.

Rüculu Kasko:

- Karşı Araç Ruhsatı
- Karşı Araç Ehliyeti
- Karşı Araç Trafik Poliçesi
- Tramer Sonucu
- Kusur Oranı
- KTT veya Zabıt

## Kasko türleri

- Dar Kasko
- Standart Kasko
- Genişletilmiş Kasko
- Tam Kasko

Muafiyet yalnız var/yok değildir. Tür, oran, asgari/azami tutar, uygulandığı teminat, açıklama ve kaynak sayfa tutulur.

## Kasko poliçesi analizi

Kasko poliçesi yalnız özet alanlardan ibaret değildir; belgenin tamamı kritik karar kaynağıdır. Poliçe baştan sona işlenir: ürün/tür, araç ve kullanım, bütün teminatlar, limitler, genel muafiyet, koşullu muafiyet ve tenziller, özel şartlar/klozlar, istisnalar, ikame araç hakkı ve süresi, mini/mobil onarım, cam servisi, çekici, servis türü, parça türü, kıymet kazanma/eskime, pert geçmişi hükümleri, rayiç/tazmin yöntemi, istenen belgeler, aksesuar/LPG/elektrikli araç hükümleri, prim borcu/mahsup, zeyiller ve yürürlük.

- "Muafiyetsiz" genel alanı, özel kloz kaynaklı koşullu muafiyet bulunmadığı anlamına gelmez; klozlar ayrıca taranır.
- Kanonik alanlar sigorta şirketinden bağımsızdır; şirketin orijinal alan adı ve madde metni korunur, kanonik alan ↔ kaynak metin bağı izlenebilirdir.
- Her kural olay/koşul/beş durumlu kapsam sonucu (kapsamda, şartlı, kapsam dışı, bilgi yetersiz, kaynaklar çelişkili)/muafiyet-tenzil-maliyet paylaşımı/limit/istisna/belge/servis ve parça şartı/işlem/kaynak/güven/insan onayı yapısıyla modellenir.
- Poliçe, ihbar föyü ve diğer belgeler çelişirse sistem sessizce seçim yapmaz; çelişkiyi gösterir.

Ayrıntı: `CASCO_POLICY_ANALYSIS_PLAN.md`, `CASCO_POLICY_CANONICAL_MODEL.md`, `CASCO_POLICY_SCENARIO_RULES.md`.

## Muafiyetli dosya iş akışı

Muafiyet tespitinde zorunlu ilk adımlar:

1. Tedarik geçici olarak durdurulur.
2. Mobil onarım geçici olarak durdurulur.
3. Dosya sorumlusuna bilgi verilir.
4. Servise bilgi verilir.
5. Kaynak poliçe maddesi, olası oran/tutar ve alternatif aksiyonlar gösterilir.

Aksiyon seçenekleri (tümü insan onaylı):

- Poliçeye uygun servis/yöntem seçilirse muafiyet yeniden değerlendirilir; engel kalkarsa normal süreç devam eder.
- Araç sahibi mevcut serviste kalırsa poliçedeki gerçek muafiyet, tenzil veya maliyet paylaşımı uygulanır; oran sabit kodlanmaz, kaynak kloz ve matrahtan çıkarılır.
- Uygun çözüm kabul edilmezse portal notu, dosya sorumlusunun açık onayı ve gerekçeyle bekletme veya kapatma uygulanır.

Akış bildirim, görev, portal notu, onay ve kapanış adımlarıyla modellenir; hiçbir kritik aksiyon insan onayı olmadan kesinleşmez ve her adım audit üretir. Muafiyetli kapanışta ilgili kloz, portal notu, sorumlu onayı ve uygulanan maliyet paylaşımı ayrıca kaydedilir.

Mini onarım poliçe teminatı/hizmetidir; mobil onarım operasyon yöntemidir. İki kavram aynı alanda modellenmez.

## Parça bedeli ve maliyet paylaşımı

Ortak referans bedel: KDV hariç ve iskonto uygulanmamış liste bedeli. Ayrı tutulan değerler:

- Liste bedeli, KDV oranı/tutarı ve KDV dahil liste bedeli
- İskonto oranı/tutarı ve gerçek satın alma bedeli
- Sigorta şirketi payı ve araç sahibi payı
- Fiyat tarihi, para birimi, tedarikçi/fiyat kaynağı ve kaynak belge
- Kullanılan hesap kuralı ve kullanıcı onayı

Kullanım alanları: değer kaybı, hasar maliyeti, PERT ekonomik analizi, parça listesi, onarım onayı. Her hesapta hangi bedelin kullanıldığı açıkça kaydedilir; referans liste bedeli gerçek ödeme tutarıyla karıştırılmaz.

## Ofis dosya numarası

`YYYY/N` biçimi; firma ve yıl bazında sıralıdır. Ek kurallar:

- Dosya aktifleştirilirken otomatik verilir.
- Aynı numara ikinci kez kullanılamaz.
- İptal edilen numara tekrar dağıtılmaz.
- Yeniden açılan dosya eski numarasını korur.

## Onarım onayı

Kasko:

- KTT varsa zorunlu
- Beyan varsa zorunlu
- Zabıt varsa ve hasar 100.000 TL üzerindeyse zorunlu

Trafik:

- Hasar 100.000 TL üzerindeyse zorunlu

100.000 TL eşiği sabit kodlanmaz; sürümlü kuraldır.

## Notlar ve görevler — Paket 37

- İlk gerçek not türleri `internal` ve `contact`’tır. Not append-only’dir; düzenleme veya fiziksel silme yoktur. Daha ayrıntılı görüşme alt türleri ileride sürümlü genişletilebilir.
- Görev durumları `open`, `completed`, `cancelled`’dır. `overdue`, `today`, `upcoming`, `scheduled` durum değil; `dueDate` ve değerlendirme LocalDate’inden türetilen görünüm sinyalidir.
- Yalnız `open → completed` ve `open → cancelled` geçişi geçerlidir. Tamamlama sonuç notu, iptal gerekçesi zorunludur.
- Atanan kullanıcı varsa aktif ve aynı organization kapsamında olmalıdır. Terminal görev değiştirilmez; yeni iş yeni görev olarak açılır.
- `followUpDate` LocalDate değişiklikleri eski/yeni değer, actor ve case version ile append-only kaydedilir.

## Çalışma takvimi

- Pazartesi–Cuma çalışma günü
- Cumartesi, Pazar ve Türkiye resmî tatilleri tatil
- Tatil gününe görev girildiğinde sonraki iş günü önerilir

## Servis

Alanlar:

- Servis Adı
- Yetkili / Özel
- Telefon

Servis değişiklik geçmişi korunur.

## PERT

Durumlar:

- İnceleme Başlamadı
- Veri Eksik
- İnceleniyor
- Onarım Yönünde
- PERT Adayı
- PERT Kanaati
- Merkez Kararı Bekleniyor
- Onarım Kararı Verildi
- PERT Kararı Verildi

AI önerisi, eksper kanaati ve merkez kararı birbirinden ayrıdır.

## Değer Kaybı

Trafik dosyasında zorunlu; Kasko'da isteğe bağlıdır (mevzuat/ürün kuralı).

Ofis operasyon kuralı (Baran Global): hesaplamaya uygun TÜM Kasko dosyalarında değer kaybı süreci açılır. Pert, çalınma, tam hasar veya hesaplamaya uygun olmayan Kasko dosyasında durum "Uygulanamaz" olur ve gerekçe zorunludur. Mevzuat zorunluluğu ile ofis operasyon kuralı ayrı alanlar olarak modellenir (`valueLossLegalRequirement` / `valueLossOfficePolicy`); ofis kuralı sürümlüdür ve mevzuat alanının anlamını değiştirmez.

Uygunluk durumları (süreç durumlarından ayrı eksen):

- Hesaplamaya Uygun
- Veri Eksik
- Eksper İncelemesi Gerekli
- Değer Kaybı Oluşmaz
- Referans Modülle Hesaplanamaz
- Ağır Hasar Nedeniyle Hesaplanamaz
- Uygulanamaz (gerekçe zorunlu)

Reel piyasa emsal ölçütleri: son 30 günlük ilanlar; en az 3 emsal; marka/model/paket eşleşmesi; ±%10 kilometre uyumu; aykırı ilanların dışlanması; ilan ekran görüntüsü ve numarası; nihai rayici eksper onaylar.

Hazırlanma şartı:

- Parça listesi kesin
- Onarım/boya işlemleri kesin
- Araç bilgileri doğrulanmış

Durumlar:

- Hazır Değil
- Veri Eksik
- Hesaplamaya Hazır
- Taslak Hesap
- Eksper Kontrolünde
- Eksper Onaylı
- Güncelliğini Kaybetti
- Değer Kaybı Oluşmaz

## Kapanış kontrolü

Her dosyada ekspertiz raporu, ön rapor ve onarım görselleri kontrol edilir. Koşullu evraklar: Fatura, Teslim İbra ve Temlik, Taahhütname. Teslim İbra ve Temlik ile Taahhütname, servis yetkiliyse veya ilgili sigorta şirketi ve değerlendirme tarihinde insan onaylı aktif anlaşma varsa zorunludur. Yetkili servis otomatik olarak anlaşmalı servis sayılmaz; anlaşma kaydı belirsiz özel servis sonucu `control_required` olur.

## Kapanma ücreti

Kaynak, sigorta şirketinden indirilen nihai ekspertiz raporudur.

Durumlar:

- Rapor Bulunamadı
- Tutar Bulunamadı
- Birden Fazla Aday
- Kontrol Bekliyor
- Kullanıcı Onaylı
- Kullanıcı Tarafından Düzeltildi

Kesin aylık toplama yalnız kullanıcı onaylı veya kullanıcı tarafından düzeltilmiş kesin tutar girer.

## Case çalışma klasörü

- Yıl ve ay yalnız `notificationDate` LocalDate değerinden alınır: `YYYY/Ay YYYY/PLAKA`.
- Plaka kanonik değerden boşluksuz klasör segmentine çevrilir; ihbar/hasar/poliçe numarası path parçası olamaz.
- Aynı ay ve plakada ilk boş sıra `PLAKA`, `PLAKA - 2`, `PLAKA - 3` olarak seçilir.
- Zorunlu alt klasörler: `EVRAK`, `HASAR`, `OLAY YERİ`, `ONARIM`, `DEĞER KAYBI`.
- Plan/preview fiziksel yazma yapmaz; Agent işi açık kullanıcı onayı olmadan kuyruğa alınamaz.
- Fiziksel doğrulama tamamlanmadan vaka konumu `verified` ve provisioning `ready` olamaz.
- Kısmi başarısızlık mevcut klasörleri sildirmez; retry yalnız eksik dizinleri tamamlar.
- Eski case location snapshot’ına ait sonuç güncel konumu ezmez ve `stale` olur.

## Case close/reopen yaşam döngüsü kuralları

- Lifecycle yalnız `open | closed`; workflow stage ayrı alandır. `closed` lifecycle/stage birlikte, `open` lifecycle ise yalnız açık stage'lerden biriyle bulunabilir.
- Close planı yalnız open case, verified/current workspace location ve çakışmasız aktif işlem durumu için üretilebilir; plan filesystem veya case lifecycle'ını değiştirmez.
- Kapalı hedef `notificationDate` ve mevcut workspace yolundan deterministik olarak `YYYY/Ay YYYY/KAPALI AY YYYY/workspace` biçiminde üretilir. Workspace adı korunur; hedef çakışmasında suffix, overwrite veya merge yoktur.
- Kapanış katmanı sürümü `2026.07.14.2`'dir. Ekspertiz raporu, ön rapor, onarım görselleri; servis varsa fatura; servis profili `authorized` veya `2026.07.14.1` servis uygunluk değerlendirmesi ilgili sigortacı/tarihte `agreed` ise Teslim İbra ve Temlik ile Taahhütname değerlendirilir. Yetkili profil anlaşma bayrağından ayrıdır. Yalnız verified-ready present, pending/failed ve belirsiz servis ilişkisi control_required olur.
- Normal close eksik/control_required gereksinimde blocked olur. Eksiklerle close yalnız zorunlu gerekçe ve server üretimli snapshot ile onaylanabilir.
- Reopen yalnız closed case, zorunlu gerekçe ve izin verilen açık workflow stage ile yapılır; son append-only kapanış kaydındaki önceki açık location hedeflenir.
- Fiziksel hedef doğrulanmadan lifecycle finalize edilmez. Reopen aynı `caseId` ve ofis numarasını korur; kapanış geçmişi silinmez/değiştirilmez.

## Kanıtlı Kasko poliçe senaryo kuralları — Paket 23

- Ana analiz yalnız Kasko case ve aynı tenant/case'e ait `ready + hashVerified + sizeVerified + verifiedAt` poliçe `documentVersion` ile oluşturulur.
- Kaynak: `documentId`, `documentVersionId`, pozitif sayfa, bölüm, madde, en çok 1.000 karakter alıntı, alıntı hash'i, locator, kaynak türü ve 0..1 confidence. Kaynaksız rule kesin sonuç üretemez.
- Approved sürüm immutable; düzeltme yeni sürümdür. Eski sürüm silinmez, gerekirse `superseded` olur. Açık conflict approval'ı ve kesin senaryo sonucunu engeller.
- Öncelik aynı seviyede farklı outcome veriyorsa `control_required`; sessiz winner seçilmez. Muafiyetler kodla tekilleştirilir fakat farklı koşullu muafiyetler kaybolmaz.
- Servis facts'i `serviceType` ile sigortacıya/tarihe özel `agreementStatus` alanlarını ayrı taşır. Muafiyet riski tedarik/mobil onarım için `pause/control_required`; gerçek iş emrini bu paket değiştirmez.
- Tarihler LocalDate, işlem zamanları UTC'dir; clock, analysisVersion ve ruleVersion dışarıdan verilir. Motor DB/HTTP/AI bağımlılığı ve yan etki taşımaz.

## PDF metin kanıtı kuralları — Paket 24

- Kaynak uygunluğu: Kasko case + `casco_policy` + PDF MIME/extension + aynı tenant/case + `ready/hashVerified/sizeVerified/verifiedAt`.
- Raw metin yalnız kontrol karakteri/line-ending güvenliğiyle korunur. Normalize metin `pdf-text-normalization/1.0.0` ile NFC, NBSP ve whitespace kurallarından deterministik üretilir; semantik anlam eklenmez.
- Segment aynı normalize girdide aynı tür, sıra, metin hash’i ve Unicode code point `[start,end)` offsetini üretir. Server Agent’ın gönderdiği segmenti yeniden hesaplar.
- Tamamı text sayfası `ready`; en az bir text ve image-only/empty/failed sayfa `partial`; text sayfası yoksa `ocr_required`. Bu sonuç analiz/onay değildir.
- Paket 23 kanıt alıntısı yalnız doğrulanmış extraction text sayfasındaki en çok 1.000 code point exact range olabilir; segment verilirse range segment içinde kalmalıdır.

## Yerel OCR kanıt kuralları — Paket 25

- Uygun kaynak Kasko `casco_policy`, fiziksel `ready + verifiedAt + hashVerified + sizeVerified`, aynı tenant/case/documentVersion ve terminal olmayan Paket 24 `partial|ocr_required` extraction’dır. Varsayılan aday yalnız `image_only` sayfadır; text-ready sayfa son kullanıcı OCR akışında seçilmez.
- Identity: source hash/size + documentVersion + extraction + seçili sayfalar + language set + engine/language-data + render + preprocessing + normalization + locator sürümü. Aynı identity tekrarında mevcut run döner.
- Render `standard/1.0.0` 300 DPI veya `high_quality/1.0.0` 400 DPI’dır. Preprocess `policy-ocr-preprocessing/1.0.0`: beyaz deterministik zemin, BT.601 grayscale, full-range contrast, Otsu threshold ve bounded rotate/deskew metadata’sı. Kelime düzeltme ve anlamsal tamamlama yoktur.
- Raw OCR yalnız control-character/line-ending güvenliği ve NFC görür. Normalize OCR `policy-ocr-normalization/1.0.0` ile NFC/whitespace üretir. Offset `unicode_code_point`, sıfır tabanlı ve `[start,end)`; box origin sol üst, +x sağa, +y aşağı, integer render pixel’idir.
- Block→line→word parent, ordinal, reading order, range/hash ve box server/DB’de doğrulanır. Negatif, NaN/Infinity, sayfa dışı box veya normalize metinle eşleşmeyen range reddedilir.
- Kalite `high|medium|low|insufficient|control_required`; reading order `reliable|probable|ambiguous|control_required`. Yalnız `high` teknik kaynak adayı insan incelemesizdir; yine de poliçe yorumu/onayı değildir.
- Paket 24 ve OCR katmanı ayrı kalır. Composite sonuç `pdf_text_only|ocr_only|combined_non_overlapping|conflict_detected|control_required`; sessiz concat, duplicate veya conflict winner yoktur.

## AI source bundle ve candidate kuralları — Paket 26

- Bundle şeması `policy-ai-source-bundle/1.0.0`, prompt contract `policy-ai-extraction/1.0.0`, output schema `policy-ai-candidates/1.0.0` sürümündedir.
- Source item sırası anchor kimliğine göre deterministiktir; hash aynı sürüm ve aynı girdide aynıdır. Ready bundle immutable, kaynak değişikliği yeni bundle’dır.
- Poliçe metni güvenilmeyen veridir. Injection benzeri içerik warning’dir; sistem contract’ını değiştiremez.
- Candidate önemli bir alan için en az bir geçerli anchor taşır. `originalValue` ve normalize sayı/LocalDate kaynak metinde bulunamazsa kanıt reddedilir.
- Provider confidence kaynak kalitesini yükseltemez. Düşük veya control-required OCR kaynağı candidate’ı insan kontrolünde tutar.
- Aynı alanın farklı değerleri, farklı muafiyet/limit/servis/parça şartları ve PDF/OCR farkları sessiz çözülmez. Genel muafiyetsiz sonucu koşullu muafiyeti ezmez.
- Bütçe bütün değerleri safe integer minor unit’tir. Disabled/budget blocked fail-closed’tur ve provider çağrısı yoktur.

## AI candidate insan inceleme ve promotion kuralları — Paket 27

- Review şeması `policy-ai-human-review/1.0.0`, promotion şeması `policy-ai-promotion/1.0.0` sürümündedir. Güncel review set hash’i aday kimliği, review sürümü, eylem, değer, koşul/istisna ve anchor kimliklerinden deterministik üretilir.
- `accepted`, provider candidate değerini ve kaynaklarını aynen korur. `edited`, aynı anchor kümesi üzerinde yeni değer/koşul/istisnayı yeniden kanıtlar. `rejected` ve `control_required` gerekçe taşır ve promotion kapsamına girmez.
- Candidate review geçmişi append-only’dir. Optimistic `expectedReviewVersion` eski formun yeni kararı ezmesini engeller.
- Promotion için her candidate’ın güncel kararı bulunmalı, en az bir kabul/düzenleme olmalı, source policy belgesi tekil olmalı ve run/target analysis/review-set sürümleri değişmemiş olmalıdır.
- Promotion yeni Paket 23 sürümünü insan onayı `pending` ile oluşturur. Eksik kontrol kararı varsa `control_required`; taşınan conflict varsa `conflict_detected`; aksi durumda `draft` olur.
- Provider confidence kaynak kalitesini veya insan onayını yükseltmez. Promotion sonrası da Paket 23 immutable approval ve conflict kuralları aynen uygulanır.

## Gerçek provider privacy ve maliyet kuralları — Paket 28

- Dış provider payload’ı `policy-ai-pii-redaction/1.0.0` ile deterministik hazırlanır. Aynı kaynak/sürüm aynı redacted metin ve hash’i üretir; plan sonrası kaynak veya privacy snapshot değişirse start fail-closed olur.
- PII placeholder’ı kanıt metnini uydurmaz. Original/numeric/date evidence kontrolü server’daki gerçek source-anchor metni üzerinde yapılır; provider confidence redaksiyon veya düşük OCR kalitesini yükseltemez.
- Gerçek provider run’ı `externalProvider=true`, retention/pricing sürümü, outbound character/hash ve redaksiyon sayaçları taşır. Bu alanlar provider fact olarak immutable’dır.
- Maliyet yalnız safe integer minor-unit ile ve deploy edilen pricing sürümüyle hesaplanır. Plan çağrısı yapmaz; per-request/monthly hard stop provider’dan önce uygulanır; token çiftinin eksik veya geçersiz gelmesi güvenli provider failure’dır.
- Dış provider adayı da append-only insan review’ı olmadan Paket 23’e promote edilemez; promotion onay değildir.

## Gerçek provider receipt ve pilot kalite kuralları — Paket 29

- Provider çağrısından önce run/request kimliği ve tahmini maliyet durable receipt olarak commit edilir. Provider çağrısı hiçbir PostgreSQL transaction'ını açık tutmaz.
- Strict doğrulanmış canonical response receipt'e yazıldıktan sonra aday/usage finalize kesilirse replay response'u yeniden provider'dan istemez; receipt'ten idempotent finalize eder.
- Çağrı sonucunun bilinmediği network/timeout durumunda otomatik retry yoktur. Run fail-closed `AI_PROVIDER_OUTCOME_UNKNOWN` olur; tahmini maliyet bütçede rezerve kalır.
- Yalnız kesin HTTP 503 cevabı retryable `provider_unavailable` sayılır: 500 ms ve 1500 ms bounded backoff ile model başına en çok üç çağrı yapılır. Tükenme `AI_PROVIDER_UNAVAILABLE` olarak finalized olur; auth/kota/request/schema/evidence hatası retry veya fallback üretmez.
- Pilot kalite sürümü `policy-ai-pilot-quality/1.0.0`'dır. Alan recall/precision, expected exact source-anchor ve originalValue kaynak eşleşmesi 0..10000 integer basis-point ile ölçülür; duplicate actual aday precision hatasıdır.
- Canlı pilot yalnız küçük sentetik kaynaklarla, birincil stable `gemini-3.5-flash` ve bu model 503 ile tükenirse tek stable ücretsiz fallback `gemini-2.5-flash`, official Gemini GenerateContent egress'i, bounded input/output/ortak timeout ve PII-minimized payload ile çalışır. Full prompt/output veya sentetik metin audit/log'a yazılmaz.
- Bütün GenerateContent modelleri `responseMimeType/responseJsonSchema` kullanır; `responseFormat` veya model-bazlı payload ayrımı yoktur. 4xx teşhisinde yalnız bounded kanonik status ile sabit neden/izinli alan kodu görünür; provider mesajı ve açıklaması sızdırılmaz.
- Gemini wire şeması recursive union/object yerine düz `normalizedValueJson` metni ve yalnız temel JSON yapı anahtarlarını kullanır. Adapter JSON'u kanonik değere çevirir; enum, depth, key/list/string/sayı sınırları, unknown alan reddi, source anchor ve evidence kontrolleri mevcut server-side contracts katmanında fail-closed uygulanır.
- Canlı başarılı yol tek üretim wire probe'u kullanır; yalnız wire 4xx reddinde minimal→envelope→scalar→wire tanısı çalışır. Eski constraint grupları normal canlı yolda çalışmaz ve server-side güvenlik kurallarını gevşetmez. Preflight/extraction aynı bounded pilot deadline'ına tabidir fakat tanısal çağrılar başarılı yolun süresini tüketmez.
- Gemini response parser yalnız `STOP` candidate'ın non-thought text part'larını sıralı birleştirir. Thought summary ve opaque thought signature kanonik çıktıya/audit'e taşınmaz. `MAX_TOKENS`, eksik text ve unsupported part kesin aday sayılmaz; güvenli kontrol/failure üretir.
- Provider-private wire şema Gemini uyumluluğu için sade tutulduğunda server-owned canonical sözleşme kaybolmaz: exact output schema version, candidate üst sınırı, izinli category değerleri, candidate/canonical alan biçimi, anchor üyeliği ve confidence sınırı trusted system contract içinde açıkça verilir. Model çıktısı yine strict runtime Zod ve server-side evidence doğrulamasından geçer; prompt bu kontrollerin yerine geçmez.
- Gemini ücretsiz katmanı içerikleri ürün geliştirmede kullanabildiği için `free_tier_product_improvement` ayrı ve görünür retention değeridir. Gerçek müşteri verisi bu pilotta yasaktır; ücretsiz maliyet sonucu veri saklama güvencesi değildir.

## Kullanıcı kontrollü analiz uygulama sınırı — Paket 30

- Kaynak keşfi istemci kolaylığıdır; plan isteğindeki her PDF/OCR source server tarafından tenant, case, ready/verified durum ve sürüm yönünden yeniden doğrulanır.
- Kullanıcının kaynak seçimi yeni bir kanıt üretmez ve source kalitesini yükseltmez. Seçilmemiş source plan bundle’ına girmez; boş kaynak kümesiyle plan oluşturulmaz.
- Provider adayını kabul etmek Paket 23 analizini onaylamak değildir. Yalnız `accepted` ve kanıt sınırındaki `edited` review kayıtları promotion ile pending analiz taslağına uygulanabilir.
- Promotion sonrası görünen Paket 23 sürümü `draft | control_required | conflict_detected` ve `humanApprovalStatus=pending` sınırını korur. Açık conflict veya eksik kaynak sessizce kesin karara dönüşmez.
- Dosya detayı otomatik yenilemesi yalnız başarılı promotion sonucunu okur; ikinci promotion, yeni provider çağrısı veya başka bir veri yazma işlemi üretmez.

## Gemini deployment ve availability kuralları — Paket 31

- Deployment config ile organization provider policy ayrı deterministik gerçeklerdir. `callReady = configured && organizationEnabled && providerAllowed`; bütçe ve açık kullanıcı onayı ayrıca plan/start aşamasında uygulanır.
- Opt-in yoksa Gemini adapter yoktur; bu bir core uygulama hatası değildir. Opt-in true iken secret/model eksik veya geçersizse başlangıç fail-closed olur.
- Secret doğrulaması provider key desenini tahmin etmez. Yalnız trim, boş olmama ve bounded uzunluk uygulanır; gerçek credential geçerliliği provider cevabıyla belirlenir.
- Production composition otomatik provider/model fallback yapmaz. Paket 29 fallback’i sentetik pilot runner’a özgüdür.
- Availability read’i salt okunurdur ve provider çağrısı/audit olayı üretmez. Response yalnız güvenli descriptor ve organization policy/bütçe özetidir; secret veya ham config yoktur.

## Trafik değer kaybı kuralları — 01.07.2026 / Paket 32

- Kural seti `traffic-value-loss-market-difference`, sürüm `2026.07.01.1`, yürürlük `2026-07-01`’dir.
- 01.07.2026 döneminde yürürlükten kaldırılmış Ek-1 katsayı formülü kullanılmaz. Taslak brüt sonuç `max(0, kaza öncesi ikinci el değer - onarım sonrası ikinci el değer)` olarak hesaplanır.
- Kusur oranı 0..10000 baz puandır; para safe integer minor-unit’tir; yuvarlama `half_up_minor_unit` sürümüyle açıkça taşınır.
- Marka/model/varyant/model yılı, kilometre, kullanım şekli, hasarlı parçalar/işlemler, önceki hasar, ağır/tam hasar, kusur ve iki piyasa değeri kanıt bağlantısı taşır.
- Son 30 gün, her değer tarafında en az üç emsal ve hedef kilometrenin ±%10 aralığı sürümlü ofis kanıt yeterliliğidir; mevzuat formülü olarak sunulmaz.
- Eksik veya çelişkili kanıt `control_required` olur. Provider/AI confidence veya kullanıcı beyanı doğrulanmamış belgeyi kanıt yapmaz.
- Ağır/tam hasar `not_applicable`; sıfır/negatif piyasa farkı `no_value_loss` taslağıdır. Her sonuç insan onayı gerektirir.
- Approved/superseded version, evidence, comparable ve approval history append-only/immutable’dır; düzeltme yeni version üretir.

## Trafik değer kaybı kullanıcı kanıtı ve onay kuralları — Paket 33

- UI yeni bir değer kaybı formülü çalıştırmaz; yalnız Paket 32 API’sinin hesaplama ve `canSubmitForApproval` sonucunu gösterir.
- Belge kanıtı yalnız fiziksel doğrulaması tamamlanmış `ready` documentVersion’dan seçilebilir. Kullanıcı bir belgeyi seçtiğinde desteklenen kanıt alanlarını ayrıca işaretlemelidir; otomatik toplu doğrulama yoktur.
- Kullanıcının araç, hasar ve piyasa değerleri girişi `expert_observation` kaynağıdır ve tek başına `verified` olamaz. Doğrulanmış belge veya kontrollü emsal kanıtı eksikliği `control_required` kalır.
- Emsal kaynağı yalnız bounded `https://` veya traversal/drive/backslash içermeyen `ref:` referansıdır. Referans, tutar, kilometre, tarih ve doğrulama bayrağı birlikte sürümlenir.
- Formdaki her hesaplama yeni immutable version oluşturur. Eski version’ı ekranda seçmek yalnız incelemedir; submit/approve/reject daima server’ın güncel assessment version’ına uygulanır.
- Bloklayan belirsizlik varken submit yapılamaz. Submit kullanıcı teyidi; approve insan inceleme teyidi; reject zorunlu gerekçe ister. Rol ve optimistic version kontrolünün nihai otoritesi API’dir.
- API modu mock sonuca düşmez. Kasko vaka Trafik değer kaybı akışına alınmaz.

## Trafik değer kaybı nihai rapor kuralları — Paket 34

- Rapor content builder saf ve deterministiktir; database, HTTP, filesystem veya sistem saati bağımlılığı taşımaz. Aynı onaylı version ve aynı nihai not aynı canonical content’i üretir.
- Yalnız insan onaylı `approved | superseded` version rapor kaynağıdır. Eksik approver/zaman, kopuk emsal-kanıt bağlantısı veya path/UNC içeren içerik fail-closed reddedilir.
- Rapor; onaylı hesaplama gerçeğini yeniden hesaplamaz. Input/evaluation snapshot, evidence, comparables, uncertainties ve rule sources değişmeden rapor modeline taşınır; sıralanabilir listeler deterministik sıralanır.
- Genel output şablonu `traffic-value-loss-final-report-tr/1.0.0`, content şeması `traffic-value-loss-final-report/1.0.0` sürümündedir. Kural sürümü ayrı olarak `2026.07.01.1` kalır.
- Bir onaylı hesap version’ı bir nihai rapor üretir. Rapor düzeltmesi yeni hesap version’ı ve yeni insan onayı gerektirir; eski rapor değiştirilmez veya silinmez.

## Kapanma ücreti kuralları — Paket 39

- İlk rule-set sürümü `closure-fee/1.0.0`'dır. Motor saf, deterministik ve database/HTTP/sistem saati bağımsızdır.
- Kaynak uygunluğu: `lifecycleStatus=closed`, canonical document type `expert_report`, fiziksel durum `ready`, `hashVerified=true`, `sizeVerified=true` ve `verifiedAt` mevcut olmalıdır.
- `pending`, `failed`, `missing`, fiziksel doğrulaması eksik veya farklı document type ücret kaynağı sayılamaz.
- Tutar safe integer minor-unit ve `TRY`'dir. `control_required` adayın `approvedAmountMinor` değeri yoktur.
- Yalnız `approved | corrected` güncel sürüm kesin toplamda kullanılabilir. Düzeltme eski sürümü değiştirmez; zorunlu gerekçeyle yeni sürüm üretir.
- Aynı case için tek ücret aggregate vardır. Komutlar idempotency ve optimistic version ile korunur; aynı onay replay'i ikinci sürüm üretmez.
- Dönem temeli `open_created_closed_finalized`: açık vaka `created_at`, kapalı vaka `closed_at` ile seçilen ayın `[başlangıç, sonraki ay başlangıcı)` aralığında değerlendirilir.

## Trafik değer kaybı kapanış özeti kuralları — Paket 40

- İlk kural sürümü `traffic-value-loss-closure/1.0.0`'dır; saf evaluator database/HTTP/sistem saati kullanmaz.
- Trafik case için yalnız current assessment version `approved`, human approval `approved` ve aynı version’a ait ready immutable final report varsa kapanış sonucu `present` olur.
- Assessment yok, current version onaysız/rejected/control-required, report yok veya report-version/rule uyumsuzsa `control_required` olur.
- Eski superseded assessment/report güncel kapanış gerçeği olarak otomatik seçilmez. Hesap yeniden çalıştırılmaz; saklı result snapshot kullanılır.
- Kasko case Trafik değer kaybı kapanış gereksiniminde `not_applicable` olur.
- `control_required`, normal close’un mevcut eksik gereksinim blocker’ına katılır. Eksiklerle kapatma mevcut zorunlu gerekçe/onay/snapshot akışını kullanır.
- Snapshot assessment/report kimliği, assessment version, result code, minor-unit tutar ve rule version taşır; emsal veya belge içeriği taşımaz.
