# Kapatma önizlemesi düzeltmesi · 2026-10-18

Ofis bağlantısındaki saha portalı, özel Tailscale API isteklerini aktarırken
`idempotency-key` başlığını düşürüyordu. Geçerli gerekçe ve seçimlerle gönderilen
önizleme isteği API tarafından 400 `validation_error` ile reddediliyor, arayüz
ise kullanıcıya gerekçeyi kontrol etmesini söylüyordu. Hata, kurulu 0.1.44
uygulamasının mevcut oturumuyla yeniden üretildi; reddedilen alan işlem anahtarıydı.

Portal artık bu başlığı koruyor. Genel internet uçlarının izin listesi, oturum
doğrulaması, rol denetimleri ve açık kapatma onayı korunuyor. Agent ve Tailscale
kimlik başlıkları API'ye aktarılmıyor. Arayüz hata yanıtındaki alanları koruyup
gerekçe, sürüm ve eksik işlem bilgisi için ayrı açıklama gösteriyor; yazılan
gerekçe ve kapatma seçimi hata sonrasında korunuyor.

Düzeltilen portal, önceki kaynak ve dosya izinleri korunarak ofis sunucusuna
kuruldu. API yeniden başlatılmadı, veritabanı değişmedi. Aynı kurulu istemcide,
var olmayan sentetik dosyaya gönderilen istek artık işlem anahtarı denetimini
geçip beklenen 404 `not_found` yanıtına ulaşıyor. Gerçek dosya kapatılmadı.

Doğrulama:

- 553 arayüz testi geçti; geniş çalıştırmada atlanan iki veritabanlı arayüz testi
  ayrıca yalıtılmış PostgreSQL ile geçti. Yapılandırılmayan altı canlı API testi atlandı.
- 19 API testi gerçek PostgreSQL üzerinde geçti. Yeni test, gerçek HTTP portalı
  üzerinden eksiklerle önizleme, aynı anahtarla tekrar, açık onay, gerçek File Agent
  taşıması, gerekçenin kaydı ve kaynak/hedef dosya içeriğini doğruluyor.
- 16 portal/edge testi ve gerçek Windows yayıncısını kullanan entegrasyon testi geçti.
- TypeScript, ESLint ve tam derleme geçti. Windows x64 paket açılışı, ofis profili
  ve 63 paketlenmiş arayüz dosyası doğrulandı.

0.1.45, 2026-10-18T07:13:43.210Z tarihinde kimlik doğrulamalı ofis kanalına
yayımlandı: 105.179.531 bayt, SHA-256
`89a4802ca536dc01872b8b1cbb6df5b1f486fde6d440d4bd870857c1ca85733c`.
Kurulu 0.1.44 istemcisi güncellemeyi `available` gördü; paketin tamamını HTTP 200,
doğru boyut ve SHA-256 ile indirdi. Önceki manifest ve değiştirilemez yükleyici
korundu. Kurulum kullanıcının kontrolünde.

Kanıtlar: `.local/closure-validation-20261018/` altında `before-client-proof.json`,
`after-client-proof.json`, `backend-proof.json`, `targeted-validation.json`,
`checks-validation.json`, `frontend-db-integration.log`, `package-smoke.json`,
`publication-proof.json`, `final-client-proof.json` ve `final-office-proof.json`.
