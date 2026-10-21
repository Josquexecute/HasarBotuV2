# `@hasarbotu/desktop`

HasarBotu V2'nin **ince Electron kabuğu** (ADR-Q06, Paket 21 / D2).

Kabuk aşağıdaki görevleri ve dar masaüstü yardımcılarını yürütür:

1. Loopback aynı-origin köprüsünü başlatır (`@hasarbotu/desktop-bridge`, D1).
2. API'nin ayakta ve **sürüm olarak uyumlu** olduğunu doğrular (D3).
3. Güvenli bir `BrowserWindow` açar ve o **tek** origin'i yükler.
4. `src/main/*` içindeki saf politika kararlarını Electron API'lerine bağlar.

**Kabukta iş mantığı yoktur**; güncelleme, klasör açma ve Touch yardımcılarının IPC çağrıları gönderici, ana frame ve izinli origin ile sınırlandırılır. UI verisini
bugün olduğu gibi göreli `/api/...` üzerinden alır; hiçbir adapter sözleşmesi
değişmez. Bu kural, Paket 21'in geri alma stratejisinin ("desktop paketini
kaldır, web dağıtımını kullan") geçerli kalmasının tek şartıdır.

## Güvenlik sınırları

| Alan | Uygulanan |
|---|---|
| Renderer | `nodeIntegration=false`, `contextIsolation=true`, `sandbox=true`, `webSecurity=true`, `webviewTag=false` |
| Preload | Kabuk bilgisi ve dar masaüstü yardımcıları; ham Node/fs veya `ipcRenderer` erişimi yok |
| CSP | `default-src 'none'` ile başlar; `script-src`/`style-src`/`connect-src` yalnız `'self'`. `unsafe-inline`/`unsafe-eval` yok |
| Navigasyon | Yalnız köprü origin'i. `file:`, `data:`, `about:blank`, uzak origin ve şema kaçışları reddedilir |
| Yeni pencere | Electron içinde **hiçbir** yeni pencere açılmaz — allowlist'teki hedef bile |
| Harici bağlantı | Yalnız `https` + host allowlist'i; hedef işletim sistemi tarayıcısına devredilir (`src/main/external.ts`) |
| İndirme | Yalnız kabuk origin'inden; dosya adı işletim sistemi için güvenli hâle getirilir; kaydetme yolunu **kullanıcı** seçer (`src/main/downloads.ts`) |
| İzinler | Kamera/mikrofon/konum/bildirim/pano dâhil **hiçbir** izin verilmez |
| Ağ çıkışı | `connect-src 'self'` — renderer'dan dışarıya istek atılamaz |

### Harici bağlantı allowlist'i

Her giriş repository'de gerçekten kullanılan bir hedefe karşılık gelir:

| Host | Neden |
|---|---|
| `mail.google.com` | E-posta hazırlama, Gmail web compose bağlantısı |
| `resmigazete.gov.tr`, `www.resmigazete.gov.tr` | Değer Kaybı kural kaynakları |
| `seddk.gov.tr`, `www.seddk.gov.tr` | Değer Kaybı kural kaynakları |

### API hazırlık ve sürüm uyum kapısı

Pencere **açılmadan önce** kabuk API'nin `/health` yanıtını doğrular. Sorgu main
process'ten sunucu-sunucu yapılır (`/health` sürümlü `/api/v1` tabanının
dışındadır ve köprü yalnız `/api/*` iletir).

Pencere yalnız API ayakta, `status: ok` ve sürüm uyumluyken açılır. Aksi hâlde
kullanıcıya **Yeniden dene / Kapat** seçenekli bir iletişim kutusu gösterilir;
uygulama yarım açılmaz ve kullanıcı mahsur kalmaz.

Uyum kuralı (`src/main/compatibility.ts`): servis kimliği birebir eşleşmeli,
ana sürüm birebir eşleşmeli; ana sürüm `0` iken ikincil sürüm de birebir
eşleşmelidir (semver'de `0.x` serisinde kırıcı değişiklik ikincil sürümle
taşınır). Yama sürümü ve ön sürüm etiketi uyumu etkilemez.

## Yapılandırma

Ortam değişkenleri açık parser'dan geçer; geçersiz değerde kabuk **başlamaz**
ve hata mesajı yalnız alan adı + kural taşır (değer taşımaz).

