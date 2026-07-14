# HasarBotu V2 — Uygulama Planı

Bu plan, UI-first prototip aşamasını küçük, test edilebilir ve geri bildirime açık paketler halinde yürütmek için kullanılır.

## Durum anahtarı

- `[ ]` Başlanmadı
- `[-]` Devam ediyor
- `[x]` Tamamlandı ve doğrulandı
- `[!]` Engelli veya kullanıcı kararı gerekiyor

## Aktif geliştirme paketi — UI-first prototip temel kabulü

### Aşama 0 — Yönetişim ve takip altyapısı

- [x] `AGENTS.md` ve zorunlu `docs/` belgelerini tamamen oku.
- [x] Uygulama planı, proje durumu ve karar günlüğü dosyalarını oluştur.
- [x] Typecheck, lint, test ve build kontrollerini çalıştır.

Kabul ölçütü: Takip dosyaları repository içinde bulunur ve başlangıç kalite kapıları hatasızdır.

### Aşama 1 — Tasarım sistemi ve uygulama kabuğu

- [x] TypeScript strict, Vite ve React yapılandırmasını doğrula.
- [x] Açık/koyu tema, kompakt/rahat yoğunluk ve yerel tercih saklamayı doğrula.
- [x] İkonlu daraltılabilir sol menü, üst bar ve sekiz ana rotayı doğrula.
- [x] Typecheck, lint, test ve build kontrollerini çalıştır.

Kabul ölçütü: Uygulama kabuğu çalışır; navigasyon ve görünüm tercihleri etkileşimlidir.

### Aşama 2 — Durum Panosu

- [x] On operasyon aşamasını, özet göstergelerini ve mock filtreleri doğrula.
- [x] Karttan Dosyalar ekranına ve tam dosyaya geçişi doğrula.
- [x] Uzun pano içeriğinin görünür, kapsüllenmiş scrollbar kullandığını doğrula.
- [x] Typecheck, lint, test ve build kontrollerini çalıştır.

Kabul ölçütü: Durum Panosu masaüstü operasyon görünümü olarak kullanılabilir ve temel akışları çalışır.

### Aşama 3 — Dosyalar ve Dosya Detayı

- [x] Kompakt tablo, arama, filtre, sıralama ve sayfa durumunu doğrula.
- [x] Tek tık hızlı detay, çift tık/Enter ile tam dosya açılışını doğrula.
- [x] Dokuz dosya sekmesini ve kritik işlem modalını doğrula.
- [x] Görsel butonların mock geri bildirim verdiğini doğrula.
- [x] Typecheck, lint, test ve build kontrollerini çalıştır.

Kabul ölçütü: Dosyalar master-detail akışı ve tam dosya çalışma alanı kesintisiz çalışır.

### Aşama 4 — Otomatik ve görsel kabul

- [x] Bileşen testlerini kabul kriterlerine göre genişlet.
- [x] 1366×768 ve 1920×1080 çözünürlüklerini doğrula.
- [x] Açık/koyu tema ile sol menü açık/kapalı durumlarını doğrula.
- [x] Scroll/overflow ve tarayıcı konsolunu kontrol et.
- [x] Typecheck, lint, test ve build kontrollerini çalıştır.

Kabul ölçütü: Zorunlu kalite kapıları geçer; doğrulanamayan noktalar açıkça raporlanır.

### Aşama 5 — Durum kaydı ve teslim

- [x] `PROJECT_STATUS.md` dosyasını gerçek sonuçlarla güncelle.
- [x] Yeni kalıcı karar varsa `DECISION_LOG.md` içine tarih ve gerekçesiyle ekle.
- [x] Kalan riskleri ve sonraki tek mantıklı görevi belirle.

Kabul ölçütü: Plan, durum ve karar belgeleri kodun gerçek durumuyla tutarlıdır.

## Aktif geliştirme paketi — İkinci kalite ve tamamlama turu

### Aşama 6 — Belge denetimi ve başlangıç kalite kapısı

- [x] Belirtilen 12 zorunlu belgeyi tamamen oku.
- [x] Ana ekranları ürün gereksinimlerine göre envanterle.
- [x] Başlangıç typecheck, lint, test, build ve audit kontrollerini çalıştır.

Kabul ölçütü: Eksikler kayıtlıdır ve değişiklik öncesi taban doğrulanmıştır.

### Aşama 7 — Ana navigasyon çalışma alanları

- [x] Kapanan Dosyalar ekranını arama, filtre, sıralama ve hızlı detayla tamamla.
- [x] Raporlar ve Ücretler ekranını yoğun özet ve tabloyla tamamla.
- [x] Mevzuat ve AI Yardımcısı ekranını kaynak detayı ve kaynaklı mock cevapla tamamla.
- [x] Bildirimler ekranını filtre ve dosyaya geçişle tamamla.
- [x] Yönetim ve Ayarlar ekranlarını kullanılabilir mock çalışma alanına dönüştür.
- [x] Typecheck, lint, test ve build kontrollerini çalıştır.

### Aşama 8 — Dosyalar ve Dosya Detayı tamamlama

- [x] Durum, servis ve takip tarihi filtrelerini ekle.
- [x] Son güncelleme, takip tarihi, dosya numarası ve plaka sıralamalarını tamamla.
- [x] Dosyalar arası geçişte seçili sekmeyi koru.
- [x] Tek Dosyayı Yenile mock kontrolünü ekle.
- [x] Bütün dosya sekmelerini anlamlı mock çalışma alanlarına dönüştür.
- [x] Trafik/Kasko Değer Kaybı zorunluluk ayrımını göster.
- [x] Normal ve yoğun fotoğraf senaryolarını ayır.
- [x] Typecheck, lint, test ve build kontrollerini çalıştır.

### Aşama 9 — Erişilebilirlik ve otomatik testler

- [x] Ana navigasyon, yeni ekranlar, filtreler ve detay davranışları için test ekle.
- [x] Modal/drawer Escape kapanışlarını uygula ve test et.
- [x] Form label, ikon isimleri, focus ve klavye davranışlarını denetle.
- [x] Typecheck, lint, test ve build kontrollerini çalıştır.

### Aşama 10 — Görsel kabul ve belgeler

- [x] Zorunlu 1366×768 ve 1920×1080 açık/koyu görünümleri doğrula.
- [x] Scroll/overflow ve tarayıcı konsolunu kontrol et.
- [x] `UI_ACCEPTANCE_REPORT.md` oluştur.
- [x] `PROJECT_STATUS.md` ve bu planı gerçek sonuçlarla güncelle.
- [x] Son typecheck, lint, test, build ve audit kapılarını çalıştır.

## Aktif geliştirme paketi — Ofis UAT hazırlığı

### Aşama 11 — UAT veri ve görünüm hazırlığı

- [x] UAT için belirtilen zorunlu belgeleri tamamen oku.
- [x] On iki zorunlu anonim demo örneğini mevcut mock veride denetle.
- [x] Eksik ücret kontrolü bekleyen kapanmış dosya örneklerini ekle.
- [x] Üst barda küçük `UI Prototip · Mock Veri` etiketini ekle ve 1366×768 görünümde doğrula.
- [x] Typecheck, lint, test ve build kontrollerini çalıştır.

Kabul ölçütü: Bütün UAT senaryolarının anonim veri karşılığı bulunur ve prototip gerçek sistem izlenimi vermez.

### Aşama 12 — UAT belgeleri

