# HasarBotu V2 — Sistem / Ürün Envanteri ve Özellik Raporu

**Hazırlanma tarihi:** 2026-08-11 · **Kaynak:** `C:\Users\user\Desktop\HasarBotuV2`, branch `foundation/package-56-ai-evidence-enrichment`, HEAD `7141010` (çalışma ağacı temiz)
**Yöntem:** Bu rapor, repodaki gerçek kod (frontend, API, File Agent, Electron, domain), 45 PostgreSQL migration'ı, ~280 test dosyası, ve `docs/DECISION_LOG.md` (8.907 satır, kronolojik — en güncel kayıt dosya SONUNDA) + `docs/PROJECT_STATUS.md` (3.454 satır, yeniden-eskiye — en güncel kayıt dosya BAŞINDA) dahil tüm proje dokümanlarının doğrudan incelenmesiyle derlenmiştir. Hiçbir kod değiştirilmedi, hiçbir commit atılmadı, hiçbir production sistemine yazma yapılmadı. Doküman ile kod çeliştiğinde önce çalışan kod, sonra şema/migration, sonra test, sonra en güncel karar kaydı esas alınmıştır. Bulgular dosya yolu + satır numarası, route adı, tablo adı veya test dosyası adıyla kanıtlanmıştır; kanıtsız hiçbir özellik "var" diye yazılmamıştır.

**Durum etiketleri:** `PRODUCTION` · `PRODUCTION / MANUAL STEP` · `INTERNAL / ADMIN` · `PARTIAL` · `DEFERRED` · `TEST/TOOLING ONLY` · `LEGACY / NOT USED`

---

## 1. Yönetici Özeti

HasarBotu V2, Türkiye'de trafik kazası ve kasko sigortası ekspertiz ("eksper") ofislerinin, bir hasar dosyasını ihbarın geldiği andan kapanışına ve ücretlendirilmesine kadar uçtan uca yönettiği, masaüstü öncelikli bir operasyon uygulamasıdır. Kullanıcıları eksperler, dosya sorumluları, sekreterlik, muhasebe ve yönetim rolündeki ofis çalışanlarıdır — sistem, `Bir Windows makinesine kurulan Electron masaüstü uygulaması` + `merkezi bir API` + `PostgreSQL veritabanı` + `dosya sistemine dokunan ayrı bir "File Agent" Windows servisi` dörtlüsünden oluşur.

Sistem yalnız iki dosya türü tanır: **Trafik** ve **Kasko**. Değer Kaybı bağımsız bir dosya türü değildir — Trafik dosyasında zorunlu, Kasko dosyasında (bugün için) fiilen kapalı bir modüldür. Her dosya `YYYY/N` biçiminde sıralı bir ofis numarası alır; plaka benzersiz kimlik değildir, her vaka kendi `caseId`'sini taşır (aynı plakanın farklı yıllarda/farklı hasarlarda ayrı dosyaları olabilir).

**Neden sıradan bir "dosya takip programı" değil:** Çoğu benzer ürün yalnız durum/tarih/not tutar. HasarBotu V2'nin farkı üç eksende somutlaşıyor:

1. **Fiziksel dosyayla veritabanı arasında gerçek, doğrulanmış bir köprü var.** Sistem yalnız "belge yüklendi" demiyor; her belgenin SHA-256 hash'ini, boyutunu ve gerçekten diskte doğrulanmış olduğunu (`hashVerified && sizeVerified && verifiedAt`) takip ediyor, ve bir kural motoru bu doğrulanmış belgelere bakarak dosyanın eksik evrakını gerçek zamanlı hesaplıyor.
2. **Kritik işlemler (dosya kapatma, klasör taşıma, Excel'e yazma) tek bir yetkisiz adımla değil, "planla → önizle → onayla → uygula → doğrula → kesinleştir → audit" yedi adımlı bir zincirle yürüyor** — ve bu zincir gerçekten koda dökülmüş, testlerle kanıtlanmış durumda (bkz. §2, §4, §21). Fiziksel dosya sistemine yazan TEK bileşen, API'den ayrı çalışan bir "File Agent" servisidir; API'nin kendisi hiçbir zaman doğrudan dosyaya dokunmaz.
3. **Yapay zekâ; öneri üretir, karar vermez.** İşçilik/parça dağıtımı, poliçe okuma, e-posta taslağı gibi noktalarda AI aktif olarak kullanılıyor, ama her AI çıktısı kanıt (hangi belge, hangi sayfa, hangi alıntı) taşımak zorunda, kaynağı bulunamayan bir iddia otomatik reddediliyor, ve hiçbir AI çıktısı bir insanın açık onayı olmadan kalıcı hale gelmiyor. Bu ilke kod seviyesinde tutarlı biçimde uygulanmış (bkz. §16, §25).

**Kullanıcının programda yaptığı işler:** dosya açma/arama, evrak/fotoğraf durumunu izleme, not/görev girme, işçilik föyü hazırlama ve AI önerisini gözden geçirip Excel'e onaylı biçimde uygulama, Kasko dosyalarında 7 zorunlu kontrolü kanıtlı biçimde işaretleme, Trafik dosyalarında Değer Kaybı hesaplayıp rapor üretme, PERT/ağır hasar kanaatini kaydetme, e-posta taslağı hazırlayıp Gmail'e aktarma, dosyayı kapatma ve kapanma ücretini onaylama, dönem raporlarını görüntüleme.

**Sistemin arkada otomatik yaptığı işler:** her belge yüklendiğinde hash/boyut doğrulaması; kritik her dosya-sistemi işleminden önce "bu dosya gerçekten güncel mi" freshness kontrolü (pCloud senkron gecikmesine karşı); işçilik/poliçe/e-posta AI çağrılarında kişisel veri (PII) maskeleme ve çıktı-kanıt eşleşmesi doğrulaması; kapanış anında evrak+Değer Kaybı+Kasko-kontrol+kapanış-evrakı gereksinimlerinin tek bir gate'te toplanması; her kritik değişiklikte immutable/append-only bir audit izi.

---

## 2. Bir Dosyanın Baştan Sona Yaşam Döngüsü

**1) İhbar / dosya oluşturma.** Kullanıcı "Yeni Dosya" ile plaka, dosya türü (Trafik/Kasko), sigortacı, servis, sorumlu kişi bilgilerini girer. Sunucu, `office_counters` tablosunda organizasyon+yıl bazlı atomik bir sayaçla (`INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING`) çakışmasız bir `YYYY/N` ofis numarası üretir; istek `Idempotency-Key` taşır, aynı istek tekrarlanırsa sayaç ikinci kez tüketilmez.

**2) Dosya bilgileri.** Özet sekmesinde araç profili (marka/model/şasi-**prefix**, tam VIN tutulmaz), araç sahibi/sahipleri (en çok N kişi, versiyonlu, tam liste her değişiklikte yeni "set" olarak eklenir — eskiler silinmez) girilir.

**3) Belge/fotoğraf.** Evrak yüklendiğinde File Agent hash/boyut doğrulaması yapar; bir belge yalnız `ready+hashVerified+sizeVerified+verifiedAt` olduğunda "mevcut" sayılır. Koşullu evrak kuralı motoru (Trafik/Kasko'ya özel, Zabıt/KTT/Beyan/Tramer alternatif-grup mantığıyla) bu doğrulanmış belgelere bakarak eksik listesini her okumada canlı hesaplar.

**4) Not/görev.** Operasyon sekmesinde iç not/görüşme notu (append-only) ve görev (öncelik, atama, zorunlu-sonuç-metinli tamamlama/iptal) girilir; her ikisi de kapalı dosyada reddedilir.

**5) Parça/işçilik + AI analiz.** Uzman işçilik föyünü girer; "Analiz Et" ile AI (bugün production'da gerçek Gemini DEĞİL, dahili deterministik bir kural motoru — bkz. §6, §16) her satırı operasyon türüne ve işçilik branşına böler, güven yüzdesi+gerekçe+kanıt ekler. Kanıt yetersizse/geçmişle çelişiyorsa satır otomatik "kontrol gerekli" işaretlenir. Uzman seçtiği satırları onaylayıp föye uygular (yeni immutable föy sürümü).

**6) Excel'e uygulama.** Uzman şablon seçer; sistem plaka/başlık eşleşmesini ve yazılacak hücrelerin yalnız izinli "D" sütununda kaldığını doğrular, yedek alır, yalnız o hücreleri yamalar, hash+içerik karşılaştırmasıyla doğrular.

**7) PERT/ağır hasar (varsa).** Eksper kanaati (onarım/pert) ile merkez kararı ayrı, gerekçeli, versiyonlu alanlarda tutulur; oran (hasar/rayiç) yalnız türetilmiş bilgi olarak gösterilir, otomatik eşik/karar yoktur.

**8) Değer Kaybı (Trafik'te zorunlu).** Kaza tarihine göre iki motordan biri (2026-07-01 öncesi: basit piyasa-farkı; sonrası: resmi Excel şablonundan türetilmiş katsayı motoru) hesaplar; emsal/kanıt bağlanır, draft→submit→approve akışıyla onaylanır, immutable nihai PDF rapor üretilir. Kasko'da bu akış API seviyesinde tamamen kapalıdır (`wrong_case_type`).

**9) Kasko kontrolleri (yalnız Kasko).** 7 zorunlu kontrolün her biri (sürücü↔ruhsat, ehliyet 12. alan, poliçe sahibi↔ruhsat, meslek bilgisi, eşdeğer parça klozu, servis muafiyeti, rayiç muafiyeti) kanıt belgesiyle birlikte kullanıcı tarafından kesinleştirilir; hiçbiri bugün AI-önerili değildir (şema hazır, üretici kod yok).

**10) E-posta.** Taslak deterministik şablondan veya (opt-in) AI'den üretilir, kullanıcı onaylar, "Gmail'e Aktar" tarayıcıda dolu bir Gmail compose penceresi açar — uygulama gerçekten e-posta GÖNDERMEZ, yalnız el-teslim kaydı tutar.

**11) Kapanış.** `case-lifecycle` modülü tek bir `requirementSummary()` içinde evrak + kapanış-evrakı (fatura/ibra/taahhütname) + Değer Kaybı (Trafik) + Kasko 7-kontrol gate (Kasko) sonuçlarını birleştirir. Eksik/kontrol-bekleyen varsa normal kapanış `blocked` döner; kullanıcı isterse gerekçeli `with_missing_requirements` modunda (tüm gereksinimler için AYNI mekanizma, Kasko'ya özel sert blok yok) yine de kapatabilir. Onaydan sonra gerçek File Agent job'ı klasörü `KAPALI {Ay} {Yıl}` hedefine taşır; sonuç `case_lifecycle_history`'e (append-only) yazılır.

**12) Kapanma ücreti.** Yalnız kapalı dosya + doğrulanmış `expert_report`'tan, tamamen **elle** girilen bir aday tutar → onay/düzeltme (immutable sürüm) akışı.

**13) Raporlar / Kapanmış Dosyalar.** Dönem raporları, rol bazlı mali görünürlükle (secretary/read_only tutarları göremez, `null`/"Gizli") ve gerçek `.xlsx` dosya envanteri dışa aktarımıyla sunulur.

Her aşamada fail-closed nokta: doğrulanmamış belge kanıt olamaz; kaynak dosya plan zamanından sonra değiştiyse işlem `stale` döner; AI çıktısı kaynakta bulunamayan bir iddia taşırsa reddedilir; kapalı dosyada hemen her modül yazmayı 409 ile reddeder (bir istisna hariç, bkz. §30).

---

## 3. Ana Ekranlar ve Kullanıcı Arayüzü

Frontend `src/app` (routing) + `src/features/*` + `src/components/*` yapısındadır. **Üretim build'i her zaman `api` veri kaynağını kullanır** (`src/data/ports.ts:228-250`, `resolveConfiguredDataSource()` — production'da her zaman `'api'` döner); `mock` mod yalnız geliştirme/test amaçlıdır ve kullanıcıya görünür bir geçiş anahtarı yoktur. `api` modda hata/bağlantı kopması durumunda **hiçbir zaman mock veriye düşülmez** — bu, hemen her ekranda tekrar eden, sistematik bir mimari kural.

Route tablosu (`src/app/App.tsx:36-47`) sidebar ile birebir örtüşür: `/`, `/dosyalar`, `/dosyalar/:caseId`, `/kapanan-dosyalar`, `/raporlar-ve-ucretler`, `/mevzuat-ve-ai`, `/bildirimler`, `/yonetim`, `/ayarlar`. `PlaceholderPage` yalnız eşleşmeyen route'lar (404) için kullanılır — 8 ana nav öğesinin ve 9 dosya-içi sekmenin **hepsinin** gerçek (placeholder olmayan) bir bileşeni vardır; ama aşağıdaki tabloda görüleceği gibi "ekran var" ile "gerçek veriye bağlı" ayrı şeylerdir.

### 3.1 Ana navigasyon