| Değişken | Varsayılan | Kural |
|---|---|---|
| `HASARBOTU_API_ORIGIN` | `http://127.0.0.1:3100` | http(s) origin; yol/sorgu/fragment/kimlik yok. **Düz `http` yalnız loopback** — uzak API `https` olmalıdır |
| `HASARBOTU_ASSET_ROOT` | repo kökündeki `dist` | UI build çıktısı dizini |
| `HASARBOTU_BRIDGE_PORT` | `0` (boş port) | 0–65535 tam sayı |

## Çalıştırma

```powershell
npm run build:ui                         # UI build ciktisi (dist)
npm run build --workspace @hasarbotu/desktop
npm run start --workspace @hasarbotu/desktop
```

API ayrı çalışmalıdır (`npm run dev:api`).

## Test

```powershell
$pw = (Get-Content "$env:USERPROFILE\.hasarbotu\hasarbotu_test.pass" -Raw).Trim()
$env:TEST_DATABASE_URL = "postgres://hasarbotu_test:$pw@127.0.0.1:5432/hasarbotu_test"
npm run test --workspace @hasarbotu/desktop
```

`test/electron-shell-e2e.test.ts` **gerçek Electron sürecini** başlatır ve
üretim kabuğunun ta kendisini (`startDesktopShell`) çalıştırır; ürün kodunda
test kancası yoktur. Gerçek üretim UI build'ini kullanan kontrol yalnız
`dist/index.html` varsa koşar, yoksa **açıkça atlanır**.

## Bu pakette olmayanlar

- Authenticode kod imzası. NSIS kurulumu ve kullanıcı kontrollü, kimlikli ofis güncellemesi aşağıdaki yayın prosedüründedir.
- Renderer'dan Node/fs erişimi, doğrudan PostgreSQL, File Agent görevi.
- Allowlist dışındaki harici bağlantılar.

## Bilinen Electron tuzağı

ESM giriş noktasında **üst düzey `await` kullanılmaz**. Electron, giriş
modülünün değerlendirmesi bitmeden `ready` olayını yaymaz; üst düzey
`await app.whenReady()` yazılırsa uygulama sessizce kilitlenir. Bu davranış
gerçek Electron 43 ile gözlendi (bkz. `docs/DECISION_LOG.md` → HB-2026-105).

## Kalıcı yerel depolama

Masaüstü başlangıcı ilk seçilen köprü portunu `userData/bridge-origins` altında API origin'i bazında saklar. Sonraki açılışlar aynı portu kullanır; port doluysa uygulama hata bildirir ve farklı bir porta geçmez. Kaydedilmiş portla çelişen `HASARBOTU_BRIDGE_PORT` değeri kabul edilmez. Chromium oturum bölümü de API bazında ayrıdır; hızlı not anahtarları kullanıcı bazında ayrılmaya devam eder.

Bu değişiklikten önce rastgele portlarda bırakılmış depolama otomatik taşınmaz. Eski taslak gerekiyorsa önceki sürümün ilgili origin'indeki metin ayrıca kurtarılmalıdır.

## Touch Assistant tepkileri

Yardımcı iki dakika etkileşim olmadığında uyur; üzerinde animasyonlu Zzz görünür.
Uyurken fareyi takip etmez ve arka plan işlemleriyle uyanmaz; tıklanınca uyanır.
Hareket azaltma tercihinde Zzz sabit gösterilir. Not, operasyon, belge bilgisi yükleme, PDF metni çıkarma ve
e-posta işlemleri sürerken kısa çalışma hareketleri yapar. Başarısız işlemde
başını sallar; yardımcıya tıklamak ilgili açıklamayı açar. Yeni takip bildirimi
kısa bir dikkat hareketi, onaylanmış görev tamamlama el sallama üretir. Ekranın
kenarına bırakıldığında inişten sonra kenardan bakar. Her basışta sıkışma, küçük
zıplama, sallanma, göz kırpma, utanıp gülümseme veya şaşırmadan biri seçilir;
altısı da gösterilmeden havuz yenilenmez ve art arda aynı tepki gelmez.
Hareketler seyrekleştirilir; hesap ve Windows hareket azaltma ayarları geçerlidir.
Electron UI testleri varsayılan olarak ekran görüntüsü üretmez; yalnız açıkça
istenen görsel doğrulama için `HB_CAPTURE_SCREENSHOTS=1` kullanılabilir.

## Ofis güncellemesi yayınlama

