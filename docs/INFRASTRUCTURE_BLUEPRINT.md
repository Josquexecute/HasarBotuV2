# HasarBotu V2 — Altyapı Mimarisi Taslağı

Tarih: 2026-07-11
Durum: Planlama belgesi; uygulama veya kesin teknoloji seçimi değildir
Korunan UI referansı: `v0.1.0-ui-baseline`

## 1. Amaç ve değişmezler

Bu belge, kabul edilmiş UI davranışını değiştirmeden gerçek veri, servis ve dosya altyapısının sınırlarını tanımlar. Bu görev üretim backend'i, Electron kabuğu, PostgreSQL şeması veya File Agent kodu üretmez.

Değişmezler:

- PostgreSQL iş verisinin kaynak doğruluğudur.
- Dosya içeriği yapılandırılmış depolama kökünde; veritabanı metadata ve taşınabilir göreli yol tutar.
- Kritik klasör taşıma ve yeniden adlandırmayı yalnız tek ana File Agent yürütür.
- Dosya türü yalnız `Trafik` veya `Kasko` olabilir.
- Her vaka plaka yerine değişmez `caseId` ile tanımlanır.
- Aynı plaka farklı vakalarda bulunabilir.
- Kabul edilmiş UI rota, düzen, tema, tablo ve etkileşim davranışı korunur.
- AI yalnız karar desteğidir; kullanıcı onayı olmadan kritik işlem yapamaz.
- Gmail ilk aşamada taslak/compose akışıdır; otomatik gönderim yoktur.
- Ücretli servis veya zorunlu abonelik temel çalışma için şart değildir.
- Gerçek zamanlı ortak düzenleme temel senaryo değildir; yine de optimistic locking ve idempotency zorunludur.

## 2. Hedef bağlam

```text
Web UI ───────────────┐
                     ├── HTTPS / JSON ── Merkezi API ── PostgreSQL
Windows Desktop ─────┘                         │
  (ince kabuk)                                 ├── AI servis adapter'ı (opsiyonel)
                                               ├── Gmail compose/adapter sınırı
                                               ├── Mevzuat kaynak servisi
                                               └── File Agent görev kuyruğu
                                                          │
                                                          ▼
                                                Ana File Agent
                                                          │
                                                          ▼
                                           Yapılandırılmış storage root
                                           (pCloud / P:\ / başka kök)
```

Web UI ve desktop aynı API sözleşmelerini ve ortak UI/domain paketlerini kullanır. Desktop kabuğu iş kuralı veya doğrudan veritabanı erişimi taşımaz. API iş verisini yönetir; File Agent fiziksel dosya işlemini yönetir.

## 3. Bileşen sınırları

### 3.1 Web UI

- **Sorumluluk:** Kabul edilmiş ekranları sunmak; kullanıcı girdisini doğrulamak; API durumlarını loading/empty/error olarak göstermek; optimistic concurrency çatışmasını kullanıcıya açıklamak.
- **Yapmaması gerekenler:** İş kuralını kesinleştirmek, PostgreSQL'e bağlanmak, cihaz yolu üretmek, klasör taşımak, Gmail göndermek veya AI sonucunu otomatik uygulamak.
- **Girdiler:** Kullanıcı etkileşimi, API DTO'ları, session durumu, yerel görünüm tercihleri.
- **Çıktılar:** API komut/sorguları, kullanıcı onayı, güvenli dosya açma talepleri.
- **Bağımlılıklar:** `packages/ui`, `packages/contracts`, `packages/domain`, API endpoint'i.
- **Güven sınırı:** Tarayıcı güvenilmez istemcidir; her yetki ve kural sunucuda yeniden kontrol edilir.
- **Hata davranışı:** Son başarılı görünümü korur, yazmayı durdurur, tekrar deneme veya yenileme sunar; offline durumda kritik işlemi sıraya almaz.

### 3.2 Windows masaüstü kabuğu

