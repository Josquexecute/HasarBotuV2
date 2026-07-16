# HasarBotu V2 Audit, Güvenlik ve Yedekleme Planı

## 1. Amaç ve güvenlik sınırı

Bu belge kimlik doğrulama, yetkilendirme, audit, sır yönetimi, yedekleme ve felaket kurtarma gereksinimlerini planlar. Kod, gerçek hesap, parola, sertifika veya yedekleme betiği oluşturmaz.

Temel ilkeler:

- UI güven sınırı değildir; her yetki Merkezi API'de uygulanır.
- PostgreSQL ana iş verisi kaynağıdır.
- Fiziksel dosya içeriği depolama kökünde, meta veri ve göreceli yol PostgreSQL'dedir.
- File Agent kritik dosya yazma/taşıma işlemlerinin tek sahibidir.
- AI, Gmail ve mevzuat kaynakları güvenilmeyen dış girdidir.
- Parola, token, gizli anahtar, tam mutlak yol ve hassas belge içeriği log/audit alanına gelişigüzel yazılmaz.
- Uygulama pCloud fiziksel dosya yedeğini kendiliğinden yöneten bir yedekleme ürünü değildir.

## 2. Kimlik doğrulama ve oturum

### 2.1 Hesap yaşam döngüsü

- Kullanıcı hesabını yalnız yetkili yönetici açar, pasifleştirir ve rol atar.
- Paylaşılan kullanıcı hesabı kullanılmaz; işlem yapan kişi ayırt edilebilir olmalıdır.
- Pasifleştirilen kullanıcının aktif oturumları iptal edilir.
- İlk parola ve parola sıfırlama akışı tek kullanımlı, kısa ömürlü ve auditli olmalıdır.
- Başarısız girişlerde oran sınırı ve kademeli bekleme uygulanır; hesap kilitleme politikası ofis destek riskiyle birlikte kararlaştırılır.

### 2.2 Parola saklama

- Parola hiçbir zaman düz metin veya geri çevrilebilir şifreleme ile saklanmaz.
- Argon2id güncel güçlü parametrelerle geçici öneridir; gerçek parametreler hedef donanımda ölçülerek sürümlü yapılandırılır.
- Her parola benzersiz salt kullanır; uygulama seviyesinde pepper seçilirse sır deposunda tutulur.
- Loglar, audit, hata yanıtları ve destek ekranları parola/hash içermez.

### 2.3 Oturum modeli

- Merkezi API'nin sunucu taraflı, iptal edilebilir oturum kaydı ve HttpOnly, Secure, SameSite cookie yaklaşımı geçici öneridir.
- Oturum kimliği tarayıcı localStorage'ında tutulmaz.
- CSRF koruması cookie tabanlı oturumla birlikte tasarlanır.
- Mutlak ve hareketsizlik zaman aşımı, eşzamanlı oturum ve cihaz hatırlama kararları açık kapıdır.
- Electron kabuğu geldiğinde aynı API oturum sözleşmesi korunur; token'ı renderer'a veya Node entegrasyonuna açmak varsayılan değildir.

## 3. Yetkilendirme ve RBAC

Yetki kontrolü kaynak ve eylem bazlıdır. Başlangıç rol adları ürün kararıyla kilitlenir; olası yetki kümeleri:

- dosya görüntüleme ve listeleme,
- dosya oluşturma/güncelleme,
- not/görev yönetimi,
- belge/fotoğraf işlemi talep etme,
- değer kaybı/ağır hasar değerlendirmesi,
- kapanış ve ücret önizleme/onay,
- rapor görüntüleme,
- mevzuat kaynağı yönetme/etkinleştirme,
- kullanıcı/rol/ayar yönetimi,
- audit ve operasyon sağlığı görüntüleme.

Kurallar:

- Varsayılan reddet ve en az yetki uygulanır.
- Firma/organizasyon kapsamı her sorguda sunucu tarafında uygulanır.
- Kritik işlemlerde rol kontrolüne ek olarak planla -> önizle -> kullanıcı onayı -> uygula -> doğrula -> kesinleştir -> audit akışı gerekir.
- UI'da butonun gizlenmesi yetki kontrolü sayılmaz.
- Kullanıcı kendi rolünü veya kapsamını yükseltemez.
- Servis hesapları insan rolü alamaz; yalnız gereken makine yetkilerine sahiptir.

