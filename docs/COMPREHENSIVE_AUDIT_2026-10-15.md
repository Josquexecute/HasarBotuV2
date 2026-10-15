# Uygulama denetimi — 15 Ekim 2026

Sonuç: **yerel doğrulama PASS; genel ürün/ofis kabulü PARTIAL**. Son koşularda **2.552 test başarılı**, başarısız test yok. Yazılımın bütün olası girdilerde %100 hatasız olduğuna ilişkin bir garanti değildir. Aşağıdaki açık maddeler kapanmadan tamamen eksiksiz ürün kabulü verilmez.

## Kapsam ve ortam

- Git tabanı: `aa70225`; başlangıçta çalışma ağacı temizdi. Değişiklikler yereldir.
- Node.js 24.21.0, ayrı PostgreSQL 18.4 kümesi, yalnız loopback bağlantısı. Veritabanlarının tamamı `hasarbotu_audit*_test` adlarıyla ayrıldı.
- React ekranları/veri adaptörleri, domain, contracts, migration, Fastify, File Agent, Electron ve Windows dağıtım araçları incelendi ve test edildi.
- Sentetik dosyalar/kullanıcılar kullanıldı. Ofis veritabanı, evrakları, çalışan servisleri ve mevcut kullanıcı kurulumu değiştirilmedi; yayın yapılmadı.

## Yeniden üretilen ve düzeltilen sorunlar

| Alan | Sorun ve etkisi | Düzeltme ve kanıt |
| --- | --- | --- |
| Poliçe metni | PDF değişince mevcut metin yüklenmiyor; sürüm değişince önceki kanıt kalabiliyor; geç yanıt ve devam eden sorgulama yeni seçimi ezebiliyordu. | Durum dosya/istek kimliğine bağlandı, seçim değişiminde içerik temizlendi, geç sonuçlar elendi. Altı regresyon testi önce başarısız oldu, düzeltmeyle geçti. |
| OCR | Önceki OCR sürümünün metin isteği veya sorgulama yanıtı seçilen yeni sürümü değiştirebiliyordu. | Sürüm seçimiyle sahiplenen istekler, iptal ve aynı anda tek sorgulama; kanıt/sayfa sonuçlarında seçim kontrolü. İki regresyon önce başarısız oldu. |
| Poliçe sayfalama | Kaynak belgeler, PDF sayfaları ve metin parçaları yalnız ilk 100 kayıttan okunuyordu. Sonraki kanıtlar görünmüyordu. | API sayfalaması tamamlanır, filtre korunur, tekrar eden/geçersiz sayfalama reddedilir. 201 segment, 101 PDF sayfası ve ikinci belge sayfasındaki poliçe test edildi. |
| PDF motor sürümü | Gerçek `pdfjs-dist` 6.2.108 çalışırken sonuç ve ekran 6.1.200 gösteriyordu. Mevcut test sabit yanlış değeri beklediği için bunu yakalamıyordu. | Yeni sonuçlar gerçek sürümü kaydeder; ekran kayıt sürümünü gösterir. Test artık kurulu paket sürümüyle karşılaştırır. Eski kayıtların okunması korunur. |
| Düzenleme yetkisi | Düzenleme izni olmayan kullanıcıya etkin düzenleme düğmesi gösteriliyor, işlem API'de reddediliyordu. | Düğme ve pencere güncel `case_write` iznine bağlandı. Salt okunur kullanıcı ve izni kaldırılmış eksper test edildi. |
| Bağımlılıklar | Fastify ve Electron dahil güncel taramada güvenlik uyarıları vardı. | Fastify 5.12.7, Electron 43.7.11 ve ilgili uyumlu geçişli yamalar uygulandı. Üretim bağımlılığı taraması sıfır; tüm bağımlılıklarda paketleme zincirine ait 8 orta önem dereceli kayıt kaldı. |

