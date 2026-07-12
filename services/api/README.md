# `@hasarbotu/api`

HasarBotu V2 merkezi API'sinin **Paket 04 iskeleti**: Fastify tabanli, `@hasarbotu/contracts` sozlesmelerini tuketen minimum calisma ve saglik siniri.

## Kapsam (Paket 04)

- Gercek `GET /health` endpoint'i (contracts health sozlesmesiyle birebir).
- Guvenli 404 ve merkezi hata zarflari (contracts failure envelope).
- Graceful shutdown (SIGINT/SIGTERM, tek kapanis garantisi).
- **Icermez:** PostgreSQL, migration, authentication, session, kullanici/rol, Cases endpoint'leri, Electron, File Agent, Gmail, AI. Health yaniti database hazirmis izlenimi VERMEZ; `status` bu pakette her zaman `ok` doner.
- LAN erisimi henuz acilmamistir (varsayilan host `127.0.0.1`); uretim deployment'i yapilmamistir.

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