## 4. İletişim ve ağ güvenliği

- Üretim ve ofis LAN'ında API erişimi HTTPS olmalıdır; ağın yerel olması düz metni güvenli yapmaz.
- TLS sertifika anahtarı repository'ye, paket içine veya istemciye konmaz.
- PostgreSQL genel istemci ağına açılmaz; firewall yalnız API, File Agent ve yetkili bakım kaynağını kabul eder.
- API, CORS ve izin verilen origin listesini açık biçimde sınırlar.
- Güvenlik başlıkları, istek boyutu sınırları, rate limit ve dosya türü/boyutu denetimi uygulanır.
- Gmail ve AI çağrıları yalnız sunucu taraflı entegrasyon katmanından çıkar; kullanıcı girdisi doğrudan sırlarla birleştirilmez.

## 5. Sırlar ve yapılandırma

- Veritabanı parolası, session secret, OAuth client secret, AI anahtarı, TLS anahtarı ve yedek şifreleme anahtarı kaynak kodda değildir.
- Yerel geliştirme .env dosyası commit edilmez; yalnız güvenli örnek anahtar adları belgelenebilir.
- Geçici Windows kurulumunda sırlar hizmet hesabı erişimiyle sınırlı şifreli/korumalı yapılandırmada tutulur; kalıcı sunucuda işletim sistemi veya yönetilen sır deposu tercih edilir.
- Sır rotasyonu mevcut oturum/servis kesintisini hesaba katan runbook ile yapılır.
- Loglarda ortam değişkenlerinin tamamı, bağlantı dizesi veya header dökümü yazılmaz.
- Test ve geliştirme sırları üretimden tamamen ayrıdır.

## 6. Audit olay standardı

### 6.1 Audit ile operasyon logunun farkı

- Operasyon logu tanılama içindir ve döndürülebilir.
- Audit olayı kim, neyi, ne zaman ve hangi sonuçla yaptı sorusunun kalıcı iş kanıtıdır.
- Windows Olay Günlüğü veya metin logu, veritabanındaki audit olayının yerine geçmez.

### 6.2 Asgari audit alanları

- auditEventId,
- occurredAtUtc ve serverReceivedAtUtc,
- actorType (user/service/system) ve actorId,
- sessionId'nin güvenli referansı,
- organization/firmId,
- action ve resourceType/resourceId,
- requestId/correlationId,
- sourceChannel ve güvenli istemci bilgisi,
- outcome (success/rejected/failed), reasonCode,
- approval/preview/idempotency/job referansları,
- önce/sonra değişen alanların güvenli özeti,
- şema sürümü.

### 6.3 Önce/sonra verisi ve maskeleme

Audit sözleşmesindeki güvenli önceki/sonraki özet, API alan adlandırmasında `before/after` olarak temsil edilebilir; ham nesne kopyası değildir.

- Tüm nesnenin ham kopyası yerine izin verilen değişen alanlar kaydedilir.
- Parola, hash, token, cookie, OAuth kodu, secret, e-posta gövdesi, belge içeriği ve mutlak yol hiçbir zaman audit'e girmez.
- TC kimlik, telefon, e-posta, plaka gibi kişisel/operasyonel alanlar iş gereksinimine göre maskelenir veya yalnız referans kimliğiyle tutulur.
- Dosya işlemlerinde göreceli yol, hash, iş kimliği ve sonuç tutulabilir; yerel kök veya kullanıcı profili yolu tutulmaz.
- AI olayında model/sağlayıcı, istem sürümü, kaynak referansları, güven seviyesi ve kullanıcı onayı tutulur; gereksiz ham belge/içerik çoğaltılmaz.

### 6.4 Audit bütünlüğü ve erişimi

- Uygulama rolleri audit olayını güncelleyemez veya silemez; yalnız ekleme servisi yazar.
- Audit sorgusu özel yetki ister ve sorgunun kendisi de auditlenir.
- Zaman sırası, benzersiz kimlik ve sunucu saati kullanılır.
- İhtiyaca göre zincir hash/imzalı dış arşiv sonradan değerlendirilebilir; hukuki saklama kararı olmadan zorunlu teknoloji seçilmez.
- Saklama süresi ve yasal silme/anonimleştirme politikası hukuk/ürün kararıdır.