- **Sorumluluk:** Web UI'yi masaüstünde barındırmak; güvenli yerel dosya açma ve işletim sistemi entegrasyonunu dar IPC sözleşmesiyle sunmak.
- **Yapmaması gerekenler:** İş verisi saklamak, API'yi atlamak, veritabanına bağlanmak, geniş dosya sistemi yetkisini renderer'a vermek.
- **Girdiler:** API tabanlı UI, kullanıcı tarafından onaylanan yerel eylem, cihaz storage-root profili.
- **Çıktılar:** Güvenli IPC isteği, izinli dosya açma sonucu, uygulama sağlık bilgisi.
- **Bağımlılıklar:** `apps/web` build'i veya ortak `packages/ui`, `packages/contracts`, desktop preload sınırı.
- **Güven sınırı:** Renderer güvensiz; context isolation açık, node integration kapalı, IPC allow-list zorunlu.
- **Hata davranışı:** API yoksa salt okunur hata görünümü; yerel dosya yoksa tam yol sızdırmadan açıklama; otomatik kritik işlem yok.

### 3.3 Merkezi API

- **Sorumluluk:** Authentication, authorization, domain kuralları, transaction, optimistic locking, idempotency, audit ve adapter orkestrasyonu.
- **Yapmaması gerekenler:** Fiziksel klasörü doğrudan taşımak, UI düzeni bilmek, sağlayıcıya özgü AI/Gmail kodunu domain'e gömmek.
- **Girdiler:** Kimlik doğrulanmış HTTP istekleri, File Agent sonuçları, entegrasyon callback/poll sonuçları.
- **Çıktılar:** Sürümlü DTO'lar, audit event'leri, File Agent görevleri, bildirimler.
- **Bağımlılıklar:** PostgreSQL, contracts/domain/config paketleri, opsiyonel provider adapter'ları.
- **Güven sınırı:** Tek iş kuralı ve yetki sınırı; dış girdiler şema ile doğrulanır.
- **Hata davranışı:** Transaction rollback, standardize hata kodu, request/correlation ID; bağımlılık yoksa ilgili özelliği fail-closed duruma alır.

### 3.4 PostgreSQL

- **Sorumluluk:** Vaka, kullanıcı, durum, not, görev, metadata, kural sürümü, ücret, audit ve job kayıtlarının kaynak doğruluğu.
- **Yapmaması gerekenler:** Dosya blob'u, cihazın mutlak `P:\` yolu, UI geçici state'i veya secret saklamak.
- **Girdiler:** Yalnız API ve yetkili migration/backup araçlarının transaction'ları.
- **Çıktılar:** Tutarlı sorgu sonucu, constraint/lock hatası, audit için önceki-sonraki state.
- **Bağımlılıklar:** Güvenilir disk, yedekleme ve zaman senkronizasyonu.
- **Güven sınırı:** Ofis ağı içinde kısıtlı port; kullanıcı istemciler doğrudan bağlanamaz.
- **Hata davranışı:** API yazmayı durdurur; File Agent yeni kritik göreve başlamaz; sağlık kontrolü alarm üretir.

### 3.5 File Agent

- **Sorumluluk:** Staging, hash, güvenli dosya adı, atomik taşıma, klasör oluşturma/taşıma, yeniden deneme, doğrulama ve audit sonucu.
- **Yapmaması gerekenler:** Domain kararını vermek, dosyayı kendiliğinden kapatmak, yetkisiz yolu işlemek, kalıcı doğrudan silme yapmak.
- **Girdiler:** PostgreSQL tabanlı, imzalı/kimlikli görev; canonical case metadata; yapılandırılmış root.
- **Çıktılar:** Başarı/başarısızlık sonucu, göreli yol, boyut/hash, doğrulama kanıtı, audit event'i.
- **Bağımlılıklar:** PostgreSQL job tablosu, storage root, servis hesabı.
- **Güven sınırı:** Fiziksel yazma yetkisine sahip tek bileşen; path traversal ve root kaçışı engellenir.
- **Hata davranışı:** Job tekrar denenebilir durumda kalır; yarım işlem recovery kaydı üretir; kullanıcıya yanlış başarı bildirilmez.