Başlangıçta bağlantı kontrolü ve Windows izin hazırlığı ayrı, scriptsiz bir durum penceresinde gösterilir; bağlantı hazırlığı hataları ve zaman aşımı kullanıcıya açıklanır. Yardımcı konumu 200 ms içinde birleştirilerek asenkron ve atomik kaydedilir; çıkış son kaydı bekler. İmleç karakterden dört karakter genişliğinden uzaktaysa göz takibi 320 ms, yakındaysa 80 ms aralıkla çalışır; gizleme ve azaltılmış hareket sorgulamayı durdurur. API uyumu masaüstü paket sürümünden bağımsız olarak desteklenen `0.0.x` sözleşmesini korur.

Kullanıcıya yansıyan tamamlanmış değişiklikler doğrulandıktan sonra masaüstü sürümünü artır,
Windows x64 NSIS kurulumunu üret ve gerçek paketin açılışını doğrula. Yerel derleme veya
kurulum, ofis güncelleme akışını ilerletmez. Depo kökünde Node.js 24 ile:

```powershell
npm run typecheck
npm run lint
npm run build
node scripts/run-release-tests.mjs
npm run package:win --workspace @hasarbotu/desktop -- --publish never
node scripts/smoke-desktop-package.mjs
```

Sürüm testleri ayrı bir `_test` veritabanına ait `TEST_DATABASE_URL` ister.
Paketleme ve smoke testi için mevcut özel ofis bağlantı profilini kullan;
`HASARBOTU_DISTRIBUTION_PROFILE` bu profili göstermelidir. Özel yapılandırmayı Git'e ekleme.

API'nin `DESKTOP_RELEASES_DIR` ayarı mutlak, yalnız dağıtım yöneticileri ve servis hesabınca
yazılabilir bir dizin olmalıdır. Ayar eksikse yayın devre dışıdır; bozuk manifest veya
paket 503 döndürür. Servis ayarını değiştirmek gerekirse API'den önce bağımlı file-agent'ı
durdur; API sağlıklı olduktan sonra agent'ı yeniden başlat.

Yayınlamadan önce önceki `latest.json` manifestini ve değişmez kurulum paketini koru.
Mevcut ofis sunucusunda, doğrulanan sürüm/paket ve yapılandırılmış yayın diziniyle çalıştır:

```powershell
node scripts/publish-desktop-release.mjs <installer.exe> <DESKTOP_RELEASES_DIR> <version> <notes.txt>
```

Notlar mevcut bir metin dosyasıyla sağlanır; yeni Markdown raporu oluşturma.
Not dosyasını UTF-8 olarak yaz; Türkçe metni BOM içermeyen Windows PowerShell 5.1
betiğine gömme. Yayıncı bozuk karakterleri ve UTF-8 olmayan notları reddeder.
`npm run check:text` kaynak metinleri ve Unicode içeren Windows betiklerinin BOM'unu
denetler; üretim derlemesi de bu kontrolü çalıştırır.
Yayınlayıcı Windows sürüm kaynağını, gerçek boyutu ve SHA-256'yı doğrular; değişmez
`<sha256>.exe` kopyasını kontrol edip `latest.json` dosyasını atomik değiştirir.
Eski sürüme dönmeyi ve aynı sürüm altında farklı paket yayınlamayı reddeder.

Teslimatı tamamlamadan önce mevcut kimlik doğrulamalı bağlantı üzerinden
`GET /api/v1/desktop-updates/latest` yanıtını, eski kurulu istemcinin yeni sürümü
`available` görmesini ve `GET /api/v1/desktop-updates/artifacts/:sha256` indirmesinin
tam boyutunu ve SHA-256'sını doğrula. Önceki manifest ve paketin korunduğunu da kontrol et.
Sonucu burada kısa kaydet; ekran görüntüsü üretme. GitHub yayını ofis akışını, backend'i
veya veritabanını kendiliğinden güncellemez. Depo görünürlüğünü veya herkese açık indirme
kanalını değiştirme; çalışan istemcilere zorla kurulum yapma.

Kullanıcı **Ayarlar → Uygulama güncellemeleri → Güncellemeleri kontrol et** üzerinden
sürümü görür ve **Güncelle ve yeniden başlat** ile kurar. Mevcut kullanıcı profili ve
API ayarı korunur. Electron, indirmeden önce sürümü yeniden doğrular; yönlendirmeleri
reddeder, boyut/hash/Windows başlığı ve paket sürümünü denetler. Doğrulama hatası uygulamayı
açık bırakır ve kısmi indirmeyi kaldırır. Kurulum sonucu
`userData/updates/<sha256>/install-result.json` içinde tutulur. Mevcut akış Authenticode
imzası eklemez.