### 6.5 Uygulama durumu (Paket 11) ve saklama/dışa aktarma planı

Uygulanan (HB-2026-017): Tek merkezi `AuditService` mevcut `audit_events` tablosuna yazar (paralel sistem yok). Alanlar: organizationId, actorUserId, action, entityType (resource_type), entityId (resource_id), requestId, occurredAt, redaksiyonlu `details` (eski/yeni değer veya güvenli değişiklik özeti). Audit yazımı ilgili iş transaction'ıyla atomiktir (yarım iş/yarım audit olmaz). Append-only VERİTABANI seviyesinde bir trigger ile zorlanır: `UPDATE`/`DELETE` reddedilir; normal API'de güncelleme/silme ucu yoktur. Login/logout, hesap kilidi, oturum iptali ve Case create/update merkezi katmana taşındı. Salt-okunur sorgu API'si (`GET /api/v1/audit-events`) oturum + yönetici rolü ister, kiracı kapsamlıdır, filtre + sınırlı pagination sağlar. Redaksiyon parola/token/cookie/tam poliçe metni/gereksiz PII'yi alan ADına göre `[redacted]` yapar ve aşırı uzun metni kırpar.

Yalnız PLAN (bu pakette uygulanmadı): 
- **Saklama (retention):** varsayılan çevrimiçi saklama penceresi (öneri: en az 12 ay sıcak), ardından soğuk arşive taşıma; kesin süre hukuk/ürün kararıdır ve KVKK silme/anonimleştirme yükümlülüğüyle uzlaştırılır. Silme, append-only tabloda satır güncellemesiyle değil, yetkili operasyon aracıyla ve auditli olarak yürütülür.
- **Dışa aktarma (export):** yetkili yönetici için imzalı/erişim-kısıtlı dışa aktarma (CSV/JSON) ve isteğe bağlı zincir-hash bütünlük kanıtı; dışa aktarmanın kendisi de bir audit olayıdır (`audit.exported`). SIEM/harici log entegrasyonu ayrı ve sonraki bir karardır (bu paket kapsamı dışında).
- **Sorgu audit'i:** audit sorgusunun kendisinin auditlenmesi (§6.4) ileri pakete bırakıldı.

### 6.6 Paket 20 file-operation saga audit ve recovery sınırı

- `file_operation.planned`, `approved`, `started`, `verified`, `location_switched`, `cleanup_pending`, `finalized`, `failed` ve `manual_recovery_required` olayları mevcut merkezi `AuditService` üzerinden yazılır; paralel audit sistemi yoktur.
- Location switch, append-only location history, operation/job durumu ve ilgili audit olayları aynı PostgreSQL transaction'ında kesinleşir. Cross-volume source cleanup ayrı, idempotent Agent işidir; switch başarısından sonra cleanup hatası DB/hedefi geri almaz ve `cleanup_pending` olarak auditlenir.
- Audit yalnız organization/actor veya agent, case/operation/job/request kimlikleri, mantıksal source/destination, strateji, manifest özeti ve güvenli sayaçları taşıyabilir. Merkezi redaksiyon politikası korunur; tam manifest entry'leri, dosya içeriği, mutlak root, secret ve ham OS exception yasaktır.
- `manual_recovery_required`, filesystem ve DB gerçekliği belirsizken otomatik/kör geri taşıma veya silmenin durdurulduğunu gösterir. Recovery işlemi source/target manifestini yeniden doğrulamadan başarıya çevrilemez.

## 7. Güvenlik olayları ve hata davranışı

- Yetkisiz erişim ayrıntılı iç hata sızdırmadan 401/403 döner.
- Şüpheli tekrar giriş, rol değişikliği, toplu dışa aktarma, kritik işlem reddi ve sır rotasyonu güvenlik olayı olarak işaretlenir.
- Güvenlik hatası sessizce yutulmaz; correlationId ile operasyon kanalına düşer.
- AI/Gmail/pCloud kesintisi temel dosya verisini bozmaz ve kullanıcıya güvenli gecikme durumu gösterir.
- Dosya hash uyuşmazlığı, path traversal veya root dışına çıkma isteği karantinaya alınır ve kritik alarm üretir.