### 3.6 Dosya depolama kökü

- **Sorumluluk:** PDF, Excel, fotoğraf ve fiziksel vaka klasörlerini tutmak.
- **Yapmaması gerekenler:** İş verisinin tek kaynağı olmak, rastgele kullanıcı yazımı kabul etmek, veritabanı kimliği yerine plakayı tek anahtar saymak.
- **Girdiler:** Yalnız File Agent yazıları; kullanıcıların kontrollü salt okunur erişimi.
- **Çıktılar:** Dosya byte'ları, metadata doğrulaması için hash/size/mtime.
- **Bağımlılıklar:** pCloud senkronizasyonu veya yapılandırılmış yerel/ağ kökü, dosya sistemi izinleri.
- **Güven sınırı:** Root dışı yol yasak; cihaz bazlı mutlak kök yalnız yerel konfigürasyondadır.
- **Hata davranışı:** Bağlantı yoksa yazma reddedilir ve job bekler; API metadata'yı fiziksel başarı olmadan kesinleştirmez.

### 3.7 Gmail entegrasyonu

- **Sorumluluk:** İlk aşamada konu, metin, alıcı ve ek önerisinden güvenli Gmail compose bağlantısı/akışı üretmek; ileride opsiyonel provider adapter'ı.
- **Yapmaması gerekenler:** Kullanıcı onayı olmadan gönderim, token'ı UI/log içinde göstermek, e-postayı kesin vaka eşleşmesi saymak.
- **Girdiler:** Kullanıcı onaylı taslak, vaka bağlamı, opsiyonel OAuth kimliği.
- **Çıktılar:** Compose sonucu, taslak metadata'sı, eşleştirme adayı.
- **Bağımlılıklar:** Kullanıcının Gmail erişimi; API entegrasyonu ileriki ve opsiyoneldir.
- **Güven sınırı:** Harici veri aktarımıdır; kullanıcıya alıcı/ek önizlemesi gösterilir.
- **Hata davranışı:** Taslak kaybolmaz; otomatik gönderim denenmez; temel uygulama çalışmaya devam eder.

### 3.8 AI servis katmanı

- **Sorumluluk:** Provider bağımsız metin/belge/fotoğraf analiz adapter'ı; kaynak, gerekçe, güven ve kontrol noktası üretmek; bütçe/caching uygulamak.
- **Yapmaması gerekenler:** Domain state'ini doğrudan değiştirmek, kritik sonucu kesinleştirmek, secrets/log sızıntısı, AI yokken temel akışı durdurmak.
- **Girdiler:** Kullanıcı tarafından başlatılmış görev, izinli belge içeriği, sürümlü prompt/policy.
- **Çıktılar:** Taslak öneri, kaynak referansı, güven, kullanım/bütçe metadata'sı.
- **Bağımlılıklar:** Opsiyonel AI provider, yerel metin çıkarımı, cache.
- **Güven sınırı:** Harici servis çağrısı ayrı onay/policy sınırıdır; gönderilen veri minimize edilir.
- **Hata davranışı:** `Kontrol gerekli`/manuel akış; ücret limiti veya provider kesintisi temel sistemi etkilemez.

### 3.9 Mevzuat kaynak sistemi

- **Sorumluluk:** Kaynak ve sürüm metadata'sı, yürürlük aralığı, geçerli/eski ayrımı, kaynağa dayalı cevap referansı.
- **Yapmaması gerekenler:** Eski kaynağı güncelmiş gibi göstermek, AI cevabını hukuki görüş olarak kesinleştirmek, kaynağı onaysız etkinleştirmek.
- **Girdiler:** Yetkili kullanıcı kaynak ekleme/sürümleme işlemi, belge metadata'sı.
- **Çıktılar:** Sürüm sabit kaynak kaydı, geçerlilik bilgisi, citation ID'leri.
- **Bağımlılıklar:** PostgreSQL, dosya metadata'sı, opsiyonel AI retrieval adapter'ı.
- **Güven sınırı:** Kaynak etkinleştirme kritik ve auditli işlemdir.
- **Hata davranışı:** Kaynak doğrulanamıyorsa cevap `Kontrol gerekli`; eski sürüm korunur ve silinmez.