Son doğrulanan ofis yayını: **0.1.67**, 2026-10-21T04:50:51.208Z; Windows x64,
112.952.619 bayt, SHA-256 `7b2e96847fc9aca66afeb5a9c44b85dba4c438d3d454204e12bad9e27a550e57`.
Kapanışla çakışan belge/fotoğraf kayıtları, tekrar gönderimler, kaynak kurtarma,
tarih sıralaması ve oturum depolama hataları düzeltildi. 28 doğrudan bağımlılık,
Node 24.22.0 ve PDF 6.4.299 doğrulandı; TypeScript 6.0.3 uyumluluk için korundu.
3.141 sürüm testi geçti; genel koşuda atlanan altı bağlantı testi ayrı gerçek
API/PostgreSQL ortamında 6/6 geçti. Ek Node denetimleri, 90 saha tarayıcı kontrolü,
76 hesaplayıcı kontrolü, gerçek Electron/NSIS ve paket açılışı geçti; 65 UI dosyası eşleşti.
İzole ortamda 5/10 ayrı saha oturumunda 15 fotoğraf gerçek File Agent ile kayıpsız yayımlandı.
5/10/20/50 oturumun yerel, sentetik ve her biri 10 saniyelik yükünde 54.590 istekte
hata görülmedi; 5/10 oturum p95 değerleri 10,64/18,10 ms. Bu ölçüm ofiste 50
kullanıcı veya uzun süreli bellek kararlılığı garantisi değildir. Ücretli AI ve gerçek
test e-postası kullanılmadı; sağlayıcı hata senaryoları sözleşme testleriyle sınandı.
133 tablo/503.525 satırlık yedek ayrı ortamda hash ile geri yüklenerek doğrulandı.
Migration 0067, 8.219 runtime dosyası ve beş ofis servisi doğrulandı; önceki runtime,
0.1.66 manifesti ve değişmez kurulumu korundu. Kurulu **0.1.65**, yeni sürümü
`available` gördü; kimlik doğrulamalı HTTP 200 indirmesinde tam boyut/SHA-256 eşleşti.
Çalışan istemcilere zorla kurulum yapılmadı.

Önceki doğrulanan ofis yayını: **0.1.66**, 2026-10-20T15:39:16.725Z; Windows x64,
105.204.575 bayt, SHA-256 `8587d53982cf657a0e2057a91375f614bd180ded074c40feee0f802e4bce21ab`.
Föyde revize servis ve doğru bölüme ait telefon/adres aktarımı, tüm basılı alanların
düzenlenmesi, ayrı A4 önizleme, çoklu SBM şirket seçimi, başarısız atomik kapanışta
güncel önizleme ve yeni onay akışı teslim edildi. Touch uyku göstergesi ve hesaba özel
bildirim penceresi/ses/tepki tercihleri eklendi; Tramer sonuçları büyük pencereyle gösterilir.
3.111 genel test geçti; dış servis ayarı isteyen 6 canlı test atlandı. Gerçek Electron,
A4 PDF, NSIS Unicode hedef, typecheck, lint, derleme ve paket açılışı doğrulandı;
62 paketli UI dosyası kaynak çıktısıyla eşleşti. Yeni tercih tablosu ve API ofise
uygulandı. Özel bağlantı katmanının föy başlığını iletmesi 18 testle doğrulandı.
Kurulu **0.1.65**, yeni sürümü `available` gördü; kimlik doğrulamalı HTTP 200 indirmesinde
tam boyut ve SHA-256 eşleşti. Canlı istemcide revize servis, eski/yeni föy sözleşmeleri
ve kişisel bildirim ayarları doğrulandı. Önceki 0.1.65 manifesti ve değişmez paketi korundu;
çalışan istemcilere zorla kurulum veya kullanıcı kayıtlarında toplu değişiklik yapılmadı.