## 8. Yedekleme sınırları

### 8.1 Uygulamanın sorumluluğu

Uygulama otomatik olarak pCloud fiziksel dosya ağacının kopyasını almaz, harici diski yönetmez veya kullanıcı onayı olmadan geri yükleme yapmaz. Uygulama en fazla:

- son başarılı veritabanı yedeği zamanını,
- doğrulama/geri yükleme tatbikatı tarihini,
- depolama eşitleme/erişim sağlık sinyalini,
- yapılandırılmış operasyon uyarılarını

gösterebilir. Asıl yedekleme, yetkili operasyon aracı veya zamanlanmış görevle, runbook ve audit kanıtıyla yürütülür.

### 8.2 PostgreSQL yedeği

Planlanan katmanlar:

- günlük mantıksal/tam yedek,
- gereksinim belirlenirse daha sık WAL/PITR veya artımlı koruma,
- haftalık ve aylık ayrı saklama kuşağı,
- merkezi bilgisayardan fiziksel olarak ayrı, erişimi sınırlı hedef,
- şifreleme, hash/doğrulama ve başarısızlık alarmı,
- düzenli temiz ortam geri yükleme tatbikatı.

Kesin sıklık, saklama süresi, hedef sayısı ve RPO/RTO henüz kilitlenmez. Mevcut belgelerdeki günlük/haftalık/aylık yaklaşım başlangıç çerçevesidir; iş etkisi analiziyle sayısallaştırılır.

### 8.3 Dosya depolama yedeği ve pCloud

- pCloud eşitleme tek başına yedek değildir; silme, şifreleme zararlısı veya bozukluk eşitlenebilir.
- Fiziksel dosyalar için sürümlü/geri alınabilir, ayrı kimlik bilgili ve mümkünse çevrimdışı/immutable bir ikinci koruma politikası operasyon kararıdır.
- Veritabanı yedeği ile dosya anlık görüntüsü arasında tutarlılık noktası tanımlanmalıdır.
- Dosya yedeği mutlak yerel kökü değil, mantıksal depolama ağacını ve doğrulama manifestini esas alır.
- Geri yüklemede göreceli yollar, hash örneklemi, erişim ACL'leri ve File Agent indeks/metadata uyumu kontrol edilir.

### 8.4 Yapılandırma ve sır yedeği

- Sürüm kontrollü ama sır içermeyen yapılandırma şemaları repository'de tutulabilir.
- Gerçek sırlar ayrı, şifreli ve erişim denetimli kurtarma prosedürüne sahiptir.
- Sertifika ve anahtar kurtarma materyali üretim bilgisayarıyla aynı tek arıza noktasında tutulmaz.
- Yedek geri yükleme, eski/iptal edilmiş sırları farkında olmadan tekrar etkinleştirmemelidir.

## 9. Geri yükleme ve doğrulama

Her yedek başarılı mesajı gerçek kurtarma kanıtı değildir. Tatbikat:

1. Yetkili kişi ve hedef izole ortamı belirler.
2. Yedek dosyasının hash, şifreleme ve katalog bilgisi doğrulanır.
3. Yeni PostgreSQL örneğine geri yüklenir.
4. Migration sürümü, temel tablo/satır sayıları, FK/unique kontrolleri ve örnek iş akışları doğrulanır.
5. Dosya ağacı için seçili göreceli yollar ve hash'ler doğrulanır.
6. API salt okunur kabul testi ve gerekiyorsa kontrollü yazma testi çalıştırılır.
7. Gerçekleşen kurtarma süresi ölçülür; hedef RTO ile karşılaştırılır.
8. Sonuç, eksik ve düzeltici görev audit/operasyon raporuna kaydedilir.

Tatbikat üretim verisini değiştirmez; üretim sırları test ortamına kontrolsüz taşınmaz.

## 10. Merkezi bilgisayar kaybı / felaket kurtarma

### 10.1 Senaryolar

- Windows açılmıyor fakat disk erişilebilir,
- bilgisayar ve yerel disk tamamen kayıp,
- PostgreSQL bozuk fakat depolama erişilebilir,
- pCloud/depolama erişilemiyor fakat PostgreSQL sağlam,
- fidye yazılımı veya yetkisiz erişim şüphesi,
- ofis lokasyonu geçici olarak kullanılamıyor.