PDF protokolü için `0060_pdf_parser_version` migration'ı eklendi. Eski snapshot'lar yeniden etiketlenmez. Yeni sürümden kanıt varken geri alma açık hata ile durur. Eski motoru isteyen bir iş, yeni işçide yanlış sürüm bilgisiyle çalıştırılmaz; `parser_version_mismatch` döner. Merkezi API/File Agent güncellemesinde migration ve servis sürümleri birlikte ele alınmalıdır; ofise uygulanmadı.

## Test altyapısında bulunan sorunlar

- Bildirim ve değer kaybı geri alma testleri, sonraki sigortacı kataloğunun kasıtlı geri alma engeline takılıyordu. Tarihsel migration dizinleriyle kendi korumaları gerçekten sınanır; üretim veri koruması gevşetilmedi.
- Sigortacı migration testinin ilerletmesi tek adıma sabitlendi; ardından kalan migration'lar uygulanır.
- Windows servis kontrolündeki eski kaynak kodu deseni, mevcut online SQLite yedeği ve WAL/journal kopyasıyla uyumlu hale getirildi. Gerçek WAL senaryoları da çalıştırıldı.
- Tailscale testi kurulu gerçek istemciyi çalıştırıyordu. Sentetik CLI, test PATH'inde önceliklendirildi; gizli alanların dışlanması, oturumsuz durum, hatalı çıkış ve bozuk JSON gerçek süreçle doğrulandı.
- Electron kabul testinde özel görüntü kayıt dizini oluşturulmadığında sonuç yazımı uygulamanın çıkışını engelliyordu. Dizin test tarafından hazırlanır.
- Gerçek API işlemini bekleyen EKSİST testinin jsdom varsayılanı olan 1 saniyelik sınırı yük altında yetmiyordu. İşlem sonucu için 5 saniye beklenir; gerçek Agent ve fiziksel klasör kontrolleri korunur.
- README'deki bulunmayan mimari ve yerel geliştirme dosyalarına yönlendirmeler mevcut katman kılavuzlarına düzeltildi.

## Son doğrulamalar

Son `npm test` zinciri çıkış kodu 0 ile tamamlandı: 2.351 başarılı, yalnız canlı HTTP ortamı isteyen 6 test atlandı. Bu aynı 6 test ayrı gerçek HTTP sunucusuyla çalıştırılıp geçti; açıkta atlanmış bir kontrol olarak bırakılmadı. Dağıtım/operasyon araçlarının 195 testiyle toplam 2.552 başarılı test vardır. Tekrarlanan hedefli koşular bu toplama tekrar eklenmedi. 18 yeni regresyon senaryosu eklendi.

| Alt sistem | Başarılı test |
| --- | ---: |
| Frontend | 463 |
| Domain | 611 |
| Contracts | 291 |
| Database | 83 |
| Desktop bridge | 14 |
| API | 613 |
| File Agent | 115 |
| Electron | 161 |
| Ayrı canlı HTTP istemcileri | 6 |
| Node dağıtım/operasyon araçları | 195 |
| **Toplam** | **2.552** |

Her alt sistemin son logu `.local/audit-20261015/` altında tutulur. Başarısız ilk koşular da kök neden ve regresyon kanıtı olarak korunur. Makine özeti: `summary.json`.

| Kontrol | Durum |
| --- | --- |
| Ana `npm test` zinciri | Başarılı; sekiz alt sistemin tamamı çalıştı |
| Canlı HTTP istemcileri | 6/6 başarılı; ayrı HTTP sunucusu ve test veritabanı |
| Tüm Node dağıtım/operasyon testleri | 195/195 başarılı, atlama yok |
| Gerçek Electron kabulü | 161/161 test; ayrıca arayüz senaryosunda 17/17 kontrol |
| TypeScript | Son dosyalarla frontend ve tüm workspace kontrolleri başarılı |
| ESLint | 0 hata; kapsam dışındaki mevcut 11 uyarı |
| Build ve bundle sınırları | Başarılı |
| WinSW/depolama kontrolü | Başarılı |
| Windows x64 NSIS paketi | Ayrı yerel klasörde üretildi; PE hedefi x64, imza durumu `NotSigned` |
| Paketlenmiş uygulama | Gerçek açılış, ofis profili, 55 UI dosyasının hash eşleşmesi, loopback köprüsü ve çarpıyla tepsiye küçülme başarılı |
| Gerçek ofis API'si, salt okunur | `/health`: HTTP 200 ve `ok`; kimliksiz oturum okuması HTTP 401. Kullanıcı iş akışı kabulü değildir. |

