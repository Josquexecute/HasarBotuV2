# HasarBotu V2 — Uygulama Planı

Bu plan, UI-first prototip aşamasını küçük, test edilebilir ve geri bildirime açık paketler halinde yürütmek için kullanılır.

## Durum anahtarı

- `[ ]` Başlanmadı
- `[-]` Devam ediyor
- `[x]` Tamamlandı ve doğrulandı
- `[!]` Engelli veya kullanıcı kararı gerekiyor

## Paket 65A — İşçilik workbook preflight ve immutable plan kaynağı

- [x] ZIP/OOXML güvenlik limitlerini ve kapalı hata kodlarını saf domain
  fonksiyonlarında uygula.
- [x] Uygulanan kategori provenance'ı dışında plan kaynağı üretme; operasyon
  türünden kategori dağılımı türetme.
- [x] File Agent'ta göreli yol + yerel root sınırıyla salt-okunur workbook
  preflight uygula.
- [x] ZIP merkezi dizinini açmadan önce entry count/boyut/oran/şifreleme ve
  zip-slip kapılarını çalıştır.
- [x] Makro, VBA, dijital imza, embedded object ve external relationship'i
  fail-closed reddet.
- [x] Hedef worksheet part'ını OOXML relationship zincirinden çöz; dosya adı
  veya `sheetN.xml` tahmini yapma.
- [x] Görünür sheet, header/identity içerik imzası, beklenen hash/size ve
  başlangıç/bitiş hash eşitliğini doğrula.
- [x] Sentetik `.xlsx` testleriyle kaynak byte'larının değişmediğini ve temp
  alanın temizlendiğini doğrula.

Kapsam dışı: File Agent job kuyruğu, migration, contracts/API/UI, backup,
geçici yazım, atomik replace ve fiziksel `.xlsx` değişikliği. Bunlar açık
kullanıcı onaylı kritik işlem modeliyle Paket 65B'dedir.

## Paket 65B — güvenli İşçilik workbook fiziksel yazım katmanı

- [x] Fiziksel yazımdan önce 65A preflight'ını çalıştır; onay anında aynı hash,
  boyut, mtime, worksheet relationship'i ve içerik imzasını yeniden doğrula.
- [x] Salt-okunur değişiklik önizlemesi ve deterministik plan hash'i üret;
  önizlenen planla birebir eşleşen açık kullanıcı onayı olmadan yazma.
- [x] Yalnız doğrulanmış hedef worksheet üzerindeki `D2:D1048576` hücrelerini
  kabul et; başlık/kimlik/formül hücresini, `H–N` ve diğer bütün sütunları
  fail-closed reddet.
- [x] Kaynak yanında zaman damgalı ve `COPYFILE_EXCL` korumalı `.bak.xlsx`
  oluştur; backup byte'larını kaynakla birebir doğrula.
- [x] Aynı dizindeki geçici `.xlsx` dosyasına yaz, fsync et, 65A preflight ve
  OOXML part karşılaştırmasıyla doğrula, sonra aynı volume üzerinde atomik
  replace uygula.
- [x] Replace öncesi kaynak değişimini yeniden kontrol et; replace sonrası veya
  audit kesinleştirmesi başarısızsa backup'tan atomik rollback ile başlangıç
  byte'larını geri getir.
- [x] Workbook yanında exclusive lock ile aynı kaynağa eşzamanlı ikinci yazımı
  engelle; temp/lock kalıntısını kontrollü temizle.
- [x] Audit callback'inde başlangıç/sonuç SHA-256, plan hash, hücre adresleri,
  backup dosya adı ve güvenli hata kodunu taşı; hücre değeri veya mutlak yol
  taşıma.
- [x] Yalnız sentetik `.xlsx` kullanan File Agent testlerinde başarılı yazım,
  onaysız/stale/yanlış plaka/makro/external link, `H–N` korunumu, eşzamanlı lock,
  replace hatası ve rollback davranışını doğrula.

Kapsam dışı: D hücre değerlerini üreten iş kuralı/satır eşlemesi, PostgreSQL
operation kaydı, File Agent job payload'ı, contracts/API/UI ve gerçek müşteri
workbook'u. Mevcut modelde bu değer kaynağı tanımlı olmadığı için tahmin
edilmedi; runtime entegrasyonu bu güvenli çekirdeği ayrıca çağıracaktır.

## Paket 66 — 01.07.2026 Değer Kaybı — TAMAMLANDI VE KABUL EDİLDİ

### Commit #1 — `feat: add 2026-07-01 value loss rule snapshot`

- [x] Kaynak workbook SHA-256 değerini çıkarım öncesi fail-closed doğrula.
- [x] Generic salt-okunur ve relationship tabanlı OOXML extractor ekle.
- [x] Sheet ad/state, sharedStrings, merged cell, hidden row/column, validation,
  formula ve cached value görünümünü çıkar.
- [x] `real-market-analysis/2026-07-01/1.0.0` normalize snapshot, JSON Schema ve
  redacted manifest üret.
- [x] 3 `source_workbook` ve 11 `product_decision` mapping'i ayrı provenance ile
  sakla; `source_vehicle_name_column_incomplete` anomalisi zorunlu olsun.
- [x] Altı aktif parça tablosunu programatik çıkar; placeholder, sigortacı,
  dormant ve excluded kaynakların aktif kurala sızmasını engelle.
- [x] Stable ID içinde araç grubu, kaynak tablo, kaynak satır, normalize etiket
  ve işlem capability bileşenlerini zorunlu tut.
- [x] Canonical JSON/snapshot hash determinismi ile beş kasıtlı mutation
  regresyonunu doğrula.
- [x] Tam kalite zincirini ve workbook'suz repository-dışı fresh checkout'u çalıştır.
- [x] Yalnız path-based staging yap ve Commit #1'i oluştur.

Kapsam dışı: hesap motoru, Paket 65A/65B, Dosya Envanteri, API/UI, persistence,
migration, fiziksel Excel yazımı, Gemini, remote/push ve sonraki Paket 66
commitleri.

### Commit #2 — `feat: integrate new value loss calculation revision`

- [x] Sürüm seçimli runtime motoru, immutable revision, contracts,
  persistence/API/UI ve Paket 40 current-approved entegrasyonunu tamamla.
- [x] Migration 0043 forward/rollback/reapply davranışını doğrula.

### Commit #3 — `test: harden value loss revision integration`

- [x] Domain/contract/persistence/API/UI/Paket 40 sınır, güvenlik ve regresyon
  matrisini tamamla.
- [x] Paket 66 invariantlarını ve fresh-checkout kalite zincirini doğrula.

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

## Aktif geliştirme paketi — Paket 20 güvenli File Agent move/rename altyapısı