### 10.2 Öncelik sırası

1. Olayı sınırla; şüpheli cihazı ağdan ayır ve kanıtı koru.
2. Son güvenilir veritabanı ve dosya yedeğini belirle; bozuk/silinmiş durumun yedeğe taşınmadığını doğrula.
3. Temiz, güncel ve sertleştirilmiş yedek cihaz/sunucu hazırla.
4. Sırları rotasyona al; hizmet hesaplarını ve sertifikaları yeniden oluştur.
5. PostgreSQL'i geri yükle ve bütünlük kontrollerini yap.
6. Depolama kökünü geri yükle/eşle, göreceli yol ve hash örneklemini doğrula.
7. API ve File Agent'ı aynı uyumlu sürümle başlat.
8. Kabul testleri sonrası kontrollü olarak kullanıcı erişimini aç.
9. Veri kaybı penceresi, kurtarma süresi ve etkilenen işlemleri raporla.

RPO (kabul edilebilir veri kaybı penceresi) ve RTO (kabul edilebilir hizmet dönüş süresi) iş sahibi tarafından sayılaştırılmadan kesin vaat verilmez. İlk gerçek altyapı paketinde bu karar bir giriş kapısıdır.

## 11. Yedek ve güvenlik kabul kontrolleri

- Yetkisiz kullanıcı API, yönetim ve audit kaynaklarına erişemez.
- Parola/token/secret hiçbir log veya audit örneğinde görünmez.
- Kritik işlemin kullanıcı, onay, önce/sonra özeti ve sonuç audit zinciri bulunur.
- Günlük yedek başarısızlığı görünür uyarı üretir.
- Ayrı hedefe PostgreSQL geri yükleme tatbikatı geçer.
- Örnek dosya ağacı göreceli yol ve hash ile geri doğrulanır.
- pCloud kesintisi temel veritabanı verisini bozmaz; dosya işlemi güvenli bekler.
- Merkezi bilgisayar kaybı runbook'u masa başı tatbikatta ve sonra kontrollü teknik tatbikatta doğrulanır.

## 12. Açık karar kapıları

| Kimlik | Karar | Seçenekler | Geçici öneri | Kilit zamanı |
|---|---|---|---|---|
| SEC-Q01 | Parola hash | Argon2id / scrypt / bcrypt | Donanım ölçümlü Argon2id | Kimlik paketi |
| SEC-Q02 | Oturum | Sunucu taraflı cookie / kısa ömürlü token | İptal edilebilir sunucu oturumu | Kimlik paketi |
| SEC-Q03 | MFA | Yok / yönetici / tüm kullanıcılar | Risk analiziyle yönetici öncelikli | Üretim kabulü |
| SEC-Q04 | Rol matrisi | Sabit roller / izin bileşimi | Kaynak-eylem izinleri | Kimlik paketi |
| SEC-Q05 | Audit bütünlüğü | Salt ekleme / hash zinciri / dış arşiv | Önce salt ekleme ve sıkı yetki | Audit paketi |
| SEC-Q06 | Audit saklama | Süre seçenekleri | Hukuk kararı beklenir | Üretim öncesi |
| BCK-Q01 | RPO/RTO | İş etkisi seçenekleri | Ölçüm ve iş onayı | DB paketi öncesi |
| BCK-Q02 | PostgreSQL koruma | Günlük dump / PITR / karma | Günlük+kuşak; RPO'ya göre PITR | Dağıtım paketi |
| BCK-Q03 | Dosya ikinci kopya | Harici disk / NAS / immutable bulut | pCloud'dan bağımsız kopya | Üretim öncesi |
| BCK-Q04 | Tatbikat sıklığı | Aylık / üç aylık / sürüm bazlı | Risk ve kapasiteyle belirle | Operasyon kabulü |

Bu öneriler yeni kalıcı ürün kararı değildir; ilgili uygulama paketinin karar kapısında onaylanmalıdır.

### 6.7 Paket 21 lifecycle audit ve append-only geçmiş

