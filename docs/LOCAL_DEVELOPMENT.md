# HasarBotu V2 — Yerel geliştirme hazırlığı

Bu bilgisayar kaynak geliştirme ve derleme içindir. Production verisi ve
15 Ağustos 2026 tarihli operasyon başka bir bilgisayardadır. Bu kaynak
kopyasının Git geçmişi, son kontrol aşamasında mevcut
`Josquexecute/HasarBotuV2` deposuyla eşleştirilerek geri alındı. Production
dağıtımıyla eşitlik iddia edilmez. Masaüstü kaynak sürümü `0.1.2` olarak korunur.

## Araçlar ve başlangıç

Proje Node.js `>=24 <25` ister. Bu çalışma alanında resmi Node dağıtımından
SHA-256 doğrulamasıyla alınmış Node `24.21.0` / npm `11.19.0`, `.local/tooling`
altında bulunur. Sistem genelindeki Node kurulumu değiştirilmez.

Proje kökünde açılan her yeni PowerShell terminalinde:

```powershell
. .\.local\enter-development.ps1
npm.cmd run dev
```

`.local` makineye özgüdür ve Git dışında tutulur. Başka bir kaynak kopyasında
Node 24.x kurup `npm ci` çalıştırın. Workspace paketleri kurulumun `prepare`
adımında derlenir. Yeni kurulum için kilit dosyasını silmeyin.

## Kod ve build komutları

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd audit
```

`build` arayüzü, ortak paketleri, API'yi, File Agent'ı ve Electron kabuğunu
derler; arayüzün bundle sınırını da kontrol eder. Test suite'ini çalıştırmaz.
Frontend çıktısı kökteki `dist`, servis ve paket çıktıları ilgili workspace'in
`dist` dizinindedir. Mevcut kilit dosyasıyla kurulmuş ortamda `npm ci` adımını
her komuttan önce tekrarlamak gerekmez.

npm'in kurulum betiği politikası `package.json` içinde kayıtlıdır: `argon2`
ve `esbuild` için incelenmiş sürümlere izin verilir. Kullanılmayan Squirrel
paketleyicisinin `electron-winstaller` betiği ve Tesseract'ın bağış mesajı
betiği kapalıdır; NSIS paketleme ve OCR çalışma kodu korunur. Sürüm
güncellemelerinde `npm install-scripts ls` ile yeni betikleri inceleyin.

```powershell
npm.cmd run package:win --workspace @hasarbotu/desktop
```

Paketleme çıktısı `apps/desktop/release/HasarBotu-Setup-0.1.2.exe` olur.
Yerel build, kullanıcı kabulü yapılmış production release anlamına gelmez.
Installer API, PostgreSQL veya File Agent servislerini kurmaz; bu bileşenler
ayrı deployment akışına sahiptir.

## Veri modu ve sonraki test aşaması

Geliştirme arayüzünün varsayılanı görünür biçimde belirtilen mock modudur.
Production build her zaman API modunu kullanır. Gerçek API testi için ayrı
sentetik PostgreSQL veritabanı, test kullanıcıları ve sentetik storage gerekir.
Yerel geliştirme proxy'si `/api` isteklerini `http://127.0.0.1:3100` adresine taşır.
Production bağlantı bilgilerini veya müşteri verisini bu ortama kopyalamayın.

API ortam değişkenlerini process ortamından okur; `.env` dosyasını otomatik
yüklemez. `DATABASE_URL` olmadan geliştirme API'si yalnız health sunabilir;
health yanıtı, dosya ve oturum akışlarının çalıştığının kanıtı değildir.

İlk kod hazırlığından sonra kullanıcının talimatıyla yerel test ortamı kuruldu.
Başlatma, giriş ve test komutları [test ortamı kılavuzundadır](./LOCAL_TEST_ENVIRONMENT.md).
File Agent config regresyonu, veritabanı testleri ve giriş/oturum testleri geçti.
Güncel tam test zinciri sonucu [son kontrol raporunda](./FINAL_VERIFICATION.md) tutulur.
`TEST_DATABASE_URL` yalnız adı `_test` ile biten ayrı test DB'sine işaret etmelidir.
`npm run check:deploy` de Node/PowerShell testleri çalıştırır; yalnız statik
şablon kontrolü değildir ve test aşamasına dahildir.

Tarayıcı/Electron kabulü ayrıca 1366×768 ve 1920×1080, açık/koyu tema,
giriş, dosya detayı ve admin karantina ekranını kapsamalıdır. Mevcut testler,
eski production kayıtları veya derleme sonucu bu kabulün yerine geçmez.

Bu çalışmanın sonuçları: [hazırlık raporu](./LOCAL_READINESS_REPORT.md).
