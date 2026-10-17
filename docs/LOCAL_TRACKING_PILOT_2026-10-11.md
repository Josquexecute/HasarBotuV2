# Yerel salt okunur takip pilotu — 11 Ekim 2026

> Bu tarihsel belgedeki kurum, hesap ve yol adları anonimleştirilmiştir. Gerçek bağlantı değerleri özel ofis yapılandırmasından alınır.

**Sonraki doğrulama düzeltmesi:** Seçilen iki dosya `_HASARBOTU` uygulama
kayıt klasöründeydi; bunlar hasar evrakı değildi. Hash/kalıcılık testi geçerli
olsa da evrak kapsamı bu ilk pilotla doğrulanmış sayılmaz. Gerçek evrak
kapsamı, genişletilmiş test ve güncel servis durumu için
[11 Ekim takip genişletmesi](LOCAL_TRACKING_EXPANSION_2026-10-11.md).

**Durum: seçilen gerçek klasör için PASS.** `51793-22893` bilgisayarında
güncel kaynakla ayrı test kurulumu çalışıyor. Ön kontrol:
[yerel depolama kontrolü](LOCAL_STORAGE_CHECK_2026-10-11.md).

| Bileşen | Konum / durum |
|---|---|
| Kurulum | `C:\HasarBotuPilot\local-tracking-20261011` |
| PostgreSQL | Ayrı küme, `127.0.0.1:55442`; `hasarbotu_local_tracking_20261011_test`; 50 migration |
| API | `127.0.0.1:3146`; normal yetkili DB rolü, superuser değil |
| Web arayüzü | `http://127.0.0.1:3147`; güncel production UI, aynı origin üzerinden API |
| Takip | `D:\OfficeStorage`; yalnız seçilen bir gerçek klasör test kaydına bağlı |
| Windows servisleri | `hb-local-tracking-db-20261011`, `hb-local-tracking-api-20261011`, `hb-local-tracking-tracker-20261011`; üçü de Running / Manual / LocalService |
| Masaüstü kısayolu | `HasarBotu - Yerel Takip Testi`; normal giriş formuyla ayrı test hesabını açar |

## Doğrulama

- Güncel frontend ve tüm workspace build'leri PASS; API/File Agent bağımlılık
  kapanışları mevcut dağıtım betikleriyle hash doğrulanarak kopyalandı;
  dağıtılmış iki servisin import/native bağımlılık smoke kontrolü 2/2 PASS.
- Gerçek klasördeki iki dosyanın pCloud `P:` kaynağı ayrı etkileşimli
  işlemle okunup attest edildi. Yerel byte hash'leriyle freshness `ready`
  doğrulandı. Bu, bütün şirket ağacının sync tamamlandığı iddiası değildir.
- Gerçek Session 0 / LocalService scanner → gerçek HTTP API → PostgreSQL:
  iki tracked file, iki gözlem, sorumlu test kullanıcısına iki kalıcı bildirim.
  DB hash'leri yerel dosyalarla ve ilk bulut attestation'ıyla eşit.
  Evraklar `pending`; insan inceleme/onay sınırı korundu.
- Üç Windows servisi durdurulup yeniden başlatıldı. Gerçek scanner iki
  evrakı yeniden bildirdi; API her ikisine `changed:false` yanıtladı.
  Dosya revizyonları 1; bildirim sayısı 2 olarak korundu.
- Gerçek Electron kabuğu ve production UI: normal giriş formu,
  Bildirimler ekranında iki evrak/iki bildirim, sayfa yenileme sonrası
  oturum/veri kalıcılığı PASS. Renderer'da Node erişimi yok.
- Bu kurulum sırasında hedefli takip birim testleri 34/34, takip UI
  testleri 5/5 PASS. Ön kontroldeki File Agent 110/110 ve izole takip
  API/PostgreSQL 45/45 sonuçları ayrıca önceki raporda kayıtlıdır.

Browser eklentisi eksik `browser-service.mjs`, Computer Use ise eksik
`@oai/sky` nedeniyle bağlanamadı. UI kontrolü mevcut projenin gerçek
Electron test düzeneğiyle yapıldı; başka bir kullanıcı tarayıcısının
profili veya oturumu okunmadı.

## Sınırlar ve kullanım

Bu ortam ayrı bir test hesabı ve test dosya kaydı kullanır. Tüm gerçek
dosyaların kayıt/klasör eşlemesi, üretim kullanıcıları ve üretim veritabanı
geçişi yapılmadı. Eski Eksist pilotu değiştirilmedi; servisleri önceki
Stopped durumunda kaldı. Gerçek evrakların byte içerikleri değişmedi.

Tracker yalnız `startDocumentTracker` çalıştırır; fiziksel taşıma, silme,
klasör oluşturma veya OCR iş kuyruğunu yürüten agent döngüsü başlatılmaz.
Google/Gmail/SBM bağlanmadı. Windows bilgisayarı yeniden başlatılmadı;
makine reboot kabulü ve otomatik servis başlangıcı henüz doğrulanmış değildir.

Masaüstü kısayolu, çalışmayan test servislerini başlatıp test penceresini
açar. Servisleri başlatmak gerekirse mevcut Windows yönetici yetkisi gerekir.
İlk kısayol sürümünde Electron `WindowStyle Hidden` ile başlatıldığı için
pencere görünmüyordu; gizli UI testi bu kullanıcı açılışını kapsamıyordu.
Kısayol düzeltildi: uygulama normal pencerede başlar, pencere açıkça gösterilip
öne alınır ve ikinci çift tıklama aynı pencereyi kullanır. Gerçek `.lnk`
üzerinden açılış, Windows'un native pencere görünürlüğü ve ikinci açılışta
aynı süreç/öne alma kontrolleri PASS. Açılış hataları artık görünür bildirilir.
Parolalar ve agent sırrı depo dışında korumalı `private` dizinindedir;
DB yönetici sırrına LocalService erişimi verilmedi.

Yerel kanıtlar `.local/local-tracking-20261011/` altında:
`bootstrap-summary.json`, `selected-case-summary.json`,
`validation-initial.json`, `validation-restart.json`, `validation-final.json`,
`desktop-validation.json` ve build/test/dağıtım logları. UI görüntüsü
kurulumun korumalı `private/ui-verified.png` dosyasındadır.
Kısayol regresyon kanıtı: `launcher-validation.json`.