Önceki doğrulanan ofis yayını: **0.1.65**, 2026-10-19T19:06:55.197Z; Windows x64,
105.199.448 bayt, SHA-256 `2461f534946619132758b7d2c9f1badde7cdf27eeb4b12ada518a803b84031b0`.
Görünür başlangıç durumu/hataları, asenkron ve çıkışta tamamlanan konum kaydı,
uzak imleçte seyrek göz takibi ve API uyum politikası temizliği teslim edildi.
3.075 genel test geçti; genel koşuda atlanan altı canlı bağlantı testi ayrı
ortamda 6/6 geçti. Ek dört kaynak yenileme testi ve gerçek Electron çıkışında
son hareketin korunması testi geçti. Typecheck, lint, servis kontrolü, derleme,
gerçek NSIS Unicode hedef testi ve paket açılışı geçti; 61 UI dosyası ve dokuz
paketli ana süreç modülünün kaynak derlemeyle hash eşleşmesi doğrulandı.
İki ofis görevi yapılandırılmış yerel Windows başlatıcısına geçirildi; gerçek
görev çıkış kodu 0, 621 klasörün salt okunur önizlemesinde bekletilen kayıt 0.
Kullanıcının onayıyla, etkin dosya/fotoğraf işi yokken ve korumalı SQLite yedeği
alındıktan sonra pCloud aynı etkileşimli oturumda yeniden başlatıldı; yaklaşık
50,6 GiB özel bellek tüketiminin yarattığı baskı kalktı, kullanılabilir Windows
bellek taahhüdü yaklaşık 80 MiB'den 44,6 GiB'ye çıktı. Beş ofis servisi çalışıyor.
Kurulu **0.1.64**, yeni sürümü `available` gördü; kimlik doğrulamalı HTTP 200
indirmesinde tam boyut ve SHA-256 eşleşti. Önceki 0.1.64 manifesti ve değişmez
paketi korundu; zorla kurulum ve ekran görüntüsü üretimi yapılmadı.

Önceki doğrulanan ofis yayını: **0.1.64**, 2026-10-19T17:37:28.946Z; Windows x64,
105.197.735 bayt, SHA-256 `155f3a6f54a11b99ba8ca8d4d9cbbb7427939c733f282f82d56ef8237b3eaee1`.
AI/mevzuat çağrılarında köprünün erken zaman aşımı ve kapanış sonrası dosya
yenilemesindeki geç yanıt/oturum hatası düzeltildi; yeni regresyonlar önce hatayı
üretip düzeltmeden sonra geçti. Saha tarayıcı testlerinde ekran görüntüsü açık
seçim gerektirir. 3.063 genel test geçti; bu koşuda atlanan 6 canlı bağlantı testi
ayrı API/PostgreSQL ortamında 6/6 geçti. Chromium, Firefox ve WebKit'te 90 saha
kontrolü, 199 korumalı API rotasında oturumsuz erişim reddi, dağıtım/yayınlayıcı
entegrasyonları, 182 JavaScript ve 62 PowerShell dosyası sözdizimi doğrulandı.
Typecheck, uyarısız lint, servis kontrolü ve derleme geçti; bağımlılık taraması
bilinen açık bildirmedi. Gerçek x64 paket açılışı, 61 UI dosyası ve paket içindeki
ana giriş/köprü kodunun kaynak derlemeyle hash eşleşmesi doğrulandı. Kurulu
0.1.63 istemcisi 0.1.64'ü `available` gördü; kimlik doğrulamalı HTTP 200 indirmesinde
tam boyut ve SHA-256 eşleşti. Önceki 0.1.63 manifesti ve değişmez paketi korundu;
beş ofis servisi çalışıyor. Zorla kurulum ve ekran görüntüsü üretimi yapılmadı.
Yalnız bu inceleme için başlatılan test PostgreSQL süreci kapatıldı.

Önceki doğrulanan ofis yayını: **0.1.63**, 2026-10-19T16:57:03.623Z; Windows x64,
105.197.784 bayt, SHA-256 `8b764420cc327f8d4713ac810917a4e0505b2aed59f197b2465310a78057d530`.
Genel kod taramasında iki hata giderildi: yarıda kalan aktarımların ayırdığı fotoğraf
adları hasar, şase ve kilometre yüklemelerini engellemez; seçimden kaldırılan saha
fotoğraflarının önizlemeleri hemen bellekten bırakılır. Gerçek API/PostgreSQL/worker/disk
zincirinde üç ad çakışması ve UI bellek bırakma regresyonu doğrulandı. 3.053 genel test
ve ayrı script koşusunda 209 test geçti; 6 harici canlı bağlantı testi atlandı. Ek script
koşusunda atlanan veritabanı senaryosu genel pakette veritabanıyla geçti. 178 JavaScript
ve 60 PowerShell dosyası sözdizimi, typecheck, lint, Windows servis doğrulaması,
derleme, gerçek x64 paket açılışı ve yayınlayıcı entegrasyonu geçti. Fotoğraf worker'ı
ve 61 saha UI dosyası yedeklenip hash ile doğrulandı; iki worker yeniden başlatıldı,
beş ofis servisi çalışıyor. Eski varlıklar korundu; gerçek dosyalar veya fotoğraf kayıtları
test için değiştirilmedi. Kurulu 0.1.61 istemcisinde `available`, sunulan saha HTML/JS
hash eşleşmesi ve kimlik doğrulamalı HTTP 200 paket indirmesinde tam boyut/SHA-256
eşleşmesi doğrulandı. Önceki 0.1.62 manifesti ve değişmez paketi korundu; zorla kurulum
yapılmadı.