Kabul görüntüleri `.local/audit-20261015/ui-evidence/` altında; açık/koyu tema, dar pencere ve %150 yakınlaştırma senaryoları bulunur. İki görüntü ayrıca görsel olarak incelendi.

Yerel denetim paketi `.local/audit-20261015/release-verified/HasarBotu-Setup-0.1.27.exe` dosyasıdır; 107.119.784 bayt, SHA-256 `a87288b8cb3e9f0592c9d9b46fbe0c9a84fe266ec2e127c0d8c25f272870920d`. Yayınlanmış yeni sürüm değildir.

## Açık kalanlar ve ürün sınırları

1. **Paketleme zincirinde 8 orta önem dereceli bağımlılık kaydı:** `sprintf-js` → `roarr` → `global-agent` → `@electron/get` ve electron-builder ailesi. Bunlar 8 bağımsız uygulama açığı olarak yorumlanmaz. Npm'nin sunduğu çözüm electron-builder geri sürümüdür; doğrulanmış uyumlu bir yama olmadan genel güvenlik kabulü verilmez.
2. **Gerçek ofis kabulü:** bu denetimde ofis hesabıyla günlük işlem, gerçek Gmail/Google yetkilendirmesi, ücretli AI sağlayıcıları ve canlı pCloud senkronizasyonu sınanmadı. Sentetik entegrasyonlar bu kabulün yerine geçmez. Paket açıldı; mevcut kullanıcı kurulumu üzerine kurma/güncelleme yapılmadı.
3. **Fotoğraf galerisi yok:** üretim evrak ekranı metadata ve doğrulama gösteriyor; gerçek küçük resim/galeri sunmuyor (`DocumentPhotoApiModule.tsx`).
4. **PDF'den otomatik kapanma ücreti okuma yok:** ücret elle giriliyor, kaynak belge/sayfa ve onayla kaydediliyor; domain kaynağı `manual` (`closure-fee.ts`, `CaseFeeApiModule.tsx`).
5. **Kasko değer kaybı uygulanmış değil:** üretim modülü açıkça desteklenmediğini gösteriyor (`TrafficValueLossApiModule.tsx`).
6. İşçilik/Excel dağıtımının daha önce bilinçli kaldırılmış olması çalışan özelliğin bozulması olarak değerlendirilmedi. Diğer V1 ürün farkları için [önceki karşılaştırma](./V1_V2_FEATURE_COMPARISON_2026-10-15.md) geçerlidir; bu denetim eksik ürün modüllerini geliştirmez.

Yukarıdaki ürün sınırları kaynak kodundan doğrulanmıştır. Hukuki tarife veya mevzuatın güncelliğine ilişkin ayrı bir kabul verilmemiştir.

## Kaynaklar ve yerel kanıt

- [Fastify 5.12.7](https://github.com/fastify/fastify/releases/tag/v5.12.7), [Electron 43.7.11](https://releases.electronjs.org/release/v43.7.11): aynı ana sürüm içinde kullanılan yamalar.
- Önce/sonra: `pdf-regression-red.log`, `ocr-red.log`, `permissions-red.log`, `pdf-pagination-red.log`, `parser-version-red.log`; ilgili `green` logları aynı dizinde.
- Geniş koşular: `all-verified.log`, `live-http.log`, `tools-verified.log`; derleme/paket için `build-verified.log`, `package-smoke-verified.log`; tip/lint için `types-verified.log`, `lint-verified.log`.
- Ofis bağlantı profili ve sentetik test kimlik bilgileri rapora dahil edilmez. Denetim sırasında görünen ilgisiz kök `.xlsx` dosyası korunmuştur.
