# `@hasarbotu/desktop`

29 Ekim 2026: **0.1.87 ofise yayımlandı.** Durum panosu açıklamaları/okunabilirliği,
dosya tablosunun adlandırılmış sütunları ve uyarı/sorumlu ayrımı, mevzuat/AI yerleşimi,
kompakt açılabilir bildirimler ve Touch'ın dört sekmeli paneli yenilendi. İşlemler,
not taslakları ve ayarlar korundu; Touch'ın 11 çizim/hareket varlığı ile önceki
yayındaki 11 hesaplama kaynağı hash ile aynı. Üretim iş kayıtlarına müdahale edilmedi.
**3.475 test geçti / 8 atlandı**; atlamalar başarı sayılmadı. Son masaüstü süiti
273 geçti/1 atlandı; açık/koyu tema ve %100/%125/%150 gerçek Electron DPI
koşullarında 213 görsel/işlevsel kontrol geçti. Typecheck, lint, build, x64 NSIS
içeriği ve kurulumdan çıkarılan gerçek paketin açılışı geçti (76 UI/29 main-preload).

Aynı cihaz, Electron 44.9.1, 1440×900, 1.000 sentetik dosya ve varsayılan hareket
ayarlarıyla iki beş dakikalık koşunun ortalamaları (0.1.86 → 0.1.87):

| Süreç | CPU % | RAM çalışma kümesi, MiB |
|---|---:|---:|
| Electron ana süreç | 0,134 → 0,100 | 127,0 → 126,7 |
| Ana renderer | 0,248 → 0,266 | 253,0 → 254,0 |
| Touch karakter penceresi | 0,080 → 0,073 | 102,8 → 102,5 |
| Touch kontrol paneli | 0,014 → 0,015 | 120,4 → 123,9 |

