# HasarBotu V2 — API Runtime Temeli (Paket 04)

Tarih: 2026-07-12
Durum: Uygulandi — `services/api` (`@hasarbotu/api@0.0.0`), dal `foundation/package-04-api-skeleton`

## 1. Runtime mimarisi

- Node.js 24 LTS (`engines: >=24 <25` root + API paketinde).
- Fastify tam `5.10.0`; ek plugin yok (CORS, cookie, JWT, Swagger, pino-pretty, ORM/DB bilinçli olarak eklenmedi).
- `@hasarbotu/contracts` dis HTTP sozlesmesinin tek kaynagidir; API, domain/contracts invariant'larini yeniden tanimlamaz (health yaniti gonderilmeden once contracts semasiyla parse edilir).
- Gelistirme kosucusu: `tsx@4.23.0` (tam pin); uretim yolu `tsc` build + `node dist/index.js`.

## 2. Uygulama / sunucu ayrimi

- `buildApp(options)`: saf fabrika. Fastify instance dondurur, port dinlemez; `clock`, `logLevel`, `loggerStream`, `loggerEnabled` enjekte edilebilir. Testler gercek TCP portu acmadan `app.inject` kullanir.
- `startServer()`: `parseConfig(process.env)` → `buildApp` → `listen({host, port})`. Baslangic hatasinda loglar, uygulamayi kapatir, `exitCode=1` ile kontrollu doner.
- Graceful shutdown: `SIGINT`/`SIGTERM` `process.once` + `shuttingDown` bayragiyla tek kapanis; kapanis hatasi yapilandirilmis `err` alaniyla loglanir, hassas veri mesaja interpolate edilmez.
- `index.ts` export bariyeridir; sunucu yalniz gercek entrypoint dogrudan calistirildiginda baslar (argv[1] ↔ import.meta.url karsilastirmasi).

## 3. Config siniri

- Alanlar: `HOST` (vars. `127.0.0.1`), `PORT` (vars. `3100`), `LOG_LEVEL` (vars. `info`), `NODE_ENV` (vars. `development`).
- `PORT` acik `^\d+$` parser'iyla islenir: 1..65535; ondalik, isaret, bosluk, hex, bilimsel gosterim reddedilir. Kontrolsuz coercion yoktur.
- Gecersiz config'te sunucu baslatilmaz. `ConfigError` yalnizca alan adi + kural tasir; ortam DEGERI veya `process.env` icerigi hata ciktisina yazilmaz.
- `dotenv` yok; `.env` Git disindadir. `parseConfig` saf fonksiyondur — testler gercek ortama bagimli degildir.

## 4. Logging ve hata politikasi

- Pino redaksiyonu `buildApp` icinde yapisaldir (disaridan logger nesnesi verilemez): `req.headers.authorization`, `req.headers.cookie`, `req.headers["set-cookie"]`, `req.headers["x-api-key"]`, `res.headers["set-cookie"]` → `[redacted]`.
- Log mesajlari sabittir; kullanici girdisi interpolation ile mesaja eklenmez. Hata instance'i yapilandirilmis `err` alanidir; `requestId` her hata loginda bulunur.
- HTTP yanit politikasi (contracts failure envelope):
  - Bilinmeyen route/method → 404 `not_found`, sabit guvenli mesaj, gercek Fastify `requestId`.
  - Beklenmeyen hata → 500 `internal_error`; ham exception mesaji/stack/path/payload yanita tasinmaz.
  - Fastify'nin statusCode'lu 4xx cerceve hatalari (ör. 413 body limit) durum kodunu korur, `validation_error` koduyla guvenli zarfa cevrilir. Ileri paketlerdeki endpoint'ler icin genel framework kurulumu bilinçli olarak yapilmamistir.
- `trustProxy: false`; body limit 1 MiB; request timeout 30 sn; request ID Fastify uretir (`requestIdHeader: false` — istemci basligina guvenilmez).

## 5. Health semantigi

- `GET /health` → 200; govde: `status: 'ok'`, `service: 'hasarbotu-api'`, `version` (API package.json surumu), `checkedAt` (kanonik UTC `Z`).
- Zaman `Clock` adapterindan gelir: runtime'da `systemClock`, testlerde `fixedClock` (deterministik `checkedAt`).
- Gercek database/bagimlilik kontrolu YOKTUR; sozlesmedeki `degraded` durumu korunur fakat bu pakette sahte dependency kontrolu uretilmez. PostgreSQL hazirmis izlenimi verilmez.

## 6. Kapsam disi (Paket 04)

PostgreSQL, migration, authentication/session, kullanici/rol, Cases endpoint'leri, OpenAPI/Swagger, CORS, LAN erisimi (host varsayilani loopback), uretim deployment'i, Electron, File Agent, Gmail, AI.

## 7. Paket 05 (PostgreSQL baglanti/migration) oncesi kabul kosullari

1. Root + workspace kalite kapilari yesil (typecheck/lint/test/build/audit) ve temiz checkout'ta yeniden uretilebilir.
2. `GET /health` gercek HTTP uzerinde 200 + contracts uyumu; bilinmeyen route guvenli 404; graceful shutdown sonrasi port bos.
3. UI baseline regresyonsuz (26 UI testi + smoke).
4. Karar kapilari: DB baglanti kutuphanesi/migration araci, health'in gercek bagimlilik kontrolune genisleme bicimi (`degraded` semantigi) ve config siniri genisletmesi (DATABASE_URL vb. + secret politikasi) Paket 05 talimatinda cozulmelidir.
