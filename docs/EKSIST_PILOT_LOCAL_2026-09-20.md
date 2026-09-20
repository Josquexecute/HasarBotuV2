# Eksist V2 — bu bilgisayardaki izole pilot

20 Eylül 2026. Kaynak commit: `497f3f275929098bf06149d66a595874fc1387b5`.
Önceki rapor: [EKSIST_PILOT_2026-09-20.md](EKSIST_PILOT_2026-09-20.md).

**DURUM: PARTIAL. Genel kullanıma dağıtım onayı yok; dağıtım ZIP'i üretilmedi.**

## Hazırlanan ortam

| Bileşen | Gerçek konum / durum |
|---|---|
| Kurulum kökü | `C:\HasarBotuPilot` — mevcut V1 kurulumundan ayrı |
| PostgreSQL | 18.4; `hb-pilot-postgres`, `127.0.0.1:55441`; DB `eksist_pilot` |
| API | `hb-pilot-api`, `127.0.0.1:3141`; Node 24.21.0; üretim yapılandırması, yalnız loopback |
| File Agent | `hb-pilot-agent`; ayrı pilot kimliği; gerçek freshness aracı |
| Servis hesabı | Üç servis de `NT AUTHORITY\LocalService`; API DB rolü `eksist_pilot_app`, superuser/rol/DB oluşturma yetkisi yok |
| Migration | 0049 dahil 49 migration; migration dosyaları kurulu database paketinde |
| Masaüstü | V2 0.1.2; ayrı `com.hasarbotu.eksistpilot` kimliği ve `HasarBotu V2 Eksist Pilot` ürün adı |
| NSIS adayı | `C:\HasarBotuPilot\desktop-build\HasarBotu-Setup-0.1.2.exe`; x64, imzasız; kurulumu/arayüzü doğrulanmadı |
| pCloud | Mevcut sync: `D:\BaranGlobalStorage` → `BARAN GLOBAL EKSPERTİZ`, folder ID `22216867113`, synctype `3` |
| Pilot depolama | `D:\BaranGlobalStorage\_V2_EKSIST_PILOT_20260920`; gerçek ofis klasörleri kullanılmadı |

Servisler Manual başlangıç türündedir ve çalışma sonunda çalışır durumdadır.
Kalıcı makine ortam değişkenleri yazılmadı. Sırlar `private` altında dar ACL ile
tutulur; rapora veya dağıtım manifestine değerleri yazılmaz. Servis kodu dizinleri
standart kullanıcılar ve LocalService için salt okunurdur. LocalService yalnız
pilot depolama, PostgreSQL verisi ve loglarda gerekli yazma erişimine sahiptir;
pCloud yerel DB klasörüne salt okunur erişim verilmiştir.

Pilot freshness adaptörü yalnız alt dizin önekini gerçek bulut-relative yola
çevirir, mevcut `determineSessionSafeCaseStatus` sonucunu aynen uygular. Sahte
`ready` üretmez, `always-ready-freshness-gate` kullanılmaz. pCloud sync ayarı
değiştirilmedi. Pilot sentetik dizini mevcut sync nedeniyle buluta da yansır.

## Ölçülen sonuçlar