Önceki doğrulanan ofis yayını: **0.1.62**, 2026-10-19T14:47:34.524Z; Windows x64,
105.197.911 bayt, SHA-256 `832c0085cf2c9552d6cf9fb5d0c56f1760e8cf9307c537ff68d9e3138ffe250f`.
**Kapanışa Hazır** (`ready_to_close`) oluşturma, düzenleme, aşama filtresi ve panoya
geri eklendi; bu aşama dosyayı açık tutar. Yeni pano istemcileri yedi aşamalı yanıtı
ister; eski istemcilere uyumlu altı aşamalı yanıt verilir. Ofis ağ geçidi bu seçim
başlığını ve `Vary` yanıtını iletir. 3.049 genel ve 17 ağ geçidi testi geçti;
6 harici canlı bağlantı testi atlandı. Typecheck, lint, derleme ve gerçek x64 paket
açılışı geçti. Beş çalışma modülü ve ağ geçidi yedeklenip hash ile doğrulandı;
API, File Agent, klasör tarama ve ağ geçidi servisleri çalışıyor. Kurulu 0.1.61
istemcisinde `available`, kimlik doğrulamalı yedi/altı aşamalı pano ve aşama filtresi,
HTTP 200 paket indirmesinde tam boyut/SHA-256 eşleşmesi doğrulandı. Önceki 0.1.61
manifesti ve değişmez paketi korundu; zorla kurulum yapılmadı.

Önceki doğrulanan ofis yayını: **0.1.61**, 2026-10-19T13:59:57.354Z; Windows x64,
105.197.835 bayt, SHA-256 `49e051fdab5157fc9d7e297ed3f7a5d59f72ae48691fb6eb6d4f81443fb9d080`.
Yeni dönem değer kaybı referans tahmini marka/model bilgileriyle birlikte çalışır;
onarım sonrası piyasa değeri istemeden rayiç, hasar, araç ve parça bilgilerinden
hesaplanır. Desteklenmeyen seçimler açıkça belirtilir; otomatik piyasa değer farkına
geçiş kaldırıldı. Genel katsayılar modele özel değerleme olarak sunulmaz; önceki
dönem ve isteğe bağlı piyasa karşılaştırması korunur. Eski sonuçlar yeniden hesaplama gerektirir;
girilmiş bilgiler korunur. 3.044 test geçti, 6 test atlandı; typecheck,
lint, derleme ve gerçek x64 paket açılışı geçti. Üç çalışma modülü yedeklenip hash
ile doğrulandı; üç ofis servisi çalışıyor. Kurulu 0.1.60 istemcisinde `available`,
kimlik doğrulamalı gerçek referans hesabı (onarım sonrası değer olmadan), desteklenmeyen
parça uyarısı, isteğe bağlı piyasa karşılaştırması ve HTTP 200 indirmesinde tam
boyut/SHA-256 eşleşmesi doğrulandı. Önceki 0.1.60 manifesti ve değişmez paketi
korundu; zorla kurulum yapılmadı.