- [x] `UAT_PLAN.md` oluştur.
- [x] Yirmi beş adım adım senaryoyu `UAT_SCENARIOS.md` içinde oluştur.
- [x] Ekran bazlı `UAT_FEEDBACK.md` formunu oluştur.
- [x] Önem, öncelik ve durum alanlı `UAT_ISSUE_LOG.md` tablosunu oluştur.
- [x] Sabit test komutu, adresi, veri güvenliği ve kayıt kurallarını belgeye ekle.

Kabul ölçütü: Eksper, Sorumlu ve gözlemci açıklama almadan UAT oturumunu başlatıp sonuç kaydedebilir.

### Aşama 13 — Son kalite ve durum kaydı

- [x] `PROJECT_STATUS.md` ve bu planı gerçek UAT hazırlık durumuyla güncelle.
- [x] Son typecheck, lint, test, build ve audit kapılarını çalıştır.
- [x] UAT gereksinimlerini dosya ve komut kanıtlarıyla son kez denetle.

Kabul ölçütü: Kalite kapıları hatasızdır; dört UAT belgesi, 25 senaryo, 12 demo örneği ve doğrulanmış başlatma yolu eksiksizdir.

## Aktif geliştirme paketi — Hızlı UAT arama düzeltmeleri

### Aşama 14 — Ortak arama akışı

- [x] Zorunlu proje, durum ve UAT belgelerini tamamen oku.
- [x] Üst genel aramadaki sorguyu Dosyalar ekranına ve yerel arama state'ine aktar.
- [x] Boş veya yalnız ayraç içeren sorguda yönlendirmeyi engelle.
- [x] Ortak Türkçe karakter ve ayraç toleranslı arama yardımcısı oluştur.
- [x] Zorunlu dosya metaverilerini taramaya ekle; not, görev, e-posta ve evrak içeriğini kapsam dışında tut.
- [x] Çok kelimeli sorguyu farklı alanlarda AND mantığıyla eşleştir.
- [x] Typecheck, lint, test ve build kontrollerini çalıştır.

Kabul ölçütü: Üst bar ve Dosyalar aynı normalize arama yardımcısını kullanır; UAT örnek sorgularının tamamı doğru sonuç verir.

### Aşama 15 — Regresyon, UAT kaydı ve teslim

- [x] Mevcut testleri koruyarak üst arama, aktarım, boş sorgu ve normalize arama testlerini ekle.
- [x] Sorumlu ve servis filtrelerinin regresyon testini koru.
- [x] İki UAT arama sorununu `Tekrar test` durumuna güncelle.
- [x] `PROJECT_STATUS.md` ve bu planı gerçek sonuçlarla güncelle.
- [x] Son typecheck, lint, test, build ve audit kapılarını çalıştır.
- [x] Arama gereksinimlerini kod, test ve UAT kayıtlarıyla son kez denetle.

Kabul ölçütü: Başarısız kalite kapısı kalmaz ve iki UAT arama sorunu ofis tekrar testine hazırdır.

## Aktif geliştirme paketi — Kabul kapanışı ve referans sürüm

### Aşama 16 — UAT kapanışı

- [x] Gerçek ofis tekrar testi sonuçlarını kaydet.
- [x] `UAT-ISSUE-001` ve `UAT-ISSUE-002` kayıtlarını kapat.
- [x] Genel UAT sonucunu `Kabul` olarak kaydet.
- [x] UI kabul raporunu ve proje durumunu kabul sonucuyla güncelle.

Kabul ölçütü: Açık Kritik/Yüksek UAT kaydı kalmaz ve UI-first prototip kabulü belgelerde tutarlı görünür.

### Aşama 17 — Resmî UI referans sürümü

- [x] Proje metadata sürümünü `0.1.0-ui-baseline` olarak dondur.
- [x] `.gitignore` kapsamını dependency, build, log, geçici, secret, IDE ve işletim sistemi dosyaları için genişlet.
- [x] Son typecheck, lint, test, build ve audit kapılarını çalıştır.
- [x] Git deposunu `main` dalıyla başlat ve eklenecek dosyaları denetle.
- [x] İlk yerel commit ve `v0.1.0-ui-baseline` annotated tag oluştur.
- [x] Commit, tag, temiz çalışma ağacı ve remote yokluğunu doğrula.

Kabul ölçütü: Kabul edilmiş UI prototipi, tekrar üretilebilir kalite kanıtlarıyla yerel Git baseline olarak korunur.

## UI-first sonrası bekleyen yol

UI-first prototip 11.07.2026 tarihinde kabul edilmiş ve `0.1.0-ui-baseline` olarak dondurulmuştur. Aşağıdaki aşamalar bu referans korunarak ayrı geliştirme paketleri halinde ele alınır:

- Temel altyapı ve merkezi API
- PostgreSQL ve migration sistemi
- Electron masaüstü kabuğu
- pCloud ve Dosya Agent
- Gmail veya AI API entegrasyonu
- Excel'e veya gerçek dosya sistemine yazma

## Aktif geliştirme paketi — Altyapı mimarisi temeli

Bu paket kabul edilmiş UI kodunu değiştirmeden gerçek altyapıya geçiş belgelerini hazırlar. Uygulama sırası ve paket ayrıntıları `INFRASTRUCTURE_IMPLEMENTATION_PLAN.md` içinde tutulur.

### Aşama 18 — Baseline, dal ve repository denetimi

- [x] Repository kökü ve `docs` altındaki bütün bağlayıcı belgeleri tamamen oku.
- [x] `v0.1.0-ui-baseline` annotated tag ve baseline commit bütünlüğünü doğrula.
- [x] `architecture/infrastructure-foundation` dalını baseline etiketinden oluştur.
- [x] Kaynak, test, route, state, mock veri ve dependency sınırlarını envanterle.
- [x] UI kaynak kodunu ve kullanıcı değişikliklerini değiştirmediğini doğrula.

Kabul ölçütü: Mimari çalışma kabul edilmiş baseline'dan ayrılmış dalda ve kaynak koduna dokunmadan yürür.

### Aşama 19 — Altyapı planlama belgeleri

- [x] Merkezi mimari bileşenleri, güven sınırları ve uçtan uca akışları tanımla.
- [x] Kademeli repository/workspace yapısı ve geri alınabilir taşıma adımlarını tanımla.
- [x] API kaynak/sözleşme, hata, yetki, audit, idempotency ve concurrency planını tanımla.
- [x] PostgreSQL kavramsal veri modelini, anahtarları, indeksleri ve transaction sınırlarını tanımla.
- [x] Göreceli dosya yolu ve tek yazıcı File Agent modelini tanımla.
- [x] Geçici Windows 11 ofis merkezi ve kalıcı sunucu geçiş planını tanımla.
- [x] Kimlik, RBAC, audit, sır, yedek ve felaket kurtarma sınırlarını tanımla.
- [x] Gerçek altyapıyı 23 küçük ve sıralı uygulama paketine ayır.
- [x] Yeni kalıcı karar almadan açık kararları seçenek, artı/eksi, öneri ve etkiyle kaydet.

Kabul ölçütü: Sekiz altyapı belgesi bağlayıcı proje kararlarıyla tutarlı, uygulanabilir ve karar kapıları görünürdür.

### Aşama 20 — Durum, kalite ve teslim denetimi

- [x] `PROJECT_STATUS.md` ve bu planı gerçek mimari planlama durumuyla güncelle.
- [x] Typecheck, lint, test, build ve moderate audit kapılarını çalıştır.
- [x] Sekiz belgenin zorunlu bölüm/tablo/paket kapsamını yapısal olarak denetle.
- [x] Git dalı, baseline tag/commit, kaynak kod farkı, commit ve remote/push durumunu doğrula.