### 3.10 Raporlama ve ücret modülü

- **Sorumluluk:** Yetkili sorgular, dönemsel özet, nihai rapordan ücret adayı, kullanıcı onayı ve kesin toplam.
- **Yapmaması gerekenler:** Aday tutarı otomatik onaylamak, ağır senkron raporu ana transaction içinde çalıştırmak, UI hesaplamasını kaynak doğruluğu yapmak.
- **Girdiler:** PostgreSQL iş verisi, nihai ekspertiz raporu metadata/metni, kullanıcı onayı.
- **Çıktılar:** Sürüm sabit rapor sonucu, ücret durumu, dışa aktarma job'u.
- **Bağımlılıklar:** PostgreSQL, File Agent okuma sonucu, opsiyonel belge analiz adapter'ı.
- **Güven sınırı:** Kesin ücret yalnız yetkili kullanıcı onayıyla; raporlar kullanıcı kapsamını aşamaz.
- **Hata davranışı:** `Rapor Bulunamadı`, `Tutar Bulunamadı`, `Birden Fazla Aday` veya `Kontrol Bekliyor`; kesin toplama eklenmez.

## 4. Örnek akışlar

### 4.1 Dosya oluşturma

```text
UI → API: ihbar alanları + Idempotency-Key
API → PostgreSQL: mükerrer kontrol + caseId/ofis no transaction'ı
API → File Agent job: vaka klasörü planı
File Agent → Storage: klasörü geçici adla oluştur, doğrula, kesinleştir
File Agent → PostgreSQL: job sonucu + göreli yol + audit
API → UI: oluşturuldu / fiziksel hazırlık bekliyor
```

### 4.2 Dosya güncelleme

```text
UI → API: PATCH case + beklenen version
API: yetki + domain doğrulama
API → PostgreSQL: UPDATE ... WHERE id=? AND version=?
PostgreSQL → API: yeni version veya concurrency conflict
API → audit_events → UI sonucu
```

### 4.3 Evrak yükleme

```text
UI/Desktop → API: upload intent + belge türü
API → PostgreSQL: document kaydı (PENDING)
API → File Agent: staging kaynağı + hedef göreli yol
File Agent: dosya adı doğrula → hash → atomik taşı → tekrar hash
File Agent → PostgreSQL: document_version READY + audit
API → UI: belge erişilebilir
```

### 4.4 Kritik klasör taşıma

```text
UI → API: kapatma/yeniden açma önizleme isteği
API → UI: plan + engeller + hedef göreli yol
UI → API: kullanıcı onayı + gerekçe + Idempotency-Key
API → File Agent job
File Agent: lock → stage/rename → doğrula → kesinleştir → unlock
File Agent → API/DB: sonuç + hash/envanter + audit
```

### 4.5 Not ve görev ekleme

```text
UI → API: not/görev DTO + case version
API: vaka erişimi + sonuç notu kuralı
API → PostgreSQL: kayıt + case last_intervention_at + audit
API → UI: yeni kayıt + version
```

### 4.6 Değer kaybı işlemi

```text
UI → API: hazırlık durumu sorgusu
API: Trafik/Kasko kuralı + parça/boya/araç koşulları
API → AI adapter (opsiyonel): veri çıkarımı
API → sürümlü kural motoru: taslak hesap
UI: kaynak/gerekçe/güven + eksper onay ekranı
UI → API: onay + version
API → PostgreSQL: assessment sürümü + audit
```

### 4.7 Kapanış ve ücret çıkarımı

