# `@hasarbotu/api`

HasarBotu V2 merkezi API'si: Fastify, PostgreSQL ve `@hasarbotu/contracts` tabanlı kimlikli ofis servisidir. İş kuralları `@hasarbotu/domain` içindedir; fiziksel dosya işleri File Agent üzerinden yürür.

Klasör adı dosya kimliği değildir. Yeni çalışma klasöründe değişmez workspace UUID'si saklanır; pCloud kimliği bu UUID ve güncel konum doğrulanarak mevcut vakaya bağlanır. Sahipsiz mevcut dizin, başka kaydın kimliği, devam eden klasör rezervasyonu ve aynı plakalı ikinci belirsiz kaynak otomatik sahiplenilmez. `0074_folder_path_ownership` yeni konum/klasör oluşturma/taşıma rezervasyonlarında normalleştirilmiş adın tek sahipliğini ve klasör kaydının kiracı/kök bütünlüğünü zorlar; eski kayıtları düzeltmez. Operatör veri onarımı Windows servis README'sindeki ayrı bakım aracındadır.

Eski, UUID işareti bulunmayan çalışma klasörü taşındığında tekil vaka, tamamlanmış workspace, eski konumun yokluğu ve kayıtlı dosya SHA-256'ları birlikte doğrulanır. Eksik tarihsel belge varsa eski konuma ait iki farklı pCloud dosya kimliği/revizyonunun mevcut attestation kayıtlarıyla kesintisiz devam ettiği ayrıca kanıtlanır; eksik belgelerin geçmişi silinmez. Aynı plakalı birden fazla vaka, içerik farkı, elle arşivleme ve devam eden işlemler otomatik eşlemeyi engeller.

## Kapsam

Evrak izleme, tamamlanmış fiziksel taşıma zincirini listeleme, kontrol ve tarama uzlaştırmasında izler.
Birden fazla taşıma yeni hash gözleminden önce gerçekleşse de aynı içerik özgün belge/inceleme kimliğini korur;
belirsiz geçmiş eşleşmesi 409 ile durur. Elle konum atama tek başına belge erişimini yeniden eşlemez.

- Gercek `GET /health` endpoint'i (contracts health sozlesmesiyle birebir).
- Guvenli 404 ve merkezi hata zarflari (contracts failure envelope).
- Graceful shutdown (SIGINT/SIGTERM, tek kapanis garantisi).
- PostgreSQL, kalıcı oturum, altı rol ve ofis yetki politikası; dosya/evrak, görev/not, kapanış, ücret, PERT, değer kaybı, poliçe/OCR/AI, mevzuat, Gmail/SBM, saha fotoğrafları ve kimlikli masaüstü güncellemeleri.

Google OAuth callback'i doğrulama sonrasında parametresiz `/api/v1/google/result/:client/:purpose/:outcome` ekranına 303 ile yönlendirir. Sonuç ekranı oturum açmaz; mevcut state, nonce, PKCE ve isteği başlatan tarayıcının HttpOnly çereziyle `/google/complete` doğrulaması korunur. Gmail tamamlama adımı güncel oturumu ve yönetim yetkisini yeniden denetler. Migration `0070_google_oauth_client` sunum hedefini ekler; eski istemciler `web` varsayılanıyla çalışır.

SBM taraması yaklaşık 60 saniyede bir Gmail salt okunur kapsamıyla çalışır; dosya sorumlusunun açık istemcisi bildirimleri 15 saniyede bir kontrol eder. Eşleşme yalnız aynı ofisteki tam SBM başvuru numarasıyla yapılır; hasar numarası veya plaka tahminiyle dosya tamamlanmaz. Doğrulanmış mutabakat ve komisyon oybirliği son durum şablonları `SBM_AUTOMATIC_ENABLED=true` iken işlenir. Yeni sonuç, dosya sorumlusuna sessize alma ayarından bağımsız pop-up üretir; kontrol gereken sonuç açıkça bu şekilde gösterilir. İhbar/bilgilendirme tamamlanma bildirimi üretmez. Eski tarihli, ek/alıntı içeren, çelişkili veya eksik içerik otomatik tamamlanmaz; önceki onaylar ve taranmış mesajlar yeniden işlenmez. Numara henüz kayıtlı değilse e-posta incelemede korunur; numara sonradan girildiğinde açık kullanıcı onayı gerekir. Bağlantı izni sona ererse yönetici Gmail bağlantısını yenilemelidir.