Önceki doğrulanan ofis yayını: **0.1.60**, 2026-10-19T12:22:59.161Z; Windows x64,
105.197.360 bayt, SHA-256 `e36c97245235400c6756264f3653a4d9075e5ee0e4b7300ef6dd2c819a148d36`.
Açık dosyada not yazma yetkisi olan kişi, **Notlar ve Görüşmeler → Kendi notumu sil**
ile yalnız kendi notunu onaydan sonra kaldırabilir. Sunucu ve veritabanı yazar
kimliğini denetler; notun özgün içeriği ve silme geçmişi korunur. Başkasının notları,
V1 tarihsel kayıtları ve kapalı dosyalar korunur. Eski istemcilerin not listeleme
sözleşmesi değişmedi. Migration 0065 ve yedi çalışma modülü doğrulandı; üç ofis
servisi çalışıyor. 379 ilgili test, typecheck, lint, derleme ve x64 paket açılışı
geçti. Kurulu 0.1.58 istemcisinde `available`, kimlik doğrulamalı silme ucu,
gerçek ayarlar görünümündeki Türkçe notlar ve HTTP 200 paket indirmesinde
boyut/SHA-256 eşleşmesi doğrulandı. Gerçek kullanıcı notu test için silinmedi.
Önceki 0.1.59 manifesti ve değişmez paketi korundu; zorla kurulum yapılmadı.

Önceki doğrulanan ofis yayını: **0.1.59**, 2026-10-19T12:09:56.708Z; Windows x64,
105.197.230 bayt, SHA-256 `71f556af5e56c343b7afff2c141876e4831173752755a9c8b8f3dc882cd3c07b`.
Güncelleme notlarının Windows PowerShell 5.1'de yanlış kodlanması giderildi;
bozuk notlar yayıncıda reddedilir. Türkçe kullanıcı/kurulum yolları için güncelleme
betiği UTF-8 BOM ile yazılır. 384 ilgili test, typecheck, lint, derleme ve gerçek
x64 paket açılışı geçti. Kurulu 0.1.58 istemcisinde `available`, gerçek ayarlar
görünümünde notların birebir Türkçe kalması ve kimlik doğrulamalı HTTP 200 paket
indirmesinde boyut/SHA-256 eşleşmesi doğrulandı. Önceki 0.1.58 manifesti ve değişmez
paketi korundu; zorla kurulum yapılmadı.

Önceki doğrulanan ofis yayını: **0.1.58**, 2026-10-19T11:55:07.087Z; Windows x64,
105.197.172 bayt, SHA-256 `3d24cf9f5ea451eced6618be0369b2d43708a7a45be241aa54f587c19c5118d1`.
Aşamalar altı seçenekle ve aynı pano sütunlarıyla sınırlandı. Eski açık ofis dosyaları
Onarımda'ya alındı; 425 kapalı ve 41 eksik evrak dosyası korundu. Elle Uzaktan'a
alınan dosyalar tarama sonrası gizlenir; açık liste/pano odakta ve görünürken 30 saniyede
bir yenilenir. Kapanışta gerçek taşıma öncesi bekleme ayrıldı; işlem yeniden açılan
pencerede izlenir ve başarısız taşıma aynı doğrulama kimliğiyle yeniden denenebilir.
Doğrulanmış dış taşımalardaki iki eski işlem kilidi geçmiş silinmeden kaldırıldı;
resmî evrakla doğrulanan plaka/klasör düzeltmesi aynı vaka kimliği korunarak uygulandı.
3027 test geçti; 6 harici canlı API testi atlandı. Typecheck, lint, derleme,
x64 paket açılışı ve iki tutarlı ofis taraması geçti. Kurulu 0.1.57 istemcisinde
`available`, altı aşamalı canlı API, doğrulanmış klasör konumu ve kimlik doğrulamalı
HTTP 200 indirmesinde tam boyut/SHA-256 eşleşmesi doğrulandı. Önceki 0.1.57 manifesti
ve değişmez kurulum korundu; çalışan istemcilere zorla kurulum yapılmadı.