```text
UI → API: kapanış önizleme
API → File Agent: nihai rapor okuma görevi
File Agent → API: rapor göreli yolu/hash/metin sonucu
API/AI adapter: ücret adayları + sayfa/kaynak
UI: aday/kontrol durumu + kullanıcı onayı
API → PostgreSQL: fee_record kesinleştirme + audit
API → File Agent: onaylı kapanış taşıma işi
```

### 4.8 Gmail eşleştirme

```text
UI → API: taslak/eşleştirme isteği
API: vaka metadata'sıyla aday üretir
UI: alıcı, konu, ek ve vaka önizlemesi
Kullanıcı → Gmail compose: manuel gönderim
API: yalnız kullanıcı beyanı/opsiyonel adapter sonucuyla metadata kaydı
```

### 4.9 AI asistanı sorgusu

```text
UI → API: soru + caseId
API: erişim + veri minimizasyonu + bütçe kontrolü
API → AI adapter: izinli bağlam
AI adapter → API: sonuç + gerekçe + kaynak + güven
API → UI: karar desteği; otomatik state değişikliği yok
```

### 4.10 Mevzuat kaynağına dayalı cevap

```text
UI → API: soru + tarih bağlamı
API → PostgreSQL: tarihte geçerli legislation_version kayıtları
API → retrieval/AI adapter: sürüm sabit kaynak parçaları
API → UI: cevap + kaynak/sürüm/yürürlük + hukuki uyarı
```

## 5. Bileşenler arası hata ilkeleri

- API veya PostgreSQL yoksa yeni yazma ve kritik dosya işi başlamaz.
- Storage yoksa metadata `READY` yapılmaz; job bekleyen/başarısız durumda kalır.
- File Agent sonucu doğrulanmadan UI başarı göstermez.
- AI/Gmail yoksa yalnız ilgili opsiyonel özellik devre dışı kalır.
- Eşzamanlı güncelleme çatışması `409 CONCURRENCY_CONFLICT` ile kullanıcıya döner.
- Her kritik iş request ID, actor, caseId, idempotency key ve audit event ile izlenir.
- Retry yalnız idempotent veya idempotency key ile korunan işlemlerde otomatik yapılır.

## 6. Açık karar kataloğu

Bu öneriler kilit karar değildir; uygulama paketinden önce kullanıcı onayı gerekir.

