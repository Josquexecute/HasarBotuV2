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

`CaseStage` yedi aşama taşır: `new_notification` (Yeni İhbar), `parts_and_labor` (Parça Referans Kodları İstenildi), `under_repair` (Onarımda), `under_investigation` (Araştırmada), `total_loss` (Ağır Hasar/Pert), `ready_to_close` (Kapanışa Hazır) ve `closed` (Kapanış). Kaldırılan eski aşama kodları okuma ve komut sınırlarında Onarımda olarak normalleştirilir; Kapanışa Hazır dosyayı açık tutar, kapanış yalnız fiziksel konum doğrulamasıyla tamamlanır.

## Kimlik ve tarih politikası

- Kimlikler (bütün `parse*Id` doğrulayıcıları) kırpma sonrası **1..128 karakter** ve güvenli ASCII kümesiyle (`A-Z a-z 0-9 . _ -`) sınırlıdır. Yol ayracı (`/` ve ters bölü), boşluk, kontrol karakteri ve `..` dizisi reddedilir: **kimlik hiçbir zaman dosya yolu olamaz.** UUID/ULID biçimi hâlâ bu paketin kararı değildir.
- `OfficeCaseNumber`, `YYYY/N` biçimindedir; yıl `2000..9999`, sıra pozitif güvenli tam sayıdır. Alt sınır V2'nin modern kayıt ufkunu, üst sınır ise saat bağımlılığı oluşturmadan dört haneli biçimi korur.
- `NotificationFormNumber` ve `InsurerClaimNumber`, en çok **128 karakterlik** nominal referanslardır; en az bir alfasayısal karakter zorunludur, kontrol karakterleri ve ters bölü reddedilir. `11/18882475` gibi slash içeren gerçek biçimler geçerlidir; bu değerler **hiçbir zaman dosya yolu veya path parçası olarak kullanılmamalıdır** — fiziksel yol üretimi File Agent sınırının işidir.
- `PlateNumber` girdiyi kırpar (en çok **32 karakter**), büyük harfe ve tek aralıklı kanonik gösterime dönüştürür. Standart Türk plaka dizilimi tanınırsa `34 MPA 764` biçimi üretilir; farklı ama alfasayısal plakalar gereksiz katı bir regex ile reddedilmez. Arama anahtarı ayraçsızdır: `34MPA764`.
- `UtcDateTime`, yalnız `YYYY-MM-DDTHH:mm:ssZ` veya üç basamak milisaniyeli `YYYY-MM-DDTHH:mm:ss.sssZ` biçimini kabul eder. Offset ve timezone'suz değerler reddedilir.
- `LocalDate`, gerçek takvim doğrulamasıyla `YYYY-MM-DD` biçimini kabul eder; timezone taşımaz ve dönüştürülmez.
- Yeni ihbar çalışma klasörleri `YYYY OFİS/_EKSİK DOSYALAR/PLAKA` altında oluşturulur. Dosya detayındaki ay klasörüne taşıma planı, ihbar tarihinden `YYYY OFİS/Ay YYYY/PLAKA` hedefini üretir; kullanıcı onayından sonra File Agent bütünlüğü doğrulayıp kayıtlı konumu değiştirir. Plaka sonekleri korunur ve hedefin üzerine yazılmaz. Kapanış aynı ayın `KAPALI DOSYALAR` altını kullanır; mevcut `YYYY/Ay YYYY` yolları desteklenmeye devam eder.
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

## Değer kaybı hesap ve kaynak sınırı

28.10.2026 kontrolü: referans tahmin, `01.07.2026 V_1.xlsx` ve kilitli snapshot katsayılarını kullanır; resmî rapor veya piyasa araştırmasının yerine geçmez. Marka/model/kasa dosyadan, parça eşleştirmesi referans tablodan alınır. Malzemesi doğrulanmayan parçaya çelik/plastik niteliği atanmaz. Önceki parça hasarı veya hasar sayısı bilinmiyorsa hesap tamamlanmaz. Mevcut SBM bağlantısının KTT mutabakat sonucu, parça geçmişi kanıtı sayılmaz; kayıtlı, doğrulanmış ve çelişkisiz geçmiş kanıtları kullanılabilir, diğer durumlarda inceleme gerekir.

- [SEDDK 2026/11](https://seddk.gov.tr/UploadContent/Documents/2026-11_Say%C4%B1l%C4%B1_Genelge.pdf), 13.05.2026; yürürlük 01.07.2026, m.4/6 ve Ek-1.1: ortak rapor şablonu ve piyasa araştırması. Sayısal katsayı kaynağı değildir.
- [SEDDK 2025/25](https://www.seddk.gov.tr/upload/2025-25%20say%C4%B1l%C4%B1%20Genelge%20-%20Copy%201.pdf), [12.11.2025 tarihli resmî açıklama](https://seddk.gov.tr/upload/Bas%C4%B1n%20Duyurusu-12.11.pdf): önceki hasar ve piyasa analizi içeren değer kaybı raporu. Yeni katsayı veya genel bir otomatik parça dışlama kuralı türetilmedi.
- [RG 12.06.2026, 33278](https://www.resmigazete.gov.tr/eskiler/2026/06/20260612-3.htm), m.2/6/8; yürürlük 01.07.2026: gerçek zarar ve piyasa değer farkı; eski Ek-1/2/3/7 kaldırılmıştır. Mevcut piyasa farkı yöntemi korunur, Excel tahmini yasal tazminat olarak sunulmaz. [SEDDK aynı tarihli açıklaması](https://seddk.gov.tr/UploadContent/Documents/Bas%C4%B1n%20Duyurusu.12.6.pdf) araç hasarı başvurusunun değer kaybını da kapsadığını doğrular; ayrı başvuru koşulu eklenmedi.
- [Sigorta Tahkim Karar Dergisi 64](https://www.sigortatahkim.org/content/CmsFiles/karardrgs64.pdf), 25.10.2025, K-2025/532676, s.28–30: geçmiş hasarlar ve kaza tarihindeki piyasa farkı somut dosya kapsamında değerlendirilir. Tekil karardan genel katsayı veya tüm araçlar için otomatik ret kuralı üretilmedi.

Excel karşılaştırması `services/file-agent/test/value-loss-workbook-parity.test.ts` içindedir. Önceden belgelenmiş iki kaynak hatası bilinçli olarak kopyalanmaz: `H1` tam 1.000 TL katlarında sıfır döndürürken rehberdeki 500 TL tavan yuvarlaması korunur; `F9` 5.001 saat üzerinde `D` metni döndürürken kaynak tablonun 0,70 değeri kullanılır. Bu sadeleştirmede hesap katsayıları ve yuvarlama değiştirilmedi.