- Close/reopen plan, approve, blocked/with-missing, finalized, failed, stale ve manual-recovery olayları mevcut merkezi `AuditService` üzerinden yazılır; ikinci audit kanalı yoktur.
- Audit yalnız organization/actor-agent/case/lifecycle-operation/file-operation/job kimlikleri, önceki/yeni lifecycle-stage, logical source/destination, close mode, güvenli requirement sayıları, kullanıcı gerekçesi, requestId ve recovery durumunu taşır.
- Mutlak path, Agent secret, belge içeriği, ham poliçe metni, gereksiz kişisel veri ve ham OS/SQL/stack hatası audit'e yazılmaz.
- Lifecycle history append-only DB trigger ile korunur. Reopen eski close kaydını değiştirmez; aynı case/ofis numarası üzerindeki yeni bir history satırıdır.
- Verified location switch, case lifecycle/workflow değişimi, history ve final audit merkezi transaction'da tamamlanır. Belirsiz fiziksel durumda başarı audit'i ve closed/open finalize yoktur.

### 6.8 Paket 22 servis uygunluğu audit sınırı

- Case create/update ve close plan audit'i servis türü, uygunluk/anlaşma durum kodu, kural sürümü ve eşleşen agreement kimlikleri gibi güvenli özetleri taşıyabilir.
- Agreement kaynak metni, servis iletişim bilgisi, kullanıcı e-postası, belge içeriği, mutlak yol ve secret audit'e yazılmaz.
- Agreement yönetim CRUD'u bu pakette olmadığı için paralel audit yolu kurulmaz. Mevcut Case/lifecycle yazıları merkezi `AuditService` ve mevcut transaction sınırında kalır.

### 6.9 Paket 23 poliçe analiz audit sınırı

- Merkezi olaylar: `policy_analysis.created/version_created/control_required/conflict_detected/approved/rejected/superseded`, `policy_conflict.resolved`, `policy_scenario.evaluated`.
- Audit yalnız organization/case/analysis/version/source document kimlikleri, kaynak ve conflict sayıları, actor, approval/result/rule version ve requestId taşır. Aynı kullanıcının kendi importunu onaylaması `selfApproved` özetiyle görünürdür.
- Tam poliçe metni, raw excerpt, poliçe numarası, plaka/kişisel veri, mutlak yol, secret ve ham hata audit'e yazılmaz. İş yazısı, approval/conflict/evaluation ve audit aynı transaction'dadır.
- Approved/superseded version ve evidence DB trigger ile immutable/append-only korunur; düzeltme eski audit/veriyi değiştirmez, yeni sürüm ve yeni olay üretir.

### 6.10 Paket 24 PDF extraction audit sınırı

- Merkezi olaylar: `document_text.extraction_queued`, `document_text.extraction_started`, `document_text.extraction_completed`, `document_text.extraction_partial`, `document_text.ocr_required`, `document_text.extraction_failed`, `document_text.extraction_cancelled`, `document_text.source_reference_created`.
- Audit organization/case/document/version/extraction/job/agent kimlikleri, exact parser+normalizasyon, status, sayfa/segment/sayaç, output hash, bounded locator offsetleri ve güvenli hata kodu taşıyabilir.
- Raw/normalized sayfa metni, excerpt içeriği, PDF binary, original filename, logical/absolute path, local root/temp path, secret, parser stack ve ham OS hatası audit’e yazılmaz.
- Queue/extraction ve final metadata/audit aynı transaction’dadır. Chunk replay içerik eşitse idempotent; farklıysa reddedilir. Page/segment append-only ve terminal extraction immutable guard yedek/audit bütünlüğünü korur.

### 6.11 Paket 25 OCR audit ve veri güvenliği sınırı

- Merkezi olaylar: `document_page_ocr.requested/started/completed/partial/low_confidence/control_required/failed/cancelled/superseded` ve `document_page_ocr_source_reference.created`.
- Audit yalnız organization/case/document/version/extraction/page/run/job/agent/actor kimlikleri; engine/language/render/preprocess/locator sürümleri; status/quality/sayaç/output hash; safe failure code ve requestId taşır.
- Audit/log tam raw/normalized OCR metni, uzun excerpt, müşteri verisi, filename, logical/absolute root/path/temp, render görüntüsü, PDF/model binary, Agent secret, worker command/stdout/stderr, stack veya ham OS/SQL hatası taşımaz.
- Request/queue ve terminal metadata/audit merkezi transaction’dadır. Eşit chunk replay idempotent, farklı replay reddedilir. OCR evidence append-only ve terminal run immutable olduğu için yedek geri yüklemede kanıt sürümü sessizce değişmez.

