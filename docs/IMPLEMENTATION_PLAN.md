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