| Ekran | Amaç | Durum |
|---|---|---|
| **Durum Panosu** | Aşamaya göre kanban, arama/filtre, özet şerit (açık/geciken/eksik evrak/bekleyen onay); Bildirimler ile aynı `useOperationalAlerts` hook'unu paylaşan uyarı özeti | `PRODUCTION` |
| **Dosyalar** | Sunucu-taraflı sayfalama/filtre/sıralama, plaka arama (Unicode-normalize), gerçek "Yeni Dosya" modalı (idempotency-key'li), uyarı rozeti sütunu | `PRODUCTION` |
| **Dosya Detayı** | 9 sekme, bkz. §3.2 | karışık, aşağıda |
| **Kapanan Dosyalar** | Üç gerçek uç (closed cases + kapanma ücreti + Değer Kaybı) birleşimi; rol bazlı mali gizleme | `PRODUCTION` |
| **Raporlar ve Ücretler** | Dönem özeti, rol bazlı mali maskeleme, gerçek `.xlsx` dosya envanteri exportu | `PRODUCTION` |
| **Mevzuat ve AI Yardımcısı** | Mock modda tam prototip demo; **api modda `BackendUnavailableState` — hiçbir gerçek backend yok** | `DEFERRED` (production'da) |
| **Bildirimler** | Gerçek türetilmiş operasyonel uyarılar (geciken görev/takip, eksik zorunlu evrak); salt-okunur liste | `PRODUCTION` |
| **Yönetim** | 5 sekme, bkz. §3.3 | karışık |
| **Ayarlar** | Tema/yoğunluk/sidebar gerçek ve kalıcı (`localStorage`); "Sistem Durumu" kutusu (`Backend: Eklenmedi` vb.) api modda bile **sabit metin** — erken prototip kalıntısı | `PARTIAL` |

### 3.2 Dosya Detayı — 9 sekme

| Sekme | Trafik/Kasko | Durum |
|---|---|---|
| Özet | ortak | `PRODUCTION` (araç profili + sahipler + klasör kurulum paneli) |
| Operasyon | ortak | `PRODUCTION` (not/görev/takip geçmişi) |
| Evrak ve Fotoğraf | ortak temel + Kasko ek | `PRODUCTION`; Kasko'da aynı sekme altında poliçe metin/OCR/analiz + 7-kontrol paneli **eklenir** (yeni üst-seviye sekme değil) |
| İşçilik | ortak | `PRODUCTION / MANUAL STEP` (gerçek `.xlsx` yazımı onay gerektirir) |
| Ağır Hasar (PERT) | ortak | `PRODUCTION` |
| Değer Kaybı | **yalnız Trafik gerçek akış** | Trafik: `PRODUCTION / MANUAL STEP`; Kasko: `DEFERRED` ("Kasko değer kaybı bu akışta desteklenmiyor" — kodun kendi mesajı) |
| Raporlar ve Ücretler | ortak | `PRODUCTION / MANUAL STEP` |
| E-postalar | ortak | `PRODUCTION / MANUAL STEP` (Gmail web handoff, gerçek gönderim yok) |
| Geçmiş | ortak | `DEFERRED` — api modda `"Bu modül henüz gerçek API verisine bağlı değildir"`, kullanıcı Operasyon sekmesine yönlendirilir (backend'de `case_lifecycle_history` tam var ama hiçbir UI onu listelemiyor) |
| *(sağ rail)* Dosyaya özel AI Asistanı | ortak | `DEFERRED` — api modda "henüz bağlı değil" |

### 3.3 Yönetim — 5 sekme

| Sekme | Durum |
|---|---|
| Kullanıcılar | admin: gerçek rol güncelleme (`PATCH /users/:id/roles`) — `INTERNAL/ADMIN`; diğerleri: salt-okunur referans listesi — `PRODUCTION`. **Yeni kullanıcı oluşturma ekranı/uç noktası hiç yok** (bkz. §17) |
| Servisler | Gerçek referans listesi | `PRODUCTION` |
| Excel Şablonları | Versiyonlu sütun-eşleme profilleri (kendisi hiç Excel yazmaz) | `INTERNAL/ADMIN` |
| Belge Kuralları | Statik, hardcoded JSX — hiçbir port'a bağlı değil | `PARTIAL` |
| Erişim ve Yetki | Sunucu rol sabitlerinin **elle bakımı yapılan** bir aynası (kodun kendi yorumu: "sunucudaki sabit değişirse bu satır da güncellenmelidir") | `PARTIAL` |

**Rol tabanlı UI kısıtları** her yerde `useSession().user.roles` ile kontrol edilir ama bunlar yalnız görünürlük — gerçek yetki her zaman sunucuda (bkz. §17).

---

## 4. Dosya Takip Sistemi

- **Kimlik:** `caseId` (uuid), plaka yalnız arama/eşleştirme alanı. Ofis numarası üretimi ve reopen'da korunması §2'de anlatıldı.
- **Lifecycle:** `lifecycle_status` (open/closed) ile `workflow_stage` (10 açık aşama + closed) ayrı eksenler; DB CHECK ikisinin tutarlılığını zorlar.
- **Arama:** Çok kelimeli AND arama; her token hem Unicode-normalize plakaya hem ofis-no/ihbar-no/poliçe-no'ya `ILIKE` ile uygulanır (`services/api/src/cases/store.ts:110-123`).
- **Filtre/sıralama:** Tür/durum/aşama/sorumlu/servis/takip-tarihi filtreleri; sıralama `updatedAt|followUpDate|officeCaseNumber|plate`, `NULLS LAST`, deterministik tie-break.
- **Master/detail:** `GET /cases` (liste) + `GET /cases/:caseId` (detay), salt-okunur, tenant-sınırlı.
- **Kritik işlem modeli:** AGENTS.md §7'deki 7 adımlı model (Planla→Önizle→Onay→Uygula→Doğrula→Kesinleştir→Audit) close/reopen akışında **birebir kodda uygulanmış** — her adım ayrı bir fonksiyon/route'a karşılık gelir (`case-lifecycle/store.ts` `planClose/planReopen→approve→` File Agent job → `agent/store.ts:888-960` `finalizeLinkedLifecycle`). Tek eksik: `cancel()` işlemi merkezi audit'e kayıt üretmiyor (küçük, düşük etkili bir boşluk).
- **Kapalı dosyada yasak işlemler:** case-operations (not/görev), documents, fees, case-inventory, case-vehicle-owners/profile, kasco-mandatory-check, pert, labor/labor-ai, email-drafts/email-ai, traffic-value-loss — hepsi `lifecycle_status` kontrolüyle 409 döner. Temel `cases` alan güncelleme uç noktası (`PATCH /cases/:caseId` — sorumlu/servis/takip tarihi/workflow_stage) daha önce `lifecycle_status`'u hiç kontrol etmiyordu; **HB-2026-198 ile düzeltildi** — `updateCase()` artık case satırını kilitlerken (`FOR UPDATE`) `lifecycle_status`'u da okuyor, `open` değilse diğer tüm modüllerle AYNI 409 `conflict`/"Closed cases cannot be updated." sözleşmesiyle reddediyor (alanlar ezilmez, sahte audit kaydı oluşmaz); gerçek Postgres+HTTP testiyle doğrulandı (`cases-write.test.ts`).
- **Geçmiş/audit:** `case_lifecycle_history` (append-only, DB trigger korumalı) her close/reopen'da bir satır; ilgili audit action'ları `case_lifecycle.close_planned/close_blocked/close_with_missing_requirements/reopen_planned/stale/close_approved/reopen_approved/closed/reopened/manual_recovery_required/failed`.

---

## 5. Belge ve Dosya Yönetimi

**Kullanıcı için basit anlatım:** Fiziksel dosyalar (PDF, Excel, fotoğraf) veritabanında değil, gerçek bir Windows klasöründe durur; veritabanı yalnız "hangi klasörde, hangi göreli yolda" bilgisini tutar. Bu klasöre asla API doğrudan yazmaz — yazma işini her zaman ayrı, kendi Windows servisi olarak çalışan **File Agent** yapar, ve her yazmadan önce "bu dosya gerçekten güncel mi" diye bir tazelik kontrolünden geçer.

**Teknik model:**

- **`storage_roots` + `rootKey` + göreli yol:** DB'de mutlak yol kolonu YOK, yalnız mantıksal `root_key`. Cihaz→mutlak yol eşlemesi yalnız File Agent'ın yerel `HASARBOTU_AGENT_ROOTS` ortam değişkeninde — DB/audit/log'a asla yazılmaz.
- **Güvenli yol — 3 katmanlı savunma:** domain `parseRelativePath()` (`..`, mutlak yol, UNC, kontrol karakteri, Windows yasak isim reddi) → aynı kural DB CHECK'inde tekrarlanır (savunma-derinliği) → File Agent'ın kendi `resolveUnderRoot()`/`assertRealPathUnderRoot()` (gerçek `realpath` ile symlink/junction kaçışını da engeller).
- **Job/lease sistemi:** PostgreSQL tabanlı kuyruk, `FOR UPDATE SKIP LOCKED` claim, lease+heartbeat, üstel backoff, terminal hata kodlarında anında dead-letter.
- **Session-0 freshness gate (neden var):** `P:\` bir pCloud sanal sürücüsüdür, Windows servisleri Session 0'da çalışır ve sürücü harfleri normalde oturuma bağlıdır. Gate, `P:\`'ye SIFIR bağımlılık ile üç girdiden (pCloud'un yerel SQLite DB'si, hedef NTFS ağacı, ayrı admin-üretimli SHA-256 attestation deposu) her dosya için `ready/syncing/unknown/conflict` üretir; **tek bir `unknown`/`conflict` bütün vakayı bloklar.** Her hata yolu fail-closed `ready:false` döner.
- **Identity fence:** hash hesaplama gibi uzun I/O işlemlerinden hemen ÖNCE ve SONRA kaynağın kimliğini (fileId/hash/boyut) yeniden doğrulayan tekrarlayan bir desen — hesaplanan hash'in I/O sırasında değişen bir dosyaya ait olmadığını garanti eder.
- **Ready/syncing/conflict/unknown:** §4'te tarif edilen 4 durum; `CaseStatus` = tüm dosyaların en kötüsü.
- **Extra/unknown dosyalara yaklaşım:** D9 per-case reconciliation motoru bulduğu her şeyi `stale_target/rename_artifact/unknown` olarak SINIFLANDIRIR ama **hiçbir zaman otomatik silmez/taşımaz** — gerçek silme yalnız ayrı bir admin CLI aracıyla, açık `-Apply` onayıyla, yalnız kanıtlanmış `rename_artifact`/`stale_duplicate` için yapılabilir.
- **`MANUAL_DRIFT_DETECTED`:** kullanıcı Windows Explorer'dan elle taşırsa, hedef zaten varsa ve içerik uyuşmuyorsa File Agent kaynağı OLDUĞU GİBİ BIRAKIR, otomatik hiçbir şey silmez/taşımaz — `manual_recovery_required` döner.
- **Neden API doğrudan yazmıyor:** `services/api/src` içinde gerçek `node:fs` çağrısı yalnız bir statik-referans-veri okuma noktasında var; tüm fiziksel `mkdir/rename/copy/hash` çağrıları yalnız `services/file-agent/src/*` içinde. API bir job INSERT eder, File Agent claim edip gerçek işi yapar, sonucu API'ye raporlar — **API agent'ın "doğru yaptım" beyanına güvenmez**, gözlenen hash/boyutu kendi kayıtlı değeriyle yeniden karşılaştırır.

**Fail-closed koşullar (özet tablo):** yapılandırılmış kök tamamen erişilemezse yeni iş claim edilmez; kök yazılamıyorsa (yalnız `lstat` değil, gerçek işaretçi-dosya yaz/sil testi) iş başarısız+retry; freshness gate `ready` demiyorsa kritik iş `case_not_fresh`; path-traversal/symlink reddi; manuel drift'te kaynak korunur; plan sonrası kaynak değiştiyse `source_changed_since_plan`.

---

## 6. AI İşçilik Sistemi

İki AYRI mekanizma var: **labor-ai** (Paket 44 — boş föyden ilk satır önerisi, sığ incelendi) ve **labor-allocation-ai** (Paket 54+ — mevcut föyün satırlarını operasyon türü + işçilik branşına kanıt temelli dağıtır, checklist'in odağı, en olgun AI özelliği).

| Madde | Durum ve kanıt |
|---|---|
| **Öneri üretimi** | Kanıt sırası: föy satırları → org sözlüğü (en çok kullanılan 50 açıklama/işlem) → onaylı geçmiş → eksper baseline (bir önceki immutable föy sürümü) → araç profili → PII-minimize dış bağlam. Gemini adaptörü (`gemini-provider.ts`, `responseJsonSchema` zorlamalı, 3 opt-in kapı: deploy env + org politika + kullanıcı egress-onayı) kodda tam yazılmış, test edilmiş **ve artık `services/api/src/server.ts`'e gerçekten bağlı** (HB-2026-198 ile düzeltildi, bkz. §16.3). Bu ortamda hâlâ hiçbir `GEMINI_LABOR_ALLOCATION_*` env değişkeni açılmadığı için sağlayıcı registry'si BOŞ — sistem artık bunu dürüstçe `provider_disabled` olarak raporluyor; düzeltme öncesi bu durumda kullanıcıya sessizce dahili bir test-fixture'ının (`deterministic-success`, her zaman `controlRequired:true`, sabit %55 güven) çıktısı gerçek AI cevabıymış gibi sunuluyordu. |
| **Kategoriler/toplamlar** | 8 sabit kategori (bodywork/mechanical/electrical/upholstery_lock/glass/calibration/repair/paint); sunucu toplamı işçilik tutarına eşitler, negatif/ondalık reddeder | `PRODUCTION` |
| **Provenance/evidence/confidence** | `evidence_refs text[]`, `confidence numeric(5,4)`, `reasoning text` — yalnız bağlamda var olan çapa kimlikleri, serbest metin değil | `PRODUCTION` |
| **Missing evidence** | 6 kapalı kod (araç kimliği/parça kodu/hasar bölgesi/onaylı geçmiş/sözlük eşleşmesi/eksper baseline eksik) — sunucu tarafında gerçek veriye göre hesaplanır, modelin beyanına bırakılmaz | `PRODUCTION` |
| **Conflict kodları** | İki eksen (operasyon: 6 kod, kategori: 5 kod); baseline/history çelişkisi sunucuda ZORUNLU kılınır, model bildirmese de eklenir; herhangi bir çelişki → `controlRequired=true` | `PRODUCTION` |
| **Baseline/history** | Baseline = aynı dosyanın bir önceki immutable föy sürümü (yeni tablo değil); history = yalnız GERÇEKTEN uygulanmış (`completed`) kayıtlar, çelişenler otomatik elenir | `PRODUCTION` |
| **"Expert-learning"** | Gerçek ML/fine-tuning YOK — deterministik retrieval + tutarlılık filtresi (isim yanıltıcı olabilir) | `PRODUCTION` (kural tabanlı) |
| **Manuel kategori girişi** | AI dağılımı yoksa panel hiçbir otomatik değer üretmez, tamamen boş/kullanıcı girdisi | `PRODUCTION` |
| **proposed/current/modified** | Üç AYRI fiziksel alan seti (`suggested_*`/`applied_*`/`modified` bool, DB CHECK ile snapshot tutarlılığı zorunlu) — tek alan+status değil | `PRODUCTION` |
| **Validation** | 3 katman (client/server/DB): negatif/NaN/tam-sayı-olmayan (kuruş altı) reddi; toplam uyuşmazlığı hem AI çıktısında hem uygulamada hem DB CHECK'te ayrı ayrı zorlanır | `PRODUCTION` |
| **Excel preflight** | Plaka/ofis-no hücre doğrulama; **"D sütunu" dışı her hücre reddedilir**; hücrede formül varsa reddedilir; makro/dijital-imza/harici-bağlantı/gömülü-nesne/zip-bomb/zip-slip taraması (10+ kapalı kod); OOXML okuyucu gerçekten salt-okunur (497 satır incelendi, hiçbir `fs.write` yok) | `PRODUCTION` |
| **Backup/apply/verify/hash** | `COPYFILE_EXCL` ile yedek + geri-okuma doğrulaması → yalnız hedef sheet'i yamalayan patch → atomic rename → post-replace hash doğrulama → başarısızlıkta otomatik yedekten rollback (rollback'in kendisi başarısız olsa bile dürüstçe raporlanır) | `PRODUCTION` |
| **File Agent job zinciri** | preview job → kullanıcı onayı → apply job → server bağımsız `RESULT_HASH_MISMATCH` kontrolü; gerçek uçtan uca UAT ile kanıtlı (kullanıcının düzelttiği tutarın — AI'nin önerdiği değil — doğru hücreye yazıldığı, çevre hücrelerin byte-birebir korunduğu bağımsız doğrulandı) | `PRODUCTION` |

**Sade özet ("AI önerdi → kullanıcı kontrol etti → Excel'e uyguladı"):** Uzman föyü girer, "Analiz Et" der; sistem geçmiş onaylı örnekleri ve varsa bir önceki föyü kanıt olarak kullanarak her satırı işlem türüne ve branşa böler, güven yüzdesi+gerekçe ekler. Kanıt yetersizse satır otomatik "kontrol gerekli" işaretlenir, toplu onaylanamaz. Uzman her satırı tek tek görür, isterse değiştirir (AI önerisi ile kullanıcı değeri yan yana durur), yalnız seçtiği satırları föye uygular. Sonra Excel şablonu seçilir; sistem doğru workbook olduğunu ve yazılacak hücrelerin izinli sütunda kaldığını kontrol eder, yedek alır, yalnız o hücreleri değiştirir, hem hash hem içerik karşılaştırmasıyla doğrular.

---

## 7. Değer Kaybı Sistemi

**İki eş zamanlı motor, aynı persistence katmanını paylaşıyor:**

| | Legacy (Paket 32) | Real-market (Paket 66) |
|---|---|---|
| `rule_set_id` | `traffic-value-loss-market-difference` | `real-market-analysis` |
| `rule_version` | `2026.07.01.1` | `real-market-analysis/2026-07-01/1.0.0` |
| Yöntem | `max(0,kazaÖncesi-onarımSonrası)×kusurPuanı/10000` | Yaş×kullanım×genel-modifiyer×parça×hasar-katsayısı×araç-çarpanı, BigInt exact-rational, %30 tavan |
| Ne zaman seçilir | kaza tarihi **2026-07-01'den önce** | kaza tarihi **2026-07-01 ve sonrası** (bugünün fiili çoğunluğu) |

**"01.07.2026 yaklaşımı" gerçekte ne:** Migration 0043 hesap mantığını içermiyor — yalnız DB'deki immutable rule-identity allowlist'ini yeni motoru kabul edecek şekilde **eklemeli** genişletiyor (eski motor kaldırılmıyor). Gerçek katsayı motoru, ofisin resmi Excel şablonundan (`Yeni Dönem Değer Kaybı Hesaplama Modülü 01.07.2026 V_1.xlsx`, SHA-256 doğrulanmış) OOXML seviyesinde salt-okunur çıkarılmış bir JSON snapshot'a dayanır. **Operasyonel not:** bu referans-veri dosyası derlenmiş `dist/`'in dışında durur, normal deploy akışının parçası değildir — ayrı, hash-doğrulamalı bir provisioning aracıyla (gerçekten `-Apply` edilmiş, HB-2026-175) her yeniden kurulumda tekrar sağlanmalıdır.

- **Kanıt/emsal:** yalnız doğrulanmış belge veya `https://`/`ref:` harici referans; preview→create arasında canonical-hash eşleşmesi zorunlu (kullanıcı önizlemeyi görmeden kayıt yapamaz).
- **Anomali tespiti:** runtime "şüpheli veri" tespiti YOK — bulunan "anomali" kavramı kaynak Excel'in kendi 15 forensic bozukluğunun (döngüsel hata, ters sıralı tablo vb.) audit amaçlı snapshot'a taşınmasıdır.
- **Onay/kesinleştirme:** draft/control_required → submit (yalnız `canSubmitForApproval`) → awaiting_approval → approve/reject (yalnız admin/expert); approved sürüm immutable, önceki approved otomatik `superseded`.
- **Nihai rapor:** yalnız approved+aktif sürümden, immutable PDF, sunucuda bellekte üretilir, indirmede aynı snapshot'tan yeniden üretilip hash doğrulanır.
- **Kapanış entegrasyonu:** yalnız güncel sürüm approved VE aynı sürüme ait bir final rapor varsa `present`; aksi `control_required`.
- **`control_required`:** eligibility belirsizliğinde (eksik kimlik, <3 emsal/taraf, 30 günü aşan/±%10 km dışı emsal, doğrulanmamış kanıt) hem evaluation hem persistence seviyesinde set edilir; bu durumdaki sürüm asla submit/approve/rapor/kapanış zincirine giremez.
- **Trafik zorunlu / Kasko isteğe bağlı — gerçek davranış:** Backend `store.ts` içinde `case_type!=='traffic'` iken **hard-block** (`wrong_case_type`) — Kasko dosyası için bu modülün gerçek API'si kullanılamaz. "Kasko'da isteğe bağlı" kavramı yalnız (a) kapanışı hiç bloklamayan bir `not_applicable` durumu ve (b) işlevsiz bir mock-UI mesajı olarak var; **gerçek, çalışan bir "Kasko'da isteğe bağlı hesapla" özelliği yok.** `CASCO_POLICY_CANONICAL_MODEL.md`'de tanımlı `valueLossOfficePolicy` alanı bu modül tarafından hiç okunmuyor.

---

## 8. Kasko Zorunlu Kontrol Sistemi

En yeni büyük özellik (migration `0045`). Tüm 7 kontrol **tek, jenerik bir motor** üzerinden çalışır (`packages/domain/src/kasco-mandatory-check.ts`, `evaluateSingleCheck`) — kontrole özel iş mantığı yoktur, yalnız `kind` (comparison/presence) ve `validResults` alt kümesi değişir.

**Ortak durum makinesi:** `confirmedResult=null`→**missing** · `unclear/unknown`→**control_required** · kesin sonuç ama kanıt-belgenin güncel sürümü değiştiyse→**needs_review** (her `GET`'te canlı hesaplanır, saklanmaz) · kesin sonuç+güncel kanıt→**resolved**.

**Kanıt modeli (7 kontrolün hepsi için ortak):** `documentId+documentVersionId+page+section+excerpt`; sunucu yalnız belgenin bu case'e ait, doğrulanmış (`ready+hashVerified+sizeVerified`) olduğunu kontrol eder — **`document_type`'a bakmaz** (yani teorik olarak yanlış türde bir belge kanıt olarak bağlanabilir, doğru tür seçimi kullanıcı sürecine bırakılmış). DB CHECK, kesin sonuç (`same/different/present/absent`) için kanıt belgesini **zorunlu** kılar — "poliçe tamamı okunmadan kloz yok" kuralının en alt katmanı.

| # | Kontrol | Kind | Doğal kaynak belge | AI-destekli mi |
|---|---|---|---|---|
| 1 | Sürücü ↔ ruhsat sahibi | comparison (same/different/unknown) | Ruhsat + sürücü kimliği | **HAYIR** |
| 2 | Ehliyet 12. alan/kod/kısıtlama | presence (present/absent/unclear) | Ehliyet — sistem kod listesini yorumlamaz, yalnız var/yok/belirsiz | **HAYIR** |
| 3 | Poliçe sahibi/sigortalı ↔ ruhsat sahibi | comparison | Poliçe + ruhsat | **HAYIR** |
| 4 | Meslek bilgisi | presence | Poliçe/beyan (serbest) | **HAYIR** |
| 5 | Eşdeğer parça klozu | presence | Poliçe | **HAYIR** |
| 6 | Servis muafiyeti | presence | Poliçe | **HAYIR** |
| 7 | Rayiç bedeli genel muafiyeti | presence | Poliçe | **HAYIR** |

**Kritik dürüst bulgu:** `ai_suggested_result/ai_confidence_basis_points/ai_evidence_*` kolonları migration 0045'te TANIMLI ve UI'da "AI önerisini forma al" butonu VAR — ama hiçbir yerde (INSERT/UPDATE) yazılmıyor. DECISION_LOG bunu açıkça "bu turda kapsam dışı" olarak kaydediyor. Bu, ölü ama zararsız bir UI dalı.

**Kontrol 5-7 ile Poliçe Analizi arasında kavramsal örtüşme var** (`policy_part_rules`, `policy_service_rules`, `policy_deductibles` zaten bu bilgiyi tutuyor) **ama hiçbir kod bu iki sistemi birbirine bağlamıyor** — DECISION_LOG bunu "teknik olarak mümkündü, zaman baskısı altında bilinçli ertelendi" diye kaydediyor.

**7/7 tamamlanmadan ne engelleniyor:** `case-lifecycle` kapanış planı, Kasko-gate sonucunu `missing`/`control_required` sayaçlarına dahil eder; normal (`closeMode='normal'`) kapanış `blocked` döner. **Ama bu koşulsuz bir sert blok değil** — tüm diğer kapanış gereksinimleriyle (evrak, Değer Kaybı) AYNI `with_missing_requirements` override mekanizmasına tabidir (gerekçeli, uyarılı). Ayrı bir "final rapor gate"i yok — aynı case-lifecycle akışı üzerinden yürür.

**Trafik etkilenmiyor — kanıt:** hem domain (`isKascoMandatoryCheckApplicable(caseType)==='casco'`) hem yazma katmanında (`case_type!=='casco'`→409) iki bağımsız kontrol var; Trafik'te 7 kontrolün hepsi otomatik `not_applicable`.

**Kapalı dosyada yazma reddi:** `lifecycle_status!=='open'`→409 `case_closed`.

**İzin:** okuma tüm roller; yazma `admin/expert/case_manager`. **Audit:** `kasco_mandatory_check.confirmed` + ayrı append-only `kasco_mandatory_check_confirmations` geçmiş tablosu.

**Test kanıtı:** `services/api/test/kasco-mandatory-check.test.ts` (13 test, gerçek Postgres+HTTP) — gate/kanıtsız-red/kind-uyumsuzluk/needs_review-tetikleme/yetki/Trafik-red/kapalı-dosya hepsi kapsanmış; PROJECT_STATUS'ta "api 516 test, 78 dosya, tüm Kasko E2E dahil — 7/7 fail-closed kapanış engeli" olarak 2026-08-09'da yeniden doğrulandığı kayıtlı.

**Frontend konumu:** yeni üst-seviye sekme DEĞİL — "Evrak ve Fotoğraf" sekmesi altında, poliçe metin/OCR/analiz modüllerinden sonra.

---

## 9. PERT / Ağır Hasar

Saf, deterministik, **eşiksiz** bir doğrulama katmanı — hiçbir otomatik "toplam hasar" eşiği yok.

- **9 süreç durumu:** `review_not_started→data_missing→under_review→repair_indicated→pert_candidate→expert_opinion_issued→center_decision_pending→repair_decided→pert_decided`.
- **Üç alan kasıtlı ayrı:** AI önerisi (**bu pakette hiç yok**, DECISION_LOG'da açık karar), eksper kanaati (`repair|pert`+zorunlu gerekçe), merkez kararı (`repair|pert`+not, yalnız ilgili durumla eşleşirse kaydedilir).
- Hasar/rayiç oranı yalnız türetilmiş bilgidir, saklanmaz, her okumada yeniden hesaplanır — otomatik karar yok.
- **Persistence:** case başına 1 aggregate → immutable append-only versiyonlar (DB trigger korumalı).
- **Model farkı:** Değer Kaybı'nın aksine ayrı bir submit/approve/reject uç noktası YOK — tek-aktörlü, versiyonlu "create/revise" modeli (maker-checker değil).
- **İzin:** yazma `admin/expert/case_manager` (sekreterlik kapsamı dışı — kod yorumu: "PERT kanaati eksper/yönetim işidir"); kapalı dosyada salt-okunur.
- **Kapanışla ilişkisi: BULUNAMADI** — `case-lifecycle` içinde PERT'e gerçek bir referans yok; Değer Kaybı ve Kasko'nun aksine PERT değerlendirmesi kapanışı hiçbir şekilde bloklamıyor/gerektirmiyor.
- **Test:** domain testleri (kanaat-gerekçesiz-red, merkez-kararı-tutarlılığı) + API testleri (401/tenant/yetki/idempotency/audit-sızıntısız) + ayrı bir uçtan-uca UAT senaryosu (`pert-uat-e2e.test.ts`).

---

## 10. Poliçe Analizi

Bu **AI motoru değil** — versiyonlu, onaylı, kanıt-doğrulamalı bir **persistence + workflow** katmanıdır; kanonik alanları (coverages/deductibles/service-part-rules/replacement-vehicle/exclusions/required-documents/scenario-rules) insan veya Poliçe AI promotion akışı doldurur.

- **Poliçe OCR (gerçek, yerel, bulut değil):** `pdfjs-dist` render → Otsu eşikleme → **Tesseract.js** (tur+eng, hash+boyut pinlenmiş dil paketleri) → okuma-sırası yeniden inşası → güven-tabanlı kalite sınıfı. Worker-thread izolasyonu, ağ-erişimi-engelleme kontrolü, PDF magic-byte doğrulaması. API tarafı her chunk'ın hash/offset/bbox'ını **yeniden hesaplayıp** karşılaştırır — File Agent'ın "uydurduğu" bir OCR sonucu kabul edilmez.
- **Poliçe AI (gerçek Gemini + OpenAI, production'a bağlı — bkz. §16):** candidate→review(accepted/edited/rejected/control_required)→promotion (yalnız tüm adaylar review edilmiş VE en az bir kabul/düzenleme varsa mümkün) akışı. Promotion, doğrudan `policy_analyses`/`policy_analysis_versions`/`policy_source_references`/`policy_conflicts` tablolarına yazar — yani Poliçe AI, Poliçe Analizi'nin gerçek, canlı bir girdi yoludur.
- **Hallucination/fail-closed koruma (kod seviyesinde, en sıkı sistemlerden biri):** AI'nin iddia ettiği `originalValue`, kaynak metinde kelime-sınırlı tam alt-dize olarak bulunmuyorsa aday **düşer** (insan onayına bile gitmez); prompt-injection deseni (ör. "ignore previous instructions") tespit edilirse o kaynağa dayanan her aday `control_required`'a düşer; sağlayıcı uydurma bir kaynağa atıf yaparsa `AI_EVIDENCE_INVALID`.
- **Versiyon durumları:** `draft|extracted|control_required|conflict_detected|awaiting_approval|approved|superseded|rejected|failed`; onay yalnız `admin/expert` (case_manager hariç — Kasko 7-kontrolden daha dar).
- **Senaryo motoru:** yalnız approved+insan-onaylı sürümler kullanılabilir; sonuç `covered|excluded|conditional|control_required|unknown`.
- **Evidence formatı:** `documentId+documentVersionId+pageNumber+sectionHeading+clauseIdentifier+rawExcerpt+excerptHash(sha256)+locator+confidence`.
- **Poliçe Analizi ↔ Kasko 7-Kontrol:** §8'de belirtildiği gibi **bağlantı yok**, bilinçli erteleme.

Durum: OCR `PRODUCTION`; Poliçe Analizi çekirdeği `PRODUCTION / MANUAL STEP`; Poliçe AI `PRODUCTION / MANUAL STEP` (gerçek Gemini+OpenAI, `services/api/src/server.ts:106`'da fiilen bağlı — labor-ai'nin aksine).

---

## 11. E-posta Sistemi

**Gerçek Gmail OAuth/API entegrasyonu ve gerçek gönderim KESİN YOK.** Kanıt zinciri kesin: DB CHECK yalnız `provider='gmail_web'`i kabul eder; `buildGmailComposeUrl()` yalnız kimlik doğrulaması gerektirmeyen genel bir `mail.google.com/mail/?view=cm...` URL'si üretir; `window.open()` düz bir tarayıcı sekmesi açar; `deliveryStatus` kodda HER ZAMAN `'not_sent'`; UI'da kullanıcıya açıkça gösterilen metin: *"Uygulama e-posta göndermez ve gönderimi doğrulamaz."* Repo genelinde `gmail|googleapis|OAuth2|nodemailer|IMAP|SMTP` taraması sıfır ilgili sonuç veriyor. DECISION_LOG (HB-2026-047/048) bunu açıkça kapsam dışı bırakıyor; ROADMAP.md "gelen e-posta/Gmail API" için hâlâ "Bekliyor" diyor.

- **Mail-dosya eşleştirme:** ters yönde çalışır — gelen postayı dosyaya eşleme YOK; her taslak zaten bir `caseId`'ye bağlı olarak, 11 sabit Türkçe taslak türünden (ofis no+plaka+eksik evrak kodlarından deterministik) üretilir.
- **AI taslak üretimi:** plan(salt-okunur)→gizlilik/bütçe paneli→açık egress-onay→start→katı çıktı doğrulama→review→**hâlâ kaydedilmemiş**→ayrı save-onayı. Kanıt PII-minimize edilmiş (adres/e-posta/IBAN/ad/telefon/plaka/TCKN/VKN maskeli); çıktı PII/URL/dosya-yolu sızıntısı için taranır, biri varsa öneri reddedilir. Gerçek sağlayıcı yalnız Gemini (OpenAI yok — Poliçe AI'den farklı); varsayılan KAPALI (`email_enabled=false`), 3 bağımsız manuel kapı gerekir.
- **Kullanıcı onayı zorunlu:** her adımda ayrı checkbox (`createConfirmed`/`revisionConfirmed`/`aiEgressConfirmed`/`handoffConfirmed`).
- **"Cevapsız mail takibi" ve "otomatik ihbar" (mail'den dosya açma): KESİN YOK** — kodda, testte ve plan belgelerinde bu isimle/anlamla hiçbir özellik bulunamadı; ROADMAP'te yalnız ayrıntısız, kilitlenmemiş bir "gelen e-posta" genel kalemi var.
- **İzin:** taslak/handoff yazma `admin/expert/case_manager/secretary`; AI başlatma `admin/expert/case_manager` (secretary hariç).

Durum: taslak üretimi `PRODUCTION`; Gmail handoff `PRODUCTION / MANUAL STEP`; gerçek gönderim/gelen-mail/cevapsız-takip/otomatik-ihbar `DEFERRED`/**yok**.

---

## 12. Notlar, Görevler ve Koşullu Evrak Kuralları

- **`case_notes`** (append-only, `internal`/`contact` tür) ve **`case_tasks`** (`open→completed|cancelled` tek yönlü, DB trigger ile zorunlu, kimlik alanları immutable) — bkz. §4.
- **Koşullu evrak kontrolü (`document-requirements`):** saf/deterministik motor, sürümlü kural seti (`document_rule_versions`, ilk sürüm `2026.07.14.1`). Trafik base: trafik poliçe/SBM ağır hasar/ruhsat/ehliyet; Kasko base: kasko poliçe/SBM/K-ruhsat/K-ehliyet. **Zabıt/KTT/Beyan/Tramer alternatif-grup mantığı:** Zabıt varsa KTT+Beyan `not_applicable`; yoksa KTT VEYA Beyandan biri yeterli. **Rücu (Kasko):** `recourseStatus='unknown'` iken otomatik eksik ÜRETİLMEZ, `control_required` döner (AI tahmini kullanılmaz ilkesi). Bir belge yalnız `ready+hashVerified+sizeVerified+verifiedAt` ise "mevcut" sayılır.
- **Takip tarihi geçmişi:** `case_follow_up_history` (append-only).
- Kapalı dosyada tüm bu modüller 409 döner.

---

## 13. Kapanış Sistemi

`case-lifecycle` modülü, kapanış planını tek bir `requirementSummary()` fonksiyonunda birleştirir: her zaman ekspertiz raporu + ön rapor + onarım fotoğrafları; `hasService` ise fatura; servis `authorized` veya sigortacıya-özel `agreed` ise (belirsizse `control_required`) İbra/Taahhütname; Trafik'te her zaman Değer Kaybı özeti; Kasko'da her zaman 7-kontrol gate özeti. `summary.missingCount+controlRequiredCount>0` ise normal kapanış `blocked`; kullanıcı gerekçeli `with_missing_requirements` modunda yine de kapatabilir (TÜM gereksinim türleri için aynı, tek-tip mekanizma — Kasko'ya özel sert blok yok).

Onaydan sonra gerçek File Agent job'ı klasörü `KAPALI {Ay} {Yıl}` hedefine taşır (Türkçe ay adı büyük harf); finalize adımı case'in plan zamanından beri değişmediğini yeniden kontrol eder (aksi `manual_recovery_required`); sonuç `cases` UPDATE + append-only `case_lifecycle_history` INSERT ile kesinleşir. `case_lifecycle_operations.requirement_snapshot` (JSONB) o anki tam kanıt görüntüsünü donduruyor — yeniden hesaplanmaz.

**Kapalı dosya kısıtları:** §4'te belirtilen 10+ modülde 409; temel `cases` alan güncellemede guard eksik (§30).

**Backend'de tam ama frontend'de görünmeyen bir immutable geçmiş var:** `case_lifecycle_history` var, ama Dosya Detayı'nın "Geçmiş" sekmesi bunu göstermiyor — kullanıcı Operasyon sekmesine yönlendiriliyor, orada da yalnız not/görev/takip var (close/reopen geçmişi değil).

---

## 14. Ücret ve Raporlama

- **Kapanma ücreti:** `fee_records`/`fee_record_versions` (append-only sürümler). Gerçek DB status enum'u yalnız 3 değer: `control_required|approved|corrected` — DOMAIN_RULES.md'nin tarif ettiği "Rapor Bulunamadı/Tutar Bulunamadı/Birden Fazla Aday" gibi ek durumlar kodda AYRI status değeri olarak yok; bunun yerine ayrı bir "eligibility reason code" mekanizması var. **Tutar tamamen elle girilir** — hiçbir OCR/AI/regex ile PDF'ten tutar çıkarma yok. Kaynak zorunluluğu: yalnız kapalı dosya + doğrulanmış `expert_report`.
- **Rol bazlı mali görünürlük (HB-011):** `FINANCIAL_READ_ROLES=admin/expert/case_manager/accounting` — **secretary ve read_only hariç**. Dönem raporu ucu herkese açık ama içindeki mali alanlar `capabilities.canView` bayrağına göre `null`/"Gizli" olarak maskelenir (asla `0` değil).
- **Aylık rapor:** `GET /reports/case-summary?period=YYYY-MM`, Trafik Değer Kaybı özet sayaçlarıyla entegre.
- **Gerçek export:** Dosya Envanteri (`case-inventory`) için VAR — gerçek, elle yazılmış minimal `.xlsx` (OOXML, telefon sütunu yalnız yetkili rollerde). **Ücret/dönem raporu için gerçek export YOK** — API-bağlı ekranda export butonu hiç render edilmiyor; yalnız mock modda kozmetik bir "Excel Taslağı" toast'ı var.

---

## 15. Mevzuat ve Mevzuat AI

**Gerçek backend KESİN YOK.** `services/api/src` genelinde "legislation"/"mevzuat" için tek eşleşme ilgisiz bir dosyada; ne tablo, ne migration, ne route, ne contract şeması var. `packages/domain/src/ids.ts`'teki `LegislationSourceId` markalı tip **hiçbir yerde kullanılmıyor** (proje kendi kaydında da "ölü kod" diye işaretlemiş). DECISION_LOG HB-2026-054/055: *"Mevzuat ekranı karantinada kalmaya devam eder"* — bilinçli, açık ürün kararı. ROADMAP.md: v0.11 Mevzuat = "Bekliyor".

Frontend: mock modda 6 sabit kayıttan istemci-içi filtre + tamamen sabit metin döndüren "Mock Soru-Cevap" (`ask()` fonksiyonu hiçbir fetch/AI çağrısı yapmaz); **api modda `BackendUnavailableState` — "Mevzuat kaynak kütüphanesi henüz yapılandırılmadı."** Retrieval/embedding/vector-arama konusu geçersiz çünkü aranacak bir backend/corpus hiç yok (repo genelinde hiçbir vector-DB bağımlılığı da yok).

**Önemli isim karışıklığı uyarısı:** `services/api/src/policy-ai/` dizini "Mevzuat" (kanun/yönetmelik) DEĞİL, "poliçe" (sigorta police belgesi) kanıt çıkarımı sistemidir (bkz. §10, §16) — raporun geri kalanında bu ikisi karıştırılmamalıdır.

Durum: **DEFERRED** (production'da tamamen boş bir "yapılandırılmadı" ekranı).

---

## 16. AI Altyapısı

### 16.1 Provider abstraction — resmi bir ortak katman yok

Repo genelinde `ai/`, `provider/`, `orchestrator/`, `llm/` adında paylaşımlı bir dizin **yok**. Bunun yerine 4 ayrı özellik klasörü (`policy-ai`, `labor-ai`, `labor-allocation-ai`, `email-ai`) her biri kendi `gemini-provider.ts`+`providers.ts`+`provider-output-schema.ts`+`store.ts`+`routes.ts` setini taşır. `policy-ai/gemini-provider.ts` gayri-resmi bir "ortak kütüphane" rolü oynuyor — `labor-ai` ve `email-ai` ondan paylaşılan sabitleri (`DEFAULT_GEMINI_API_ORIGIN`, backoff süreleri, structured-output yardımcıları) import ediyor; `labor-allocation-ai` aynı parçaları alıp kendi retry mantığını ayrıca yazmış. Her domain kendi `*ProviderExecutionError` sınıfını (4 ayrı sınıf, ortak base yok) ve kendi retry döngüsünü taşıyor — **retry TETİKLEME koşulu bile domainler arasında tutarsız:** policy-ai/labor-ai/email-ai yalnız HTTP 503'te retry ederken, labor-allocation-ai (en yeni/en olgun) 429 VEYA herhangi bir 5xx'te retry ediyor; bu daha geniş politika diğer üçe hiç geri taşınmamış.

**Gerçekten paylaşılan iki şey var:** (1) `packages/domain/src/policy-ai-privacy.ts` — `minimizePolicyAiSources()`, 10 PII kategorisi (`[PII:CATEGORY_n]` maskeleme), 4 domainin de gerçekten import edip kullandığı doğrulandı; hem giden kaynakta hem **modelin kendi çıktısında** uygulanıyor (çıktı PII-şekilli bir şey içerirse tüm öneri reddedilir — `AI_OUTPUT_PII_UNSAFE`). (2) DB governance tabloları `ai_provider_policies`+`ai_usage_ledger` (migration 0018, sonraki migrationlar yalnız ALTER ediyor) — organizasyon-seviyeli "hangi provider'a izin var, aylık/istek-başı bütçe" ve tek maliyet defteri, 4 domain tarafından ortaklaşa kullanılıyor.

### 16.2 Gerçekten implemente edilen sağlayıcılar

**Sıfır AI SDK'sı** kurulu (`openai`, `@google/generative-ai`, `@anthropic-ai/sdk`, `langchain` — hiçbiri hiçbir `package.json`'da yok). Tüm çağrılar elle yazılmış `fetch()` HTTP istemcisi:

- **Gemini** — `generativelanguage.googleapis.com`, `responseJsonSchema` zorlamalı yapılandırılmış çıktı, `x-goog-api-key` header, sürüm etiketli (`gemini-generate-content/1.0.0`…`/1.3.0`).
- **OpenAI** — `api.openai.com/v1/responses`, `store:false`, `json_schema strict:true` — **yalnız policy-ai'de**, diğer 3 domainde OpenAI yok.
- **Anthropic/Claude:** kodda hiçbir yerde yok.

### 16.3 labor-allocation-ai Gemini adaptörü production'a bağlı değildi — DÜZELTİLDİ (HB-2026-198)

**Bulunan kök neden (orijinal denetim):** Tek gerçek API giriş noktası (`services/api/src/index.ts`→`server.ts:startServer()`→`buildApp()`) incelendiğinde, `startServer()`'ın gerçek `buildApp()` çağrısının yalnız `auth`, `policyAiProviders`, `emailAiProviders` seçeneklerini geçirdiği, **`laborAllocationProviders`/`laborAllocationProviderId`'yi hiç geçirmediği** bulundu. Bunun sonucunda `buildApp()`'in kendi (yalnız test/geliştirme amaçlı) varsayılanı — `createDeterministicLaborAllocationProviderRegistry()`, her satırı sabit `controlRequired:true`+%55 güvenle işaretleyen bir test-fixture kaydı — sessizce production'da devreye giriyordu. `server.ts` içinde tam bu boşluğu kapatmak için önceden yazılmış `createConfiguredLaborAllocationProviderRegistry()` fonksiyonu vardı ama hiçbir çağıranı yoktu (ölü kod) ve `services/api/src/index.ts` bu fonksiyonu dışa aktarmadığı için test dosyalarından bile doğrudan erişilemiyordu.

**Düzeltme (bu paket, HB-2026-198):**
- `server.ts`: `startServer()` artık `laborAllocationProviders: createConfiguredLaborAllocationProviderRegistry(config)` ile registry'yi gerçekten kuruyor; `config.geminiLaborAllocationProvider` tanımlıysa `laborAllocationProviderId: GEMINI_POLICY_PROVIDER_ID` (`'gemini-generate-content'`) ile de eşleştiriyor — registry ve seçilen sağlayıcı kimliği artık AYNI, tek kaynaktan (config) türüyor.
- `index.ts`: `createConfiguredLaborAllocationProviderRegistry` artık paketin dışa aktarım yüzeyinde (kardeşleriyle — `createConfiguredPolicyAiProviderRegistry`/`createConfiguredEmailAiProviderRegistry` — aynı listede).
- `buildApp()`'in kendi test-amaçlı varsayılanı, `laborAllocationAllowDeterministicProviders`'ın `NODE_ENV=production`'da config aşamasında zaten yasak olması, ve mevcut ~20 test dosyasının `laborAllocationProviders`'ı hep açıkça geçirmesi **kasıtlı olarak DOKUNULMADI** — düzeltme yalnız gerçek üretim giriş noktasını (`startServer()`) hedefliyor, mevcut test sözleşmelerini bozmuyor.
- **Sonuç (bu ortamda hiçbir `GEMINI_LABOR_ALLOCATION_*` env değişkeni yokken doğrulandı):** registry artık gerçekten BOŞ kuruluyor; `analyze()` isteği artık dürüstçe `provider_disabled` (`AI_PROVIDER_NOT_CONFIGURED`) ile sonuçlanıyor — sahte deterministik çıktı asla `review_required`'a geçmiyor. `GEMINI_LABOR_ALLOCATION_PROVIDER_ENABLED=true`+`GEMINI_API_KEY` gerçekten verildiğinde ise registry artık gerçek Gemini adaptörünü doğru `providerId` ile taşıyor (yeni birim testiyle doğrulandı, gerçek ağ çağrısı yapılmadan).
- **Yeni testler** (`services/api/test/labor-allocation-provider-optin.test.ts`): iki saf birim testi (opt-in yokken registry boş; opt-in'de registry tam olarak doğru Gemini adaptörünü taşır, secret sızdırmaz) + gerçek Postgres+HTTP regresyon testi (`server.ts` kompozisyonunun birebir aynısıyla `buildApp` çağrılır, analiz isteği atılır, arka-plan işlem terminale ulaşana kadar yoklanır, `provider_disabled` doğrulanır). Tüm 78 dosya/520 test dahil API paketi tam koşumu 0 başarısız.

**Kapsam dışı bırakılan, hâlâ açık kalan ayrı boşluk — `labor-ai` (Paket 44, ayrı/daha basit modül):** Bu, `labor-allocation-ai`'den TAMAMEN AYRI bir özelliktir (boş föyden ilk satır önerisi). `createGeminiLaborAiProvider` tanımlı ama hiçbir `GEMINI_LABOR_AI_*` env değişkeni/config yüzeyi hiç yazılmamış — bu bir "unutulmuş kablo" değil, muhtemelen henüz production'a hazırlanmamış bir modül. Bu paketin kapsamı dışında bırakıldı (bkz. §30); gerçek bir üretim kararı ve ayrı bir geliştirme paketi gerektirir.

**Poliçe AI ve E-posta AI bu boşluktan hiç etkilenmedi** — ikisi de zaten `server.ts`'te doğru şekilde bağlıydı, değişmedi.

### 16.4 Candidate/review/promotion modeli

Gerçek ve production-grade — ama yalnız **policy-ai**'de tam biçimiyle var (`review_required`→accept/edit/reject/control_required→promotion-readiness→promote). Diğer domainlerde aynı fikir farklı isimlerle, ayrı ayrı yeniden yazılmış: `labor-allocation-ai` "promote" değil **"apply"** diyor (kendi ayrı domain dosyası, policy-ai'yi import etmiyor); `labor-ai`/`email-ai`'de `review_required` durumu var ama ayrı bir promotion aşaması yok.

### 16.5 Diğer bulgular

- **Provider config/status admin ekranı:** API yüzeyi var (`GET /policy-ai/providers`, `/ai/usage`, `USAGE_ROLES=admin/expert`) ama **hiçbir frontend bunu tüketmiyor** — Yönetim ekranında provider/Gemini/AI-durumu içeriği yok. `INTERNAL/ADMIN` (API) / `DEFERRED` (UI).
- **`pilot:gemini:policy`:** `TEST/TOOLING ONLY` — yalnız Poliçe AI için, çift açık opt-in (`RUN_REAL_GEMINI_POLICY_PILOT=1`+`GEMINI_POLICY_FREE_TIER_REVIEWED=1`), sentetik veri, kendi kalite eşiği (min %80 recall/precision); CI/production zincirinde hiç çağrılmıyor.
- **Kasco zorunlu kontrol AI KULLANMIYOR** — `kasco-mandatory-check` dizininde gemini/provider/openai'a sıfır referans; bu deterministik bir kural/checklist motoru (bkz. §8).
- **Fail-closed:** timeout/bozuk-JSON/kesik-çıktı/retry-tükenmesi hepsi açık hata kodlarıyla biter, asla sessiz boş-başarı yok; kanıtla doğrulanamayan aday reddedilir; production'da deterministik/fixture provider'ı zorla açma config seviyesinde engellenmiş (`LABOR_ALLOCATION_ALLOW_DETERMINISTIC_PROVIDERS=true`+`NODE_ENV=production`→sunucu hiç başlamaz) — ama bu koruma yalnız "birisi fixture'ı açıkça istesin" senaryosunu engelliyor, gerçek Gemini'nin FİİLEN kullanıldığını garanti etmiyor (§16.3).
- **Kullanıcı onay noktaları:** her mutasyon route'u kimliği doğrulanmış insan oturumu ister; AI-öneri route'ları (`registerLaborAiRoutes` vb.) ile yazma/kesinleştirme route'ları (`registerLaborWorkbookApplyRoutes` vb.) `app.ts`'te **mimari olarak ayrı** Fastify route grupları — "AI önerir" ile "insan-onaylı uç kesinleştirir" bir flag değil, yapısal ayrım.

---

## 17. Yetkilendirme ve Güvenlik

### 17.1 Kullanıcı/organizasyon/rol modeli

`organizations→users(email global-unique)→user_roles↔roles(6 sabit)→sessions`. **Tenant izolasyonu merkezi bir middleware/ORM kısıtı değil** — her route kendi sorgusunda `organization_id`'yi elle filtreler (disiplinli, tekrar eden desen, düzinelerce dosyada doğrulandı); gerçek Postgres+HTTP E2E testi iki ayrı organizasyon oluşturup çapraz erişimin reddedildiğini doğruluyor.

### 17.2 Rol yetenek tablosu (sunucu sabitlerinden — gerçek kaynak, UI değil)

| Rol | Yapabilir | Yapamaz |
|---|---|---|
| **admin** | Her şey; kullanıcı/rol yönetimi, audit görüntüleme, File Agent kaydı, tüm onaylar | Kendi admin rolünü kaldıramaz (self-lockout guard) |
| **expert** | Operasyon yazma, kritik onaylar (kapanış, Değer Kaybı, poliçe, kapanma ücreti — accounting ile birlikte), mali görüntüleme | Kullanıcı/rol yönetimi, audit, File Agent yönetimi, Excel şablon profili yazma |
| **case_manager** | Operasyon yazma, kapanış/yeniden-açma planı, klasör taşıma, kapanma ücreti *adayı* | Kritik onaylar (Değer Kaybı/poliçe/kapanma ücreti), audit, kullanıcı yönetimi |
| **secretary** | Not/görev, evrak/fotoğraf, e-posta taslağı, işçilik yazma, `cases` alan düzenleme | Klasör taşıma/kurulum, kapanış/yeniden-açma, mali onay/aday, AI başlatma |
| **accounting** | Mali görüntüleme + kapanma ücreti **onayı**, `cases` alan düzenleme | Operasyon yazma, klasör işlemleri, kapanış planı, AI başlatma |
| **read_only** | Yalnız görüntüleme/liste | Hiçbir yazma/onay/kritik işlem |

Not: `guard.ts` içindeki eski bir kod-yorumu hâlâ "ilk aşamada herkes tam yetkilidir" diyor — bu **güncel değil**, 30+ route artık gerçek rol matrisini uyguluyor; yalnız yorum eskimiş, davranış doğru.

### 17.3 Authentication / Session

- **Argon2id:** `memoryCost=19.456 KiB, timeCost=2, parallelism=1`.
- Tüm login-başarısızlık yolları (bilinmeyen e-posta/kilitli/pasif/yanlış parola) **aynı** `{kind:'invalid'}` döner + sabit-zamanlı dummy-hash doğrulama (user-enumeration ve timing-attack koruması).
- Hesap kilidi: 5 başarısız denemede 15 dakika (DB'de kalıcı, restart'ta sıfırlanmaz).
- Session token 256-bit rastgele, yalnız SHA-256 hash'i DB'de; TTL 12 saat mutlak (sliding/refresh yok); `findActiveSession` canlı JOIN — rol değişikliği yeniden login gerektirmeden bir sonraki istekte yansır.
- **Çerez `Secure` bayrağı:** production'da varsayılan `true` (fail-closed); yalnız `ALLOW_INSECURE_LOOPBACK_COOKIES=true`+gerçek loopback host ile `false` olabilir, yanlış kombinasyon sunucuyu hiç başlatmaz. Bu davranış, gerçek bir production auth hatası (düz HTTP üzerinde `Secure` çerezin hiç gönderilmemesi) bulunup düzeltilirken eklendi (HB-2026-175).

### 17.4 Bootstrap — ilk admin nasıl oluşuyor

**HTTP API'de kullanıcı OLUŞTURAN hiçbir uç yok.** Tek mekanizma: `deploy/windows-service/bootstrap-first-admin.mjs` — tek-kullanımlık, fail-closed CLI; yalnız `organizations=0 AND users=0` iken (TOCTOU'ya karşı transaction-içi yeniden kontrollü) çalışır; parola argv/dosya/log'a asla yazılmaz, yalnız raw-mode stdin ile alınır. **Gerçekten kullanıldı** (HB-2026-175, DB'de bağımsız doğrulandı). **Bootstrap dışında (ilk admin sonrası) yeni kullanıcı oluşturmanın HİÇBİR yolu yok** — ne API'de ne UI'da `POST /users` benzeri bir uç mevcut; Yönetim ekranı yalnız var olan kullanıcıların ROLÜNÜ değiştirebiliyor.

### 17.5 audit_events

8 kolon (`id, organization_id, actor_user_id?, action, resource_type?, resource_id?, request_id, occurred_at, details jsonb`), **DB seviyesinde append-only** (`BEFORE UPDATE/DELETE` trigger reddi). Tek yazma yolu `AuditService.record()` — iş mutasyonuyla aynı transaction'da atomik. `details` alan-adı bazlı redaksiyondan geçer (`pass(word)?|secret|token|cookie|hash|iban|...`→`[redacted]`, 512 karakter kırpma). **Plan belgesi (`AUDIT_SECURITY_AND_BACKUP_PLAN.md`) daha zengin bir şema (actorType, sessionId, sourceChannel) tarif ediyor — gerçek migration bunları ayrı kolon taşımıyor** (yalnız `details` içine ad-hoc girebilir); kod öncelikli olduğu için gerçek şema yukarıdaki 8 kolondur, plan bir hedeftir. Ayrıca audit sorgusunun kendisi (`GET /audit/events`) auditlenmiyor (plana göre eksik).

### 17.6 Servis kimlikleri — File Agent → API

Ayrı `agents` tablosu (kullanıcı oturumundan bağımsız). Mekanizma **paylaşılan-sır header** (`x-agent-id`+`x-agent-secret`), mTLS DEĞİL — 256-bit rastgele secret, DB'de yalnız SHA-256 hash'i, kayıt anında bir kez döner sonra bir daha okunamaz (session token ile birebir aynı desen). Kayıt/devre-dışı-bırakma admin-only API; secret log'lara `REDACTED_LOG_PATHS` ile sızdırılmıyor.

### 17.7 Secrets handling

Secret DEĞERİ taşıyan env var isimleri: `DATABASE_URL`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `HASARBOTU_AGENT_SECRET`. Config hata mesajları hiçbir zaman değer taşımaz. Pino log redaksiyonu (`authorization/cookie/set-cookie/x-api-key/x-agent-secret`) `buildApp()` içinde sabit — dışarıdan kapatılamaz. `.env.example` şablon dosyası `.gitignore`'da istisna tanımlı ama **repoda gerçekte yok**.

### 17.8 API servis dizini ACL

`harden-api-service-directory-acl.ps1` gerçekten `-Apply` ile çalıştırıldı (HB-2026-192..194) — kök dizinde tam 2 ACE (`SYSTEM:ReadAndExecute`, `Administrators:FullControl`), önceki geniş `Authenticated Users`/`Users` grantları kaldırıldı; servis işlem sırasında `Running` kaldı.

### 17.9 CSP

`default-src 'none'; script-src 'self'; style-src 'self'; ...; worker-src 'none'` — `unsafe-inline`/`unsafe-eval` hiçbir direktifte yok. Yalnız doküman (mainFrame/subFrame) yanıtlarına uygulanıyor, `/api/*` JSON yanıtları değiştirilmiyor. **Gerçek Chromium kanıtı:** inline script çalışmadı, dış ağ çıkışı engellendi, üretim UI build'i sıfır ihlal üretti.

---

## 18. Desktop / Electron

`apps/desktop` — "**ince kabuk**" (ADR-Q06) yaklaşımı: gerçek iş mantığının HİÇBİRİ Electron'da değil, yalnız güvenli bir `BrowserWindow` + loopback aynı-origin köprüsü.

- **Sandbox/contextIsolation:** `nodeIntegration:false, contextIsolation:true, sandbox:true, webSecurity:true, webviewTag:false` — hem pencere seviyesinde hem `app.enableSandbox()` ile süreç genelinde. Gerçek Chromium testi: renderer'da `require/process/Buffer/ipcRenderer` **hepsi `undefined`**.
- **Preload yüzeyi — kasıtlı olarak boş:** yalnız `{isDesktopShell:true, platform}` — hiçbir fonksiyon, hiçbir IPC kanalı açılmıyor; `ipcMain` handler'ı da yok. `packages/desktop-bridge` preload'dan tamamen bağımsız.
- **"Same-origin bridge" (HB-2026-103):** `packages/desktop-bridge` — yalnız `127.0.0.1`'e bind olan bir `node:http` sunucusu; her istekte DNS-rebinding koruması (`Host` header kontrolü); `/api/*` sunucu-sunucu API origin'ine iletilir (cookie aynen taşınır); diğer her yol statik UI build'i. **CORS hiçbir yönde üretilmez** — tarayıcı için istek tek origin, `SameSite=Strict` çerez sorunsuz çalışır.
- **Bağlantı öncesi hazırlık kapısı (D3):** pencere açılmadan önce main process `GET {apiOrigin}/health` sorgular, sürüm uyumluluğunu (major birebir) doğrular; başarısızsa Türkçe hata + "Yeniden dene/Kapat", pencere hiç açılmaz.
- **Desktop/tarayıcı farkı:** bugün üretimde desteklenen TEK istemci Electron kabuğu — CSP/sandbox/harici-bağlantı-allowlist gibi sertleştirmeler yalnız Electron `session` API'leriyle uygulanabiliyor; API'de CORS/CSRF katmanı henüz yok, düz tarayıcı erişimi (AGENTS.md §5'in "web erişimine hazır mimari" hedefi) **henüz kodda yazılmamış**, `DEFERRED`.

Gerçek Electron 43+Chromium E2E testi (`electron-shell-e2e.test.ts`) tüm bu iddiaları (webPreferences, preload yüzeyi, CSP, same-origin login zinciri) bağımsız doğruluyor.

---

## 19. Backend / API Mimarisi

```
Electron Masaüstü Kabuğu (apps/desktop, ince kabuk)
        │  same-origin bridge (packages/desktop-bridge, 127.0.0.1)
        ▼
   Fastify API (services/api) ── 32 route modülü, HB-011 rol matrisi
        │
        ├──► PostgreSQL (packages/database, 45 migration, 104 tablo)
        │        organizations/users/roles/sessions · cases+lifecycle · audit(append-only)
        │        storage/documents · labor(İşçilik) · value-loss · pert · kasco-checks
        │        policy-analysis/OCR/AI · email · jobs(File Agent kuyruğu)
        │
        └──► jobs tablosu (PostgreSQL kuyruk, FOR UPDATE SKIP LOCKED)
                 ▲ claim
                 │
           File Agent (services/file-agent, AYRI Windows servisi)
                 │  paylaşılan-sır kimlik doğrulama (x-agent-id/x-agent-secret)
                 ▼
           NTFS depolama kökü (C:\HasarBotuStorage\...)
                 ▲ arka planda senkronize eder (Windows servisi DEĞİL)
                 │
           pCloud masaüstü istemcisi (interaktif oturum)
```

- **Frontend:** React 19 + TypeScript + Vite, kök `src/`, npm workspaces (`apps/*`, `services/*`, `packages/*`).
- **Domain kuralları** (`packages/domain`) API route'larından ayrı, saf/test edilebilir fonksiyonlar olarak yazılı; her kritik hesaplama (value-loss, kasco-check, pert, labor-allocation) önce domain'de saf fonksiyon, sonra store.ts'te DB'ye bağlanmış hali olarak var — bu ayrım kod tabanında tutarlı.
- **Contracts** (`packages/contracts`) — route path'leri, Zod şemaları, hata kodları TEK doğruluk kaynağı; frontend ve backend aynı paketten import ediyor.
- **Request flow:** her yazma isteği `Idempotency-Key` + optimistic-lock (`expectedVersion`) taşır; her kritik iş `jobs` kuyruğuna düşer, File Agent claim edip gerçek işi yapar, API sonucu bağımsız doğrular.
- **Audit:** iş mutasyonuyla aynı transaction'da atomik `audit_events` INSERT.

**Doküman-kod farkı:** `docs/ARCHITECTURE.md`'nin "önerilen repository yapısı" bölümü `apps/{desktop,web,api,file-agent}` tarif ediyor — gerçek yapı `services/api`+`services/file-agent` (apps altında değil) ve `apps/web` hiç yok; bu, mimarinin gerçek evrimi sırasında güncellenmemiş bir plan bölümüdür, kod esas alınmalıdır.

---

## 20. PostgreSQL Veri Modeli

**45/45 migration okundu, 104 tablo.** Row-Level Security kullanılmıyor — çok-kiracılı izolasyon tamamen `organization_id` kolonu + composite tenant-scoped foreign key ile şema seviyesinde uygulanıyor (bkz. §17.1).

| Domain grubu | Ana tablolar (temsili) | Immutable/append-only/history işaretli mi |
|---|---|---|
| Organizations/Users/Roles/Sessions | `organizations, users, roles, user_roles, sessions` | `audit_events` **append-only** (DB trigger) |
| Cases + lifecycle | `cases, office_counters, idempotency_keys, case_vehicle_owner_sets, case_vehicle_owners` | `case_vehicle_owners` append-only |
| Case lifecycle sagas | `case_workspace_provisionings, case_file_operations, case_lifecycle_operations, case_lifecycle_history` | `case_lifecycle_history` append-only/**history** |
| Storage/Documents | `storage_roots, case_locations, case_location_history, documents, document_versions, photos, document_rule_sets/_versions/_evaluations/_items` | `case_location_history` history; `document_versions`/`photos` immutable-narrow |
| File Agent | `agents, jobs` | — |
| İşçilik (Labor) — 13 migration | `labor_sheets/_versions/_items, labor_ai_suggestion_runs, labor_allocation_runs/_line_suggestions, labor_allocation_applications/_applied_lines, labor_excel_profiles/_versions, labor_workbook_apply_operations` | çoğu append-only; aggregate-guard trigger'ları zamanla olgunlaşmış |
| Değer Kaybı (Trafik) | `traffic_value_loss_assessments/_versions/_evidence/_comparables/_approval_events/_reports` | versions/evidence/reports append-only; **rule allowlist** CHECK ile kilitli |
| PERT | `pert_assessments/_versions` | versions append-only |
| Kasco zorunlu kontrol | `kasco_mandatory_checks, kasco_mandatory_check_confirmations` | confirmations append-only |
| Poliçe (Casco Policy) — en büyük tek grup | `policy_analyses/_versions, policy_source_references, policy_coverages/_deductibles/_service_rules/_part_rules/_replacement_vehicle_rules/_exclusions/_required_documents/_scenario_rules, policy_evidence_links, policy_conflicts, policy_scenario_evaluations` | onaylandığında fact tabloları immutable |
| Metin çıkarım/OCR | `document_text_extractions/_pages/_segments, document_ocr_runs/_pages/_blocks/_lines/_words` | pages/segments/blocks append-only |
| AI orkestrasyon (paylaşılan) | `ai_provider_policies, ai_source_bundles/_items, ai_extraction_runs, ai_extraction_candidates, ai_candidate_reviews/_promotions, ai_usage_ledger, ai_provider_call_receipts` | candidates immutable; usage_ledger append-only |
| E-posta | `email_drafts/_versions/_recipients/_attachments, email_handoffs, email_ai_suggestion_runs` | versions/handoffs append-only |
| Notlar/Görevler | `case_notes, case_tasks, case_task_events, case_follow_up_history` | notes/events/history append-only; tasks state-machine guard |
| Ücret/Kapanış | `fee_records/_record_versions` | versions append-only |
| Servis anlaşmaları | `insurer_service_agreements` | — |

**Şema evrimi notları (supersede):** `labor_allocation_schema_v2` (0039) eski şemayı YIKMIYOR, eklemeli çift-sürüm desteği ekliyor; `labor_excel_profile_categories` (0038) gerçek bir eksen düzeltmesi (operasyon-türü→işçilik-branşı); `traffic_value_loss` kural kilidi (0022→0043) aynı eklemeli desende genişliyor; en erken aggregate root'lar (`policy_analyses`, `traffic_value_loss_assessments`, `fee_records`) kendilerine özel guard trigger'ı taşımazken sonraki modüller (labor_sheets, pert_assessments, case_vehicle_profiles) hem aggregate-guard hem version-chain-guard çiftiyle daha savunmacı bir desene geçmiş — kod tabanının zamanla olgunlaştığının somut kanıtı.

---

## 21. File Agent

Ayrı bir Node.js süreci/Windows servisi (`hasarbotu-file-agent`), API'den TAMAMEN bağımsız çalışır, tek görevi PostgreSQL `jobs` kuyruğunu işleyip gerçek dosya sistemi işlemlerini yapmak.

- **Neden var:** "tek yazıcı" güvenlik modeli — kritik fiziksel dosya/klasör hareketlerini yalnız bu bileşen uygular; API'de gerçek `fs` mutasyonu YOKTUR (kod taramasıyla doğrulandı).
- **Kimlik doğrulama:** §17.6.
- **Lease/job:** §5.
- **Freshness/attestation:** §5 (Session-0 gate detayı).
- **Filesystem mutation:** `file-operation-executor.ts` — atomic-rename/staged-copy stratejileri, symlink/reparse-point reddi, manuel-drift koruması.
- **Workbook apply:** `labor-workbook-writer.ts`, §6.
- **Backup/verification:** §5, §6.
- **Failure/retry:** üstel backoff, terminal-hata anında dead-letter (ör. `encrypted_pdf`, `manual_recovery_required` retry edilmez).
- **Service account:** `svc-hb-fileagent` — en-az-yetki (yalnız `SeServiceLogonRight`; `SeDenyInteractiveLogonRight`+`SeDenyRemoteInteractiveLogonRight` zorunlu, `Users` grubunda değil); NTFS ACL depolama kökünde tam 3 ACE (Administrators/pCloud-hesabı-Modify/svc-hb-fileagent-Modify).
- **Windows Service:** WinSW, `hasarbotu-api`'ye bağımlı (`<depend>`), 3-kademeli restart, 30sn stop-timeout.
- **API ile iletişim:** `x-agent-id`/`x-agent-secret` header'lı HTTP.
- **Güvenlik sınırları:** path-safety 3 katmanlı savunma (§5), freshness gate fail-closed, hash doğrulaması iki taraflı (agent raporlar, API bağımsız yeniden hesaplar).

**Bugünkü gerçek durum (en güncel kayıt, HB-2026-177, 2026-08-09):** `hasarbotu-api` ve `hasarbotu-file-agent` her ikisi de gerçek makinede kurulu, `Running/Automatic`; `postgresql-x64-17` ile birlikte 3 servis Running. `ChangeServiceConfigW` Win32-87 hatası (uzun araştırılan bir sorun) **çözüldü** — 11 başarısız `-Apply` denemesinden sonra (hepsi atomik rollback ile güvenle geri alındı) 12. deneme tam başarılı oldu; kök neden hiçbir zaman tam açıklanamadı ama düşük öncelikli bir araştırma notu olarak dürüstçe kayıtlı bırakıldı, gizlenmedi. **Açık kalan tek artık risk:** `hasarbotu-api` servisi hâlâ `LocalSystem` altında (File Agent'ın aksine dedike bir düşük-yetkili hesabı yok) — yalnız dizin ACL'i ayrıca sertleştirildi, servis kimliğinin kendisi değiştirilmedi (bkz. §30).

---

## 22. pCloud / NTFS Operasyon Modeli

**Bugünkü production gerçeği (D5→D9 uzun araştırma sürecinin nihai sonucu):**

- File Agent'ın çalışma zamanı kökü **düz bir NTFS dizinidir** (`C:\HasarBotuStorage\BARAN GLOBAL EKSPERTİZ`), Session-0'dan (Windows servisinden) tamamen erişilir; tüm gerçek dosya I/O doğrudan buraya, Node'un standart `fs` API'siyle yapılır. **pCloud API/SDK'sı File Agent kod tabanında hiç kullanılmıyor.**
- Bu aynı dizin, aynı zamanda pCloud masaüstü istemcisinin (interaktif oturumda çalışan sıradan bir uygulama, `pCloud.exe` — **Windows servisi DEĞİL**) senkronize klasör modunda izlediği yerel klasördür.
- **`P:\`** (pCloud'un eski sanal sürücü modu, EldoS CBFS tabanlı) File Agent tarafından artık kullanılmıyor — yalnız freshness-gate attestation'ının üretildiği ayrı, admin/interaktif bir bağlamda hâlâ referans olabiliyor.
- **Reconciliation neden gerekli:** pCloud'un bulut↔yerel senkronizasyonu asenkron/eninde-sonunda-tutarlıdır (gerçek ölçülen gecikme örneği: 708 baytlık tek dosya farkının saatler içinde giderilmesi) — bu yüzden her kritik yazma öncesi vaka-özel freshness kontrolü zorunlu.
- **pCloud canlı bağımlılık mı — ikiye ayrılır:** (a) Ham dosya I/O pCloud'un çalışıyor olmasına kod seviyesinde bağımlı DEĞİL (hedef düz NTFS). (b) Freshness gate (tüm kritik yazmalar için önkoşul) pCloud'un yerel SQLite DB'sini + ayrı-üretilmiş attestation'ı okur — bunlar güncel değilse gate `unknown` döner, **yeni kritik işlemler fail-closed reddedilir** (veri kaybı yok, yalnız ilerleme durur).
- **pCloud outage'da ne olur:** mevcut dosyalar NTFS'te okunabilir kalır; yeni kritik yazmalar freshness-gate ile durur; agent çökmez, döngüye devam eder.

Historik not (şişirilmeden): D8'de 6.873 dosya/673 klasörün tam SHA-256 eşitliği doğrulandı; D9'un ilk "600sn global sessizlik" stratejisi canlı ofiste haftalarca çalışmadı (tek ilgisiz vaka farkı yüzünden tüm cutover duruyordu) → strateji **per-case, dar kapsamlı reconciliation + attestation gate**'e değiştirildi (bugünkü mimari).

---

## 23. Windows Production Deployment

- **Servisler:** `postgresql-x64-17`, `hasarbotu-api` (LocalSystem), `hasarbotu-file-agent` (`svc-hb-fileagent`, en-az-yetki) — üçü de bugün `Running/Automatic`.
- **WinSW:** kararlı, dondurulmuş NSSM alternatifine tercih edilmiş; XML şablonları `deploy/windows-service/`.
- **Env/ProgramData:** bootstrap kanıt raporu `C:\ProgramData\HasarBotu\migration-preflight` (Administrators-only ACL); freshness-gate attestation deposu ayrı bir dizinde.
- **Health check:** `/health` endpoint'i gerçek DB ping'i doğruluyor; hazırlık kapısı (§18) desktop tarafında sürüm uyumluluğu kontrol ediyor.
- **Deployment tooling:** `check:deploy` (WinSW XML'lerinin yapısal doğrulaması, derleme-zamanı statik denetleyici — runtime'da çalışmaz), `provision-extra-data-references.ps1` (referans-veri dosyaları için ayrı, hash-doğrulamalı, gerçekten `-Apply` edilmiş provisioning aracı).
- **Rollback:** `install-services.ps1` atomik `Stack[scriptblock]` geri-alma — 11 gerçek `-Apply` denemesinde (6'sı gerçek WinSW `uninstall` dahil) hepsi güvenle geri alındı, kalıcı iz bırakmadı.
- **Installer/paket ilişkisi:** Windows NSIS installer (`electron-builder`, imzasız, kullanıcı kararıyla) gerçekten sıfırdan kurulup 4 kez install/verify/uninstall döngüsüyle doğrulandı; kurulum sırasında gerçek `hasarbotu-api`/`hasarbotu-file-agent` servislerine hiç dokunulmadı (Running/Automatic kaldıkları doğrulandı).
- **Bilinen ayrı risk (kapsam dışı, disclosed):** bu makinede repoyla ilgisiz, halihazırda çalışan ayrı bir V1 uygulaması (`HasarBotu - Baran Ekspertiz 0.6.10`) var — gerçek çoklu-makine rollout'ta Start Menu isim çakışması riski taşıyor, ürün-isim kararı bekliyor.

Secret/credential DEĞERİ bu raporda hiçbir yerde yazılmamıştır.

---

## 24. Backup, Recovery ve Fail-Safe Mekanizmaları

**"Bir şey ters giderse sistem ne yapar?"**

- **Excel workbook:** yazmadan önce `COPYFILE_EXCL` yedek + geri-okuma doğrulaması; post-replace doğrulama başarısızsa otomatik, doğrulanmış rollback (rollback'in kendisi başarısız olursa da dürüstçe raporlanır, gizlenmez).
- **Dosya sistemi:** identity-fence (hash-öncesi/sonrası kimlik yeniden doğrulama), MANUAL_DRIFT_DETECTED (kaynak asla otomatik silinmez), per-case reconciliation (extra/unknown asla otomatik silinmez, yalnız sınıflandırılır).
- **Windows servis kurulumu:** atomik `Stack`-tabanlı rollback, 11 gerçek denemede kanıtlı.
- **DB migration:** ileri/tekrar/rollback-sonra-yeniden-ileri deseni gerçek Postgres'e karşı tekrar tekrar test edilmiş; yakın zamanda bulunan bir test-borcu (`integration.test.ts` migration 0043-45 ile senkron değildi) bulunup düzeltildi (74/74 PASS).
- **Immutable/snapshot tabloları:** §20'de işaretlendi — sistemin karakteristik ilkesi "kanıt hiçbir zaman geriye dönük değişmez."
- **Stale deployment tespiti:** pre-cutover audit'te deploy edilmiş `dist/` HEAD ile byte-birebir karşılaştırılıyor; D9 cutover'da gerçek bir stale-deploy durumu böyle yakalanıp düzeltildi.
- **Servis restart recovery:** heartbeat + `last_seen_at`; controlled `Restart-Service` ile gerçek PID değişimi + yeniden kimlik doğrulama kanıtlandı.
- **"fail-closed" ilkesi** 20 doküman dosyasında, 10+ somut sistemde (Kasko gate, freshness gate, İşçilik yazım hattı, deploy script'leri, bootstrap CLI, auth loopback-cookie kuralı, servis kurulum script'i, kapalı-dosya yazma reddi, rol+lifecycle kontrolleri) tutarlı biçimde uygulanmış.

**Fiziksel dosya yedekleme — bilinçli manuel operasyonel politika (production blocker DEĞİL):** `docs/ARCHITECTURE.md`'de tarif edilen **otomatik/zamanlanmış** yedekleme modeli (`backup_runs`/`restore_test_runs` tabloları, BitLocker'lı harici disk, günlük/haftalık/aylık rotasyon, 14g/8h/12a saklama) 45 migration'ın hiçbirinde kodlanmamış — ama bu bir kod boşluğu/eksik özellik DEĞİL, **mevcut, güncel ürün kararıdır**: aktif depolama yerelde (NTFS, `C:\HasarBotuStorage\...`) tutulur, pCloud senkron/arşiv katmanı **kasıtlı olarak manuel** bir operasyonel süreçtir — otomatik/zamanlanmış bir yedekleme özelliği şu an için ürün gereksinimlerinde yok. §22'de anlatılan D5-D9 kararları zaten bu ayrımı (yerel NTFS = çalışma kopyası, pCloud = manuel senkron/arşiv) nihai mimari olarak sabitliyor. Rapor bunu önceki sürümünde yanlışlıkla "en somut production riski" olarak nitelendirmişti — bu, gerçek bir üretim engelleyici değil, bilinçli bir tercih olarak düzeltilmiştir (`DEFERRED / INTENTIONAL MANUAL POLICY`, bkz. §30).

---

## 25. Audit / Provenance / Evidence Sistemi

Sistem genelinde tutarlı biçimde şu alanlar tutuluyor (repo neyi gerçekten tutuyorsa):

- **Kim yaptı:** `actor_user_id` (audit_events), `confirmed_by_user_id`/`approved_by_user_id`/`created_by_user_id` (domain tabloları).
- **Ne zaman:** `occurred_at`, `confirmed_at`, `approved_at`.
- **Hangi kaynaktan:** `evidence_refs`, `source_type` (`user_entered|ai_assisted|manual_revision|ai_allocation_applied`), `sourceAnchorIds`.
- **AI mı kullanıcı mı:** her sürüm/öneri tablosunda ayrı `source_type`/`ai_suggested_*` vs `confirmed_*`/`applied_*` alan çifti.
- **Önceki/önerilen/uygulanan değer:** İşçilik'te üç ayrı fiziksel alan seti (`suggested_*`/`applied_*`/`modified`), Kasko'da `previous_confirmed_result`/`ai_suggested_result_at_time`.
- **Hangi doküman/sayfa:** `documentId+documentVersionId+page+section+excerpt` (Kasko, Değer Kaybı) veya `pageNumber+sectionHeading+clauseIdentifier+rawExcerpt+excerptHash` (Poliçe Analizi).
- **Hangi revizyon:** her domain'in kendi `_versions` tablosu, append-only.
- **Hangi hash:** `content_hash`, `excerptHash(sha256)`, `startSha256/resultSha256` (İşçilik workbook), `preview_hash`/`plan_hash`.
- **Hangi rule version:** `rule_set_id+rule_version` (Değer Kaybı, immutable CHECK-allowlist ile kilitli), `document_rule_version_id`, `prompt_template_version`/`output_schema_version` (AI).
- **Hangi approval:** `human_approval_status`, `approved_by_user_id`, promotion/apply kayıtları.

Bu alanların HEPSİ `audit_events`'e değil, ilgili domain tablosuna (genelde append-only) yazılır — `audit_events` yalnız "ne oldu, kim yaptı, hangi kaynak/hedef" özetini tutar, serbest metin/gerekçe/hassas içerik audit'e kopyalanmaz (redaksiyon + alan-adı filtresiyle bilinçli olarak).

---

## 26. Test ve Kalite Güvencesi

**En güncel doğrulanmış sonuç (2026-08-10, HB-2026-195):** *"Typecheck/lint/test/build/check:deploy tam yeniden çalıştırıldı: **2.260 test, 0 başarısız**."*

| Workspace | Test sayısı |
|---|---:|
| src (frontend) | 383/389 (6 ortam-koşullu skip) |
| domain | 768 |
| contracts | 324 |
| database | 74 |
| desktop-bridge | 10 |
| api | 516 (78 dosya, tüm Kasko E2E dahil) |
| file-agent | 110 |
| desktop | 75 |
| **Toplam** | **2.260 / 0 başarısız** |

**Bağımsız dosya-sayısı doğrulaması (Glob ile):** 247 npm-test dosyası (65 src + 47 domain + 31 contracts + 3 database + 1 desktop-bridge + 78 api + 14 file-agent + 8 desktop) + 14 Windows Pester (`.Tests.ps1`) + 15 Node (`.test.mjs`) = **276 test dosyası** genel toplam. `api=78` rakamı DECISION_LOG'daki kayıtlı sayıyla birebir eşleşerek çapraz doğrulandı.

- **E2E:** 14 dosya ismi "e2e" içeriyor (`kasco-mandatory-check`, `closure-fee`, `email-draft`, `labor-workbook`, `management`, `notifications`, `permission-matrix`, `pert`, `policy-ai`, `reports-fees`, `traffic-value-loss-closure`, `desktop-bridge-same-origin`, `cases-navigation`, `agent`) + ayrı bir gerçek Electron+Chromium E2E'si.
- **Windows/Pester:** 14 `.Tests.ps1` — servis kurulum/rollback/ACL script'lerinin gerçek makinede doğrulanması.
- **npm audit:** semver-safe düzeltmeler uygulandı; kalan tek disclosed risk `pdfjs-dist` CVE (yapısal olarak erişilemez kod yolu, derleyici kanıtlı).
- **check:bundle:** ilk-yükleme JS bundle'ının 500 KB eşiğinin altında kaldığını ve 10 zorunlu lazy-chunk'ın gerçekten ayrı chunk olduğunu doğrular.
- **check:deploy:** WinSW XML yapısal doğrulaması + admin script statik denetimi.

Rakamlar yalnız en güncel, kanıtlı kayıttan alınmıştır; test suite bu rapor için yeniden ÇALIŞTIRILMAMIŞTIR (yalnız dosya sayımı + docs'taki en son gerçek sonuç kullanıldı).

---

## 27. Şu Anda Kullanıcı Gerçekte Neler Yapabilir?

- Dosya aç, ara (plaka/ofis-no/ihbar-no), filtrele, sırala
- Araç profili ve sahip bilgisi gir
- Evrak/fotoğraf durumunu (hash-doğrulanmış) izle, koşullu eksik listesini gör
- Not ekle, görev ata/tamamla, takip tarihi belirle
- İşçilik föyü hazırla, AI önerisini (bugün dahili kural motoru) gözden geçirip seçerek föye uygula
- Onaylı işçilik dağıtımını gerçek Excel şablonuna (yedekli, doğrulamalı) uygula
- Trafik dosyasında Değer Kaybı hesapla, onaya gönder, immutable PDF rapor üret
- PERT/ağır hasar kanaati ve merkez kararını ayrı ayrı, gerekçeli kaydet
- Kasko dosyasında 7 zorunlu kontrolü kanıt belgesiyle kesinleştir
- Poliçe PDF'ini OCR ile okut, Poliçe AI ile aday çıkar, inceleyip onayla
- E-posta taslağı hazırla (deterministik veya opt-in AI ile), Gmail'e aktar (gönderme elle)
- Dosyayı kapat/yeniden aç (plan→önizle→onay→uygula zinciriyle, gerekirse gerekçeli eksikle)
- Kapanma ücreti adayı gir, onayla/düzelt
- Dönem raporlarını (rol bazlı mali gizlilikle) görüntüle
- Dosya envanterini gerçek `.xlsx` olarak dışa aktar
- (admin) Kullanıcı rollerini değiştir, Excel şablon profillerini yönet, File Agent kaydı yap, audit kayıtlarını görüntüle

---

## 28. Sistem Neleri Bilinçli Olarak Yapmıyor?

| Özellik | Durum |
|---|---|
| Gmail OAuth/API ile gerçek e-posta gönderimi | **YOK** — yalnız web compose handoff |
| Gelen e-posta senkronizasyonu, cevapsız mail takibi, mail→otomatik ihbar | **YOK** — kodda ve planlarda bu isimle hiçbir iz yok |
| Mevzuat kaynak kütüphanesi / gerçek Mevzuat AI | **YOK** — production'da tamamen boş "yapılandırılmadı" ekranı |
| Kasko 7 kontrolde AI-öneri üretimi | **YOK** — şema hazır, üretici kod yok, bilinçli ertelendi |
| Poliçe Analizi ↔ Kasko 7-kontrol otomatik bağlantısı | **YOK** — kavramsal örtüşme var, kod bağlantısı yok, bilinçli ertelendi |
| `labor-ai`'nin (Paket 44, İşçilik'in ayrı ilk-öneri modülü) gerçek Gemini'ye bağlanması | **YOK** — hiç config yüzeyi yazılmamış (labor-allocation-ai'nin kendisi HB-2026-198 ile düzeltildi, artık `server.ts`'e bağlı, bkz. §16.3) |
| Bootstrap sonrası yeni kullanıcı oluşturma (API/UI) | **YOK** — yalnız var olan kullanıcının rolü değiştirilebiliyor |
| Otomatik/zamanlanmış fiziksel yedekleme | **BİLİNÇLİ OLARAK YOK** — ürün kararı: aktif depolama yerel NTFS, pCloud senkron/arşiv MANUEL operasyonel süreç; `ARCHITECTURE.md`'deki `backup_runs`/`restore_test_runs` planı henüz kodlanmadı ama bu bir üretim engelleyici değildir (bkz. §24) |
| Tam muhasebe / genel muhasebe entegrasyonu | **YOK** |
| WhatsApp / SMS bildirimi | **YOK** |
| Web tarayıcıdan (Electron dışı) tam üretim erişimi | **YOK** — CORS/CSRF katmanı henüz yazılmamış |
| PERT'in kapanışa bağlı olması | **YOK** — kapanış PERT'ten tamamen bağımsız |
| Dosya Detayı "Geçmiş" sekmesinin gerçek lifecycle geçmişini göstermesi | **YOK** — backend var, hiçbir UI onu listelemiyor |
| Dosyaya özel genel AI Asistanı (sağ rail) | **YOK** — api modda "henüz bağlı değil" |
| 2FA/MFA, parola sıfırlama, Google girişi | **YOK** — bilinçli kapsam dışı |
| mTLS (File Agent↔API) | **YOK** — yalnız paylaşılan-sır header |

---

## 29. Ürünün Güçlü Yönleri

- **Fiziksel dosya ile veritabanı arasında gerçek, iki-yönlü doğrulanmış bir köprü** — hash/boyut doğrulaması, freshness gate, identity fence, manuel-drift koruması; hiçbiri dekoratif değil, hepsi test edilmiş ve gerçek makinede kanıtlanmış.
- **Kritik işlemler için tutarlı, koda dökülmüş bir yönetişim modeli** (planla→önizle→onay→uygula→doğrula→kesinleştir→audit) — dosya kapanışında, İşçilik Excel yazımında, servis kurulumunda birebir tekrarlanıyor.
- **AI'nin kanıt zorunluluğu ilkesi kod seviyesinde uygulanmış:** Poliçe AI'de kaynakta bulunamayan bir iddia otomatik reddediliyor; İşçilik AI'de kanıtsız satır otomatik "kontrol gerekli"; PII sızıntısı (giden VE gelen) tüm önerileri reddediyor.
- **Domain derinliği:** Türk trafik/kasko sigortacılığının somut kurallarını (Zabıt/KTT/Beyan/Tramer alternatifleri, rücu belirsizliği, servis-anlaşma koşulluluğu, 01.07.2026 mevzuat geçişi, Kasko 7 zorunlu kontrol) kod seviyesinde, sürümlü biçimde modelliyor.
- **Versiyonlama/immutability disiplini:** 104 tablonun ~65'i append-only/immutable-narrow/state-machine-terminal — "kanıt geriye dönük değişmez" ilkesi neredeyse tüm domain'lerde tutarlı.
- **Dürüst, kendini denetleyen bir mühendislik kültürü:** kod yorumları ve DECISION_LOG kayıtları kendi boşluklarını (Kasko AI-öneri yokluğu, kullanıcı-oluşturma eksikliği, audit-sorgusu-auditlenmiyor) saklamadan kaydediyor; bu raporun bizzat bulduğu `labor-allocation-ai` wiring ve kapalı-dosya PATCH guard boşlukları da aynı denetim döngüsünde (HB-2026-198) gerçek Postgres+HTTP testleriyle kapatıldı.

Bu değerlendirme yalnız kodda gözlenen somut kanıta dayanır, pazarlama amaçlı abartı içermez.

---

## 30. Mevcut Sınırlar / Bilinen Riskler

| # | Risk | Production blocker mı? | Kullanıcı etkisi | Workaround | Durum |
|---|---|---|---|---|---|
| 1 | ~~Temel `cases` alan güncelleme kapalı-dosya guard'ı taşımıyordu~~ | Hayır (düşük olasılıktı) | — | — | **ÇÖZÜLDÜ (HB-2026-198):** `updateCase()` artık `lifecycle_status` kontrol ediyor, diğer modüllerle aynı 409 sözleşmesi; gerçek Postgres+HTTP testiyle kanıtlı (`cases-write.test.ts`) |
| 2 | `hasarbotu-api` servis hesabı `LocalSystem` (File Agent'ın aksine dedike düşük-yetkili hesap yok) | Hayır — "tek-operatör makinede düşük pratik risk" | Yok, gözlemlenebilir değil | Yalnız dizin ACL'i sertleştirildi | **Açık**, kayıtlı artık risk |
| 3 | Zamanlanmış/otomatik fiziksel yedekleme kodlanmamış | **Hayır** | Yok | Gerekmiyor | **Yanlış sınıflandırılmıştı, düzeltildi:** bu bir eksiklik değil, bilinçli ürün kararı — aktif depolama yerel NTFS, pCloud senkron/arşiv kasıtlı olarak MANUEL operasyonel süreç (`DEFERRED / INTENTIONAL MANUAL POLICY`, bkz. §22/§24). Otomatik yedekleme özelliği bu paket kapsamında bilerek EKLENMEDİ |
| 4 | ~~labor-allocation-ai gerçek Gemini adaptörü production'a bağlı değildi~~ | Hayır (fail-closed'a düzeltildi) | — | — | **ÇÖZÜLDÜ (HB-2026-198):** `server.ts` artık registry'yi gerçekten kuruyor; yapılandırılmamışken dürüst `provider_disabled`, yapılandırıldığında gerçek Gemini adaptörü seçiliyor; birim+gerçek Postgres/HTTP testiyle kanıtlı. **Ayrı ve hâlâ açık:** `labor-ai` (Paket 44, farklı/daha basit modül) — hiçbir `GEMINI_LABOR_AI_*` config yüzeyi hiç yazılmamış, bu paketin kapsamı dışında bırakıldı, ayrı bir geliştirme kararı gerektirir |
| 5 | Bootstrap sonrası yeni kullanıcı oluşturmanın API/UI yolu yok | Hayır (elle DB ile aşılabilir) | Operasyonel sürtünme | Elle DB müdahalesi (doğrulanamadı) | **Açık** |
| 6 | `pdfjs-dist` CVE (GHSA-hq66-cqwq-w95j) düzeltilmedi | Hayır — kod yolu yapısal olarak erişilemez (derleyici kanıtlı) | Yok | Gerekmiyor | Bilinçli deferred, disclosed |
| 7 | V1/V2 Start Menu isim çakışması riski | Hayır (bugün) / rollout'ta evet | Bugün sıfır | Ürün-isim kararı bekliyor | Disclosed, kapsam dışı |
| 8 | Audit sorgusunun kendisi auditlenmiyor (plana göre eksik) | Hayır | Düşük | Yok | **Açık**, küçük |
| 9 | `case_lifecycle.cancel` işlemi audit üretmiyor | Hayır | Düşük | Yok | **Açık**, küçük |
| 10 | Kasko 7-kontrol AI-öneri alanları boş | Hayır — manuel akış çalışıyor | AI ön-doldurma yok | Manuel giriş | Bilinçli deferred |
| 11 | Poliçe Analizi ↔ Kasko 7-kontrol bağlantısı yok | Hayır | Kullanıcı iki sistemde ayrı ayrı çalışmalı | Yok | Bilinçli deferred |
| 12 | 31 V1 dosyası tür kanıtı olmadan V2'ye aktarılmadı | Hayır | O 31 klasörün V2 karşılığı yok | Kullanıcıdan tür bilgisi bekleniyor | Disclosed, açık |
| 13 | v0.11 Mevzuat, v0.6 gelen-e-posta, v0.12 resmi V1-aktarım UI'ı | Hayır (ayrı modüller) | İlgili özellikler yok | Yok | Roadmap: "Bekliyor" |

**Doküman-güncelliği notu (gerçek risk değil):** `PROJECT_STATUS.md`'nin D8/D9 alt-başlığı ve `ROADMAP.md`'nin bazı satırları, sonraki kayıtlarla (D9 cutover tamamlandı, servisler Running) doğrulanan gerçek durumdan geridedir — metin güncellenmemiş, sistemin kendisi güncel.

---

## 31. Modül Envanter Tablosu

| Modül / Özellik | Ne yapıyor | Trafik | Kasko | AI | Kullanıcı onayı | Production durumu |
|---|---|:-:|:-:|:-:|:-:|---|
| Durum Panosu | Kanban+arama+uyarı özeti | ✓ | ✓ | — | — | PRODUCTION |
| Dosyalar (liste/arama) | Sunucu-taraflı sayfalama/filtre | ✓ | ✓ | — | — | PRODUCTION |
| Dosya oluşturma | Idempotent, ofis-no üretimi | ✓ | ✓ | — | — | PRODUCTION |
| Dosya kapatma/yeniden açma | 7-adım kritik işlem | ✓ | ✓ | — | zorunlu | PRODUCTION |
| Notlar/Görevler | Append-only not, state-machine görev | ✓ | ✓ | — | — | PRODUCTION |
| Koşullu evrak kontrolü | Sürümlü kural motoru | ✓ | ✓ | — | — | PRODUCTION |
| Belge/fotoğraf doğrulama | Hash/boyut, File Agent | ✓ | ✓ | — | — | PRODUCTION |
| İşçilik AI dağıtımı | Kategori+operasyon önerisi | ✓ | ✓ | Gemini (opt-in, artık gerçekten bağlı — HB-2026-198); yapılandırılmamışken fail-closed `provider_disabled` | zorunlu | PRODUCTION / MANUAL STEP |
| İşçilik Excel apply | Yedekli/doğrulamalı D-sütunu yazımı | ✓ | ✓ | — | zorunlu | PRODUCTION / MANUAL STEP |
| Değer Kaybı (Trafik) | İki motorlu hesap+onay+rapor | zorunlu | — | — | zorunlu | PRODUCTION / MANUAL STEP |
| Değer Kaybı (Kasko) | — | — | isteğe bağlı (planlı) | — | — | DEFERRED |
| PERT/Ağır Hasar | Kanaat+merkez kararı, kapanış-bağımsız | ✓ | ✓ | yok (bilinçli) | zorunlu | PRODUCTION |
| Kasko 7 zorunlu kontrol | Ortak motor, kapanış-gate | — | ✓ | yok (şema hazır) | zorunlu | PRODUCTION / MANUAL STEP |
| Poliçe OCR | Yerel Tesseract.js | — | ✓ | — | — | PRODUCTION |
| Poliçe Analizi | Versiyonlu kanonik model | — | ✓ | — | zorunlu (approve) | PRODUCTION / MANUAL STEP |
| Poliçe AI | Gemini+OpenAI candidate/review/promote | — | ✓ | ✓ (bağlı) | zorunlu | PRODUCTION / MANUAL STEP |
| E-posta taslağı | Deterministik/AI şablon | ✓ | ✓ | opt-in Gemini | zorunlu | PRODUCTION |
| E-posta gönderimi | Gmail web handoff | ✓ | ✓ | — | elle | PRODUCTION / MANUAL STEP |
| Kapanma ücreti | Elle tutar, onay/düzeltme | ✓ | ✓ | — | zorunlu | PRODUCTION |
| Dönem raporları | Rol-bazlı mali maskeleme | ✓ | ✓ | — | — | PRODUCTION |
| Dosya envanteri export | Gerçek `.xlsx` | ✓ | ✓ | — | — | PRODUCTION |
| Mevzuat AI | — | — | — | — | — | DEFERRED (backend yok) |
| Kullanıcı/rol yönetimi | Rol güncelleme (oluşturma yok) | — | — | — | admin | INTERNAL/ADMIN (kısmi) |
| File Agent kaydı | Admin API + PowerShell | — | — | — | admin | INTERNAL/ADMIN |
| Excel şablon profilleri | Versiyonlu eşleme tanımı | — | — | — | admin | INTERNAL/ADMIN |
| Audit görüntüleme | Append-only log | — | — | — | admin | PRODUCTION |

---

## 32. Teknik Bileşen Envanteri

| Bileşen | Teknoloji | Görev | Nerede çalışır | Kritik bağımlılık |
|---|---|---|---|---|
| Frontend UI | React 19, TypeScript, Vite | Kullanıcı arayüzü | Electron renderer / tarayıcı | API (aynı-origin köprü üzerinden) |
| Desktop kabuğu | Electron 43.2.0, electron-builder 26.15.3 | İnce kabuk, sandbox/CSP sertleştirme | Windows masaüstü | `services/api` (loopback), `packages/desktop-bridge` |
| Aynı-origin köprü | Node.js `http` (packages/desktop-bridge) | Tek-origin proxy, DNS-rebinding koruması | Electron main process, 127.0.0.1 | API origin |
| API | Fastify 5.10.0, Node ≥24 | 32 route modülü, iş kuralları, auth | Windows Service (`hasarbotu-api`) | PostgreSQL, File Agent (job kuyruğu) |
| Domain katmanı | TypeScript (packages/domain) | Saf iş kuralları, test edilebilir | API içine derlenir | — |
| Contracts | TypeScript + Zod (packages/contracts) | Route/şema tek doğruluk kaynağı | Frontend+API ortak import | — |
| Veritabanı | PostgreSQL, node-pg-migrate (packages/database) | 45 migration, 104 tablo | Windows Service (`postgresql-x64-17`) | — |
| File Agent | Node.js, tesseract.js 7.0.0, pdfjs-dist 6.1.200 | Tek gerçek dosya-sistemi yazıcısı, OCR, Excel yazımı | Windows Service (`hasarbotu-file-agent`) | NTFS depolama kökü, API (job claim) |
| Parola hash | argon2 0.44.0 | Argon2id kimlik doğrulama | API içinde | — |
| PDF işleme | pdfjs-dist 6.1.200, @napi-rs/canvas | Metin çıkarımı, OCR ön-render, PDF rapor üretimi | API + File Agent | — |
| AI sağlayıcıları | Elle yazılmış `fetch()` (SDK yok) | Gemini (generativelanguage.googleapis.com), OpenAI (api.openai.com) | API içinde, HTTP | `GEMINI_API_KEY`/`OPENAI_API_KEY` |
| Depolama senkron istemcisi | pCloud masaüstü uygulaması (3. taraf) | Bulut↔NTFS senkronizasyonu | İnteraktif kullanıcı oturumu (servis DEĞİL) | — |
| Windows Service yöneticisi | WinSW | Servis sarmalayıcı, restart politikası | Windows | — |

---

## 33. Sonuç

HasarBotu V2, bugün kurulup kullanılınca bir eksper ofisinde şu işleri gerçekten baştan sona **üstlenir**: dosya kimliği ve ofis-numarası yönetimi, evrak/fotoğrafın hash-doğrulanmış takibi, koşullu evrak eksik hesaplaması, not/görev/takip, işçilik föyünün AI-destekli (opt-in Gemini, yapılandırılmamışken dürüst fail-closed) kategori/operasyon dağılımı ve bu dağılımın gerçek Excel dosyasına güvenli biçimde yazılması, Trafik dosyalarında iki-motorlu Değer Kaybı hesabı ve immutable rapor üretimi, Kasko dosyalarında 7 zorunlu kontrolün kanıtlı takibi ve kapanış gate'i, poliçe belgesinin OCR+AI ile okunup insan onayından geçirilmesi, e-posta taslağının hazırlanması, dosyanın 7-adımlı güvenli kapanışı ve ücretlendirilmesi, ve tüm bunların değiştirilemez (append-only) bir denetim izinin tutulması.

Sistem, insandan şu kararları almaya **bilinçli olarak devam etmesini** ister: her AI önerisinin son onayı (İşçilik dağıtımı, Poliçe AI adayı, Kasko kontrol sonucu, e-posta taslağı — hiçbiri insan onayı olmadan kalıcı olmaz); Değer Kaybı ve PERT'in nihai kanaati; kapanma ücretinin tutarı ve onayı; eksik gereksinimle kapanma kararı; hangi belgenin hangi Kasko kontrolüne kanıt olacağının seçimi (sistem türü doğrulamıyor); İşçilik AI'sini gerçekten Gemini ile çalıştırmak isteyip istemediği (üç ayrı opt-in kapısı — deploy env, org politikası, kullanıcı egress onayı — hâlâ insan kararı); ve fiziksel verinin pCloud'a manuel senkron/arşivlenmesi (bilinçli olarak otomatikleştirilmemiş bir operasyonel süreç).

---

## A) HasarBotu V2'nin 20 en önemli özelliği

1. Hash-doğrulanmış belge/fotoğraf takibi (File Agent üzerinden)
2. Session-0-safe freshness gate — pCloud senkron gecikmesine karşı fail-closed koruma
3. 7-adımlı kritik işlem modeli (planla→önizle→onay→uygula→doğrula→kesinleştir→audit), kod seviyesinde uygulanmış
4. Koşullu evrak kuralı motoru (Zabıt/KTT/Beyan/Tramer alternatifleri, Trafik/Kasko farkı)
5. İşçilik AI dağıtımı: kategori+operasyon önerisi, kanıt/güven/çelişki kodlarıyla
6. İşçilik Excel apply: yedekli, D-sütunu-kısıtlı, hash-doğrulamalı gerçek `.xlsx` yazımı
7. İki-motorlu, versiyonlu Değer Kaybı hesabı (01.07.2026 mevzuat geçişi dahil)
8. Kasko 7 zorunlu kontrol + kapanış gate entegrasyonu
9. Poliçe OCR (yerel Tesseract.js, bulut bağımlılığı yok)
10. Poliçe AI candidate→review→promotion (kaynak-doğrulamalı, hallucination-dirençli)
11. PII maskeleme + AI çıktı-kanıt eşleşme doğrulaması (giden ve gelen yönde)
12. Rol-bazlı, sunucu-taraflı yetki matrisi (6 rol, HB-011)
13. Mali tutar rol-bazlı gizleme (secretary/read_only asla göremez)
14. Append-only/immutable audit + provenance mimarisi (104 tablonun ~65'i)
15. Aynı-origin desktop köprüsü (CORS'suz, DNS-rebinding korumalı)
16. Electron sandbox/contextIsolation + sıkı CSP, gerçek Chromium ile kanıtlı
17. Atomik Windows servis kurulum/rollback zinciri
18. Idempotency-Key + optimistic-lock her kritik yazma isteğinde
19. Manuel-drift koruması (kullanıcı Explorer'dan taşırsa veri kaybı yok)
20. Dosya envanterinin gerçek `.xlsx` dışa aktarımı

## B) Rakip üründen ayırabilecek 10 teknik/domain özelliği

1. Fiziksel dosya ile veritabanı arasında kriptografik olarak doğrulanmış (hash+freshness) bir bağ — çoğu rakip yalnız "yol" saklar
2. AI'nin kanıtsız hiçbir iddiayı üretemediği, kod-seviyesinde zorlanan bir kanıt-doğrulama katmanı
3. Kritik işlemler için tek-yazıcı (File Agent) mimarisi — API'nin asla doğrudan dosyaya yazamaması
4. Türk trafik/kasko mevzuatının (01.07.2026 geçişi, Zabıt/KTT/Beyan alternatifleri, rücu belirsizliği) sürümlü kod modeli
5. pCloud'un asenkron senkron gerçeğine karşı özel geliştirilmiş, dosya-bazlı freshness/attestation sistemi
6. Excel'e yazarken sütun-seviyesinde kısıtlama + formül/makro/dijital-imza güvenlik taraması
7. Kasko 7 zorunlu kontrolün kanıt-belgesi + versiyon-değişince-yeniden-inceleme (`needs_review`) mekanizması
8. Organizasyon-seviyeli AI bütçe/politika + kullanım defteri (4 AI özelliği paylaşıyor)
9. 7-adımlı, testlerle kanıtlanmış kritik-işlem yönetişim modeli (yalnız dosya kapanışında değil, servis kurulumunda da tekrarlanan bir mühendislik disiplini)
10. Immutable/append-only veri modeli disiplini (104 tablonun büyük çoğunluğu)

## C) Bugün kullanıcı olarak ilk açtığımda yapabileceğim 10 şey

1. Yeni dosya aç (Trafik/Kasko)
2. Dosya ara/filtrele/sırala
3. Evrak/fotoğraf durumunu ve eksik listesini gör
4. Not ekle, görev ata
5. İşçilik föyü hazırla ve AI dağılım önerisini incele
6. Onaylı işçilik dağılımını gerçek Excel'e uygula
7. (Trafik) Değer Kaybı hesapla ve rapor üret
8. (Kasko) 7 zorunlu kontrolü kanıtla işaretle
9. E-posta taslağı hazırlayıp Gmail'e aktar
10. Dosyayı kapat, kapanma ücretini onayla, dönem raporunu görüntüle

## D) Henüz sistemde olmayan / geleceğe bırakılmış özellikler

1. Gerçek Gmail gönderimi, gelen e-posta, cevapsız-mail takibi, mail→otomatik ihbar
2. Mevzuat kaynak kütüphanesi ve gerçek Mevzuat AI
3. Kasko 7 kontrolde AI-öneri üretimi
4. Poliçe Analizi ↔ Kasko kontrol otomatik bağlantısı
5. `labor-ai`'nin (Paket 44, İşçilik'in ayrı/daha basit ilk-öneri modülü) gerçek Gemini'ye bağlanması — hiç config yüzeyi yok (labor-allocation-ai'nin kendisi HB-2026-198 ile düzeltildi, artık PRODUCTION)
6. Bootstrap sonrası yeni kullanıcı oluşturma API/UI'ı
7. ~~Zamanlanmış, doğrulanmış fiziksel yedekleme rejimi~~ — bu bir eksiklik değil, bilinçli manuel operasyonel politika (bkz. §24)
8. Tam muhasebe entegrasyonu, WhatsApp/SMS bildirimi
9. Web tarayıcıdan (Electron dışı) production erişimi
10. 2FA/MFA, self-servis parola sıfırlama, Google girişi