### 6.12 Paket 26 AI orchestration audit sınırı

- Merkezi audit yalnız organization/case/run, provider-model-prompt-schema sürümü, kaynak/candidate/conflict/control sayıları, integer kullanım/maliyet, durum/result code, actor ve requestId taşır.
- Full prompt, full provider output, poliçe/OCR metni, uzun excerpt, kişisel veri, session, secret, binary, mutlak yol, stack veya ham provider hatası yasaktır.
- `planned`, `started`, `review_required`, `failed`, `provider_disabled`, `budget_blocked`, `cancelled` ve candidate conflict olayları mevcut AuditService ile ilgili transaction’da yazılır.
- Raw provider response varsayılan olarak DB’de tutulmaz. Usage ledger append-only güvenli sayaçtır; audit’in yerine geçen ikinci bir olay sistemi değildir.

### 6.13 Paket 27 review/promotion audit sınırı

- Merkezi olaylar candidate için `accepted`, `edited`, `rejected`, `control_required`; promotion için `policy_ai_candidate.promoted` ve Paket 23 `policy_analysis.version_created` olaylarıdır.
- Audit yalnız organization/case/run/candidate, review/promotion/analysis sürümü, eylem, evidence durumu, kaynak ve conflict sayıları, aktör, result code ve requestId taşır.
- Human review metninin kanıt değeri, full prompt/provider output, poliçe/OCR metni, bounded source excerpt, kişisel veri, secret, mutlak path, SQL/stack veya ham hata audit’e kopyalanmaz.
- Review, promotion provenance, yeni Paket 23 taslak sürümü, source link/conflict ve audit ilgili merkezi transaction içinde atomiktir. Append-only DB guard’ları yedek/restore sonrasında geçmiş kararın sessiz değişmesini engeller.

### 6.14 Paket 28 gerçek provider ve privacy audit sınırı

- Audit provider/model/prompt/schema/privacy/pricing sürümü, external flag, redaksiyon kategori/sayısı, token/maliyet sayacı, run sonucu, actor ve requestId gibi güvenli özetleri taşıyabilir.
- Authorization header/API key, full outbound payload/prompt/provider output, raw veya redacted poliçe metni, excerpt, PII placeholder eşlemesi, binary, session, mutlak yol, stack ve ham provider hatası audit/log'a yazılmaz.
- Canlı pilot canonical-output teşhisi de aynı sınırdadır: yalnız allowlist DTO alan yolu ve sabit validation issue sınıfı stderr'e çıkabilir; reddedilen değer, Zod mesajı, provider output veya kaynak anchor değeri gösterilmez ve kalıcı kayda yazılmaz.
- Secret yalnız API process environment’ındadır. Rotation/deployment platformu kapsamındadır; DB/API/UI üzerinden secret yönetimi yapılmaz.
- `store:false` provider uygulama-state saklamasını kapatır ancak tek başına ZDR garantisi değildir. Gerçek müşteri pilotunda sağlayıcı organization retention ayarı, sözleşme ve egress kontrolü ayrıca güvenlik kapısıdır.

### 6.15 Paket 29 provider receipt ve recovery audit sınırı