- [x] Migration 0012: file-operation saga kimliği, source/destination logical snapshot, case-insensitive destination reservation, tek aktif operation/case, idempotency, manifest/recovery/cleanup alanları; mevcut jobs/location history genişletmesi.
- [x] Contracts/API: tenant+oturum+Idempotency-Key korumalı plan/read/approve/cancel; doğrulanmış location + expected version; güvenli response/error ve deterministik JSON Schema fixture'ları.
- [x] File Agent same-volume atomic rename, operation-specific case-only temp rename, no-overwrite/no-merge ve restart/replay recovery.
- [x] Cross-root/EXDEV staged-copy: streaming SHA-256+size manifest, staging verify, atomic publish, transaction içinde location switch ve ayrı retry edilebilir cleanup job.
- [x] Recovery: cleanup_pending, stale ve manual_recovery_required; kaynak değişiminde silmeme, belirsizlikte kör rollback yapmama; server-side ownership/lease/version/reservation/manifest yeniden doğrulaması.
- [x] Merkezi audit: plan/onay/başlatma/doğrulama/location switch/cleanup/finalize/failure/manual recovery; logical path ve güvenli sayaçlar, mutlak path/secret/içerik yok.
- [x] Gerçek PostgreSQL ve sentetik geçici filesystem testleri; fault-injected EXDEV/disk-full/locked/hash/partial/recovery; gerçek HTTP/API-Agent smoke. Gerçek `P:\` veya müşteri verisi yok.
- [x] Son root kalite kapıları ve repository dışı fresh `npm ci` temiz checkout doğrulaması; atomik commit yalnız path-bazlı staged kapsam kontrolünden sonra.

Kabul ölçütü: Kullanıcı onayı öncesi filesystem değişmez; tek aktif operation ve destination reservation DB'de zorlanır; same-volume rename ve staged-copy veri kaybı/overwrite olmadan doğrulanır; location switch olmadan source cleanup yapılmaz; cleanup/recovery idempotent ve belirsizlikte fail-closed'dur; mutlak root/secret/ham hata sınırı korunur; Paket 21 close/reopen veya son kullanıcı taşıma UI'si bu pakette uygulanmaz.

## Aktif geliştirme paketi — Paket 21 güvenli case close/reopen yaşam döngüsü

- [x] Open/closed lifecycle ile workflow stage ayrımı ve geçersiz kombinasyonların DB/contract/domain seviyesinde reddi.
- [x] Server-side close/reopen planı: güncel case/location sürümü, doğrulanmış location, aktif operation/job ve manual recovery ön kontrolleri.
- [x] Paket 15 belge motoru üzerinde kapanışa özel sürümlü gereksinim katmanı; normal kapanış ve gerekçeli/snapshot'lı eksiklerle kapatma.
- [x] `YYYY/Ay YYYY/KAPALI AY YYYY/workspace` hedefi ve son append-only açık konuma reopen hedefi; istemciden serbest path yok.
- [x] Paket 20 move/rename operation + mevcut queue/Agent kullanımı; hedef doğrulaması ve location switch olmadan lifecycle finalize etmeme.
- [x] Migration 0013 lifecycle operation, append-only history, idempotency, tek aktif operation ve destination reservation modeli.
- [x] Tenant/role kapsamlı plan/approve/read/cancel API, merkezi audit ve güvenli response/hata sınırı.
- [x] Case detayında gerçek close/reopen preview/onay/durum/recovery UI'si; API modunda mock fallback yok.
- [x] Gerçek tarayıcı/canlı TCP close→reopen smoke, tam root kapıları ve repository dışı fresh `npm ci` temiz checkout.

Kabul ölçütü: Onaydan önce fiziksel/lifecycle değişikliği yoktur; normal ve eksiklerle kapanış ayrımı açıklanır; fiziksel hedef doğrulanmadan closed/open finalize edilmez; aynı case/ofis numarası korunur; history append-only, recovery fail-closed, mutlak yol/secret sınırı korunur; kritik DB/API/Agent/tarayıcı doğrulaması skip kalmaz.

## Aktif geliştirme paketi — Paket 22 servis profili ve sigortacı anlaşması

- [x] Saf domain modeli: servis türü, anlaşma durumu, tarih/işlem/insan onayı facts'i ve sürümlü deterministik `eligible | not_eligible | control_required` sonucu.
- [x] Migration 0014: backward-compatible servis profili backfill'i, tenant-güvenli `insurer_service_agreements`, tarih/operasyon/onay/version kısıtları; eski servisler için sessiz anlaşma seed'i yok.
- [x] Contracts/API: sigortacı, LocalDate ve işlem bağlamlı servis referans query'si; Case read/create/update servis profili; aktif/tenant referans sınırı ve optimistic Case update korunur.
- [x] Paket 21 kapanış katmanı `2026.07.14.2`: yetkili profil veya ilgili sigortacı/tarihte onaylı anlaşma; belirsiz eski ilişki `control_required`.
- [x] Merkezi Case/lifecycle audit özetinde yalnız güvenli değerlendirme kodları/sürümleri/kimlikleri; kaynak metni, kişisel veri ve secret yok.
- [x] Create/edit UI'da Türkçe servis türü ve seçili sigortacı anlaşma sonucu; API modunda mock fallback yok.
- [x] Tam root, gerçek PostgreSQL, gerçek tarayıcı ve repository dışı fresh `npm ci` kapılarının son çalıştırması.

Kabul ölçütü: Yetkili servis anlaşmalı diye işaretlenmez; aynı servis iki sigortacıda farklı ve tarihsel sonuç verebilir; bilinmeyen eski ilişki fail-closed `control_required` olur; Case ve kapanış cevapları kullanılan sürümü taşır; tenant, aktiflik, optimistic locking, audit ve UI no-fallback sınırları gerçek testlerle doğrulanmadan paket tamamlanmaz.

## Paket 23 — Kanıtlı Kasko poliçe analiz çekirdeği

- [x] Saf domain: kanonik enumlar, kaynak validator, version state, precedence/conflict, çoklu muafiyet ve fail-closed scenario evaluator.
- [x] Contracts: kontrollü import/version/approve/reject/conflict/evaluate şemaları ve deterministik JSON Schema fixture'ları.
- [x] Migration 0015: normalize facts, tenant bileşik FK, ready-source guard, append-only evidence/evaluation ve approved immutability.
- [x] API: Kasko/tenant/rol/idempotency/optimistic locking/merkezi audit; list/detail/version/approve/reject/conflict/evaluate.
- [x] UI: yalnız Kasko case'te gerçek API analiz görünümü; kaynak sayfa/madde ve no-fallback senaryo paneli; mock baseline korunur.
- [x] Tam root, gerçek PostgreSQL, canlı API/tarayıcı ve repository dışı fresh `npm ci` kapıları tamamlandı; doğrulama sonuçları PROJECT_STATUS'a işlendi.

Kapsam dışı: PDF binary/OCR/LLM, upload, gerçek tedarik/mobil onarım yazısı, File Agent/IPC, üretim migration ve gerçek müşteri poliçesi.

## Paket 24 — Güvenli Kasko PDF metin çıkarımı

- [x] Exact parser araştırması/pin: `pdfjs-dist@6.1.200`; lisans ve Node 24 uyumu doğrulandı.
- [x] Saf domain normalizasyon/hash/segment/status kuralları ve strict contracts/JSON Schema fixture’ları.
- [x] Migration 0016: extraction/page/segment, tenant FK, append-only/terminal guard, queue genişlemesi ve Package 23 locator bağı.
- [x] File Agent: safe resolver/reparse reddi, streaming hash+temp copy, izole worker, limit/timeout, chunk ve deterministic summary.
- [x] API: tenant/RBAC/idempotency, queue/lease/chunk/finalize, cancel/source-reference ve merkezi audit.
- [x] UI: Kasko belge sekmesinde gerçek PDF extraction durumu, sayfa/segment ve no-fallback kaynak görünümü; mock fiziksel işlem yapmaz.
- [x] Tam root, tarayıcı ve repository dışı fresh checkout kapılarının nihai sonuçları PROJECT_STATUS’a işlendi.

Kapsam dışı: OCR, LLM/AI, otomatik poliçe analizi/onayı, upload, File Agent deployment, üretim migration, gerçek `P:\\` ve müşteri poliçesi.

## Paket 25 — Yerel ve güvenli poliçe OCR hattı

- [x] `tesseract.js@7.0.0`, Türkçe/İngilizce asset exact pin, boyut/SHA-256 manifesti ve offline dağıtım sınırı.
- [x] Saf domain: raw/normalize katman, render/preprocess/locator version, Unicode offset, geometri/reading-order, çok sinyalli kalite ve fail-closed PDF/OCR composite.
- [x] Strict contracts + 60 deterministik JSON Schema: run/page/element/chunk/result/source locator ve Agent phase/protokolü.
- [x] Migration 0017: run/page/block/line/word, exact identity, tenant FK, geometry/range guard, append-only snapshot ve Paket 23 OCR locator bağları.
- [x] File Agent: mevcut queue/lease, safe resolver, source hash+PDF magic, operation temp, yerel asset, izole worker, memory/time/result limit, chunk ve temp cleanup.
- [x] API: Kasko eligibility, RBAC, idempotency, cancel, farklı render profile retry, server-side chunk/finalize/source-reference doğrulaması ve merkezi audit.
- [x] UI: OCR geçmişi/progress, dil/render/profile, raw/normalize metin, Paket 24 karşılaştırması, kalite/reading order, geometri ve bounded kaynak locator; no-fallback/mock güvenliği.
- [x] Tam root, tarayıcı, canlı smoke ve repository dışı fresh checkout kapıları tamamlandı; gerçek sonuçlar PROJECT_STATUS'a işlendi.

Kapsam dışı: cloud OCR, AI/LLM, spell correction, teminat/muafiyet yorumu, upload, Electron IPC, üretim migration, gerçek müşteri belgesi/`P:\` ve Paket 26.

## Paket 26 — Kanıtlı AI orchestration çekirdeği

Uygulanan sıra:

1. Paket 24/25 metadata’sından bounded, immutable source bundle ve stabil anchor üretimi.
2. API-owned, provider-neutral adapter ile beş deterministik test provider’ı; runtime network ve SDK olmadan timeout/cancellation.
3. Strict structured-output, server evidence ve conflict doğrulaması.
4. Disabled-by-default organization policy, integer budget ve append-only usage ledger.
5. Tenant/RBAC/idempotency/audit korumalı plan/start/read/cancel/usage API’leri.
6. Kasko detayında salt-okunur plan/candidate/source paneli ve no-fallback durumları.

Paket 27 accept/edit/reject ve Paket 23’e promotion yapacaktır. Paket 28 gerçek provider, secret ve PII payload güvenliği sınırını kuracaktır. Paket 26 bu işlere başlamaz.

## Paket 27 — AI adayı insan incelemesi ve Paket 23 promotion

- [x] Saf domain: review eylemleri, kanıtı yeniden doğrulanan düzenleme, deterministik review-set hash ve promotion readiness.
- [x] Contracts: review komutu/cevabı, promotion preview/confirm/sonuç DTO’ları ve deterministik JSON Schema fixture’ları.
- [x] Migration 0019: append-only review sürümü, Package 23 AI fact provenance’ı, promotion item/conflict geçmişi ve DB guard’ları.
- [x] API: tenant/RBAC/idempotency/optimistic locking; accept/edit/reject/control; preview ve atomik yeni Paket 23 taslak sürümü.
- [x] UI: candidate bazında insan kararları, gerekçeli modal, promotion özeti/onayı ve Paket 23 taslak gerçek görünümü; API modunda fallback yok.
- [x] Tam root, gerçek PostgreSQL/API, tarayıcı ve repository dışı fresh `npm ci` doğrulaması tamamlandı; PROJECT_STATUS gerçek sonuçlarla güncellendi.

Kapsam dışı: Paket 23 otomatik approval, gerçek cloud provider, provider secret/PII payload politikası, File Agent, background worker, üretim migration ve sonraki paket.

## Paket 28 — Gerçek AI provider, PII ve bütçe güvenlik sınırı

- [x] Provider-neutral adapter’a native-fetch OpenAI Responses implementasyonu; strict schema, bounded output, timeout/cancellation, `store:false` ve tools kapalı.
- [x] Deterministik source-anchor PII minimizasyonu/redaksiyonu ve immutable privacy snapshot/hash.
- [x] Server-only environment secret/config doğrulaması; provider varsayılan kapalı, allow-list ve integer bütçe hard stop.
- [x] Migration 0020 ile run privacy/retention/pricing alanları ve append-only ledger token sayaçları.
- [x] Gerçek provider adayının Paket 26 evidence doğrulaması, Paket 27 review ve Paket 23 pending draft promotion zinciri.
- [x] Kasko AI panelinde external provider/redaksiyon/retention/bütçe önizlemesi ve açık kullanıcı onayı; API modunda fallback yok.
- [ ] Yetkili production secret ve sağlayıcı retention onayıyla gerçek dış ağ poliçe pilotu. Geliştirme makinesinde secret bulunmadığından bu deployment adımı çalıştırılmadı.

Kapsam dışı: otomatik Paket 23 approval, File Agent/filesystem, yeni background worker, provider yönetim UI’si, üretim migration ve sonraki paket.

## Paket 29 — Gerçek Gemini ücretsiz-katman sentetik kalite ve recovery pilotu

- [x] Migration 0021: durable provider-call receipt, tek run/request kimliği, terminal immutability ve aktif/unknown maliyet rezervasyonu.
- [x] Provider çağrısını PostgreSQL transaction dışına çıkar; response-recorded finalize recovery ve outcome-unknown no-retry davranışını ekle.
- [x] Gemini GenerateContent adapter'ında strict structured output, tools/cached content kapalı, header-only secret ve official endpoint; provider response/request kimliklerini yalnız güvenli receipt metadata'sı olarak sakla.
- [x] HTTP 503'ü retryable provider-unavailable olarak eşle; 500/1500 ms bounded backoff, aynı receipt kimliği ve cancellation/ortak timeout sınırı uygula. `gemini-3.5-flash` 503 ile tükenirse yalnız sentetik pilotta bir kez ücretsiz stable `gemini-2.5-flash` fallback kullan; auth/kota/schema/evidence hatalarında fallback yapma.
- [x] Bütün Gemini GenerateContent modellerinde tek `responseMimeType/responseJsonSchema` structured-output payload'ı kullan; hatalı `responseFormat` ve model ayrımını kaldır; 4xx için ham body/message taşımayan bounded safe diagnostic üret.
- [x] Gerçek aday şemasını Gemini subset'ine sadeleştir: recursive `anyOf/additionalProperties` kaldır, `normalizedValueJson` wire alanını adapter'da parse et ve mevcut strict Zod/evidence doğrulamasını son otorite olarak koru.
- [x] Minimal nesneden üretim wire şemasına ve eski constraint gruplarına ilerleyen bounded canlı schema preflight ekle; 4xx ham metninden yalnız sabit neden ve izinli alan kodlarını türet.
- [x] Başarılı canlı yolu tek wire probe + extraction olarak sınırla; minimal kademeli tanıyı yalnız 400 reddi sonrasında çalıştır ve timeout aşamasını güvenli kodla ayır.
- [x] Scalar preflight için output bütçesini thinking-aware 4096 yap; preflight ve gerçek adapter'da ortak multi-part/thought-signature güvenli parser kullan ve finish reason'ı ayrı teşhis et.
- [x] Sade Gemini wire schema ile strict canonical DTO arasındaki sözleşme boşluğunu kapat: server-owned output version/limit/category/biçim kurallarını trusted system contract'a ekle ve canlı pilotta değer sızdırmayan alan/issue teşhisi üret.
- [x] Sürümlü sentetik kalite ölçümü: recall, precision, exact source anchor ve metin kanıtı basis-point sonuçları.
- [x] Açık opt-in, birincil stable `gemini-3.5-flash`, 503-only stable `gemini-2.5-flash` fallback, process secret, ücretsiz-katman retention açıklaması, official egress ve sentetik-veri sınırı isteyen fail-fast canlı pilot komutu.
- [x] Yetkili terminalde sentetik schema preflight ve gerçek Gemini çağrısı başarıyla tamamlandı; provider secret Codex process'ine veya repository'ye aktarılmadan kalite/kaynak/maliyet/egress ve retention kapısı doğrulandı.
- [x] Repository dışı fresh `npm ci` kopyasında typecheck, lint, gerçek `_test` PostgreSQL ile güncel 1014 başarılı / 6 mevcut ortam-koşullu UI skip ve build.
- [x] Gerçek çağrı sonrasında son kapıları yenile, Paket 29 dosyalarını path bazlı stage et ve atomik commit oluştur.

Kapsam dışı: gerçek müşteri poliçesi, otomatik review/promotion/approval, 503 dışı otomatik provider fallback, File Agent/filesystem, üretim migration ve sonraki paket.

## Paket 30 — Dosya detayında kullanıcı kontrollü Kasko poliçe analiz akışı

- [x] Mevcut Paket 24 PDF, Paket 25 OCR, Paket 26 plan/start, Paket 27 review/promotion ve Paket 23 analiz görünümünü tek Kasko dosya detayı çalışma alanında birleştir.
- [x] Doğrulanmış source parçalarını kullanıcı seçimine aç; boş seçimde planı engelle ve yalnız seçilen kaynakları mevcut plan API’sine gönder.
- [x] Plan ve provider start adımlarını ayrı tut; mevcut bundle/bütçe/retention/PII önizlemesi ile açık onay sınırını koru.
- [x] Candidate için server çözümlü belge, sürüm, extraction, sayfa, sourceAnchor, bounded excerpt, kalite ve hash bilgilerini güvenli kanıt dialogunda göster.
- [x] Accept/edit/reject/control kararlarını ve promotion preview/onayını mevcut append-only Paket 27 API’siyle yürüt.
- [x] Promotion sonrası oluşturulan Paket 23 pending taslak sürümünü aynı dosya detayında otomatik yenile; yeni sürümün kaynak sayfa/bölüm/madde zincirini görünür kıl.
- [x] API modunda mock fallback yapma; mock prototip davranışını ve mevcut tasarım sistemi/tab yapısını koru.
- [x] Root, gerçek PostgreSQL/API, tarayıcı ve repository dışı fresh `npm ci` kapılarını tamamla; gerçek sonuçları PROJECT_STATUS’a işle.
- [x] Paket 30 dosyalarını path bazlı stage et, staged kapsamı doğrula ve atomik commit oluştur.

Kapsam dışı: yeni provider/AI modeli, otomatik Paket 23 approval, yeni conflict çözüm UI’si, PDF/OCR motoru değişikliği, File Agent/filesystem, yeni migration/endpoint/dependency, üretim migration ve sonraki paket.

## Paket 31 — Gemini production/deployment güvenlik kapısı

- [x] API process environment’ında açık Gemini opt-in, safe secret normalizasyonu, model allow-list ve bounded output config’i ekle.
- [x] Production provider registry composition’ını Gemini/OpenAI server config’inden kur; provider kapalıyken boş registry ile çekirdeğin normal başlamasını koru.
- [x] Oturum korumalı salt-okunur provider availability contract/endpoint’i ekle; deployment ve organization policy kapılarını ayrı göster, secret döndürme.
- [x] Kasko AI panelini gerçek provider availability verisine bağla; yalnız yapılandırılmış provider seçimine izin ver ve API modunda mock fallback yapma.
- [x] Config, contracts, API/gerçek PostgreSQL ve UI regresyon testlerini ekle; salt-okunur endpoint’in audit yazmadığını ve secret sızdırmadığını doğrula.
- [x] Tam root kapıları ve repository dışı fresh `npm ci` doğrulaması tamamlandı; path bazlı stage ve atomik commit son teslim adımıdır.

Kapsam dışı: yeni provider/model, gerçek müşteri verisiyle çağrı, secret yönetim UI’si, otomatik fallback, migration, File Agent/filesystem, IPC, yeni dependency, üretim migration ve sonraki paket.

## Paket 32 — 01.07.2026 Trafik değer kaybı çekirdeği

- [x] Resmî Gazete 33278 ve SEDDK 2026/11 kaynaklarını sürümlü rule-set metadata’sına bağla; eski Ek-1 formülünü kullanma.
- [x] Saf domain: piyasa değer farkı, kusur baz puanı, minor-unit yuvarlama, emsal yeterliliği, belirsizlik ve ağır/tam hasar sonucu.
- [x] Strict contracts ve deterministik JSON Schema: girdiler, kanıtlar, emsaller, sonuç taslağı, version/read ve submit/approve/reject komutları.
- [x] Migration 0022: assessment/version, append-only evidence/comparable/approval history, tenant FK, optimistic version ve approved immutability.
- [x] API: Traffic-only, session/RBAC, idempotency, ready/verified document evidence, draft→submit→approve/reject ve güvenli audit.
- [x] Domain/contracts ve gerçek PostgreSQL migration/API hedef testleri.
- [x] Tam root kapıları, canlı TCP smoke ve repository dışı fresh `npm ci` doğrulaması tamamlandı; path bazlı stage ve atomik commit son teslim adımıdır.

Kapsam dışı: Kasko değer kaybı, UI entegrasyonu, ilan scraping, SBM entegrasyonu, AI rayiç tahmini, rapor/PDF üretimi, File Agent, IPC, yeni dependency, üretim migration ve sonraki paket.

## Paket 33 — Trafik değer kaybı gerçek dosya detayı entegrasyonu

- [x] Paket 32 API cevaplarını strict runtime kontrolüyle okuyan `TrafficValueLossDataPort` ve React hook sınırını ekle.
- [x] API modunda Trafik vaka için araç/kusur/parça/piyasa değerleri, güvenli emsal ve doğrulanmış belge metadata kanıtı girişini bağla.
- [x] Belge seçimini alan-bazlı açık kullanıcı işaretlemesine bağla; ready fakat fiziksel doğrulama kanıtı eksik sürümü kanıt seçimine alma.
- [x] Server hesaplama taslağı, kural sürümü, gerekçe/kaynak, belirsizlik ve submit uygunluğunu göster.
- [x] Immutable assessment version oluşturma, sürüm geçmişi, submit teyidi ve rol-kapsamlı insan approve/reject akışını ekle.
- [x] 401/403/404/409/5xx/ağ durumlarında güvenli mesaj ve API modunda no-fallback davranışını koru.
- [x] Mock Değer Kaybı prototipini değiştirme; API Kasko vakada sahte sonuç üretme.
- [x] Unit/component, gerçek PostgreSQL/API ve gerçek tarayıcı kapılarını; açık/koyu 1366×768 ve 1920×1080 taşma/console kontrolünü çalıştır.
- [x] Tam root ve repository dışı fresh `npm ci` kalite zincirini tamamla; yalnız Paket 33 dosyalarını path bazlı commit et.

Kapsam dışı: yeni migration/endpoint/domain formülü, Kasko değer kaybı, ilan scraping, SBM entegrasyonu, AI rayiç tahmini, PDF/rapor, File Agent, IPC, yeni dependency, üretim migration ve sonraki paket.

## Paket 34 — Trafik değer kaybı nihai rapor önizleme ve çıktı

- [x] Onaylı/superseded insan onaylı version’dan kaynak, emsal, hesaplama, belirsizlik ve kural sürümünü deterministik rapor content snapshot’ına dönüştür.
- [x] Salt-okunur önizleme ile açık kullanıcı onaylı, idempotent nihai rapor üretimini ayır; stale preview/assessment version’ı reddet.
- [x] Migration 0023 ile version başına tek immutable rapor, tenant FK, content/PDF digest, byte-size, şema/şablon sürümü ve append-only guard ekle.
- [x] Tenant/oturum/RBAC korumalı preview, generate, list/detail ve doğrulanmış PDF download endpoint/contracts/JSON Schema ekle.
- [x] API-owned, Türkçe font gömülü, A4 ve çok sayfalı deterministik PDF renderer ekle; File Agent veya fiziksel case klasörü yazma yolu kullanma.
- [x] Gerçek API UI’da onaylı version için nihai not, kapsamlı önizleme, açık confirmation, tek final PDF ve download akışını bağla; API kesintisinde mock fallback yapma.
- [x] Gerçek PostgreSQL/API, PDF render, tarayıcı, tam root ve repository dışı fresh `npm ci` kapılarını tamamla; path bazlı atomik commit oluştur.

Kapsam dışı: onaysız taslaktan çıktı, rapor editörü, genel rapor yönetimi, e-posta gönderimi, File Agent/fiziksel klasör yazımı, Kasko değer kaybı, üretim migration ve sonraki paket.

## Paket 35 — Frontend güvenli lazy-loading ve code-splitting

- [x] Başlangıç import grafiğini ve Paket 34 bundle ölçümünü çıkar; kullanıcı akışını bozmadan ayrılabilecek ağır sınırları belirle.
- [x] Dosya Detayı route’unu lazy-load et; uygulama kabuğu, login, durum panosu ve dosya listesi başlangıç akışını koru.
- [x] Gerçek API ağırlıklı belge, PDF, OCR, poliçe analizi ve Trafik değer kaybı sekmelerini ayrı dinamik chunk’lara ayır.
- [x] Mevcut `Suspense`/`ErrorBoundary` davranışını koru; sekme loading görünümü ve lazy import hata regresyon testi ekle.
- [x] Başlangıç JS grafiğini ve her chunk’ı 500.000 bayt altında zorlayan, beklenen lazy chunk’ların preload edilmediğini doğrulayan build kapısı ekle.
- [x] Production Chrome’da ilk yükleme ve on-demand chunk isteklerini; mock/API akışlarını; açık/koyu 1366×768 ve 1920×1080 taşma/console durumunu doğrula.
- [x] Root typecheck/lint/test/build/audit/diff-check ve repository dışı fresh `npm ci` kapılarını tamamla.

Kapsam dışı: UI yeniden tasarımı, yeni iş özelliği, backend/API/contracts/database/File Agent/IPC değişikliği, yeni dependency ve sonraki paket.

## Paket 36 — Durum Panosu gerçek API entegrasyonu

- [x] Açık tenant vakalarını, takip tarihlerini, sorumlu/sigorta/servis metadata’sını tek salt-okunur snapshot’ta birleştir.
- [x] Paket 15 evrak değerlendirmesini güncel verified documentVersion metadata’sıyla vaka bazında çalıştır; eksik ve kontrol gereken sayıları ayır.
- [x] Lifecycle, Kasko poliçe analizi, AI aday incelemesi ve Trafik değer kaybı bekleyen insan onaylarını agregasyona ekle.
- [x] Workspace/file/lifecycle recovery, failed ve blocked durumlarını işlem gereken sinyallere ekle.
- [x] Saf `dashboard-priority/1.0.0` domain sıralaması, strict contracts ve deterministik JSON Schema fixture oluştur.
- [x] `GET /api/v1/dashboard` endpoint’ini oturum/tenant sınırıyla ekle; response/audit/path/secret sızıntısı ve yazısız okuma davranışını doğrula.
- [x] Dashboard DataPort/hook ve API no-fallback sınırını ekle; mock prototipi ayrı koru.
- [x] Summary, sorumlu, işlem, öncelik, arama filtreleri ve karttan gerçek dosya detayına tıklama/Enter geçişini bağla.
- [x] Domain/contracts/UI ve gerçek PostgreSQL/API testleri ile gerçek Chrome 1366×768/1920×1080 tema/overflow/console kapısını geç.
- [x] Repository dışı fresh `npm ci`, tam kapılar, path bazlı stage ve atomik commit.

Kapsam dışı: yeni dashboard yazma endpoint’i, snapshot persistence, yeni audit olayı, yeni migration, yönetim ekranı, File Agent/IPC/fiziksel dosya işlemi, UI yeniden tasarımı ve sonraki paket.

## Paket 37 — Case notları, görevler ve takip geçmişi

- [x] Saf görev geçişi ve LocalDate due sınıflamasını ekle; Dashboard priority’yi `1.1.0` görev sinyalleriyle sürümle.
- [x] Migration 0024 ile append-only not/task-event/follow-up history ve optimistic görev modelini ekle.
- [x] Strict Case Operations contracts, route sabitleri ve deterministik JSON Schema fixture’larını ekle.
- [x] Tenant/RBAC/idempotency/optimistic locking ve merkezi audit kullanan Operasyon API’sini ekle.
- [x] Case followUpDate create/update transaction’ını append-only takip geçmişine bağla.
- [x] API modunda gerçek Operasyon sekmesini ve Dashboard görev sinyallerini bağla; mock no-fallback sınırını koru.
- [x] Domain/contracts/UI ve hedefli gerçek PostgreSQL/API testlerini ekle.
- [x] Gerçek Chrome, tam root kapıları ve repository dışı fresh `npm ci` doğrulamasını tamamla.

Kapsam dışı: not edit/delete/revision UI, görev reopen veya genel görev yönetim ekranı, bildirim motoru, çalışma takvimi/tatil servisi, File Agent/IPC/fiziksel dosya işlemi, yeni dependency, üretim migration ve sonraki paket.

## Paket 38 — Production doğruluğu ve case navigasyonu sertleştirme

- [x] Production frontend’de veri kaynağını zorunlu API yap; localStorage/env mock override’ını development/test ile sınırla.
- [x] Production API başlangıcında `DATABASE_URL` zorunluluğunu fail-closed uygula.
- [x] Cases başarılı response’larını ortak contracts Zod şemalarıyla runtime doğrula; bozuk case type/stage/response’u reddet.
- [x] Açık ve kapalı case listelerinde bütün server pagination sayfalarını deterministik topla.
- [x] Dosya detayını liste aramasından ayırıp gerçek case detail endpoint’ine bağla.
- [x] API modunda evrak tamlığı, tahmini hasar ve bağlı olmayan modüller için mock/0/başarılı varsayımı üretme.
- [x] Kapanan Dosyalar ekranını gerçek closed case listesine geçir; kapanış ayrıntısı/ücreti yoksa bilinmeyen göster.
- [x] Raporlar API modunda gerçek endpoint olmadan mock toplam göstermesin.
- [x] Pending/failed Zabıt + ready KTT/Beyan alternatifinde gereksiz overall `control_required` sonucunu düzelt.
- [x] UI/domain/API regresyonu, gerçek PostgreSQL ve gerçek Chrome smoke testlerini ekle.
- [x] Tam root kapıları ve repository dışı fresh `npm ci` doğrulamasını tamamla.
- [x] Paket 38 dosyalarını path bazlı stage edip atomik commit oluştur.

Kapsam dışı: yeni rapor/ücret endpoint’i, kapanış ücret modeli, işçilik/PERT/e-posta backend’i, genel server-side arama UI refactor’ı, DB tenant composite migration’ı, log serializer sertleştirmesi, Electron/IPC, File Agent, üretim migration ve sonraki paket.

## Paket 39 — Kapanma ücreti ve dönem raporu gerçek API entegrasyonu

- [x] `closure-fee/1.0.0` saf domain kaynak uygunluğu ve safe integer minor-unit kurallarını ekle.
- [x] Manuel aday, açık onay ve append-only düzeltme komutları için strict contracts/JSON Schema oluştur.
- [x] Migration 0025 ile tenant-kapsamlı ücret aggregate/version modeli, current pointer, optimistic version ve append-only guard ekle.
- [x] Idempotency, RBAC, verified final-report source, optimistic locking ve merkezi audit kullanan ücret API'sini ekle.
- [x] Seçilen dönem için açık/kapanan dosya sayıları, dağılım, kontrol bekleyen ücretler ve yalnız onaylı toplamı veren salt-okunur rapor API'sini ekle.
- [x] Dosya Detayı > Raporlar ve Ücretler sekmesinde aday→onay→düzeltme ve sürüm geçmişini gerçek API'ye bağla.
- [x] Kapanan Dosyalar ve ana Raporlar ekranlarını gerçek ücret/rapor verisine bağla; API modunda mock fallback yapma.
- [x] Gerçek PostgreSQL, tam root, gerçek Chrome/CDP ve repository dışı fresh checkout kapılarını tamamla.
- [x] Yalnız Paket 39 dosyalarını path bazlı stage edip atomik commit oluştur.

Kapsam dışı: PDF/OCR/AI ile otomatik ücret çıkarımı, ücret yönetim CRUD'u, Excel/PDF dışa aktarma, e-posta, File Agent, filesystem, IPC, üretim migration ve sonraki paket.

## Paket 40 — Değer kaybı kapanış özeti entegrasyonu

- [x] `traffic-value-loss-closure/1.0.0` saf ve fail-closed domain değerlendirmesini ekle.
- [x] Güncel insan onaylı assessment + aynı version immutable final report şartını kapanış gereksinimine bağla.
- [x] Lifecycle plan/history JSONB snapshot’ını backward-compatible değer kaybı özetiyle genişlet.
- [x] Tenant-kapsamlı salt-okunur kapanış özet endpoint’i ve strict contracts/JSON Schema ekle.
- [x] Aylık rapora onaylı/raporlu değer kaybı sayı ve minor-unit toplamlarını yeniden hesaplama yapmadan ekle.
- [x] Kapanış önizlemesi, Kapanan Dosyalar ve Raporlar UI’ını gerçek özet verisine bağla; API modunda mock fallback yapma.
- [x] Gerçek PostgreSQL, tam root, gerçek Chrome/CDP ve repository dışı fresh checkout kapılarını tamamla.
- [x] Yalnız Paket 40 dosyalarını path bazlı stage edip atomik commit oluştur.

Kapsam dışı: yeni değer kaybı formülü, Kasko değer kaybı hesabı, dış emsal entegrasyonu, final report yeniden üretimi, File Agent/fiziksel dosya işlemi, IPC, yeni dependency, üretim migration ve sonraki paket.

## Paket 41 — Kullanıcı kontrollü e-posta taslak çekirdeği

- [x] Sürümlü deterministik Türkçe taslak türlerini ve recipient/Gmail compose domain kurallarını ekle.
- [x] Strict preview/create/revise/handoff contracts ve deterministik JSON Schema fixture’larını ekle.
- [x] Migration 0026 ile tenant-kapsamlı aggregate, immutable version, recipient, verified attachment ve `not_sent` handoff geçmişini ekle.
- [x] Preview’ı yazmasız; create/revise/handoff komutlarını RBAC, idempotency, optimistic locking ve merkezi audit ile uygula.
- [x] Yalnız current ready/verified documentVersion/photo metadata’sını ek seçimine aç; mutlak yol ve fiziksel içeriği sınır dışında tut.
- [x] Dosya Detayı > E-postalar sekmesini gerçek API çalışma alanına bağla; mock mod prototipini ve API no-fallback davranışını koru.
- [x] Açık kullanıcı onaylı Gmail web handoff’u `not_sent` olarak kaydet; otomatik gönderim veya gönderim doğrulaması üretme.
- [x] Gerçek PostgreSQL, API/UI, Chrome/CDP, tam root ve repository dışı fresh checkout kapılarını tamamla.
- [x] Yalnız Paket 41 dosyalarını path bazlı stage edip atomik commit oluştur.

Kapsam dışı: Gmail OAuth/API, gelen e-posta senkronizasyonu, provider message durumu, otomatik gönderim, bulut AI metin üretimi, fiziksel ek yükleme, File Agent, IPC, yeni dependency, üretim migration ve sonraki paket.

## Paket 42 — Kanıtlı AI e-posta metin önerisi

- [x] Paket 41 preview’ından deterministik, PII-minimize source context ve plan hash üret.
- [x] Organization email opt-in/allow-list, ortak integer bütçe ve usage ledger sınırını ekle.
- [x] Deterministik provider’lar ile mevcut Gemini server-secret sınırını ayrı email output contract’ına bağla.
- [x] Strict provider output, PII/placeholder/URL/path reddi ve server-side konu kimliği eklemesini uygula.
- [x] Durable receipt, response-recorded recovery, outcome-unknown no-retry ve idempotent replay akışını ekle.
- [x] Strict contracts/JSON Schema ve migration 0027 tenant/immutability/rollback sınırlarını ekle.
- [x] Paket 41 UI’ına plan, egress onayı, bütçe/privacy, öneri inceleme ve yerel uygulama panelini ekle.
- [x] Gerçek PostgreSQL/API, tam root, gerçek Chrome/CDP ve repository dışı fresh checkout kapılarını tamamla.
- [x] Yalnız Paket 42 dosyalarını path bazlı stage edip atomik commit oluştur.

Kapsam dışı: recipient önerisi, otomatik taslak kaydı, otomatik gönderim, Gmail OAuth/API, gelen e-posta sync, provider secret yönetim UI’ı, File Agent, IPC, fiziksel dosya erişimi ve sonraki paket.

## Paket 43 — Kullanıcı kontrollü İşçilik çekirdeği

- [x] Parça/işçilik satır kalemi doğrulama, toplam hesabı ve sürüm sabitini saf domain’de ekle.
- [x] Strict contracts/JSON Schema (workspace/create/revise) ve golden fixture’ları ekle.
- [x] Migration 0028: case başına tek föy aggregate, immutable version/item, sürüm zinciri ve append-only kısıtları.
- [x] Tenant/RBAC/idempotency/kapalı-case/optimistic version ve güvenli audit ile read/create/revise API.
- [x] Dosya Detayı İşçilik sekmesini API modunda gerçek föye bağla; kullanıcı kontrollü editör ve sürüm geçmişi.
- [x] Gerçek PostgreSQL/API, gerçek Chrome/CDP ve repository dışı fresh checkout kapılarını tamamla.
- [x] Yalnız Paket 43 dosyalarını path bazlı stage edip atomik commit oluştur.

Kapsam dışı: AI işçilik önerisi, Excel şablon profili, güvenli Excel yazımı, öğrenme sözlüğü, tutar dağıtımı, File Agent, IPC, yeni dependency, üretim migration ve sonraki paket.

## Paket 44 — Kanıtlı AI işçilik önerisi

- [x] Bounded hasar tarifi + mevcut kalemlerden PII-minimize outbound context ve plan hash üret.
- [x] Organization labor opt-in/allow-list ve üç modüllü ortak `ai_usage_ledger` bütçe sınırını ekle.
- [x] Strict provider çıktı doğrulaması: Paket 43 kalem/tutar sınırları + PII/placeholder/URL/path reddi.
- [x] Durable receipt, response-recorded recovery, outcome-unknown no-retry ve idempotent replay akışını ekle.
- [x] Strict contracts/JSON Schema ve migration 0029 tenant/immutability/provenance sınırlarını ekle.
- [x] Paket 43 editörüne plan, egress onayı, bütçe/privacy, öneri inceleme ve yerel uygulama panelini ekle; kayıt `ai_assisted` provenance taşısın.
- [x] Gerçek PostgreSQL/API, tam root, gerçek Chrome/CDP ve repository dışı fresh checkout kapılarını tamamla.
- [x] Yalnız Paket 44 dosyalarını path bazlı stage edip atomik commit oluştur.

Kapsam dışı: benzer dosya taraması/öğrenme sözlüğü, Excel şablon profili, güvenli Excel yazımı, otomatik föy kaydı, Gmail, File Agent, IPC, yeni dependency, üretim migration ve sonraki paket.

## Paket 45 — Kullanıcı kontrollü PERT değerlendirme çekirdeği

- [x] Dokuz durumlu süreç, ekonomik veri doğrulama, türetilmiş oran ve kanaat/merkez tutarlılık kurallarını saf domain’de ekle.
- [x] Strict contracts/JSON Schema (workspace/create/revise) ve golden fixture’ları ekle.
- [x] Migration 0030: case başına tek değerlendirme aggregate, immutable version, karar tutarlılığı ve append-only kısıtları.
- [x] Tenant/RBAC (`admin|expert|case_manager`)/idempotency/kapalı-case ve güvenli audit ile read/create/revise API.
- [x] Dosya Detayı Ağır Hasar sekmesini API modunda gerçek değerlendirmeye bağla; üç ayrı karar alanı ve sürüm geçmişi.
- [x] Gerçek PostgreSQL/API, tam root, gerçek Chrome/CDP ve repository dışı fresh checkout kapılarını tamamla.
- [x] Yalnız Paket 45 dosyalarını path bazlı stage edip atomik commit oluştur.

Kapsam dışı: fotoğraf AI, AI PERT önerisi, dış rayiç/SBM entegrasyonu, Excel yazımı, File Agent, IPC, yeni dependency, üretim migration ve sonraki paket.

## Paket 46 — İşçilik öğrenme sözlüğü

- [x] Türkçe duyarlı normalize/eşleştirme, deterministik sıralama ve arama kurallarını saf domain'de ekle.
- [x] Strict contracts/JSON Schema (query/response) ve golden fixture'ları ekle.
- [x] Güncel onaylı föy sürümlerinden türeten, tenant-kapsamlı, salt okunur ve audit yazmayan endpoint ekle.
- [x] İşçilik editörüne datalist öneri akışını ekle; yalnız boş alanları doldur, kullanıcı değerini ezme, otomatik kaydetme.
- [x] Gerçek PostgreSQL/API, tam root, gerçek Chrome/CDP ve repository dışı fresh checkout kapılarını tamamla.
- [x] Yalnız Paket 46 dosyalarını path bazlı stage edip atomik commit oluştur.

Kapsam dışı: yeni tablo/migration, AI çağrısı, otomatik satır ekleme/kayıt, Excel şablon profili, güvenli Excel yazımı, File Agent, IPC, yeni dependency ve sonraki paket.

## Paket 47 — API modunda kimlik ve yönetim listelerinde mock yasağı

- [x] Yönetim'in Kullanıcılar/Servisler sekmelerini API modunda mevcut referans uçlarına bağla; mock listeleri yalnız mock modda bırak.
- [x] Gerçek sözleşmede karşılığı olmayan sütunları (telefon, atanmış/açık dosya) kaldır; eksper rolünü `experts` referansından türet.
- [x] Sol menü kullanıcı kartındaki sabit kodlu prototip kimliğini gerçek oturum verisiyle değiştir; oturum yoksa mock kimlik gösterme.
- [x] Referans görünümünün salt okunur kaldığını ve audit yazmadığını doğrula.
- [x] Gerçek PostgreSQL/API, tam root, gerçek Chrome/CDP ve repository dışı fresh checkout kapılarını tamamla.
- [x] Yalnız Paket 47 dosyalarını path bazlı stage edip atomik commit oluştur.

Kapsam dışı: yeni tablo/migration/endpoint/sözleşme, kullanıcı-servis yazma (CRUD) yolu, Bildirimler ve Mevzuat ekranlarının gerçek veriye bağlanması, yeni dependency ve sonraki paket.

## Paket 48 — API modunda mock karantinası (Bildirimler ve Mevzuat)

- [x] Ortak `BackendUnavailableState` dürüst boş durum bileşenini ekle.
- [x] Bildirimler'i veri kaynağına göre ayır; API modunda "Bildirim altyapısı henüz etkin değil." göster, örnek bildirim render etme.
- [x] Mevzuat'ı veri kaynağına göre ayır; API modunda "Mevzuat kaynak kütüphanesi henüz yapılandırılmadı." göster, örnek kaynak ve mock soru–cevap render etme.
- [x] Mock gövdeleri ayrı bileşenlere alarak API modunda DOM'a hiç girmemesini sağla; yalnız mock veri modunda çalıştır.
- [x] İki ekran için veri kaynağı ayrımı ve mock sızıntısı testleri ekle.
- [x] Chrome smoke'ta mock kaynak dosyasından okunan sabit metinlerin API modunda DOM'da bulunmadığını doğrula.
- [x] Gerçek PostgreSQL/API, tam root, gerçek Chrome/CDP ve repository dışı fresh checkout kapılarını tamamla.
- [x] Yalnız Paket 48 dosyalarını path bazlı stage edip atomik commit oluştur.

Kapsam dışı: bildirim olay modeli, mevzuat kaynak kütüphanesi modeli, yeni tablo/migration/endpoint/domain modeli/adapter, yeni dependency ve sonraki paket.

## Paket 49 — Operasyonel bildirimler ilk dilimi (türetilmiş, salt okunur)

- [x] `operational-alert` domain modülünü ekle: tür, önem seviyesi, deterministik türetme, `dedupeKey` ile mükerrerlik engeli ve kararlı sıralama.
- [x] Evrak etiketlerini `email-draft.ts` içinden `DOCUMENT_REQUIREMENT_LABELS` olarak tek kaynağa taşı; rakip etiket seti oluşturma.
- [x] `v1/operational-alerts` sözleşmesini ve golden JSON Schema fixture'ını ekle; okundu/ertelendi gibi kullanıcı durumu alanı tanımlama.
- [x] `GET /api/v1/operational-alerts` salt okunur ucunu ekle; yalnız oturumun organization'ındaki açık dosyaları kapsasın, audit yazmasın.
- [x] Bildirimler ekranını API modunda gerçek uyarılara bağla; sayaç yalnız API sonucundan gelsin, boş sonuç gerçek boş durum olsun, hata halinde mock'a düşülmesin.
- [x] Gerçek PostgreSQL ile tenant/RBAC, mükerrerlik, determinizm ve serbest not sızıntısı testlerini çalıştır.
- [x] Chrome smoke'ta gerçek uyarılar, sayaç–API eşitliği, salt okunurluk, Mevzuat karantinası ve API kapalıyken fallback olmaması doğrula.
- [x] Tam root kalite zinciri ve repository dışı fresh checkout kapılarını tamamla.
- [x] Yalnız Paket 49 dosyalarını path bazlı stage edip atomik commit oluştur.

Kapsam dışı: kalıcı bildirim olay tablosu, kuyruk/worker, okundu-silindi-ertelendi ve kullanıcı bazlı tercih modeli, mevzuat kaynak kütüphanesi, yeni migration ve yeni dependency.

## Paket 50 — Durum Panosu uyarı özeti

- [x] Durum Panosu'na mevcut `GET /api/v1/operational-alerts` ucunu paylaşan uyarı özeti bileşeni ekle; yeni uç, tablo veya ikinci türetim mantığı ekleme.
- [x] Toplam sayacı yalnız API `totalCount` alanından oku; tür dağılımını tek yerde (veri katmanı) say.
- [x] Tür bazında özet göster: geciken görev, geciken takip, eksik zorunlu evrak.
- [x] Rozet ve tür kartları Bildirimler ekranına, önizleme satırı dosya detayına gitsin.
- [x] Panoda ayrıntılı liste render etme; yalnız özet ve ilk birkaç kritik uyarı göster.
- [x] Uyarı yoksa nötr boş durum, hata halinde açık hata durumu göster; sıfır gösterme ve mock'a düşme.
- [x] Aynı veri için mükerrer/paralel istek oluşmasını önle; mevcut hook ve port paylaşılsın.
- [x] UI testleri, gerçek PostgreSQL üzerinden Chrome smoke, tam kalite zinciri ve repository dışı fresh checkout kapılarını tamamla.
- [x] Yalnız Paket 50 dosyalarını path bazlı stage edip atomik commit oluştur.

Kapsam dışı: mevzuat, kalıcı bildirim durumu (okundu/ertelendi/tercih), cache ve performans optimizasyonu, yeni endpoint/tablo/migration ve yeni dependency.

## Paket 51 — Operasyonel uyarı performans ölçümü

- [x] Gerçek PostgreSQL üzerinde 100 / 1.000 / 5.000 açık dosya hacmi oluştur; görev, takip ve evrak durumlarını karışık dağıt.
- [x] Toplam süre, SQL sorgu sayısı, sorgu süreleri, kural değerlendirme süresi ve dönen kayıt sayısını ölç; üretim koduna enstrümantasyon ekleme.
- [x] Aynı veriyle tekrarlı koş; ilk (soğuk) ve ısınmış sonuçları ayrı raporla.
- [x] N+1 veya gereksiz tekrar varsa düzelt; evrak değerlendirmesinde toplu veri çekimi mümkünse uygula.
- [x] İş kurallarını, sıralamayı, dedupe davranışını ve 200 sınırını değiştirme; cache/materialized view/worker/tablo/migration ekleme.
- [x] Regresyonu süre eşiğiyle değil sorgu sayısı ve algoritmik sınırlarla koru; testin gerçekten koruduğunu doğrula.
- [x] Ölçüm sonuçlarını gerçek sayılarla `PERFORMANCE_NOTES.md` içine kaydet.
- [x] Tam kalite zinciri ve repository dışı fresh checkout kapılarını tamamla.
- [x] Yalnız Paket 51 dosyalarını path bazlı stage edip atomik commit oluştur.

Kapsam dışı: cache, materialized view, background worker, yeni kalıcı tablo/migration, iş kuralı ve sıralama değişikliği, süre eşiğine dayalı performans testi.

## Paket 52 — Dosya satırı uyarı göstergesi

- [x] Mevcut `GET /api/v1/operational-alerts` ucuna isteğe bağlı, sözleşmeyle sınırlı `caseIds` filtresi ekle; yeni endpoint açma.
- [x] Dosya başına özeti 200 kırpmasından ÖNCE hesapla; filtreli çağrıda yanlış negatif oluşmasın.
- [x] Tenant/RBAC sınırını istemciden gelen kimliklere güvenmeden sunucu tarafında uygula.
- [x] Satırda toplam uyarı sayısı ve tür ayrımı (geciken görev / geciken takip / eksik evrak) göster.
- [x] Uyarısı olmayan satırda dikkat çekici rozet gösterme; özet dönmeyen satırı "bilinmiyor" göster.
- [x] Rozet tıklanınca dosya detayına git.
- [x] Filtre, sıralama veya sayfalama değişince yalnız görünür satırlar için yeniden yükle.
- [x] Mock modda gerçek uyarı çağrısı yapma; hata halinde tüm satırları "uyarısız" gösterme.
- [x] Gerçek PostgreSQL tenant/filtre/yanlış-negatif testleri, UI testleri ve Chrome smoke ekle.
- [x] Tam kalite zinciri ve repository dışı fresh checkout kapılarını tamamla.
- [x] Yalnız Paket 52 dosyalarını path bazlı stage edip atomik commit oluştur.

Kapsam dışı: yeni endpoint/tablo/migration, cache, kalıcı bildirim durumu, ikinci kural motoru, Dosyalar ekranına gerçek sayfalama eklenmesi.

## Paket 53 — Dosyalar sunucu tarafı sayfalama

- [x] Mevcut `GET /api/v1/cases` ucunu kullan; yeni endpoint açma, tablo/migration ekleme.
- [x] `page`/`pageSize` (üst sınır 100) ve filtreleri sayfalamadan önce sunucuda uygula; sıralamayı `id` ile deterministik yap.
- [x] Plaka boşluksuz arama ve AND arama davranışını koru; tenant sınırını sonuçlara ve toplam sayıma uygula.
- [x] Geçersiz sayfa/boyut değerlerini sözleşme seviyesinde reddet.
- [x] UI'da bütün listeyi çekmeyi bırak; yalnız aktif sayfayı render et.
- [x] Sayfa değişimi, ileri/geri ve toplam kayıt bilgisini göster.
- [x] Filtre, arama veya sıralama değişince sayfayı 1'e döndür; geçersiz son sayfada güvenli sayfaya dön.
- [x] Satır uyarı isteğinde yalnız aktif sayfa kimliklerini gönder; "bilinmiyor" uyarı durumunu ortadan kaldır.
- [x] Mock prototip davranışını koru; API hatasında eski veya mock kayıt gösterme.
- [x] Gerçek PostgreSQL tenant/sayım/filtre+sıralama+sayfalama/kayıp-mükerrer/100 sınırı testleri ekle.
- [x] Chrome smoke'ta aktif sayfa kayıtlarıyla gönderilen uyarı kimliklerinin eşleştiğini doğrula.
- [x] Tam kalite zinciri ve repository dışı fresh checkout kapılarını tamamla.
- [x] Yalnız Paket 53 dosyalarını path bazlı stage edip atomik commit oluştur.

Kapsam dışı: yeni endpoint/tablo/migration, sonsuz kaydırma, sütun özelleştirme, Kapanan Dosyalar ve Dosya Detayı ekranlarının liste okuma biçimi.

## Paket 54 — Full AI işçilik dağıtım çekirdeği

Dilim 1 — domain sınırı ve taksonomi (tamamlandı):

- [x] Kanonik operasyon türleri (`labor-operation-types/1.0.0`) ve ekonomik karşılaştırma kovalarını AYRI yapılar olarak tanımla.
- [x] Ekonomik karşılaştırmayı ortak kovalarla modelle; toplamları kovalardan deterministik hesapla.
- [x] Şemada bulunmayan kanıt kanallarını (araç kimliği, parça kodu, hasar bölgesi) uydurma; eksik kanıt koduyla işaretle ve `controlRequired` zorla.
- [x] `controlRequired` kuralını sunucu tarafında yeniden hesapla; sağlayıcının `false` demesine güvenme.
- [x] Çıktı doğrulamasını strict yap: satır kapsaması, tahsis toplamı eşitliği, tekrarlı tür, PII/URL/yol reddi.
- [x] Kanıt snapshot hash'i ve plan hash'i üret; kaynak değişince stale olsun.
- [x] Dış sağlayıcıya kimlik ve PII çıkmadığını testle doğrula.

Dilim 2 — uçtan uca (tamamlandı):

- [x] Sözleşme `v1/labor-allocation-ai` + golden JSON Schema fixture; taksonomi/prompt/şema sürümleri zorunlu alan.
- [x] Migration 0031: immutable `labor_allocation_runs` ve satır önerileri, kanıt snapshot hash'i, `ai_usage_ledger` modül genişletmesi, `ai_provider_policies` opt-in.
- [x] API workspace/get/analyze/apply-preview; idempotency, stale föy reddi, RBAC ve kapalı dosya kilidi.
- [x] Kontrollü provider harness (başarı, geçersiz şema, timeout, hata, bütçe); fallback YOK.
- [x] UI: tam önizleme, satır bazlı kabul/ret, `control_required` filtresi, "kontrol gerekli olanlar hariç tümünü seç", gerekçe/güven/kanıt/çelişki görünümü.
- [x] Gerçek PostgreSQL testleri: tenant izolasyonu, stale sürüm, no-fallback, audit sızıntısı, idempotency, tüm satır kapsaması, usage ledger.
- [x] Chrome smoke + fresh checkout + commit.

Bu dilimde föy otomatik revize EDİLMEZ: yalnız seçilmiş sonuçlardan açık kullanıcı onayına gidecek önizleme üretilir (`applied: false`).

## Paket 55 — Gerçek Gemini işçilik adaptörü

- [x] Deployment opt-in (`GEMINI_LABOR_ALLOCATION_PROVIDER_ENABLED` + `GEMINI_API_KEY`) ekle; anahtarı yalnız ortamdan oku, PostgreSQL'e yazma.
- [x] Organization `ai_provider_policy` açık değilse dış çağrı yapma; kullanıcı egress onayı olmadan çağırma.
- [x] Yalnız normalize edilmiş PII-minimize kanıt paketini gönder; credential ve PII'nin gövdeye girmediğini payload testiyle doğrula.
- [x] Gemini'den strict JSON/structured output iste; dönen çıktıyı yine domain doğrulamasından geçir.
- [x] Kontrollü retry yalnız 429 ve 5xx'te; kalıcı hata, geçersiz JSON ve timeout'ta fallback üretme.
- [x] Sağlayıcı makbuzu ve `ai_usage_ledger` ile mükerrer maliyet koruması; model/prompt sürümü ve kullanım miktarını sakla, ham prompt/yanıt saklama.
- [x] Gerekçe alanlarında PII/URL/dosya yolu taramasını yeniden çalıştır (domain doğrulaması).
- [x] Deterministik harness'i yalnız açık izne bağla; üretimde config aşamasında reddet.
- [x] Mock HTTP server ile başarı, malformed JSON, eksik satır, 429, 5xx, timeout ve bağlantı kesilmesi testleri.
- [x] Gerçek PostgreSQL ile opt-in, tenant, stale, idempotency, budget, ledger ve audit sızıntısı doğrulaması.
- [x] İsteğe bağlı manuel gerçek Gemini smoke'u ekle; CI ve standart kuşak anahtar istemesin.

Kapsam dışı: Excel yazımı, şablon profilleri, otomatik eksper onayı, kullanıcı onayı olmadan föy revizyonu.

Kapsam dışı: Excel'e yazma, şablon profilleri, otomatik eksper onayı, kullanıcı onayı olmadan föy revizyonu, kendi kendine öğrenme, Gmail/File Agent/fiziksel dosya yazımı.

## Paket 56 — AI kanıt zenginleştirme

- [x] `detectMissingEvidence` sabit kod listesini bırak; kodları gerçek plan bağlamından türet.
- [x] Domain: `case-vehicle-profile` (marka, model, model yılı, varyant, araç sınıfı, şasi prefix'i, motor kodu, kanıt kaynağı/referansı) ve prefix/motor kodu normalizasyonu.
- [x] Domain: işçilik satırında `partCode`, `partCodeSource` ve `damageRegion` normalizasyonu; kod/kaynak birlikte null ya da birlikte dolu.
- [x] Contracts: `v1/case-vehicle-profile` istek/yanıt şemaları ve golden JSON Schema fixture'ları.
- [x] Migration 0032: `case_vehicle_profiles` + immutable `case_vehicle_profile_versions`; `labor_sheet_items` üzerine nullable kanıt sütunları ve CHECK.
- [x] API: `GET`/`PUT /api/v1/cases/:caseId/vehicle-profile`; sürüm çakışması, kapalı dosya kilidi ve tenant sınırı.
- [x] API: işçilik store'u kanıt alanlarını yazıp okusun; dağıtım store'u araç profilini kanıt olarak yüklesin.
- [x] Kanıt alanlarını outbound bağlama ve kanıt snapshot hash'ine dahil et; kaynak değişince eski öneri stale sayılsın.
- [x] UI: Özet sekmesinde araç profili bölümü (sürüm geçmişi, gerekçe zorunluluğu, şasi prefix sınırı ve gizlilik notları).
- [x] UI: işçilik editöründe ve salt-okunur föy görünümünde parça kodu / hasar bölgesi sütunları.
- [x] UI: föy kaydedildiğinde AI dağıtım modülünü tazele; eski öneri revize edilmiş föyün üstünde kalmasın.
- [x] Gerçek PostgreSQL testleri: üç kanal kapalıyken kodların düşmesi, `control_required` zorlamasının kalması, eski önerilerin değişmeden okunması, tenant ve sürüm çakışması.
- [x] Chrome/CDP smoke: kanıt öncesi/sonrası kod sayısını gerçekten ölç; plaka ve tam şasinin sızmadığını doğrula.

Kapsam dışı: otomatik belge çıkarımı, sigorta şirketi Excel kolonlarına eşleme, uydurma hasar bölgesi enum'u, `EVIDENCE_MISSING_APPROVED_HISTORY` ve `EVIDENCE_MISSING_EXPERT_BASELINE` kanalları.

## Paket 57 — Eksper baseline entegrasyonu

- [x] Domain: `labor-baseline` modülü — normalize eşleştirme metni (tr yereli), aday kümesi ve karşılıklı teklik kuralı.
- [x] Domain: eşleşme yalnız açıklamaya dayanmasın; parça kodu ve hasar bölgesi iki tarafta da doluyken ayırt edici olsun.
- [x] Domain: belirsiz eşleşmede baseline yokmuş gibi davran; `hasCompleteBaselineMatch` ile tam kapsama şartı.
- [x] Domain: sürümlü ekonomik şekil karşılaştırması ve `LABOR_BASELINE_PART_RATIO_TOLERANCE` eşiği.
- [x] Domain: `detectMissingEvidence` baseline kodunu yalnız tam eşleşmede düşürsün.
- [x] Domain: `validateLaborAllocationSuggestion` çelişki kodunu SUNUCUDA birleştirsin; `requiresControl` öncesinde uygulansın.
- [x] Contracts: run düzeyinde `baselineSheetVersion` / `baselineMatchVersion` / `baselineMatchedLineCount`, satır düzeyinde `baseline` karşılaştırması; golden fixture'lar.
- [x] Migration 0033: run ve satır üzerinde baseline sütunları, tutarlılık CHECK'leri, run kimliği trigger'ına baseline seçiminin eklenmesi.
- [x] API: baseline yalnız önceki onaylı föy sürümünden yüklensin; tenant sınırı sorguda uygulansın.
- [x] API: baseline seçimi ve satır karşılaştırması immutable saklansın; okuma yolunda geri dönsün.
- [x] API provenance düzeltmesi: `approvedHistory` onaylanmamış AI çıktısını kanıt olarak beslemeyi bıraksın.
- [x] UI: "Eksper baseline mevcut/yok" ve kaç satırın eşleştiği görünsün.
- [x] UI: satır bazında onaylı dağılım ile öneri karşılaştırılsın, fark açıkça gösterilsin, otomatik kabul olmasın.
- [x] Gerçek PostgreSQL testleri: tenant izolasyonu, yalnız onaylı sonuç, AI önerisinin baseline sayılmaması, belirsiz eşleşme reddi, baseline değişiminde stale, audit/PII sızıntısı, kodun yalnız doğru koşulda düşmesi.
- [x] Chrome/CDP smoke: kanıt öncesi/sonrası kod sayısını gerçekten ölç; çelişki zorlamasını doğrula.
- [x] Gerçek Gemini manuel smoke'u (Paket 59'da kapandı; sonuçlar HB-2026-066).

Kapsam dışı: `EVIDENCE_MISSING_APPROVED_HISTORY` kanalının açılması (gerçek "onaylanmış dağıtım" kaydı gerekir), Excel yazımı, şablon profilleri, otomatik eksper onayı.

## Paket 58 — Onaylı AI dağıtımını föye uygulama

- [x] Föy sürümü oluşturmayı tek uygulamaya indir (`labor/sheet-version.ts`); revizyon ve AI uygulaması aynı yardımcıyı kullansın.
- [x] Domain: apply doğrulaması, değiştirilmiş satır tespiti, kısmi seçimde föy birleştirme.
- [x] Domain: onaylı geçmiş türetimi havuz semantiğiyle; çelişen geçmiş kullanılmasın, mevcut run dışlansın.
- [x] Contracts: apply istek/yanıt, uygulama ve satır snapshot şemaları, golden fixture'lar.
- [x] Migration 0034: uygulama aggregate'i, tek-hedef-sürüm ve tek-başarılı-uygulama indeksleri, `completed` şartı, immutability trigger'ları.
- [x] Migration 0034: `ai_allocation_applied` kaynak türü ve provenance'sız sürümü engelleyen deferred constraint trigger.
- [x] API: tek transaction içinde föy sürümü + provenance; stale, RBAC, kapalı dosya, çift uygulama ve idempotency korumaları.
- [x] API: `approvedHistory` yalnız tamamlanmış provenance'tan; uygulanan değer öğrenme örneği olsun.
- [x] API: geçmiş çelişkisinde `CONFLICT_HISTORY_DISAGREEMENT` sunucuda zorlansın.
- [x] UI: seçilen satırda AI önerisi ile uygulanacak değer yan yana, düzenlenebilir; değiştirilen satır işaretlensin.
- [x] UI: kontrol gerekli satırlar varsayılan seçili gelmesin; onay modalında kaynak run ve kaynak/hedef sürüm gösterilsin.
- [x] UI: başarıdan sonra yeni föy sürümüne geçilsin ve uygulama provenance'ı görüntülenebilsin.
- [x] Gerçek PostgreSQL testleri: atomiklik, tenant, stale, idempotency, çift uygulama, kısmi seçim, kullanıcı değişikliği, audit sızıntısı, yalnız completed provenance.
- [x] Chrome/CDP smoke: onaylı geçmiş yok → uygulama tamamlandı → yeni analizde yalnız ilgili kod kalktı.
- [x] Gerçek Gemini manuel smoke'u (Paket 59'da kapandı; sonuçlar HB-2026-066).

Kapsam dışı: Excel yazımı, şablon profilleri, otomatik eksper onayı, operasyon türlerinin kullanıcı tarafından yeniden yazılması.

## Paket 59 — Gerçek Gemini release kapısı

- [x] .env.local'ın ignore edildiğini doğrula; anahtarı yalnız süreç ortamına oku, log'a yazma.
- [x] Wire şemasına kapalı küme enum ları ve integer tutarlar; domain doğrulaması değişmeden.
- [x] Sistem talimatını P56 sonrası kanıt kanallarına göre koşullu hale getir.
- [x] thinkingBudget 0: dinamik düşünme 30 sn policy tavanını aşıyordu; tavan gevşetilmedi.
- [x] Onarım/değişim toplamlarını wire dan çıkar; adaptör modelin kendi kovalarından türetsin.
- [x] Sağlayıcı sürümünü gemini-generate-content/1.1.0 yap; sürümleme sınırını belgele.
- [x] Manuel smoke u P56–P58 sonrası gerçek akışa taşı: policy/bütçe/egress/ledger dahil, iki senaryo.
- [x] Windows UV_HANDLE_CLOSING: hatayı yakala, dispatcher kapat, doğal çıkış.
- [x] Üç kapı ölçümünü iki modelde kaydet: şema kabulü 4/4, satır kapsaması 4/4, doğrulama hatası 0/2, kontrol 4/4.
- [x] Opt-in siz atlama ve fresh checkout ta .env dışlama doğrulandı; CI anahtar istemez.

Kapsam dışı: Excel şablon profilleri, üretim ortamında sağlayıcıyı fiilen açmak (deployment kararı).

## Paket 60 — Excel şablon profilleri

- [x] Domain: sürümlü profil doğrulaması; eşleme kanonik tür kümesini tam kapsasın, `null` bilerek-eşlenmedi olsun.
- [x] Domain: projeksiyon — değiştirilmiş satırda sayı uydurma, `manual_entry_required` işaretle.
- [x] Domain: dağılım toplamı tutmayan satırı sessizce düzeltme; eşlenmemiş türü sütuna yazma.
- [x] Contracts: `v1/labor-excel-profile` şemaları, `written: false` literali, golden fixture'lar.
- [x] Migration 0035: sürümlü immutable profil aggregate'i, eşleme tamlığı CHECK'i, insurer composite FK.
- [x] API: profil CRUD (tenant + sürüm çakışması + gerekçe zorunluluğu) ve salt okunur projeksiyon ucu.
- [x] API: projeksiyon yalnız tamamlanmış uygulama provenance'ından beslensin.
- [x] UI: Yönetim'de "Excel Şablonları" sekmesi; sütun ve eşleme kullanıcı tanımlı, sürüm geçmişli.
- [x] UI: İşçilik'te uygulama geçmişinden projeksiyon önizlemesi; dosyaya yazılmadığı açıkça belirtilsin.
- [x] UI: yeni modül lazy yüklensin; başlangıç bundle bütçesi korunsun.
- [x] Gerçek PostgreSQL testleri: tenant, sürüm, eksik/geçersiz eşleme, yabancı insurer, RBAC, projeksiyon dürüstlüğü.
- [x] Chrome/CDP smoke: profil tanımla → uygula → projeksiyon; değiştirilen satırda sayı üretilmediğini doğrula.

Kapsam dışı: xlsx dependency, fiziksel Excel yazımı, hardcode edilmiş şirket kolonları.

## Paket 61 — Büyük föy Gemini yük doğrulaması

- [x] finishReason'ı yakala; çıktı kesilmesine ayrı safe kod ver; retry sayısını yapısal teşhise ekle.
- [x] Ledger gerçek çıktı karakteri ve token sayılarını taşısın.
- [x] 10/25/50/100 satır sentetik föyle gerçek analyze akışında ölç; anahtar/ham içerik/PII rapora girmesin.
- [x] Ölçüm: 50 ve 100 satırda tek çağrı 30 sn tavanına çarpıyor; chunking gerekli.
- [x] Domain: deterministik gruplama ve sunucu tarafı birleştirme; eksik/tekrarlı satırda tüm run düşsün.
- [x] API: chunk döngüsü, grup başına makbuz ve ayrı domain doğrulaması, ledger toplamı.
- [x] Chunk makbuz kimlikleri plan hash'inden deterministik türetilsin; 64-hex kısıtı gevşetilmesin.
- [x] Chunking değişmezlerini deterministik sağlayıcıyla CI kuşağında koru (kotadan bağımsız).
- [x] Kabul ölçütü: 50+ satırda tam kapsama, sıfır doğrulama hatası, çağrı başına timeout politikası içinde, doğru ledger, gizli fallback yok.

Kapsam dışı: timeout tavanının yükseltilmesi, domain doğrulamasının gevşetilmesi, Excel dosyasına yazma.
## Paket 62 — AI analiz ilerlemesi ve dayanıklılığı

- [x] Migration 0036: durum kümesini genişlet; toplam satır/grup, grup boyutu, iptal ve ilerleme zaman damgaları.
- [x] Trigger: başarısız/iptal edilmiş koşu öneri satırı taşıyamasın; `cancel_requested`'tan geri dönülmesin.
- [x] API: analiz asenkron koşsun; istek koşuyu `queued` yaratıp hemen dönsün.
- [x] İlerleme mevcut makbuzlardan türetilsin; ikinci paralel kayıt sistemi kurulmasın.
- [x] Aynı föy sürümü için çift başlatma `ANALYSIS_ALREADY_RUNNING` (409) ile engellensin.
- [x] İptal ucu: abort denensin, belirsizken "iptal edildi" denmesin; `cancel_requested` ara durum olsun.
- [x] Makbuz kimlikleri `runId`'den türetilsin ki yeniden deneme çakışmasın.
- [x] UI: `3/5 grup`, `60/100 satır` ve gerçek geçen süre; sahte yüzde veya kalan süre yok.
- [x] UI: analiz sürerken buton kilitli; sayfadan dönünce ilerleme sürsün; tamamlanınca otomatik inceleme ekranı.
- [x] UI: iptal ve yeniden deneme açık kullanıcı eylemi; başarısızlıkta yedek sonuç gösterilmesin.
- [x] Aktif koşu yoksa EN SON koşu gösterilsin; başarısız son deneme gizlenmesin.
- [x] Kablo seviyesi regresyon testi: gövdesiz POST'un boş JSON gövde hatası üretmesi bir daha kaçmasın.

Kapsam dışı: ilerleme yüzdesi/kalan süre tahmini, çok süreçli koşu devralma, Excel dosyasına yazma.

## Paket 63 — Çoklu Excel profil seçimi

- [x] Domain: `selectLaborExcelProfileCandidates` — organizasyon/şirket kapsamı, aktiflik, tek profilde öneri.
- [x] Domain: profil durumu, hedef sayfa ve kimlik doğrulama kuralı tipleri.
- [x] Migration 0037: aggregate durumu + pasifleştirme kaydı; sürüme hedef sayfa ve kimlik kuralları.
- [x] Sözleşme: aday listesi (`templateVerified: false`) ve durum değiştirme isteği.
- [x] API: dosyaya göre aday ucu; profil durum ucu.
- [x] API: projeksiyon ucu pasif profili ve şirket uyuşmazlığını 409 ile reddetsin.
- [x] UI: `profiles[0]` körü körüne seçimi kaldırıldı; öneri/seçim akışı kuruldu.
- [x] UI: profil önerisi ile gerçek şablon eşleşmesi ayrı sunulsun.
- [x] UI: eşleşme önizlemesi — ad, sürüm, şirket, hedef sayfa, eşleme, eşlenmemiş türler, kimlik kuralları.
- [x] UI: profil değişince projeksiyon temizlensin; sürüm değişimi/pasifleşme bayat olarak işaretlensin.
- [x] Yönetim: hedef sayfa, kimlik kuralları ve pasifleştirme/etkinleştirme.
- [x] Smoke kasıtlı kırılmayla sınandı; teşhis kodu ürünün işini yapmıyor.

Kapsam dışı: gerçek Excel dosyası okuma, hücre koordinatı modelleme, dosyaya yazma.

## Paket 64 — Gerçek şablon keşfi ve güvenli .xlsx yazımı

1. dilim (tamamlandı):

- [x] Gerçek sürücüyü SALT OKUNUR tara; hiçbir dosyayı değiştirme.
- [x] Klasör düzeni sapmalarını ölç ve raporla (ay harf yazımı, KAPALI seviyesi).
- [x] Şablonu dosya adıyla değil İÇERİK imzasıyla ayır.
- [x] Bağımlılık seç ve gerekçelendir; kilit dosyasıyla audit et.
- [x] Yol çözümleyici: aday üret, harf duyarsız eşleştir, kök dışına çıkışı engelle.
- [x] Workbook geometrisi: imza doğrulama, yazılabilir hücre sınırları, cerrahi yamalama.
- [x] Formüllü hücreye yazmayı reddet; `fullCalcOnLoad` ile yeniden hesaplama iste.
- [x] Domain kodunu GERÇEK şablona karşı salt okunur doğrula (kaynak hash değişmedi).

2. dilim (kapsam dışı, sıradaki):

- [ ] Geometri profil sürümü + migration (hedef sheet, imza, sınırlar, fingerprint).
- [ ] Sözleşme + API: keşif, doğrulama ve hücre değişiklik preview'u.
- [ ] File Agent yazım hattı: hash kontrolü, yedek, geçici dosya, doğrulama, güvenli replace, rollback.
- [ ] İdempotency, quarantine, lease/retry.
- [ ] UI: keşif durumu, preview, nihai onay, File Agent işlem durumu.
- [ ] Kopyalanmış gerçek dosyada pilot smoke; Chrome/CDP smoke.

Kapsam dışı (bu pakette): eksik workbook oluşturma (ürün kararı: yalnız doldur, yoksa hata).
