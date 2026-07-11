# `@hasarbotu/contracts`

HasarBotu V2'nin UI ile gelecekteki merkezi API arasindaki **surumlu, runtime dogrulanan sozlesme siniridir**. Wire (JSON) DTO'lari Zod 4 semalari olarak tanimlanir; TypeScript tipleri `z.infer` ile bu semalardan turetilir. Bu paket calisan bir HTTP sunucusu, veritabani, auth veya UI adaptoru icermez.

## Sinirlar

- Runtime dogrulama yalniz **Zod 4** ile yapilir; surum tam olarak `4.4.3` sabitlenmistir.
- Runtime dependency yalniz `@hasarbotu/domain` (workspace) ve `zod`'dur.
- Public object semalari `strict`'tir: bilinmeyen alan reddedilir, kontrolsuz coercion yoktur (string/boolean/NaN/Infinity sayi alanlarinda reddedilir).
- Domain tipleri ile JSON DTO **ayni sey degildir**. Donusum yalnizca `v1/cases/mappers.ts` icindeki saf mapper'larla, acik sekilde yapilir.
- Domainde opsiyonel iliski `undefined`/alan yoklugu; wire DTO'da tutarli `null` ile temsil edilir.
- Sunum alani, Turkce sabit etiket, renk veya badge sozlesmeye sizmaz.
- Hata nesnesi ham girdi degeri, stack, SQL mesaji, mutlak yol, parola veya token tasimaz; yalnizca alan yolu ve kararli kod tasir. `unrecognized_keys` icin reddedilen alan ADLARI (degerler degil) en cok 10 adet, temizlenmis olarak raporlanir.

## Deger sinirlari

- **Kimlikler** (`caseId`, `userId`, `serviceId`, `insurerId`): 1..128 karakter, guvenli ASCII (`A-Z a-z 0-9 . _ -`); yol ayraci, bosluk, kontrol karakteri ve `..` reddedilir. Kimlik dosya yolu olamaz.
- **Referans numaralari** (`notificationFormNumber`, `insurerClaimNumber`): 1..128 karakter, en az bir alfasayisal; kontrol karakteri ve ters bolu reddedilir; slash gecerlidir (`11/18882475`). Bu degerler **path olarak kullanilmamalidir**.
- **Plaka**: 1..32 karakter; kanonik bicim runtime'da domain dogrulayicisiyla garanti edilir.
- **Takip tarihi**: `followUpDate` ve `followUpFrom`/`followUpTo` yalniz `LocalDate` (`YYYY-MM-DD`) tasir; timezone donusumu yapilmaz. `lastInterventionAt`, `createdAt`, `updatedAt` UTC tarih-saattir.
- **Pagination**: `page` 1..10.000 (varsayilan 1), `pageSize` 1..100 (varsayilan 25).
- **Arama**: `search` 1..120 karakter; alan yoksa filtre uygulanmaz.

## Klasor duzeni

- `src/common` — primitives, zarflar, hata modeli, pagination/sorting ve taban route sabitleri.
- `src/health` — `/health` yanit sozlesmesi (`status: ok|degraded`, `service`, `version`, `checkedAt`).
- `src/v1/cases` — surumlu `/api/v1` read-only Cases sorgu/DTO/mapper/route'lari.

## JSON Schema politikasi

- Semalar Zod 4 yerlesik `z.toJSONSchema` ile deterministik uretilir; ek OpenAPI bagimliligi yoktur.
- Pattern/min/max/length ile ifade edilebilen HER kural JSON Schema ciktisina tasinir; runtime ile yayimlanan sema arasinda sessiz semantik fark birakilmaz.
- JSON Schema standardinin tek basina garanti EDEMEDIGI kurallar (gercek takvim gecerliligi, plaka kanonikalizasyonu) semada `x-hasarbotu-runtime-validation` metadata'siyla acikca isaretlenir.
- **JSON Schema hicbir yerde tek basina guvenlik siniri degildir.** Kaynak dogruluk her zaman Zod runtime dogrulamasidir; sema, dokumantasyon ve dis birlikte calisabilirlik icindir.

## Artefaktlar: ne zaman ne uretilir

- `npm install` / `npm ci` (root): `prepare` script'i domain ve contracts paketlerini **build eder** (`dist/` ESM + declaration). JSON Schema dosyalari uretilMEZ.
- `npm run build` (root veya workspace): ayni `dist/` ciktisi.
- `npm run schema --workspace @hasarbotu/contracts`: paketi build eder ve 6 JSON Schema dosyasini `dist/json-schema/` altina yazar. `dist` Git tarafindan ignore edilir; uretim artefakti commit edilmez.
- `npm run schema:fixtures --workspace @hasarbotu/contracts`: golden fixture'lari `test/fixtures/json-schema/` altina ACIK olarak yeniden yazar. Yalniz bilincli sozlesme degisikliklerinde kullanilir.

## Golden fixture regresyonu

`test/fixtures/json-schema/` altindaki commit edilmis fixture'lar canonical sozlesme ciktisidir. `json-schema-golden.test.ts`, uretilen semalari bu fixture'larla semantik olarak karsilastirir: Zod surumu veya sema tanimi degisir de cikti kayarsa test kirilir. Normal test kosusu fixture'lari asla sessizce guncellemez.

## Komutlar

```text
npm run typecheck --workspace @hasarbotu/contracts
npm run test --workspace @hasarbotu/contracts
npm run build --workspace @hasarbotu/contracts
npm run schema --workspace @hasarbotu/contracts
npm run schema:fixtures --workspace @hasarbotu/contracts
```

Not: workspace komutlari `@hasarbotu/domain` paketinin build ciktisina (`packages/domain/dist`) dayanir. Root `typecheck`/`test`/`build` komutlari bu sirayi kendisi garanti eder; workspace komutunu tek basina calistirmadan once domain build edilmis olmalidir (`npm run build:packages`).