| Kontrol | Sonuç ve sınır |
|---|---|
| Build | UI ve tüm workspace build'leri PASS; ayrı NSIS x64 aday build'i PASS |
| Bağımlılık kapanışı | İki servis hash doğrulamalı dağıtıldı; depo dışı çalışma dizininden import/native yükleme 2/2 PASS |
| Servis hesabı | Session 0, LocalService kimliği; klasör oluşturma/okuma/yazma/silme ve gerçek root health PASS |
| OCR | Kurulu API worker'ıyla görsel, metin PDF, taranmış PDF 3/3 PASS; API/agent OCR bağımlılıkları kurulum kökünden çözüldü |
| Metin PDF örneği | İlk kısa örnek 100 karakter eşiği nedeniyle OCR'a gitti; metin katmanı Poppler ile doğrulanıp yeterli uzunlukta sentetik belgeyle tekrarlandı; `pdf_text` PASS |
| pCloud okuma | Servis hesabında tutarlı, salt okunur yerel DB snapshot PASS; dört bekleyen task görüldü; tüm ağacın sync tamamlanması kanıtlanmadı |
| Gerçek freshness | Sentetik dosya P: kaynağından ayrı yönetici işlemiyle hash'lendi; güncel file ID/revizyon attestation'ı ile servis hesabında `ready` PASS |
| Yeni klasör freshness | FAIL: `TARGET_CASE_ROOT_NOT_FOUND`; dört gerçek quick-create planı agent tarafından `case_not_fresh` ile reddedildi |
| Gerçek HTTP aktarımı | Metin, PNG, metin PDF, taranmış PDF; extraction ve indirilen orijinal içeriğin SHA-256 eşliği 4/4 PASS |
| Eşzamanlı tekrar | Her aktarımda aynı idempotency anahtarıyla gerçek HTTP isteği; tek case/source/plan PASS; fiziksel klasör oluşmadı |
| API kesintisi | Pilot API ve agent servisleri durduruldu, bağlantı hatası gözlendi, tekrar açıldı; aynı case/plan ile tekrar PASS — UI testi değildir |
| İlk kayıt yanıt kaybı | Önceden var olmayan yeni kayıt commit edildikten sonra yerel proxy gerçek soketi kapattı; yeniden istek tek case/source/plan bıraktı PASS — UI testi değildir |
| Servis yeniden açılışı | Kaynak bağlantıları ve içerikleri okunabilir PASS — masaüstünü yeniden açma testi değildir |
| Pilot yedeği | PostgreSQL 18.6 `pg_dump -Fc`; roller parola hash'leri olmadan; aynı kesim noktasında pilot depolama yedeği |
| Geri yükleme | `eksist_pilot_restore`; 114 tablonun sıralanmış tüm içerikleri eşit, kaynak belge baytları dahil; 5 case/source/plan, 49 migration; yeniden up sıfır migration; depolama SHA-256 eşit PASS |
| Eski küme | Önceki manifestteki 3.102 dosyada sıfır SHA-256 farkı PASS; V1 app.asar değiştirilmedi |
| Gerçek masaüstü UI | NOT RUN / BLOCKED; metin yapıştırma, pano görseli, dosya seçici, iki kayıt düğmesi, detail/source görüntüleme ve UI tekrar akışı PASS değildir |

Yedek/geri yükleme **yalnız sentetik pilot DB'sidir**. Mevcut V1/üretim verisinin
V2'ye taşınması veya üretim yedeğinden migration provası yapılmış sayılmaz.

## Açık engeller

1. `services/file-agent/src/agent.ts` workspace oluşturulmadan önce freshness
   çağırır. Gerçek kapı, `pcloud-session0-freshness-gate.mjs` içinde hedef dizinin
   varlığını şart koşar; boş dosya kümesi de `unknown` sayılır. Yeni workspace
   henüz bulunmadığı için `ready` olamaz. Önceki entegrasyon fixture'ı sürekli
   `ready` verdiğinden bu yaşam döngüsü uyuşmazlığını yakalamamıştı. Dizini elle
   önceden oluşturarak veya freshness'i devre dışı bırakarak sonuç geçirilmedi.
   Yeni oluşturma için yokluk/çakışma/güncellik sözleşmesinin ayrıca tasarlanıp
   gerçek kapıyla regresyon testi yapılması gerekir; mevcut veri güvenliği
   kuralı bu pilot hazırlığında gevşetilmedi.
2. Windows otomasyonu `@oai/sky` modülünü bulamadı. Desteklenen browser runtime,
   eski `browser/26.818.61809/scripts/browser-service.mjs` yolunu arayıp modül
   bulunamadı hatası verdi. Paketli Electron'u hata ayıklama bağlantısıyla ve
   sonra normal biçimde açma girişimleri otomatik onay denetimince
   `blocked by policy` ile reddedildi; daha ayrıntılı gerekçe verilmedi.
   Başka yürütme yolu kullanılarak ret aşılmadı.

Bu iki engel nedeniyle `Kaydet ve detayını aç`, `Kaydet ve kapat`, gerçek pano
aktarımı ve bağlantı/yanıt kaybından sonra UI'da tekrarsız **ready** tamamlanması
kanıtlanamadı. Installer adayının derlenmesi, kurulu masaüstü kabulü değildir.

## Kanıt ve operasyon