Kabul ölçütü: Bütün kalite kapıları gerçek sonuçlarıyla kayıtlıdır; yalnız belge farkları vardır ve sonraki tek görev Paket 01'dir.

## Aktif geliştirme paketi — Paket 01 npm workspace temeli

### Aşama 21 — Planlama commit'i ve güvenli dal

- [x] Bütün bağlayıcı belgeleri, package/lock ve yapılandırma dosyalarını tamamen oku.
- [x] Planlama farkında yalnız beklenen on belge olduğunu ve `src` farkı bulunmadığını doğrula.
- [x] Typecheck, lint, 26 test, build, moderate audit ve diff kontrolünü çalıştır.
- [x] Plan belgelerini `docs: define infrastructure foundation plans` mesajıyla ayrı commit'e kaydet.
- [x] Temiz planlama commit'inden `foundation/package-01-workspaces` dalını oluştur.

Kabul ölçütü: Planlama belgeleri UI baseline'dan ayrı, tek commit'te korunur; Paket 01 bu commit üzerinden başlar.

### Aşama 22 — Minimum workspace ve config paketi

- [x] Root `private: true`, paket adı, sürüm, dependency ve scriptlerini koru.
- [x] Yalnız `apps/*`, `services/*`, `packages/*` npm workspace desenlerini ekle.
- [x] Runtime dependency içermeyen özel ESM `@hasarbotu/config` paketini oluştur.
- [x] Ortak fakat aşırı kısıtlayıcı olmayan `tsconfig/base.json` tabanını ekle.
- [x] Root tsconfig dosyalarını config paketine bağlama ve boş workspace paketleri oluşturma.
- [x] Geçici root UI yerleşimini repository README içinde açıkla.
- [x] `.gitignore` workspace çıktıları, cache, log, environment ve secret dosyalarını kapsadığından tekrar kural ekleme.

Kabul ölçütü: İlk gerçek workspace yalnız `packages/config` olur; kabul edilmiş root UI ve yapılandırmaları yerinde kalır.

### Aşama 23 — Install, regresyon ve smoke doğrulaması

- [x] `npm install` ile lockfile workspace kaydını üret.
- [x] `npm ls --workspaces --depth=0` ile `@hasarbotu/config@0.0.0` kaydını doğrula.
- [x] Root runtime ve dev dependency listelerinin değişmediğini, mevcut lock sürümlerinde yükseltme olmadığını doğrula.
- [x] Typecheck, lint, 26 test, build, moderate audit ve diff kontrolünü çalıştır.
- [x] Root UI'yi 127.0.0.1:4173 üzerinde aç; ana başlık, sekiz navigasyon bağlantısı, prototip etiketi, overflow ve konsolu doğrula.
- [x] Smoke test sekmesini ve Vite sürecini kapat.

Kabul ölçütü: Workspace kayıtlıdır; root komutlar ve ana UI davranışı baseline ile çalışmayı sürdürür.

### Aşama 24 — Durum kaydı ve Paket 01 commit'i

- [x] `DECISION_LOG.md`, `PROJECT_STATUS.md`, `INFRASTRUCTURE_IMPLEMENTATION_PLAN.md` ve repository planını gerçek sonuçlarla güncelle.
- [x] Son kalite kapılarını belge değişikliklerinden sonra yeniden çalıştır.
- [x] Yalnız Paket 01 farklarını `chore: establish npm workspace foundation` mesajıyla commit et.
- [x] Temiz çalışma ağacı, commit sırası, aktif dal, main/tag bütünlüğü ve remote yokluğunu doğrula.

Kabul ölçütü: Paket 01 bütün kanıtlarıyla ayrı commit'tedir ve sonraki tek mantıklı görev Paket 02'dir.

## Aktif geliştirme paketi — Paket 02 ortak domain çekirdeği

### Aşama 25 — Belge, model ve Git sınırı denetimi

- [x] `AGENTS.md`, bütün `docs` belgeleri, root/package yapılandırmaları ve mevcut UI model/moklarını tamamen incele.
- [x] Paket 01 commit'ini ve temiz çalışma ağacını doğrula.
- [x] `foundation/package-02-domain-core` dalını `17043624ca6bba1b6f025fb565a00a537ada83f1` commit'inden oluştur.
- [x] UI yaşam döngüsü etiketi ile operasyon aşaması farkını kaydet; `src` altında değişiklik yapma.

Kabul ölçütü: Paket 02 temiz Paket 01 tabanından başlar; belge çelişkisi veya kullanıcı değişikliği yoktur.

### Aşama 26 — Saf TypeScript domain paketi

- [x] Private ESM ve runtime dependency içermeyen `@hasarbotu/domain@0.0.0` paketini oluştur.
- [x] Branded kimlikler, güvenli `ParseResult`, dosya türü, yaşam döngüsü, on operasyon aşaması ve değer kaybı kuralını ekle.
- [x] Ofis/ihbar/hasar numarası, plaka, UTC tarih-saat, yerel tarih ve entity version değerlerini ekle.
- [x] Presentation alanı içermeyen minimum `CaseCore` modelini ve kontrollü root exportlarını oluştur.
- [x] Config paketine yalnız ortak tsconfig exportunu ekle; root UI tsconfiglerini değiştirme.

Kabul ölçütü: Domain kaynakları React, browser, Node dosya sistemi, API, veritabanı veya başka altyapı import etmez.

### Aşama 27 — Deterministik testler ve root kalite bütünleşmesi

- [x] Sekiz domain test dosyasında runtime ve `@ts-expect-error` tür sınırı testlerini ekle.
- [x] Root typecheck, lint, test ve build komutlarına domain paketini testleri iki kez çalıştırmadan dahil et.
- [x] Workspace typecheck, test ve build komutlarını ayrı ayrı doğrula.
- [x] ESM JavaScript ve declaration çıktısını, lockfile workspace linkini ve yeni harici dependency olmadığını doğrula.
- [x] Root UI smoke testinde HTTP 200, 8 navigasyon bağlantısı, mock etiketi, overflow ve konsolu doğrula; test portunu kapat.

Kabul ölçütü: 26 UI ve 132 domain testi geçer; root ve workspace kalite kapıları yeşildir.

### Aşama 28 — Durum ve teslim hazırlığı

- [x] `DECISION_LOG.md`, `PROJECT_STATUS.md`, bu plan ve altyapı uygulama planını gerçek sonuçlarla güncelle.
- [x] UI mock `status` değerleri ile domain `CaseStatus` ayrımını açıkça belgeye kaydet.
- [x] Paket 02 farkını, `src` değişmezliğini, remote yokluğunu ve commit kapsamını denetle.
- [x] Son kalite kapıları ve `git diff --check` için teslim öncesi kontrol listesini hazırla.

Kabul ölçütü: Yalnız Paket 02 farkları commit'e hazırdır; sonraki tek mantıklı görev Paket 03'tür.

## Aktif geliştirme paketi — Paket 03 sözleşmeler ve doğrulama

### Aşama 29 — Belge, sınır ve Git denetimi

- [x] `CLAUDE.md`, `AGENTS.md`, ilgili `docs`, root/package yapılandırmaları, `packages/config` ve `packages/domain` kaynaklarını incele.
- [x] `foundation/package-03-contracts` dalını ve `cf238ee` HEAD'ini, temiz çalışma ağacını doğrula.
- [x] `CaseCore.followUpAt` tipinin `UtcDateTime` olduğunu doğrula; koşullu `LocalDate` yeniden adlandırması uygulanmadığından domain değiştirilmedi.

Kabul ölçütü: Paket 03 temiz Paket 02 tabanından başlar; belge çelişkisi yoktur ve domain/UI dokunulmadan bırakılır.