| ID | Karar sorusu | Seçenekler | Artılar | Eksiler | Öneri | Gerekçe | Karar verilmezse etkisi |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ADR-Q01 | API framework hangisi? | Fastify; NestJS; Express | Fastify hafif/hızlı; Nest güçlü yapı; Express yaygın | Nest daha ağır; Express sözleşme disiplinini elle ister | Fastify + modüler katman | Küçük ekip ve düşük bağımlılık; TypeScript/JSON Schema uyumu | API iskeleti paketi başlayamaz |
| ADR-Q02 | ORM/query katmanı hangisi? | Kysely; Drizzle; Prisma; `pg` | Kysely SQL görünürlüğü; Drizzle hafif; Prisma araç zenginliği; `pg` minimum | Prisma daha ağır; ham `pg` tekrar üretir | Kysely | PostgreSQL özelliklerini gizlemeden tip güvenliği | Veri erişim paketi bekler |
| ADR-Q03 | Migration aracı hangisi? | Kysely migrator; node-pg-migrate; Drizzle migrations | Hepsi sürümlü ve scriptlenebilir | Araç değişimi erken migration borcu yaratır | Query katmanıyla aynı ekosistem | Bağımlılığı ve kavramsal yükü azaltır | İlk migration üretilemez |
| ADR-Q04 | Validation kütüphanesi hangisi? | Zod; TypeBox/JSON Schema; Valibot | Zod paylaşımı kolay; TypeBox Fastify-native; Valibot küçük | Çift şema üretimi drift yaratır | TypeBox veya Zod spike sonrası tek kaynak | UI/API contract drift'ini engellemek | Contracts paketi kesinleşmez |
| ADR-Q05 | Authentication yöntemi ne? | Sunucu session cookie; kısa ömürlü JWT + refresh; Windows/AD | Session revoke kolay; JWT dağıtık; AD ofis uyumlu | AD kurulumu karmaşık; JWT revoke zor | İlk aşamada server-side session + HTTP-only cookie | LAN/web/desktop için basit ve ücretsiz | User/session paketi başlayamaz |
| ADR-Q06 | Electron hedefi nasıl uygulanmalı? | İnce shell; iş mantıklı shell; yalnız web | İnce shell UI'yi paylaşır; iş mantıklı shell offline olabilir | İş mantığı drift yaratır; yalnız web kilit kararla uyumsuz | Kilit karara uygun ince Electron shell, geç aşamada | Electron hedefi korunur, UI/API tek kaynak kalır | Desktop paketi kapsamı belirsiz kalır |
| ADR-Q07 | Monorepo aracı ne? | npm workspaces; pnpm; Nx/Turbo ek katmanı | npm mevcut ve ücretsiz; pnpm verimli; Nx/Turbo orchestration | Araç göçü ve cache karmaşıklığı | Önce npm workspaces, ihtiyaç kanıtlanırsa araç ekle | En az değişiklik ve abonelik yok | Workspace hazırlığı gecikir |
| ADR-Q08 | Windows servis yönetimi ne? | WinSW; NSSM; Task Scheduler; container service | WinSW tanımlı servis; NSSM kolay; Task Scheduler yerleşik | Wrapper bakımı; Task Scheduler sağlık semantiği zayıf | WinSW spike, fallback Task Scheduler | Otomatik başlama/restart ve ücretsiz kullanım | Ofis dağıtım runbook'u kesinleşmez |
| ADR-Q09 | PostgreSQL Windows'ta native mi container mı? | Native Windows service; Docker/WSL container | Native daha az katman; container taşınabilir | Native upgrade/izolasyon; Docker ofiste kaynak/WSL karmaşıklığı | Geçici merkezde native; kalıcı sunucuda yeniden değerlendir | Windows 11 ofis düğümünde operasyon sadeliği | Deployment paketi başlayamaz |
| ADR-Q10 | File Agent kuyruğu ne? | PostgreSQL job tablosu; Redis/RabbitMQ | PostgreSQL ek servis istemez; ayrı queue gelişmiş özellikler | Ayrı queue operasyon yükü; DB queue ölçek sınırı | PostgreSQL `SKIP LOCKED` tabanlı queue | Düşük hacim, tek agent, ücretsiz temel | File Agent iskeleti kesinleşmez |
| ADR-Q11 | Gerçek zamanlı güncelleme gerekli mi? | Polling; SSE; WebSocket | Polling basit; SSE tek yönlü; WS çift yönlü | WS karmaşık; polling gecikmeli | İlk aşama kontrollü polling, ihtiyaçta SSE | Eşzamanlı ortak düzenleme temel senaryo değil | UI refresh stratejisi belirsiz kalır |
| ADR-Q12 | Storage root dış cihazlarda nasıl eşlenecek? | Yalnız server/agent; client salt-okunur yerel mapping; API download | Server-only güvenli; yerel mapping hızlı; API download taşınabilir | Yerel mapping cihaz drift'i; API büyük dosya yükü | Canonical agent root + opsiyonel salt-okunur client mapping | Kritik yazmayı tek agent'ta tutar, ofis hızını korur | Desktop dosya açma akışı kesinleşmez |

## 7. Çelişki ve kapsam notu

Doğrudan belge çelişkisi bulunmadı. `ARCHITECTURE.md` örnek yapıda API/File Agent'ı `apps/` altında gösterirken bu görev hedef yapıda `services/` ayrımını ister; bu bir sorumluluk çelişkisi değil, isimlendirme/yerleşim tercihidir. Yeni plan servis süreçlerini `services/` altında önerir, mevcut UI'yi hemen taşımaz.

Electron nihai hedef olarak kilitlidir; açık konu Electron'ın kullanılıp kullanılmaması değil, ince kabuğun hangi pakette ve hangi aşamada devreye alınacağıdır.