Ortak GPU yükü %0,177 → %0,185 (20'şer PDH örneği);
gerçek Touch canvas çizimi yük altında 26,97 → 27,01 FPS.
Her koşuda 328 geçiş/164 tepki ve sıfır renderer hatası; son kalıcı renderer JS
belleği 15,66 → 15,70 MiB,
Touch paneli dinleyici sayısı koşu boyunca sabit. Çöp toplamaya müdahale edilmeyen
ayrı hızlı gezinme kontrolünde yerleşen renderer RAM'i 291,9 → 281,1 MiB.
Pano görünür hale gelme medyanı 399 → 333 ms, dosyalar/bildirimler yaklaşık 133 ms;
izole Electron giriş ekranı açılışı, sıcak disk önbelleğinde 579 → 500 ms.
Ölçümlerde ana test penceresi Windows odağını almıyordu; FPS bu eş koşullardaki
canvas çizim sayısıdır. Pencere başına GPU payı ayrıştırılamıyor; soğuk ofis
açılışı ve saatler süren dayanıklılık bu ölçümlerle doğrulanmış sayılmadı.
Anlamlı gerileme saptanmadı. Ölçümler, gerçek Electron görüntüleri ve kanıtlar
`.local/ui-renewal-087/` altında; başlangıç referansı yayımlanmış 0.1.86'nın
75/75 UI dosyasıyla hash olarak eşleşiyor. Yayın ve indirme sonucu aşağıdadır.

28 Ekim 2026: **0.1.86 ofise yayımlandı.** Değer Kaybı'nda
marka/model, kasa, konum, adet, malzeme/nitelik, aynı parçaya farklı konum ve
katsayı arayüz alanları kaldırıldı. EKSİST dosyası ve mevcut kayıtlar kullanılabiliyor;
kilometre ile çalışma saati ayrılıyor. Doğrulanmamış parça geçmişi ve bilinmeyen
hasar sayısı hasarsız/0 kabul edilmiyor; eski taslaklar ve kayıtlı parça işlemleri
korunuyor. Canlı SBM bağlantısı KTT sonucu sağlıyor, parça geçmişi sağlamıyor;
kayıtlı doğrulanmış geçmiş kanıtı veya inceleme gerekli. Kaynak, tarih ve uygulama
gerekçeleri `packages/domain/README.md` içinde kayıtlı; yeni katsayı eklenmedi.
Önceden doğrulanan 75 hedefli test, 192 kaynak Excel formül testi ve gerçek Electron → API → ayrı
PostgreSQL zincirinde 18 kontrol geçti. LibreOffice Calc `calculateAll` ile 14
araç türü eşleşti; Excel'in mevcut H1 tam-1.000 TL ve F9 5.001-saat kusurları da
bağımsız motorda doğrulandı. Kaynak çalışma kitabı değiştirilmedi; Microsoft Excel
kurulu olmadığından native Excel yeniden hesaplaması yapılmadı. Typecheck, lint,
build, x64 NSIS içeriği ve çıkarılan gerçek paketin açılış smoke'u geçti.
Touch yayın engeli test kaynaklıydı: görev çubuğundan zorlanan foreground geçişinde
Windows pencereyi öne aldığı halde `EVENT_SYSTEM_FOREGROUND` bildirimi gelmiyordu;
ayrı native gözlemci de bildirim almadı. Test önce normal foreground'u doğrulayıp
ardından gerçek tam ekran geçişini yapıyor; art arda iki açılış regresyona eklendi.
Touch üretim kodu, Değer Kaybı kaynakları ve Excel çalışma kitabı değiştirilmedi.
12 ardışık açılış, 124 hedefli kontrol ve ayrı pencere/görünüm testleri 2/2 geçti;
tam masaüstü süiti **272 geçti / 0 başarısız / 2 atlandı**. Hedefli koşulardaki
iki native imleç konumu hatası ayrı yeniden koşuda ve tam süitte geçildi; test
koşulu gevşetilmedi. Önceki değişmemiş süitler ve 39 yayın kontrolü yeniden kullanılınca
yayın kapısı 3.468 başarılı, 9 atlanan test içeriyor. Altı isteğe bağlı canlı API,
Windows WebKit SameSite, isteğe bağlı NSIS derleyicisi ve klasör bakım entegrasyonu
atlamaları başarılı sayılmadı. Typecheck/lint, yeniden derleme ve gerçek NSIS'ten
çıkarılan paketin açılışı geçti; 75 UI ve 29 main/preload dosyası kaynakla eşleşti.
Önceden doğrulanan backend yaması yedeklenerek dağıtıldı: 21 dosya doğrulandı,
20 dosya değişti; şema ve durdurulmuş işlem aralığında üretim kayıt sayıları korundu,
yeni işlem hatası yok, beş servis sağlıklı. Kanıtlar `.local/value-loss-20261028/`
ve `.local/touch-release-086/` altında; kesin paket ve istemci sonucu aşağıdadır.

28 Ekim 2026: **0.1.85 ofise yayımlandı**; Windows klasör adındaki harf büyüklüğü değişiminde yanlış arşivleme düzeltildi; kaynak/yayın karşılaştırması aşağıda kayıtlıdır.
640 asıl kayıt olarak onaylanıp eşlendi; 650 arşivde, kimliği ve geçmişi korunuyor.
723/725 ofis listesinden gizli; uzaktaki konum korunuyor, kimlik belirsizliği açık.

28 Ekim 2026 12:45 Türkiye saati hedefli son kontrol: 247/247 test geçti, atlanan test yok.
Üretimde salt okunur doğrulama 640/650 geçmişini ve 54/54 dosya hash'ini,
723/725'in 263 iş/geçmiş satırını ve önceki 53/53 dosya hash'ini doğruladı.
pCloud listesi ilk ölçümde 53, son ölçümde 55 dosya gösterdi; ek iki şasi fotoğrafı
doğrudan okunup hash'lendi, son ölçümde liste farkı kalmadı. Önceki raporda kayıp
dosyanın adı yanlıştı: `EVRAK/S POLİÇE.jpg` korunmuş, eski `EVRAK/16.jpeg` mevcut
uzak klasörde yok; kurtarma doğrulanmadı. 723/725'in kanonik kimliği seçilmedi.
Beş servis sağlıklı, yeni işlem hatası yok; üretim verisi değiştirilmedi.
Yeni yazılım hatası saptanmadı; kod/paket değişikliği ve yeni yayın yapılmadı, **0.1.82** korunuyor.

Önceki **0.1.81** yayınının [kalıcı sonuç raporu](./PENDING-UPDATES-20261028.md):
271 hedefli test geçti. Kullanıcı talebiyle OCR/PDF uzun koşusu 7,77 saatte güvenle
sonlandırıldı; sonuç/loglar korundu, 48 saatlik kararlılık kanıtı sayılmadı.
Önceki paketler ve manifest korundu; ticari dağıtım yapılmadı.

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
| `accounts.google.com` | Kurumsal giriş ve Gmail/SBM için sistem tarayıcısında Google onayı |
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

Google girişi ve Gmail/SBM bağlantısı tek tıkla sistem tarayıcısında açılır. Temiz sonuç ekranı yalnız işlem türü ve durumu taşır; kod, token ve state içermez. Oturum yalnız isteği başlatan uygulamanın HttpOnly çereziyle tamamlanır. Tamamlanınca ana pencere öne gelir; `hasarbotu://oauth/return` bağlantısı da yalnız uygulamayı açıp odaklar, kimlik veya oturum verisi kabul etmez. Bekleyen işlem sayfa yenilenince aynı sekmede devam eder; sonuç ekranları hareket azaltma tercihini destekler.

Masaüstü başlangıcı ilk seçilen köprü portunu `userData/bridge-origins` altında API origin'i bazında saklar. Sonraki açılışlar aynı portu kullanır; port doluysa uygulama hata bildirir ve farklı bir porta geçmez. Kaydedilmiş portla çelişen `HASARBOTU_BRIDGE_PORT` değeri kabul edilmez. Chromium oturum bölümü de API bazında ayrıdır; hızlı not anahtarları kullanıcı bazında ayrılmaya devam eder.

Bu değişiklikten önce rastgele portlarda bırakılmış depolama otomatik taşınmaz. Eski taslak gerekiyorsa önceki sürümün ilgili origin'indeki metin ayrıca kurtarılmalıdır.

## Touch Assistant tepkileri

Ayarlar → Touch görünümüm → **Göz Rengi** paleti önizlemeyi ve gerçek Touch'ı
anında günceller. **Görünümü Kaydet** rengi hesaba kaydeder; yeniden açılışta
korunur. Kaydedilmemiş önizleme ayarlardan çıkınca geri alınır. **Otomatik göz
rengi** gövdeye göre kontrast seçimine döner; kişisel skinler, ifadeler ve halo
korunur. Benzer göz/gövde renklerinde karşıt renkli yumuşak kenar görünürlüğü korur.

Yardımcı iki dakika etkileşim olmadığında uyur; üzerinde animasyonlu Zzz görünür.
Uyurken fareyi takip etmez ve arka plan işlemleriyle uyanmaz; tıklanınca uyanır.
Hareket azaltma tercihinde Zzz sabit gösterilir. Not, operasyon, belge bilgisi yükleme, PDF metni çıkarma ve
e-posta işlemleri sürerken kısa çalışma hareketleri yapar. Başarısız işlemde
başını sallar; yardımcıya tıklamak ilgili açıklamayı açar. Yeni takip bildirimi
kısa bir dikkat hareketi, onaylanmış görev tamamlama el sallama üretir. Ekranın
kenarına bırakıldığında inişten sonra kenardan bakar. Her basışta sıkışma, küçük
zıplama, sallanma, göz kırpma, utanıp gülümseme veya şaşırmadan biri seçilir;
altısı da gösterilmeden havuz yenilenmez ve art arda aynı tepki gelmez.
Tekli, çiftli ve seri tıklamalar farklı vurgular; uzun basış merak, sıkılma ve
huysuzlanma üretir. Sürükleme esner, bırakma üç farklı inişten birini seçer.
Boşta 16–28 saniyede bir 11 hareketlik tekrarsız havuzdan hareket oynar; iki dakika
sonra uyur. Gerçek DIP hareketinde 1,1 saniyede en az dört güçlü yön değişimi
(en az 40 DIP, 650 DIP/sn) yeşil yüz, şaşkın gözler, yavaş yıldızlar ve bulantı
tepkisini başlatır. Bırakınca 3,6 saniyede toparlanır; yeniden tetikleme aralığı
14 saniyedir. Normal sürükleme ve küçük titreşimler bu tepkiyi başlatmaz.
Hareketler seyrekleştirilir; hesap ve Windows hareket azaltma ayarları geçerlidir.
Electron UI testleri varsayılan olarak ekran görüntüsü üretmez; yalnız açıkça
istenen görsel doğrulama için `HB_CAPTURE_SCREENSHOTS=1` kullanılabilir.

Bu taban hareketlere ek olarak 61 yeni tepki bulunur: dokuz art arda tıklama,
altı hızlı tıklama, dokuz baş dönmesi/toparlanma, yedi sürükleme, üç iniş, beş
uzun basış, on boşta hareket ve on iki nadir sürpriz. Sabır yoğun etkileşimle
azalır; Touch yalnız bırakıldığında sakinleşir. Boşta ve sürpriz seçimleri son dört
tepkiyi tekrarlamaz; iniş havuzu art arda aynı hareketi seçmez. Touch menüsündeki
**Touch tepkileri** bölümünden tepki seçilir,
sakinleştirilir, bitirilir, duraklatılır veya uyutulur/uyandırılır. Hareket azaltma
elle oynatmayı da durdurur. Yeni sahneler tek çizim zaman çizelgesini kullanır;
ayrı animasyon zamanlayıcıları oluşturmaz ve dosya/not işlemlerini değiştirmez.

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

Son doğrulanan ofis yayını: **0.1.87**, 2026-10-28T22:19:56.905Z; Windows x64,
113.003.577 bayt, SHA-256 `1088cbe51eab96e36de39ad985c7a3f3420a8ab320520643650548837d36acd0`.
Kurulu **0.1.85**, yeni sürümü `available` gördü; kimlikli manifest ve
kurulum indirmesi HTTP 200 döndü, tam boyut ve SHA-256 eşleşti. Önceki 0.1.86
manifesti ve değişmez kurulumu korundu. Beş servis sağlıklı, geçici inspector
ve doğrulama görevi kapalı/kaldırılmış durumda; zorla kurulum yapılmadı.

Önceki doğrulanan ofis yayını: **0.1.86**, 2026-10-28T19:07:38.061Z; Windows x64,
113.001.860 bayt, SHA-256 `5590f077da1aa55916a4d140af7a9ec81b8ae44b76e7d77fdd32d6301c625d2d`.
Kurulu **0.1.85**, güncellemeyi `available` gördü; kimlikli manifest ve kurulum
indirmesi HTTP 200 döndü, indirilen tam boyut ve SHA-256 eşleşti. Önceki 0.1.85
manifesti ve değişmez paketi, önceki 0.1.86 aday paketi korundu. Zorla kurulum
yapılmadı; doğrulama görevi kaldırıldı, inspector kapandı ve beş servis sağlıklı.

Önceki doğrulanan ofis yayını: **0.1.85**, 2026-10-28T16:58:10.710Z; Windows x64,
113.001.283 bayt, SHA-256 `e52e6e729fbb64fa9f1ac06be94223f6fcc78e441c8343f135ef7f855b2a217b`.
Git/uzak dallar, reflog, stash ve iki çalışma alanı karşılaştırıldı: 47 commitlenmemiş dosyadaki
0.1.82–0.1.84 düzeltmeleri zaten teslim edilmişti; ayrı API dalının dört dosyası kaynakla eşdeğer,
stash veya ilave kayıp commit yok. Önceden dışlanan çalışmalar geri alınmadı. File Agent'ın eski
assistant-appearance sözleşme kopyası da güncel paketle eşitlendi; kullanımda eksik bir özellik bulunmadı.
Windows'ta aynı dizin olan `Ekim`/`EKIM`, Türkçe harf dönüşümü nedeniyle ayrı sayılıp kaydı yanlışlıkla
arşivliyordu. Envanter ve taşıma karşılaştırması mevcut klasör sahipliği anahtarıyla uyumlu hale getirildi;
ofis/kapalı yerleşim adlarının Türkçe yorumlanması korundu. Yeni test önce hatayı üretti, düzeltmeyle geçti.
64 hedefli test geçti: 11 envanter, bir gerçek arka plan tarayıcı, 25 File Agent, iki belge takip,
yedi kimlik/çakışma, sekiz gerçek Electron/Chromium ve 10 yayın testi. İsim filtresi dışındaki 53 test
çalıştırılmadı; zorunlu test atlanmadı, önceki kapsamlı denetim tekrarlanmadı. Typecheck, lint, build,
x64 NSIS, paket ve gerçek kurulumdan çıkarılan içerikle açılış smoke geçti; 75 UI ve 29 main/preload
dosyası kaynakla eşleşti. Gerçek NSIS kurulum/yükseltme/kaldırma kabulü bu sürümde tekrarlanmadı.
Sunucuda yedi dosya doğrulandı, altı değişen dosya yedeklenerek dağıtıldı; son kontrolde 660 çalışma
dosyası kaynakla eşleşti. Migration, elle veri bakımı veya üretim belgesi taşıma/silme/eşleme yok.
Beş servis sağlıklı, yeni işlem hatası sıfır. Kurulu **0.1.83**, güncellemeyi `available` gördü;
kimlikli HTTP 200 indirmesinde tam boyut/SHA-256 eşleşti. Önceki 0.1.84 manifesti ve değişmez
kurulum korundu; zorla kurulum yapılmadı, tanılama görevi/inspector ve yerel test PostgreSQL kapatıldı.
Kaynak kontrol noktası `release/office-0.1.85`; kanıtlar `.local/final-code-release-20261028/` altında.

Önceki doğrulanan ofis yayını: **0.1.84**, 2026-10-28T13:59:24.390Z; Windows x64,
113.001.229 bayt, SHA-256 `aadd2c543291d12b882abd6f7cdd86782fb906aa8e5a8f07b2206f0b336cac3d`.
01AEM674'ün 47 eski yolu sınıflandırıldı: 42 dosyada pCloud kimliği, olay geçmişi ve eski revizyonun
SHA-256'sı DB ile eşleşti; ad ve içerik revizyonları değişmiş. Beş eski dosya silinmiş; mevcut oturum
sahipleri olmadığı için asıl hesabın çöp kutusu doğrulanamadı. Erişilebilir çöp kutusunda ve 41 ZIP'in
40.911 girdisinde doğrulanmış kopya bulunmadı; kalıcı kayıp veya kurtarma iddia edilmez.
Evrak takibi artık tamamlanmış fiziksel taşıma zincirini izler: hash öncesi yanlış kayıp işaretleme,
iki taşımada ikinci belge kaydı ve aynı içerikte inceleme kimliğinin kaybı önlenir. Vaka-klasör bağları değişmedi.
57/57 hedefli test, typecheck, lint, build, NSIS ve paket açılışı geçti; kapsamlı testler tekrarlanmadı.
Gerçek DB yedeği ayrı ortamda geri yüklendi; gerçek dosya hash'leriyle dört vakada API okuma/senkronizasyon
doğrulandı. Canlıda normal tarayıcı sonrası 01AEM674/21FP610 için 67/5, iki eski kayıtta 54/70 belge HTTP 200
ile okundu; görünür yol çakışması yok. Ek üretim taraması, fiziksel taşıma/silme/birleştirme veya vaka eşleme yapılmadı.
Kurulu **0.1.83** güncellemeyi `available` gördü; kimlikli indirmede tam boyut/SHA-256 eşleşti.
Önceki manifest/paket korundu; beş servis sağlıklı, yeni işlem hatası yok. Zorla kurulum yapılmadı.
Kanıtlar ve 47 satırlık sonuç `.local/document-path-083-20261028/` altında.

Önceki doğrulanan ofis yayını: **0.1.83**, 2026-10-28T11:26:16.391Z; Windows x64,
113.000.974 bayt, SHA-256 `e313473593f0cdb66ddaa389fc7c81a9b81aec2e38ba1513e785f64061af3d0d`.
Uzaktan/ofis arasında taşınmış eski workspace'ler tekil vaka, kayıtlı içerik ve gerektiğinde
değişmez pCloud dosya kimliği/revizyonu ile aynı kayda bağlanır; attestation SHA-256 yan kanıtı
doğrulanır. Klasör bildirimleri taramayı tetikler, ikinci tutarlı gözlem 1 saniye sonra yapılır;
sürekli eksik envanter normal tarama aralığına döner. Yeni istemcide açık liste/pano 5 saniyede yenilenir.
3.466 benzersiz test geçti; altı dış canlı API ve Windows'ta desteklenmeyen bir WebKit testi atlandı.
Typecheck, lint, build, gerçek NSIS Unicode hedefi ve x64 paket açılışı geçti; 75 UI dosyası/profil eşleşti.
Gerçek DB yedeği ayrı test DB'sinde geri yüklendi. Beş sunucu dosyası doğrulandı; beş servis sağlıklı,
yeni işlem hatası sıfır. 01AEM674 (2026/727) ve 21FP610 (2026/754) özgün UUID'leriyle görünür;
72 mevcut dosyanın hash'i ve 117 eski dosya takip kaydı korundu, mükerrer vaka oluşmadı.
01AEM674'ün önceki kaydındaki 47 dosya yolu mevcut klasörde bulunamadı; eski hash/geçmişleri korunuyor,
belge kurtarma veya bu dosyaların başka ad/konumda bulunmadığı iddia edilmedi.
Kurulu **0.1.82**, **0.1.83** sürümünü `available` gördü; aynı kimlikli istemcide iki plakanın araması
özgün kayıtları döndürdü. HTTP 200 indirmesinde tam boyut/SHA-256 eşleşti. Önceki 0.1.82 manifesti
ve değişmez kurulumu korundu; zorla kurulum yapılmadı. Temiz VM yükseltmesi bu sürümde tekrarlanmadı.
Kanıtlar `.local/remote-return-20261028/` altında; tanılama görevi ve inspector kapatıldı.

Önceki doğrulanan ofis yayını: **0.1.82**, 2026-10-28T06:15:20.155Z; Windows x64,
113.000.911 bayt, SHA-256 `dcaed5727d945006de3306b9976f52dc6af1782f67e3006b2c72d3499eef6b03`.
Yeni klasörde değişmez workspace UUID'si, mevcut vakaya kanıtlı pCloud kimliği bağlama,
sahipsiz mevcut dizini sahiplenmeme ve aynı plakalı belirsiz kaynağı incelemeye ayırma eklendi.
Konum/oluşturma/taşıma rezervasyonları ortak normalleştirilmiş ad korumasıyla seri hale gelir;
çakışma güvenli 409/erteleme döndürür. Geniş koşular ve son hedefli tekrarlar birlikte
3.473 benzersiz PASS verdi; altı canlı API ve Windows'ta desteklenmeyen bir WebKit testi atlandı.
Typecheck, lint, build, gerçek NSIS Unicode hedefi, paket açılışı ve 75 UI dosyası/profil eşleşmesi geçti.
Gerçek PostgreSQL yedek/geri yükleme, bağımsız klasör kopyası/hash, tekrar uygulama ve geri alma sınandı;
manuel klasörün gerçek tarayıcıyla aynı vakaya bağlanması ve yeniden adlandırılması doğrulandı.
67 sunucu dosyası doğrulandı; değişen 50 dosya yedeklenerek dağıtıldı. `0074_folder_path_ownership`
yalnız ileriye dönük şema korumasıdır; migration sırasında ilgili iş tablolarının içerik özetleri değişmedi.
Beş servis sağlıklı, yeni işlem hatası sıfır. Kurulu **0.1.81**, **0.1.82** sürümünü `available` gördü;
kimlikli HTTP 200 indirmesinde tam boyut/SHA-256 eşleşti. Önceki 0.1.81 manifesti ve 0.1.81/0.1.80/0.1.79
değişmez paketleri korundu; zorla kurulum yapılmadı, tanılama görevi/inspector kapatıldı.
Temiz VM yükseltme/kaldırma kabulü bu sürüm için tekrarlanmadı. Kanıtlar `.local/folder-identity-20261028/` altında.

**Veri onayı bekliyor:** 650–640 çiftinde SBM/föy/resmî numara ve 54 güncel dosya hash'i 640'ı;
725–723 çiftinde resmî hasar PDF'i ve 49 güncel dosya hash'i 723'ü destekler. İkinci çiftin SBM görselinin
OCR numaraları DB ile birebir örtüşmedi; özgün belge kontrolü olmadan iş kimliği eşitliği kesinleştirilmedi.
Son salt okunur kontrolde dört eşleme, iki pCloud kimliği ve 103 dosyanın SHA-256'sı korundu.
İki çift için aynı/ayrı hasar kararı, resmî kanıt referansları, yetkili kayıt/klasör ve taze plan özeti
operatörce onaylanmalıdır. `deploy/windows-service/repair-folder-identity.mjs` bakım aracı hazırdır;
üretimde apply/rollback çalıştırılmadı. Mevcut `identity-review.json` yürütülemez ve onaysızdır.

28 Ekim 2026 ek veri bakımı: kullanıcı onayıyla 72AAB878 / 2026/781 mevcut pCloud
kimliği `27325142235` ile bağlandı; otomatik tarayıcı Ekim konumunu doğrulayıp görünürlüğü
geri getirdi. Gerçek DB yedek/geri yükleme, ayrı test DB'sinde sonraki konum takibi,
70 fiziksel dosyanın değişmediği ve kurulu 0.1.82 istemcisinin kimlikli aramasında
tek kayıt döndüğü doğrulandı. Kaynak kod/sürüm değişmedi; yeni paket yayını gerekmedi.
Çakışma raporunun güncel salt okunur kontrolünde 34SH935 klasörü `2026 UZAKTAN` altında,
53 dosyalı ve yeni föyde 2026/725 numaralı bulundu; önceki 723 önerisi kesin değildir.
Kullanıcı 34SH935'in uzaktan dosyası olarak mevcut konumunda ve ofis listesi dışında
kalacağını doğruladı; bu iki kayda müdahale edilmedi. Sonraki açık onayla **640 asıl kayıt**
seçildi; pCloud `27180552212` bağı 650'den 640'a düzeltildi. İki iş kaydı ve tüm geçmiş,
640'ın 4 notu, 650'nin 4 belge incelemesi ve 54 fiziksel dosya korundu; taşıma/silme yok.
Gerçek DB geri yükleme, ayrı test DB'sinde uygulama/tekrar/geri alma ve otomatik tarayıcı
kontrolü geçti. Kurulu 0.1.82'nin kimlikli aramalarında 640 ve 72AAB878 görünür;
650 ve 34SH935 görünmüyor. Beş servis sağlıklı; kaynak kod/sürüm değişmedi.
Yerel karşılaştırma: `.local/folder-identity-20261028/operator-comparison-report.md`.

Önceki doğrulanan ofis yayını: **0.1.81**, 2026-10-28T00:48:56.221Z; Windows x64,
113.001.074 bayt, SHA-256 `f6fbf1bf7e75d48513019686078b7dc7a595e46c2a9a1f482ecef1c55fc4e272`.
0.1.80 sonrası bekleyen üç AI yanıt okuyucusu, PDF/OCR timeout/iptal kuyruğu,
PDF/Tesseract temizliği ve iş başına süreç yönetimi düzeltmeleri dahil edildi.
Codec/native notice ve yan kanıtları File Agent paketinde korundu; imzalama ve
tanılama araçları kaynakta yer alır. 109 API, 48 File Agent, 91 masaüstü/Windows
ve 23 araç/paket testi geçti; başlangıçta atlanan Unicode NSIS testi ayrıca çalıştırıldı.
Typecheck, lint, build ve x64 paket smoke geçti; 75 UI dosyası/profil eşleşti.
Gerçek Electron/Chromium oturum kalıcılığı ve güvenlik kontrolleri, temiz Windows
VM'de gerçek NSIS 0.1.80 → 0.1.81 yükseltmesi, açılış, kaldırma/geri dönüş ve
sentetik profil işaretinin korunması doğrulandı. Gerçek kullanıcı hesabının NSIS
yükseltmesi test edilmiş olarak sunulmadı. Sunucuda 30 dosya doğrulandı, değişen
20 dosya yedeklenerek dağıtıldı; migration/veri müdahalesi yok, beş servis sağlıklı,
yeni operasyon hatası sıfır. Kurulu **0.1.80**, **0.1.81** sürümünü `available`
gördü; kimlikli HTTP 200 indirmesinde tam boyut/SHA-256 eşleşti. Önceki 0.1.80
manifesti ve 0.1.80/0.1.79 değişmez paketleri korundu; zorla kurulum yapılmadı.
Uzun koşu kullanıcı isteğiyle 7,77 saatte `INTERRUPTED` olarak kapandı; 64.586 iş,
1.017.221 sayfa ve 323.814 bütünlük kontrolü kaydedildi. Ofis kabulü için mevcut
başarılı kontroller kullanıldı; 48 saat tamamlanmış veya sızıntı yokluğu kanıtlanmış
sayılmadı. Ticari dağıtım yapılmadı. Kanıtlar `.local/office-0.1.81-20261028/`
altında; tanılama görevi/inspector kapatıldı, test VM'si temiz snapshot'a ve yerel
test PostgreSQL kümesi başlangıçtaki kapalı durumuna döndürüldü.

Önceki doğrulanan ofis yayını: **0.1.80**, 2026-10-27T11:35:26.446Z; Windows x64,
113.000.938 bayt, SHA-256 `2652b3d54dde10ca2c69b9f851938cf4809612cb7325c2b0853e4887b15f41e1`.
0.1.79 temelindeki bağımsız denetimde 19 ürün kusuru düzeltildi: kapalı dosya
yetkileri, ofis tarihiyle numaralandırma, arşiv filtreleri, servis iletişimlerinin
arama/pano/raporlara aktarımı, elle girilen servisin kapanış şartları, güncel belge
kanıtlarının kapanış sırasında tekrar denetlenmesi ve Kasko onayının kapanışla yarışı;
form kimliği değişiminde eski iletişimler, araç türü değişiminde gözlem kaybı,
eksik sahip adının sessiz atılması, kayıt sürerken düzenleme ve hızlı kayıt hatası;
geçerli klasör adı sınırı, fotoğraf kuyruğunun diğer işleri engellemesi, sonuçsuz
OCR/PDF worker çıkışı, eksik file-agent/frontend lisans bildirimleri ve başarısız
güncelleme indirmesinde akış kaynaklarının bırakılması. İlgili regresyonlar eklendi.
Tam kapıda 3.391 test ve ayrıca altı gerçek HTTP/PostgreSQL adaptör testi geçti;
yalnız Windows WebKit çapraz site SameSite kontrolü atlandı. Typecheck, lint,
build, dağıtım kontrolleri ve bağımlılık güvenlik taraması geçti (bildirilen açık: 0).
Gerçek NSIS kurulum, 0.1.79 → 0.1.80 yükseltme, kaldırma ve 0.1.79'a geri dönüşte
oturum/tema/bağlantı korundu; yerel önceki kurulum ve kullanıcı profilleri geri
doğrulandı. Görünür son testler ikinci ekranda yapıldı; iki ekran arasında taşıma
senaryoları bu son koşuda çalıştırılmadı. Chromium/Firefox/WebKit fotoğraf akışında
108 kontrol, 5/10 tarayıcı oturumu ve dosya hash kontrolleri geçti. Yerel API/DB
son API/ortak kaynaklarla 20/50 oturum yükünde 26.606 istek, sıfır 500/zaman aşımı,
p95 56 ms; kapanışta açık bağlantı sıfır. Altı dakikalık
ölçüm uzun süreli kararlılık kanıtı değildir. Yedek/geri yüklemede 134 tablo ve
13.657 satır ile şema nesneleri eşleşti. Kurulu **0.1.79**, **0.1.80** sürümünü
`available` gördü; kimlikli HTTP 200 indirmesinde tam boyut ve SHA-256 eşleşti.
Önceki 0.1.79 manifesti/paketi korundu; backend'de 46 dosya doğrulandı, değişen
29 dosya yedeklendi. Migration/veri müdahalesi yok; beş servis sağlıklı, yeni işlem
hatası yok. Tanılama görevi/inspector kapatıldı; zorla kurulum yapılmadı.
**Satış öncesi durum: PARTIAL.** İki mevcut üretim klasörü kimlik çakışması
(2026/650–640 ve 2026/725–723) güvenli biçimde engelleniyor; iş kimliği doğrulanmadan
birleştirilmedi. Müşteriye özel dağıtım kabulü, canlı dış servis kesinti senaryoları,
çok günlük ağır OCR/yük ve codec kaynaklarının eksiksiz dağıtım uyumu doğrulanmadı;
Authenticode imzası yok. Mochi, kullanıcının yazılı ticari izin beyanıyla korundu.
Kanıtlar yerel `.local/presale-audit-20261026/` altında saklandı.

**2026-10-27 satış engelleri ek kontrolü — yeni yayın yapılmadı.** AI yanıt
okuyucularının hata/başarı sonunda kilit bırakmaması ve OCR/PDF zaman aşımından
sonra sıradaki yüklemelerin başlaması düzeltildi. Libde265 1.0.15 LGPL3+ bildirimi
ve kesin kaynak/build bağlantıları eklendi; gerçek `npm pack` içeriği doğrulandı.
62 hedefli test geçti (34 kesinti/toparlanma, 24 extractor, iki kimlik çakışması,
iki lisans/paket testi); API/File Agent build ve typecheck, değişen dosyalarda
lint geçti. Yeni testler yayın kapısına alındı; ortak test şemasını sıfırlayan
Node test dosyaları sırayla çalışır. Tam eski denetim yeniden çalıştırılmadı.

İki üretim çakışmasında kayıtlı pCloud kimliği aktif eş kaydın konumunda, eski
konum ise yok. Kayıtlarda not ve belge inceleme geçmişi bulunduğundan
silme/birleştirme/eşleme yapılmadı; resmî hasar kimliği ve korunacak kayıt için
operatör onayı gerekiyor. Salt okunur PostgreSQL işlemi ve pCloud metadata
snapshot kullanıldı; müşteri belge içerikleri okunmadı, üretim kaydı değiştirilmedi.

Müşteriye ait temiz Windows makinesi/profili sağlanmadı; mevcut paket özel ofis
profiliyle eşleşiyor. Önceki yerel kurulum kanıtı müşteri kabulü sayılmadı.
Yerel HTTP/Gmail/PostgreSQL/pCloud kesinti ve mükerrer etki testleri geçti;
gerçek müşteri sandbox/WAN kabulü açık. 364 saniyelik gerçek PDF/Tesseract
yükünde 492 iş, 7.732 sayfa ve 11 beklenen arıza/toparlanma doğrulandı;
sonda MessagePort/geçici dosya kalıntısı sıfır, handle sayısı 224 kaldı.
GC sonrası RSS tabanı 128→139 MiB arttı; boş Worker/native karşılaştırmalarında
da başlangıç artışı görüldü. Çok günlük kabul veya sızıntı yokluğu kanıtlanmadı.

Codec kaynak/relink dağıtımı, native MPL kaynak bildirimleri/belirsiz SBOM
lisansları ve kullanıma özgü patent kapsamı açık; notice düzeltmesi tam uyum
onayı değildir ([FFmpeg](https://www.ffmpeg.org/legal.html),
[LGPL3](https://www.gnu.org/licenses/lgpl-3.0.html)). Kurulum ve uygulama
`NotSigned`; erişilebilir kullanılabilir kod imzalama sertifikası/uzak imzalayıcı
yok. Güvenilir imza ve timestamp doğrulaması yapılamadı. Mevcut 0.1.80 feed'i,
paket boyutu ve SHA-256 sunucuda korundu; sürüm artırılmadı, backend dağıtılmadı,
zorla kurulum veya tekrar tam indirme yapılmadı. **HENÜZ HAZIR DEĞİL.**
Ek kanıtlar: `.local/presale-audit-20261026/blockers-*.json`,
`external-resilience-result.json`, `ocr-pdf-soak-result.json` ve
`.local/presale-followup-20261027/codecs-signing-result.json`.

**2026-10-27 kalan işler — kaynaklar korundu, sürüm 0.1.80.** Üç önceki
kaynak düzeltmesi izole HEAD kopyalarında 16 başarısız regresyonla yeniden
üretildi; güncel kaynakta 39 ilgili ve 17 komşu test geçti. Yeni araçlar ve
notice/paket testleri 10/10 geçti. API/File Agent typecheck, API/File Agent/desktop
build ve değişen TypeScript dosyalarında lint geçti. Tam sistem denetimi,
tam yayın kapısı ve yeni NSIS kabulü tekrarlanmadı; yeni ofis yayını yapılmadı.

- Klasör planı: `node scripts/plan-folder-identity-repair.mjs <salt-okunur-kanit.json> <yeni-plan.json>`.
  İki çakışma için yerel `folder-identity-dry-run.json` üretildi. Araç DB/cloud
  istemcisi ve apply modu içermez; iki vaka kimliği, notlar, belge sürümleri,
  audit ve fiziksel dosyalar korunur. Plan, snapshot ve kendi SHA-256'sını taşır.
  Operatör her iki vakanın resmî hasar numarası/sigortacısı/olay tarihini ve
  kanıt referanslarını doğrulamalı; ayrı hasar/aynı hasar/belirsiz kararını ve
  yetkili klasör sahibini seçmelidir. Onay alınmış değildir. Uygulamadan önce
  yeni salt okunur kanıt, sürüm/kimlik kontrolü, doğrulanmış geri yükleme yedeği,
  dar bakım penceresi ve ayrıca incelenmiş atomik/auditli uygulama gerekir.
  Dolu hedefi mevcut relocation akışıyla zorlamak veya kayıt silmek çözüm değildir.
- Temiz Windows: `powershell -NoProfile -File scripts/check-clean-windows-acceptance.ps1 -CustomerProfile <ozel-profil>`.
  VirtualBox mevcut; tek kayıtlı VM'nin yapılandırma dosyası/dizini yok,
  `showvminfo` erişim hatası veriyor; çalışan VM ve kullanılabilir Hyper-V yok.
  Temiz lisanslı Windows VM/snapshot, müşteri sandbox profili ve sentetik hesap
  gerekiyor. VM kabulü bile gerçek müşteri onayından ayrıca raporlanmalıdır.
- Yük testi: Node 24.x ile önce `npm run build --workspace @hasarbotu/file-agent`, sonra
  `node --expose-gc scripts/ocr-pdf-soak.mjs --duration-ms=172800000 --concurrency=2 --output=<yeni-sonuc.json>`.
  48 saatlik koşu **çalıştırılmadı**. Tekrarlanabilir araç 1–8 eşzamanlı akış,
  çıktı/hash/sayfa bütünlüğü, 11 hata/toparlanma, geçici dosya/MessagePort ve
  Windows handle/private bytes ölçer; 4 GiB tepe RSS, 128 MiB ısınma sonrası
  RSS artışı ve 64 handle artışı sınırını aşarsa başarısız olur.
  `--max-rss-mib` / `--max-growth-mib` ile açık kabul bütçesi seçilebilir;
  kesinti PASS sayılmaz, kontrol noktaları JSON'a yazılır. API iş kuyruğu/WAN
  veya müşteri kabulünü kapsamaz. Yeni kısa çift akış koşusu 123 sn, 316 iş,
  4.960 sayfa ve 11 hata/toparlanma içerdi; handle 221, temp/MessagePort kalıntısı
  sıfır. RSS 145→249 MiB; çok günlük kararlılık/sızıntı yokluğu kanıtlanmadı.
  `node --expose-gc scripts/worker-memory-probe.mjs <plain|native|pdf> 1200 <yeni-sonuc.json>`
  karşılaştırmalarında ayrı süreçlerde RSS sırasıyla yaklaşık 49→66, 49→92,
  49→123 MiB oldu; ana heap yaklaşık 6–8 MiB, external büyük ölçüde sabit kaldı.
  Boş Worker'da da artış bulunması Worker yaşam döngüsü/native allocator
  katkısını gösterir; fragmentation/retained native allocation ile gerçek native
  sızıntı kesin ayrıştırılmadı. Üretime worker havuzu/restart yaması eklenmedi.
- Codec kanıtları: `node scripts/review-codec-evidence.mjs <yeni-rapor.json>`.
  `codec-dependency-review.json`, dokuz npm bağımlılığını ve gerçek FFmpeg/native
  binary/notice/SBOM hashlerini, libheif/libde265 kaynak zincirini, AVIF/AOM,
  JPEG-turbo/PNG/WebP/Zlib ve dört MPL bileşenini ayrı listeler. Dokuz SBOM
  kaydında lisans metadatası yok (build-only kapsamı da ayrıştırılmalı).
  Tam karşılık gelen kaynak/build/relink teslimi, MPL kaynak erişim bildirimi,
  müşteri paketinde notice kanıtı ve kullanım/ülke bazlı codec patent değerlendirmesi
  açık. Paket MIT etiketi, eksiksiz ticari dağıtım kanıtı sayılmadı.
- İmzalama: `powershell -NoProfile -File scripts/check-desktop-signing.ps1`.
  SDK SignTool bulundu; kullanılabilir kod imzalama sertifikası sıfır.
  `HASARBOTU_SIGNING_CERT_SHA1`, sertifikanın tam Subject değeri olan
  `HASARBOTU_SIGNING_PUBLISHER` ve HTTPS RFC3161 adresi
  `HASARBOTU_SIGNING_TIMESTAMP_URL` sağlandıktan sonra
  `npm run package:win:signed --workspace @hasarbotu/desktop` kullanılabilir.
  Araç CurrentUser sertifikası/özel anahtar, güven zinciri ve online revocation
  denetiminden sonra SHA-256 zorunlu imzalamayı seçer; timestamp kapatan ayarları
  reddeder. Son uygulama ve NSIS, Authenticode/SignTool ve timestamp ile doğrulanır
  ([Microsoft SignTool](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool)).
  Aday `release/signed` altındadır; mevcut adayın üstüne yazılmaz, yayınlanmaz.
  Sertifika oluşturulmadı, trust store değiştirilmedi; gerçek imzalama henüz
  yapılmadı. Standart ofis paketleme komutu değiştirilmedi.

Bu ek çalışmanın kanıtları `.local/presale-followup-20261027/` altındadır.
Üretim kayıtları ve ticari dağıtım kanalı değiştirilmedi. Tam yayın kapısı ve
paket/kurulu eski istemci doğrulaması olmadan sürüm artırılıp feed değiştirilmedi.

**2026-10-27 son teknik takip — yayın yapılmadı.** Dokuz eksik SBOM alanı
incelendi: anstyle, clap, clap_builder, clap_lex, cxxbridge-cmd ve strsim için
gerçek crates.io kaynak arşivleri, lisans metinleri ve yayımlanan SBOM SHA-256
değerleri eşleşti. İlk beşi MIT/Apache-2.0 seçenekli, strsim MIT. Yerel canvas
kök MIT lisansıyla; skia-fontations gerçek Skia BSD kaynağı ve macOS/Linux hedef
koşuluyla eşleştirildi. Birleşik native dosyaya tek başına MIT atanmadı.
Üst akış SBOM'u değiştirilmedi; `services/file-agent/codec-license-evidence.json`
yan kanıtı ve ek lisans metinleri gerçek `npm pack` içinde doğrulandı.
Yeniden üretim: `node scripts/complete-native-license-evidence.mjs <kaynak-dizini> <yeni-json>`.

22 kaynak/build arşivi (12 crate için mevcut SBOM checksum doğrulaması),
FFmpeg `2b68d2babae73714846961fb0ee47e3b3d2e39a9`, libheif/libde265,
Emscripten 3.1.61, Electron ve native canvas/Skia kaynakları toplandı.
Kaynak adayı `.local/presale-tech-20261027/codec-source-delivery-final.zip`
188.977.878 bayt; SHA-256
`54cef62ec73a85c0ff0f4954ab0c037b55b45a0ef32a81f3204b1f3a6b56a6a3`.
ZIP CRC ve notice/manifest hashleri eşleşti. Değişmeyen uygulama modülüne ayrı,
üst akış JS/WASM paketi yerleştirilince sentetik HEIC aynı 640×480/102.400 bayt
JPEG'i üretti; WASM yayımlanan paketle birebir eşleşti. Bu, kütüphane değiştirme
kanıtıdır; C kaynaklarından derleme veya tam relink/uygunluk kanıtı değildir.
FFmpeg/native DLL yeniden üretimi, eksiksiz toolchain/bağımlı kaynak kapanışı,
alıcıya kaynak teslimi ve patent/hukuk değerlendirmesi açık tutuldu.

RSS için dört ayrı süreçte 5.000'er iş ölçüldü: boş Worker, yeni canvas Worker,
tek canvas Worker'ın yeniden kullanımı ve yalnız deney sürecinde purge-delay=0.
Yeniden kullanılan Worker'da ısınma sonrası private commit yaklaşık 87–100 MiB
aralığında kaldı; kapanış/boşta beklemede 67 MiB'ye indi. Yeni Worker kontrolü
188 MiB, purge kontrolü 154 MiB'de kaldı. Yalnız deney sürecinin working set'i
boşaltılınca RSS yaklaşık 3 MiB'ye indi, commit aynı kaldı: resident sayfa ve
allocator tutulması gerçek deallocation ile karıştırılmadı. mimalloc çıkış
istatistiği 32,1 MiB güncel commit/tek arena gösterdi. Kalan native/V8/Windows
artışının tamamen sınırlı tutulma mı gerçek sızıntı mı olduğu kesinleşmedi.
Üretim allocator/Worker mimarisi veya sistem bellek ayarları değiştirilmedi.

48 saatlik koşu **başlatıldı ve FAIL ile durdu**: 232 saniyede 618 iş/9.725 sayfa
sonrasında mevcut 128 MiB ısınma sonrası RSS artışı sınırı aşıldı. Bütçe artırılmadı,
48 saat tamamlanmış veya sızıntısız sayılmadı. Kaynak drift'i yok; son örnekte
MessagePort/temp kalıntısı sıfır. PID, loglar, hashler ve terminal durum
`.local/presale-tech-20261027/soak-48h/` altında; bu koşu artık çalışmıyor.
`scripts/soak-supervisor.mjs` yeni `.local` çalışma dizininde süre, süreç çıkışı ve
kaynak hashlerini birlikte kaydeder. RSS ayrıntıları aynı kanıt dizinindeki
`rss-cause-analysis.json` içindedir. 29 extractor/fotoğraf ve 32 sağlayıcı testi,
12 araç/lisans testi geçti; API/File Agent typecheck geçti. Tam denetim ve yayın
kapısı yeniden çalıştırılmadı. Resmî hasar kimliği/onayı ve sertifika engelleri sürer.

Temiz VM oluşturuldu: VirtualBox `HasarBotu-Presale-20261027`, Windows 11
Enterprise Evaluation 26H2 (26300.9457), Microsoft ISO SHA-256 doğrulaması,
EFI Secure Boot ve TPM 2.0; 6 GiB RAM/4 CPU/ayrı dinamik disk. Ağ, pano ve
sürükle-bırak kapalı. `clean-windows-installed` snapshot'ından temiz per-user
x64 0.1.80 kurulumu, yükseltilmemiş token ile 12 saniyelik çevrimdışı açılış
(`Sunucu denetimi` penceresi) ve sentetik profil işaretini koruyan kaldırma geçti.
NSIS kurulum/kaldırma çıkışları 0; Windows sürüm kaynağı `0.1.80.0`.
Hesap administrators grubundadır; işlem token'ı yükseltilmemiştir. Ayrı standart
hesap, müşteri oturumu/profili, WAN, imzalı yükseltme veya gerçek müşteri kabulü
test edilmiş sayılmadı. Paket `NotSigned`; güven zinciri, execution policy veya
Windows güvenlik kontrolleri gevşetilmedi. Kanıt:
`.local/presale-tech-20261027/windows-vm/final-results/vm-install-result.json`.
Kanıt alındıktan sonra temiz snapshot geri yüklendi ve VM kapalı bırakıldı;
son durum `windows-vm/vm-final-receipt.json` içinde kayıtlıdır. Ofis feed'i ve
masaüstü sürümü **0.1.80** kaldı; backend/veri müdahalesi ve ticari yayın yapılmadı.

**2026-10-27 OCR/PDF bellek düzeltmesi — uzun kabul RUNNING.** İki yaşam döngüsü
kusuru doğrulandı: terminal mesajı PDF/Tesseract temizliğinden önce gönderiliyor,
Tesseract 7.0.0 facade `terminate()` metodu iç Node Worker'ın çıkış promise'ini
beklemiyordu. Terminal artık temizlikten ve gerçek iç Worker çıkışından sonra
gönderilir; PDF task hata yollarında da kapatılır, sayfa/canvas kaynakları bırakılır.
Altı yeni regresyon eski Worker kaynaklarında 6/6 başarısız, düzeltmede 6/6 geçti.

Bu düzeltme tek başına yeterli olmadı: fazı eşleştirilmiş iki kısa thread koşusu
de FAIL kaldı (loaded RSS 156,7→287,3 ve 151,1→293,4 MiB). Ana heap yaklaşık
8–10 MiB, Tesseract WASM kapasitesi iş/isolate başına sabit 133,125 MiB;
mimalloc çıkış commit'i yaklaşık 32 MiB idi. Tam native allocator iç kusuru veya
sızıntı yokluğu kanıtlanmadı; tekrarlanan isolate ömürleri sonrası süreçte tutulan
bellek gözlendi. Worker thread'lerinin RSS'i aynı PID'ye aittir; thread RSS'leri
toplanmadı ([Node.js](https://nodejs.org/docs/latest-v24.x/api/process.html#processmemoryusage)).

PDF/OCR artık iş başına ayrı Node sürecinde mevcut Worker ve aynı V8 kaynak
sınırlarıyla çalışır. Sonuç/timeout/hook hatası sonrasında child `close` beklenir;
geçici dosyalar bundan sonra silinir. Parent IPC bağlantısı kaybolursa yalnız
o işin child süreci kapanır; yeniden deneme veya periyodik servis restart'ı eklenmedi.
Native/WASM kaynaklarının ömrü OS süreç sınırına bağlandı. Yeni süreç başlatma
maliyeti vardır; mimari OS/PDF güvenlik sandbox'ı olarak sunulmaz.

RSS 128 MiB artış ve 4 GiB tepe sınırları artırılmadı. Tek seri iş yerine sabit
bir tam eşzamanlı warm batch kullanılır; loaded→loaded ve idle→idle karşılaştırılır.
Idle private commit için ayrıca aynı 128 MiB sınırı uygulanır. 4 GiB kontrolü
parent + eşzamanlı child OS RSS tepe değerlerinin muhafazakâr toplamını içerir;
sadece düşük parent RSS'ine bakarak geçilmesini engelleyen negatif test geçti.

Yeni iki kısa koşu geçti: 376,6 sn / 610 iş / 9.599 sayfa ve 376,9 sn / 778 iş /
12.245 sayfa; her koşuda 11 beklenen hata/toparlanma doğrulandı. Parent RSS
loaded warm→son: 80,3→105,4 ve 87,1→115,8 MiB; idle private commit artışları
26,1/30,5 MiB. Süreç ağacı muhafazakâr RSS tepeleri 892,9/892,2 MiB; sınır 4 GiB.
İş sonlarında sahiplenilmiş child ve MessagePort/temp kalıntısı sıfır; handle217
sabit. 37 extractor/lifecycle/process ve 6 bellek aracı testi geçti; File Agent
build/typecheck ve ilgili ESLint geçti. Eski FAIL kayıtları korundu.

48 saatlik **sürekli** yük 2026-10-27T16:49:17.451Z'de tekrar başlatıldı;
beklenen bitiş 2026-10-29T16:49:17.451Z. Henüz PASS değildir.
Kanıtlar `.local/ocr-memory-20261027/`, canlı durum ve loglar
`soak-48h-process/receipt.json`, `result.json`, `stdout.log`, `stderr.log` altında.
Runtime, eşik yardımcıları, native binary ve WASM hashleri supervisor tarafından
korunur. Üretim verisi/backend servisi değiştirilmedi; sürüm 0.1.80, yayın yok.

Önceki doğrulanan ofis yayını: **0.1.79**, 2026-10-26T15:19:07.321Z; Windows x64,
112.999.103 bayt, SHA-256 `cf98ad6587a5ab4d6f9bfa4443ba7623666981a768d2f217cc325d7ba506ded5`.
SBM servis adı silinip yeniden yazılırken telefon ve adres korunur; farklı kayıtlı
servis seçildiğinde yalnız onun doğrulanmış iletişim bilgileri kullanılır.
Her iki kayıt seçeneği, yeniden açma, elle düzeltme, revizyon iptali ve iletişimsiz
yeni servise geçiş gerçek Electron → API → PostgreSQL zincirinde doğrulandı.
Touch animasyonları, geçişleri ve toparlanma dizileri bitene kadar imleci izlemez;
61 sahnede 366 gerçek Canvas karesi imleçten bağımsız çizildi. Son imleç konumu
animasyon tamamen bitince yeniden izlenir; canlı IPC ve yumuşak geçiş kontrolü geçti.
3.359 sürüm testi ve 111 hedefli kontrol geçti; altı HTTP/veritabanı ve dört NSIS
kontrolü de geçti. Yalnız Windows WebKit çapraz site SameSite kontrolü atlandı.
Typecheck, lint, build, gerçek x64 kurulum açılışı, 74 UI ve yedi main/preload
dosyasının eşleşmesi doğrulandı. Kurulu **0.1.78**, **0.1.79** sürümünü
`available` gördü; kimlikli HTTP 200 indirmesinde tam boyut ve SHA-256 eşleşti.
Önceki 0.1.78 manifesti ve değişmez kurulum korundu; beş ofis servisi sağlıklı.
Tanılama görevi ve inspector kapatıldı; çalışan istemcilere zorla kurulum yapılmadı.

Önceki doğrulanan ofis yayını: **0.1.78**, 2026-10-26T03:59:36.053Z; Windows x64,
112.998.504 bayt, SHA-256 `68a530a2701851b77615c538d0b7947d28af6895f6daa1a657955bd9bbf07958`.
61 yeni tepki, yoğunluğa göre sabır/ruh hâli, ağırlıklı ve tekrarı önleyen seçim
ile elle oynatma, sakinleştirme, duraklatma ve uyku kontrolleri eklendi. Uzayan
tıklama serileri tek bir küsme hareketine takılmaz. Eski baş dönmesi yıldızları,
yeni gövde dönüşlerinden bağımsız çizilerek pencere kenarında kırpılma giderildi.
3.352 sürüm testi ve son değişiklikleri kapsayan 70 hedef test geçti; altı canlı
HTTP kontrolü ve dört NSIS kontrolü tamamlandı. Yalnız Windows WebKit çapraz site
SameSite kontrolü atlandı. Gerçek Windows/Electron'da 28 kontrol, 61 animasyonda
1.536 kare ve paketli 499 kaplama/göz kontrolü geçti. Canvas çizim çıktıları görsel
olarak incelendi. Typecheck, lint, build ve x64 NSIS açılış smoke geçti; 74 UI ile
yedi main/preload dosyası doğrulandı. Kurulu **0.1.75**, **0.1.78** sürümünü
`available` gördü; kimlikli HTTP 200 indirmesinde tam boyut/SHA-256 eşleşti.
Önceki 0.1.77 manifesti ve değişmez kurulum korundu; beş ofis servisi sağlıklı,
tanılama görevi/inspector kapalı. Zorla kurulum yapılmadı.

Önceki doğrulanan ofis yayını: **0.1.77**, 2026-10-25T20:11:55.964Z; Windows x64,
112.985.677 bayt, SHA-256 `c50509bf7e707b6481b60d1c9daf5c561a8c1b4bb696d6a52a93c4be0b816131`.
Kişisel Göz Rengi paleti önizlemeye ve gerçek Touch'a kaydetmeden önce yansır;
kayıt hesap bazındadır ve tam Electron yeniden başlatmasında korunur. Skinler,
ifadeler, hareket azaltma ve açık/koyu gövdelerde görünürlük doğrulandı.
3.335 sürüm testi, altı canlı HTTP kontrolü, 108 UI ve 571 paketli Canvas kontrolü
geçti; yalnız Windows WebKit çapraz site SameSite kontrolü atlandı. Windows odak
testinin pencere hazırlığı düzeltildi; 251 masaüstü testi geçti. Typecheck, lint,
build ve x64 NSIS açılış smoke geçti; 72 UI ve beş main/preload dosyası doğrulandı.
Üç API çalışma dosyası yedeklenerek güncellendi; migration yapılmadı. Kurulu
**0.1.75**, **0.1.77** sürümünü `available` gördü; kimlikli HTTP 200 indirmesinde
tam boyut/SHA-256 eşleşti. Önceki manifest ve değişmez kurulum korundu; beş ofis
servisi sağlıklı, tanılama görevi/inspector kapalı. Zorla kurulum yapılmadı.

Önceki doğrulanan ofis yayını: **0.1.76**, 2026-10-25T19:17:48.923Z; Windows x64,
112.985.624 bayt, SHA-256 `15741e9789d680db590f0b6185d7988ecb94768e4ccaaf63a96d77c47831b281`.
Yuvarlak logolar gövdenin içine küçük bir daire olarak sığdırılmak yerine özgün
yuvarlatılmış gövde yüzeyine otomatik oturur; beyaz yan boşluklar giderildi.
Fenerbahçe JPG ve iç içe arka planlı PNG gerçek ayarlar ekranından yüklenip
kaydedildi; kullanıcının açık talebiyle gerçek pencere/masaüstü görüntüleri ve
NSIS paketinden çıkarılan uygulama görsel olarak incelendi. Önizleme/Touch ekran
görüntülerinde piksel farkı sıfır; gözler, siluet, animasyonlar ve halo korundu.
102 UI kontrolü, 166 paketli Electron piksel kontrolü ve 3.328 sürüm testi geçti.
Yeniden başlatmada kesilen masaüstü grubu 249/249 geçti; önceki grupların tamamlanan
sonuçları korundu. Atlanan altı canlı API testi ve NSIS kontrolü ayrıca geçti;
yalnız Windows WebKit SameSite kontrolü atlandı. Typecheck, lint, build ve x64
kurulum smoke geçti; 72 UI ve dört main/preload dosyası doğrulandı.
Kurulu **0.1.75**, **0.1.76** sürümünü `available` gördü; kimlikli HTTP 200
indirmesinde tam boyut/SHA-256 eşleşti. Önceki manifest/değişmez kurulum korundu;
beş ofis servisi sağlıklı, tanılama görevleri/inspector kapalı. Zorla kurulum yapılmadı.

Önceki doğrulanan ofis yayını: **0.1.75**, 2026-10-25T16:19:26.398Z; Windows x64,
112.984.374 bayt, SHA-256 `5bb112d73a2fb74b04a3c0e23d1e7e1fcf59a75a0a5fec119761298bacf1b5b0`.
Touch kaplaması yüklemede ana figüre göre otomatik ortalanır; boş kenarlar,
uygun siyah/beyaz arka planlar, iç içe logo kutuları ve küçük dış lekeler ayrılır.
Figür oranı korunarak özgün yuvarlak gövdeye sığdırılır; opak fotoğraflar gövdeyi
doldurur. Yerleşim yalnız yüklemede hesaplanır; önizleme ve Touch kaydedilmiş
aynı kaplamayı kullanır. Manuel ölçek/konum, gözler, animasyonlar ve halo korunur.
Sağlanan iki görsel dahil 9 girdide gerçek yükleme, önizleme/Touch piksel eşitliği,
ince ayar ve yeniden yükleme geçti; paket varlıklarında 162 Electron piksel
kontrolü ve 12 görsel regresyonu geçti. Genel koşuda 3.305 test geçti; tam ekran
CS2'nin etkilediği iki pencere sıralaması testi başarısız kaldı. Kullanıcının
gerçek test tekrarını gereksiz bulan talebi doğrultusunda bu iki kontrol kod
incelemesiyle değerlendirildi; dört ilgili main/preload modülü ve animasyon
motoru doğrulanmış 0.1.74 paketiyle birebir aynı. Genel koşuda atlanan 6 canlı
adaptör ve NSIS kontrolü ayrı ayrı geçti; Windows WebKit SameSite atlandı.
18 yayın/keşif testi, 4 Windows kurulum testi, typecheck, lint, build ve kurulumdan
çıkarılan x64 uygulamanın açılışı geçti; 72 UI ve dört main/preload dosyası eşleşti.
Kurulu **0.1.74**, **0.1.75** sürümünü `available` gördü; kimlikli HTTP 200
indirmesinde boyut ve SHA-256 eşleşti. Önceki manifest/değişmez kurulum korundu;
beş ofis servisi sağlıklı, tanılama görevleri/inspector kapalı. Zorla kurulum yapılmadı.

Önceki doğrulanan ofis yayını: **0.1.74**, 2026-10-25T15:20:56.608Z; Windows x64,
112.982.492 bayt, SHA-256 `43f220f109d155ebf04b1be4c784cba4c096c9c3d072e8aee2d308c0a0a0ec83`.
Touch kaplaması özgün animasyon motorunun gövde yoluna uygulanır; siluet, gözler,
yüz ifadeleri ve hareketler korunur. Siyah dış arka plan ayrılırken logonun iç
siyah detayları korunur; vurgu yalnız arkadaki yumuşak halodur. Aynı motorla
120×120 önizleme, ölçek/yatay/dikey konum ayarı ve kalıcı kaydetme sağlanır.
Sağlanan iki görsel dahil beş girdide 160 gerçek Electron piksel kontrolü;
açık/koyu zemin, saydam kenarlar, kaplamalı hareketler, PNG/JPG/WebP yükleme,
konumlandırma, yeniden yükleme ve varsayılana dönüş geçti. 3.319 genel test ve
ayrı altı canlı adaptör kontrolü geçti; tam ekran uygulamanın etkilediği üç
yerel Electron kontrolü, normal ön plan koşulunda birlikte yeniden geçti.
Windows WebKit SameSite kontrolü platform kısıtıyla atlandı. Typecheck, lint,
build, x64 NSIS ve kurulumdan çıkarılan gerçek uygulamanın açılışı geçti;
72 UI ve dört main/preload dosyası doğrulandı. Kurulu **0.1.73**, **0.1.74**
sürümünü `available` gördü; kimlikli HTTP 200 indirmesinde boyut ve SHA-256
eşleşti. Önceki manifest/değişmez kurulum korundu; beş ofis servisi sağlıklı.
Tanılama görevleri/inspector ve doğrulama için açılan istemci kapatıldı;
zorla kurulum yapılmadı.

Önceki doğrulanan ofis yayını: **0.1.73**, 2026-10-25T14:15:41.314Z; Windows x64,
112.967.079 bayt, SHA-256 `079f1dd8f82adca7c32e9170bbbcd9179f147dc4215c93864c5a538f8fd3689b`.
Touch üstte kalma davranışı gerçek görev çubuğu, odak değişimleri ve iki fiziksel
monitörde doğrulandı; tam ekran ve güvenli masaüstü sınırları korunur. Vurgu rengi
gövde detayında görünür; kişisel PNG/JPG/WebP görselleri 2 MB kaynak sınırıyla
256 piksele dönüştürülür, önizlenir ve hesaba özel saklanır. Windows paylaşım
kilitlerinde kontrollü yeniden deneme ve uygulama bilgisi eklenir; kalıcı kilitte
belgeyi kaydedip kapatmak gerekir, uygulamalar zorla sonlandırılmaz. Yeni HASAR,
ŞASE, KM ve VİTES fotoğrafları HASAR alt klasörüne gider; eski dosyalar korunur.
Vites bilgisi oluşturma/düzenleme ve araç profilinde kalıcı ve tutarlıdır.
3.315 genel test, altı canlı adaptör ve gerçek NSIS kontrolü geçti.
Genel koşudaki atlamaların yedisi ayrı geçti; Windows WebKit SameSite testi
platform kısıtıyla atlandı. Typecheck, lint, build, Windows servis/depolama
kontrolü ve gerçek kurulum içeriğinin açılışı geçti; 69 UI ve dört ana süreç/preload
dosyası kaynakla eşleşti. API, File Agent, web ve 0071–0073 migration birlikte
dağıtıldı; mevcut kayıtların önce/sonra özetleri eşleşti. Kurulu **0.1.72**,
**0.1.73** sürümünü `available` gördü ve eski dosya sözleşmesi çalıştı; kimlikli
HTTP 200 indirmesinde tam boyut ve SHA-256 eşleşti. Önceki manifest/değişmez
kurulum korundu; beş ofis servisi sağlıklı. Tanılama görevleri ve inspector
kapatıldı; zorla kurulum yapılmadı.

Önceki doğrulanan ofis yayını: **0.1.72**, 2026-10-21T20:43:22.690Z; Windows x64,
112.961.755 bayt, SHA-256 `0afadaaa1fcd9ef7698058b8ccd8d6ab036c34b0d9fd9aa661df9c936017dfb0`.
Touch tıklama ritimleri, uzun basış evreleri, üç iniş, 11 tekrarsız boşta hareket ve
hızlı sallamada bulantı/toparlanma eklendi. Normal sürükleme, ekran sınırları ve
hareket azaltma korundu; yeni hareketler zamanlayıcı eklemez. 52 Touch testi dahil
3.287 genel test, altı ayrı canlı adaptör fikstürü ve gerçek NSIS kontrolü geçti.
Genel koşudaki sekiz atlamanın yedisi ayrı geçti; Windows WebKit SameSite testi
platform kısıtıyla atlandı. Typecheck, lint, build, Electron A4 ve gerçek paket
açılışı geçti; 66 UI ve üç ana süreç/preload dosyası kaynakla eşleşti. Kurulu
**0.1.71**, **0.1.72** sürümünü `available` gördü; kimlikli HTTP 200 indirmesinde
tam boyut ve SHA-256 eşleşti. Önceki manifest/değişmez kurulum korundu; beş ofis
servisi sağlıklı. Tanılama görevi ve inspector kapatıldı; zorla kurulum yapılmadı.

Önceki doğrulanan ofis yayını: **0.1.71**, 2026-10-21T20:17:29.604Z; Windows x64,
112.959.526 bayt, SHA-256 `877c5c7dc13ae6cf891bba816d2619f6f2a00972daab047d740644cfb2ba6e80`.
Kurumsal Google girişi ve Gmail/SBM bağlantısı tek tıkla güvenli tarayıcıda açılır;
parametresiz Türkçe sonuç ekranları, otomatik oturum yenileme ve uygulamaya dönüş eklendi.
State, nonce, PKCE, çerezle bağlı tamamlama ve yetki denetimleri korunur. Mobil görünüm,
klavye erişimi ve reduced-motion Chromium, Firefox, WebKit ve Electron akışlarında sınandı.
3.269 genel test ve 27 ek geçit/canlı adaptör/NSIS kontrolü geçti; typecheck, lint, build,
gerçek Electron A4 ve x64 paket açılışı geçti. Genel koşudaki sekiz atlamanın yedisi ayrı
çalıştırıldı. Windows Playwright WebKit SameSite uygulama testi platform kısıtıyla atlandı;
Strict çerez başlığı ve Chromium/Firefox uygulaması doğrulandı. Google sağlayıcısı testlerde
PKCE/nonce doğrulayan yerel fikstürdür; gerçek Google hesabıyla canlı onay sınanmadı.
Migration 0070 mevcut 687 dosyayı korudu; 75 çalışma dosyası ve 66 paketli UI dosyası
doğrulandı. Web geçidi `c46109bf` sürümünde; canlı 36 sonuç ekranı, temiz 303, CSP,
no-referrer ve korumalı API sınırları geçti. Beş ofis servisi sağlıklı, yeni işlem hatası yok.
Kurulu **0.1.70** istemcisi **0.1.71** sürümünü `available` gördü; kimlikli HTTP 200
indirmesinde tam boyut ve SHA-256 eşleşti. Önceki manifest, değişmez kurulum ve çalışma
dosyaları korundu; tanılama görevi/inspector kapatıldı, zorla kurulum yapılmadı.

Önceki doğrulanan ofis yayını: **0.1.70**, 2026-10-21T17:42:43.322Z; Windows x64,
112.957.104 bayt, SHA-256 `7ca60e23b46800bdd6456cd5bc33cca225d87a58017d505b20d396ae0bdf16d2`.
SBM servis adı, telefon ve adresi dosyaya birlikte kaydedilir; güncel servisle eşleşmeyen
iletişim aktarılmaz, kullanıcı düzeltmeleri ve föy override davranışı korunur. Manuel kaskoda
servis arama/seçme, serbest ad ve düzenlenebilir telefon/adres eklendi; açık etiketli e-posta
bilgileri kullanıcı tarafından kontrol edilebilen öneriler üretir, belirsiz alanlar boş kalır.
16 yeni regresyonla 3.237 benzersiz test geçti; genel koşudaki yedi atlama ayrı çalıştırıldı.
Typecheck, lint, build, gerçek Electron A4, NSIS ve paket smoke geçti; 65 paketli UI dosyası
hash ile eşleşti. Migration 0069 mevcut 687 dosya, 32 kaynak ve 27 föy kaydını birebir korudu;
49 çalışma dosyası doğrulandı ve önceki dosyalar yedeklendi. Beş ofis servisi çalışıyor.
Kurulu **0.1.68**, **0.1.70** sürümünü `available` gördü; kimlikli HTTP 200 indirmesinde tam
boyut ve SHA-256 eşleşti. Üç gerçek kasko kaydının detay/föy servis alanları kimlikli API ile
eşleştirildi. Önceki 0.1.69 manifesti ve değişmez kurulum korundu; zorla kurulum yapılmadı.

Önceki doğrulanan ofis yayını: **0.1.69**, 2026-10-21T15:02:46.833Z; Windows x64,
112.953.542 bayt, SHA-256 `3e0090cbc20ae774db44c98dd63423874111bff46bed7c4ccabfba85423018fa`.
İhbar föyü iletişim bilgileri kendi bölümündeki güncel servis adıyla eşleştirilir;
elle kaydedilen alanlar korunur, servis değişiminde eski iletişim yeni servise bağlanmaz.
Kapanış hatalarının gerçek kodları anlaşılır açıklamalarla gösterilir. 18 yeni regresyonla
3.221 benzersiz test geçti; genel koşudaki yedi atlama ayrı çalıştırılarak doğrulandı.
Typecheck, lint, üretim derlemesi, gerçek Electron A4 çıktısı, NSIS ve paket açılışı geçti;
65 paketli UI dosyası hash ile eşleşti. Migration 0068 mevcut 27 föyü içerik ve sürümleriyle
birebir korudu; 10 çalışma dosyası doğrulandı ve önceki dosyalar yedeklendi. Beş ofis servisi çalışıyor.
Kurulu **0.1.68**, yeni sürümü `available` gördü; kimlikli HTTP 200 indirmesinde tam boyut
ve SHA-256 eşleşti. Önceki manifest ve değişmez kurulum korundu; zorla kurulum yapılmadı.

Önceki doğrulanan ofis yayını: **0.1.68**, 2026-10-21T10:21:45.983Z; Windows x64,
112.952.528 bayt, SHA-256 `6d1ea7e526ea292e468a69051e38cf073ad94fa082b9b42fef80b606fcb6e623`.
Altı hata sınıfı düzeltildi: 14 komut dalında eşzamanlı idempotency replay, ücret
sürümü kilidi, aktif PostgreSQL bağlantı kesintisi, AI yanıt gövdesi hataları,
Google hata yanıtları ve discovery'nin geçici kaynak değişiminde kapanması.
56 yeni regresyon ve discovery kurtarma dalı eklendi; 3.203 benzersiz sürüm testi
geçti. Genel koşudaki yedi atlama ayrı çalıştırılarak doğrulandı. Typecheck, lint,
üretim derlemesi, gerçek Electron ve NSIS/paket açılışı geçti; 65 paketli UI dosyası
hash ile eşleşti. İzole 90 dakika 1,9 saniyede 5/10 kullanıcıyla 60.227 istek ve
267 fotoğraf hatasız tamamlandı; bağlantı düzeltmesinden sonraki ek 10 dakika
8 saniyede 6.764 istek ve 36 fotoğraf hatasız geçti. Havuz en çok 10 bağlantı,
bekleyen bağlantı 0; fiziksel fotoğraf hash'leri ve transaction/audit tutarlılığı
doğrulandı. Ayrı Electron kontrolünde oturumun yeniden açılışta korunması,
400 SPA geçişi ve ağ kesintisinden toparlanma geçti.
25 çalışma dosyası yedeklenip hash ile doğrulandı. Beş ofis servisi çalışıyor;
son discovery taraması 628 klasörde PASS, yeni operasyon hatası 0. Kurulu
**0.1.67**, **0.1.68** sürümünü `available` gördü; kimlikli HTTP 200 indirmesinde
tam boyut ve SHA-256 eşleşti. Önceki manifest ve değişmez kurulum korundu;
zorla kurulum yapılmadı, tanılama görevi ve inspector kapatıldı.
Denetim sonucu **PARTIAL**: 52 grup kaynak/testlerden yeniden eşlendi; tüm hata
dallarının eksiksiz E2E doğrulandığı iddia edilmez. Gerçek ücretli AI, SBM ve
pCloud yazma sandbox'ları ile tarihsel manuel kurtarma için operatör kanıtı eksik.

Önceki doğrulanan ofis yayını: **0.1.67**, 2026-10-21T04:50:51.208Z; Windows x64,
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