- Kritik komutlar transaction, sürüm kontrolü, idempotency ve atomik audit kullanır. Evrak/fotoğraf kaydı kapanışla aynı dosya kilidini alır; kapanmış dosyaya yeni kayıt reddedilir. Aynı kayıt isteği tekrarlandığında tek sonuç döner; ayrılmış depolama yolu 409 üretir.
- Kilit bekleyen aynı anahtarlı komutlar ilk yanıtı tekrar döndürür; ücret revizyonu güncel sürüm kilidi altında okunur. `reliability-recovery.test.ts`, gerçek HTTP kesintisi, API/havuz yeniden kurulumu ve PostgreSQL bağlantı kaybında rollback, tek kayıt/audit ve kalıcı oturum kurtarmasını doğrular. Aktif havuz istemcisinin bağlantı hatası da güvenli biçimde ele alınır.
- Üretim ofis erişimi mevcut HTTPS dağıtımından sağlanır; geliştirme varsayılanı `127.0.0.1` kalır. Yapılandırılmış veritabanı sağlık kontrolü başarısızsa `/health` sağlıklı sonuç bildirmez.
- İhbar föyünde atanmış servisin telefonu önceliklidir; servis dizininde adres alanı yoktur. Eksist iletişim bilgileri yalnız kendi bölümündeki servis adı güncel servisle eşleşirse kullanılır. Migration 0068 elle kaydedilmiş servis alanlarını mevcut servise bağlar; servis değişince eski alanlar depoda korunur ve yeni serviste gösterilmez. Açık eski düzenleyicinin kaydı sürüm kontrolüyle reddedilir.
- Servisli yeni ihbar ve revizyonlar aynı transaction içinde tek, kesin ad eşleşmesiyle rehbere bağlanır; belirsiz/pasif adlar sessizce eşlenmez. `includeAddresses=true`, aynı servis kimliğine bağlı arşivlenmemiş dosyalarda tek ve tutarlı adres varsa döndürür; çelişkide boş bırakır. Eski bağlantısız servisler `/references/service-contact-names` ve `cases?serviceName=...` ile üretim atamaları değiştirilmeden filtrelenir.
- Föy başlığı `x-hasarbotu-notice-sheet-fields: 3`, araç tescil tarihlerini ve geçmiş hasar metinlerini taşır. Eski istemciler bu alanları görmez ve kayıtta silemez; kaskoda gizlenen mağdur verileri ve kaldırılan çalışma notları korunur. Yeniden oluşan pCloud klasör kimliğinin onarımı otomatik plaka eşleştirmesiyle yapılmaz; yöneticiye ait hash onaylı plan, kayıtlı dosya hashleri, güncel aday sürümleri ve canlı kaynak doğrulaması gerekir.

Node.js 24.15+ gerekir; doğrulanan araç zinciri 24.22.0'dır. Test yazmaları yalnız `_test` ile biten ayrı veritabanında yapılır. `npm test --workspace @hasarbotu/api -- test/multi-user-system.test.ts`, gerçek HTTP oturumlarıyla 5/10/20/50 istemciyi sınar; `HB_CAPACITY_DURATION_MS=10000` kontrollü yük süresini, `HB_CAPACITY_RESULTS` JSONL ölçüm dosyasını belirler. Dış servisler yük testinin hedefi değildir.

