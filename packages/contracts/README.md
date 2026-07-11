# `@hasarbotu/contracts`

HasarBotu V2'nin UI ile gelecekteki merkezi API arasindaki **surumlu, runtime dogrulanan sozlesme siniridir**. Wire (JSON) DTO'lari Zod 4 semalari olarak tanimlanir; TypeScript tipleri `z.infer` ile bu semalardan turetilir. Bu paket calisan bir HTTP sunucusu, veritabani, auth veya UI adaptoru icermez.

## Sinirlar

- Runtime dogrulama yalniz **Zod 4** ile yapilir.
- Runtime dependency yalniz `@hasarbotu/domain` (workspace) ve `zod`'dur.
- Public object semalari `strict`'tir: bilinmeyen alan reddedilir, kontrolsuz coercion yoktur.
- Domain tipleri ile JSON DTO **ayni sey degildir**. Donusum yalnizca `v1/cases/mappers.ts` icindeki saf mapper'larla, acik sekilde yapilir.
- Domainde opsiyonel iliski `undefined`/alan yoklugu; wire DTO'da tutarli `null` ile temsil edilir.
- Sunum alani, Turkce sabit etiket, renk veya badge sozlesmeye sizmaz.
- Hata nesnesi ham girdi degeri veya Zod'un urettigi serbest metni tasimaz; yalnizca alan yolu ve kararli kod tasir.

## Klasor duzeni

- `src/common` — primitives, zarflar, hata modeli, pagination/sorting ve taban route sabitleri.
- `src/health` — `/health` yanit sozlesmesi.
- `src/v1/cases` — surumlu `/api/v1` read-only Cases sorgu/DTO/mapper/route'lari.

## Icerik

- **Primitives:** kimlikler (`caseId`, `userId`, `serviceId`, `insurerId`), `CaseType`, `CaseStatus`, `CaseStage`, `OfficeCaseNumber`, ihbar/hasar no, plaka, `UtcDateTime`, `LocalDate`, `EntityVersion`.
- **Zarf:** ortak `successEnvelopeSchema(data)` (`ok`, `data`, opsiyonel `meta`) ve `failureEnvelopeSchema`.
- **Hata modeli:** kararli `ApiErrorCode` seti ve `zodErrorToApiError` guvenli donusturucu.
- **Pagination/sorting:** `page` (varsayilan 1), `pageSize` (varsayilan 25, maksimum 100), `sortBy`, `sortDirection`.
- **Health:** `/health` yanit sozlesmesi (`status: ok|degraded`, `service`, `version`, `checkedAt`).
- **Cases v1 (read-only):** `GET /api/v1/cases` sorgu + liste yaniti, `GET /api/v1/cases/:caseId` param + detay yaniti, domain mapper'lari.

## Route sinirlari

- API surumu `v1`, tabani `/api/v1`.
- Health, surumlu tabanin disindadir: `/health`.

## Komutlar

```text
npm run typecheck --workspace @hasarbotu/contracts
npm run test --workspace @hasarbotu/contracts
npm run build --workspace @hasarbotu/contracts
npm run schema --workspace @hasarbotu/contracts
```

`build` ESM JavaScript ve declaration ciktisini `dist/` altina uretir. `schema`, Zod 4 yerlesik donusumuyle deterministik JSON Schema dosyalarini `dist/json-schema/` altina yazar. `dist` Git tarafindan ignore edilir; sema ciktisi commit edilmez.
