# Saha fotoğrafları

Mobil giriş: [Saha fotoğraf portalı](https://hasarbotu.profaruk1.workers.dev/saha).
Mevcut HasarBotu hesabı ve Google girişi kullanılır. Kullanıcı plaka arar;
**Hasar**, **Şase** veya **KM** seçip kameradan ya da galeriden fotoğraf yükler.
Yazma yetkisi olan aktif yönetici, eksper, dosya sorumlusu ve sekreter hesapları
kullanabilir. Salt okunur hesaplar yükleyemez. Kuruluş sınırları korunur.

- Yalnızca doğrulanmış `YYYY OFİS/` konumundaki mevcut dosyalar aranır.
  Kapalı dosyalar görüntülenir, yükleme düğmeleri kapalıdır.
- Hasar adları mevcut en büyük numaradan sonra `HASAR 101.jpg`, `HASAR 102.jpg`
  şeklinde ilerler. Özel görseller `ŞASE.jpg` ve `KM.jpg` olur. Mevcut ad doluysa
  `ŞASE 2.jpg`, `KM 2.jpg` kullanılır; mevcut dosyalar değiştirilmez.
- JPEG, PNG, WebP, HEIC/HEIF ve AVIF desteklenir. Dosya sınırı 40 MiB, çözülmüş
  görsel sınırı 64 megapikseldir. Uygun olmayan görsel açık hata verir.
- Ofis JPEG kopyası 100–600 KiB aralığında hazırlanır. JPEG kayıplı bir formattır;
  boyut sınırı gerektiğinde çözünürlüğü azaltır. Orijinal baytlar ayrı ve özel
  sunucu dizininde değişmeden saklanır, yetkili kullanıcı tarafından indirilebilir.
  Çok küçük görseller büyütülmez; alt boyut sınırı geçerli JPEG yorum alanıyla
  karşılanır. EXIF yönü uygulanır, şeffaf arka plan beyaza dönüştürülür.
- Aktarım 256 KiB parçalarla ilerler. Kesilince aynı dosya tekrar seçilerek veya
  açık sayfadaki **Devam et** işlemiyle doğrulanmış konumdan sürdürülür.
  Yeniden deneme aynı yüklemeyi çoğaltmaz. Sayfa kapatıldığında seçili yerel
  dosyaları tarayıcı korumayabilir; yeniden seçim gerekir.
- **Bu cihazda oturumumu hatırla** başlangıçta işaretsizdir. Seçilirse oturum
  çerezi en fazla 12 saat kalıcı olur. Seçilmezse oturum çerezi tarayıcı oturumuyla
  sınırlıdır; sunucudaki süre yine 12 saattir. Parola, reklam ve izleme çerezi
  saklanmaz. Çıkış oturumu ve çerezi iptal eder.

## Çalışma ve dağıtım

### Ücretsiz genel adres

Cloudflare hesabındaki `hasarbotu` Worker, ücretli alan adı veya abonelik olmadan
`https://hasarbotu.profaruk1.workers.dev/saha` adresini sunar. DNS/HTTPS, gerçek
kurumsal oturum, tek sonuç veren plaka araması, fotoğraf geçmişi ve 390 piksel
ekranda taşmayan yerleşim canlı adreste doğrulanmıştır. Kimlik doğrulama korunur.

`deploy/cloudflare/field-portal-worker.mjs`, yalnızca saha arayüzünü ve ortak
`scripts/field-portal-routes.mjs` izin listesindeki API yollarını mevcut **genel
Funnel** adresine iletir. Tailscale kimlikleri, ajan anahtarları ve diğer proxy
üstbilgileri aktarılmaz. Yazmalarda gelen Origin önce kendi adresiyle tam olarak
eşleştirilir; bundan sonra ofis ağ geçidinin Origin değeri kullanılır. İstekler
64 KiB, fotoğraf parçaları 256 KiB sınırındadır. Yanıt gövdeleri akışla iletilir;
özel yanıtlar önbelleğe alınmaz. Çerezler Secure/HttpOnly/SameSite niteliklerini,
oturum hatırlama tercihini ve son kullanma süresini korur; Domain eklenmez.

TLS bağlantısı Cloudflare'da sonlanır ve ofise yeniden TLS ile bağlanır. Uygulama
Cloudflare depolamasına fotoğraf yazmaz; orijinallerin kalıcı konumu ofisteki özel
dizindir. Ofis bilgisayarının ve mevcut Funnel bağlantısının çalışması gerekir.
Google'ın mevcut izinli dönüş adresi korunmuştur; yeni OAuth istemcisi, API
anahtarı veya Cloudflare hesabına kalıcı dağıtım anahtarı oluşturulmamıştır.

`npm run test:field:edge` güvenlik/aktarımı, `npm run build:field:edge` dağıtılabilir
paketi hazırlar. `.local/field-edge/site/` içindeki `_worker.js`, `_routes.json` ve
`index.html`, Cloudflare Pages Direct Upload için kullanılabilir. Aynı derlenmiş
modül `hasarbotu` Worker'ına dağıtılır. Ofis ağ geçidi güncellenirken
`field-portal-server.mjs` ile birlikte `field-portal-routes.mjs` de kopyalanmalıdır.

`hasarbotu.pages.dev` projesi de dağıtılmıştır. Genel Cloudflare DoH çözümlemesiyle
27 canlı HTTP kontrolü geçmiştir; denenen yerel/ofis DNS yollarında TLS bağlantısı
kurulamadığından kullanıcılara Workers adresi verilir. Önizleme alan adları üretim
oturumu açamaz. Eski Funnel adresi teknik bağlantı olarak korunur.

Cloudflare Free planının günlük 100.000 dinamik istek kotası, Workers ve Pages
Functions arasında ortaktır; her yükleme parçası da bir istektir. Sınırsız trafik
veya otomatik ücretli plan geçişi taahhüt edilmez.
[Güncel kota](https://developers.cloudflare.com/pages/functions/pricing/),
[Direct Upload ve `_worker.js` desteği](https://developers.cloudflare.com/pages/get-started/direct-upload/).

API için mutlak, özel `FIELD_PHOTO_DIRECTORY` gerekir. `0062_field_photo_uploads`
eklemeli geçişi uygulanır. Orijinaller ve JPEG önbelleği bu dizinde tutulur;
otomatik saklama süresi veya silme görevi eklenmemiştir. Yeni yüklemeler 500 MiB
boş alan rezervini ve kullanıcı başına 100 bekleyen yükleme sınırını gözetir.

`scripts/field-portal-server.mjs`, Vite çıktısındaki `field.html` dosyasını sunar.
Yapılandırması: `FIELD_UI_DIRECTORY`, `FIELD_API_ORIGIN` (loopback API),
`FIELD_PUBLIC_ORIGIN` (HTTPS), `FIELD_PORT` (3200). Yalnızca loopback'e bağlanır;
genel erişim izin listesi giriş, Google girişi ve saha fotoğraf yollarıyla sınırlıdır.
Yönetim, makine ajanı ve masaüstü güncelleme yolları genel erişime kapalıdır.
HTTPS, tam Origin denetimi, HttpOnly/SameSite çerezleri ve CSP uygulanır.

Ofiste mevcut Tailscale Funnel 443, bu sınırlı ağ geçidine yönlendirilmiştir.
`FIELD_ALLOW_TAILNET_API=true` yalnızca doğrudan Tailscale Serve arkasındaki
loopback kurulumunda kullanılabilir. Özel ağa gelen isteklerde Serve kimliği
mevcut özel API bağlantısını korur; API'nin normal oturum/yetki kontrolü sürer.
Funnel isteklerinde kimlik üstbilgisi bulunmaz. İnternetten sahte kimlik
üstbilgileriyle de özel uçların 404 döndüğü gerçek genel IP üzerinden doğrulanmıştır.
[Tailscale Serve kimlik üstbilgileri](https://tailscale.com/docs/features/tailscale-serve)
bu güven sınırının parçasıdır; ağ geçidi doğrudan internete bağlanmamalıdır.
Ofisin mevcut LAN HTTPS bağlantısı korunmuştur.

`deploy/windows-service/field-photo-runner.mjs`, özel bir JSON dosyasından
`runtimeDirectory`, `environment` ve isteğe bağlı `logFile` alır. Ortam, normal
dosya ajanının makine kimliğini, kök eşlemesini ve freshness gate ayarlarını içerir.
Yalnızca fotoğraf kuyruğunu işler. Normal dosya ajanında fotoğraf işleme varsayılan
olarak kapalıdır; etkinleştirmek için `HASARBOTU_FIELD_PHOTOS_ENABLED=true` gerekir.

Ofiste pCloud P: sürücüsü etkileşimli Windows oturumuna bağlı olduğu için
`HasarBotu-Field-Photo-Worker` görevi pCloud'u çalıştıran aynı kullanıcının
oturumunda, sınırlı yetkiyle ve gizli başlatıcıyla çalışır. Oturum açılınca başlar;
normal servis ajanı fotoğraf kuyruğunu ayrıca tüketmez. Çalıştırılabilir dosya ve
gerekli kod/gate dosyalarına yalnızca okuma/çalıştırma, işleyici günlüğüne yazma
izni verilmiştir. Fotoğraf orijinallerinin özel API dizini bu hesaba açılmamıştır.
Ofis bilgisayarı, pCloud ve ilgili Windows oturumu kullanılabilir olmalıdır;
geçici kesintide görseller sunucuda bekler ve yeniden denenir.
Gizli PowerShell başlatıcısı, kendisini başlatan WScript işleminin kimliğini ve
başlama zamanını izler. Görev durduğunda sahip olduğu Node sürecini de sonlandırır;
başlat/durdur/yeniden başlat kontrolünde tek işleyici kaldığı doğrulanmıştır.
Başlatıcı yalnızca `Start-Process -Wait` kullanmamalıdır: Görev Zamanlayıcı'nın
WScript'i durdurması, bu şekilde oluşturulan alt süreçleri kendiliğinden kapatmaz.

Her yazmada güncel dosya konumu ve süreli ajan kiralaması doğrulanır. Gate,
**yeni dosya hedefinin** boş, çakışmasız ve senkronizasyon açısından güvenli ad
alanında olduğunu mevcut `file_destination` işlemiyle denetler. Geçici dosya bu
kontrolden sonra oluşturulur; kendi pCloud aktarımı güvenlik kontrolünü bloke
etmez. Mevcut, ilgisiz fotoğrafların attestation kayıtları yeni fotoğraf eklenmesi
için zorunlu tutulmaz. Windows'ta aynı klasördeki atomik, üzerine yazmayan
`File.Move` kullanılır. Başarılı dosyanın boyutu/hash'i okunup doğrulanmadan
fotoğraf hazır kaydı ve kullanıcıya atfedilen denetim olayı oluşturulmaz.

HEIC çözümü sunucu tarafında `libheif-js` 1.23.5 kullanır (LGPL-3.0).
Paketin LICENSE dosyası dağıtımında korunur. Kitaplık değiştirilmemiştir;
[kaynak ve derleme yönergeleri](https://github.com/catdad-experiments/libheif-js)
ve [libheif kaynakları](https://github.com/strukturag/libheif) ayrı lisanslıdır.
Kitaplık mobil JavaScript veya masaüstü UI paketine eklenmez.

## Doğrulama · 2026-10-17

- Chromium, Firefox ve WebKit: 90 kabul kontrolü; 320–1440 piksel arayüz,
  kamera/galeri seçimi, JPEG/HEIC/AVIF, bağlantı kesilip devam etme, izinli çerez,
  kuruluş/yetki sınırları, mevcut dosya koruma ve hash doğrulaması.
- Gerçek ofis P: sürücüsü: ayrı, parola korumalı geçici PostgreSQL üzerinde
  üç sentetik görsel, üretim freshness gate ve gerçek Windows işleyicisiyle
  `HASAR 102.jpg`, `ŞASE.jpg`, `KM.jpg` olarak yazıldı. `HASAR 101.jpg` korundu.
  Üç görsel 102.400 bayttı; dosya ve veritabanı hash'leri, orijinaller ve üç
  denetim olayı eşleşti. Deneme dosyaları kaldırıldı; üretim dosyası oluşturulmadı.
- Genel Funnel IP'si üzerinden 18 erişim kontrolü geçti; sahte Tailscale kimliği
  özel uçları açmadı. Özel ağ bağlantısı ve Google giriş yapılandırması korundu.
- TypeScript, ESLint, üretim derlemesi ve paket sınırları geçti. Regresyon testi,
  gate'in yeni dosya hedefini kontrol etmesini ve kontrol öncesi pCloud üzerinde
  geçici dosya oluşturmamasını da doğrular.
  Toplam 2.806 test geçti. Ana çalıştırmada atlanan altı isteğe bağlı canlı HTTP
  testi ayrıca çalıştırılıp geçti; kalan atlanmış kontrol yoktur. Mobil tarayıcı
  kabul kontrolleri bu sayıya ek olarak 90 kontroldür.
- Windows x64 0.1.40 kurulum paketi gerçek Electron başlangıcında denetlendi;
  63 UI dosyası ve ofis profili eşleşti. 2026-10-17T18:46:07.707Z tarihinde
  kimlik doğrulamalı ofis kanalına yayımlandı. Önceki 0.1.39 paketi/manifesti korundu.
  Paket 105.178.645 bayt, SHA-256:
  `d48a455bc58c5e714954d623bf512d42a64a4ad6b74bfac3f366bb6712ccfb1a`.

## Son işletim kontrolü · 2026-10-18

Uzun süreli kontrolde klasör tarayıcısının `PCLOUD_DATABASE_SNAPSHOT_UNSTABLE`
geçici hatasında kapandığı görüldü. Bu hata artık güvenli okumayı erteleyen bir
durumdur: o çevrimde kayıtlar korunur, sonraki normal tarama tutarlı veriden devam
eder. Gerçek PostgreSQL/SQLite regresyon testi önce `BLOCKED`, ardından `PASS`
gördü ve dosya kayıtlarının değişmediğini doğruladı. Ofiste yeni süreç 607 klasörün
tam envanterini yeniden uzlaştırdı; yanlış kapsam, silinmiş örnek plakalar ve
sentetik deneme kaydı sayısı sıfır, `72ACL481` etkin kayıt sayısı birdir.

Bu düzeltme dahil 0.1.41 paketi 2026-10-17T22:00:04.928Z tarihinde ofis kanalına
yayımlandı. 0.1.40 manifesti ve değişmez kurulum paketi korundu. Yeni Windows x64
paketi 105.178.922 bayt, SHA-256:
`5db4996a61257bb4416427a61a47c7429c7e6445a3ad7f5d632495aebe10ce91`.
Paketin gerçek başlangıcı, 63 UI dosyası ve ofis profili doğrulandı. Çalışan
sunucudaki 454 dosya doğrulanmış kaynak/derleme çıktısıyla eşleşti. Beş servis ve
tek etkileşimli fotoğraf işleyicisi sağlıklı; geçici veritabanları, görevler ve
inspector dinleyicileri kaldırıldı. Kullanıcıların çalışan istemcilerine zorunlu
kurulum uygulanmadı.

0.1.39 kurulu istemci, 0.1.40'ı `available` gördü ve 105.178.645 baytın tamamını
doğru SHA-256 ile indirdi. 0.1.41 için aynı son kontrol sırasında kullanıcının
oturum süresi dolmuştu. Kullanıcı normal girişini yeniledikten sonra 0.1.39
istemcisinin gerçek güncelleme işlemi 0.1.41'i `available` gördü; 105.178.922
baytın tamamı HTTP 200 ve tam SHA-256 eşleşmesiyle indirildi. Aynı oturumla
plaka araması, fotoğraf geçmişi ve merkezi profil erişimi doğrulandı. Kimlik
doğrulama atlanmadı; zorunlu kurulum yapılmadı.

Gerçek fiziksel telefon kamerası, her eski tarayıcı sürümü ve her cihaz modeli
ayrı ayrı denenmemiştir. Üç güncel tarayıcı motoru ve farklı ekran ölçüleri
doğrulanmıştır. Dağıtım kanıtları özel `.local/field-photos-20261017/` dizinindedir.

## Ücretsiz adres teslimi · 2026-10-18

Workers adresinde normal DNS ve doğrulanan TLS ile 27 HTTP kontrolü geçti;
arayüz ve 10 bağlı varlık derleme çıktısıyla bayt bayt eşleşti. Kullanıcının normal
girişinden sonra canlı oturum, `72ACL481` için tek sonuç, fotoğraf geçmişi/yükleme
kontrolleri ve 390 piksel yerleşim doğrulandı. Üretim dosyasına deneme fotoğrafı
eklenmedi. Ofis bilgisayarı da yeni genel adresin sağlık yanıtını doğruladı.

15 ağ geçidi/edge testi, 162 masaüstü testi ve gerçek Windows yayıncı testi geçti
(178 PASS). Bu tekrar çalıştırmada TEST_DATABASE_URL verilmediği için 13 isteğe
bağlı masaüstü/veritabanı testi atlandı; yeni adresin canlı kabulü ayrıca yapıldı.
Tam derleme, ESLint, paket açılışı, 63 paketlenmiş UI dosyası ve ofis profili geçti.

0.1.42, 2026-10-17T22:35:27.352Z tarihinde kimlik doğrulamalı ofis kanalına
yayımlandı. Paket 105.178.735 bayt, SHA-256
`866e92bfd2f2fdbea41c4f518b600400aea1a324658e3b2b308e788ef67f7c57`.
Kurulu 0.1.41 istemcisi güncellemeyi `available` gördü; bütün paketi HTTP 200,
tam boyut ve hash eşleşmesiyle indirdi. Önceki manifest/paket korundu; zorunlu
kurulum yapılmadı. Son kontrolde beş servis, tek etkileşimli fotoğraf işleyicisi
ve 607 dosyalık envanter sağlıklıydı. Geçici görev ve inspector kapatıldı.
Kanıtlar `.local/field-edge/delivery-proof.json` ve aynı dizindeki ayrıntılı
HTTP, tarayıcı, paket, yayın ve istemci doğrulama dosyalarındadır.