### Aşama 30 — Zod 4 sözleşme paketi

- [x] Private ESM `@hasarbotu/contracts@0.0.0` paketini yalnız `zod@4` ve workspace `@hasarbotu/domain` runtime dependency'siyle oluştur.
- [x] Ortak primitive, strict success/failure zarfı, kararlı hata modeli ve güvenli Zod→API hata dönüştürücüsü ekle.
- [x] Sayfa tabanlı pagination, sıralama, `/health` yanıtı ve read-only `/api/v1` Cases sorgu/liste/detay sözleşmelerini ekle.
- [x] Domain↔DTO saf mapper'larını (`undefined`↔`null`, `followUpAt`↔`followUpDate`) ve route sabitlerini ekle.
- [x] Zod 4 yerleşik `z.toJSONSchema` ile deterministik JSON Schema üretimini `dist/json-schema` altına ekle; `dist` ignore edilir.

Kabul ölçütü: Public şemalar strict ve coercion'suzdur; domain/DTO ayrımı açıktır; ham girdi hata nesnesine sızmaz.

### Aşama 31 — Kalite kapıları, kök bütünleşme ve teslim

- [x] Root `typecheck`/`test`/`build` komutlarını contracts paketini testleri iki kez çalıştırmadan kapsayacak şekilde güncelle; `prepare` ile domain→contracts build sırasını garanti et; `npm run dev` davranışını koru.
- [x] `npm install`, `npm ls`, typecheck, lint, test, build, moderate audit, `git diff --check`, contracts workspace typecheck/test/build/schema ve UI HTTP 200/konsol smoke kontrollerini çalıştır.
- [x] Declaration ve JSON Schema çıktısını doğrula; `dist` ignore'unu doğrula; 158 mevcut testin korunduğunu doğrula.
- [x] `DECISION_LOG.md`, `PROJECT_STATUS.md`, bu plan, `INFRASTRUCTURE_IMPLEMENTATION_PLAN.md` ve `API_CONTRACT_PLAN.md` belgelerini gerçek sonuçlarla güncelle.

Kabul ölçütü: Bütün kalite kapıları yeşildir; yalnız Paket 03 farkları commit'e hazırdır; sonraki tek mantıklı görev Paket 04'tür.

## Aktif geliştirme paketi — Proje çapında sertleştirme turu

### Aşama 32 — Güvenlik kapısı ve denetim okuması

- [x] CLAUDE.md, AGENTS.md, bütün docs, package/lock, config/domain/contracts/src ve yapılandırmaları incele.
- [x] Dal/HEAD/temiz ağaç/main/Paket02/tag/remote beklentilerini doğrula; `hardening/project-wide-audit` dalını `36a140c` üzerinden oluştur.

### Aşama 33 — Domain ve sözleşme semantiği sertleştirmesi

- [x] `followUpAt` → `followUpDate?: LocalDate`; wire/query LocalDate; timezone dönüşümü yok.
- [x] Kimlikler 1..128 güvenli ASCII, yol/`..`/kontrol reddi (domain + wire).
- [x] Referans numaraları max 128, kontrol/backslash reddi, `11/18882475` desteği; plaka max 32.
- [x] `page` 1..10.000; NaN/Infinity/ondalık reddi testli.
- [x] `unrecognized_keys` güvenli anahtar-adı raporu; zod tam `4.4.3` pin.
- [x] JSON Schema paritesi + `x-hasarbotu-runtime-validation`; golden fixture'lar + regresyon testi + açık `schema:fixtures` script'i.

### Aşama 34 — Yeniden üretilebilirlik, UI denetimi ve teslim

- [x] Root typecheck/test/build dist bağımsızlığı; `build:packages`; `npm run dev` korundu.
- [x] Temiz worktree'de `npm ci` + typecheck/lint/test/build/schema/import-smoke (tamamı exit 0).
- [x] UI davranış denetimi (değişiklik yok): 1366×768, arama, hızlı detay/Escape, tema, konsol.
- [x] `PROJECT_WIDE_AUDIT.md` + ilgili belgeler; atomik commit'ler; korunan dal/tag'lere dokunulmadı.

Kabul ölçütü: 350/350 test; bütün kapılar temiz ortamda yeşil; bilinen Paket 03 engelleri kapalı; sonraki tek mantıklı görev Paket 04'tür.

## Aktif geliştirme paketi — Paket 04 merkezi API iskeleti

### Aşama 35 — Kapı ve dal

- [x] CLAUDE.md, AGENTS.md, docs, package/lock, config/domain/contracts/src ve hardening kaynaklarını incele.
- [x] Dal/HEAD (`hardening/project-wide-audit`@`fdd1658`)/temiz ağaç/korunan ref'leri doğrula; `foundation/package-04-api-skeleton` dalını oluştur.

### Aşama 36 — API iskeleti

- [x] `services/api` `@hasarbotu/api@0.0.0` (private, ESM, sideEffects:false, engines `>=24 <25`); tam pin `fastify@5.10.0`, `tsx@4.23.0`, `@types/node@24.13.3`.
- [x] `buildApp`/`startServer` ayrımı; import'ta otomatik başlatma yok; Clock adapter; config sınırı (açık PORT parser, secret sızdırmayan hata).
- [x] Güvenli varsayımlar: trustProxy:false, 1 MiB body limit, 30 sn timeout, Fastify request ID, yapısal log redaksiyonu.
- [x] `GET /health` contracts şemasıyla; güvenli 404/`internal_error` failure envelope'ları; graceful shutdown (tek kapanış).
- [x] 29 API testi (config/app/health/not-found/error-handler; inject ile, gerçek port/DB/fs yok).

### Aşama 37 — Bütünleşme, doğrulama ve teslim

- [x] Root scriptler: `dev` korunumu, `dev:api`, domain→contracts→api deterministik zincir, tek test koşumu.
- [x] Kapılar: typecheck/lint/test(379)/build/audit/diff-check exit 0; API workspace typecheck/lint/test/build exit 0.
- [x] Runtime smoke: 3100'de gerçek HTTP health 200 + güvenli 404 + log-secret taraması + SIGINT graceful + port boş.
- [x] UI regresyon: HTTP 200, 26 test, konsol temiz, port kapandı.
- [x] Temiz checkout (repo dışı kopya): `npm ci` + 9 adım exit 0.
- [x] README, `API_RUNTIME_FOUNDATION.md`, DECISION_LOG (HB-2026-006), durum/plan belgeleri; tek atomik commit.

Kabul ölçütü: 379/379 test; health gerçek HTTP üzerinde contracts-uyumlu; korunan dal/tag değişmedi; sonraki tek mantıklı görev Paket 05'tir.

## Aktif geliştirme paketi — Paket 04.5 kasko poliçe kuralları (yalnız dokümantasyon)

### Aşama 38 — Kasko poliçe analizi ve iş kuralı modelleme

- [x] Başlangıç kapısı: dal `foundation/package-04-api-skeleton`@`03a24c0`, temiz ağaç; `planning/package-04-5-casco-policy-rules` dalı oluşturuldu.
- [x] `CASCO_POLICY_ANALYSIS_PLAN.md`: uçtan uca poliçe işleme, analiz hattı, şirket bağımsızlığı, muafiyetli dosya akışı, parça bedeli, değer kaybı ofis kuralı.
- [x] `CASCO_POLICY_CANONICAL_MODEL.md`: kanonik alan grupları + 14 gelecek veri kavramı + izlenebilirlik zinciri.
- [x] `CASCO_POLICY_SCENARIO_RULES.md`: senaryo kural yapısı, dört durumlu kapsam sonucu, AI sekiz bölümlü cevap standardı, muafiyetli akış senaryosu.
- [x] Güncellemeler: DOMAIN_RULES, PRODUCT_REQUIREMENTS, DATABASE_MODEL_PLAN (§4.1 + §5.5/5.5a), API_CONTRACT_PLAN (§9), SECURITY_AND_AI_POLICY, TESTING_AND_ACCEPTANCE, DECISION_LOG (HB-2026-007), INFRA planı, durum belgeleri.
- [x] Doğrulama: kaynak kod/package/lockfile değişmedi; typecheck/lint/test/build + `git diff --check`; belge tutarlılık taraması.

