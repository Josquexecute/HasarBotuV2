# `@hasarbotu/domain`

HasarBotu V2'nin React, Vite, Electron, Node.js, API ve veritabanından bağımsız ortak domain çekirdeğidir. Paket yalnız saf TypeScript değerleri, doğrulayıcılar ve temel vaka sözleşmesini içerir. UI henüz bu pakete bağlanmamıştır.

## Sınırlar

- Runtime dependency yoktur.
- Kimlik üretilmez; dışarıdan gelen değer kırpılır ve boş değer reddedilir. UUID/ULID biçimi bu paketin kararı değildir.
- Normal doğrulama hataları exception atmaz; `ParseResult<T>` ve kararlı hata kodları döndürür.
- Hata nesneleri ham girdiyi veya kullanıcıya gösterilecek metni içermez.
- Domain sınırında `Date` nesnesi, `null`, Türkçe sunum etiketi, renk, badge veya tablo alanı yoktur.
- İsteğe bağlı alanlar `undefined`/alanın bulunmaması ile temsil edilir; `null` kullanılmaz.

## Kararlı kodlar

`CaseType` yalnız `traffic` ve `casco` değerlerini kabul eder.

Kilit ürün kuralı `isValueLossRequired` ile saf biçimde temsil edilir: Trafik için değer kaybı zorunlu, Kasko için zorunlu değildir.

`CaseStatus` yaşam döngüsünü temsil eder ve yalnız `open` ile `closed` değerlerini kabul eder. Mevcut UI'daki “Beklemede”, “Gecikmiş” ve “Kontrol Bekliyor” değerleri yaşam döngüsü durumu değildir; bunlar takip/operasyon sunumlarıdır ve ortak çekirdeğe alınmamıştır.

`CaseStage` ürün belgelerindeki on operasyon aşamasını kararlı İngilizce kodlarla temsil eder:

1. `new_notification`
2. `vehicle_or_service_pending`
3. `inspection_pending`
4. `damage_assessment`
5. `parts_and_labor`
6. `repair_approval_pending`
7. `under_repair`
8. `reporting`
9. `closing_documents`
10. `ready_to_close`

Türkçe etiket eşlemesi ileride UI/adaptör katmanında yapılacaktır.

## Kimlik ve tarih politikası

- Kimlikler (bütün `parse*Id` doğrulayıcıları) kırpma sonrası **1..128 karakter** ve güvenli ASCII kümesiyle (`A-Z a-z 0-9 . _ -`) sınırlıdır. Yol ayracı (`/` ve ters bölü), boşluk, kontrol karakteri ve `..` dizisi reddedilir: **kimlik hiçbir zaman dosya yolu olamaz.** UUID/ULID biçimi hâlâ bu paketin kararı değildir.
- `OfficeCaseNumber`, `YYYY/N` biçimindedir; yıl `2000..9999`, sıra pozitif güvenli tam sayıdır. Alt sınır V2'nin modern kayıt ufkunu, üst sınır ise saat bağımlılığı oluşturmadan dört haneli biçimi korur.
- `NotificationFormNumber` ve `InsurerClaimNumber`, en çok **128 karakterlik** nominal referanslardır; en az bir alfasayısal karakter zorunludur, kontrol karakterleri ve ters bölü reddedilir. `11/18882475` gibi slash içeren gerçek biçimler geçerlidir; bu değerler **hiçbir zaman dosya yolu veya path parçası olarak kullanılmamalıdır** — fiziksel yol üretimi File Agent sınırının işidir.
- `PlateNumber` girdiyi kırpar (en çok **32 karakter**), büyük harfe ve tek aralıklı kanonik gösterime dönüştürür. Standart Türk plaka dizilimi tanınırsa `34 MPA 764` biçimi üretilir; farklı ama alfasayısal plakalar gereksiz katı bir regex ile reddedilmez. Arama anahtarı ayraçsızdır: `34MPA764`.
- `UtcDateTime`, yalnız `YYYY-MM-DDTHH:mm:ssZ` veya üç basamak milisaniyeli `YYYY-MM-DDTHH:mm:ss.sssZ` biçimini kabul eder. Offset ve timezone'suz değerler reddedilir.
- `LocalDate`, gerçek takvim doğrulamasıyla `YYYY-MM-DD` biçimini kabul eder; timezone taşımaz ve dönüştürülmez.
- Takip tarihi ürün kararıyla **saat içermez**: `CaseCore.followUpDate`, `LocalDate` taşır (2026-07-11 proje sertleştirme kararı, `DECISION_LOG.md` HB-2026-005). `followUpAt` alanı kaldırılmıştır. `lastInterventionAt`, `createdAt` ve `updatedAt` `UtcDateTime` olarak kalır.
- `EntityVersion`, optimistic locking için 1'den başlayan pozitif güvenli tam sayıdır; güvenli sınırda artırım `overflow` hatası verir.

Paket 03, API DTO'larını ve bağımsız runtime validation/sözleşme katmanını ayrıca kuracaktır; bu paket DTO veya genel amaçlı şema doğrulayıcısı içermez.

## Komutlar

```text
npm run typecheck --workspace @hasarbotu/domain
npm run test --workspace @hasarbotu/domain
npm run build --workspace @hasarbotu/domain
```

Build çıktısı `dist/` altında ESM JavaScript ve TypeScript declaration dosyalarıdır.
