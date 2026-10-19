# `@hasarbotu/desktop`

HasarBotu V2'nin **ince Electron kabuğu** (ADR-Q06, Paket 21 / D2).

Kabuk şunları yapar ve başka hiçbir şey yapmaz:

1. Loopback aynı-origin köprüsünü başlatır (`@hasarbotu/desktop-bridge`, D1).
2. API'nin ayakta ve **sürüm olarak uyumlu** olduğunu doğrular (D3).
3. Güvenli bir `BrowserWindow` açar ve o **tek** origin'i yükler.
4. `src/main/*` içindeki saf politika kararlarını Electron API'lerine bağlar.

**Kabukta iş mantığı yoktur** ve `ipcMain` handler'ı kaydedilmez. UI verisini
bugün olduğu gibi göreli `/api/...` üzerinden alır; hiçbir adapter sözleşmesi
değişmez. Bu kural, Paket 21'in geri alma stratejisinin ("desktop paketini
kaldır, web dağıtımını kullan") geçerli kalmasının tek şartıdır.

## Güvenlik sınırları

| Alan | Uygulanan |
|---|---|
| Renderer | `nodeIntegration=false`, `contextIsolation=true`, `sandbox=true`, `webSecurity=true`, `webviewTag=false` |
| Preload | Yalnız iki **veri** alanı (`isDesktopShell`, `platform`). Fonksiyon yok, IPC kanalı yok, `ipcRenderer` yok |
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

- Code signing, installer ve otomatik güncelleme (kullanıcı talimatı; Paket
  21/22 dağıtım kararları).
- Renderer'dan Node/fs erişimi, doğrudan PostgreSQL, File Agent görevi.
- Harici bağlantıyı varsayılan tarayıcıya devretme (kabuk hiçbir URL'i dışarıya
  açmaz).

## Bilinen Electron tuzağı

ESM giriş noktasında **üst düzey `await` kullanılmaz**. Electron, giriş
modülünün değerlendirmesi bitmeden `ready` olayını yaymaz; üst düzey
`await app.whenReady()` yazılırsa uygulama sessizce kilitlenir. Bu davranış
gerçek Electron 43 ile gözlendi (bkz. `docs/DECISION_LOG.md` → HB-2026-105).

## Kalıcı yerel depolama

Masaüstü başlangıcı ilk seçilen köprü portunu `userData/bridge-origins` altında API origin'i bazında saklar. Sonraki açılışlar aynı portu kullanır; port doluysa uygulama hata bildirir ve farklı bir porta geçmez. Kaydedilmiş portla çelişen `HASARBOTU_BRIDGE_PORT` değeri kabul edilmez. Chromium oturum bölümü de API bazında ayrıdır; hızlı not anahtarları kullanıcı bazında ayrılmaya devam eder.

Bu değişiklikten önce rastgele portlarda bırakılmış depolama otomatik taşınmaz. Eski taslak gerekiyorsa önceki sürümün ilgili origin'indeki metin ayrıca kurtarılmalıdır.

## Ofis güncellemesi yayınlama

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

Son kayıtlı ofis yayını: **0.1.53**, 2026-10-19T04:54:32.219Z; Windows x64,
105.191.623 bayt, SHA-256 `f180e53ad78129021b8acb95e153a7c332d70797e066f3bde66ea3bbd897c901`.
0.1.49 istemcisinin yeni sürümü gördüğü ve tam paketi doğruladığı, önceki 0.1.52 manifesti
ve kurulumunun korunduğu önceki yayın kaydından aktarılmıştır; bu belge temizliğinde
yeni uygulama sürümü yayınlanmamıştır.