Kabul ölçütü: Runtime davranışı değişmeden kasko poliçe kuralları tek kaynaklı belgelendi; Paket 05 şema tasarımı `policy_*` kavramlarını karar kapısıyla ele alır.

## Aktif geliştirme paketi — Ana yol haritası mutabakatı (yalnız dokümantasyon)

### Aşama 39 — Yol haritası DOCX incelemesi ve hizalama

- [x] Güvenlik kapısı; `planning/master-roadmap-alignment` dalı `7169432` üzerinden oluşturuldu.
- [x] Harici DOCX (33 bölüm) tam okundu; repo kararlarıyla alan alan karşılaştırıldı; kod tarafı kanıtla doğrulandı (domain enum'ları, contracts kapsamı).
- [x] `MASTER_ROADMAP_ALIGNMENT.md`: hizalı alanlar, 21 işlenen güncelleme (G1-G21), 7 eleştirel nokta (K1-K7), Paket 05 kapısına etki.
- [x] Güncellemeler ilgili 13 belgeye işlendi; çelişkiler (dosya durumu/aşama seti) sessizce çözülmeden karar kapısına bağlandı.
- [x] Doğrulama: yalnız docs değişti; typecheck/lint/test/build + diff-check; tutarlılık taraması.

Kabul ölçütü: Yol haritası ile repo belgeleri tek tutarlı kaynak; açık ürün kararları görünür; sonraki tek mantıklı görev Paket 05'tir (K1/K2 kararıyla birlikte).

## Aktif geliştirme paketi — Paket 05 PostgreSQL ve migration temeli

### Aşama 40 — Kapı, kararlar ve kurulum

- [x] Güvenlik kapısı; `foundation/package-05-postgres-migrations` dalı `aab6d1e` üzerinden oluşturuldu.
- [x] Kullanıcı onayları alındı: PostgreSQL 17 kurulumu, pg+node-pg-migrate, UUIDv7 (HB-2026-009).
- [x] PostgreSQL 17.10 Windows servisi kuruldu; Türkçe locale initdb hatası UTF8+ICU tr-TR manuel cluster ile çözüldü; roller/veritabanları ve `%USERPROFILE%\.hasarbotu\` sır düzeni kuruldu.

### Aşama 41 — @hasarbotu/database ve API bütünleşmesi

- [x] Paket: açık URL parser (sızıntısız hatalar + redaksiyon), pool fabrikası, sınırlı süreli sağlık kontrolü, programatik/CLI migration, UUIDv7.
- [x] `organizations` ilk migration'ı (uuid PK, kısıtlar); her adım kendi transaction'ında; `pgmigrations` durum tablosu.
- [x] Test güvenlik kapısı: `assertTestDatabaseUrl` `_test` zorunluluğu; URL yokken entegrasyon bloğu açıkça atlanır.
- [x] API: opsiyonel `DATABASE_URL` → health `ok`/`degraded` (enjekte edilebilir kontrol); havuz graceful shutdown'da kapanır; 3 yeni API testi.
- [x] Root zincirler domain→contracts→database→api sırasına genişletildi; `npm run dev` değişmedi.

### Aşama 42 — Kanıt, doküman ve teslim

- [x] Gerçek DB entegrasyon testleri: ileri migration, tekrar güvenliği, sıra uyuşmazlığı reddi, transaction rollback, kısıt ihlalleri, sağlık (22/22).
- [x] Canlı smoke: migrate CLI (redakte çıktı), health ok→degraded geçişi, loglarda şifre taraması (0), yedek→ayrı DB'ye geri yükleme→satır eşitliği.
- [x] Kapılar: typecheck/lint/test(404)/build/audit/diff-check exit 0; UI HTTP 200 + port kapatıldı.
- [x] `DATABASE_OPERATIONS.md` + DECISION_LOG (HB-2026-009) + durum/plan belgeleri; temiz checkout doğrulaması; tek atomik commit.

Kabul ölçütü: Temiz test DB tek komutla kurulup doğrulanır; API DB hazır oluşunu güvenli ölçer; korunan ref'ler değişmez; sonraki tek mantıklı görev Paket 06'dır.

## Aktif geliştirme paketi — Paket 06 kullanıcılar, roller ve oturum

### Aşama 43 — Yönetişim ve karar

- [x] CLAUDE.md otonom kuralları ayrı dalda atomik commit'e alındı (governance/claude-autonomous-rules).
- [x] HB-2026-010: lifecycleStatus open|closed; workflowStage ayrı; türetilmiş operasyon görünümleri (K1/K2 kapandı).

### Aşama 44 — Kimlik/rol/oturum altyapısı

- [x] Contracts: auth login/logout/session şemaları, rol kataloğu, rate_limited kodu; golden fixture 8 şema; +6 test.
- [x] Migration 0002: users (lower(email) unique), roles seed (6), user_roles, sessions (token hash), append-only audit_events.
- [x] API auth modülü: Argon2id (0.44.0), sunucu taraflı iptal edilebilir oturum, güvenli çerez, IP rate limit + hesap kilidi, tekdüze 401 + zamanlama eşitleme, audit kayıtları; DATABASE_URL'siz API'de uçlar güvenli 404.

### Aşama 45 — Kanıt ve teslim

- [x] Gerçek DB uçtan uca testler (14): login/cerez/session/logout-revoke/kilit/429/enumeration/404.
- [x] Kapılar: typecheck/lint/test(424)/build/audit/diff-check exit 0; temiz checkout; tek atomik feat commit.

Kabul ölçütü: Oturumlar iptal edilebilir ve audit'lidir; brute-force iki katman korunur; sonraki tek mantıklı görev Paket 07'dir.

## Aktif geliştirme paketi — Paket 07 dosyalar salt okunur API

### Aşama 46 — Cases okuma modeli ve uçları

- [x] Kapı; `foundation/package-07-cases-read` dalı `3d2cd7d` üzerinden.
- [x] Migration 0003: cases + service_centers + insurers (HB-2026-010/012 kuralları, indeksler); database tablo beklentileri güncellendi.
- [x] Auth guard modülü (`requireSession`) ayrıştırıldı; cases uçları oturum + tenant kapsamıyla eklendi; sorgular parametreli ve salt okunur; yanıtlar contracts şemasıyla parse'lı.
- [x] 9 uçtan uca DB testi + canlı HTTP smoke (401 → login → arama); API vitest DB dosyaları sıralı koşacak şekilde ayarlandı.
- [x] Kapılar: typecheck/lint/test(433)/build/audit/diff-check exit 0; temiz checkout; tek atomik commit.

Kabul ölçütü: Anonim seed üzerinde liste/detay sözleşmeye uygun döner; endpoint DB'ye yazmaz; sonraki tek mantıklı görev Paket 08'dir.

## Aktif geliştirme paketi — Paket 08 UI mock/API adapter ayrımı

### Aşama 47 — DataPort sınırı ve kademeli bağlama

- [x] Governance: çalışma modu merdiveni + path-bazlı stage kuralı ayrı commit (`166dff3`); dal `foundation/package-08-ui-data-port`.
- [x] `src/data`: ports, MockDataAdapter, HttpApiAdapter (DTO→CaseRecord türetilmiş görünümlerle), güvenli fallback, `useCases` (ilk render mock-özdeş; localStorage opt-in).
- [x] Dosyalar + Dosya Detayı porta bağlandı; diğer ekranlar kademeli plan gereği mock'ta; Vite dev proxy `/api`.
- [x] Testler: 26 baseline değişmeden + 7 veri katmanı + 2 env-kapılı canlı smoke (gerçek API'de 2/2).
- [x] Tarayıcı kanıtı: varsayılan mod baseline-özdeş; api modu oturumsuz → fallback aynı liste; konsolda yalnız info.
- [x] Kapılar: typecheck/lint/test(440)/build/audit/diff-check exit 0; temiz checkout; path-bazlı stage ile tek feat commit.

Kabul ölçütü: Kabul edilmiş UI davranışı değişmeden DataPort sınırı çalışır; API kesintisinde UI mock ile kırılmadan sürer; sonraki tek mantıklı görev Paket 09'dur.

## Aktif geliştirme paketi — Paket 09 dosya yazma komutları

### Aşama 48 — kritik işlem modeli ile yazma uçları

- [x] Contracts: `caseCreateRequestSchema` + `caseUpdateRequestSchema` (strict; `expectedVersion` zorunlu; en az bir alan); `IDEMPOTENCY_KEY_HEADER`; ofis no/lifecycle/plaka/tür komutla değiştirilemez; golden JSON Schema 8 → 10; dal `foundation/package-09-cases-write`.
- [x] Migration 0004: `office_counters` (firma+yıl monoton sayaç) + `idempotency_keys` (org+scope+key benzersiz, saklanan yanıt).
- [x] Yazma katmanı: tek transaction (referans → ofis no UPSERT RETURNING → kayıt → A1 audit → idempotency → COMMIT); başarısız transaction sayacı tüketmez; `SELECT ... FOR UPDATE` + `expectedVersion` optimistic locking; audit yalnız güvenli özet.
- [x] Uçlar: POST `/api/v1/cases` (oturum + Idempotency-Key zorunlu, replay + `idempotency_conflict`), PATCH `/api/v1/cases/:caseId` (tenant kapsamlı, `version_conflict`, bilinmeyen referans 400).
- [x] Testler: 9 gerçek-DB write testi + canlı HTTP yazma smoke 7/7.
- [x] Kapılar: typecheck/lint/test(457)/build/audit/diff-check exit 0; temiz checkout; path-bazlı stage ile tek feat commit.

Kabul ölçütü: Oluşturma sıralı ofis numarası atar ve idempotency tekrarında kopya üretmez; başarısız transaction ofis sayacını tüketmez; güncelleme optimistic locking ile bayat sürümü 409 reddeder; kapanış/yeniden açma bu pakette YOKTUR; sonraki tek mantıklı görev Paket 10'dur.

## Aktif geliştirme paketi — Paket 10 UI oturum yönetimi ve gerçek API entegrasyonu

> Numara notu: Kullanıcı Paket 10'u UI oturum yönetimi + gerçek API entegrasyonu olarak yönlendirdi (Paket 08 UI/API sınırının tamamlayıcısı). Altyapı planındaki özgün "Paket 10 — Audit altyapısı" ayrı ve sonraki bir pakete ötelendi (HB-2026-016).

### Aşama 49 — oturum kapısı ve komut sınırı

- [x] İki mod: `mock` (varsayılan, oturum kapısız baseline) / `api` (gerçek oturum); mock api hatasını maskelemez, sahte oturum yok; dal `foundation/package-10-ui-session`.
- [x] `AuthPort` (bootstrap/login/logout → `/api/v1/auth/*`); HttpOnly çerez, parola/token UI'da saklanmaz; `SessionProvider` + `sessionContext` gate; `LoginPage` yalnız api modda oturumsuz/expired.
- [x] 401 güvenli akışı: `useCases` → `reportUnauthorized` → `expired` → "Oturumunuz sona erdi" login; Topbar api modda gerçek kullanıcı + çıkış; mock modda baseline korunur.
- [x] `CaseCommandPort` (create Idempotency-Key + update expectedVersion → Paket 09 uçları); hata eşlemesi tam; mock komut adapteri yazma yapmaz. Yeni ekran tasarlanmadı (onaylı prototipte create/update ekranı yok).
- [x] Testler: +31 UI testi (authPort/commandPort/SessionProvider/App gate) + gerçek API e2e (login→…→logout) + tarayıcı e2e (login → gerçek liste → çıkış).
- [x] Kapılar: typecheck/lint(0 uyarı)/test(488)/build/audit/diff-check exit 0; temiz checkout; path-bazlı stage ile tek feat commit.

Kabul ölçütü: api modda oturumsuz kullanıcı login ekranı görür, giriş sonrası korumalı rotalar açılır, 401 güvenli "oturum sona erdi" akışı çalışır ve mock veri gerçek hatayı maskelemez; kabul edilmiş UI baseline'i (mock mod) değişmez; Google girişi/şifre sıfırlama/e-posta/close-reopen/File Agent/poliçe motoru kapsam dışıdır.

## Aktif geliştirme paketi — Paket 11 merkezi audit altyapısı

> Bu paket, altyapı planındaki özgün "Paket 10 — Audit altyapısı"nı gerçekler (HB-2026-016 ile ötelenmişti).

### Aşama 50 — merkezi, append-only, redaksiyonlu audit + sorgu API'si

- [x] Tek merkezi `AuditService.record(executor, event)` mevcut `audit_events` tablosuna yazar (paralel sistem yok); executor sayesinde iş transaction'ıyla atomik; dal `foundation/package-11-central-audit`.
- [x] Migration 0005: `BEFORE UPDATE/DELETE` trigger'ı ile veritabanı seviyesinde append-only + kiracı/varlık indeksleri.
- [x] Redaksiyon (`redact.ts`): hassas alan adı → `[redacted]`, uzun metin kırpma, derinlik/eleman sınırı; `summarizeChange` güvenli eski/yeni özet.
- [x] Merkeze taşıma: login/logout/kilit/oturum-iptali + case create/update; `store.insertAudit` kaldırıldı; auth yazımları `withTransaction` ile atomik.
- [x] Salt-okunur `GET /api/v1/audit-events`: oturum + yönetici (403 aksi), kiracı-kapsamlı, strict filtre + sınırlı pagination; yazma ucu yok. Contracts +2 şema (golden 12).
- [x] Testler: +17 API testi (append-only reddi, redaksiyon, atomik rollback, merkezi olaylar, sorgu, kiracı izolasyonu, 401/403) + redaksiyon birim + canlı HTTP güvenlik smoke 7/7.
- [x] Kapılar: typecheck/lint(0 uyarı)/test(507)/build/audit/diff-check exit 0; temiz checkout; path-bazlı stage ile tek feat commit.

Kabul ölçütü: Audit tek merkezi katmandan, iş işlemiyle atomik yazılır; append-only DB'de zorlanır (UPDATE/DELETE reddedilir); parola/token/cookie/tam poliçe metni audit'e sızmaz; sorgu API'si yalnız yetkili kullanıcıya kiracı-kapsamlı, filtreli ve sayfalı sonuç döner; retention/export yalnız plandır; UI audit ekranı/close-reopen/File Agent/SIEM/üretim migration kapsam dışıdır.

## Aktif geliştirme paketi — Paket 12 depolama referansı ve güvenli göreli yol temeli

### Aşama 51 — storageRootKey + güvenli göreli yol + vaka konumu

- [x] Domain `parseRelativePath`/`parseStorageRootKey`/`parseStorageLocation`: traversal/absolute/sürücü/UNC/backslash/kontrol/yasak-karakter/aygıt-adı reddi; +35 birim testi; dal `foundation/package-12-storage-location`.
- [x] Contracts: `storageRootKeySchema`/`relativePathSchema` primitives + `v1/storage` (roots/location/history dto + assign komutu); golden 12→16.
- [x] Migration 0006: `storage_roots` (mutlak yol kolonu yok), `case_locations` (optimistic lock + composite FK + güvenlik CHECK), `case_location_history` (append-only trigger + CHECK).
- [x] API: `GET /storage-roots`; `GET/PUT /cases/:caseId/location` (optimistic lock, 409/404/400 unknown_reference); `GET .../location/history`. Atama tek transaction'da konum + geçmiş + merkezi audit; mutlak yol yanıta/audit'e sızmaz.
- [x] Testler: +12 API testi (atama/optimistic-lock/tenant/unknown-root/traversal-red/geçmiş/audit-no-absolute/DB-CHECK/append-only) + canlı HTTP güvenlik smoke 10/10.
- [x] Kapılar: typecheck/lint(0 uyarı)/test(558)/build/audit/diff-check exit 0; temiz checkout; path-bazlı stage ile tek feat commit.

Kabul ölçütü: DB yalnız mantıksal rootKey + güvenli göreli yol saklar (mutlak `P:\`/sürücü/UNC yazılmaz); traversal/absolute/backslash hem uygulama hem DB CHECK ile reddedilir; konum atama optimistic locking + kiracı izolasyonu + merkezi audit ile atomiktir; geçmiş append-only; mutlak yol yanıt/audit/log'a sızmaz; pCloud/`P:\` mevcut kök belgelenir ve başka disk/NAS'a config ile taşınabilir; gerçek klasör işlemleri/File Agent/P: tarama/close-reopen/Electron/fiziksel yükleme/UI kapsam dışıdır.

## Aktif geliştirme paketi — Paket 13 belge/belge sürümü/fotoğraf metadata temeli

### Aşama 52 — metadata modeli + güvenli registration + doğrulama-hazır durum

- [x] Domain `file-metadata.ts`: güvenli dosya adı, uzantı türetimi, uzantı↔MIME tutarlılığı (allow-list), SHA-256 biçimi; +9 birim testi; dal `foundation/package-13-document-metadata`.
- [x] Contracts `v1/documents`: durum/kaynak enum, belge/sürüm/fotoğraf dto, register komutları, liste sorgusu; golden 16→21.
- [x] Migration 0007: `documents` (optimistic `version`), `document_versions` (immutable + `ready` CHECK + previous-version), `photos`; `metadata_append_guard` (DELETE + kayıtlı-gerçek değişimi reddi, yalnız doğrulama alanları güncellenebilir); safe-path CHECK + unique path.
- [x] API + `db/idempotency.ts`: `POST /cases/:caseId/documents` (yeni belge/sürüm, optimistic lock, zorunlu Idempotency-Key, MIME/uzantı + kategori + tehlikeli-ad doğrulaması, duplicate tespiti/birleştirmesiz), `POST /cases/:caseId/photos`; salt-okunur `GET` liste/detay uçları. Kayıt daima `pending`; merkezi audit; mutlak yol sızmaz.
- [x] Testler: +12 API testi (kayıt/sürüm/optimistic-lock/idempotency/MIME-uyuşmazlık/tehlikeli-ad/duplicate/kategori/tenant/okuma/ready-CHECK/immutable/append-only/audit-no-absolute) + canlı HTTP güvenlik smoke.
- [x] Kapılar: typecheck/lint(0 uyarı)/test(584)/build/audit/diff-check exit 0; temiz checkout; path-bazlı stage ile tek feat commit.

Kabul ölçütü: Belge/sürüm/fotoğraf metadata'sı tenant izolasyonlu kaydedilir; kayıt daima `pending`; istemci/genel API `ready`/hash-doğrulandı/dosya-mevcut sonucunu belirleyemez (DB CHECK + append-only trigger ile mekanik zorlama); `content_hash` yalnız beyandır; MIME/uzantı uyuşmazlığı ve tehlikeli ad reddedilir; aynı dosya tespit edilir ama vakalar arası sessiz birleştirme yapılmaz; sürüm geçmişi append-only + optimistic locking; okuma uçları kiracı kapsamlıdır; mutlak yol yanıt/audit/log'a sızmaz; File Agent doğrulama akışı belgelenir; gerçek yükleme/içerik/OCR/thumbnail/AI/File Agent/close-reopen/UI kapsam dışıdır.

## Aktif geliştirme paketi — Paket 14 File Agent kontrol katmanı ve doğrulama protokolü

> Bu paket, altyapı planındaki "Paket 12 — File Agent iskeleti"ni gerçekler.

### Aşama 53 — agent kimliği + iş kuyruğu + streaming doğrulama

- [x] Ayrı workspace `services/file-agent` (DB bağımlılığı yok; yalnız API üzerinden); yerel `rootKey→mutlak root` config'i; dal `foundation/package-14-file-agent`.
- [x] Migration 0008: `agents` (secret yalnız SHA-256 hash, enable/disable, last_seen) + `jobs` (SKIP LOCKED claim, lease/heartbeat/timeout recovery, attempt/backoff/dead_letter, güvenli payload CHECK'i).
- [x] Contracts `v1/agent` (job/claim/result/agent dto + komutlar); golden 21→24.
- [x] API: agent auth (x-agent-id/secret, hash karşılaştırma, org kapsamı), yönetici agent kayıt/enable-disable/liste, claim/heartbeat/result protokolü; doc/photo/location kaydında aynı transaction'da enqueue; `x-agent-secret` log redaksiyonu.
- [x] File Agent: path-resolver (traversal/drive/UNC + realpath symlink/junction escape reddi), verifier (streaming SHA-256, boyut gerçek dosyadan, missing/failed), api-client, run loop (heartbeat'li).
- [x] Doğrulama: gözlenen ile beyan SUNUCUDA karşılaştırılır → ready/failed/missing; metadata+iş+audit atomik; sürüm yarışında ezme yok; idempotent; agent istemci hash'ine güvenmez.
- [x] Testler: +12 agent-side birim + +15 API (auth/SKIP-LOCKED/lease/recovery/retry-dead_letter/verify-ready/mismatch/missing/race/idempotency/tenant/security) + 3 gerçek uçtan uca + canlı smoke 7/7 (semantik JSON).
- [x] Kapılar: typecheck/lint(0 uyarı)/test(614)/build/audit/diff-check exit 0; temiz checkout; path-bazlı stage ile tek feat commit.

Kabul ölçütü: Agent yalnız API üzerinden çalışır (DB'ye yazmaz), yalnız kendi org + atanmış işiyle sınırlıdır; aynı iş iki agent tarafından uygulanamaz (SKIP LOCKED); lease/heartbeat/timeout recovery + retry/backoff/dead_letter çalışır; mutlak root yalnız agent config'inde kalır ve API/DB/audit/log'a sızmaz; traversal/drive/UNC/symlink-junction kaçışı reddedilir; SHA-256 streaming hesaplanır (dosya belleğe alınmaz); gözlenen beyanla eşleşince `ready`, uyuşmazsa `ready` olmaz; metadata+iş+audit atomik ve sürüm-yarışına dayanıklıdır; sonuç idempotenttir; ham secret/mutlak yol/ham hata API'ye taşınmaz; gerçek dosya işlemleri/upload/OCR/thumbnail/AI/Electron/UI/LAN-TLS/üretim migration kapsam dışıdır.

## Aktif geliştirme paketi — Paket 15 koşullu evrak gereksinimi motoru

- [x] Saf domain motoru: kanonik belge türleri, all_of/any_of/exactly_one geleceğe açık model, doğrulanmış ready kuralı, açıklanabilir sonuç ve sürüm.
- [x] Migration 0009: sürümlü rule set/version seed'i, isteğe bağlı evaluation snapshot tabloları ve kesinleşmiş rücu durumu alanı.
- [x] Contracts + API: oturumlu, tenant-kapsamlı salt-okunur `GET /api/v1/cases/:caseId/document-requirements`; yanıt mutlak yol veya belge içeriği içermez.
- [x] Audit: GET çağrısı snapshot oluşturmadığı için audit yazmaz; gürültü önlenir ve karar günlüğünde belgelenir.
- [x] Son doğrulama: gerçek PostgreSQL 0009 up/repeat/down-up/constraint; canlı HTTP smoke; ana ağaç typecheck/lint/637 test/build/audit/diff-check; temiz kopyada fresh npm ci + typecheck/lint/test/build geçti.

## Aktif geliştirme paketi — Paket 16 Evrak ve Fotoğraf gerçek API entegrasyonu

- [x] `CaseDocumentsDataPort` + HTTP adapter + hook: requirements, belge listesi/detayı ve fotoğraf metadata listesi; API modunda mock fallback yok.
- [x] Güvenlik sınırı: yalnız güvenli göreli yol; mutlak/UNC/traversal reddi; ready için fiziksel doğrulama kanıtı; içerik/hash/secret UI'ye taşınmaz.
- [x] Onaylı iki sütunlu sekme: Trafik/Kasko/Olay/Rüculu Kasko grupları, durum/gerekçe/kural sürümü, belge sürümü ve fotoğraf metadata tabloları.
- [x] Gerçek durumlar: loading, empty, 401, tenant 404, network/retry; pending/failed/missing ayrı rozet; mock 12/108 fotoğraf davranışı korunur.
- [x] Yapılandırma: localStorage açık seçimi öncelikli; seçim yoksa `VITE_DATA_SOURCE=api`; varsayılan mock değişmez.
- [x] Test: adapter + görünüm unit/integration, canlı gerçek API adapter, gerçek PostgreSQL/API/Vite tarayıcı e2e ve baseline regresyonu.

Kabul ölçütü: API modunda doğrulanmış metadata ve sürümlü kural sonucu açıklanabilir biçimde görünür; sahte fallback, mutlak yol veya içerik sızıntısı yoktur; UI yeni yazma/physical file işlemi yapmaz; mock baseline korunur.

## Aktif geliştirme paketi — Paket 17 Yeni İhbar ve temel dosya düzenleme UI

- [x] Gerçek create formu: Trafik/Kasko, kanonik plaka, ihbar/hasar numarası, mevcut workflow/takip/referans alanları; server ofis no + caseId sonucu ve detay yönlendirmesi.
- [x] Tekrar güvenliği: payload'a bağlı kararlı Idempotency-Key, submit sırasında senkron çift-tıklama engeli, retry'da aynı anahtar.
- [x] Gerçek edit formu: contract destekli alanlar + `expectedVersion`; başarılı yanıtta yeni version; 409 conflict + yeniden yükleme; immutable alanlar read-only, close/reopen yok.
- [x] Veri kaynağı dürüstlüğü: mevcut oturum kullanıcısı gerçek sorumlu seçeneği; liste endpoint'i olmayan servis/sigorta açıkça kimlik alanı; contract dışı eksper/olay tarihleri disabled; API modunda mock fallback yok.
- [x] Güvenli hata/UI: fieldErrors eşleme; 401/login, 404, unknown_reference, validation, conflict, 5xx/ağ; ham SQL/stack/secret yok; mock modal baseline'i korunur.
- [x] Test: form unit/component, CaseCommandPort hata metadata'sı, gerçek PostgreSQL/API idempotency+audit, canlı browser create/update/conflict/reload/401/network ve 1366/1920 açık-koyu kontrolü.

Kabul ölçütü: Mevcut create/update API sözleşmesi dışına çıkmadan mükerrersiz oluşturma ve optimistic-lock düzenleme çalışır; backend kimlik/numara/sürüm sonucu görünür; immutable/kapsam dışı alanlar yazılmaz; mock baseline ve güvenlik sınırları korunur.

## Aktif geliştirme paketi — Paket 18 Referans Veriler ve Case Çekirdeği

- [x] Migration 0010: aktif servis/sigorta bayrakları; nullable eksper/hasar/ihbar tarihleri; LocalDate constraint ve indeksler.
- [x] Contracts/API: dört tenant-kapsamlı aktif katalog; gerçek expert rolü; Case create/update/read/audit alanları; deterministik JSON Schema fixture'ları.
- [x] UI: `CaseReferenceDataPort`/HTTP adapter/hook; gerçek seçim listeleri, LocalDate alanları, pasif mevcut ilişki davranışı; API hata halinde mock fallback yok.
- [x] Gerçek PostgreSQL/API testleri ve canlı HTTP smoke.
- [x] Tarayıcı e2e + 1366/1920 açık-koyu: Codex Browser bootstrap hatası repository dışı olarak ayrıştırıldı; kurulu Chrome DevTools protokolüyle login, referanslar, create/update, 409/reload, negatif referanslar, no-fallback, overflow ve konsol kapıları geçti.

Kabul ölçütü: Aktif ve tenant-kapsamlı gerçek referanslar create/edit'te seçilir; eksper roles kaynaklıdır; yeni alanlar LocalDate/read/write/audit boyunca korunur; pasif/uygunsuz referans reddedilir; optimistic locking ve mock ayrımı korunur; tüm tarayıcı ve temiz checkout kapıları yeşil olmadan paket tamamlandı sayılmaz.

## Aktif geliştirme paketi — Paket 19 güvenli Case çalışma klasörü

- [x] Saf domain yol planı: notificationDate, Türkçe ay, kanonik plaka ve deterministik `-2/-3` seçimi.
- [x] Migration 0011: provisioning rezervasyonu/durumları, logical path kısıtları, genişletilmiş job türü ve tek aktif provisioning job.
- [x] Tenant/oturum/idempotency korumalı plan, preview/status ve approve API sözleşmeleri.
- [x] File Agent: bileşen bazlı idempotent mkdir, beş alt klasör, realpath/lstat reparse-point koruması, partial-failure/no-delete ve progress heartbeat.
- [x] Atomik finalize: stale location kontrolü; verified case location + append-only history + provisioning/job + merkezi audit.
- [x] Dosya Detayı API paneli: aktif root, preview, açık onay, durum/retry; mock modda fiziksel işlem ve API hata fallback’i yok.
- [x] Son kapılar: tam gerçek PostgreSQL/API/temp-filesystem, gerçek tarayıcı, root kalite kapıları ve temiz checkout doğrulaması.

Kabul ölçütü: Plan diske yazmaz; onaysız iş yoktur; aynı case/idempotency/onay yarışı mükerrer klasör veya job üretmez; Agent doğru/kısmi yapıyı güvenle tamamlar ve doğrular; traversal/reparse/root escape reddedilir; stale job location’ı ezmez; mutlak yol/secret sızmaz; tarayıcı ve temiz checkout dâhil bütün kapılar geçmeden commit oluşturulmaz.