Önceki doğrulanan ofis yayını: **0.1.57**, 2026-10-19T10:00:46.740Z; Windows x64,
105.196.344 bayt, SHA-256 `e6ebf11afe847f6697b1bfd40abe99a5e09be14fa0ff6bc3ac84652f400218c0`.
Yeni ihbarlar `P:\BARAN GLOBAL EKSPERTİZ\2026 OFİS\_EKSİK DOSYALAR\PLAKA`
altında hazırlanır; yıl, ihbar tarihinden gelir. Dosya detayındaki **Tamamlandı · Ay
klasörüne taşı**, kaynak/hedef önizlemesi ve ayrı onayla ihbar ayına taşır. Aynı plaka
sonekleri korunur; hedefin üzerine yazılmaz. Güncel konum, işlem durumu ve iptal
seçeneği sunucudan okunur; sayfaya dönünce işlem izlenmeye devam eder.
Gerçek API/PostgreSQL/File Agent/disk zincirinde kayıt, taşıma, evrak içeriği ve
konumu, ofis taraması sonrası arama, kapanış/yeniden açılış ve ekranı tekrar açma
doğrulandı. 3.013 testlik genel paket geçti; harici canlı bağlantı isteyen 6 test
atlandı. Son tarama düzeltmesi ayrıca 48 API testi ve gerçek arka plan taramasıyla
doğrulandı: otomatik arşivlenen kayıt yeni konumda aynı klasör kimliğiyle geri
eşleşir; elle arşivlenen kayıt korunur ve tek kayıttaki değişiklik taramayı durdurmaz.
TypeScript, lint, üretim derlemesi ve Windows paket smoke testi geçti; 61 paket
UI dosyası doğrulandı. Sunucudaki 16 çalışma dosyası yedeklenip hash ile doğrulandı;
API, File Agent ve klasör tarama servisleri çalışıyor. Kurulu 0.1.56 istemcisinde
`available`, kimlik doğrulamalı yeni klasör işlem ucu ve HTTP 200 paket indirmesinde
tam boyut/SHA-256 eşleşmesi doğrulandı. Önceki 0.1.56 manifesti ve değişmez kurulum
korundu; zorunlu kurulum yapılmadı.

Canlı son kontrolde tarayıcı çalışmaya devam ediyor; pCloud yazmaları sırasında
`PCLOUD_DATABASE_SNAPSHOT_UNSTABLE` ile güvenli biçimde bekleyip taramaya devam ediyor.
618 klasör içeren iki tam ofis envanteri doğrulandı. Bir eski kayıt `folder_relocation_plate_mismatch`
nedeniyle ayrı incelemede tutuluyor; kayıt veya klasör plakası otomatik değiştirilmedi.

Önceki doğrulanan ofis yayını: **0.1.56**, 2026-10-19T06:33:48.191Z; Windows x64,
105.194.704 bayt, SHA-256 `4b623f8da681509e26cb6638e88440ef2b74b3d0cd42678bbb64d7446273cb1d`.
Yeni ihbar klasörleri `YYYY OFİS/Ay YYYY/PLAKA` altında oluşturulur; kaydın sonraki
ofis taramasında arşivlenip aramadan kaybolması düzeltildi. Kapanış ve yeniden açılış
akışı yeni konumu destekler; eski `YYYY/Ay YYYY` konumları da geçerlidir.
İki kayıt seçeneği gerçek API, PostgreSQL, File Agent, fiziksel klasör taraması ve
arama zinciriyle doğrulandı. 3.008 test geçti; harici canlı bağlantı isteyen 6 test
atlandı. TypeScript, lint, üretim derlemesi ve Windows paket smoke testi geçti;
61 paket UI dosyası doğrulandı. Kurulu 0.1.55 istemcisinde `available`, kimlik
doğrulamalı manifest ve HTTP 200 indirmesinde tam boyut/SHA-256 eşleşmesi doğrulandı.
Onarılan kaydın üç farklı plaka yazımıyla aranması ve özgün detayına erişim doğrulandı.
Önceki 0.1.55 manifesti ve değişmez kurulum korundu; zorunlu kurulum yapılmadı.

Önceki doğrulanan ofis yayını: **0.1.55**, 2026-10-19T06:06:50.897Z; Windows x64,
105.194.578 bayt, SHA-256 `48fac35384dffedd99747ca31951392b87ba250f376d0037ba59183bbe759b1c`.
Kurulu 0.1.54 istemcisinde `available` ve kimlik doğrulamalı HTTP 200 indirmesinde
tam boyut/SHA-256 eşleşmesi doğrulandı. Önceki 0.1.54 manifesti ve değişmez kurulum
korundu. 3.005 test geçti; harici canlı bağlantı ayarı isteyen 6 test atlandı.
TypeScript, lint, üretim derlemesi, 90 yerel Electron kontrolü ve Windows paket
smoke testi geçti; 61 paket UI dosyası doğrulandı. Altı tıklama tepkisi 2× çözünürlükte
farklı ve taşmasız çizildi. Yerel 0.1.55 kurulumunda altı gerçek fare tıklamasının
altı farklı tepki vermesi, her tıklamada menünün açılması ve klavye tepkisi doğrulandı.
Çalışan ofis istemcilerinin kurulumu kullanıcı kontrolündedir.