Kalıcı kanıt: `C:\HasarBotuPilot\evidence\`.
`service-probe.json`, `api-acceptance.json`, `retry-acceptance.json`,
`first-response-loss.json`, `backup-restore.json`,
`original-cluster-preserved.json`, `artifact-manifest.json`.
Manifest 8.871 dosya hash'i, commit/runtime bilgisi ve `releaseApproved:false`
içerir. Yedek `C:\HasarBotuPilot\backups\pilot-20260920` altındadır;
sırlar bunun dışında, korumalı `private` dizininde tutulur.

Yerel operasyon/geri dönüş yönergesi: `C:\HasarBotuPilot\OPERASYON.md`.
Kullanıcının elle açabileceği `Open-Pilot.cmd` hazırlandı; otomatik çalıştırılmadı.
Araçlar ve test betikleri `.local/eksist-installed-pilot-20260920/` altında
saklandı. İlk hazırlık aşamasında API/File Agent kaynak kodu veya freshness güvenlik sözleşmesi değişmedi.

PostgreSQL istemci araçlarının kaynağı [PostgreSQL Windows indirme sayfasının](https://www.postgresql.org/download/windows/)
yönlendirdiği [EDB binary arşividir](https://www.enterprisedb.com/download-postgresql-binaries).
Servis sarmalayıcı [WinSW 2.12.0 resmi sürümünden](https://github.com/winsw/winsw/releases/tag/v2.12.0)
alındı. Bu araçların kullanımı mevcut V1 kurulumunu değiştirmedi.

## 20 Eylül devamı — otomatik alan kuralları

Kullanıcının devam talebiyle API ve UI güncellendi: ihbar numarası kaynak eksper
atama tarih-saatinden, takip tarihi sunucudaki Türkiye kayıt gününden alınır.
Kaynak sigorta/eksper alanları kilitli; servis kalem penceresinden revize edilir.
Tam şasi/motor ve diğer ayrıştırılan araç alanları kaynak snapshot'ında tutulur.
Eksik temel araç alanları kaydı durdurur. Önceki kayıtlar geriye dönük değiştirilmedi.
Kaynak eksper kimliği saklanır; uygun uygulama kullanıcısı yoksa giriş hesabı
uydurulmaz. Davranış ayrıntısı: [Eksist hızlı oluşturma](EKSIST_QUICK_CREATE.md).

Build, lint, API 27, domain 4, DTO/sorgu kontratları 21 ve UI/API/agent entegrasyonu
2 test PASS. Genel UI 339 PASS / 6 atlandı; son değişiklikleri kapsayan UI/veri
paketi 244 PASS / aynı 6 atlandı (bu sayılar toplanmaz). Entegrasyon testindeki
freshness kapısı hazır fixture'dır; gerçek pCloud kabulü değildir.

Kurulu serviste dört aktarım biçimi için otomatik alan, kilit, servis revizyonu,
yeniden okuma ve tekrarsız kayıt kontrolleri PASS. Metin/metin PDF isim doğruluğu
PASS; görsel/taranmış PDF'de OCR I/İ değişikliği nedeniyle isim doğruluğu FAIL.
Dört yeni klasör de `case_not_fresh` nedeniyle FAIL. Gerçek paket UI'si NOT RUN.
Bu nedenle genel durum PARTIAL; dağıtım kabulü yoktur.

Yeni aday `C:\HasarBotuPilot\desktop-build-automatic\HasarBotu-Setup-0.1.2.exe`;
Open-Pilot.cmd bu adayı açar, önceki paket korunur. x64 ve imzasızdır. UI/API/
domain/contracts içindeki 936 build dosyası kaynak çıktısıyla eşleştirildi.
API dağıtımında 6.622 dosyanın hash doğrulaması geçti. Dağıtım ZIP'i hazırlanmadı.

Güncelleme öncesi yedek `backups\automatic-20260920\pilot.dump`; ayrı
`eksist_automatic_restore` DB'sine geri yüklenip 114 tablo birebir karşılaştırıldı.
Son kontrolde önceki 6 dosya, 9 kaynak ve araç profil/sürüm kayıtları değişmedi.
Migration sayısı 49. Kanıtlar `evidence\automatic-*.json` ve `automatic-tests`;
geri dönüş ve elle test yönergesi `C:\HasarBotuPilot\OTOMATIK_ALANLAR.md`.

## Freshness ve OCR devam?

Yeni klas?r engeli d?zeltildi ve kurulu pilotta d?rt aktar?m?n tamam? fiziksel
`ready` oldu. OCR eksper ad? art?k a??k do?rulama gerektirir. Yeni test, yedek,
kesinti ve aday paket sonu?lar?: [devam raporu ve geri d?n?? y?nergesi](EKSIST_FRESHNESS_2026-09-20.md).
Ger?ek masa?st? kabul? eksik @oai/sky nedeniyle h?l? BLOCKED; da??t?m ZIP?i yoktur.
