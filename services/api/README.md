# `@hasarbotu/api`

HasarBotu V2 merkezi API'si: Fastify, PostgreSQL ve `@hasarbotu/contracts` tabanlı kimlikli ofis servisidir. İş kuralları `@hasarbotu/domain` içindedir; fiziksel dosya işleri File Agent üzerinden yürür.

## Kapsam

- Gercek `GET /health` endpoint'i (contracts health sozlesmesiyle birebir).
- Guvenli 404 ve merkezi hata zarflari (contracts failure envelope).
- Graceful shutdown (SIGINT/SIGTERM, tek kapanis garantisi).
- PostgreSQL, kalıcı oturum, altı rol ve ofis yetki politikası; dosya/evrak, görev/not, kapanış, ücret, PERT, değer kaybı, poliçe/OCR/AI, mevzuat, Gmail/SBM, saha fotoğrafları ve kimlikli masaüstü güncellemeleri.
- Kritik komutlar transaction, sürüm kontrolü, idempotency ve atomik audit kullanır. Evrak/fotoğraf kaydı kapanışla aynı dosya kilidini alır; kapanmış dosyaya yeni kayıt reddedilir. Aynı kayıt isteği tekrarlandığında tek sonuç döner; ayrılmış depolama yolu 409 üretir.
- Kilit bekleyen aynı anahtarlı komutlar ilk yanıtı tekrar döndürür; ücret revizyonu güncel sürüm kilidi altında okunur. `reliability-recovery.test.ts`, gerçek HTTP kesintisi, API/havuz yeniden kurulumu ve PostgreSQL bağlantı kaybında rollback, tek kayıt/audit ve kalıcı oturum kurtarmasını doğrular. Aktif havuz istemcisinin bağlantı hatası da güvenli biçimde ele alınır.
- Üretim ofis erişimi mevcut HTTPS dağıtımından sağlanır; geliştirme varsayılanı `127.0.0.1` kalır. Yapılandırılmış veritabanı sağlık kontrolü başarısızsa `/health` sağlıklı sonuç bildirmez.
- İhbar föyünde atanmış servisin telefonu önceliklidir; servis dizininde adres alanı yoktur. Eksist iletişim bilgileri yalnız kendi bölümündeki servis adı güncel servisle eşleşirse kullanılır. Migration 0068 elle kaydedilmiş servis alanlarını mevcut servise bağlar; servis değişince eski alanlar depoda korunur ve yeni serviste gösterilmez. Açık eski düzenleyicinin kaydı sürüm kontrolüyle reddedilir.

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