`node scripts/test-field-multi-user.mjs`, aynı `_test` korumasıyla 5/10 ayrı tarayıcı oturumu, çakışan klasörler, gerçek File Agent ve disk hash kontrollerini çalıştırır. Bu testin pCloud tazelik kapısı sentetiktir; gerçek dış servis yükü oluşturmaz. `scripts/package66-browser-smoke.mjs` güncel hesaplayıcı tarayıcı akışına yönlenir; ekran görüntüleri yalnız `HB_CAPTURE_SCREENSHOTS=1` ile üretilir.

## Calistirma (Windows PowerShell)

```powershell
# gelistirme (tsx watch, kaynak dosyadan)
npm run dev:api

# derle + calistir
npm run build --workspace @hasarbotu/api
npm run start --workspace @hasarbotu/api

# ozel port ile
$env:PORT = '3200'; npm run start --workspace @hasarbotu/api

# saglik kontrolu (ayri terminal)
Invoke-RestMethod http://127.0.0.1:3100/health
```

Durdurma: calisan terminalde `Ctrl+C` (SIGINT) graceful shutdown baslatir; ayni sinyalin tekrarinda ikinci kapanis BASLATILMAZ.

## Ortam degiskenleri

| Degisken | Varsayilan | Kural |
|---|---|---|
| `HOST` | `127.0.0.1` | bos olmayan host/IP |
| `PORT` | `3100` | tam sayi, 1..65535; ondalik/isaret/bosluk reddedilir |
| `LOG_LEVEL` | `info` | `fatal error warn info debug trace silent` |
| `NODE_ENV` | `development` | `development production test` |

Gecersiz yapilandirmada sunucu **baslatilmaz**; hata cikisi yalnizca alan adi ve kurali tasir, ortam degeri veya `process.env` icerigi yazilmaz. Bu paket `dotenv` kullanmaz; `.env` dosyalari repository'ye alinmaz (`.gitignore`).

## `/health` sozlesmesi

`GET /health` → HTTP 200, `application/json`:

```json
{ "status": "ok", "service": "hasarbotu-api", "version": "0.0.0", "checkedAt": "2026-07-11T09:00:00.000Z" }
```

Yanit gonderilmeden once `@hasarbotu/contracts` health semasiyla dogrulanir. `checkedAt` gercek UTC saatinden ayri bir `Clock` adapteriyle uretilir; testler sabit clock enjekte eder. Hostname, kullanici, IP, dosya yolu, env veya secret yanita eklenmez.

## Uygulama / sunucu ayrimi

- `buildApp(options)` (app.ts): saf fabrika; Fastify instance dondurur, **port dinlemez**. Testler gercek TCP acmadan `app.inject` kullanir. `clock`, `logLevel`, `loggerStream`, `loggerEnabled` disaridan verilebilir.
- `startServer()` (server.ts): config okur, uygulamayi kurar, dinler, sinyalde graceful kapanir; baslangic hatasinda kontrollu cikar.
- `index.ts` import edildiginde sunucu BASLAMAZ; yalniz dogrudan calistirilan gercek entrypoint baslatir.

## Guvenli varsayimlar

- `trustProxy: false`; proxy basliklarina guvenilmez.
- Body limit 1 MiB; request timeout 30 sn.
- Request ID Fastify tarafindan uretilir; istemci `x-request-id` basligina guvenilmez. Hata zarflarindaki `requestId` gercek Fastify request ID'sidir.
- Log redaksiyonu yapisaldir (buildApp disina cikarilamaz): `authorization`, `cookie`, `set-cookie`, `x-api-key` hicbir seviyede ham yazilmaz.
- Ham exception mesaji, stack, path veya payload HTTP yanitina tasinmaz; 404 ve beklenmeyen hatalar contracts failure envelope ile doner.

## Build ciktisi

`npm run build` ESM JavaScript + declaration ciktisini `services/api/dist` altina uretir; `dist` Git tarafindan ignore edilir. Root `npm install`/`prepare`, domain → contracts → api sirasiyla paketleri build eder.
