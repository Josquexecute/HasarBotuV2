# Bildirim merkezi ve kaynak engelleri — 13.10.2026

Sonraki doğrulama: [Touch 0.1.6 ve 17/17 kaynak kabulü](TOUCH_ASSISTANT_AND_SOURCE_RECOVERY_2026-10-13.md). Aşağıdaki 0.1.5 raporu önceki kontrolün durumunu kaydeder.

**Durum: PARTIAL.** Bildirim revizyonu tamamlandı; masaüstü **0.1.5** iki bilgisayara kuruldu. Kaynak kontrolündeki engelli dosya sayısı **25 → 17** düştü. Kalan kaynak eşleşmeleri, yeni V1 aktarım onayı ve Windows yeniden başlatma kabulü açık.

## Kullanım ve doğrulama

Bildirimler tek sütunda küçük kartlarla, kategori simgesi, okunmamış işareti, dosya bilgisi ve saatle sunulur. Gün grupları Türkiye saatini kullanır. Gelen kutusu, uyarılar ve Tramer/e-posta sekmeleri sadeleştirildi; açılır uyarı üst sağda yer alır. Tasarımda [Apple bildirim rehberi](https://developer.apple.com/design/human-interface-guidelines/notifications) ve [Material kart yaklaşımı](https://m3.material.io/components/cards/overview) örnek alındı.

Okunmamış kartı açmak önce sunucuda okundu kaydını tamamlar. Hata halinde gezinme gerçekleşmez; tekrar deneme mümkündür. Çift tıklama tek yazma isteği üretir. Seçili filtreyi tekrar tıklamak yüklenmede takılmaya yol açmaz. Yalnız güncel dosya sorumlusuna bildirim gönderme ve 50 satırlı sayfalama korunur.

| Kontrol | Sonuç |
|---|---|
| Ön yüz | 380 PASS, 8 SKIP |
| Gerçek Electron, izole veritabanı | 35/35 PASS |
| pCloud araçları | 84/84 PASS |
| Typecheck, tam build, x64 NSIS | PASS |
| Son değişikliklerin ESLint kontrolü | 0 hata, önceden bulunan 5 uyarı |
| Git diff boşluk kontrolü | PASS |

Electron kontrollerinde açık/koyu tema, 390 px ekran ve %150 büyütmede tek sütun ve taşmayan kartlar; sahiplik, 50+10 sayfalama, toplu uyarı kapatma ve not kaydı doğrulandı. Sekiz ön yüz testi mevcut canlı kimlik bilgileri/Eksist yapılandırması eksikliği nedeniyle atlandı. Yeni görünümün canlı kullanıcı hesabında elle kabulü henüz yapılmadı.

İki gerçek kurulu istemcinin sürümü, UI varlıkları, ofis HTTPS API bağlantısı, Google etkin durumu ve anonim erişimin 401 ile reddedilmesi geçti. Profil, ofis başlatıcısı ve köprü adresleri korundu. Önceki masaüstü paketleri geri dönüş için saklandı. Bu revizyonda API şeması ve iş verileri değiştirilmedi.

Paket: `apps/desktop/release/HasarBotu-Setup-0.1.5.exe`, x64, 102.643.572 bayt. SHA-256: `816837108df26a122c97b4b2048d2ec8a1bb0073a1aca18843f901319f730afc`.

## Giderilen kaynak hataları

SQLite kopyasında canlı okuyucu kilitlerini içeren SHM dosyasının kullanılması bırakıldı. Öncelikle tutarlı SQLite online backup denenir; pCloud'un özel kilidi buna izin vermediğinde DB/WAL/journal dosyalarının kimlik, boyut ve zaman damgaları kopya öncesi/sonrası doğrulanır. SHM özel kopyada yeniden oluşur; `quick_check` zorunludur. [SQLite WAL açıklaması](https://www.sqlite.org/wal.html) ve [Node SQLite backup API](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html) referanstır. Canlı ofis kontrolünde özel kopya stratejisi ve bütünlük kontrolü geçti.

V1'in `.takip.json.…tmp` dosyaları evrak sanılıyordu. Mevcut domain geçici dosya politikası kaynak taraması ve pCloud ağaç değerlendirmesine uygulandı. Kalıcı `_HASARBOTU/takip.json` ve `HASARBOTU_TAKIP_OZETI.txt` kapsamda kalır. Kaynak/evrak hash ve revizyon sınırları esnetilmedi.

Ofiste 05:48:26 UTC'de tamamlanan gerçek tarama: **384 dosya klasörü**, 24.434 kaynak evrak kontrolü, 25 yenilenen dosya, 2.002 kaynak hash kanıtı, **17 engelli dosya**. Bu taramada SQLite snapshot ve geçici dosya okuma hatası sıfır. Kaynak ve hedef evraklara yazılmadı; güvenlik kapısı atlanmadı. Eski tarihli hata dosyası yeni taramanın sonucu değildir.

## Açık işler ve kararlar

- **17 kaynak istisnası:** 16 dosyanın güncel pCloud dosya kaydı ve bir alt klasörün kaydı bulunamıyor. NFC/büyük-küçük harf karşılaştırması da doğru klasörde bir kimlik bulamadı; bunlar ad normalizasyonu hatası değildir. Tam yollar ofiste korumalı `real-use-20261013/source-held-identity-review.json` listesindedir. pCloud kayıtlarıyla gerçek kaynak yolları uzlaştırılmadan bu evraklar doğrulanmış sayılmaz. Veritabanına yapay kimlik eklemek veya evrakı silmek uygulanmadı.
- **48 sorumlusu belirsiz dosya:** kullanıcının kararı gereği ayrı listede kalır; 33 kapalı, 15 açık. Mevcut 399 dosyanın ortak eksperi korunur.
- **Yeni V1 aktarımı:** salt okunur plan 6 yeni dosya, 29 not ve 3 tarihsel kapanış içeriyor; 12 mevcut dosyada kaynak snapshot/provenance tamamlaması var. 9 sorunlu kaynak karantinada, 176 klasörde V1 yan dosyası yok. Eski aktarım onayı bu değişmiş plan için kullanılmaz. Yeni aktarım öncesinde plan/yedek tekrar doğrulanmalı ve kesin hash onayı alınmalı. Önizleme hash'i: `514b41da56833cedcd7502dff1937201ea897df919e04545b8d7f8ced355d583`.
- **Windows yeniden başlatma kabulü:** ilgili beş servis Running/Auto; son açılış 10.10.2026. Yeni sürümle gerçek yeniden başlatma/yeniden giriş kabulü yapılmadı. Ofiste açık çalışma ve kullanıcı oturumu dikkate alınarak bakım zamanı gerektirir.

Kanıtlar Git dışında `.local/local-tracking-20261011` altında: `refinements-ui-acceptance.json`, `notification-redesign-all-front-tests.log`, `pcloud-online-full-regression.log`, iki `installed-0.1.5-runtime.json`, `source-temp-policy-deployment.json`, `source-temp-policy-check-result.json`, `source-temp-policy-held-codes.json`, `source-held-identity-review-summary.json`, `current-v1-blockers-preview.json`. Önceki revizyon: [gerçek kullanım düzenlemeleri](REAL_USE_REFINEMENTS_2026-10-13.md).