- `ai_provider_call_receipts`, ücretli çağrı öncesi durable güvenlik kaydıdır; audit'in yerine geçmez. Provider/model/pricing kimliği, request/output hash, safe provider response/request kimliği, token/karakter/maliyet sayacı ve güvenli sonuç kodu taşıyabilir.
- Full prompt, ham provider response, source text/excerpt, PII/redaction eşlemesi, authorization header/API key, session, mutlak yol, stack veya ham provider hatası receipt/audit/log'a yazılmaz.
- Receipt `response_recorded` olduğunda DB finalize recovery provider'ı yeniden çağırmaz. Sonucu belirsiz dış çağrı `outcome_unknown` olarak terminal ve immutable kalır; otomatik retry/audit başarı olayı üretilmez.
- Kesin HTTP 503 retry'ları yeni DB receipt veya yeni idempotency kaydı üretmez; aynı logical dispatch içinde bounded kalır. Tükenme güvenli `AI_PROVIDER_UNAVAILABLE` koduyla `response_recorded→finalized` olur. Model fallback yalnız sentetik pilot runner'ında ayrı model denemesi olarak raporlanır; secret, response body veya backoff ayrıntısı audit'e yazılmaz.
- Gemini pilotunda official GenerateContent endpoint'i, `x-goog-api-key` secret sınırı ve tools/cached-content yokluğu kod/test düzeyinde doğrulanır. Ücretsiz katmanın `free_tier_product_improvement` retention davranışı açıkça saklanır ve UI'da gösterilir; bu yüzden gerçek müşteri verisi pilot girdisi olamaz.
- 4xx diagnostic yalnız bounded HTTP/provider-status ile sabit neden ve izinli alan sınıfıdır; DB/audit/log'a yazılmaz. Provider hata `message`/`description`, ham response body ve structured-output payload bellekte sınıflandırıldıktan sonra atılır; kullanıcı verisinden serbest diagnostic token üretilmez. Schema-preflight ve timeout tanısı yalnız stage/status/safe code taşır, kalıcılaştırılmaz. Başarılı pilot tek wire probe kullanır; 400 tanı çağrıları audit/usage ledger olayı değildir.
- Thought summary/signature, candidate raw part listesi ve finish message DB/audit/log'a yazılmaz. Preflight yalnız sabit finish-reason sınıfını yerel tanıda gösterir; gerçek adapter kanonik JSON dışındaki part metadata'sını bellekte attıktan sonra strict server doğrulamasına geçer.

### 6.16 Paket 30 dosya detayı entegrasyonu audit sınırı

- Dosya detayı entegrasyonu yeni audit olayı üretmez. Mevcut plan/start/review/promotion ve Paket 23 write olayları merkezi AuditService üzerinden aynı transaction sınırlarında kalır.
- Kaynak seçiminin UI state’i kalıcı iş verisi değildir. Server plan audit’i yalnız mevcut güvenli source/candidate sayaçlarını ve kimlikleri taşır; checkbox etiketi, tam excerpt veya istemci ekran durumu audit’e yazılmaz.
- Promotion sonrası otomatik analysis refresh salt okunurdur ve ek audit gürültüsü oluşturmaz.
- Kanıt dialogu yalnız API’nin bounded sourceAnchor metadata’sını gösterir; mutlak yol, binary, secret, full prompt/output ve tam poliçe metni istemci modeline eklenmez.

### 6.17 Paket 31 deployment availability ve secret audit sınırı

- Gemini API key yalnız API process environment’ındadır; DB yedeği, audit export, client bundle, API response ve log kapsamına girmez. Rotation/deployment platformunun sorumluluğudur.
- `GET /api/v1/ai/providers` salt-okunur kullanılabilirlik sorgusudur ve her ekran yenilemesinde audit gürültüsü üretmez. Provider start ve usage olayları mevcut AuditService/ledger kurallarıyla auditlenmeye devam eder.
- Availability cevabı yalnız güvenli provider/model/version/retention, deployment kayıt durumu ve organization policy/bütçe özetini taşır. Secret varlığına ilişkin ham config değeri, key uzunluğu/biçimi veya environment adı kullanıcı verisi olarak dönmez.
- Provider kapalı veya yapılandırılmamış durumda dış çağrı ve fallback yoktur. Bu durum case/document/policy-analysis read/write audit akışlarını değiştirmez.

### 6.18 Paket 32 Trafik değer kaybı audit sınırı

- Olaylar: `traffic_value_loss.draft_created`, `version_created`, `control_required`, `submitted`, `approved`, `rejected`.
- Audit yalnız organization/actor/case/assessment version, rule version, result code, uncertainty/evidence/comparable sayıları, selfApproved ve requestId taşıyabilir.
- Piyasa ilan URL’si, araç/plaka, belge adı/içeriği, değer kanıt metni, mutlak yol, secret, SQL/stack veya ham hata audit’e yazılmaz.
- Version, evidence, comparable, approval event ve audit aynı command transaction’ında atomiktir.
- Approved/superseded version ile evidence/comparable/approval geçmişi DB trigger’larıyla immutable/append-only korunur.
